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
$trigger = New-ScheduledTaskTrigger -Daily -At $heure

# StartWhenAvailable : si le poste dormait a 4 h 30, la tache part au reveil
# plutot que d'etre sautee -- c'est le cas normal pour un poste de maison.
$params = New-ScheduledTaskSettingsSet -StartWhenAvailable `
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
Write-Host ''
Write-Host 'Pour la verifier :'
Write-Host '  Get-ScheduledTask -TaskName "Poolnews - mise a jour"'
Write-Host 'Pour la lancer tout de suite :'
Write-Host '  Start-ScheduledTask -TaskName "Poolnews - mise a jour"'
Write-Host 'Pour la retirer :'
Write-Host '  Unregister-ScheduledTask -TaskName "Poolnews - mise a jour" -Confirm:$false'
