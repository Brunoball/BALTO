param(
  [string[]]$Archivos = @(),
  [switch]$Visible,
  [switch]$SinSmoke,
  [int]$Workers = 1
)

. "$PSScriptRoot\_balto-playwright-common.ps1"

if ($Archivos.Count -eq 0) {
  $working = @(git diff --name-only 2>$null)
  $staged = @(git diff --cached --name-only 2>$null)
  $Archivos = Get-UniqueOrderedItems (@($working) + @($staged))
}

if ($Archivos.Count -eq 0) {
  Write-Host 'No se detectaron archivos modificados. Se ejecutará el smoke rápido.' -ForegroundColor Yellow
  & "$PSScriptRoot\test-lote.ps1" smoke -Visible:$Visible -Workers $Workers
  exit $LASTEXITCODE
}

$batches = Get-BaltoTestBatches
$selected = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$runAll = $false
if (-not $SinSmoke) { [void]$selected.Add('smoke') }

foreach ($rawPath in $Archivos) {
  $path = ($rawPath -replace '\\', '/').ToLowerInvariant()

  # Infraestructura transversal o el propio harness: cualquier spec puede verse
  # afectado. En estos casos la selección parcial sería una falsa seguridad.
  if ($path -match 'routes/api\.php|config/config|context/|components/global/|modules/global/|configuracion/testing/|tests/support/|tests/setup/|playwright\.config|global-setup|global-teardown|src/scripts/') {
    $runAll = $true
    continue
  }

  if ($path -match 'login|require_session|sesion|auth') { [void]$selected.Add('auth') }

  if ($path -match 'components/servicios|modules/servicios|servicio_articulos|servicio_servicios|servicio_trabajadores') {
    [void]$selected.Add('servicios')
  }

  if ($path -match 'servicestockcomposition|productstockautocomplete') {
    [void]$selected.Add('servicios')
    [void]$selected.Add('stock')
    [void]$selected.Add('movimientos')
    [void]$selected.Add('documentos')
  }

  if ($path -match 'stockimpactservice|stock|inventario|material|insumo') {
    [void]$selected.Add('stock')
    [void]$selected.Add('servicios')
    [void]$selected.Add('movimientos')
  }

  if ($path -match 'mov_subsection|movimientos|ventas|compras|recibos|ordenes|otros_ingresos|otros_egresos|presupuestos|movimientorepository') {
    [void]$selected.Add('movimientos')
  }

  if ($path -match 'cuentas_corrientes|cuentas-corrientes|clientes|proveedores') {
    [void]$selected.Add('cuentas-corrientes')
  }

  if ($path -match 'cheques|echeq') {
    [void]$selected.Add('cheques')
    [void]$selected.Add('movimientos')
  }

  if ($path -match 'configuracion|configuración') { [void]$selected.Add('configuracion') }

  if ($path -match 'dashboard|flujo_caja|flujo-de-caja|analisis_financiero|contabilidad') {
    [void]$selected.Add('navegacion')
  }

  if ($path -match 'documentos_comerciales|factura|remito|ventanofacturadapdfbuilder|facturapdfbuilder|remitopdfbuilder|presupuestopdfbuilder|notacreditopdfbuilder') {
    [void]$selected.Add('documentos')
  }

  if ($path -match 'export|boton_exportar|exportscopeutils') {
    [void]$selected.Add('exportaciones')
  }
}

if ($runAll) {
  $orderedSelection = @('todo')
  $files = Get-BaltoAllCurrentTests
} else {
  if ($selected.Count -eq 0) { [void]$selected.Add('smoke') }
  $preferredOrder = @(
    'smoke', 'auth', 'servicios', 'stock', 'movimientos',
    'cuentas-corrientes', 'cheques', 'configuracion',
    'documentos', 'exportaciones', 'navegacion'
  )
  $orderedSelection = @($preferredOrder | Where-Object { $selected.Contains($_) })
  $files = @()
  foreach ($batchName in $orderedSelection) { $files += $batches[$batchName] }
  $files = Get-UniqueOrderedItems $files
}

Write-Host 'Archivos analizados:' -ForegroundColor Cyan
$Archivos | ForEach-Object { Write-Host "  - $_" }
Write-Host ''
Write-Host "Lotes elegidos: $($orderedSelection -join ', ')" -ForegroundColor Green

# Una sola invocación: specs compartidos entre lotes se ejecutan una sola vez.
Invoke-BaltoPlaywright -Files $files -Visible:$Visible -Workers $Workers
