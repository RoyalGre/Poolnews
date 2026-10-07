<#
.SYNOPSIS
    La mise a jour de la nuit : rafraichir les statistiques, verifier, publier.

.DESCRIPTION
    Ce que fait la tache planifiee, dans l'ordre :

      1. update.ps1   -- interroge la LNH, rebatit ce qui a change
      2. run-selftest -- les quatre suites, plus la navigation et les
                         etiquettes de cache
      3. git commit + push  -- seulement si 1 et 2 ont reussi

    REGLE DU JEU : on ne publie jamais sans avoir teste. Une nuit ou l'API
    renvoie des donnees aberrantes, ou un fichier se corrompt, le self-test
    echoue et rien ne part -- le site en ligne reste sur la derniere version
    saine. C'est tout l'interet de ne pas se contenter d'un « git push »
    automatique.

    RIEN A FAIRE LES NUITS SANS MATCH : update.ps1 sort en une seconde, le
    depot reste propre, et le script s'arrete sans rien publier.

    Le journal s'ecrit dans logs/nightly-AAAA-MM.log, un fichier par mois.
    Tout y passe, succes comme echec, avec l'heure -- c'est ce qu'on lit le
    matin ou quelque chose n'a pas marche.

.EXAMPLE
    # a la main, pour voir ce que ca donne sans rien publier
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\nightly.ps1 -DryRun

.EXAMPLE
    # ce que lance la tache planifiee
    powershell -ExecutionPolicy Bypass -File Y:\HockeyPool\nightly.ps1
#>

[CmdletBinding()]
param(
    # Tout faire sauf publier : utile pour essayer la chaine complete.
    [switch] $DryRun,
    # Publier meme si le self-test echoue. A n'employer qu'en connaissance
    # de cause, jamais depuis la tache planifiee.
    [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
Set-Location $root

# ---- Le journal ------------------------------------------------------------
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$logFile = Join-Path $logDir ('nightly-{0}.log' -f (Get-Date -Format 'yyyy-MM'))

function Note {
    param([string] $Msg, [string] $Colour = 'Gray')
    $ligne = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Msg
    Write-Host $ligne -ForegroundColor $Colour
    Add-Content -LiteralPath $logFile -Value $ligne -Encoding UTF8
}

# Un separateur par nuit : le journal mensuel reste lisible.
Add-Content -LiteralPath $logFile -Value '' -Encoding UTF8
Note '=== mise a jour de la nuit ===' 'Cyan'
if ($DryRun) { Note '    (essai : rien ne sera publie)' 'Yellow' }

$codeSortie = 0

try {
    # ---- 1. Les statistiques -----------------------------------------------
    Note 'statistiques : update.ps1'
    # Sans -Quiet : c'est precisement ce que update.ps1 raconte qu'on veut
    # retrouver dans le journal le matin ou quelque chose a cloche.
    # Pas de 2>&1 : powershell.exe est un exe natif comme git, et une ligne
    # sur stderr deviendrait une exception qui masquerait le vrai message.
    $sortie = & powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $root 'update.ps1')
    $rcUpdate = $LASTEXITCODE
    foreach ($l in $sortie) { Note ("    " + $l) 'DarkGray' }
    if ($rcUpdate -ne 0) { throw "update.ps1 a echoue (code $rcUpdate)" }

    # ---- 2. Y a-t-il seulement quelque chose a publier ? -------------------
    $modifs = @(& git status --porcelain)
    if ($modifs.Count -eq 0) {
        Note 'rien de neuf : aucun match depuis la derniere fois' 'Green'
        Note '=== fin ===' 'Cyan'
        exit 0
    }
    Note ("{0} fichier(s) modifie(s)" -f $modifs.Count)
    foreach ($m in $modifs) { Note ("    " + $m) 'DarkGray' }

    # ---- 3. Les tests ------------------------------------------------------
    if ($SkipTests) {
        Note 'self-test saute (-SkipTests)' 'Yellow'
    } else {
        Note 'verification : run-selftest.ps1'
        $t = & powershell -ExecutionPolicy Bypass -NoProfile -File (Join-Path $root 'run-selftest.ps1')
        $rcTest = $LASTEXITCODE
        if ($rcTest -ne 0) {
            # On garde TOUTE la sortie quand ca echoue : c'est le seul moment
            # ou on en a besoin, et c'est le matin qu'on la lira.
            foreach ($l in $t) { Note ("    " + $l) 'DarkGray' }
            throw "le self-test a echoue (code $rcTest) -- rien n'est publie"
        }
        $resume = @($t | Where-Object { $_ -match 'suites passed|ALL TESTS' } | Select-Object -Last 1)
        Note ("    " + ($resume -join ' ')) 'Green'
    }

    # ---- 4. Publier --------------------------------------------------------
    if ($DryRun) {
        Note 'essai : on s arrete ici, le depot garde ses modifications' 'Yellow'
        Note '=== fin ===' 'Cyan'
        exit 0
    }

    # Le message dit ce qui a change, pas juste « mise a jour » : un journal
    # de commits qui se repete n'apprend rien six mois plus tard.
    $quoi = @()
    if ($modifs -match 'players\.js')  { $quoi += 'pointages' }
    if ($modifs -match 'history\.js')  { $quoi += 'historique' }
    if ($modifs -match 'goals\.js')    { $quoi += 'buts' }
    if ($modifs -match 'advanced\.js') { $quoi += 'temps de jeu' }
    if ($modifs -match 'schedule\.js') { $quoi += 'calendrier' }
    $detail = if ($quoi.Count) { $quoi -join ', ' } else { 'donnees' }
    $msg = 'Mise a jour automatique : {0} ({1})' -f $detail, (Get-Date -Format 'yyyy-MM-dd')

    # git ecrit ses messages normaux sur stderr -- « Everything up-to-date »,
    # « To https://github.com/... ». Avec 2>&1 et ErrorActionPreference=Stop,
    # PowerShell 5.1 transforme chacune de ces lignes en exception : le push
    # reussissait et le script annoncait un echec. Le meme piege que celui
    # deja note pour Invoke-RestMethod ; il vaut pour tout exe natif.
    #
    # On capture donc la sortie SANS rediriger stderr, et on juge sur le code
    # de sortie -- la seule chose fiable.
    Note 'publication'
    & git add -A | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git add a echoue (code $LASTEXITCODE)" }

    $sortieCommit = & git commit -m $msg
    $rcCommit = $LASTEXITCODE
    foreach ($l in $sortieCommit) { Note ("    " + $l) 'DarkGray' }
    if ($rcCommit -ne 0) { throw "git commit a echoue (code $rcCommit)" }

    $sortiePush = & git push origin main
    $rcPush = $LASTEXITCODE
    foreach ($l in $sortiePush) { Note ("    " + $l) 'DarkGray' }
    if ($rcPush -ne 0) { throw "git push a echoue (code $rcPush)" }

    # Preuve que c'est bien parti : le commit local doit etre celui du distant.
    $local = (& git rev-parse HEAD).Trim()
    & git fetch origin --quiet
    $distant = (& git rev-parse origin/main).Trim()
    if ($local -ne $distant) {
        throw "le push semble avoir reussi mais origin/main est a $distant, pas a $local"
    }
    Note ('publie : ' + $msg) 'Green'
    Note ('    origin/main = ' + $local.Substring(0, 7)) 'DarkGray'
}
catch {
    Note ('ECHEC : ' + $_.Exception.Message) 'Red'
    Note '  le site en ligne reste sur la derniere version saine' 'Yellow'
    $codeSortie = 1
}

Note '=== fin ===' 'Cyan'
exit $codeSortie
