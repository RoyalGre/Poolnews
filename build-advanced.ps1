<#
.SYNOPSIS
    Builds data/advanced.js -- per-player ice time, shots, and the season
    details the fun-facts page needs (best game, point streaks, home/road).

.DESCRIPTION
    Points alone do not say whether a player earned them in 12 minutes a night
    or 22. That needs time on ice, which is only in the per-GAME reports.

    The bulk report returns one row per player per game, and its cayenne filter
    accepts "playerId in (...)", so a whole season of game logs comes back in a
    couple of dozen requests rather than one per player.

    Careful with the row cap: limit=-1 returns everything, but only up to
    10,000 rows, and start=10000 returns NOTHING -- you cannot page past it. So
    ids are requested in small batches whose row count stays well clear of the
    ceiling. Silent truncation is the failure mode to avoid here.

    Only aggregates are written out, not the raw rows: the page needs a season
    summary per player, and shipping ~80,000 game rows to the browser would be
    absurd.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-advanced.ps1
#>

[CmdletBinding()]
param(
    [string] $Season    = '',
    [string] $OutPath   = '',
    [int]    $BatchSize = 40      # players per request; ~3,000 rows, cap is 10,000
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($OutPath)) { $OutPath = Join-Path $root 'data\advanced.js' }

$STAT = 'https://api.nhle.com/stats/rest/en'

