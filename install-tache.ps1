# Cree la tache planifiee « Poolnews - mise a jour » dans Windows.
# A lancer UNE FOIS, en administrateur.

$nom    = 'Poolnews - mise a jour'
$script = 'Y:\HockeyPool\nightly.ps1'
$heure  = '04:30'

if (-not (Test-Path $script)) { throw "Introuvable : $script" }

# 4 h 30 : les matchs de la cote ouest finissent vers 1 h 30 heure de l'Est,
# et la LNH met un moment a publier les feuilles de match. A 4 h 30 tout est
# en place, et personne ne consulte le site a cette heure-la.
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument ('-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "{0}"' -f $script) `
             -WorkingDirectory 'Y:\HockeyPool'
# -RandomDelay appartient au DECLENCHEUR, pas aux parametres. Windows ne
# reveille pas a la seconde pres et le lecteur reseau Y: met un instant a
# repondre : deux minutes de marge evitent qu'update.ps1 parte avant lui.
$trigger = New-ScheduledTaskTrigger -Daily -At $heure -RandomDelay (New-TimeSpan -Minutes 2)

# StartWhenAvailable : si le poste dormait a 4 h 30, la tache part au reveil
# plutot que d'etre sautee -- c'est le cas normal pour un poste de maison.
# -WakeToRun : le planificateur sort la machine de veille pour la tache.
# Verifie au prealable sur ce poste : les minuteries de reveil sont permises
# (powercfg SUB_SLEEP RTCWAKE = 0x1) et la veille S3 comme l'hibernation sont
# disponibles. Sans ces deux conditions l'option serait acceptee sans effet.
#
# -StartWhenAvailable reste : si la machine etait eteinte -- pas en veille,
# vraiment eteinte -- aucun reveil n'est possible, et la tache se rattrape au
# prochain demarrage. C'est la ceinture en plus des bretelles.
$params = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
            -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
            -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
            -MultipleInstances IgnoreNew

# -LogonType S4U : la tache tourne meme sans session ouverte, sans qu'on ait
# a stocker de mot de passe. Les identifiants git du gestionnaire Windows
# restent accessibles, ce qui est ce que le push demande.
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
               -LogonType S4U -RunLevel Limited

if (Get-ScheduledTask -TaskName $nom -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nom -Confirm:$false
    Write-Host "ancienne tache remplacee" -ForegroundColor Yellow
}

Register-ScheduledTask -TaskName $nom -Action $action -Trigger $trigger `
    -Settings $params -Principal $principal `
    -Description 'Rafraichit les statistiques de la LNH, verifie, et publie sur GitHub Pages. Journal dans Y:\HockeyPool\logs\.' | Out-Null

Write-Host ''
Write-Host ("Tache creee : {0}, tous les jours a {1}" -f $nom, $heure) -ForegroundColor Green
Write-Host '  la machine se reveillera d elle-meme si elle est en veille' -ForegroundColor Green
Write-Host ''
Write-Host 'Pour la verifier :'
Write-Host '  Get-ScheduledTask -TaskName "Poolnews - mise a jour"'
Write-Host 'Pour la lancer tout de suite :'
Write-Host '  Start-ScheduledTask -TaskName "Poolnews - mise a jour"'
Write-Host 'Pour la retirer :'
Write-Host '  Unregister-ScheduledTask -TaskName "Poolnews - mise a jour" -Confirm:$false'
