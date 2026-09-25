<#
.SYNOPSIS
    Genere un jeton par pooleur, et l'empreinte a deposer dans Firestore.

.DESCRIPTION
    Chaque pooleur recoit un jeton personnel -- deux mots et quatre chiffres,
    lisibles au telephone et faciles a retaper. Le site n'envoie jamais le
    jeton : il envoie sha256(jeton + nom), et les regles comparent cette
    empreinte a celle rangee dans /secrets/<nom>.

    LE SEL EST LE NOM. sha256("quartz-4417|Steve T.") ne vaut pas pour
    Pascal, meme si par malheur les deux tiraient le meme jeton.

    Ce script produit DEUX sorties :

      jetons-a-distribuer.txt   ce que chaque pooleur doit recevoir.
                                A NE PAS COMMITER -- le .gitignore s'en charge.

      jetons-firestore.json     les empreintes, a importer dans /secrets.
                                Sans danger : une empreinte ne se remonte pas
                                jusqu'au jeton.

    Relancer le script regenere TOUT : les anciens jetons cessent alors de
    fonctionner. Pour n'en changer qu'un, employer -Pooleur "Steve T.".

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-jetons.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\build-jetons.ps1 -Pooleur "Steve T."
#>

[CmdletBinding()]
param(
    [string] $Season  = '',
    [string] $Pooleur = '',
    [switch] $Quiet
)

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
. (Join-Path $root 'season-path.ps1')

function Say([string] $m, [string] $c = 'Gray') { if (-not $Quiet) { Write-Host $m -ForegroundColor $c } }

# La saison courante, sauf indication contraire : c'est elle qui porte la
# liste des pooleurs qui jouent.
if ([string]::IsNullOrWhiteSpace($Season)) {
    $idxFile = Join-Path (Join-Path $root 'data') 'seasons.js'
    if (-not (Test-Path $idxFile)) { throw 'data/seasons.js introuvable.' }
    $txt = [System.IO.File]::ReadAllText($idxFile, [Text.Encoding]::UTF8)
    $json = ($txt.Substring($txt.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json
    $label = $json.current
    if (-not $label) { throw 'Aucune saison courante dans data/seasons.js.' }
    # « 2026-27 » -> « 20262027 » : l'identifiant attendu par Get-SeasonLabel.
    $an = [int]$label.Substring(0, 4)
    $Season = '{0}{1}' -f $an, ($an + 1)
}
$label = Get-SeasonLabel -Season $Season

# Les pooleurs viennent du pool publie : meme graphie que dans le menu du
# site, donc meme nom de document dans Firestore.
$poolPath = Join-Path (Join-Path (Join-Path $root 'data') $label) 'pool.js'
if (-not (Test-Path $poolPath)) { throw "Introuvable : $poolPath" }
$pj = [System.IO.File]::ReadAllText($poolPath, [Text.Encoding]::UTF8)
$pool = ($pj.Substring($pj.IndexOf('{')) -replace ';\s*$', '') | ConvertFrom-Json
$noms = @($pool.poolers | ForEach-Object { [string]$_.name })
if ($Pooleur) {
    $noms = @($noms | Where-Object { $_ -eq $Pooleur })
    if ($noms.Count -eq 0) { throw "Pooleur introuvable dans $label : $Pooleur" }
}
Say ("Saison {0} : {1} pooleur(s)" -f $label, $noms.Count) 'Cyan'

# Des mots courts et sans ambiguite a l'oral : ni I/l, ni O/0.
$MOTS = @('quartz','bison','cedre','tundra','rafale','granit','huard','brume',
          'pinson','sable','vertige','banquise','erable','caribou','fjord',
          'lynx','mesange','torrent','glacier','saphir')

function Nouveau-Jeton {
    $m = $MOTS | Get-Random
    $n = Get-Random -Minimum 1000 -Maximum 9999
    '{0}-{1}' -f $m, $n
}

function Empreinte([string] $jeton, [string] $nom) {
    # Le meme calcul que la page : sha256(jeton + '|' + nom), en hexadecimal.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($jeton + '|' + $nom)
        ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
    } finally { $sha.Dispose() }
}

$aDistribuer = New-Object System.Collections.ArrayList
$secrets = [ordered]@{}

foreach ($nom in $noms) {
    $jeton = Nouveau-Jeton
    $emp   = Empreinte $jeton $nom
    [void]$aDistribuer.Add([pscustomobject]@{ Pooleur = $nom; Jeton = $jeton })
    $secrets[$nom] = [ordered]@{ preuve = $emp }
    Say ("  {0,-16} {1}" -f $nom, $jeton) 'Green'
}

# ---- Ce que Yanick distribue -------------------------------------------
$outTxt = Join-Path $root 'jetons-a-distribuer.txt'
$lignes = New-Object System.Collections.ArrayList
[void]$lignes.Add("Jetons du pool -- saison $label")
[void]$lignes.Add("Genere le $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
[void]$lignes.Add('')
[void]$lignes.Add('A transmettre a chacun EN PRIVE. Ce fichier ne doit pas etre commite.')
[void]$lignes.Add('Le pooleur le tape une seule fois : son navigateur le retient ensuite.')
[void]$lignes.Add('')
foreach ($r in $aDistribuer) { [void]$lignes.Add(('{0,-16} {1}' -f $r.Pooleur, $r.Jeton)) }
[System.IO.File]::WriteAllLines($outTxt, $lignes, (New-Object System.Text.UTF8Encoding $false))

# ---- Ce qui monte dans Firestore ---------------------------------------
$outJson = Join-Path $root 'jetons-firestore.json'
($secrets | ConvertTo-Json -Depth 5) |
    Set-Content -LiteralPath $outJson -Encoding utf8

Say ''
Say "A distribuer : $outTxt" 'Yellow'
Say "A importer   : $outJson  (collection /secrets)" 'Yellow'
Say ''
Say 'Dans la console Firebase > Firestore > collection « secrets » :' 'Gray'
Say '  un document par pooleur, nomme exactement comme dans le pool,' 'Gray'
Say '  avec un seul champ « preuve » (texte) = la valeur du JSON.' 'Gray'
