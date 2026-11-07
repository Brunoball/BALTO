# BALTO eCommerce - borra del frontend SOLO las carpetas/archivos de la estructura anterior
# (si descomprimiste el src nuevo ENCIMA del viejo en lugar de reemplazarlo).
# Ejecutar desde la raíz del frontend:  .\tests\herramientas\limpiar-estructura-vieja.ps1
if (-not (Test-Path '.\package.json')) { throw 'Ejecutá el script desde la raíz del frontend, donde está package.json.' }
if (-not (Test-Path '.\src\componentes\global\api\clienteApi.js')) { throw 'Primero descomprimí el src nuevo (falta src\componentes\global\api\clienteApi.js).' }
$viejos = @(
  'src\servicios', 'src\hooks', 'src\paginas', 'src\contexto', 'src\utilidades', 'src\estilos', 'src\configuracion',
  'src\componentes\comunes', 'src\componentes\pago',
  'tests\helpers.js', 'tests\carrito.spec.js', 'tests\catalogo.spec.js', 'tests\checkout.spec.js'
)
foreach ($v in $viejos) {
  if (Test-Path $v) { Remove-Item -Recurse -Force $v; Write-Host "Borrado $v" -ForegroundColor Yellow }
}
Write-Host 'Listo: queda solo la estructura nueva.' -ForegroundColor Green
