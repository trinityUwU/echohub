#Requires -Version 5.1
<#
.SYNOPSIS
    EchoHub — installation Windows automatique (WSL2 + Docker Desktop + GPU NVIDIA).

.DESCRIPTION
    Prepare un poste Windows 11 neuf pour EchoHub sans intervention manuelle : elevation
    administrateur auto, installation de ce qui manque (WSL2, une distribution Linux,
    Docker Desktop), verification du pilote NVIDIA cote Windows, reprise automatique apres
    le redemarrage impose par WSL2, puis lancement de .\start.ps1.

    Cible : Windows 11 + RTX 5090 (Blackwell, sm_120). Voir README.md section Windows pour
    ce qui a ete verifie (parsing + execution simulee en conteneur PowerShell jetable) et ce
    qui ne l'a pas ete (aucune machine Windows/RTX 5090 disponible pour ce mandat).

.USAGE
    Clic droit > Executer avec PowerShell, ou depuis un terminal :
        .\setup-windows.ps1
    Le script se relance lui-meme en administrateur si necessaire.
#>

[CmdletBinding()]
param(
    [int]$DockerReadyTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# ── Sortie (meme style que start.ps1/stop.ps1) ───────────────────────────────
function Write-Step { param([string]$Message) Write-Host "`n▶ $Message" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Message) Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Warn  { param([string]$Message) Write-Host "  [!]  $Message" -ForegroundColor Yellow }
function Write-Err   { param([string]$Message) Write-Host "  [X]  $Message" -ForegroundColor Red }

function Exit-WithGuidance {
    param([string]$Reason, [string[]]$Guidance)
    Write-Err $Reason
    foreach ($line in $Guidance) { Write-Host "       $line" -ForegroundColor Yellow }
    exit 1
}

# ── Etat persistant entre redemarrages ────────────────────────────────────────
# ProgramData (et non le depot) : survit a un redemarrage quel que soit l'utilisateur qui
# rouvre la session, et un admin peut l'inspecter/le nettoyer sans toucher au depot git.
$StateDir  = Join-Path $env:ProgramData 'EchoHubSetup'
$StateFile = Join-Path $StateDir 'state.json'
$TaskName  = 'EchoHubSetupResume'

function Get-SetupState {
    if (Test-Path $StateFile) {
        try { return (Get-Content $StateFile -Raw | ConvertFrom-Json) } catch { }
    }
    return [pscustomobject]@{ WslDone = $false; DockerInstalled = $false }
}

function Save-SetupState {
    param($State)
    if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }
    $State | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

# ── Elevation admin auto ───────────────────────────────────────────────────────
function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Write-Host "Droits administrateur requis — relance automatique en cours..." -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -Verb RunAs | Out-Null
    exit
}

# ── Reprise apres redemarrage : mecanisme retenu ──────────────────────────────
# Tache planifiee (schtasks /SC ONLOGON /RL HIGHEST), pas une cle RunOnce. Deux raisons :
# (1) Docker Desktop est une appli graphique qui a besoin d'une session utilisateur
#     interactive pour demarrer — une tache HKLM\...\RunOnce (executee par SYSTEM avant
#     l'ouverture de session) ne le peut pas ; ONLOGON s'execute bien dans la session de
#     l'utilisateur qui se reconnecte, comme HKCU\...\RunOnce, mais reste visible et
#     supprimable via Get-ScheduledTask / schtasks, alors que RunOnce est un motif que
#     nombre d'AV/EDR traitent comme suspect (persistance) et purgent parfois seuls.
# (2) Aucune connexion automatique n'est configuree (autologon stocke un mot de passe en
#     clair dans le registre — refuse ici) : l'utilisateur devra rouvrir sa session apres le
#     redemarrage de toute facon: ONLOGON est le declencheur exact pour reprendre a ce moment.
# Sources : about_Execution_Policies et wsl --install (Microsoft Learn, citees plus bas) ;
# choix ONLOGON vs ONSTART discute dans la doc communautaire PowerShell sur la reprise de
# scripts apres redemarrage (advancedinstaller.com/continue-powershell-script-after-reboot ;
# devblogs.microsoft.com/powershell/automatically-resuming-windows-powershell-workflow-jobs-at-logon).
function Register-ResumeTask {
    $resumeCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    & schtasks.exe /Create /TN $TaskName /TR $resumeCmd /SC ONLOGON /RL HIGHEST /F | Out-Null
}

function Remove-ResumeTask {
    & schtasks.exe /Query /TN $TaskName *> $null
    if ($LASTEXITCODE -eq 0) { & schtasks.exe /Delete /TN $TaskName /F | Out-Null }
}

# Reprise en cours : on est relance par la tache planifiee, elle n'a plus lieu d'etre tant
# qu'un nouveau redemarrage n'est pas necessaire plus bas.
Remove-ResumeTask

