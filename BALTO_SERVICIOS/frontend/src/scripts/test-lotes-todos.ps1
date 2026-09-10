param(
  [switch]$Visible,
  [int]$Workers = 1
)

. "$PSScriptRoot\_balto-playwright-common.ps1"

# Una sola corrida con todos los specs existentes. Antes este script recorría
# lotes incompletos y omitía varios archivos nuevos de Servicios/Documentos.
$files = Get-BaltoAllCurrentTests
Write-Host ''
Write-Host '================ SUITE COMPLETA ACTUAL ================' -ForegroundColor Magenta
Invoke-BaltoPlaywright -Files $files -Visible:$Visible -Workers $Workers

Write-Host ''
Write-Host 'Suite completa finalizada correctamente.' -ForegroundColor Green
