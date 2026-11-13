# BALTO Comercio — Testing profesional por módulos

## Qué se ejecuta normalmente

**1. GLOBAL** `node tests/ejecutar.cjs global`  
Verifica autenticación, navegación a las secciones, protecciones y diagnósticos globales existentes. 

**2. MÓDULO CAMBIADO** `node tests/ejecutar.cjs movimientos` (o `stock`, `flujo_caja`, etc.).  
Ejecuta todas las pruebas existentes asignadas al módulo, sus rutas de navegación y unas pocas pruebas de integración directa elegidas por impacto. No ejecuta el sistema entero.

**3. COMPLETO** `node tests/ejecutar.cjs completo`  
Suite completa, incluida auditoría interna restringida a staging, para cambios transversales y releases.

Los comandos válidos para tu trabajo están en `COMANDOS_TESTING.txt`. No hay comandos separados de `smoke`, `interno`, `contratos`, `exportaciones` o `documentos`: esos tests quedan dentro de los módulos reales, o en la suite completa cuando corresponda.

## Estructura

- `global/`: login, navegación global, seguridad, diagnósticos. `auditoria_solo_completo` no se ejecuta en GLOBAL, sí en COMPLETO.
- `movimientos/`: ventas, compras, presupuestos, facturas, remitos, NC, documentos, PDFs, exportación y validaciones de pagos.
- `stock/`: productos, variantes, costos, unidades, códigos de barras, vencimientos, precios.
- `flujo_caja/`: ajustes, transferencias y conciliación con dashboard.
- `dashboard/`, `analisis_financiero/`, `cheques/`, `cuentas_corrientes/`, `configuracion/`, `contabilidad/`, `tiendanube/`.
- `support/` y `setup/`: infraestructura compartida sin cambios de lógica, no son módulos para ejecutar.

La matriz de dependencias (archivos concretos de integración) se mantiene en `perfiles.json`. No se duplican tests en los comandos de módulo. La navegación específica del módulo usa el mismo verificador de rutas que el test global; el comportamiento existente se centralizó en `support/navigation-smoke.js`.

## Instalación segura

1. Respaldá tu `frontend/tests/` actual.
2. Sustituí `frontend/tests/` **entera** con la del ZIP (no mezcles carpetas antiguas y nuevas).
3. Mantené `playwright.config.*`, `package.json`, `.env.playwright` y todo el resto de la aplicación tal como están.
4. Los datos de autenticación `tests/.auth/user.json` **no** están incluidos; los regenera `auth.setup.js`.
5. Abrí PowerShell dentro de `frontend` y usá los comandos del TXT.

## Alcance técnico y límites

Reorganizar los tests no crea mágicamente pruebas para todos los botones y escenarios. Las pruebas existentes se preservan y se agregó cobertura de **navegación** por módulo; las funcionalidades sin tests automatizados previos (por ejemplo exportaciones propias de módulos que aún no tenían tests de exportación) requieren casos nuevos para afirmar cobertura completa. 

Los resultados E2E reales siguen pendientes de ejecución en tu máquina contra un **tenant E2E aislado**, para no afectar datos reales. Usar `PW_ALLOW_MUTATIONS=1` únicamente con ese tenant. 

Los desafíos 403 del CDN de Hostinger no se resuelven reubicando archivos; la selección modular reduce la cantidad de peticiones.
