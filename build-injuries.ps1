<#
.SYNOPSIS
    Writes data/<saison>/injuries.js: who is hurt, suspended or out today.

.DESCRIPTION
    The NHL's public API has no injury list. ESPN's does, with no key:

        site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries

    Each entry carries a status (Injured Reserve, Day-To-Day, Out, Suspension),
    the date of the last report and a one-line note from a beat reporter. It is
    not an official source -- the NHL publishes none -- so the page says where
    the list comes from.

    ESPN uses its own player ids, so the entries are matched to NHL ids by
    name, accents ignored, and confirmed by team. A name that matches on the
    wrong team (a player traded since ESPN's last report) is still accepted
    when it is the only player of that name in the league; two players with
    the same name on other teams are left unmatched rather than guessed.

    The file is a snapshot of TODAY. It only ever goes into the season being
    played, and the page loader never borrows it for another season: today's
    injuries shown under 2023-24 would be nonsense.

    The file is rewritten only when the list itself changed. Otherwise the
    nightly run would commit a new timestamp every night for nothing.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-injuries.ps1
#>

[CmdletBinding()]
param(
    [string] $Season = '',            # empty = the season being played
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

. (Join-Path $root 'season-path.ps1')

function Say([string] $m, [string] $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }

# The season being PLAYED (calendar), same rule as update.ps1 uses for the schedule.
if ([string]::IsNullOrWhiteSpace($Season)) {
    $now = Get-Date
    $yr  = if ($now.Month -ge 9) { $now.Year } else { $now.Year - 1 }
    $Season = '{0}{1}' -f $yr, ($yr + 1)
}
$label = Get-SeasonLabel -Season $Season
$dir   = Join-Path (Join-Path $root 'data') $label
$playersPath = Join-Path $dir 'players.js'

# Before the season has its own player list there is nothing to match against.
# Not an error: the page simply shows no injuries.
if (-not (Test-Path $playersPath)) {
    Say ("No {0} -- skipping injuries." -f $playersPath) 'Yellow'
    exit 0
}
$out = Get-SeasonPath -Root $root -Season $Season -Name 'injuries'

Say ("Season {0}" -f $label) 'Cyan'

function Fold([string] $s) {
    $n = $s.Normalize([Text.NormalizationForm]::FormD)
    (($n -replace '\p{Mn}', '') -replace '[^A-Za-z]', '').ToLower()
}

# ESPN abbreviations that differ from the NHL's.
$ESPN_ABBR = @{ 'LA' = 'LAK'; 'NJ' = 'NJD'; 'SJ' = 'SJS'; 'TB' = 'TBL'; 'UTAH' = 'UTA' }

# ---- the league, by folded name ---------------------------------------------
$yj = [System.IO.File]::ReadAllText($playersPath, [Text.Encoding]::UTF8)
$players = (($yj.Substring($yj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json).players
$byName = @{}
foreach ($p in $players) {
    $k = Fold ([string]$p.n)
    if (-not $byName.ContainsKey($k)) { $byName[$k] = @() }
    $byName[$k] += $p
}

# ---- ESPN ---------------------------------------------------------------------
$uri = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'
$feed = $null
for ($try = 1; $try -le 3; $try++) {
    try {
        $resp = Invoke-WebRequest -Uri $uri -TimeoutSec 60 -UseBasicParsing -Headers @{ 'Accept' = 'application/json' }
        $feed = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
        break
    } catch {
        if ($try -eq 3) { throw }
        Start-Sleep -Seconds (3 * $try)
    }
}

$entries = @()
foreach ($team in $feed.injuries) { foreach ($x in $team.injuries) { $entries += $x } }

# A league with no injured player at all does not happen; an empty answer
# means the feed changed or broke. Keep the previous file rather than
# announcing that everybody is healthy.
if ($entries.Count -lt 10) { throw ("ESPN returned only {0} injuries -- refusing to overwrite." -f $entries.Count) }

$STATUS_CODE = @{ 'Injured Reserve' = 'IR'; 'Day-To-Day' = 'DTD'; 'Out' = 'OUT'; 'Suspension' = 'SUSP' }

$map = [ordered]@{}
$missed = @()
foreach ($x in $entries) {
    $nm   = [string]$x.athlete.displayName
    $abbr = [string]$x.athlete.team.abbreviation
    if ($ESPN_ABBR.ContainsKey($abbr)) { $abbr = $ESPN_ABBR[$abbr] }

    $cands = @($byName[(Fold $nm)])
    $hit = @($cands | Where-Object { $_ -and [string]$_.t -eq $abbr })
    if ($hit.Count -eq 0 -and $cands.Count -eq 1 -and $cands[0]) { $hit = $cands }
    if ($hit.Count -ne 1) { $missed += ("{0} ({1})" -f $nm, $abbr); continue }

    $status = [string]$x.status
    $code   = if ($STATUS_CODE.ContainsKey($status)) { $STATUS_CODE[$status] } else { $status }
    $note   = ([string]$x.shortComment).Trim()
    # ESPN sometimes fills the note with the bare status ("out", "ir",
    # "day-to-day") -- that says nothing the badge does not already say.
    if ($note -match '^(?i)(out|ir|day-to-day|suspension|injured reserve)\.?$') { $note = '' }

    $date = [string]$x.date
    if ($date.Length -ge 10) { $date = $date.Substring(0, 10) }

    $map[[string]$hit[0].i] = [ordered]@{ s = $code; d = $date; c = $note }
}

# ---- write only when the list changed ----------------------------------------
$listJson = $map | ConvertTo-Json -Depth 4 -Compress
if (Test-Path $out) {
    $old = [System.IO.File]::ReadAllText($out, [Text.Encoding]::UTF8)
    try {
        $prev = ($old.Substring($old.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json
        if (($prev.players | ConvertTo-Json -Depth 4 -Compress) -eq ($listJson | ConvertFrom-Json | ConvertTo-Json -Depth 4 -Compress)) {
            Say ("Unchanged: {0} players listed" -f $map.Count) 'DarkGray'
            exit 0
        }
    } catch { }   # unreadable old file: just rewrite it
}

$payload = [ordered]@{
    season  = $Season
    label   = $label
    updated = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    source  = 'ESPN'
    players = $map
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
$body = "/* Generated by build-injuries.ps1 from ESPN's injury feed -- do not edit by hand. */" +
        [Environment]::NewLine + "window.NHL_INJURIES = " + $json + ";" + [Environment]::NewLine
[System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding $false))

Say ''
Say ("Wrote {0}" -f $out) 'Green'
Say ("  {0} of {1} injuries matched to NHL players" -f $map.Count, $entries.Count)
# players.js holds everyone who has played plus every DRAFTED player
# (refresh-players.ps1, step 3b), so these are undrafted players who have
# not dressed yet this season -- harmless for the pool.
if ($missed.Count) { Say ("  not in players.js (undrafted, no game yet): {0}" -f ($missed -join ', ')) 'DarkGray' }
