param(
  [switch]$Visible,
  [int]$Workers = 1
)

. "$PSScriptRoot\_balto-playwright-common.ps1"

# Una sola corrida con TODOS los specs: suite principal + tests/internal.
# La detección es dinámica para que nuevos *.spec.js no queden fuera del freeze.
$files = Get-BaltoAllCurrentTests
Write-Host ''
Write-Host '================ SUITE COMPLETA ACTUAL ================' -ForegroundColor Magenta
Invoke-BaltoPlaywright -Files $files -Visible:$Visible -Workers $Workers

Write-Host ''
Write-Host 'Suite completa (principal + internal) finalizada correctamente.' -ForegroundColor Green
