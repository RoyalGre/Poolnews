<#
.SYNOPSIS
    Builds data/history.js -- a week-by-week snapshot of every player's
    season-to-date goals and assists.

.DESCRIPTION
    The standings page charts how each pooler's total moved over the season,
    which needs stats "as of" each week, not just final totals.

    The NHL stats API can do exactly that: asking for an aggregate over
    per-game rows with a gameDate ceiling returns season-to-date numbers as of
    that date. One request set per week gives a real, backfilled history --
    no need to start collecting from today and wait.

    Output is a plain .js file assigning window.NHL_HISTORY, loaded by the
    pages with a <script src> tag. (A page opened from disk cannot fetch() a
    local .json file -- CORS blocks it -- but it can load a local script.)

    Re-running rebuilds the whole file from scratch, so it is safe to run any
    time; nothing is appended or accumulated locally.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-history.ps1
#>

[CmdletBinding()]
param(
    [string] $Season  = '',    # e.g. 20252026; empty = most recent season with games
    [string] $OutPath = '',
    [int]    $EveryDays = 7,

    # Keep the snapshots already in data/history.js and refetch only the last
    # one (the week still in progress) plus any weeks that have completed since.
    # Weeks in the past never change, so a scheduled update has no reason to
    # re-download 28 of them: this turns a 56-request rebuild into 2 to 6.
    [switch] $Incremental
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # progress bars make web calls crawl

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
if ([string]::IsNullOrWhiteSpace($OutPath)) { $OutPath = Join-Path $root 'data\history.js' }

$STAT = 'https://api.nhle.com/stats/rest/en'

function Get-Json($Uri) {
    # Same UTF-8 handling as refresh-players.ps1: Invoke-RestMethod would decode
    # these responses as ISO-8859-1 under Windows PowerShell 5.1.
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
# 1. Which season, and what dates does it span
# -----------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($Season)) {
    $now  = Get-Date
    $yr   = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }
    foreach ($offset in 0, 1, 2) {
        $y    = $yr - $offset
        $cand = '{0}{1}' -f $y, ($y + 1)
        $exp  = [uri]::EscapeDataString("seasonId=$cand and gameTypeId=2")
        $probe = Get-Json "$STAT/skater/summary?isAggregate=false&isGame=false&start=0&limit=1&cayenneExp=$exp"
        if ([int]$probe.total -gt 0) { $Season = $cand; break }
    }
}
if (-not $Season) { throw 'No season with stats found.' }

$info  = (Get-Json "$STAT/season?cayenneExp=id=$Season").data | Select-Object -First 1
$start = [datetime]::Parse($info.startDate).Date
$end   = [datetime]::Parse($info.regularSeasonEndDate).Date
$today = (Get-Date).Date
if ($end -gt $today) { $end = $today }   # season still in progress

Write-Host "Season $Season : $($start.ToString('yyyy-MM-dd')) -> $($end.ToString('yyyy-MM-dd'))" -ForegroundColor Cyan

# Snapshot dates: one a week, plus the final day so the last point is exact.
$dates = @()
$d = $start.AddDays($EveryDays - 1)
while ($d -lt $end) { $dates += $d; $d = $d.AddDays($EveryDays) }
$dates += $end
Write-Host "  $($dates.Count) weekly snapshots to fetch"

# -----------------------------------------------------------------------------
# 2. One season-to-date pull per snapshot date
# -----------------------------------------------------------------------------
function Get-AsOf {
    param([string] $Kind, [string] $AsOf)

    # limit=-1 returns the entire snapshot in one request (~850 skaters), which
    # is what makes running this often cheap: 28 requests for a whole season
    # instead of the ~300 that paging 100 at a time needed.
    #
    # An explicit sort stays, and it is not cosmetic: without one the API
    # returns rows in an unstable order, so any paged read silently skips and
    # duplicates players.
    $sort = [uri]::EscapeDataString('[{"property":"playerId","direction":"ASC"}]')
    $exp  = [uri]::EscapeDataString("gameTypeId=2 and seasonId=$Season and gameDate<=""$AsOf""")
    $uri  = "$STAT/$Kind/summary?isAggregate=true&isGame=true&limit=-1&sort=$sort&cayenneExp=$exp"

    $resp = Get-Json $uri
    $rows = @($resp.data)

    # limit=-1 stops at 10,000 rows and there is no way to page past it, so a
    # response near the ceiling means players were dropped without an error.
    if ($rows.Count -ge 9500) {
        throw "$Kind snapshot for $AsOf returned $($rows.Count) rows -- too close to the 10,000 cap to trust."
    }
    return $rows
}

