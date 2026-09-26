<#
.SYNOPSIS
    Turns data/<saison>/regles.txt into data/<saison>/regles.js.

.DESCRIPTION
    The rules are typed by hand, one section per topic. A page cannot read a
    .txt from file:// -- fetch() of a local file is CORS-blocked -- so they
    ship as JS like every other data file.

    TWO DIALECTS are accepted on purpose, because the files were written at
    different times and rewriting history would be worse than parsing it:

        1re position   $500 + 1/4 Ballotage      (les anciens fichiers)
        1re position = 600$                      (le modele actuel)

    Same for the position penalties, which appear either as a prose line
    ("La 6e position devra payer 10$ supplementaires") or as "6e = 10$".

    Anything the file does not say is simply absent from the output; the page
    then hides that block rather than inventing a number.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-rules.ps1
#>

[CmdletBinding()]
param(
    [string] $Season = '',
    [switch] $All,
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
. (Join-Path $root 'season-path.ps1')

function Say([string] $m, [string] $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }

# Which seasons to build.
$targets = @()
if ($All -or [string]::IsNullOrWhiteSpace($Season)) {
    foreach ($d in (Get-ChildItem (Join-Path $root 'data') -Directory | Sort-Object Name)) {
        if ($d.Name -notmatch '^\d{4}-\d{2}$') { continue }
        if (-not (Test-Path (Join-Path $d.FullName 'regles.txt'))) { continue }
        $yr = [int]$d.Name.Substring(0, 4)
        $targets += ('{0}{1}' -f $yr, ($yr + 1))
    }
    if (-not $All -and $Season) { $targets = @($Season) }
} else {
    $targets = @($Season)
}
if ($targets.Count -eq 0) { throw 'No data/<saison>/regles.txt found.' }

function Get-Amount([string] $text) {
    # "$500", "500$", "2.85$" -> 500 / 2.85
    if ($text -match '\$\s*([\d]+(?:[.,]\d+)?)') { return [double]($Matches[1] -replace ',', '.') }
    if ($text -match '([\d]+(?:[.,]\d+)?)\s*\$') { return [double]($Matches[1] -replace ',', '.') }
    # "Total = 208" -- un montant nu, sans le signe. Le bloc Repas de
    # regles.txt s'ecrit ainsi dans son propre commentaire, et un total
    # silencieusement perdu affichait un point d'interrogation comme si
    # le repas n'avait pas eu lieu. Ne se declenche que faute de "$".
    if ($text -match '=\s*([\d]+(?:[.,]\d+)?)\s*$') { return [double]($Matches[1] -replace ',', '.') }
    return $null
}

foreach ($sid in $targets) {
    $label = Get-SeasonLabel -Season $sid
    $src   = Join-Path (Join-Path (Join-Path $root 'data') $label) 'regles.txt'
    if (-not (Test-Path $src)) { Say ("  {0} : pas de regles.txt" -f $label) 'Yellow'; continue }

    $lines = (Get-Content -LiteralPath $src -Encoding UTF8)
    $section = ''
    $cot = [ordered]@{}
    $bourses = New-Object System.Collections.ArrayList
    $penalites = New-Object System.Collections.ArrayList
    $ballottage = [ordered]@{}
    $repas = [ordered]@{}
    $poolers = $null

    foreach ($raw in $lines) {
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        $line = $raw.Trim()
        if ($line.StartsWith('#')) { continue }

        # Les anciens fichiers rangent le bareme des penalites sous
        # « Reglements », annonce par « Au classement final ». Cette ligne
        # vaut donc un changement de section.
        if ($line -match '(?i)^Au classement final') { $section = 'Penalites'; continue }

        # A section header sits at the left margin.
        if ($raw -notmatch '^\s' -and $line -notmatch '=') {
            $section = $line
            continue
        }
        if ($raw -notmatch '^\s' -and $line -match '^Saison\b') { $section = $line; continue }

        switch -Regex ($section) {
            '^Saison' {
                if ($line -match '(?i)^Pooleurs\s*=\s*(\d+)') { $poolers = [int]$Matches[1] }
            }
            '(?i)^Cotisation' {
                if ($line -match '(?i)^Pool\s*=') { $cot['pool'] = Get-Amount $line }
                elseif ($line -match '(?i)^PoolExpert\s*=') { $cot['poolexpert'] = Get-Amount $line }
                elseif ($line -match '(?i)^Trade\s*=') { $cot['parTrade'] = Get-Amount $line }
                elseif ($line -match '(?i)^Trades inclus\s*=\s*(\d+)') { $cot['trades'] = [int]$Matches[1] }
                elseif ($line -match '(?i)^Pizza\s*=') {
                    # Trois etats, pas deux. « Pizza = 3.31$ » donne un
                    # montant ; « Pizza = » sans chiffre dit que la part
                    # existe mais que le prix n'est pas encore connu -- la
                    # page doit montrer la colonne avec un tiret plutot que
                    # de la masquer ; pas de ligne du tout, pas de colonne.
                    $m = Get-Amount $line
                    if ($null -ne $m) { $cot['pizza'] = $m }
                    else { $cot['pizzaAVenir'] = $true }
                }
            }
            '(?i)^Bourse' {
                if ($line -match '(?i)^(\d+)(?:re|e|ère|ere)?\s*position') {
                    $m = Get-Amount $line
                    if ($null -ne $m) {
                        [void]$bourses.Add([ordered]@{
                            rang = [int]$Matches[1]
                            montant = $m
                            ballottage = [bool]($line -match '(?i)ballot')
                        })
                    }
                }
            }
            '(?i)penalit' {
                # "6e = 10$"  ou  "La 6e position devra payer 10$ supplementaires"
                if ($line -match '(?i)(\d+)(?:e|re|ère|ere)\s*(?:position)?') {
                    $rang = [int]$Matches[1]
                    $m = Get-Amount $line
                    if ($line -match "(?i)n'a rien|rien . payer") { $m = 0 }
                    if ($null -ne $m) {
                        [void]$penalites.Add([ordered]@{ rang = $rang; montant = $m })
                    }
                }
            }
            '(?i)^Ballottage' {
                if     ($line -match '(?i)^Maximum\s*=\s*(\d+)')  { $ballottage['max'] = [int]$Matches[1] }
                elseif ($line -match '(?i)maximum de (\d+) joueur') { $ballottage['max'] = [int]$Matches[1] }
                if     ($line -match "(?i)^Date limite\s*=\s*(.+)") { $ballottage['limite'] = $Matches[1].Trim() }
                elseif ($line -match "(?i)jusqu'au (.+?)\.?\s*$")   { $ballottage['limite'] = $Matches[1].Trim() }
                if     ($line -match '(?i)^Cout\s*=')              { $ballottage['cout'] = Get-Amount $line }
                elseif ($line -match '(?i)co.te (\d+)\$ au particip') { $ballottage['cout'] = [double]$Matches[1] }
            }
            '(?i)^Repas' {
                if     ($line -match '(?i)^Total\s*=\s*(.+)')        { $repas['total'] = Get-Amount $line }
                elseif ($line -match '(?i)^Divise entre\s*=\s*(\d+)') { $repas['parts'] = [int]$Matches[1] }
                elseif ($line -match '(?i)^Budget penalites\s*=') {
                    # Les penalites paient la bouffe : ce que le pot couvre
                    # se soustrait du total avant de diviser. Ligne vide =
                    # on calcule le pot de la saison PRECEDENTE (voir plus
                    # bas) ; un montant ecrit ici le remplace.
                    $m = Get-Amount $line
                    if ($null -ne $m) { $repas['budget'] = $m }
                }
            }
        }
    }

    # Le repas : « Les penalites paient la bouffe du repechage ». Le pot
    # vient de la saison QUI VIENT DE FINIR, pas de celle qui commence : les
    # penalites de 2026-27 ne seront percues qu'en 2027, des mois apres le
    # repas du repechage de 2026. C'est l'argent de 2025-26 qui paie la
    # bouffe de 2026-27. Seul le reste se divise entre les pooleurs.
    #
    # Deux sources, exactement celles que la page Finances additionne :
    # les penalites de position (le bareme de cette saison-la, tous les
    # rangs ayant ete occupes) et les penalites de trade -- 10 $ par joueur
    # acquis qui ne finit pas dans les dix qui comptent, drapeau « counted:
    # false » pose par build-trades.ps1.
    #
    # La part derivee ne remplace jamais un « Pizza = » ecrit a la main dans
    # Cotisations : celui-la reste la source de verite.
    if ($repas['total']) {
        if ($null -eq $repas['budget']) {
            # La saison precedente : 20262027 -> 20252026.
            $an   = [int]$sid.Substring(0, 4)
            $prev = '{0}{1}' -f ($an - 1), $an
            $repas['budgetSaison'] = Get-SeasonLabel -Season $prev

            $pos = 0
            $tp  = 0
            $ok  = $false

            # Le bareme des penalites de position de la saison precedente.
            $rf = Get-SeasonPath -Root $root -Season $prev -Name 'regles'
            $parT = 0
            if (Test-Path $rf) {
                try {
                    $txt = [IO.File]::ReadAllText($rf, [Text.Encoding]::UTF8)
                    $k   = $txt.IndexOf('{')
                    if ($k -ge 0) {
                        $rj = $txt.Substring($k).TrimEnd() -replace ';\s*$', '' | ConvertFrom-Json
                        foreach ($pn in @($rj.penalites)) {
                            if ($null -ne $pn) { $pos += [double]$pn.montant }
                        }
                        if ($rj.cotisation -and $rj.cotisation.parTrade) {
                            $parT = [double]$rj.cotisation.parTrade
                        }
                        $ok = $true
                    }
                } catch {
                    Write-Warning ("  {0} : regles.js de {1} illisible" -f $label, $repas['budgetSaison'])
                }
            }

            # Les penalites de trade de cette meme saison precedente.
            $tf = Get-SeasonPath -Root $root -Season $prev -Name 'trades'
            if (Test-Path $tf) {
                try {
                    $txt = [IO.File]::ReadAllText($tf, [Text.Encoding]::UTF8)
                    $k   = $txt.IndexOf('{')
                    if ($k -ge 0) {
                        $tj = $txt.Substring($k).TrimEnd() -replace ';\s*$', '' | ConvertFrom-Json
                        foreach ($x in @($tj.trades)) {
                            if ($null -ne $x -and $x.counted -eq $false) { $tp += $parT }
                        }
                    }
                } catch {
                    Write-Warning ("  {0} : trades.js de {1} illisible, penalites de trade a 0" -f $label, $repas['budgetSaison'])
                }
            }

            # Pas de saison precedente sur le disque -- la premiere annee du
            # site, ou un dossier absent. Mieux vaut ne rien deriver que
            # diviser 208 $ par 12 comme si le pot etait vide : la page sait
            # afficher un point d'interrogation, elle ne sait pas deviner.
            if (-not $ok) {
                Write-Warning ("  {0} : pas de saison precedente ({1}) -- part du repas non calculee" -f $label, $repas['budgetSaison'])
                $repas.Remove('budgetSaison')
            } else {
                $repas['penPosition'] = $pos
                $repas['penTrade']    = $tp
                $repas['budget']      = $pos + $tp
            }
        }

        if ($null -ne $repas['budget']) {
            $reste = [double]$repas['total'] - [double]$repas['budget']
            if ($reste -lt 0) { $reste = 0 }   # le pot couvre tout le repas
            $repas['reste'] = [math]::Round($reste, 2)

            $parts = if ($repas['parts']) { [int]$repas['parts'] } else { $poolers }
            if ($parts -gt 0) {
                $repas['part'] = [math]::Round($reste / $parts, 2)
                if ($null -eq $cot['pizza'] -and -not $cot['pizzaAVenir']) {
                    $cot['pizza'] = $repas['part']
                }
            }
        }
    }

    # La cotisation totale versee au depart, quand on a de quoi la calculer.
    $verse = $null
    if ($cot['pool'] -and $cot['poolexpert']) {
        $nbT = if ($cot['trades']) { $cot['trades'] } else { 2 }
        $pt  = if ($cot['parTrade']) { $cot['parTrade'] } else { 0 }
        $verse = $cot['pool'] + $cot['poolexpert'] + $nbT * $pt
        if ($cot['pizza']) { $verse += $cot['pizza'] }
    }

    $payload = [ordered]@{
        season     = $sid
        label      = $label
        updated    = (Get-Date -Format 'yyyy-MM-dd HH:mm')
        poolers    = $poolers
        cotisation = $cot
        verse      = $verse
        bourses    = @($bourses | Sort-Object { $_.rang })
        penalites  = @($penalites | Sort-Object { $_.rang })
        ballottage = $ballottage
        repas      = $repas
    }
    $json = $payload | ConvertTo-Json -Depth 6 -Compress
    $out  = Get-SeasonPath -Root $root -Season $sid -Name 'regles'
    $body = "/* Generated by build-rules.ps1 from regles.txt -- do not edit by hand. */" +
            [Environment]::NewLine + "window.NHL_REGLES = " + $json + ";" + [Environment]::NewLine
    [System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding $false))

    Say ("{0} : {1} bourses, {2} penalites, pool {3}$" -f
         $label, $bourses.Count, $penalites.Count, $cot['pool']) 'Green'
}