# ── Detection d'un redemarrage deja programme par Windows ─────────────────────
# Trois indicateurs standards (aucune API unique ne couvre tous les cas) : Component Based
# Servicing, Windows Update, et les renommages de fichiers en attente au prochain boot.
# Source (technique communautaire documentee, reprise ici sans dependance externe) :
# https://learn.microsoft.com/troubleshoot/windows-server/deployment/determine-server-restart
function Test-PendingReboot {
    $cbs = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
    $wu  = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    $pfr = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager'
    if (Test-Path $cbs) { return $true }
    if (Test-Path $wu) { return $true }
    if ((Get-Item $pfr).GetValue('PendingFileRenameOperations')) { return $true }
    return $false
}

function Invoke-GuidedRestart {
    param([string]$Reason)
    Write-Warn $Reason
    Write-Warn "Reprise automatique programmee a la prochaine ouverture de session (tache '$TaskName')."
    Write-Warn "Redemarrage dans 15s (Ctrl+C pour annuler et redemarrer toi-meme plus tard)."
    Register-ResumeTask
    Start-Sleep -Seconds 15
    Restart-Computer -Force
    exit 0
}

# Rafraichit le PATH du processus courant depuis le registre (Machine + User) sans relancer
# PowerShell — necessaire apres l'installation de Docker Desktop, dont l'installeur modifie
# le PATH persiste mais que ce processus deja demarre ne relit jamais tout seul.
function Update-EnvPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

Write-Host "EchoHub — installation Windows (WSL2 / Docker Desktop / GPU NVIDIA)" -ForegroundColor White
Write-Host "──────────────────────────────────────────────────────────────────"

# ── 1. WSL2 : plateforme + noyau ──────────────────────────────────────────────
# Source : https://learn.microsoft.com/windows/wsl/install — `wsl --install` active les
# fonctionnalites optionnelles requises (Microsoft-Windows-Subsystem-Linux,
# VirtualMachinePlatform), installe le noyau WSL2 et (sans --no-distribution) une distro
# par defaut. Un redemarrage est necessaire la toute premiere fois sur un Windows non
# modifie, car l'activation de fonctionnalites optionnelles Windows l'exige.
$state = Get-SetupState
Write-Step "WSL2 (plateforme + noyau)"

$wslOk = $false
try {
    & wsl.exe --status *> $null
    if ($LASTEXITCODE -eq 0) { $wslOk = $true }
} catch { }

if ($wslOk) {
    Write-Ok "WSL2 deja installe et fonctionnel (wsl --status repond)."
} else {
    Write-Warn "WSL2 absent ou incomplet — installation de la plateforme (wsl --install --no-distribution)."
    & wsl.exe --install --no-distribution
    if ($LASTEXITCODE -ne 0 -and -not (Test-PendingReboot)) {
        Exit-WithGuidance "'wsl --install' a echoue (code $LASTEXITCODE)." @(
            "Consulte : https://learn.microsoft.com/windows/wsl/troubleshooting"
            "Relance ce script une fois le probleme corrige."
        )
    }
}

if (Test-PendingReboot) {
    Invoke-GuidedRestart "Redemarrage requis pour terminer l'activation de WSL2."
}

# ── 2. Une distribution Linux ─────────────────────────────────────────────────
Write-Step "Distribution Linux WSL2"

$distros = (& wsl.exe -l -q 2>$null) -join ''
if ($distros.Trim()) {
    Write-Ok "Distribution WSL2 deja presente : $($distros.Trim())"
} else {
    Write-Warn "Aucune distribution WSL2 — installation d'Ubuntu (peut prendre plusieurs minutes)."
    Write-Host ""
    Write-Host "  ⚠ RAPPEL CRITIQUE (voir PORTAGE-WINDOWS.md et start.ps1) :" -ForegroundColor Yellow
    Write-Host "    N'installe JAMAIS de pilote NVIDIA Linux dans cette distribution" -ForegroundColor Yellow
    Write-Host "    (pas de 'apt install nvidia-driver-*', pas de .run NVIDIA Linux)." -ForegroundColor Yellow
    Write-Host "    Seul le pilote Windows (etape suivante) expose le GPU au conteneur ;" -ForegroundColor Yellow
    Write-Host "    un pilote Linux installe par-dessus casse ce passthrough." -ForegroundColor Yellow
    Write-Host "    Source : https://docs.nvidia.com/cuda/wsl-user-guide/index.html" -ForegroundColor Yellow
    Write-Host ""
    & wsl.exe --install -d Ubuntu
    if ($LASTEXITCODE -ne 0 -and -not (Test-PendingReboot)) {
        Exit-WithGuidance "L'installation de la distribution Ubuntu a echoue (code $LASTEXITCODE)." @(
            "Reessaie manuellement : wsl --install -d Ubuntu"
            "Documentation : https://learn.microsoft.com/windows/wsl/basic-commands"
        )
    }
}

