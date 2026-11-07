# Corre solo los lotes afectados por los archivos modificados (git diff), como en Comercio.
#   .\tests\herramientas\test-segun-cambios.ps1
#   .\tests\herramientas\test-segun-cambios.ps1 -Archivos src\componentes\carrito\PanelCarrito.jsx
param([string[]]$Archivos = @(), [switch]$Visible, [switch]$SinSmoke, [int]$Workers = 1)
. "$PSScriptRoot\_comun.ps1"

if ($Archivos.Count -eq 0) {
  $Archivos = Get-ItemsUnicos (@(git diff --name-only 2>$null) + @(git diff --cached --name-only 2>$null))
}
if ($Archivos.Count -eq 0) {
  Write-Host 'No hay archivos modificados: se ejecuta el smoke.' -ForegroundColor Yellow
  Invoke-EcomPlaywright -Archivos (Get-EcomLotes)['smoke'] -Visible:$Visible -Workers $Workers; exit $LASTEXITCODE
}

$lotes = Get-EcomLotes
$elegidos = New-Object 'System.Collections.Generic.List[string]'
if (-not $SinSmoke) { $elegidos.Add('smoke') }
foreach ($crudo in $Archivos) {
  $p = ($crudo -replace '\\', '/').ToLowerInvariant()
  if ($p -match 'aplicacion\.jsx$|index\.js$|setupproxy|componentes/global/|componentes/estructura/|routes/api\.php|configuracion/http\.php|\.env') { $elegidos.Add('todo'); continue }
  if ($p -match 'componentes/tienda/|modules/tienda/') { $elegidos.Add('tienda') }
  if ($p -match 'componentes/(inicio|catalogo|producto)/|modules/(catalogo|imagenes)/') { $elegidos.Add('catalogo') }
  if ($p -match 'componentes/carrito/|modules/carrito/') { $elegidos.Add('carrito'); $elegidos.Add('checkout') }
  if ($p -match 'componentes/(checkout|direccion)/|modules/(checkout|geografia|seguridad)/') { $elegidos.Add('checkout') }
  if ($p -match 'componentes/pagos/|modules/pagos/') { $elegidos.Add('pagos'); $elegidos.Add('cuenta') }
  if ($p -match 'componentes/(cuenta|autenticacion)/|modules/(autenticacion|cliente)/') { $elegidos.Add('cuenta') }
  if ($p -match '/api/|modules/') { $elegidos.Add('api') }
  if ($p -match '\.css$') { $elegidos.Add('movil') }
  if ($p -match '^tests/') { $elegidos.Add('api') }
}
$elegidos = Get-ItemsUnicos $elegidos
if ($elegidos -contains 'todo') { Write-Host 'Cambio transversal: suite completa.' -ForegroundColor Yellow; Invoke-EcomPlaywright -Visible:$Visible -Workers $Workers; exit $LASTEXITCODE }
$archivosTest = Get-ItemsUnicos ($elegidos | ForEach-Object { $lotes[$_] })
Write-Host ("Lotes: {0}" -f ($elegidos -join ', ')) -ForegroundColor Cyan
Invoke-EcomPlaywright -Archivos $archivosTest -Visible:$Visible -Workers $Workers; exit $LASTEXITCODE
