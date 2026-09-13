<#
.SYNOPSIS
    Builds data/schedule.js -- every Thursday, Friday and Sunday game of the
    season, with the winner once it has been played.

.DESCRIPTION
    Feeds the "Qui va gagner ?" weekly challenge: poolers pick a winner for
    each game of the coming weekend, and the most correct picks wins.

    Only Thursday, Friday and Sunday are kept, the same three days as the zone
    challenge. Saturday is deliberately left out -- it is the big hockey night
    and would double the size of the form on its own.

    ONE REQUEST PER WEEK, not per day: /v1/schedule/{date} returns the whole
    week containing that date, so a full season costs about 28 requests.

    THE DATE TRAP, measured rather than assumed: 46 of 51 games in a sample
    week carry a startTimeUTC whose DATE is the next day -- a Thursday night
    game in the Eastern time zone is already Friday in UTC. Bucketing on
    startTimeUTC would scatter nearly every Thursday game into Friday and
    break the weekend grouping. The API's own gameWeek[].date IS the local
    day, so that is what we key on. Never derive the day from startTimeUTC.

    Finished games are banked: a game whose state is final keeps its winner
    and is never refetched. Only weeks containing unplayed games are pulled
    again, so a nightly run costs one or two requests.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-schedule.ps1

.EXAMPLE
    # Rebuild every week from scratch, ignoring what is already banked.
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-schedule.ps1 -Full
#>

