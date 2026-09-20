import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './support/test.js';
import { ENV } from './support/env.js';
import { uniqueName } from './support/data.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { requireMutations } from './support/ui.js';
import {
  cleanupTestUser,
  createEmployeeTestUser,
  loginTestUserInNewContext,
} from './support/users.js';

function apiPhpUrl(action, query = {}) {
  const url = new URL(`${ENV.apiURL.replace(/\/+$/, '')}/api.php`);
  url.searchParams.set('action', action);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function directModuleUrl(relativePath) {
  const routesBase = new URL(`${ENV.apiURL.replace(/\/+$/, '')}/`);
  return new URL(`../modules/${relativePath.replace(/^\/+/, '')}`, routesBase).toString();
}

async function jsonResponse(response) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status(), body, text };
}

function findLocalApiRoot() {
  const candidates = [
    path.resolve(process.cwd(), '..', 'api'),
    path.resolve(process.cwd(), 'api'),
    path.resolve(process.cwd(), '..', '..', 'api'),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'routes', 'api.php'))) || '';
}

function sourceWithoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '');
}

test('@security @critical sesión: session_key por URL ya no autentica; sólo X-Session', async ({ page }) => {
  await page.goto('/panel/dashboard');
  const sessionKey = await page.evaluate(() => String(localStorage.getItem('session_key') || '').trim());
  expect(sessionKey).not.toBe('');

  const response = await page.context().request.get(
    apiPhpUrl('auth_session_check', { session_key: sessionKey }),
    { headers: { Accept: 'application/json' }, failOnStatusCode: false },
  );
  const result = await jsonResponse(response);
  expect([401, 403], `La sesión por query string debe ser rechazada: ${result.text}`).toContain(result.status);
  expect(result.body?.exito === true || result.body?.success === true).toBe(false);
});

test('@security @critical acceso directo a modules está bloqueado y no saltea routes/api.php', async ({ page }) => {
  const response = await page.context().request.get(directModuleUrl('global/route.php'), {
    headers: { Accept: 'application/json' },
    failOnStatusCode: false,
  });
  expect(
    [403, 404],
    `Un PHP interno bajo /modules no debe ejecutarse directamente. HTTP ${response.status()}`,
  ).toContain(response.status());
});

test('@security @roles @critical EMPLEADO conserva lo permitido y backend bloquea módulos administrativos', async ({ page, browser }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);

  const username = uniqueName('POLICY-EMPLEADO', 36);
  const password = 'Pw!123456';
  let context = null;
  let employeeId = 0;

  try {
    await createEmployeeTestUser(page, username, password);
    const employeeSession = await loginTestUserInNewContext(browser, username, password);
    context = employeeSession.context;
    const employeePage = employeeSession.page;

    const allowed = [
      ['dashboard_resumen', {}],
      ['ventas_listar', { q: `PW-POLICY-${Date.now()}`, limit: 1, offset: 0 }],
      ['recibos_listar', { q: `PW-POLICY-${Date.now()}`, limit: 1, offset: 0 }],
      ['flujo_caja_resumen', { fecha_desde: new Date().toISOString().slice(0, 10), fecha_hasta: new Date().toISOString().slice(0, 10) }],
      // Dependencia crítica de Ventas que casi se bloquea durante el hardening.
      ['config_facturacion_get', {}],
    ];

    for (const [action, query] of allowed) {
      const result = await authenticatedApi(employeePage, action, { query });
      expect(
        result.status,
        `EMPLEADO debe conservar acceso a ${action}: HTTP ${result.status} ${result.text}`,
      ).toBeLessThan(400);
      expect(result.body?.codigo).not.toBe('ACCION_NO_AUTORIZADA_POR_ROL');
    }

    const forbidden = [
      'configuracion_usuarios_listar',
      'config_saldos_iniciales_get',
      'cc_clientes_listar',
      'cheques_cartera_listar',
      'servicios_articulos_listar',
      'contabilidad_iva_ventas',
    ];

    for (const action of forbidden) {
      const result = await authenticatedApi(employeePage, action);
      expect(result.status, `${action} debe quedar bloqueada para EMPLEADO`).toBe(403);
      expect(result.body?.codigo).toBe('ACCION_NO_AUTORIZADA_POR_ROL');
    }

    // Después de iniciar sesión existe login_auditoria: el hard-delete normal debe
    // bloquearse para conservar trazabilidad y exigir baja lógica.
    const list = await authenticatedApi(page, 'configuracion_usuarios_listar');
    const listBody = expectApiSuccess(list, 'No se pudo localizar el empleado E2E');
    const row = (Array.isArray(listBody?.usuarios) ? listBody.usuarios : []).find(
      (item) => String(item?.usuario || '').trim().toUpperCase() === username.toUpperCase(),
    );
    employeeId = Number(row?.idUsuarioMaster || row?.id_usuario_master || 0);
    expect(employeeId).toBeGreaterThan(0);

    const hardDelete = await authenticatedApi(page, 'configuracion_usuarios_eliminar', {
      method: 'POST',
      body: { idUsuarioMaster: employeeId },
    });
    expect(hardDelete.status).toBe(409);
    expect(hardDelete.body?.requiere_baja_logica).toBe(true);
    expect(String(hardDelete.body?.mensaje || '')).toMatch(/historial|desactiv/i);

    const deactivate = await authenticatedApi(page, 'configuracion_usuarios_estado', {
      method: 'POST',
      body: { idUsuarioMaster: employeeId, activo: 0 },
    });
    expectApiSuccess(deactivate, 'La baja lógica del empleado auditado debe funcionar');
  } finally {
    if (context) await context.close().catch(() => null);
    // El hard-delete de un usuario con login_auditoria debe fallar por diseño. El
    // cleanup global E2E del worker elimina la huella PW-* de forma controlada.
    await cleanupTestUser(page, username);
  }
});

