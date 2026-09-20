<#
.SYNOPSIS
    Turns data/<saison>/trades.txt into data/<saison>/trades.js.

.DESCRIPTION
    The trades are typed by hand during the season, one indented block per
    pooler. A page cannot read a .txt from file:// -- fetch() of a local file
    is CORS-blocked -- so the list ships as JS like every other data file.

    The script also resolves each incoming player against the season's final
    rosters and marks those who did NOT finish in their pooler's counting ten.
    That is the 10 $ penalty in the rules, and computing it once here beats
    re-deriving it in the page on every load.

    Line shape, matched loosely because it is handwritten:

        Pooleur X.
            Out <sortant> In <entrant> (12 jan 2026)

    A trailing "in", mixed-case months, French or English abbreviations and a
    stray second "Out" all appear in the real file and are all tolerated.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-trades.ps1
#>

[CmdletBinding()]
param(
    [string] $Season = '',
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

. (Join-Path $root 'season-path.ps1')

function Say([string] $m, [string] $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }

# Default to the newest season that actually has a trades.txt.
if ([string]::IsNullOrWhiteSpace($Season)) {
    $found = Get-ChildItem (Join-Path $root 'data') -Directory |
             Where-Object { $_.Name -match '^\d{4}-\d{2}$' -and
                            (Test-Path (Join-Path $_.FullName 'trades.txt')) } |
             Sort-Object Name -Descending | Select-Object -First 1
    if (-not $found) { throw 'No data/<saison>/trades.txt found.' }
    $yr = [int]$found.Name.Substring(0, 4)
    $Season = '{0}{1}' -f $yr, ($yr + 1)
}
$label = Get-SeasonLabel -Season $Season
$src   = Join-Path (Join-Path (Join-Path $root 'data') $label) 'trades.txt'
$out   = Get-SeasonPath -Root $root -Season $Season -Name 'trades'
if (-not (Test-Path $src)) { throw "Cannot find $src" }

Say ("Season {0}" -f $label) 'Cyan'

# French and English month abbreviations, as actually typed in the file.
$MOIS = @{}
$MOIS['jan'] = 1;  $MOIS['janv'] = 1;  $MOIS['fev'] = 2;  $MOIS['feb'] = 2
$MOIS['mar'] = 3;  $MOIS['mars'] = 3;  $MOIS['avr'] = 4;  $MOIS['apr'] = 4
$MOIS['mai'] = 5;  $MOIS['may'] = 5;   $MOIS['jun'] = 6;  $MOIS['juin'] = 6
$MOIS['jul'] = 7;  $MOIS['juil'] = 7;  $MOIS['aou'] = 8;  $MOIS['aug'] = 8
$MOIS['sep'] = 9;  $MOIS['sept'] = 9;  $MOIS['oct'] = 10; $MOIS['nov'] = 11
$MOIS['dec'] = 12

$text  = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
$lines = $text -split "`r?`n"

$trades  = New-Object System.Collections.ArrayList
$current = $null

foreach ($raw in $lines) {
    if ([string]::IsNullOrWhiteSpace($raw)) { continue }
    $line = $raw.Trim()
    if ($line -match '^Trade\b') { continue }          # the file's own title
    if ($line.StartsWith('#')) { continue }            # commentaire du modele

    # A trade line always carries "Out ... In ...". Anything else at this
    # indentation is a pooler name.
    if ($line -match '(?i)\bOut\b\s+(.+?)\s+\b(?:Out|In)\b\s+(.+?)\s*\(([^)]+)\)') {
        $outName = $Matches[1].Trim()
        $inName  = $Matches[2].Trim()
        $dateRaw = $Matches[3].Trim()

        # A trailing " in" happens ("Marcus Johansson in") -- drop it.
        $inName = [regex]::Replace($inName, '(?i)\s+in$', '')

        $iso = ''
        if ($dateRaw -match '^(\d{1,2})\s+([A-Za-z\u00C0-\u00FF]+)\.?\s+(\d{4})$') {
            $dd = [int]$Matches[1]
            $mo = $Matches[2].ToLower()
            $yy = [int]$Matches[3]
            if ($MOIS.ContainsKey($mo)) {
                $iso = '{0:d4}-{1:d2}-{2:d2}' -f $yy, $MOIS[$mo], $dd
            }
        }
        if (-not $iso) { Say ("  ! date illisible : {0}" -f $dateRaw) 'Yellow' }
        if (-not $current) { Say ("  ! trade sans pooleur : {0}" -f $line) 'Yellow'; continue }

        $row = [ordered]@{
            pooler  = $current
            out     = $outName
            joueur  = $inName
            date    = $iso
            dateTxt = $dateRaw
        }
        [void]$trades.Add($row)
    } else {
        $current = $line.TrimEnd()
    }
}

# Un fichier sans trade est normal en debut de saison : on ecrit quand meme,
# pour que la page affiche l'absence de transaction plutot que rien du tout.
if ($trades.Count -eq 0) { Say '  aucun trade pour l''instant' 'Yellow' }

# ---- did the incoming player count in that pooler's top ten? ---------------
$poolPath    = Get-SeasonPath -Root $root -Season $Season -Name 'pool'
$playersPath = Get-SeasonPath -Root $root -Season $Season -Name 'players'
$scored = 0

function Fold([string] $s) {
    $n = $s.Normalize([Text.NormalizationForm]::FormD)
    ($n -replace '\p{Mn}', '').ToLower().Trim()
}

if ((Test-Path $poolPath) -and (Test-Path $playersPath)) {
    $pj   = [System.IO.File]::ReadAllText($poolPath, [Text.Encoding]::UTF8)
    $pool = ($pj.Substring($pj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json
    $yj   = [System.IO.File]::ReadAllText($playersPath, [Text.Encoding]::UTF8)
    $pl   = ($yj.Substring($yj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json

    $byId = @{}
    foreach ($p in $pl.players) { $byId[[int]$p.i] = $p }

    foreach ($pooler in $pool.poolers) {
        $rows = @()
        foreach ($id in $pooler.picks) {
            if ($null -eq $id) { continue }
            $p = $byId[[int]$id]
            if (-not $p) { continue }
            $rows += [pscustomobject]@{
                n   = [string]$p.n
                pos = [string]$p.p
                pts = [int]$p.g + [int]$p.a
            }
        }
        if ($rows.Count -eq 0) { continue }
        $rows = @($rows | Sort-Object -Property @{Expression='pts';Descending=$true}, n)
        $top  = @($rows | Select-Object -First 10)
        if (-not ($top | Where-Object { $_.pos -eq 'D' })) {
            $d = @($rows | Where-Object { $_.pos -eq 'D' } | Select-Object -First 1)
            if ($d.Count -gt 0) { $top = @($rows | Select-Object -First 9) + $d }
            else                { $top = @($rows | Select-Object -First 9) }
        }
        $topFold = @($top | ForEach-Object { Fold $_.n })

        foreach ($t in $trades) {
            # Le fichier est tape a la main : « Francois C. » y cotoie
            # « Francois C. » du pool, et « Martin P. » y designe
            # « Martin Pr. ». On compare sans accents, et on accepte qu'une
            # abreviation soit le prefixe de l'autre.
            $ft = (Fold $t.pooler) -replace '[^a-z]', ''
            $fp = (Fold $pooler.name) -replace '[^a-z]', ''
            if ($ft -ne $fp -and -not $fp.StartsWith($ft) -and -not $ft.StartsWith($fp)) { continue }
            $want = Fold $t.joueur
            $hit = @($rows | Where-Object {
                $f = Fold $_.n
                $f -eq $want -or $f.EndsWith($want) -or $want.EndsWith($f)
            })
            # Le fichier est tape a la main : « Barbachev » pour Barbashev,
            # « Marchement » pour Marchment. Plutot que d'echouer en silence,
            # on retombe sur le nom le plus proche de l'alignement -- qui ne
            # compte que douze joueurs, donc le risque de confusion est nul.
            if ($hit.Count -eq 0) {
                $best = $null; $bestScore = 0
                foreach ($r in $rows) {
                    $f = Fold $r.n
                    # Distance de Levenshtein simplifiee : proportion de
                    # caracteres communs dans le meme ordre.
                    $common = 0; $j = 0
                    foreach ($ch in $want.ToCharArray()) {
                        $k = $f.IndexOf($ch, $j)
                        if ($k -ge 0) { $common++; $j = $k + 1 }
                    }
                    $score = $common / [Math]::Max($want.Length, $f.Length)
                    if ($score -gt $bestScore) { $bestScore = $score; $best = $r }
                }
                if ($bestScore -ge 0.8) {
                    $hit = @($best)
                    Say ("  ~ {0} -> {1}" -f $t.joueur, $best.n) 'DarkGray'
                }
            }
            if ($hit.Count -gt 0) {
                $t.player  = [string]$hit[0].n
                $t.pts     = [int]$hit[0].pts
                $t.counted = [bool]($topFold -contains (Fold $hit[0].n))
                $t.pooler  = [string]$pooler.name   # graphie canonique
                $scored++
            }
        }
    }
}

$penalites = 0
foreach ($t in $trades) {
    if ($t.Contains('counted') -and -not $t.counted) { $penalites++ }
}

$payload = [ordered]@{
    season  = $Season
    label   = $label
    updated = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    trades  = @($trades | Sort-Object { $_.date })
}
$json = $payload | ConvertTo-Json -Depth 6 -Compress
$body = "/* Generated by build-trades.ps1 from trades.txt -- do not edit by hand. */" +
        [Environment]::NewLine + "window.NHL_TRADES = " + $json + ";" + [Environment]::NewLine
[System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding $false))

Say ''
Say ("Wrote {0}" -f $out) 'Green'
Say ("  {0} trades, {1} joueurs retrouves, {2} penalites" -f $trades.Count, $scored, $penalites)