if (Test-PendingReboot) {
    Invoke-GuidedRestart "Redemarrage requis pour terminer l'installation de la distribution Linux."
}

$state.WslDone = $true
Save-SetupState $state

# ── 3. Pilote NVIDIA cote Windows (verification seule, pas d'installation) ───
# Mandat : verifier, pas installer — un pilote GPU s'installe mal sans surveillance (reboot,
# ecran noir temporaire) et n'est de toute facon jamais requis par les trois autres etapes.
Write-Step "Pilote NVIDIA (Windows)"

$nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $nvidiaSmi) {
    Write-Warn "nvidia-smi.exe introuvable — aucun pilote NVIDIA Windows detecte."
    Write-Warn "Installe le pilote NVIDIA Windows (Game Ready ou Studio) pour ta RTX 5090 :"
    Write-Warn "https://www.nvidia.com/Download/index.aspx"
} else {
    $driverLine = (& nvidia-smi.exe --query-gpu=name,driver_version --format=csv,noheader 2>$null)
    if ($driverLine) {
        Write-Ok "GPU detecte : $driverLine"
        $driverVersionText = ($driverLine -split ',')[-1].Trim()
        $driverMajor = 0
        if ($driverVersionText -match '^(\d+)\.') { $driverMajor = [int]$Matches[1] }
        # 570.xx minimum pour la serie RTX 50 / Blackwell (sm_120). Sources :
        # https://www.leadergpu.com/articles/616-install-nvidia-drivers-and-cuda-for-rtx-50-series
        # https://docs.nvidia.com/cuda/wsl-user-guide/index.html
        if ($driverMajor -gt 0 -and $driverMajor -lt 570) {
            Write-Warn "Pilote $driverVersionText trop ancien pour Blackwell (RTX 50) — 570.xx minimum requis."
            Write-Warn "Mets a jour : https://www.nvidia.com/Download/index.aspx"
        } else {
            Write-Ok "Version du pilote compatible RTX 5090/Blackwell (>= 570.xx)."
        }
    } else {
        Write-Warn "nvidia-smi.exe existe mais ne renvoie aucun GPU — verifie le Gestionnaire de peripheriques."
    }
}

# ── 4. Docker Desktop ──────────────────────────────────────────────────────────
# Source (id winget + options silencieuses) :
# https://github.com/microsoft/winget-pkgs (paquet Docker.DockerDesktop)
Write-Step "Docker Desktop"

$dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$dockerAlreadyInstalled = (Test-Path $dockerExe) -or [bool](Get-Command docker -ErrorAction SilentlyContinue)

if ($dockerAlreadyInstalled) {
    Write-Ok "Docker Desktop deja installe."
} else {
    Write-Warn "Docker Desktop absent — installation silencieuse via winget (peut prendre plusieurs minutes)."
    & winget.exe install --id Docker.DockerDesktop --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Exit-WithGuidance "L'installation de Docker Desktop via winget a echoue (code $LASTEXITCODE)." @(
            "Installe manuellement : https://www.docker.com/products/docker-desktop/"
            "Relance ce script une fois Docker Desktop installe."
        )
    }
    Write-Ok "Docker Desktop installe."
    $state.DockerInstalled = $true
    Save-SetupState $state
    Update-EnvPath
}

# Lance Docker Desktop si son moteur ne repond pas deja (premier lancement post-install,
# ou machine redemarree sans que Docker Desktop se relance seul).
try { & docker.exe info *> $null } catch { }
if ($LASTEXITCODE -ne 0 -and (Test-Path $dockerExe)) {
    Write-Warn "Lancement de Docker Desktop..."
    Start-Process -FilePath $dockerExe | Out-Null
}

# ── 5. Attente reelle que Docker reponde (pas un delai fixe) ─────────────────
Write-Step "Attente de Docker Desktop (max ${DockerReadyTimeoutSeconds}s)"

$deadline = (Get-Date).AddSeconds($DockerReadyTimeoutSeconds)
$dockerReady = $false
while ((Get-Date) -lt $deadline) {
    try {
        & docker.exe info *> $null
        if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
}

if (-not $dockerReady) {
    Exit-WithGuidance "Docker Desktop ne repond toujours pas apres ${DockerReadyTimeoutSeconds}s." @(
        "Ouvre Docker Desktop manuellement et attends l'icone verte 'Engine running'."
        "Relance ensuite : .\setup-windows.ps1 (ou directement .\start.ps1)."
    )
}
Write-Ok "Docker Desktop est demarre et repond."

# ── 6. Lancement d'EchoHub ─────────────────────────────────────────────────────
Write-Step "Lancement d'EchoHub"
Remove-ResumeTask
& (Join-Path $PSScriptRoot 'start.ps1')
