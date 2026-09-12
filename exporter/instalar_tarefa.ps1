# instalar_tarefa.ps1 — registra o PainelWebSync.exe pra iniciar sozinho
# com o login do Windows (Tarefa Agendada), sem precisar de administrador.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File instalar_tarefa.ps1
#   powershell -ExecutionPolicy Bypass -File instalar_tarefa.ps1 -Remover   (desinstala)

param(
    [switch]$Remover
)

$TaskName = "PainelWebSync"

# Aceita tanto o .exe ao lado deste script (pacote de instalacao) quanto em
# dist\ (rodando direto na pasta de desenvolvimento apos build.bat).
$ExePath = Join-Path $PSScriptRoot "PainelWebSync.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $PSScriptRoot "dist\PainelWebSync.exe"
}

if ($Remover) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarefa '$TaskName' removida (se existia)."
    exit 0
}

if (-not (Test-Path $ExePath)) {
    Write-Host "ERRO: PainelWebSync.exe nao encontrado (nem ao lado deste script, nem em dist\)." -ForegroundColor Red
    exit 1
}

$EnvPath = Join-Path (Split-Path $ExePath -Parent) ".env"
if (-not (Test-Path $EnvPath)) {
    Write-Host "ERRO: .env nao encontrado em $(Split-Path $ExePath -Parent)." -ForegroundColor Red
    Write-Host "Copie o .env junto com o PainelWebSync.exe antes de instalar a tarefa."
    exit 1
}

$action = New-ScheduledTaskAction -Execute $ExePath
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Sincroniza pesagens do TP RODO (MySQL) para o painel web (Supabase). Nao interfere no PainelNFE." `
    -Force | Out-Null

Write-Host "Tarefa '$TaskName' registrada — vai iniciar sozinha no proximo login." -ForegroundColor Green
Write-Host "Pra iniciar agora, sem esperar o proximo login:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
