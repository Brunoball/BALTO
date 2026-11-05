import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';
import { ensureActiveServiceUnit, serviciosApi } from './support/services.js';
import { getSessionPlan, isPlanDenied, PLAN_DENIED_CODE } from './support/plan.js';

/**
 * División de planes de BALTO Servicios.
 *
 * La suite se adapta al plan REAL del tenant de la sesión (MASTER). Para validar
 * los tres planes, correrla tres veces cambiando el plan del tenant de staging:
 *
 *   UPDATE tenants SET idPlan = 1 WHERE idTenant = <staging>;  -- Servicios Profesionales
 *   PW_EXPECTED_PLAN=1 npx playwright test tests/47-plan-capabilities.spec.js --project=chromium --workers=1
 *   (repetir con 2 y 3; volver al plan original al terminar)
 *
 * Nunca correr contra producción: usa mutaciones con prefijo E2E y limpieza.
 */

const MATRIX = {
  1: { resources: false, products: false, costing: false },
  2: { resources: true, products: false, costing: true },
  3: { resources: true, products: true, costing: true },
};

const today = new Date().toISOString().slice(0, 10);

/** Acción restringida -> capacidad, con un payload que NUNCA muta datos si es aceptado (falla validación). */
const GUARDED_ACTIONS = [
  { action: 'servicios_material_crear', method: 'POST', body: {}, cap: 'resources.manage' },
  { action: 'servicios_insumo_crear', method: 'POST', body: {}, cap: 'resources.manage' },
  { action: 'servicios_materiales_listar', method: 'GET', query: {}, cap: 'resources.manage' },
  { action: 'servicios_modulo_cargar', method: 'GET', query: { seccion: 'inventario' }, cap: 'resources.manage' },
  { action: 'servicios_stock_ajustar', method: 'POST', body: { id_articulo: 0 }, cap: 'resources.stock' },
  { action: 'servicios_stock_listar', method: 'GET', query: {}, cap: 'resources.stock' },
  { action: 'servicios_composicion_guardar', method: 'POST', body: { id_servicio: 0 }, cap: 'services.composition' },
  { action: 'servicios_trabajadores_listar', method: 'GET', query: {}, cap: 'workers.manage' },
  { action: 'servicios_stock_producto_crear', method: 'POST', body: {}, cap: 'products.manage' },
  // Payload manipulado: alta de PRODUCTO por la API genérica de artículos.
  { action: 'servicios_articulo_crear', method: 'POST', body: { tipo: 'PRODUCTO' }, cap: 'products.manage' },
  { action: 'servicios_articulos_listar', method: 'GET', query: { tipo: 'PRODUCTO' }, cap: 'products.manage' },
  { action: 'analisis_financiero_rentabilidad', method: 'GET', query: { fecha_desde: today, fecha_hasta: today }, cap: 'services.costing' },
];

