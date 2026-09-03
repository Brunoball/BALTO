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
if (-not $SinSmoke) { [void]$selected.Add('smoke') }

foreach ($rawPath in $Archivos) {
  $path = ($rawPath -replace '\\', '/').ToLowerInvariant()

  if ($path -match 'routes/api\.php|config/config|context/|components/global/|modules/global/') {
    [void]$selected.Add('interno')
    continue
  }

  if ($path -match 'login|require_session|sesion|auth') { [void]$selected.Add('auth') }
  if ($path -match 'stock') {
    [void]$selected.Add('stock')
    [void]$selected.Add('movimientos')
  }
  if ($path -match 'mov_subsection|movimientos|ventas|compras|recibos|ordenes|otros_ingresos|otros_egresos|presupuestos') {
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
  if ($path -match 'documentos_comerciales|facturas|remitos') { [void]$selected.Add('documentos') }
}

if ($selected.Count -eq 0) { [void]$selected.Add('smoke') }

# Un cambio transversal ya incluye smoke y todos los módulos; evita repetirlos.
if ($selected.Contains('interno')) {
  $orderedSelection = @('interno')
} else {
  $preferredOrder = @('smoke', 'auth', 'stock', 'movimientos', 'cuentas-corrientes', 'cheques', 'configuracion', 'documentos', 'navegacion')
  $orderedSelection = @($preferredOrder | Where-Object { $selected.Contains($_) })
}

Write-Host 'Archivos analizados:' -ForegroundColor Cyan
$Archivos | ForEach-Object { Write-Host "  - $_" }
Write-Host ''
Write-Host "Lotes elegidos: $($orderedSelection -join ', ')" -ForegroundColor Green

if ($orderedSelection -contains 'interno') {
  $files = Get-BaltoInternalTests
} else {
  $files = @()
  foreach ($batchName in $orderedSelection) {
    $files += $batches[$batchName]
  }
  $files = Get-UniqueOrderedItems $files
}

# Una sola invocación: smoke y el módulo comparten archivos, pero cada spec se ejecuta una vez.
Invoke-BaltoPlaywright -Files $files -Visible:$Visible -Workers $Workers
