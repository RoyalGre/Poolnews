<#
.SYNOPSIS
    One command to bring the whole site up to date. Safe to run on a schedule.

.DESCRIPTION
    Checks whether anything has actually happened in the NHL since the last run
    and, if it has, refreshes the data files the pages read.

    Two gears:

      Light (default)  season goals/assists + the current week's snapshot.
                       ~5 requests, a few seconds. This is what a frequent
                       schedule should run.

      Full             also re-walks all 32 rosters and rebuilds the ice-time
                       file behind the fun-facts page. ~85 requests, under a
                       minute. Runs itself once a day, or on demand with -Full.

    If no new game has been recorded since the last run, it exits after three
    requests without touching anything -- so scheduling it often is cheap.

    Every step refuses to write a file that fails its own sanity checks, so a
    bad run leaves the previous (good) data in place rather than half-updating
    the site.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\update.ps1 -Full -Force
#>

[CmdletBinding()]
param(
    [string] $Season = '',            # pin a season; empty = most recent one with games
    [switch] $Full,                   # force the full gear this run
    [switch] $Force,                  # rebuild even if no new games were played
    [switch] $WithAdvanced,           # include ice time in a Light run too
    [int]    $FullEveryHours = 24,    # how often the full gear runs on its own
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

$stateFile = Join-Path $root 'data\update-state.json'
$logFile   = Join-Path $root 'update.log'
$STAT      = 'https://api.nhle.com/stats/rest/en'

function Log {
    param([string] $Msg, [string] $Colour = 'Gray')
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    if (-not $Quiet) { Write-Host $line -ForegroundColor $Colour }
}

function Get-Json($Uri) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            $resp = Invoke-WebRequest -Uri $Uri -TimeoutSec 60 -UseBasicParsing `
                                      -Headers @{ 'Accept' = 'application/json' }
            return ([System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json)
        } catch {
            if ($try -eq 3) { throw }
            Start-Sleep -Seconds (3 * $try)
        }
    }
}

function Run-Step {
    param([string] $Name, [string] $Script, [string[]] $Arguments)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $out = & powershell -ExecutionPolicy Bypass -File (Join-Path $root $Script) @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "FAILED: $Name" 'Red'
        $out | Select-Object -Last 12 | ForEach-Object { Log "    $_" 'Red' }
        throw "$Script failed"
    }
    Log ('  {0} ok ({1:n0}s)' -f $Name, $sw.Elapsed.TotalSeconds) 'DarkGray'
}

$runSw = [System.Diagnostics.Stopwatch]::StartNew()
Log '--- update starting ---' 'Cyan'

try {
    # -------------------------------------------------------------------------
    # 1. Which season are we in?
    #    Before opening night the new season has no rows, so this correctly
    #    stays on last season until the first games are actually played.
    # -------------------------------------------------------------------------
    if ([string]::IsNullOrWhiteSpace($Season)) {
        $now = Get-Date
        $yr  = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }
        foreach ($offset in 0, 1, 2) {
            $y    = $yr - $offset
            $cand = '{0}{1}' -f $y, ($y + 1)
            $exp  = [uri]::EscapeDataString("seasonId=$cand and gameTypeId=2")
            if ([int](Get-Json "$STAT/skater/summary?isAggregate=false&isGame=false&start=0&limit=1&cayenneExp=$exp").total -gt 0) {
                $Season = $cand
                break
            }
        }
    }
    if (-not $Season) { Log 'No season has any games yet -- nothing to do.' 'Yellow'; exit 0 }

    # -------------------------------------------------------------------------
    # 2. Has anything happened since last time?
    #    The latest game date, plus how many player-games are recorded on that
    #    date. The second half matters: on a busy night the date stops changing
    #    while games keep finishing.
    # -------------------------------------------------------------------------
    $sortDesc = [uri]::EscapeDataString('[{"property":"gameDate","direction":"DESC"}]')
    $expS     = [uri]::EscapeDataString("gameTypeId=2 and seasonId=$Season")
    $latest   = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=true&start=0&limit=1&sort=$sortDesc&cayenneExp=$expS"

    if (-not $latest.data -or $latest.data.Count -eq 0) {
        Log "Season $Season has no completed games yet -- nothing to do." 'Yellow'
        exit 0
    }

    $lastDate = [string]$latest.data[0].gameDate
    $expD     = [uri]::EscapeDataString("gameTypeId=2 and seasonId=$Season and gameDate=""$lastDate""")
    $onDate   = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=true&start=0&limit=1&cayenneExp=$expD"
    $signature = '{0}:{1}' -f $lastDate, [int]$onDate.total

    $state = $null
    if (Test-Path $stateFile) {
        try { $state = [System.IO.File]::ReadAllText($stateFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { }
    }

    $sameSeason = $state -and ([string]$state.season -eq $Season)
    $nothingNew = $sameSeason -and ([string]$state.signature -eq $signature)

    if ($nothingNew -and -not $Force) {
        Log "No new games since the last run (latest: $lastDate). Nothing to do." 'DarkGray'
        exit 0
    }

    # -------------------------------------------------------------------------
    # 3. Which gear?
    # -------------------------------------------------------------------------
    $lastFull = if ($sameSeason -and $state.lastFull) { [datetime]::Parse($state.lastFull) } else { [datetime]::MinValue }
    $dueFull  = ((Get-Date) - $lastFull).TotalHours -ge $FullEveryHours
    $goFull   = $Full -or $dueFull -or -not $sameSeason

    Log ("Season $Season, latest game $lastDate -- running the {0} update" -f $(if ($goFull) { 'FULL' } else { 'light' })) 'Cyan'

    # -------------------------------------------------------------------------
    # 4. Do the work
    # -------------------------------------------------------------------------
    if ($goFull) {
        Run-Step 'rosters + season stats' 'refresh-players.ps1' @('-StatsSeason', $Season)
        Run-Step 'weekly history'         'build-history.ps1'   @('-Season', $Season)
        Run-Step 'ice time'               'build-advanced.ps1'  @('-Season', $Season)
    } else {
        Run-Step 'season stats'    'refresh-players.ps1' @('-StatsSeason', $Season, '-StatsOnly')
        Run-Step 'weekly history'  'build-history.ps1'   @('-Season', $Season, '-Incremental')
        if ($WithAdvanced) {
            Run-Step 'ice time'    'build-advanced.ps1'  @('-Season', $Season)
        }
    }

    # Goal coordinates behind the Poolers page. This one is incremental by
    # nature -- it only ever fetches games it has not already banked -- so it
    # runs in both gears: after an evening of 10 games it costs 10 requests.
    Run-Step 'goal locations' 'build-goals.ps1' @('-Season', $Season)

    # The Thu/Fri/Sun schedule behind the "Qui va gagner ?" challenge. Like the
    # goal locations it banks finished games and only refetches weeks that still
    # hold unplayed ones, so a nightly run costs a request or two.
    # The schedule belongs to the season being PLAYED, which is not the same as
    # $Season above: that one is "the newest season with completed games", so
    # before opening night it is still last season. Building the schedule for a
    # finished season would produce a form nobody can pick.
    $now       = Get-Date
    $playYr    = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }
    $playSeason = '{0}{1}' -f $playYr, ($playYr + 1)
    Run-Step 'schedule + results' 'build-schedule.ps1' @('-Season', $playSeason)

    # The data files just changed, so the ?v= tags in the pages now point at
    # content that no longer exists. Restamping them is what makes a visitor's
    # browser fetch the new numbers instead of redrawing yesterday's from its
    # cache. Cheap, and safe to run when nothing changed.
    # Data now lives in data/<label>/, so refresh the index of which seasons
    # exist. Rebuilt from what is actually on disk, never hand-maintained.
    . (Join-Path $root 'season-path.ps1')
    # "current" is the season a visitor should land on -- the one being played,
    # not the last one with finished stats.
    $idx = Update-SeasonIndex -Root $root -Current (Get-SeasonLabel -Season $playSeason)
    Log ("  season index: {0}" -f (Split-Path -Leaf $idx))

    Run-Step 'cache tags' 'stamp-assets.ps1' @('-Quiet')

    # -------------------------------------------------------------------------
    # 5. Remember where we got to
    # -------------------------------------------------------------------------
    $newState = [ordered]@{
        season    = $Season
        signature = $signature
        lastGame  = $lastDate
        lastRun   = (Get-Date -Format 'o')
        lastFull  = if ($goFull) { (Get-Date -Format 'o') } else { $state.lastFull }
    }
    [System.IO.File]::WriteAllText($stateFile,
        ($newState | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))

    $sizes = foreach ($f in 'players.js', 'history.js', 'advanced.js', 'goals.js') {
        $p = Join-Path $root "data\$f"
        if (Test-Path $p) { '{0} {1} KB' -f $f, [math]::Round((Get-Item $p).Length / 1KB) }
    }
    Log ("done in {0:n0}s -- {1}" -f $runSw.Elapsed.TotalSeconds, ($sizes -join ', ')) 'Green'
    exit 0
}
catch {
    Log "ERROR: $($_.Exception.Message)" 'Red'
    Log 'Data files were left as they were.' 'Red'
    exit 1
}
