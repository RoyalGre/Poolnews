<#
.SYNOPSIS
    Builds data/goals.js -- every goal of the season, with the ice coordinates
    it was scored from and the players who earned points on it.

.DESCRIPTION
    The Poolers page draws a pooler's points on a rink: one puck per goal their
    roster had a hand in, placed where the shot was taken. Nothing in
    players.js or history.js carries coordinates -- those are season and weekly
    TOTALS -- so this script collects the individual goals.

    That data only exists in the per-game play-by-play feed, one request per
    game, roughly 1,300 games in a full season. Far too many to ask for while
    somebody waits on a page, which is the whole reason this is a build step:
    fetch once, ship a file, and let the page read it instantly offline.

    Two things keep the request count sane on a re-run:

      * Finished games never change, so every game already in the output file
        is kept as-is and only genuinely new ones are fetched. A nightly run
        after a 10-game evening costs 10 requests, not 1,300.
      * A game still in progress IS refetched, since its goals are still
        arriving. Games are only banked once the API reports them final.

    Use -Rebuild to throw all that away and refetch the season from scratch.

    Output is a plain .js file assigning window.NHL_GOALS, loaded with a
    <script src> tag like the other data files (a page opened from disk cannot
    fetch() a local .json -- CORS blocks it -- but it can load a local script).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-goals.ps1

.EXAMPLE
    # Refetch the whole season, ignoring what is already on disk.
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-goals.ps1 -Rebuild
#>

[CmdletBinding()]
param(
    [string] $Season  = '',    # e.g. 20252026; empty = most recent season with games
    [string] $OutPath = '',
    [switch] $Rebuild,         # ignore the existing file, refetch everything
    [int]    $ThrottleMs = 60  # pause between game requests, to be a good citizen
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # progress bars make web calls crawl

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($OutPath)) { $OutPath = Join-Path $root 'data\goals.js' }

$WEB  = 'https://api-web.nhle.com/v1'
$STAT = 'https://api.nhle.com/stats/rest/en'

# Shared by every highlight link; stored once instead of 8,000 times.
$CLIP_PREFIX = 'https://nhl.com/video/'

