#Requires -Version 5.1
<#
.SYNOPSIS
    EchoHub — entree Windows en une commande (Docker Desktop + WSL2 + GPU NVIDIA).

.DESCRIPTION
    Verifie les prerequis (Docker Desktop, moteur WSL2, GPU NVIDIA visible), construit
    l'image echohub:gpu si besoin, demarre la composition, attend que le backend reponde
    reellement sur son point de sante, puis ouvre le navigateur.

    Cible : Windows 11 + Docker Desktop + WSL2 + RTX 5090 (Blackwell, sm_120).
    NON TESTE sur ce materiel — voir README.md, section Windows, pour le detail exact de
    ce qui a ete verifie et de ce qui ne l'a pas ete.

.USAGE
    Clic droit > Executer avec PowerShell, ou depuis un terminal :
        .\start.ps1
#>

[CmdletBinding()]
param(
    [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# ── Sortie ────────────────────────────────────────────────────────────────────
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

Write-Host "EchoHub — demarrage (Docker Desktop / WSL2 / GPU NVIDIA)" -ForegroundColor White
Write-Host "─────────────────────────────────────────────────────────"

# ── 1. Docker Desktop installe et demarre ────────────────────────────────────
Write-Step "Docker Desktop"

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Exit-WithGuidance "Docker n'est pas installe (commande 'docker' introuvable)." @(
        "Installe Docker Desktop pour Windows (inclut le moteur WSL2) :"
        "https://www.docker.com/products/docker-desktop/"
        "Redemarre ce script apres l'installation et le premier lancement de Docker Desktop."
    )
}
Write-Ok "Docker CLI trouve : $($dockerCmd.Source)"

try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw "docker info a echoue (code $LASTEXITCODE)" }
} catch {
    Exit-WithGuidance "Docker Desktop est installe mais ne repond pas (le moteur n'est pas demarre)." @(
        "Lance Docker Desktop depuis le menu Demarrer et attends l'icone verte 'Engine running'."
        "Relance ensuite ce script."
    )
}
Write-Ok "Docker Desktop est demarre et repond."

# ── 2. Moteur WSL2 actif ──────────────────────────────────────────────────────
Write-Step "Moteur WSL2"

$dockerOsType = (docker info --format '{{.OSType}}' 2>$null)
if ($dockerOsType -ne 'linux') {
    Exit-WithGuidance "Docker Desktop ne tourne pas sur le moteur Linux/WSL2 (OSType='$dockerOsType')." @(
        "Ouvre Docker Desktop > Settings > General et coche 'Use the WSL 2 based engine'."
        "Documentation : https://docs.docker.com/desktop/features/wsl/"
    )
}

$wslStatus = & wsl.exe --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Exit-WithGuidance "WSL2 n'est pas installe ou 'wsl.exe' est introuvable." @(
        "Ouvre un PowerShell en administrateur et lance : wsl --install"
        "Documentation officielle : https://learn.microsoft.com/windows/wsl/install"
        "Redemarre Windows si demande, puis relance ce script."
    )
}
Write-Ok "Moteur WSL2 actif (Docker Desktop, OSType=linux ; wsl.exe operationnel)."

# ── 3. GPU NVIDIA visible ─────────────────────────────────────────────────────
Write-Step "GPU NVIDIA"

$nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $nvidiaSmi) {
    Exit-WithGuidance "nvidia-smi.exe introuvable — aucun pilote NVIDIA Windows detecte." @(
        "Installe le pilote NVIDIA Windows (Game Ready ou Studio) pour ta RTX 5090 :"
        "https://www.nvidia.com/Download/index.aspx"
        "Version minimale connue pour la serie RTX 50 (Blackwell) : 570.xx ou plus recent."
    )
}

$driverLine = (& nvidia-smi.exe --query-gpu=name,driver_version --format=csv,noheader 2>$null)
if (-not $driverLine) {
    Exit-WithGuidance "nvidia-smi.exe existe mais ne renvoie aucun GPU — pilote installe mais GPU non detecte." @(
        "Verifie que la RTX 5090 est bien reconnue dans le Gestionnaire de peripheriques Windows."
        "Reinstalle le pilote si besoin : https://www.nvidia.com/Download/index.aspx"
    )
}
Write-Ok "GPU detecte cote Windows : $driverLine"

