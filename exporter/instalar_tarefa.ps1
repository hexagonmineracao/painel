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
$ExePath = Join-Path $PSScriptRoot "dist\PainelWebSync.exe"

if ($Remover) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarefa '$TaskName' removida (se existia)."
    exit 0
}

if (-not (Test-Path $ExePath)) {
    Write-Host "ERRO: $ExePath nao encontrado. Rode build.bat primeiro." -ForegroundColor Red
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