function Get-Json($Uri) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            $resp = Invoke-WebRequest -Uri $Uri -TimeoutSec 120 -UseBasicParsing `
                                      -Headers @{ 'Accept' = 'application/json' }
            return ([System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json)
        } catch {
            if ($try -eq 3) { throw }
            Start-Sleep -Seconds (2 * $try)
        }
    }
}

# -----------------------------------------------------------------------------
# 1. Which season, and who played in it
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
if (-not $Season) { throw 'No season with stats found.' }

Write-Host "Season $Season" -ForegroundColor Cyan
$exp     = [uri]::EscapeDataString("seasonId=$Season and gameTypeId=2")
$summary = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=false&limit=-1&cayenneExp=$exp"
$allIds  = @($summary.data | Where-Object { [int]$_.gamesPlayed -gt 0 } | ForEach-Object { [int]$_.playerId })
Write-Host "  $($allIds.Count) skaters played at least one game"

# -----------------------------------------------------------------------------
# 2. Every game row for those players, in batches
# -----------------------------------------------------------------------------
$stats = @{}     # playerId -> accumulator
$sw    = [System.Diagnostics.Stopwatch]::StartNew()
$batch = 0
$rowsTotal = 0

for ($i = 0; $i -lt $allIds.Count; $i += $BatchSize) {
    $chunk = $allIds[$i..([Math]::Min($i + $BatchSize - 1, $allIds.Count - 1))]
    $list  = $chunk -join ','
    $cx    = [uri]::EscapeDataString("seasonId=$Season and gameTypeId=2 and playerId in ($list)")
    $resp  = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=true&limit=-1&cayenneExp=$cx"
    $rows  = @($resp.data)
    $batch++
    $rowsTotal += $rows.Count

    # A batch anywhere near the ceiling means rows were dropped without warning.
    if ($rows.Count -ge 9500) {
        throw "Batch $batch returned $($rows.Count) rows -- too close to the 10,000 cap. Lower -BatchSize."
    }

    foreach ($r in $rows) {
        $id = [int]$r.playerId
        if (-not $stats.ContainsKey($id)) {
            $stats[$id] = [ordered]@{
                gp = 0; toi = 0; sh = 0; pim = 0; ppp = 0; gwg = 0; pts = 0
                hPts = 0; hToi = 0; rPts = 0; rToi = 0
                bestPts = 0; bestDate = ''; bestOpp = ''
                games = [System.Collections.Generic.List[object]]::new()
            }
        }
        $s   = $stats[$id]
        $p   = [int]$r.points
        $toi = [int][Math]::Round([double]$r.timeOnIcePerGame)   # seconds in THIS game

        $s.gp++
        $s.pts += $p
        $s.toi += $toi
        $s.sh  += [int]$r.shots
        $s.pim += [int]$r.penaltyMinutes
        $s.ppp += [int]$r.ppPoints
        $s.gwg += [int]$r.gameWinningGoals

        if ($r.homeRoad -eq 'H') { $s.hPts += $p; $s.hToi += $toi }
        else                     { $s.rPts += $p; $s.rToi += $toi }

        # Best single game: most points, earliest date wins a tie.
        if ($p -gt $s.bestPts) {
            $s.bestPts  = $p
            $s.bestDate = [string]$r.gameDate
            $s.bestOpp  = [string]$r.opponentTeamAbbrev
        }

        $s.games.Add(@{ d = [string]$r.gameDate; p = $p })
    }

    if ($batch % 5 -eq 0 -or $i + $BatchSize -ge $allIds.Count) {
        Write-Host ("  batch {0,3}: {1,6} rows so far ({2:n0}s)" -f $batch, $rowsTotal, $sw.Elapsed.TotalSeconds)
    }
}

Write-Host "  $batch requests, $rowsTotal game rows, $($stats.Count) players"

# -----------------------------------------------------------------------------
# 3. Streaks, and flatten to parallel arrays
# -----------------------------------------------------------------------------
$ids = @($stats.Keys) | Sort-Object

$gp=@(); $toi=@(); $sh=@(); $pim=@(); $ppp=@(); $gwg=@(); $pts=@()
$hPts=@(); $hToi=@(); $rPts=@(); $rToi=@()
$bestPts=@(); $bestDate=@(); $bestOpp=@(); $streak=@(); $drought=@()

foreach ($id in $ids) {
    $s = $stats[$id]

    # Longest run of consecutive games with a point, and without one.
    $games = @($s.games | Sort-Object { $_.d })
    $bestRun = 0; $run = 0; $bestDry = 0; $dry = 0
    foreach ($g in $games) {
        if ([int]$g.p -gt 0) {
            $run++; if ($run -gt $bestRun) { $bestRun = $run }
            $dry = 0
        } else {
            $dry++; if ($dry -gt $bestDry) { $bestDry = $dry }
            $run = 0
        }
    }

    $gp += [int]$s.gp;   $toi += [int]$s.toi; $sh  += [int]$s.sh
    $pim += [int]$s.pim; $ppp += [int]$s.ppp; $gwg += [int]$s.gwg; $pts += [int]$s.pts
    $hPts += [int]$s.hPts; $hToi += [int]$s.hToi
    $rPts += [int]$s.rPts; $rToi += [int]$s.rToi
    $bestPts += [int]$s.bestPts; $bestDate += [string]$s.bestDate; $bestOpp += [string]$s.bestOpp
    $streak += [int]$bestRun; $drought += [int]$bestDry
}

# [int[]]@(...) / [string[]]@(...): without the re-wrap, PowerShell 5.1 emits
# {"value":[...],"Count":n} instead of a JSON array.
$payload = [ordered]@{
    season   = $Season
    label    = '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)
    updated  = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    ids      = [int[]]@($ids)
    gp       = [int[]]@($gp)
    toi      = [int[]]@($toi)        # seconds, whole season
    pts      = [int[]]@($pts)
    sh       = [int[]]@($sh)
    pim      = [int[]]@($pim)
    ppp      = [int[]]@($ppp)
    gwg      = [int[]]@($gwg)
    hPts     = [int[]]@($hPts)
    hToi     = [int[]]@($hToi)
    rPts     = [int[]]@($rPts)
    rToi     = [int[]]@($rToi)
    bestPts  = [int[]]@($bestPts)
    bestDate = [string[]]@($bestDate)
    bestOpp  = [string[]]@($bestOpp)
    streak   = [int[]]@($streak)
    drought  = [int[]]@($drought)
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress
if ($json -match '"Count":\s*\d+') { throw 'Arrays serialized as PSObject wrappers -- refusing to write.' }

# Sanity: nobody plays 82 games at 40 minutes a night.
for ($i = 0; $i -lt $ids.Count; $i++) {
    if ($gp[$i] -gt 0 -and ($toi[$i] / $gp[$i]) -gt 2100) {
        throw "Player $($ids[$i]) averages $([math]::Round($toi[$i]/$gp[$i]/60,1)) min/game -- time on ice looks wrong."
    }
}

$js = "/* Generated by build-advanced.ps1 -- do not edit by hand. */`r`nwindow.NHL_ADVANCED = $json;`r`n"
$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $js, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OutPath).Length / 1KB, 1)
Write-Host ''
Write-Host ("Done. {0} players -> {1} ({2} KB) in {3:n0}s" -f $ids.Count, $OutPath, $kb, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
