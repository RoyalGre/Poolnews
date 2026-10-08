<#
.SYNOPSIS
    Builds data/<season>/penalties.js -- every penalty of the season: who took
    it, what for, and how many minutes.

.DESCRIPTION
    The Faits saillants page sets each pooler's penalties beside the rank they
    finished at. advanced.js already carries penalty MINUTES per player, but not
    the infraction -- "tripping", "fighting" -- and that only exists in the
    per-game play-by-play feed, one request per game.

    Same banking as build-goals.ps1: finished games never change, so every game
    already in the output file is kept and only new ones are fetched. A full
    season is ~1,300 requests once, then ~10 a night.

    Bench minors are left out: they have no committing player (only the one who
    served it), so they belong to no pooler.

    Rows are stored as arrays, not objects -- [gid, playerId, type, kind, min]
    with type and kind as indexes into the lookup tables -- because ~11,000
    repeated key names would be most of the file.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-penalties.ps1 -Season 20252026

.EXAMPLE
    # Refetch the whole season, ignoring what is already on disk.
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-penalties.ps1 -Rebuild
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
. (Join-Path $root 'season-path.ps1')
# $OutPath is resolved once $Season is known (see section 1).

$WEB  = 'https://api-web.nhle.com/v1'
$STAT = 'https://api.nhle.com/stats/rest/en'