test.describe('BALTO Servicios - división de planes', () => {
  test('@planes la sesión expone el plan y capacidades acumulativas del backend', async ({ page }) => {
    const plan = await getSessionPlan(page);
    expect(plan.status).toBe(200);
    expect(plan.capacidades.length).toBeGreaterThan(0);
    expect(plan.firma).not.toBe('');

    const expected = Number(process.env.PW_EXPECTED_PLAN || 0);
    if (expected) expect(plan.nivel, 'El tenant de staging no está en el plan esperado').toBe(expected);

    // Herencia: todo plan conserva las capacidades comunes.
    for (const cap of ['services.manage', 'services.sell', 'budgets.manage', 'accounts.current', 'finance.manage']) {
      expect(plan.can(cap), cap).toBe(true);
    }
    if (!plan.esDemo) expect(plan.can('billing.arca')).toBe(true);
    if (plan.can('products.manage')) expect(plan.can('resources.manage')).toBe(true);
    if (plan.nivel && MATRIX[plan.nivel] && !plan.esDemo) {
      expect(plan.can('resources.manage')).toBe(MATRIX[plan.nivel].resources);
      expect(plan.can('products.sell')).toBe(MATRIX[plan.nivel].products);
      expect(plan.can('services.costing')).toBe(MATRIX[plan.nivel].costing);
    }
  });

  test('@planes @api cada acción restringida responde según el plan, con 403 sin logout', async ({ page }) => {
    const plan = await getSessionPlan(page);

    for (const item of GUARDED_ACTIONS) {
      const result = await authenticatedApi(page, item.action, {
        method: item.method,
        query: item.query,
        body: item.method === 'POST' ? item.body : undefined,
      });
      if (plan.can(item.cap)) {
        expect(isPlanDenied(result), `${item.action} no debe denegarse por plan (${item.cap} incluido)`).toBe(false);
      } else {
        expect(result.status, `${item.action} debe denegarse por plan`).toBe(403);
        expect(result.body?.codigo).toBe(PLAN_DENIED_CODE);
        expect(result.body?.capacidad).toBe(item.cap);
      }
    }

    // La denegación comercial no invalida la sesión.
    const after = await authenticatedApi(page, 'auth_session_check');
    expect(after.status).toBe(200);
    expect(after.body?.sesion_valida).toBe(true);
  });

  test('@planes @ui menú, ruta directa a Inventario y pestañas según el plan', async ({ page }) => {
    const plan = await getSessionPlan(page);

    await page.goto('/panel/servicios?seccion=inventario', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    if (plan.can('resources.manage')) {
      await expect(page).toHaveURL(/seccion=inventario/);
      await expect(page.locator('body')).toContainText(/Inventario de servicios/i);
      const stockTab = page.getByRole('button', { name: /^Stock$/ });
      await expect(stockTab).toHaveCount(plan.can('resources.stock') ? 1 : 0);
      if (plan.can('resources.stock')) {
        await stockTab.click();
        await waitForBusyToFinish(page);
        // Desktop y mobile pueden renderizar el botón dos veces: basta con su presencia.
        const addProduct = await page.getByRole('button', { name: /Agregar producto/i }).count();
        expect(addProduct > 0).toBe(plan.can('products.manage'));
      }
    } else {
      // Acceso escrito a mano: se redirige sin cerrar la sesión.
      await expect(page).toHaveURL(/\/panel\/dashboard/);
      await expect(page.locator('body')).not.toContainText(/Inventario de servicios/i);
    }

    await page.goto('/panel/servicios', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await expect(page.getByRole('button', { name: /^Trabajadores$/ })).toHaveCount(plan.can('workers.manage') ? 1 : 0);
    await expect(page.getByText('Inventario e insumos', { exact: true })).toHaveCount(plan.can('resources.manage') ? 1 : 0);
  });

  test('@planes @ui el modal de servicio es único y se configura por capacidades', async ({ page }) => {
    const plan = await getSessionPlan(page);
    await page.goto('/panel/servicios', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Agregar servicio/i }).first().click();
    const dialog = await waitDialog(page, 'Agregar servicio');
    await expect(dialog.getByText('Composición del servicio')).toHaveCount(plan.can('services.composition') ? 1 : 0);
    await expect(dialog.getByText('Otros costos')).toHaveCount(plan.can('services.costing') ? 1 : 0);
    await expect(dialog.getByText('Duración estimada (min)')).toHaveCount(1);
    await expect(dialog.getByText('IVA aplicado')).toHaveCount(1);
    await dialog.getByRole('button', { name: /Cancelar/i }).click();
  });

  test('@planes @ui la venta ofrece productos sólo con el plan con venta', async ({ page }) => {
    const plan = await getSessionPlan(page);
    await page.goto('/panel/ventas', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Nueva Venta/i }).click();
    const dialog = await waitDialog(page, 'Nueva Venta');
    const typeSelect = dialog.getByRole('combobox', { name: /Tipo de ítem fila 1/i });
    const options = await typeSelect.locator('option').allTextContents();
    expect(options.some((o) => /Stock \/ material \/ insumo/i.test(o))).toBe(plan.can('products.sell'));
    expect(options.some((o) => /Servicio del catálogo/i.test(o))).toBe(true);
    expect(options.some((o) => /Detalle manual/i.test(o))).toBe(true);
    await page.keyboard.press('Escape');
  });

  test('@planes @crud servicio profesional sin composición: alta, edición sin pérdida y baja', async ({ page }) => {
    await requireMutations(test, page);
    const plan = await getSessionPlan(page);
    const unit = await ensureActiveServiceUnit(page);
    const name = uniqueName('CONSULTA-PROFESIONAL', 120);
    let idServicio = 0;
    try {
      const created = expectApiSuccess(await serviciosApi(page, 'servicios_servicio_crear', {
        method: 'POST',
        body: {
          nombre: name,
          descripcion: 'CONSULTA DE 60 MINUTOS',
          id_unidad_cobro: Number(unit.id_unidad),
          duracion_estimada_minutos: 60,
          precio_venta: 30000,
          iva_pct: 21,
        },
      }), 'Alta de servicio sin composición');
      idServicio = Number(created.id_servicio || created.data?.id_servicio || 0);
      expect(idServicio).toBeGreaterThan(0);
      expect(Number(created.servicio?.precio_venta)).toBe(30000);
      expect(created.servicio?.articulos || []).toHaveLength(0);

      const edited = expectApiSuccess(await serviciosApi(page, 'servicios_servicio_actualizar', {
        method: 'POST',
        body: { id_servicio: idServicio, nombre: `${name}-ED`.slice(0, 150), precio_venta: 32000, iva_pct: 10.5 },
      }), 'Edición de servicio');
      expect(Number(edited.servicio?.iva_pct)).toBe(10.5);

      // Payload manipulado con composición: sólo se acepta si el plan la incluye.
      const withComposition = await serviciosApi(page, 'servicios_servicio_actualizar', {
        method: 'POST',
        body: { id_servicio: idServicio, composicion: { articulos: [], trabajadores: [{ id_trabajador: 999999, horas_estimadas: 1 }] } },
      });
      if (!plan.can('services.composition')) {
        expect(isPlanDenied(withComposition)).toBe(true);
      } else {
        expect(isPlanDenied(withComposition)).toBe(false);
      }
    } finally {
      if (idServicio) {
        await serviciosApi(page, 'servicios_servicio_eliminar', { method: 'POST', body: { id_servicio: idServicio } }).catch(() => null);
      }
    }
  });
});
