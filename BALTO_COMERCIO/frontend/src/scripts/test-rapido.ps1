param([switch]$Visible)
& "$PSScriptRoot\test-lote.ps1" smoke -Visible:$Visible -Workers 1
exit $LASTEXITCODE