function Get-Json($Uri) {
    # Same UTF-8 handling as the other build scripts: Invoke-RestMethod would
    # decode these responses as ISO-8859-1 under Windows PowerShell 5.1, which
    # mangles every accented name in the league.
    for ($try = 1; $try -le 3; $try++) {
        try {
            $resp = Invoke-WebRequest -Uri $Uri -TimeoutSec 40 -UseBasicParsing `
                                      -Headers @{ 'Accept' = 'application/json' }
            $text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
            return ($text | ConvertFrom-Json)
        } catch {
            if ($try -eq 3) { throw }
            Start-Sleep -Seconds (2 * $try)
        }
    }
}

# -----------------------------------------------------------------------------
# 1. Which season
# -----------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Season)) {
    $now = Get-Date
    $yr  = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }
    foreach ($offset in 0, 1, 2) {
        $y    = $yr - $offset
        $cand = '{0}{1}' -f $y, ($y + 1)
        $exp  = [uri]::EscapeDataString("seasonId=$cand and gameTypeId=2")
        $probe = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=false&start=0&limit=1&cayenneExp=$exp"
        if ([int]$probe.total -gt 0) { $Season = $cand; break }
    }
}
if ([string]::IsNullOrWhiteSpace($Season)) { throw 'Could not determine a season with games.' }

$label = '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)
Write-Host ("Season {0} ({1})" -f $Season, $label) -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 2. What is already on disk
#    goals.js is regular JSON behind a one-line assignment, so it can be read
#    back and reused rather than refetched.
# -----------------------------------------------------------------------------
$haveGames = @{}     # gameId -> the goal rows already collected for it
$gameMeta  = @{}     # gameId -> @(date, 'AWY@HOM'), shared by that game's goals
$keptCount = 0

if (-not $Rebuild -and (Test-Path $OutPath)) {
    try {
        $old  = [System.IO.File]::ReadAllText($OutPath)
        $i    = $old.IndexOf('{')
        $j    = $old.LastIndexOf('}')
        if ($i -ge 0 -and $j -gt $i) {
            $prev = $old.Substring($i, $j - $i + 1) | ConvertFrom-Json
            if ([string]$prev.season -eq $Season) {
                foreach ($g in $prev.goals) {
                    $gid = [string]$g.gid
                    if (-not $haveGames.ContainsKey($gid)) { $haveGames[$gid] = New-Object System.Collections.ArrayList }
                    [void]$haveGames[$gid].Add($g)
                }
                # Games that finished with no goals at all still need to count as
                # "seen", or they get refetched forever.
                foreach ($gid in $prev.doneGames) {
                    if (-not $haveGames.ContainsKey([string]$gid)) { $haveGames[[string]$gid] = New-Object System.Collections.ArrayList }
                }
                # The date/matchup table has to come back too, or reused games
                # would lose the only copy of their date.
                if ($prev.gameInfo) {
                    foreach ($k in $prev.gameInfo.PSObject.Properties.Name) {
                        $gameMeta[[string]$k] = @($prev.gameInfo.$k)
                    }
                }
                $keptCount = $haveGames.Count
                Write-Host ("Reusing {0} games already collected." -f $keptCount) -ForegroundColor DarkGray
            } else {
                Write-Host 'Existing file is a different season -- starting fresh.' -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host ("Could not reuse the existing file ({0}) -- starting fresh." -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

# -----------------------------------------------------------------------------
# 3. The season's game list
#    The club schedule endpoint is one request per team and covers the whole
#    season, which is far cheaper than walking 200 individual dates.
# -----------------------------------------------------------------------------
$standings = Get-Json "$WEB/standings/now"
$teams = @($standings.standings | ForEach-Object { $_.teamAbbrev.default } | Sort-Object -Unique)
if ($teams.Count -eq 0) { throw 'Could not list the teams.' }

Write-Host ("Collecting the schedule from {0} teams..." -f $teams.Count) -ForegroundColor Cyan
$games = @{}   # gameId -> [pscustomobject] date/state
foreach ($t in $teams) {
    $sched = Get-Json "$WEB/club-schedule-season/$t/$Season"
    foreach ($g in $sched.games) {
        if ([int]$g.gameType -ne 2) { continue }         # regular season only
        $gid = [string]$g.id
        if (-not $games.ContainsKey($gid)) {
            $games[$gid] = [pscustomobject]@{
                id    = $gid
                date  = [string]$g.gameDate
                state = [string]$g.gameState
            }
        }
    }
    Start-Sleep -Milliseconds $ThrottleMs
}
Write-Host ("{0} regular-season games in the schedule." -f $games.Count) -ForegroundColor DarkGray

# A game is worth banking only once it is over. OFF/FINAL mean final; anything
# else is scheduled, live, or postponed.
$final = @('OFF', 'FINAL')

$todo = @()
foreach ($gid in $games.Keys) {
    $g = $games[$gid]
    if ($final -notcontains $g.state) { continue }        # not finished yet
    if ($haveGames.ContainsKey($gid))  { continue }        # already collected
    $todo += $g
}
$todo = @($todo | Sort-Object date, id)

Write-Host ("{0} finished games to fetch." -f $todo.Count) -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 4. Fetch the play-by-play for each new game
#
#    Coordinates come as raw rink positions, which alternate ends every period.
#    Normalizing here (never in the page) means the page can draw one half-rink
#    and every puck already reads as "the attacking zone".
# -----------------------------------------------------------------------------
$fetched = 0
$errors  = 0
$sw = [System.Diagnostics.Stopwatch]::StartNew()

foreach ($g in $todo) {
    $gid = $g.id
    try {
        $pbp = Get-Json "$WEB/gamecenter/$gid/play-by-play"
    } catch {
        $errors++
        Write-Host ("  ! game {0}: {1}" -f $gid, $_.Exception.Message) -ForegroundColor Yellow
        continue
    }

    $homeId  = [int]$pbp.homeTeam.id
    $homeAb  = [string]$pbp.homeTeam.abbrev
    $awayAb  = [string]$pbp.awayTeam.abbrev
    $awayId  = [int]$pbp.awayTeam.id

    $abbrev = @{}
    $abbrev[$homeId] = $homeAb
    $abbrev[$awayId] = $awayAb

    $rows = New-Object System.Collections.ArrayList

    foreach ($p in $pbp.plays) {
        if ([string]$p.typeDescKey -ne 'goal') { continue }
        $d = $p.details
        if ($null -eq $d) { continue }
        if ($null -eq $d.xCoord -or $null -eq $d.yCoord) { continue }
        $hds = [string]$p.homeTeamDefendingSide
        if ([string]::IsNullOrWhiteSpace($hds)) { continue }

        $x = [int]$d.xCoord
        $y = [int]$d.yCoord
        $owner = [int]$d.eventOwnerTeamId

        # Which side the SCORING team was defending; they attack the other one.
        $shooterDef = if ($owner -eq $homeId) { $hds }
                      elseif ($hds -eq 'right') { 'left' } else { 'right' }

        # Flip so every shot in the file attacks toward +x.
        if ($shooterDef -eq 'right') { $x = -$x; $y = -$y }

        # Shootout "goals" are a tiebreaker, not a real goal, and the NHL does
        # not award points for them. Keeping them would inflate every total.
        $per = [int]$p.periodDescriptor.number
        if ([string]$p.periodDescriptor.periodType -eq 'SO') { continue }

        # The date and the matchup are properties of the GAME, not the goal.
        # Repeated on 8,000 goal rows they cost a quarter of the file, so they
        # live in a games table keyed by gid and are rejoined in the page.
        $row = [ordered]@{
            gid = [int]$gid
            x   = $x
            y   = $y
            t   = [string]$abbrev[$owner]
            s   = [int]$d.scoringPlayerId
            p   = $per
            tm  = [string]$p.timeInPeriod
        }
        if ($null -ne $d.assist1PlayerId) { $row.a1 = [int]$d.assist1PlayerId }
        if ($null -ne $d.assist2PlayerId) { $row.a2 = [int]$d.assist2PlayerId }
        if ($null -ne $d.shotType)        { $row.st = [string]$d.shotType }
        if ($null -ne $d.goalieInNetId)   { $row.gl = [int]$d.goalieInNetId }
        if ($null -ne $d.awayScore)       { $row.az = [int]$d.awayScore }
        if ($null -ne $d.homeScore)       { $row.hz = [int]$d.homeScore }
        # Every clip URL starts with the same host and path; only the slug
        # varies, so the constant prefix is stripped and re-added in the page.
        $clip = [string]$d.highlightClipSharingUrl
        if ($clip -and $clip.Length -gt $CLIP_PREFIX.Length) { $row.c = $clip.Substring($CLIP_PREFIX.Length) }

        [void]$rows.Add([pscustomobject]$row)
    }

    $haveGames[$gid] = $rows
    $gameMeta[$gid]  = @([string]$pbp.gameDate, ('{0}@{1}' -f $awayAb, $homeAb))
    $fetched++

    if ($fetched % 50 -eq 0) {
        $rate = if ($sw.Elapsed.TotalSeconds -gt 0) { $fetched / $sw.Elapsed.TotalSeconds } else { 0 }
        $left = if ($rate -gt 0) { [TimeSpan]::FromSeconds(($todo.Count - $fetched) / $rate).ToString('mm\:ss') } else { '?' }
        Write-Host ("  {0}/{1} games... ({2} left)" -f $fetched, $todo.Count, $left) -ForegroundColor DarkGray
    }
    Start-Sleep -Milliseconds $ThrottleMs
}
$sw.Stop()

# -----------------------------------------------------------------------------
# 5. Emit
# -----------------------------------------------------------------------------
# Game ids are chronological within a season, so ordering by gid puts the
# goals in date order without needing the date on every row.
$allGoals = New-Object System.Collections.ArrayList
foreach ($gid in ($haveGames.Keys | Sort-Object { [int]$_ })) {
    foreach ($r in $haveGames[$gid]) { [void]$allGoals.Add($r) }
}
$sorted = @($allGoals | Sort-Object gid, p, tm)

# date + matchup, once per game
$gameInfo = [ordered]@{}
foreach ($gid in ($haveGames.Keys | Sort-Object { [int]$_ })) {
    if ($gameMeta.ContainsKey($gid)) { $gameInfo[$gid] = [string[]]@($gameMeta[$gid]) }
}

$doneGames = @($haveGames.Keys | ForEach-Object { [int]$_ } | Sort-Object)

if ($sorted.Count -eq 0) { throw 'No goals collected -- refusing to write an empty file.' }

# ---- guard rails ------------------------------------------------------------
# Coordinates are normalized to attack toward +x, so a goal from behind centre
# ice is possible (long empty-netters) but a whole file of them means the
# normalization broke.
$behind = @($sorted | Where-Object { $_.x -lt 0 }).Count
if ($behind / $sorted.Count -gt 0.10) {
    throw ("{0}% of goals normalize to the defensive half -- the end-flip is wrong, refusing to write." -f [math]::Round(100 * $behind / $sorted.Count, 1))
}
$noScorer = @($sorted | Where-Object { -not $_.s }).Count
if ($noScorer -gt 0) { throw "$noScorer goals have no scoring player id -- refusing to write a bad file." }

$payload = [ordered]@{
    season     = $Season
    label      = $label
    updated    = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    games      = $doneGames.Count
    clipPrefix = $CLIP_PREFIX
    doneGames  = [int[]]@($doneGames)
    gameInfo   = $gameInfo
    goals      = $sorted
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress
if ($json -match '"Count":\s*\d+') { throw 'Arrays serialized as PSObject wrappers -- see the [int[]]@() note in build-history.ps1.' }

$js = "/* Generated by build-goals.ps1 -- do not edit by hand. */" + "`r`n" +
      "window.NHL_GOALS = $json;" + "`r`n"

$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $js, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OutPath).Length / 1KB, 1)
Write-Host ''
Write-Host ("Done. {0} goals from {1} games -> {2} ({3} KB)" -f $sorted.Count, $doneGames.Count, $OutPath, $kb) -ForegroundColor Green
if ($fetched -gt 0) { Write-Host ("Fetched {0} new games in {1}." -f $fetched, $sw.Elapsed.ToString('mm\:ss')) -ForegroundColor DarkGray }
if ($keptCount -gt 0) { Write-Host ("Reused {0} already on disk." -f $keptCount) -ForegroundColor DarkGray }
if ($errors -gt 0) { Write-Host ("{0} games could not be fetched; re-run to pick them up." -f $errors) -ForegroundColor Yellow }
