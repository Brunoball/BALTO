# BALTO eCommerce - funciones comunes de los scripts de Playwright (igual que en Comercio).
# Se ejecutan SIEMPRE desde la raíz del frontend (donde está package.json).

function Get-EcomLotes {
  [ordered]@{
    'smoke'      = @('tests/00-preflight.spec.js', 'tests/01-tienda.spec.js', 'tests/02-navegacion.spec.js', 'tests/14-cobertura-acciones.spec.js')
    'navegacion' = @('tests/02-navegacion.spec.js', 'tests/15-movil.spec.js')
    'tienda'     = @('tests/01-tienda.spec.js')
    'catalogo'   = @('tests/03-catalogo.spec.js', 'tests/04-producto-favoritos.spec.js')
    'carrito'    = @('tests/05-carrito.spec.js')
    'checkout'   = @('tests/06-checkout.spec.js', 'tests/07-pagos.spec.js', 'tests/08-geografia-direccion.spec.js')
    'pagos'      = @('tests/07-pagos.spec.js')
    'cuenta'     = @('tests/09-autenticacion.spec.js', 'tests/10-cuenta-perfil.spec.js', 'tests/11-cuenta-direcciones.spec.js', 'tests/12-cuenta-pedidos.spec.js')
    'api'        = @('tests/13-contrato-api.spec.js', 'tests/14-cobertura-acciones.spec.js')
    'movil'      = @('tests/15-movil.spec.js')
  }
}

function Get-ItemsUnicos([object[]]$Items) {
  $vistos = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $salida = @()
  foreach ($i in $Items) { if ($i -and $vistos.Add([string]$i)) { $salida += [string]$i } }
  return $salida
}

function Invoke-EcomPlaywright {
  param(
    [string[]]$Archivos = @(),
    [switch]$Visible,
    [switch]$Ui,
    [switch]$Listar,
    [int]$Workers = 1,
    [string]$Reporter = 'list',
    [string]$Grep = ''
  )
  if (-not (Test-Path '.\package.json')) { throw 'Ejecutá el script desde la raíz del frontend, donde está package.json.' }
  if (-not (Test-Path '.\.env.playwright')) { throw 'Falta .env.playwright en la raíz del frontend.' }

  $argumentos = @('playwright', 'test') + $Archivos + @('--project=chromium', "--workers=$Workers", "--reporter=$Reporter")
  if ($Grep) { $argumentos += @('--grep', $Grep) }
  if ($Visible) { $argumentos += '--headed' }
  if ($Ui) { $argumentos += '--ui' }
  if ($Listar) { $argumentos += '--list' }

  Write-Host ''
  if ($Archivos.Count) { Write-Host ('Ejecutando {0} archivo(s):' -f $Archivos.Count) -ForegroundColor Cyan; $Archivos | ForEach-Object { Write-Host "  - $_" } }
  elseif ($Grep) { Write-Host "Ejecutando las pruebas marcadas $Grep." -ForegroundColor Cyan }
  else { Write-Host 'Ejecutando la suite completa.' -ForegroundColor Cyan }
  Write-Host ''
  & npx @argumentos
}