function Get-Json($Uri) {
    # Invoke-RestMethod would decode as ISO-8859-1 under Windows PowerShell 5.1.
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
if ([string]::IsNullOrWhiteSpace($OutPath)) {
    $OutPath = Get-SeasonPath -Root $root -Season $Season -Name 'penalties'
}

$label = '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)
Write-Host ("Season {0} ({1})" -f $Season, $label) -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 2. What is already on disk
# -----------------------------------------------------------------------------
$haveGames = @{}     # gameId -> list of [type, kind, player, min] with type/kind as STRINGS
$keptCount = 0

if (-not $Rebuild -and (Test-Path $OutPath)) {
    try {
        $old = [System.IO.File]::ReadAllText($OutPath)
        $i   = $old.IndexOf('{')
        $j   = $old.LastIndexOf('}')
        if ($i -ge 0 -and $j -gt $i) {
            $prev = $old.Substring($i, $j - $i + 1) | ConvertFrom-Json
            if ([string]$prev.season -eq $Season) {
                foreach ($gid in $prev.doneGames) {
                    $haveGames[[string]$gid] = New-Object System.Collections.ArrayList
                }
                # Back to strings, so a reused game and a new one go through the
                # same lookup tables when the file is written again.
                foreach ($r in $prev.pen) {
                    $gid = [string]$r[0]
                    if (-not $haveGames.ContainsKey($gid)) { $haveGames[$gid] = New-Object System.Collections.ArrayList }
                    [void]$haveGames[$gid].Add([pscustomobject]@{
                        pid  = [int]$r[1]
                        type = [string]$prev.types[[int]$r[2]]
                        kind = [string]$prev.kinds[[int]$r[3]]
                        min  = [int]$r[4]
                    })
                }
                $keptCount = $haveGames.Count
                Write-Host ("Reusing {0} games already collected." -f $keptCount) -ForegroundColor DarkGray
            } else {
                Write-Host 'Existing file is a different season -- starting fresh.' -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host ("Could not reuse the existing file ({0}) -- starting fresh." -f $_.Exception.Message) -ForegroundColor Yellow
        $haveGames = @{}
        $keptCount = 0
    }
}

# -----------------------------------------------------------------------------
# 3. The season's game list -- one club-schedule request per team
# -----------------------------------------------------------------------------
$standings = Get-Json "$WEB/standings/now"
$teams = @($standings.standings | ForEach-Object { $_.teamAbbrev.default } | Sort-Object -Unique)
if ($teams.Count -eq 0) { throw 'Could not list the teams.' }

Write-Host ("Collecting the schedule from {0} teams..." -f $teams.Count) -ForegroundColor Cyan
$games = @{}
foreach ($t in $teams) {
    $sched = Get-Json "$WEB/club-schedule-season/$t/$Season"
    foreach ($g in $sched.games) {
        if ([int]$g.gameType -ne 2) { continue }         # regular season only
        $gid = [string]$g.id
        if (-not $games.ContainsKey($gid)) {
            $games[$gid] = [pscustomobject]@{ id = $gid; date = [string]$g.gameDate; state = [string]$g.gameState }
        }
    }
    Start-Sleep -Milliseconds $ThrottleMs
}
Write-Host ("{0} regular-season games in the schedule." -f $games.Count) -ForegroundColor DarkGray

$final = @('OFF', 'FINAL')
$todo = @($games.Values | Where-Object { ($final -contains $_.state) -and -not $haveGames.ContainsKey($_.id) } |
          Sort-Object date, id)
Write-Host ("{0} finished games to fetch." -f $todo.Count) -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 4. Fetch the play-by-play for each new game
# -----------------------------------------------------------------------------
$fetched = 0
$errors  = 0
$bench   = 0
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

    $rows = New-Object System.Collections.ArrayList
    foreach ($p in $pbp.plays) {
        if ([string]$p.typeDescKey -ne 'penalty') { continue }
        $d = $p.details
        if ($null -eq $d) { continue }
        if ($null -eq $d.committedByPlayerId) { $bench++; continue }   # bench minor: nobody's player
        # A match penalty comes through as 5 minutes, but the official PIM
        # (and advanced.js) count 15 -- the 5 plus the automatic 10 of the
        # ejection. Measured: all four 2025-26 mismatches against the stats
        # API were match penalties, each exactly 10 short.
        $min = [int]$d.duration
        if ([string]$d.typeCode -eq 'MAT') { $min += 10 }
        [void]$rows.Add([pscustomobject]@{
            pid  = [int]$d.committedByPlayerId
            type = [string]$d.descKey
            kind = [string]$d.typeCode
            min  = $min
        })
    }

    $haveGames[$gid] = $rows
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
$types = New-Object System.Collections.ArrayList
$kinds = New-Object System.Collections.ArrayList
$typeIx = @{}
$kindIx = @{}
$pen = New-Object System.Collections.ArrayList

foreach ($gid in ($haveGames.Keys | Sort-Object { [int]$_ })) {
    foreach ($r in $haveGames[$gid]) {
        if (-not $typeIx.ContainsKey($r.type)) { $typeIx[$r.type] = $types.Count; [void]$types.Add($r.type) }
        if (-not $kindIx.ContainsKey($r.kind)) { $kindIx[$r.kind] = $kinds.Count; [void]$kinds.Add($r.kind) }
        # [int[]]@(...): a typed array, never New-Object int[] n -- that one
        # serializes as {"value":[...],"Count":n}.
        [void]$pen.Add([int[]]@([int]$gid, $r.pid, $typeIx[$r.type], $kindIx[$r.kind], $r.min))
    }
}

$doneGames = @($haveGames.Keys | ForEach-Object { [int]$_ } | Sort-Object)
if ($pen.Count -eq 0) { throw 'No penalties collected -- refusing to write an empty file.' }

# ---- guard rails ------------------------------------------------------------
# Every NHL game has penalties; a season averaging under two a game means the
# feed changed shape and the rows are being dropped.
if ($doneGames.Count -ge 20 -and ($pen.Count / $doneGames.Count) -lt 2) {
    throw ("Only {0:n1} penalties a game -- the feed probably changed, refusing to write." -f ($pen.Count / $doneGames.Count))
}
$noType = @($types | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count
if ($noType -gt 0) { throw 'Some penalties have no infraction name -- refusing to write a bad file.' }

$payload = [ordered]@{
    season    = $Season
    label     = $label
    updated   = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    games     = $doneGames.Count
    doneGames = [int[]]@($doneGames)
    types     = [string[]]@($types)
    kinds     = [string[]]@($kinds)
    pen       = $pen
}

$json = $payload | ConvertTo-Json -Depth 5 -Compress
if ($json -match '"Count":\s*\d+') { throw 'Arrays serialized as PSObject wrappers -- see the [int[]]@() note in build-history.ps1.' }

$js = "/* Generated by build-penalties.ps1 -- do not edit by hand. */" + "`r`n" +
      "window.NHL_PENALTIES = $json;" + "`r`n"

$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $js, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OutPath).Length / 1KB, 1)
Write-Host ''
Write-Host ("Done. {0} penalties from {1} games -> {2} ({3} KB)" -f $pen.Count, $doneGames.Count, $OutPath, $kb) -ForegroundColor Green
if ($fetched -gt 0) { Write-Host ("Fetched {0} new games in {1}; {2} bench minors left out." -f $fetched, $sw.Elapsed.ToString('mm\:ss'), $bench) -ForegroundColor DarkGray }
if ($keptCount -gt 0) { Write-Host ("Reused {0} already on disk." -f $keptCount) -ForegroundColor DarkGray }
if ($errors -gt 0) { Write-Host ("{0} games could not be fetched; re-run to pick them up." -f $errors) -ForegroundColor Yellow }
