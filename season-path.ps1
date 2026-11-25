<#
.SYNOPSIS
    Turns a season id into the folder its data files live in.

.DESCRIPTION
    Every data file used to sit directly in data/ and hold exactly one season,
    so starting a new season overwrote the old one in place. They now live in
    data/<label>/ -- data/2025-26/players.js, data/2026-27/players.js -- and
    nothing is ever overwritten by the mere passage of a season.

    Dot-source this from a build script:

        . (Join-Path $PSScriptRoot 'season-path.ps1')
        $OutPath = Get-SeasonPath -Root $root -Season $Season -Name 'players'

    IMPORTANT for the callers: resolve the path only AFTER the season has been
    detected. Four of the build scripts used to default $OutPath near the top
    of the file, long before they probe the API for the current season; doing
    that now would bake the wrong folder into the path.
#>

function Get-SeasonLabel {
    param([Parameter(Mandatory)][string] $Season)   # 20262027
    if ($Season -notmatch '^\d{8}$') { throw "Season '$Season' is not an 8-digit id like 20262027." }
    '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)
}

function Get-SeasonPath {
    param(
        [Parameter(Mandatory)][string] $Root,
        [Parameter(Mandatory)][string] $Season,
        [Parameter(Mandatory)][string] $Name       # players | history | advanced | goals | pool | schedule
    )
    $label = Get-SeasonLabel -Season $Season
    $dir   = Join-Path (Join-Path $Root 'data') $label
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Join-Path $dir ("{0}.js" -f $Name)
}

<#  Every row of a stats-API report, paged.

    Since November 2026 the stats API ignores limit=-1 (and any limit above
    100): every response holds at most 100 rows, whatever was asked, while
    "total" still reports the true count. Reading one response therefore
    silently kept the 100 lowest player ids -- the nightly run refused to write
    history for five nights before anyone noticed.

    So: page with start= in steps of 100, under an explicit sort that makes
    every row unique (without one the order is unstable and paging skips and
    duplicates), then insist that the rows collected match "total" and that no
    key repeats. Anything else throws rather than writing a short file.

    $Uri is the report URL WITHOUT start/limit/sort. Get-Json must exist in
    the caller's scope (each builder defines its own). #>
function Get-AllStatsRows {
    param(
        [Parameter(Mandatory)][string]   $Uri,
        [Parameter(Mandatory)][string[]] $SortBy,      # e.g. 'playerId' or 'playerId','gameId'
        [int] $PageSize = 100
    )
    $sortJson = '[' + (($SortBy | ForEach-Object { '{"property":"' + $_ + '","direction":"ASC"}' }) -join ',') + ']'
    $sort = [uri]::EscapeDataString($sortJson)
    $sep  = if ($Uri.Contains('?')) { '&' } else { '?' }

    $rows  = New-Object System.Collections.ArrayList
    $total = -1
    $start = 0
    do {
        $resp = Get-Json "$Uri${sep}sort=$sort&start=$start&limit=$PageSize"
        $page = @($resp.data)
        if ($total -lt 0) { $total = [int]$resp.total }
        foreach ($r in $page) { [void]$rows.Add($r) }
        $start += $PageSize
    } while ($page.Count -gt 0 -and $rows.Count -lt $total)

    if ($rows.Count -ne $total) {
        throw "Stats API: collected $($rows.Count) rows but it reports $total -- refusing a short read."
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($r in $rows) {
        $key = ($SortBy | ForEach-Object { [string]$r.$_ }) -join '|'
        if (-not $seen.Add($key)) { throw "Stats API: row $key came back twice -- paging is unstable, refusing." }
    }
    return ,$rows.ToArray()
}

<#  Rewrites data/seasons.js from what is actually on disk, so the index can
    never drift from reality. Called at the end of a build. #>
function Update-SeasonIndex {
    param(
        [Parameter(Mandatory)][string] $Root,
        [string] $Current = ''
    )
    $dataDir = Join-Path $Root 'data'
    $known   = 'players', 'history', 'advanced', 'goals', 'penalties', 'pool', 'schedule', 'trades', 'regles', 'injuries'

    $rows = @()
    foreach ($dir in (Get-ChildItem -Path $dataDir -Directory | Sort-Object Name -Descending)) {
        if ($dir.Name -notmatch '^\d{4}-\d{2}$') { continue }
        $files = @()
        foreach ($n in $known) {
            if (Test-Path (Join-Path $dir.FullName "$n.js")) { $files += $n }
        }
        if ($files.Count -eq 0) { continue }
        $yr = [int]$dir.Name.Substring(0, 4)
        $rows += [ordered]@{
            label = $dir.Name
            id    = '{0}{1}' -f $yr, ($yr + 1)
            files = [string[]]@($files)
        }
    }
    if ($rows.Count -eq 0) { throw 'No season folders found under data/ -- refusing to write an empty index.' }

    # Newest folder wins unless the caller names one.
    if ([string]::IsNullOrWhiteSpace($Current)) { $Current = $rows[0].label }

    $payload = [ordered]@{ current = $Current; seasons = $rows }
    $json = $payload | ConvertTo-Json -Depth 5 -Compress
    $body = "/* Generated by the build scripts -- do not edit by hand." + [Environment]::NewLine +
            "   Which seasons the site holds, and which one opens by default. */" + [Environment]::NewLine +
            "window.NHL_SEASONS = " + $json + ";" + [Environment]::NewLine

    $out = Join-Path $dataDir 'seasons.js'
    [System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding $false))
    return $out
}
