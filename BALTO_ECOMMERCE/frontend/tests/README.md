# BALTO eCommerce — Testing Playwright

Suite E2E de la tienda online, armada igual que la de BALTO Comercio: specs numerados,
carpeta `soporte/` con el entorno, la fixture común, la API, los flujos y los datos,
protecciones para no escribir en producción y scripts por lotes en PowerShell.

Cubre **las 27 acciones** de `api/routes/api.php` y **todas las pantallas** de la web.
`14-cobertura-acciones.spec.js` hace fallar la suite si alguien agrega una acción o mueve
archivos sin actualizar los tests: la suite se mantiene al 100 %.

## Instalación

Desde `BALTO_ECOMMERCE/frontend`:

1. Reemplazá la carpeta `tests/` por la de este ZIP (no la mezcles con la vieja).
2. Copiá `playwright.config.js` y `.env.playwright` en la raíz del frontend.
3. Si descomprimiste el `src` nuevo encima del viejo, ejecutá
   `.\tests\herramientas\limpiar-estructura-vieja.ps1` (borra solo carpetas viejas).
4. `npx playwright install chromium` (una sola vez).

Playwright levanta `npm start` solo (o reutiliza el que ya está corriendo en el puerto 3002).
Las pruebas van por el proxy `/ecom-api` (`src/setupProxy.js`) hacia `PW_API_URL`, igual que la web.

## Comandos (PowerShell, desde `BALTO_ECOMMERCE/frontend`)

```powershell
# Suite completa
npx playwright test --project=chromium --workers=1 --reporter=list

# Smoke rápido (@smoke de toda la suite, sin escrituras)
.\tests\herramientas\test-rapido.ps1

# Por lote: smoke, navegacion, tienda, catalogo, carrito, checkout, pagos, cuenta, api, movil, todo
.\tests\herramientas\test-lote.ps1 checkout
.\tests\herramientas\test-lote.ps1 cuenta -Visible

# Solo lo afectado por lo que cambiaste (git diff)
.\tests\herramientas\test-segun-cambios.ps1

# Listar sin ejecutar
npx playwright test --list
```

## Specs

| Spec | Qué prueba | Acciones |
|---|---|---|
| `00-preflight` | `.env.playwright`, proxy, tienda en MASTER, protección de producción | `ping`, `tienda_configuracion` |
| `01-tienda` | Configuración pública, estado de conexiones, SEO/color, pantalla de error | `tienda_configuracion`, `tienda_estado` |
| `02-navegacion` | Todas las rutas, menú, buscador, pie, 404, panel del carrito | — |
| `03-catalogo` | Listado, límites, paginación, filtros, orden, categorías, inicio | `catalogo_productos` |
| `04-producto-favoritos` | Ficha, variantes, placeholder, error, imágenes R2, favoritos, agregado rápido | `catalogo_producto`, `producto_imagen` |
| `05-carrito` | Validación en servidor, cantidades, variantes, decimales, persistencia, stock | `carrito_validar` |
| `06-checkout` | Validaciones, retiro/envío, doble clic, errores, borrador, medio de pago, pedido real de prueba | `checkout_crear` |
| `07-pagos` | Transferencia, comprobante (carga, revisión, descarga), efectivo, autorización por token | `pagos_metodos_disponibles`, `pago_*` |
| `08-geografia-direccion` | Provincias, localidades, CPA, validaciones de domicilio, caída de Georef | `geografia_*` |
| `09-autenticacion` | Login con Google (simulado), destino seguro, errores, logout, invitado | `auth_*` |
| `10-cuenta-perfil` | Mis datos, validaciones, CSRF | `cliente_perfil`, `cliente_actualizar` |
| `11-cuenta-direcciones` | Alta, predeterminada, edición, baja, uso en el checkout | `cliente_direccion*` |
| `12-cuenta-pedidos` | Listado paginado, detalle, estado del pago, comprobante con sesión | `cliente_pedidos`, `cliente_pedido_detalle` |
| `13-contrato-api` | Para CADA acción: método, preflight CORS, origen ajeno, sesión, cabeceras; CSRF | todas |
| `14-cobertura-acciones` | Acciones del frontend = catálogo = pruebas; estructura de carpetas | — |
| `15-movil` | Sin scroll horizontal, carrito/checkout y menú en móvil | — |

