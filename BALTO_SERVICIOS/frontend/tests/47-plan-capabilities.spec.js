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

// Matriz aprobada: trabajadores/costos desde 1; materiales e insumos (catálogo
// económico, venta y composición) desde 2; control de stock, pestaña Stock y
// productos sólo en 3.
const MATRIX = {
  1: { workers: true, costing: true, resources: false, resourcesSell: false, stock: false, stockPanel: false, products: false },
  2: { workers: true, costing: true, resources: true, resourcesSell: true, stock: false, stockPanel: false, products: false },
  3: { workers: true, costing: true, resources: true, resourcesSell: true, stock: true, stockPanel: true, products: true },
};

const today = new Date().toISOString().slice(0, 10);

/** Acción restringida -> capacidad, con un payload que NUNCA muta datos si es aceptado (falla validación). */
const GUARDED_ACTIONS = [
  { action: 'servicios_material_crear', method: 'POST', body: {}, cap: 'resources.manage' },
  { action: 'servicios_insumo_crear', method: 'POST', body: {}, cap: 'resources.manage' },
  { action: 'servicios_materiales_listar', method: 'GET', query: {}, cap: 'resources.manage' },
  { action: 'servicios_modulo_cargar', method: 'GET', query: { seccion: 'inventario' }, cap: 'resources.manage' },
  // Pestaña Stock y ajustes manuales: sólo plan 3.
  { action: 'servicios_stock_ajustar', method: 'POST', body: { id_articulo: 0 }, cap: 'stock.panel' },
  { action: 'servicios_stock_listar', method: 'GET', query: {}, cap: 'stock.panel' },
  { action: 'servicios_stock_historial', method: 'GET', query: { id_articulo: 0 }, cap: 'stock.panel' },
  // Asignar trabajadores es del plan 1; los materiales se validan por colección.
  { action: 'servicios_composicion_guardar', method: 'POST', body: { id_servicio: 0 }, cap: 'services.workers' },
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
      const m = MATRIX[plan.nivel];
      expect(plan.can('workers.manage')).toBe(m.workers);
      expect(plan.can('services.workers')).toBe(m.workers);
      expect(plan.can('services.costing')).toBe(m.costing);
      expect(plan.can('resources.manage')).toBe(m.resources);
      expect(plan.can('services.composition')).toBe(m.resources);
      expect(plan.can('resources.sell')).toBe(m.resourcesSell);
      expect(plan.can('resources.stock')).toBe(m.stock);
      expect(plan.can('stock.panel')).toBe(m.stockPanel);
      expect(plan.can('products.sell')).toBe(m.products);
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
      await expect(page.getByRole('button', { name: /^Materiales$/ })).toHaveCount(1);
      await expect(page.getByRole('button', { name: /^Insumos$/ })).toHaveCount(1);
      // Plan 2: Materiales/Insumos sin columna Stock; plan 3: con columna Stock.
      await page.getByRole('button', { name: /^Materiales$/ }).click();
      await waitForBusyToFinish(page);
      const stockTexts = await page.getByText('Stock', { exact: true }).count();
      if (plan.can('resources.stock')) expect(stockTexts).toBeGreaterThan(0);
      else expect(stockTexts, 'Plan 2: sin columna ni pestaña Stock').toBe(0);
      const stockTab = page.getByRole('button', { name: /^Stock$/ });
      await expect(stockTab).toHaveCount(plan.can('stock.panel') ? 1 : 0);
      if (plan.can('stock.panel')) {
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
    const conComposicion = plan.can('services.workers') || plan.can('services.composition');
    await expect(dialog.getByRole('tab', { name: /Composición del servicio/i })).toHaveCount(conComposicion ? 1 : 0);
    await expect(dialog.getByText('Otros costos')).toHaveCount(plan.can('services.costing') ? 1 : 0);
    await expect(dialog.getByText('Margen deseado (%)')).toHaveCount(plan.can('services.costing') ? 1 : 0);
    if (conComposicion) {
      await dialog.getByRole('tab', { name: /Composición del servicio/i }).click();
      // Trabajadores desde el plan 1; materiales e insumos desde el plan 2.
      await expect(dialog.getByRole('heading', { name: 'Mano de obra' })).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Materiales e insumos' })).toHaveCount(plan.can('services.composition') ? 1 : 0);
      await dialog.getByRole('tab', { name: /Información principal/i }).click();
    }
    await expect(dialog.getByText('Duración estimada (min)')).toHaveCount(1);
    await expect(dialog.getByText('IVA aplicado')).toHaveCount(1);
    await dialog.getByRole('button', { name: /Cancelar/i }).click();
  });

  test('@planes @ui la venta ofrece materiales desde el plan 2 y productos sólo en el plan 3', async ({ page }) => {
    const plan = await getSessionPlan(page);
    await page.goto('/panel/ventas', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Nueva Venta/i }).click();
    const dialog = await waitDialog(page, 'Nueva Venta');
    const typeSelect = dialog.getByRole('combobox', { name: /Tipo de ítem fila 1/i });
    const options = await typeSelect.locator('option').allTextContents();
    // Plan 1: Servicio + Detalle manual. Plan 2: + "Material / insumo". Plan 3: "Stock / material / insumo".
    expect(options.some((o) => /Stock \/ material \/ insumo/i.test(o))).toBe(plan.can('products.sell'));
    expect(options.some((o) => /^\s*Material \/ insumo\s*$/i.test(o))).toBe(plan.can('resources.sell') && !plan.can('products.sell'));
    expect(options.some((o) => /Servicio del catálogo/i.test(o))).toBe(true);
    expect(options.some((o) => /Detalle manual/i.test(o))).toBe(true);
    if (plan.can('resources.sell') && !plan.can('resources.stock')) {
      // Plan 2: el buscador lista materiales/insumos sin mensajes de stock.
      await typeSelect.selectOption('ARTICULO');
      const search = dialog.getByPlaceholder(/Buscá un material o insumo/i);
      await search.click();
      await expect(page.locator('.psa-meta').filter({ hasText: /Stock|sin control de stock/i })).toHaveCount(0);
      await expect(dialog.getByText(/Sin stock|Stock insuficiente|Stock máximo disponible/i)).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
  });

  test('@planes @ui el alta de material no ofrece control de stock en el plan 2', async ({ page }) => {
    const plan = await getSessionPlan(page);
    test.skip(!plan.can('resources.manage'), 'El plan no incluye materiales.');
    await page.goto('/panel/servicios?seccion=inventario', { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /^Materiales$/ }).click();
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Agregar material/i }).first().click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog.getByText(/Controlar stock de este material/i)).toHaveCount(plan.can('resources.stock') ? 1 : 0);
    await expect(dialog.getByText(/^Stock inicial$/)).toHaveCount(0); // sólo aparece al activar el control
    await expect(dialog.getByText(plan.can('resources.stock') ? 'Stock y valores' : 'Costos y valores', { exact: true })).toHaveCount(1);
    await dialog.getByRole('button', { name: /Cancelar/i }).click();
  });

  test('@planes @crud servicio con trabajadores: costos, edición sin pérdida y materiales por plan', async ({ page }) => {
    await requireMutations(test, page);
    const plan = await getSessionPlan(page);
    const unit = await ensureActiveServiceUnit(page);
    const name = uniqueName('CONSULTORIA-TECNICA', 120);
    const workerName = uniqueName('JUAN-PEREZ', 120);
    let idServicio = 0;
    let idTrabajador = 0;
    try {
      // Trabajadores: todos los planes.
      const worker = expectApiSuccess(await serviciosApi(page, 'servicios_trabajador_crear', {
        method: 'POST',
        body: { nombre: workerName, rol: 'CONSULTOR E2E', tipo_trabajador: 'CONTRATADO', modalidad_pago: 'HORA', monto_periodo: 10000, horas_periodo: 1 },
      }), 'Alta de trabajador');
      idTrabajador = Number(worker.id_trabajador || worker.data?.id_trabajador || 0);
      expect(idTrabajador).toBeGreaterThan(0);

      // Ejemplo aprobado: $50.000 neto, 2 h × $10.000, otros $5.000 => costo $25.000, ganancia $25.000.
      const created = expectApiSuccess(await serviciosApi(page, 'servicios_servicio_crear', {
        method: 'POST',
        body: {
          nombre: name,
          id_unidad_cobro: Number(unit.id_unidad),
          duracion_estimada_minutos: 120,
          precio_venta: 50000,
          iva_pct: 21,
          costo_base: 5000,
          composicion: { trabajadores: [{ id_trabajador: idTrabajador, horas_estimadas: 2 }] },
        },
      }), 'Alta de servicio con trabajador');
      idServicio = Number(created.id_servicio || created.data?.id_servicio || 0);
      expect(idServicio).toBeGreaterThan(0);
      expect(created.servicio?.trabajadores || []).toHaveLength(1);
      expect(created.servicio?.articulos || []).toHaveLength(0);
      expect(Number(created.servicio?.costo_mano_obra)).toBeCloseTo(20000, 2);
      expect(Number(created.servicio?.costo_estimado)).toBeCloseTo(25000, 2);
      expect(Number(created.servicio?.precio_venta) - Number(created.servicio?.costo_estimado)).toBeCloseTo(25000, 2);

      // Edición sin enviar composición: conserva los trabajadores.
      const edited = expectApiSuccess(await serviciosApi(page, 'servicios_servicio_actualizar', {
        method: 'POST',
        body: { id_servicio: idServicio, precio_venta: 55000, iva_pct: 10.5 },
      }), 'Edición de servicio');
      expect(Number(edited.servicio?.iva_pct)).toBe(10.5);
      expect(edited.servicio?.trabajadores || []).toHaveLength(1);

      // Cambiar horas: permitido en todos los planes.
      const hours = expectApiSuccess(await serviciosApi(page, 'servicios_servicio_actualizar', {
        method: 'POST',
        body: { id_servicio: idServicio, composicion: { trabajadores: [{ id_trabajador: idTrabajador, horas_estimadas: 3 }] } },
      }), 'Cambio de horas');
      expect(Number(hours.servicio?.costo_estimado)).toBeCloseTo(35000, 2);

      // Payload manipulado con materiales: plan 1 => 403 de plan; planes 2/3 => validación propia (artículo inexistente).
      const withArticles = await serviciosApi(page, 'servicios_servicio_actualizar', {
        method: 'POST',
        body: { id_servicio: idServicio, composicion: { articulos: [{ id_articulo: 999999999, cantidad: 1 }] } },
      });
      expect(isPlanDenied(withArticles)).toBe(!plan.can('services.composition'));
      if (plan.can('services.composition')) expect(withArticles.status).toBe(422);
    } finally {
      if (idServicio) {
        await serviciosApi(page, 'servicios_servicio_eliminar', { method: 'POST', body: { id_servicio: idServicio } }).catch(() => null);
      }
      if (idTrabajador) {
        await serviciosApi(page, 'servicios_trabajador_eliminar', { method: 'POST', body: { id_trabajador: idTrabajador } }).catch(() => null);
      }
    }
  });
});
