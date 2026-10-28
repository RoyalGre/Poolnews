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
# Les noms complets aussi : « 17 Octobre 2026 » est la premiere chose qu'on
# tape. Les accents sont retires avant la recherche (fevrier, aout, decembre).
$MOIS['janvier'] = 1; $MOIS['january'] = 1; $MOIS['fevrier'] = 2; $MOIS['february'] = 2
$MOIS['march'] = 3;   $MOIS['avril'] = 4;   $MOIS['april'] = 4;   $MOIS['june'] = 6
$MOIS['juillet'] = 7; $MOIS['july'] = 7;    $MOIS['aout'] = 8;    $MOIS['august'] = 8
$MOIS['septembre'] = 9; $MOIS['september'] = 9; $MOIS['octobre'] = 10; $MOIS['october'] = 10
$MOIS['novembre'] = 11; $MOIS['november'] = 11; $MOIS['decembre'] = 12; $MOIS['december'] = 12

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
            $mo = ($Matches[2].Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', '').ToLower()
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

# ---- resolve the names, apply the swaps, judge the top ten -----------------
# pool.js holds the rosters as drafted. Each trade is replayed on a copy, in
# date order, and the resulting ids go into trades.js so the pages apply the
# exact same swaps (core.js, applyTrades). Archived seasons whose pool.js
# already holds the final rosters come out unchanged: a swap whose incoming
# player is already on the roster is a no-op.
$poolPath    = Get-SeasonPath -Root $root -Season $Season -Name 'pool'
$playersPath = Get-SeasonPath -Root $root -Season $Season -Name 'players'
$scored = 0

function Fold([string] $s) {
    $n = $s.Normalize([Text.NormalizationForm]::FormD)
    ($n -replace '\p{Mn}', '').ToLower().Trim()
}

# Distance de Levenshtein simplifiee : proportion de caracteres communs dans
# le meme ordre.
function Likeness([string] $want, [string] $f) {
    $common = 0; $j = 0
    foreach ($ch in $want.ToCharArray()) {
        $k = $f.IndexOf($ch, $j)
        if ($k -ge 0) { $common++; $j = $k + 1 }
    }
    $common / [Math]::Max($want.Length, $f.Length)
}

if ((Test-Path $poolPath) -and (Test-Path $playersPath)) {
    $pj   = [System.IO.File]::ReadAllText($poolPath, [Text.Encoding]::UTF8)
    $pool = ($pj.Substring($pj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json
    $yj   = [System.IO.File]::ReadAllText($playersPath, [Text.Encoding]::UTF8)
    $pl   = ($yj.Substring($yj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json

    $byId = @{}
    foreach ($p in $pl.players) { $byId[[int]$p.i] = $p }
    $allFold = @($pl.players | ForEach-Object { [pscustomobject]@{ p = $_; f = (Fold $_.n) } })

    # Le fichier est tape a la main : « Barbachev » pour Barbashev, « Adam
    # fox » sans majuscule, parfois le nom de famille seul. On cherche d'abord
    # dans l'alignement du pooleur, ou douze joueurs laissent peu de place a
    # la confusion, puis dans toute la ligue -- au nom exact d'abord, au plus
    # proche ensuite, en le signalant.
    function Find-Player([string] $name, $roster) {
        $want = Fold $name
        $mine = @($roster | Where-Object { $null -ne $_ } | ForEach-Object { $byId[[int]$_] } |
                  Where-Object { $_ })
        $hit = @($mine | Where-Object { $f = Fold $_.n; $f -eq $want -or $f.EndsWith(' ' + $want) })
        if ($hit.Count -gt 0) { return $hit[0] }
        $hit = @($allFold | Where-Object { $_.f -eq $want })
        if ($hit.Count -gt 1) {
            Say ("  ! {0} : {1} joueurs portent ce nom, on prend celui qui a le plus de points" -f $name, $hit.Count) 'Yellow'
            $hit = @($hit | Sort-Object { -([int]$_.p.g + [int]$_.p.a) })
        }
        if ($hit.Count -gt 0) { return $hit[0].p }
        $best = $null; $bestScore = 0
        foreach ($p in $mine) {
            $s = Likeness $want (Fold $p.n)
            if ($s -gt $bestScore) { $bestScore = $s; $best = $p }
        }
        if ($bestScore -ge 0.8) { Say ("  ~ {0} -> {1}" -f $name, $best.n) 'DarkGray'; return $best }
        # « Valisy Podkolzin » : le prenom ecorche, le nom juste. Un nom de
        # famille porte par un seul joueur de la ligue suffit.
        $last = ($want -split '\s+')[-1]
        $hit = @($allFold | Where-Object { ($_.f -split '\s+')[-1] -eq $last })
        if ($hit.Count -eq 1) { Say ("  ~ {0} -> {1} (a verifier)" -f $name, $hit[0].p.n) 'Yellow'; return $hit[0].p }
        $best = $null; $bestScore = 0
        foreach ($x in $allFold) {
            $s = Likeness $want $x.f
            if ($s -gt $bestScore) { $bestScore = $s; $best = $x.p }
        }
        if ($bestScore -ge 0.85) { Say ("  ~ {0} -> {1} (a verifier)" -f $name, $best.n) 'Yellow'; return $best }
        return $null
    }

    $rosters = @{}
    foreach ($pooler in $pool.poolers) {
        $rosters[$pooler.name] = [System.Collections.ArrayList]@($pooler.picks | ForEach-Object { if ($null -eq $_) { $null } else { [int]$_ } })
    }

    foreach ($t in @($trades | Sort-Object { $_.date })) {
        # « Francois C. » y cotoie « François C. » du pool, et « Martin P. »
        # y designe « Martin Pr. ». On compare sans accents, et on accepte
        # qu'une abreviation soit le prefixe de l'autre.
        $ft = (Fold $t.pooler) -replace '[^a-z]', ''
        $who = @($pool.poolers | Where-Object {
            $fp = (Fold $_.name) -replace '[^a-z]', ''
            $ft -eq $fp -or $fp.StartsWith($ft) -or $ft.StartsWith($fp)
        })
        # « Frederic D. » pour « Frederick D. » : douze noms seulement, le plus
        # proche gagne s'il est tres proche, et on le signale.
        if ($who.Count -eq 0) {
            $best = $null; $bestScore = 0
            foreach ($p in $pool.poolers) {
                $s = Likeness $ft ((Fold $p.name) -replace '[^a-z]', '')
                if ($s -gt $bestScore) { $bestScore = $s; $best = $p }
            }
            if ($bestScore -ge 0.8) {
                Say ("  ~ {0} -> {1}" -f $t.pooler, $best.name) 'Yellow'
                $who = @($best)
            }
        }
        if ($who.Count -eq 0) { Say ("  ! pooleur inconnu : {0}" -f $t.pooler) 'Yellow'; continue }
        $t.pooler = [string]$who[0].name   # graphie canonique
        $roster   = $rosters[$t.pooler]

        $o = Find-Player $t.out $roster
        $i = Find-Player $t.joueur $roster
        if (-not $o) { Say ("  ! joueur sortant introuvable : {0} ({1})" -f $t.out, $t.pooler) 'Yellow' }
        if (-not $i) { Say ("  ! joueur entrant introuvable : {0} ({1})" -f $t.joueur, $t.pooler) 'Yellow' }
        if ($o) { $t.outId = [int]$o.i; $t.out = [string]$o.n }
        if ($i) { $t.inId  = [int]$i.i; $t.player = [string]$i.n }
        if (-not ($o -and $i)) { continue }

        # Un joueur n'appartient qu'a un pooleur : un nom mal tape qui tombe
        # sur le joueur d'un autre se verrait ici, pas dans la page.
        foreach ($other in $rosters.Keys) {
            if ($other -ne $t.pooler -and ($rosters[$other] -contains [int]$i.i)) {
                Say ("  ! {0} appartient deja a {1} (echange de {2})" -f $i.n, $other, $t.pooler) 'Red'
            }
        }

        $k = $roster.IndexOf([int]$o.i)
        $already = $roster -contains [int]$i.i
        if ($k -ge 0 -and -not $already) { $roster[$k] = [int]$i.i }
        elseif (-not $already) { Say ("  ! {0} n'est pas dans l'alignement de {1}" -f $o.n, $t.pooler) 'Yellow' }
    }

    foreach ($pooler in $pool.poolers) {
        $rows = @()
        foreach ($id in $rosters[$pooler.name]) {
            if ($null -eq $id) { continue }
            $p = $byId[[int]$id]
            if (-not $p) { continue }
            $rows += [pscustomobject]@{
                i   = [int]$p.i
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
        $topIds = @($top | ForEach-Object { $_.i })

        foreach ($t in $trades) {
            if ($t.pooler -ne $pooler.name -or -not $t.Contains('inId')) { continue }
            $hit = @($rows | Where-Object { $_.i -eq $t.inId })
            if ($hit.Count -eq 0) { continue }   # reparti dans un echange suivant
            $t.pts     = [int]$hit[0].pts
            $t.counted = [bool]($topIds -contains $t.inId)
            $scored++
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
