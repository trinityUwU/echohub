#Requires -Version 5.1
<#
.SYNOPSIS
    EchoHub — arret symetrique de start.ps1 (Docker Desktop / WSL2).

.DESCRIPTION
    Arrete la composition Docker demarree par start.ps1. Ne supprime pas les volumes
    (modeles telecharges, donnees utilisateur) : relance simplement .\start.ps1 pour
    retrouver le meme etat.

.USAGE
    .\stop.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step { param([string]$Message) Write-Host "`n▶ $Message" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Message) Write-Host "  [OK] $Message" -ForegroundColor Green }
function Write-Err   { param([string]$Message) Write-Host "  [X]  $Message" -ForegroundColor Red }

Write-Host "EchoHub — arret" -ForegroundColor White
Write-Host "─────────────────────"

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Err "Docker n'est pas installe (commande 'docker' introuvable) — rien a arreter."
    exit 1
}

Write-Step "Arret des conteneurs EchoHub"
docker compose down
if ($LASTEXITCODE -ne 0) {
    Write-Err "'docker compose down' a echoue — consulte la sortie ci-dessus."
    exit 1
}
Write-Ok "Conteneurs arretes. Volumes (modeles, donnees utilisateur) conserves."
Write-Host "`nPour redemarrer : .\start.ps1" -ForegroundColor White