test('@hardening contrato local del backend: permisos, migraciones, errores y runtime sin DDL', async () => {
  const apiRoot = findLocalApiRoot();
  test.skip(!apiRoot, 'El checkout local no incluye ../api; la cobertura live anterior sigue activa.');

  const read = (relative) => fs.readFileSync(path.join(apiRoot, relative), 'utf8');
  const router = read('routes/api.php');
  const session = read('modules/login/require_session.php');
  const policy = read('modules/login/action_policy.php');
  const modulesHtaccess = read('modules/.htaccess');
  const e2eRoute = read('modules/configuracion/testing/route.php');
  const errorResponse = read('modules/global/error_response.php');

  expect(router).toMatch(/action_policy\.php/);
  expect(router).toMatch(/balto_authorize_private_action/);
  expect(router).toMatch(/error_response\.php/);
  expect(policy).toMatch(/ACCION_NO_AUTORIZADA_POR_ROL/);

  expect(session).toMatch(/balto_auth_header\(['"]X-Session['"]\)/);
  expect(session).not.toContain("$_GET['session_key']");
  expect(session).not.toContain("$_POST['session_key']");
  expect(session).not.toContain("$_REQUEST['session_key']");

  expect(modulesHtaccess).toMatch(/Require\s+all\s+denied|Deny\s+from\s+all/i);
  expect(e2eRoute).toContain("BALTO_E2E_TOOLS_ENABLED");
  expect(e2eRoute).toMatch(/balto_env_bool\(['"]BALTO_E2E_TOOLS_ENABLED['"],\s*false\)/);
  expect(errorResponse).toMatch(/request_id/i);

  const migrationFiles = [
    'migrations/master/2026-09-19_hardening_backend_master.sql',
    'migrations/tenant/2026-09-19_hardening_backend_tenant.sql',
    'migrations/README.md',
    'migrations/.htaccess',
  ];
  for (const relative of migrationFiles) {
    expect(fs.existsSync(path.join(apiRoot, relative)), `Debe conservarse ${relative}`).toBe(true);
  }

  const runtimeSchemaFiles = [
    'modules/configuracion/usuarios/service.php',
    'modules/configuracion/facturacion/facturacion.php',
    'modules/configuracion/saldos_iniciales/service.php',
    'modules/movimientos/facturacion/arca_operaciones.php',
    'modules/movimientos/presupuestos/repositories/PresupuestosRepository.php',
  ];
  for (const relative of runtimeSchemaFiles) {
    const clean = sourceWithoutComments(read(relative));
    expect(clean, `${relative} no debe migrar esquema durante requests`).not.toMatch(/\bCREATE\s+TABLE\b|\bALTER\s+TABLE\b/i);
  }

  const budgets = read('modules/movimientos/presupuestos/repositories/PresupuestosRepository.php');
  const listStart = budgets.indexOf('public function listarPresupuestos');
  const listEnd = budgets.indexOf('public function obtenerDetallePresupuesto', listStart);
  expect(listStart).toBeGreaterThanOrEqual(0);
  expect(listEnd).toBeGreaterThan(listStart);
  expect(budgets.slice(listStart, listEnd)).not.toContain('limpiarConversionesHuerfanas');
});