$driverVersionText = ($driverLine -split ',')[-1].Trim()
$driverMajor = 0
if ($driverVersionText -match '^(\d+)\.') { $driverMajor = [int]$Matches[1] }
if ($driverMajor -gt 0 -and $driverMajor -lt 570) {
    Write-Warn "Pilote NVIDIA $driverVersionText detecte — la serie RTX 50 (Blackwell) demande 570.xx ou plus recent."
    Write-Warn "Mets a jour le pilote si l'inference GPU echoue : https://www.nvidia.com/Download/index.aspx"
}

# Rappel critique documente dans PORTAGE-WINDOWS.md (Partie 2, passthrough GPU sous WSL2) :
# le pilote NVIDIA s'installe UNIQUEMENT cote Windows. Installer un pilote Linux dans WSL2
# casse le passthrough GPU-PV (le pilote Windows expose libcuda.so en stub cote Linux).
Write-Host ""
Write-Host "  ⚠ RAPPEL CRITIQUE (voir PORTAGE-WINDOWS.md) :" -ForegroundColor Yellow
Write-Host "    Le pilote NVIDIA s'installe UNIQUEMENT depuis Windows (lien ci-dessus)." -ForegroundColor Yellow
Write-Host "    N'installe JAMAIS de pilote NVIDIA Linux a l'interieur de WSL2 (apt/pacman" -ForegroundColor Yellow
Write-Host "    'nvidia-driver' dans la distro) : cela casse le passthrough GPU vers Docker." -ForegroundColor Yellow
Write-Host "    Source : https://docs.nvidia.com/cuda/wsl-user-guide/index.html" -ForegroundColor Yellow

# GPU visible depuis un conteneur Docker
Write-Step "GPU visible depuis un conteneur Docker (test reel)"
docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi *> $null
if ($LASTEXITCODE -ne 0) {
    Exit-WithGuidance "Le GPU n'est pas exposable a un conteneur Docker ('docker run --gpus all ...' a echoue)." @(
        "Verifie Docker Desktop > Settings > Resources > WSL Integration."
        "Reinstalle/repare Docker Desktop si le probleme persiste."
        "Documentation : https://docs.docker.com/desktop/features/gpu/"
    )
}
Write-Ok "GPU accessible depuis un conteneur Docker de test."

# ── 4. Build de l'image si absente ────────────────────────────────────────────
Write-Step "Image echohub:gpu"

docker image inspect echohub:gpu *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Image 'echohub:gpu' absente — construction en cours (peut prendre 15-30 minutes)."
    docker compose build
    if ($LASTEXITCODE -ne 0) {
        Exit-WithGuidance "Le build de l'image a echoue." @(
            "Relis la sortie ci-dessus pour l'erreur exacte."
            "Consulte DOCKER-BUILD-LOG.md pour les problemes de compilation deja rencontres et resolus."
        )
    }
    Write-Ok "Image 'echohub:gpu' construite."
} else {
    Write-Ok "Image 'echohub:gpu' deja presente — build saute."
}

# ── 5. Demarrage de la composition ────────────────────────────────────────────
Write-Step "Demarrage des conteneurs"

docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Exit-WithGuidance "'docker compose up' a echoue." @(
        "Relis la sortie ci-dessus."
        "Verifie qu'aucun autre service n'occupe les ports 37820/37821 (docker compose down puis reessaie)."
    )
}
Write-Ok "Conteneurs demarres."

# ── 6. Attente reelle du point de sante (pas un delai fixe) ──────────────────
Write-Step "Attente du backend (point de sante /health, max ${HealthTimeoutSeconds}s)"

$healthUrl = 'http://localhost:37821/health'
$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # backend pas encore pret — normal pendant les premieres secondes, on reessaie
    }
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    Exit-WithGuidance "Le backend ne repond toujours pas sur $healthUrl apres ${HealthTimeoutSeconds}s." @(
        "Consulte les logs : docker compose logs -f"
        "Cause frequente : premier demarrage du moteur d'inference sur un GPU lent, ou erreur au boot."
        "Une fois la cause corrigee, relance : .\start.ps1"
    )
}
Write-Ok "Backend pret ($healthUrl repond 200)."

# ── 7. Ouverture du navigateur ────────────────────────────────────────────────
Write-Step "Ouverture de l'interface"

$webUrl = 'http://localhost:37820'
try {
    Start-Process $webUrl
    Write-Ok "Navigateur ouvert sur $webUrl"
} catch {
    Write-Warn "Impossible d'ouvrir automatiquement le navigateur ($($_.Exception.Message))."
    Write-Warn "EchoHub tourne quand meme : ouvre manuellement $webUrl"
}

Write-Host "`nEchoHub est pret." -ForegroundColor Green
Write-Host "Pour arreter : .\stop.ps1" -ForegroundColor White
