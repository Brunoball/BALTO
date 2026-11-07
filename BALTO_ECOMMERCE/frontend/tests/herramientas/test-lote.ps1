# Uso (desde la raíz del frontend):
#   .\tests\herramientas\test-lote.ps1 smoke
#   .\tests\herramientas\test-lote.ps1 checkout -Visible
#   .\tests\herramientas\test-lote.ps1 todo -Workers 2
# Lotes: smoke, navegacion, tienda, catalogo, carrito, checkout, pagos, cuenta, api, movil, todo
param(
  [Parameter(Position = 0)][string]$Lote = 'smoke',
  [switch]$Visible,
  [switch]$Ui,
  [switch]$Listar,
  [int]$Workers = 1,
  [string]$Reporter = 'list'
)
. "$PSScriptRoot\_comun.ps1"
$lotes = Get-EcomLotes
$nombre = $Lote.Trim().ToLowerInvariant()
if ($nombre -eq 'todo') { $archivos = @() }
elseif ($lotes.Contains($nombre)) { $archivos = $lotes[$nombre] }
else { throw "Lote desconocido '$Lote'. Opciones: $((@($lotes.Keys) + 'todo') -join ', ')." }
Invoke-EcomPlaywright -Archivos $archivos -Visible:$Visible -Ui:$Ui -Listar:$Listar -Workers $Workers -Reporter $Reporter; exit $LASTEXITCODE