## Cómo trabaja (igual que Comercio)

- **`soporte/test.js`**: todos los specs importan `test` de acá. Cada test arranca limpio,
  bloquea Google real y tiene **diagnóstico automático**: si la página tira un error de
  JavaScript o la API responde 5xx, el test falla aunque sus `expect` hayan pasado.
- **`soporte/entorno.js`**: lee `.env.playwright` y los `.env` del frontend; detecta staging
  (`balto.3devsnet.com`) o producción (`app.balto.com.ar`).
- **Datos reales**: los productos se descubren de la API (`soporte/catalogo.js`). Si la tienda
  no tiene el caso (variantes, decimales, sin imagen…), el test se salta con el motivo.
- **API simulada** (`soporte/simulador.js`): para probar la interfaz sin escribir en la base
  (checkout, pagos, cuenta) se interceptan solo esas acciones y se responde con el **mismo
  formato del servidor real**. El resto de las acciones van al servidor.
- **`RUN_PREFIX`** (`soporte/datos.js`): todo lo que la suite escribe lleva `PW-…` en
  observaciones/referencias, para reconocerlo.

## Modos y protecciones

| Variable (`.env.playwright`) | Efecto |
|---|---|
| `PW_ALLOW_MUTATIONS=1` | Habilita los tests `@mutations`: pedido real de prueba (`T-…`) y comprobante real. **Solo staging.** |
| `PW_ALLOW_PRODUCTION=1` | Permite escrituras si `PW_API_URL` es producción. Dejalo en `0`. |
| `PW_SESION_COMPRADOR` | Cookie de un comprador de prueba: la cuenta se prueba contra el servidor real. |
| `PW_START_FRONTEND=0` | No levanta `npm start` (usa el que ya está corriendo). |

- Los pedidos reales **solo** se crean en **modo PRUEBA**: el proxy local necesita
  `BALTO_ECOMMERCE_CHECKOUT_TEST_TOKEN` en `.env.development.local` (el mismo valor que
  `ECOMMERCE_CHECKOUT_TEST_TOKEN` del servidor). Son pedidos `T-…`: no generan ventas, no
  descuentan stock ni registran pagos. Llevan `PEDIDO DE PRUEBA AUTOMATIZADO - NO PREPARAR - PW-…`.
- Con checkout público (sin modo prueba) la suite **nunca** confirma pedidos reales.

### Sesión real de comprador (opcional)

Google no se puede automatizar. Para probar la cuenta contra el servidor real:

1. `npm start`, abrí `http://localhost:3002/iniciar-sesion` e ingresá con una cuenta de Google **de prueba**.
2. DevTools → Application → Cookies → `http://localhost:3002` → copiá el valor de `balto_dev_ecs_<id>`.
3. Pegalo en `PW_SESION_COMPRADOR=` de `.env.playwright`.

Con la sesión real, perfil y direcciones se modifican solo con `PW_ALLOW_MUTATIONS=1` y la
suite **deja todo como estaba** (restaura el perfil y borra las direcciones `PW-…`).
Sin la cookie, esas pruebas corren con la API simulada. La sesión vence: si el preflight de la
cuenta avisa que no es válida, volvé a copiarla.

## Pruebas del backend (PHP)

Están en `api/tests/` del backend (no se suben a Hostinger):

```bash
php tests/unitarias/prueba_unidades.php
php tests/unitarias/prueba_cuentas_unidades.php
php tests/prueba_api_sin_mysql.php
php tests/integracion/ejecutar_integracion.php
php tests/integracion/ejecutar_cuentas.php
php tests/integracion/ejecutar_pagos.php
```

## Pruebas unitarias del frontend

Los `*.test.js` viven junto al código que prueban (`src/componentes/<modulo>/utilidades/`) y
se ejecutan con `npm test` (Jest de Create React App).