[CmdletBinding()]
param(
    [string] $Season,
    [switch] $Full,
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

$WEB  = 'https://api-web.nhle.com/v1'
$STAT = 'https://api.nhle.com/stats/rest/en'
$OUT  = Join-Path $root 'data\schedule.js'

# The three days the challenge covers. DayOfWeek: Sunday = 0 .. Thursday = 4.
$DEFI_DAYS = @('Thursday', 'Friday', 'Sunday')

function Say([string] $Msg, [string] $Colour = 'Gray') {
    if (-not $Quiet) { Write-Host $Msg -ForegroundColor $Colour }
}

# Invoke-RestMethod decodes as ISO-8859-1 when the response carries no charset,
# which turns Montréal into Montrïal. Same wrapper as the other build scripts.
function Get-Json([string] $Uri) {
    for ($try = 1; $try -le 3; $try++) {
        try {
            $resp = Invoke-WebRequest -Uri $Uri -TimeoutSec 40 -UseBasicParsing `
                        -Headers @{ 'Accept' = 'application/json' }
            $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray())
            return $text | ConvertFrom-Json
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
    $Season = '{0}{1}' -f $yr, ($yr + 1)
}

$info = (Get-Json "$STAT/season?cayenneExp=id=$Season").data | Select-Object -First 1
if (-not $info) { throw "Season $Season is unknown to the API." }

$start = [datetime]$info.startDate
$end   = [datetime]$info.regularSeasonEndDate
$label = '{0}-{1}' -f $Season.Substring(0, 4), $Season.Substring(6, 2)

Say ("Season {0} ({1}) : {2} -> {3}" -f $Season, $label,
     $start.ToString('yyyy-MM-dd'), $end.ToString('yyyy-MM-dd')) 'Cyan'

# -----------------------------------------------------------------------------
# 2. What is already banked
#    A finished game never changes, so it is kept and never refetched.
# -----------------------------------------------------------------------------
$banked = @{}        # gameId -> psobject
if (-not $Full -and (Test-Path $OUT)) {
    try {
        $old = [System.IO.File]::ReadAllText($OUT, [Text.Encoding]::UTF8)
        $jsonStart = $old.IndexOf('{')
        if ($jsonStart -ge 0) {
            $prev = $old.Substring($jsonStart).TrimEnd() -replace ';\s*$', '' | ConvertFrom-Json
            if ([string]$prev.season -eq $Season) {
                foreach ($g in $prev.games) {
                    if ($g.w) { $banked[[int]$g.id] = $g }   # only finished ones
                }
            }
        }
        Say ("  {0} finished games already banked" -f $banked.Count)
    } catch {
        Say '  could not read the previous file, rebuilding from scratch' 'Yellow'
    }
}

# -----------------------------------------------------------------------------
# 3. Walk the season one WEEK at a time
# -----------------------------------------------------------------------------
$games   = New-Object System.Collections.ArrayList
$seen    = @{}
$fetched = 0
$reused  = 0

$cursor = $start.Date
while ($cursor -le $end.Date) {
    $stamp = $cursor.ToString('yyyy-MM-dd')
    $week  = Get-Json "$WEB/schedule/$stamp"
    $fetched++

    foreach ($day in @($week.gameWeek)) {
        # gameWeek[].date is the LOCAL day -- the whole point. See the header.
        $dayDate = [datetime]::ParseExact([string]$day.date, 'yyyy-MM-dd', $null)
        if ($DEFI_DAYS -notcontains $dayDate.DayOfWeek.ToString()) { continue }
        if ($dayDate -lt $start.Date -or $dayDate -gt $end.Date)   { continue }

        foreach ($g in @($day.games)) {
            if ([int]$g.gameType -ne 2) { continue }        # regular season only
            $gid = [int]$g.id
            if ($seen.ContainsKey($gid)) { continue }
            $seen[$gid] = $true

            if ($banked.ContainsKey($gid)) {
                [void]$games.Add($banked[$gid])
                $reused++
                continue
            }

            # NOT $home / $away: $HOME is a read-only automatic variable in
            # PowerShell and variable names are case-insensitive, so assigning
            # to $home aborts the script outright.
            $aAb = [string]$g.awayTeam.abbrev
            $hAb = [string]$g.homeTeam.abbrev

            $row = [ordered]@{
                id = $gid
                d  = [string]$day.date
                a  = $aAb
                h  = $hAb
            }

            # A finished game carries both scores. Higher score wins; an OT or
            # shootout winner counts exactly like a regulation one.
            $state = [string]$g.gameState
            if ($state -eq 'OFF' -or $state -eq 'FINAL') {
                $as = [int]$g.awayTeam.score
                $hs = [int]$g.homeTeam.score
                if ($as -ne $hs) {
                    $row.as = $as
                    $row.hs = $hs
                    $row.w  = if ($hs -gt $as) { $hAb } else { $aAb }
                    $row.r  = [string]$g.gameOutcome.lastPeriodType   # REG | OT | SO
                }
            }

            [void]$games.Add([pscustomobject]$row)
        }
    }

    $cursor = $cursor.AddDays(7)
}

if ($games.Count -eq 0) { throw 'No Thursday/Friday/Sunday games found -- refusing to write an empty file.' }

# ---- guard rails ------------------------------------------------------------
# Every game must land on one of the three days. If this ever trips, the date
# bucketing has regressed -- almost certainly by keying on startTimeUTC.
$wrongDay = @($games | Where-Object {
    $DEFI_DAYS -notcontains ([datetime]::ParseExact($_.d, 'yyyy-MM-dd', $null)).DayOfWeek.ToString()
}).Count
if ($wrongDay -gt 0) {
    throw "$wrongDay games fall outside Thursday/Friday/Sunday -- the date bucketing is wrong, refusing to write."
}

$played = @($games | Where-Object { $_.w }).Count

# -----------------------------------------------------------------------------
# 4. Write it
# -----------------------------------------------------------------------------
$sorted = @($games | Sort-Object { $_.d }, { [int]$_.id })

$payload = [ordered]@{
    season  = $Season
    label   = $label
    updated = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    days    = @('jeu', 'ven', 'dim')
    games   = $sorted
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress
$body = "/* Generated by build-schedule.ps1 -- do not edit by hand. */" + [Environment]::NewLine +
        "window.NHL_SCHEDULE = " + $json + ";" + [Environment]::NewLine

[System.IO.File]::WriteAllText($OUT, $body, (New-Object System.Text.UTF8Encoding $false))

$kb = [math]::Round((Get-Item $OUT).Length / 1KB)
Say ''
Say ("Wrote {0} ({1} Ko)" -f $OUT, $kb) 'Green'
Say ("  {0} games on Thu/Fri/Sun, {1} already played" -f $sorted.Count, $played)
Say ("  {0} weeks fetched, {1} finished games reused from the previous file" -f $fetched, $reused)
