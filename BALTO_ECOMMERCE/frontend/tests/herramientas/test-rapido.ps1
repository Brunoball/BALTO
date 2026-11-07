# Smoke rápido: preflight + pruebas marcadas @smoke de toda la suite (sin escrituras).
param([switch]$Visible, [int]$Workers = 2)
. "$PSScriptRoot\_comun.ps1"
Invoke-EcomPlaywright -Grep '@smoke' -Visible:$Visible -Workers $Workers; exit $LASTEXITCODE
