# BALTO Comercio — Testing Playwright (carpeta depurada)

La carpeta contiene los tests vigentes de BALTO Comercio y sus helpers. La regresión
sobre **fecha única** se concentra ahora en `54-politica-fechas-importes-pagos.spec.js`;
los casos de los antiguos `52`, `53`, `55` y `56` fueron **trasladados íntegros** a ese
archivo, sin crear tests adicionales. Los números no se renumeraron para evitar
romper referencias conocidas.

## Reemplazo

Reemplazá la carpeta `BALTO_COMERCIO/frontend/tests` por el directorio `tests/`
incluido en el ZIP. El archivo `.auth/user.json` **no viene**: contiene sesiones y
Playwright lo regenera durante `auth.setup.js` (usa `.env.playwright`, que no se
incluye ni se modifica). No mezcles encima de la carpeta vieja: quedarían tests
obsoletos que queremos eliminar.

## Comandos (PowerShell, desde `BALTO_COMERCIO/frontend`)

**Regresión de fechas y saldos (incluye pruebas UI, API, cuentas corrientes,
cheques, presupuestos y conciliación):**

```powershell
npx playwright test tests/00-preflight.spec.js tests/50-analisis-financiero-saldos.spec.js tests/51-saldos-historicos-conciliacion.spec.js tests/54-politica-fechas-importes-pagos.spec.js --project=chromium --workers=1 --reporter=list --max-failures=1
```

**Ajustes de saldos de caja (Flujo de Caja) + regresión de saldos:**

```powershell
npx playwright test tests/00-preflight.spec.js tests/55-ajustes-saldos-caja.spec.js tests/24-initial-balances.spec.js tests/50-analisis-financiero-saldos.spec.js tests/51-saldos-historicos-conciliacion.spec.js --project=chromium --workers=1 --reporter=list --max-failures=1
```

`55` tiene tres bloques: interfaz con mocks (no escribe), API de sólo lectura y
mutaciones reales (`@mutations`, sólo con `PW_ALLOW_MUTATIONS=1`, tenant E2E y la
migración `tesoreria_ajustes_saldo` aplicada). Los ajustes de prueba llevan el
RUN_PREFIX en observaciones y el limpiador E2E los elimina (reversiones primero).

**Regresión de movimientos relacionada:**

```powershell
npx playwright test tests/04-purchases-credit-note.spec.js tests/05-sales-credit-note.spec.js tests/06-budgets.spec.js tests/07-other-movements.spec.js tests/08-current-accounts.spec.js tests/15-cheques-lifecycle.spec.js tests/36-grouped-payment-current-account-regression.spec.js --project=chromium --workers=1 --reporter=list --max-failures=1
```

**Regresión completa:**

```powershell
npx playwright test --project=chromium --workers=1 --reporter=list
```

**Listar pruebas sin ejecutarlas:**

```powershell
npx playwright test --list
```

## Seguridad / alcance

- Ejecutar los tests con mutaciones **sólo contra staging o una base de pruebas**,
  con el guard E2E del backend habilitado y sin emisiones ARCA reales.
- Las pruebas de Tienda Nube que están intencionalmente `skip` se preservan: no
  habilites sincronización real para hacerlas pasar.
- Un `skip` condicionado por el tenant/las aperturas no es necesariamente basura.
- `cleanup-now.mjs` es una utilidad activa de limpieza y se conservó.
- `support/env.selector.js` puede ser cargado por `playwright.config.js`, que
  está fuera de esta carpeta; **no** se elimina aunque los specs no lo importen.
- Las pruebas por sí solas no prueban que Hostinger tenga desplegado el mismo backend.

## Qué se quitó

- `23-internal-navigation-smoke.spec.js`: rutas repetidas y validación más débil
  que `02-navigation-smoke.spec.js`.
- `example.spec.js`: navegación al dashboard cubierta por `02`.
- `52`, `53`, `55`, `56`: contenido consolidado en `54` (no se descartan casos).
- Backup `.bak`, `ejecucion.txt` con comandos viejos, helper `arca-safety.js`
  sin referencias activas y `.auth/user.json` (sesión privada generada).

No se cambiaron los tests de stock, Tienda Nube, facturación, configuración,
exportación, cheques ni seguridad que verifican funcionalidades distintas.
