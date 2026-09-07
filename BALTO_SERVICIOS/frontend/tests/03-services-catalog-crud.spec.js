import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitDialog, waitForBusyToFinish } from './support/ui.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  serviciosApi,
} from './support/services.js';

async function apiGet(page, action, query = {}, label = action) {
  return expectApiSuccess(
    await serviciosApi(page, action, { query }),
    `Falló ${label}`,
  );
}

async function apiPost(page, action, body = {}, label = action) {
  return expectApiSuccess(
    await serviciosApi(page, action, { method: 'POST', body }),
    `Falló ${label}`,
  );
}

async function bestEffortPost(page, action, body = {}) {
  try {
    return await serviciosApi(page, action, { method: 'POST', body });
  } catch {
    return null;
  }
}

function idOf(body, key) {
  return Number(body?.[key] || body?.data?.[key] || 0);
}

function exactName(rows, name) {
  const expected = String(name).trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.nombre || '').trim().toUpperCase() === expected,
  );
}

async function waitQuickCategoryDialog(page) {
  // Selector estable: el modal rápido tiene aria-labelledby propio.
  // No usamos waitDialog('Agregar categoría') porque el formulario padre
  // también contiene la opción '+ AGREGAR CATEGORÍA' y, al cerrarse el
  // modal rápido, ese locator dinámico podía pasar a apuntar al padre.
  const dialog = page.locator(
    '[role="dialog"][aria-labelledby="servicios-quick-category-title"]',
  );
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('BALTO Servicios - catálogo principal', () => {
  test('@smoke @servicios ping, resumen, carga agregada y navegación del módulo', async ({ page }) => {
    await page.goto('/panel/servicios');
    await waitForBusyToFinish(page);

    const ping = await apiGet(page, 'servicios_ping');
    expect(ping.module).toBe('servicios');
    expect(ping.version).toBe('8.3-db16-stock-independiente');
    expect(ping.status).toBe('ok');
    expect(ping.areas).toEqual(expect.arrayContaining([
      'servicios', 'materiales', 'insumos', 'stock', 'trabajadores', 'unidades',
    ]));

    const resumen = await apiGet(page, 'servicios_resumen');
    expect(resumen.resumen).toBeTruthy();

    const catalogo = await apiGet(page, 'servicios_modulo_cargar', { seccion: 'servicios', limit: 1000 });
    expect(catalogo.seccion).toBe('servicios');
    for (const key of ['unidades', 'categorias_servicios', 'servicios', 'articulos', 'trabajadores']) {
      expect(Array.isArray(catalogo[key]), `${key} debe venir en la carga agregada`).toBe(true);
    }

    const inventario = await apiGet(page, 'servicios_modulo_cargar', { seccion: 'inventario', limit: 1000 });
    expect(inventario.seccion).toBe('inventario');
    for (const key of ['unidades', 'categorias_materiales', 'categorias_insumos', 'categorias_productos', 'materiales', 'insumos', 'stock', 'articulos']) {
      expect(Array.isArray(inventario[key]), `${key} debe venir en la carga de inventario`).toBe(true);
    }

    await expect(page.getByText('Servicios', { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder('Buscar servicio...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Categorías', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Agregar servicio', exact: true }).click();
    const serviceDialog = await waitDialog(page, 'Agregar servicio');
    const serviceCategory = serviceDialog.getByRole('combobox', { name: 'Categoría', exact: true });
    await expect(serviceCategory.getByRole('option', { name: '+ AGREGAR CATEGORÍA', exact: true })).toHaveCount(1);
    await expect(serviceCategory.getByRole('option', { name: 'SIN CATEGORÍA', exact: true })).toHaveCount(1);

    // La administración completa sigue en Configuración; desde el formulario sólo
    // debe existir el alta rápida solicitada en el desplegable.
    await serviceCategory.selectOption('__ADD__');
    const quickCategoryDialog = await waitQuickCategoryDialog(page);
    await expect(quickCategoryDialog.getByRole('textbox', { name: 'Nombre de la categoría', exact: true })).toBeVisible();
    await quickCategoryDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(quickCategoryDialog).toBeHidden();
    await serviceDialog.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('tablist').getByRole('button', { name: /^Trabajadores$/ }).click();
    await expect(page.getByPlaceholder('Buscar trabajador o rol...')).toBeVisible();

    await page.goto('/panel/servicios?seccion=inventario');
    await waitForBusyToFinish(page);
    await expect(page.getByText('Inventario de servicios', { exact: true })).toBeVisible();
    for (const [tab, placeholder, addLabel, dialogTitle] of [
      ['Materiales', 'Buscar material...', 'Agregar material', 'Agregar material'],
      ['Insumos', 'Buscar insumo...', 'Agregar insumo', 'Agregar insumo'],
      ['Stock', 'Buscar producto, material o insumo...', 'Agregar producto', 'Agregar producto'],
    ]) {
      await page.getByRole('tablist').getByRole('button', { name: new RegExp(`^${tab}$`) }).click();
      await expect(page.getByPlaceholder(placeholder)).toBeVisible();
      await page.getByRole('button', { name: addLabel, exact: true }).click();

      const articleDialog = await waitDialog(page, dialogTitle);
      const categorySelect = articleDialog.getByRole('combobox', { name: 'Categoría', exact: true });
      await expect(categorySelect.getByRole('option', { name: '+ AGREGAR CATEGORÍA', exact: true })).toHaveCount(1);
      await expect(categorySelect.getByRole('option', { name: 'SIN CATEGORÍA', exact: true })).toHaveCount(1);
      await expect(articleDialog.getByRole('combobox', { name: 'Unidad de medida', exact: true }).getByRole('option', { name: '+ AGREGAR UNIDAD', exact: true })).toHaveCount(1);

      await categorySelect.selectOption('__ADD__');
      const quickDialog = await waitQuickCategoryDialog(page);
      await expect(quickDialog.getByRole('textbox', { name: 'Nombre de la categoría', exact: true })).toBeVisible();
      await quickDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(quickDialog).toBeHidden();
      await articleDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(articleDialog).toBeHidden();
    }
    await expect(page.getByRole('button', { name: 'Categorías', exact: true })).toHaveCount(0);
  });


  test('@crud @critical alta rápida de categorías desde los desplegables de Servicios', async ({ page }) => {
    test.setTimeout(2 * 60_000);
    await requireMutations(test, page);

    const cases = [
      {
        group: 'SERVICIO',
        path: '/panel/servicios',
        tab: null,
        addLabel: 'Agregar servicio',
        dialogTitle: 'Agregar servicio',
        createAction: 'servicios_categoria_crear',
      },
      {
        group: 'MATERIAL',
        path: '/panel/servicios?seccion=inventario',
        tab: 'Materiales',
        addLabel: 'Agregar material',
        dialogTitle: 'Agregar material',
        createAction: 'servicios_material_categoria_crear',
      },
      {
        group: 'INSUMO',
        path: '/panel/servicios?seccion=inventario',
        tab: 'Insumos',
        addLabel: 'Agregar insumo',
        dialogTitle: 'Agregar insumo',
        createAction: 'servicios_insumo_categoria_crear',
      },
      {
        group: 'PRODUCTO',
        path: '/panel/servicios?seccion=inventario',
        tab: 'Stock',
        addLabel: 'Agregar producto',
        dialogTitle: 'Agregar producto',
        createAction: 'servicios_articulos_categoria_crear',
      },
    ];
    const created = [];

    try {
      for (const cfg of cases) {
        await page.goto(cfg.path);
        await waitForBusyToFinish(page);
        if (cfg.tab) {
          await page.getByRole('tablist').getByRole('button', { name: cfg.tab, exact: true }).click();
        }

        await page.getByRole('button', { name: cfg.addLabel, exact: true }).click();
        const parentDialog = await waitDialog(page, cfg.dialogTitle);
        const categorySelect = parentDialog.getByRole('combobox', { name: 'Categoría', exact: true });
        await categorySelect.selectOption('__ADD__');

        const quickDialog = await waitQuickCategoryDialog(page);
        const categoryName = uniqueName(`RAPIDA-${cfg.group}`, 100);
        await quickDialog.getByRole('textbox', { name: 'Nombre de la categoría', exact: true }).fill(categoryName);

        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === 'POST'
            && new URL(response.url()).searchParams.get('action') === cfg.createAction,
          { timeout: 30_000 },
        );
        await quickDialog.getByRole('button', { name: 'Agregar categoría', exact: true }).click();
        const response = await responsePromise;
        const body = await response.json().catch(() => ({}));
        expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
        expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
        await expect(quickDialog).toBeHidden({ timeout: 20_000 });

        const createdOption = categorySelect.getByRole('option', { name: categoryName, exact: true });
        await expect(createdOption).toHaveCount(1, { timeout: 20_000 });
        const categoryId = Number(await createdOption.getAttribute('value'));
        expect(categoryId).toBeGreaterThan(0);
        await expect(categorySelect).toHaveValue(String(categoryId));
        created.push({ group: cfg.group, id_categoria: categoryId });

        await parentDialog.getByRole('button', { name: /Cancelar|Cerrar/i }).last().click();
        await expect(parentDialog).toBeHidden();
      }
    } finally {
      for (const row of created.reverse()) {
        await authenticatedApi(page, 'config_listas_categorias_categoria_eliminar', {
          method: 'POST',
          body: { grupo: row.group, id_categoria: row.id_categoria },
        }).catch(() => null);
      }
    }
  });

  test('@crud @critical unidad + trabajador + servicio + composición: ciclo completo', async ({ page }) => {
    await requireMutations(test, page);

    const unitName = uniqueName('UNIDAD-CATALOGO', 70);
    const unitNameUpdated = `${unitName}-EDIT`.slice(0, 70);
    const workerName = uniqueName('TRABAJADOR', 100);
    const serviceName = uniqueName('SERVICIO', 120);
    const serviceNameUpdated = `${serviceName}-EDIT`.slice(0, 120);
    const articleName = uniqueName('MATERIAL-COMP', 120);

    let unitId = 0;
    let workerId = 0;
    let serviceId = 0;
    let articleCreated = false;

    try {
      const unitCreated = await apiPost(page, 'servicios_unidad_crear', {
        nombre: unitName,
        simbolo: `U${Date.now().toString(36).slice(-5)}`.toUpperCase(),
      });
      unitId = idOf(unitCreated, 'id_unidad');
      expect(unitId).toBeGreaterThan(0);

      let units = (await apiGet(page, 'servicios_unidades_listar', { activo: 'todos' })).unidades;
      expect(exactName(units, unitName)).toBeTruthy();
      await apiPost(page, 'servicios_unidad_actualizar', {
        id_unidad: unitId,
        nombre: unitNameUpdated,
        simbolo: 'E2E',
      });
      await apiPost(page, 'servicios_unidad_dar_baja', { id_unidad: unitId });
      units = (await apiGet(page, 'servicios_unidades_listar', { activo: 0 })).unidades;
      expect(exactName(units, unitNameUpdated)).toBeTruthy();
      await apiPost(page, 'servicios_unidad_reactivar', { id_unidad: unitId });

      const workerCreated = await apiPost(page, 'servicios_trabajador_crear', {
        nombre: workerName,
        documento: uniqueName('DOC', 25),
        rol: 'TECNICO E2E',
        tipo_trabajador: 'CONTRATADO',
        modalidad_pago: 'HORA',
        monto_periodo: 2500,
        horas_periodo: 1,
        notas: 'TRABAJADOR TEMPORAL PLAYWRIGHT',
      });
      workerId = idOf(workerCreated, 'id_trabajador');
      expect(workerId).toBeGreaterThan(0);

      let workers = (await apiGet(page, 'servicios_trabajadores_listar', { activo: 'todos', q: workerName })).trabajadores;
      expect(exactName(workers, workerName)).toBeTruthy();
      const workerGet = await apiGet(page, 'servicios_trabajador_obtener', { id_trabajador: workerId });
      expect(Number(workerGet.trabajador?.id_trabajador)).toBe(workerId);
      await apiPost(page, 'servicios_trabajador_actualizar', {
        id_trabajador: workerId,
        nombre: workerName,
        rol: 'TECNICO SENIOR E2E',
        tipo_trabajador: 'CONTRATADO',
        modalidad_pago: 'HORA',
        monto_periodo: 3000,
        horas_periodo: 1,
      });
      const workerHistory = await apiGet(page, 'servicios_trabajador_historial_tarifas', { id_trabajador: workerId });
      expect(workerHistory.historial?.length || 0).toBeGreaterThanOrEqual(2);
      await apiPost(page, 'servicios_trabajador_dar_baja', { id_trabajador: workerId });
      workers = (await apiGet(page, 'servicios_trabajadores_listar', { activo: 0, q: workerName })).trabajadores;
      expect(exactName(workers, workerName)).toBeTruthy();
      await apiPost(page, 'servicios_trabajador_reactivar', { id_trabajador: workerId });

      const article = await createServiceArticleFixture(page, {
        name: articleName,
        type: 'MATERIAL',
        idUnit: unitId,
        stock: 25,
        cost: 40,
        price: 75,
      });
      articleCreated = true;

      const serviceCreated = await apiPost(page, 'servicios_servicio_crear', {
        nombre: serviceName,
        id_categoria: null,
        id_unidad_cobro: unitId,
        descripcion: 'SERVICIO E2E CON COMPOSICION',
        costo_base: 150,
        duracion_estimada_minutos: 90,
        precio_venta: 1000,
        iva_pct: 21,
        composicion: {
          articulos: [{ id_articulo: Number(article.id_articulo), cantidad: 2 }],
          trabajadores: [{ id_trabajador: workerId, horas_estimadas: 1.5 }],
        },
      });
      serviceId = idOf(serviceCreated, 'id_servicio');
      expect(serviceId).toBeGreaterThan(0);

      let serviceGet = await apiGet(page, 'servicios_servicio_obtener', { id_servicio: serviceId });
      expect(serviceGet.servicio?.nombre).toBe(serviceName);
      expect(serviceGet.servicio?.articulos?.some((row) => Number(row.id_articulo) === Number(article.id_articulo))).toBe(true);
      expect(serviceGet.servicio?.trabajadores?.some((row) => Number(row.id_trabajador) === workerId)).toBe(true);

      let catalog = (await apiGet(page, 'servicios_catalogo_listar', { activo: 'todos', q: serviceName })).servicios;
      expect(exactName(catalog, serviceName)).toBeTruthy();

      await apiPost(page, 'servicios_composicion_guardar', {
        id_servicio: serviceId,
        composicion: {
          articulos: [{ id_articulo: Number(article.id_articulo), cantidad: 3 }],
          trabajadores: [{ id_trabajador: workerId, horas_estimadas: 2 }],
        },
      });
      serviceGet = await apiGet(page, 'servicios_servicio_obtener', { id_servicio: serviceId });
      expect(Number(serviceGet.servicio?.articulos?.[0]?.cantidad)).toBeCloseTo(3, 6);
      expect(Number(serviceGet.servicio?.trabajadores?.[0]?.horas_estimadas)).toBeCloseTo(2, 6);

      await apiPost(page, 'servicios_servicio_actualizar', {
        id_servicio: serviceId,
        nombre: serviceNameUpdated,
        id_categoria: null,
        id_unidad_cobro: unitId,
        descripcion: 'SERVICIO E2E EDITADO',
        costo_base: 175,
        duracion_estimada_minutos: 105,
        precio_venta: 1250,
        iva_pct: 21,
      });
      const priceHistory = await apiGet(page, 'servicios_servicio_historial_precios', { id_servicio: serviceId });
      expect(priceHistory.historial?.length || 0).toBeGreaterThanOrEqual(2);

      await apiPost(page, 'servicios_servicio_dar_baja', { id_servicio: serviceId });
      catalog = (await apiGet(page, 'servicios_catalogo_listar', { activo: 0, q: serviceNameUpdated })).servicios;
      expect(exactName(catalog, serviceNameUpdated)).toBeTruthy();
      await apiPost(page, 'servicios_servicio_reactivar', { id_servicio: serviceId });

      await page.goto('/panel/servicios');
      await waitForBusyToFinish(page);
      const search = page.getByPlaceholder('Buscar servicio...');
      await search.fill(serviceNameUpdated);
      await page.waitForTimeout(450);
      const row = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: serviceNameUpdated }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      for (const title of ['Ver historial', 'Editar', 'Dar de baja', 'Eliminar']) {
        await expect(row.getByTitle(title)).toBeVisible();
      }

      await page.getByRole('tablist').getByRole('button', { name: /^Trabajadores$/ }).click();
      const workerSearch = page.getByPlaceholder('Buscar trabajador o rol...');
      await workerSearch.fill(workerName);
      await page.waitForTimeout(450);
      const workerRow = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: workerName }).first();
      await expect(workerRow).toBeVisible({ timeout: 20_000 });
      for (const title of ['Ver historial', 'Editar', 'Dar de baja', 'Eliminar']) {
        await expect(workerRow.getByTitle(title)).toBeVisible();
      }
    } finally {
      if (serviceId) {
        await bestEffortPost(page, 'servicios_composicion_guardar', {
          id_servicio: serviceId,
          composicion: { articulos: [], trabajadores: [] },
        });
        const deleted = await bestEffortPost(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
        if (deleted && deleted.status === 409) {
          await bestEffortPost(page, 'servicios_servicio_dar_baja', { id_servicio: serviceId });
        }
      }
      if (articleCreated) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
      if (workerId) await bestEffortPost(page, 'servicios_trabajador_eliminar', { id_trabajador: workerId });
      if (unitId) await bestEffortPost(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });
});
