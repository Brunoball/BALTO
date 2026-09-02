param(
  [switch]$Visible,
  [int]$Workers = 1
)

. "$PSScriptRoot\_balto-playwright-common.ps1"

$batches = Get-BaltoTestBatches
$sequence = @(
  'auth',
  'stock',
  'movimientos',
  'cuentas-corrientes',
  'cheques',
  'configuracion',
  'navegacion'
)

$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

foreach ($batch in $sequence) {
  $remaining = @($batches[$batch] | Where-Object { $seen.Add($_) })
  if ($remaining.Count -eq 0) {
    Write-Host "Lote '$batch': todos sus archivos ya fueron ejecutados como dependencia." -ForegroundColor DarkGray
    continue
  }

  Write-Host ''
  Write-Host "================ LOTE: $batch ================" -ForegroundColor Magenta
  Invoke-BaltoPlaywright -Files $remaining -Visible:$Visible -Workers $Workers
}

Write-Host ''
Write-Host 'Todos los lotes internos finalizaron correctamente, sin repetir archivos.' -ForegroundColor Green
