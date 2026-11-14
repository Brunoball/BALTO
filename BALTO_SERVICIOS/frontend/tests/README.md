# BALTO Servicios — Testing profesional por módulos

## Qué se ejecuta normalmente

**1. GLOBAL** `node tests/ejecutar.cjs global`  
Verifica autenticación, navegación a las secciones, seguridad/hardening y diagnósticos globales existentes.

**2. MÓDULO CAMBIADO** `node tests/ejecutar.cjs movimientos` (o `servicios`, `flujo_caja`, etc.).  
Ejecuta todas las pruebas existentes asignadas al módulo, sus rutas de navegación y unas pocas pruebas de integración directa elegidas por impacto. No ejecuta el sistema entero.

**3. COMPLETO** `node tests/ejecutar.cjs completo`  
Suite completa, incluida la auditoría interna (antes `tests/internal`), para cambios transversales y releases.

Los comandos válidos están en `COMANDOS_TESTING.txt`. Los antiguos lotes (`smoke`, `interno`, `documentos`, `exportaciones`, `pagos-agrupados`, etc.) quedan dentro de los módulos reales o en la suite completa.

## Estructura

- `global/`: preflight, login y acciones de autenticación, navegación global, navegación interna, guardas globales y hardening del backend. `auditoria_solo_completo/` (la suite interna `@internal`) no se ejecuta en GLOBAL, sí en COMPLETO.
- `movimientos/`: ventas, compras, presupuestos, recibos, órdenes de pago, otros ingresos/egresos, NC, documentos, PDFs, exportación, descuentos generales, detalles manuales y validaciones de pagos.
- `servicios/`: catálogo, composición, materiales/insumos, inventario, precios/rentabilidad, guardas de borrado y capacidades por plan.
- `flujo_caja/`: ajustes de saldo y transferencias entre cajas.
- `dashboard/`, `analisis_financiero/`, `cheques/`, `cuentas_corrientes/`, `configuracion/`, `contabilidad/`.
- `support/`, `setup/`, `helpers/`, `unit/` y los `*.regression.cjs` de la raíz: infraestructura compartida, no son módulos para ejecutar.

La matriz de dependencias (archivos concretos de integración) se mantiene en `perfiles.json`. La navegación específica de cada módulo usa el mismo verificador de rutas que el test global, centralizado en `support/navigation-smoke.js`. `support/internal-api.js` (antes `internal/support/internal-api.js`) lo comparten la auditoría interna y algunos tests de movimientos/cuentas corrientes.

## Instalación segura

1. Respaldá tu `frontend/tests/` actual.
2. Sustituí `frontend/tests/` **entera** con la del ZIP (no mezcles carpetas antiguas y nuevas: los specs viejos de la raíz quedarían duplicados y `ejecutar.cjs` los marcaría como "sin dueño").
3. Mantené `playwright.config.*`, `package.json`, `.env.playwright` y todo el resto de la aplicación tal como están.
4. Los datos de autenticación `tests/.auth/user.json` **no** están incluidos; los regenera `setup/auth.setup.js`.
5. Abrí PowerShell dentro de `frontend` y usá los comandos del TXT.

## Requisito del backend para la suite mutable

- Staging: el `.env` privado del backend debe tener `BALTO_E2E_TOOLS_ENABLED=1`.
- Producción: debe quedar `BALTO_E2E_TOOLS_ENABLED=0`.
- Si `PW_ALLOW_MUTATIONS=1` y el flag del backend está apagado, la suite falla antes de mutar datos. Es intencional.
- Usar `PW_ALLOW_MUTATIONS=1` únicamente con el tenant E2E aislado.

## Limpieza automática

- Al iniciar la corrida se eliminan residuos PW-* de corridas anteriores.
- Al terminar cada worker se eliminan los datos PW-* de esa corrida, incluso si un test falla.
- Si una corrida se corta: `node tests/cleanup-now.mjs`.

## Pruebas sin navegador (no las corre `ejecutar.cjs`)

```powershell
node tests/unit/descuento-general.unit.mjs
node tests/unit/stock-fixtures-plan.unit.cjs
node tests/unit/generar-paridad-descuentos.mjs <salida.json>
```

Los `*.regression.cjs` de la raíz se ejecutan dentro de `movimientos/41-presupuesto-modelo-titulo-pdf.spec.js` y `movimientos/48-descuentos-generales.spec.js`.

## Alcance técnico y límites

Reorganizar los tests no crea pruebas para todos los botones y escenarios. Las pruebas existentes se preservan y se agregó cobertura de **navegación** por módulo; las funcionalidades sin tests automatizados previos requieren casos nuevos para afirmar cobertura completa.

Los resultados E2E reales siguen pendientes de ejecución contra un **tenant E2E aislado**, para no afectar datos reales.

Los desafíos 403 del CDN de Hostinger no se resuelven reubicando archivos; la selección modular reduce la cantidad de peticiones.
