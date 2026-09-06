<#
.SYNOPSIS
    Pulls the current NHL player list + the season's goals/assists from the
    NHL's public API and writes data/players.js.

.DESCRIPTION
    The pages are meant to be opened straight off disk (file://). A page loaded
    that way has a "null" origin, so browser fetch() calls to the NHL API get
    blocked by CORS -- and even fetching a local players.json is blocked. A
    plain <script src> tag, though, loads fine. So the data ships as a .js file
    that assigns window.NHL_DATA, and every page pulls in the same copy.

    Run it whenever you want fresh rosters or updated stats.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\refresh-players.ps1
#>

[CmdletBinding()]
param(
    [string] $OutPath = '',

    # Season whose goals/assists get shown as reference numbers while drafting.
    # Leave empty to auto-detect the most recent season that actually has data.
    [string] $StatsSeason = '',

    # Skip the 32 roster calls and reuse the player list already in
    # data/players.js, refreshing only goals and assists. Rosters barely move
    # once a season is under way, but the stats change every night -- so this is
    # the mode a scheduled update should use. Two requests instead of ~45.
    [switch] $StatsOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'   # progress bars make web calls crawl

# Resolve here rather than in the param() default: $PSScriptRoot isn't reliably
# populated in a default-value expression under Windows PowerShell 5.1.
if ([string]::IsNullOrWhiteSpace($OutPath)) {
    $root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
    $OutPath = Join-Path $root 'data\players.js'
}

$WEB  = 'https://api-web.nhle.com/v1'
$STAT = 'https://api.nhle.com/stats/rest/en'

function Get-Json($Uri) {
    # NOT Invoke-RestMethod: under Windows PowerShell 5.1 it falls back to
    # ISO-8859-1 when the response has no charset in its Content-Type, which
    # turns names like "Fransen"/"Valimaki" into mojibake. Pull the raw bytes
    # and decode them as UTF-8 ourselves.
    $resp = Invoke-WebRequest -Uri $Uri -TimeoutSec 40 -UseBasicParsing `
                              -Headers @{ 'Accept' = 'application/json' }
    $text = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
    return ($text | ConvertFrom-Json)
}

$players = [System.Collections.Generic.List[object]]::new()
$seen    = [System.Collections.Generic.HashSet[int]]::new()
$failed  = @()
$teams   = @()

if ($StatsOnly) {
    # -------------------------------------------------------------------------
    # 1b. Reuse the existing list instead of re-walking every roster.
    # -------------------------------------------------------------------------
    if (-not (Test-Path $OutPath)) { throw "-StatsOnly needs an existing $OutPath to update." }
    $existing = [System.IO.File]::ReadAllText($OutPath, [System.Text.Encoding]::UTF8)
    $m = [regex]::Match($existing, '(?s)window\.NHL_DATA\s*=\s*(\{.*\});')
    if (-not $m.Success) { throw "Could not parse $OutPath" }
    $prev = $m.Groups[1].Value | ConvertFrom-Json

    foreach ($p in $prev.players) {
        if (-not $seen.Add([int]$p.i)) { continue }
        $players.Add($p)
    }
    if ($players.Count -eq 0) { throw 'The existing player file is empty -- run without -StatsOnly.' }
    Write-Host "Reusing $($players.Count) players from $OutPath (stats-only refresh)" -ForegroundColor Cyan
}
else {

# -----------------------------------------------------------------------------
# 1. Team list
# -----------------------------------------------------------------------------
Write-Host 'Fetching team list...' -ForegroundColor Cyan
$standings = Get-Json "$WEB/standings/now"
$teams = $standings.standings | ForEach-Object { $_.teamAbbrev.default } | Sort-Object -Unique
Write-Host "  $($teams.Count) teams"

# -----------------------------------------------------------------------------
# 2. Rosters -> the pickable universe
#    One call per team. This is the CURRENT roster, so rookies and new signings
#    are included even though they have no stats history.
# -----------------------------------------------------------------------------
Write-Host 'Fetching rosters...' -ForegroundColor Cyan

foreach ($t in $teams) {
    try {
        $roster = Get-Json "$WEB/roster/$t/current"
    } catch {
        Write-Warning "  $t roster failed: $($_.Exception.Message)"
        $failed += $t
        continue
    }

    foreach ($group in @($roster.forwards, $roster.defensemen, $roster.goalies)) {
        foreach ($p in $group) {
            if ($null -eq $p) { continue }
            # A player on two rosters (recent trade) would otherwise appear twice.
            if (-not $seen.Add([int]$p.id)) { continue }

            $players.Add([ordered]@{
                i = [int]$p.id
                n = ("{0} {1}" -f $p.firstName.default, $p.lastName.default).Trim()
                t = $t
                p = [string]$p.positionCode      # C, L, R, D, G
                s = $(if ($null -ne $p.sweaterNumber) { [int]$p.sweaterNumber } else { $null })
                g = 0
                a = 0
            })
        }
    }
    Write-Host "  $t ($($players.Count) players so far)"
}

if ($players.Count -eq 0) { throw 'No players fetched -- aborting without writing anything.' }

}   # end of the full-roster path

# -----------------------------------------------------------------------------
# 3. Season stats
#    The stats API is paginated; pull it in chunks and merge on playerId.
# -----------------------------------------------------------------------------
function Get-SummaryRows {
    param([string] $Kind, [string] $Season)   # Kind = 'skater' or 'goalie'

    # limit=-1 brings back every player in one request. It stops at 10,000 rows
    # with no way to page past that, so a response near the ceiling means rows
    # were dropped silently -- refuse rather than write a short season.
    $exp  = [uri]::EscapeDataString("seasonId=$Season and gameTypeId=2")
    $uri  = "$STAT/$Kind/summary?isAggregate=false&isGame=false&limit=-1&cayenneExp=$exp"
    $rows = @((Get-Json $uri).data)

    if ($rows.Count -ge 9500) {
        throw "$Kind summary returned $($rows.Count) rows -- too close to the 10,000 cap to trust."
    }
    return $rows
}

# Auto-detect: walk back from the current season until one has data. At the
# start of a new season the current year is empty, so we want the year before.
if ([string]::IsNullOrWhiteSpace($StatsSeason)) {
    $now       = Get-Date
    $startYear = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }

    foreach ($offset in 0, 1, 2) {
        $y   = $startYear - $offset
        $cand = "{0}{1}" -f $y, ($y + 1)
        Write-Host "Checking season $cand for stats..." -ForegroundColor Cyan
        try {
            $exp   = [uri]::EscapeDataString("seasonId=$cand and gameTypeId=2")
            $probe = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=false&start=0&limit=1&cayenneExp=$exp"
            if ([int]$probe.total -gt 0) { $StatsSeason = $cand; break }
        } catch {
            Write-Warning "  probe failed for $cand"
        }
    }
}

$statsApplied = 0
$statsAdded   = 0    # NOT $statsOnly: that name is the [switch] parameter above
if ($StatsSeason) {
    Write-Host "Fetching $StatsSeason stats..." -ForegroundColor Cyan

    $byId = @{}
    foreach ($pl in $players) { $byId[[int]$pl.i] = $pl }

    foreach ($kind in 'skater', 'goalie') {
        try {
            $rows = Get-SummaryRows -Kind $kind -Season $StatsSeason
            Write-Host "  $kind rows: $($rows.Count)"
            foreach ($r in $rows) {
                $target = $byId[[int]$r.playerId]

                if ($null -eq $target) {
                    # Played this season but is not on any current roster: an
                    # unsigned free agent, or someone who has since retired.
                    # They still belong in the list -- a pool drafted last
                    # season has them on rosters, and leaving them out would
                    # score their owner zero and show "Unknown player".
                    $name = if ($kind -eq 'skater') { $r.skaterFullName } else { $r.goalieFullName }
                    if ([string]::IsNullOrWhiteSpace($name)) { continue }

                    # teamAbbrevs is "VAN", or "CAR,VAN" for a player who was
                    # traded; the last one is where the season ended.
                    $team = ''
                    if ($r.teamAbbrevs) { $team = ($r.teamAbbrevs -split '\s*,\s*')[-1] }

                    $pos = if ($kind -eq 'goalie') { 'G' }
                           elseif ($r.positionCode) { [string]$r.positionCode }
                           else { 'C' }

                    $target = [ordered]@{
                        i = [int]$r.playerId
                        n = [string]$name
                        t = $team
                        p = $pos
                        s = $null
                        g = 0
                        a = 0
                    }
                    $players.Add($target)
                    $byId[[int]$r.playerId] = $target
                    $statsAdded++
                }

                $target.g = [int]$r.goals
                $target.a = [int]$r.assists
                $statsApplied++
            }
        } catch {
            Write-Warning "  $kind stats failed: $($_.Exception.Message)"
        }
    }
    Write-Host "  matched stats onto $statsApplied players"
    if ($statsAdded) { Write-Host "  added $statsAdded who played but are not on a current roster" }
} else {
    Write-Warning 'No season with stats found -- players will all show 0 pts.'
}

# -----------------------------------------------------------------------------
# 4. Write data/players.js
# -----------------------------------------------------------------------------
$seasonLabel = if ($StatsSeason) {
    '{0}-{1}' -f $StatsSeason.Substring(0, 4), $StatsSeason.Substring(6, 2)
} else { '' }

$payload = [ordered]@{
    season      = $StatsSeason
    statsSeason = $seasonLabel
    updated     = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    players     = $players
}

# -Depth 6 so the nested player hashtables serialize instead of turning into
# the literal string "System.Collections.Hashtable".
$json = $payload | ConvertTo-Json -Depth 6 -Compress

# Guard: PowerShell 5.1 emits {"value":[...],"Count":n} instead of a plain
# array for some array types, which would be silently unusable in the browser.
if ($json -match '"Count":\s*\d+') { throw 'Arrays serialized as PSObject wrappers -- refusing to write.' }

$js = "/* Generated by refresh-players.ps1 -- do not edit by hand. */`r`nwindow.NHL_DATA = $json;`r`n"

$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Back up once so a bad run is always recoverable.
$backup = ''
if (Test-Path $OutPath) {
    $backup = "$OutPath.bak"
    Copy-Item $OutPath $backup -Force
}
[System.IO.File]::WriteAllText($OutPath, $js, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OutPath).Length / 1KB, 1)
Write-Host ''
Write-Host "Done. $($players.Count) players written, stats season $seasonLabel." -ForegroundColor Green
Write-Host "  $OutPath  ($kb KB)"
if ($backup) { Write-Host "  backup: $backup" }
Write-Host '  Re-run build-history.ps1 too if you want the weekly charts to match.' -ForegroundColor DarkGray
if ($failed.Count) { Write-Warning "Teams that failed: $($failed -join ', ')" }