$snapshots = @()     # each: @{ d = 'yyyy-MM-dd'; stats = @{ id = @(g,a) } }
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ---- what can be reused from the file already on disk ----
$reuse = @{}         # 'yyyy-MM-dd' -> stats hashtable
if ($Incremental -and (Test-Path $OutPath)) {
    try {
        $prevTxt = [System.IO.File]::ReadAllText($OutPath, [System.Text.Encoding]::UTF8)
        $prev = [regex]::Match($prevTxt, '(?s)window\.NHL_HISTORY\s*=\s*(\{.*\});').Groups[1].Value | ConvertFrom-Json

        # A file from another season shares nothing useful with this run.
        if ([string]$prev.season -eq [string]$Season) {
            $prevIds = @($prev.ids)
            # The most recent snapshot was taken mid-week; it must be refetched.
            $keepUpTo = $prev.weeks.Count - 2
            for ($w = 0; $w -le $keepUpTo; $w++) {
                $wk = $prev.weeks[$w]
                $st = @{}
                for ($i = 0; $i -lt $prevIds.Count; $i++) {
                    $g = [int]$wk.g[$i]; $a = [int]$wk.a[$i]
                    if ($g -ne 0 -or $a -ne 0) { $st[[int]$prevIds[$i]] = @($g, $a) }
                }
                $reuse[[string]$wk.d] = $st
            }
            Write-Host "  reusing $($reuse.Count) snapshots already on disk" -ForegroundColor DarkGray
        } else {
            Write-Host "  existing file is season $($prev.season), rebuilding from scratch" -ForegroundColor DarkGray
        }
    } catch {
        Write-Warning "  could not reuse the existing history ($($_.Exception.Message)); rebuilding it all"
        $reuse = @{}
    }
}

$fetched = 0
foreach ($snapDate in $dates) {
    $asOf = $snapDate.ToString('yyyy-MM-dd')

    if ($reuse.ContainsKey($asOf)) {
        $snapshots += @{ d = $asOf; stats = $reuse[$asOf] }
        continue
    }

    $stats = @{}
    foreach ($kind in 'skater', 'goalie') {
        foreach ($r in (Get-AsOf -Kind $kind -AsOf $asOf)) {
            $stats[[int]$r.playerId] = @([int]$r.goals, [int]$r.assists)
        }
    }
    $fetched++

    $snapshots += @{ d = $asOf; stats = $stats }
    Write-Host ("  {0}  {1,4} players  ({2:n0}s elapsed)" -f $asOf, $stats.Count, $sw.Elapsed.TotalSeconds)
}

if ($Incremental) { Write-Host "  fetched $fetched snapshot(s), reused $($snapshots.Count - $fetched)" }

if ($snapshots.Count -eq 0) { throw 'No snapshots fetched -- leaving history.js alone.' }

# -----------------------------------------------------------------------------
# 3. Emit
#    Stored as parallel arrays against one shared id list rather than a
#    dictionary per week -- same information, roughly a third of the bytes.
# -----------------------------------------------------------------------------
$idSet = [System.Collections.Generic.HashSet[int]]::new()
foreach ($s in $snapshots) { foreach ($k in $s.stats.Keys) { $idSet.Add([int]$k) | Out-Null } }
$ids = @($idSet) | Sort-Object

$weeks = @()
$wk = 0
foreach ($s in $snapshots) {
    $wk++
    $g = New-Object int[] $ids.Count
    $a = New-Object int[] $ids.Count
    for ($i = 0; $i -lt $ids.Count; $i++) {
        $v = $s.stats[[int]$ids[$i]]
        if ($null -ne $v) { $g[$i] = $v[0]; $a[$i] = $v[1] }
    }
    # The @() around each array matters: an array straight out of New-Object
    # comes back wrapped in a PSObject, and ConvertTo-Json then emits
    # {"value":[...],"Count":n} instead of a plain JSON array.
    $weeks += [ordered]@{ w = $wk; d = $s.d; g = [int[]]@($g); a = [int[]]@($a) }
}

$payload = [ordered]@{
    season  = $Season
    label   = '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)
    updated = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    ids     = [int[]]@($ids)
    weeks   = $weeks
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress

# ---- guard rails ------------------------------------------------------------
if ($json -match '"Count":\s*\d+') { throw 'Arrays serialized as PSObject wrappers -- see the [int[]]@() note above.' }

# Season-to-date totals can only ever go up. If they do not, the paging is
# dropping rows again.
$drops = 0
for ($i = 0; $i -lt $ids.Count; $i++) {
    $prev = -1
    foreach ($w in $weeks) {
        $p = [int]$w.g[$i] + [int]$w.a[$i]
        if ($p -lt $prev) { $drops++; break }
        $prev = $p
    }
}
if ($drops -gt 0) { throw "$drops players have a cumulative total that goes down -- refusing to write a bad history file." }
$js   = "/* Generated by build-history.ps1 -- do not edit by hand. */" + "`r`n" +
        "window.NHL_HISTORY = $json;" + "`r`n"

$outDir = Split-Path -Parent $OutPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $js, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OutPath).Length / 1KB, 1)
Write-Host ''
Write-Host ("Done. {0} weeks x {1} players -> {2} ({3} KB)" -f $weeks.Count, $ids.Count, $OutPath, $kb) -ForegroundColor Green
