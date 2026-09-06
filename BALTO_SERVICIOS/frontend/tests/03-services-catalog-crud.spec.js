import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';
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

test.describe('BALTO Servicios - catálogo principal', () => {
  test('@smoke @servicios ping, resumen, carga agregada y navegación del módulo', async ({ page }) => {
    await page.goto('/panel/servicios');
    await waitForBusyToFinish(page);

    const ping = await apiGet(page, 'servicios_ping');
    expect(ping.module).toBe('servicios');
    expect(ping.version).toBe('8.2-db15');
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
    for (const key of ['unidades', 'categorias_materiales', 'categorias_insumos', 'materiales', 'insumos', 'stock', 'articulos']) {
      expect(Array.isArray(inventario[key]), `${key} debe venir en la carga de inventario`).toBe(true);
    }

    await expect(page.getByText('Servicios', { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder('Buscar servicio...')).toBeVisible();
    await page.getByRole('tablist').getByRole('button', { name: /^Trabajadores$/ }).click();
    await expect(page.getByPlaceholder('Buscar trabajador o rol...')).toBeVisible();

    await page.goto('/panel/servicios?seccion=inventario');
    await waitForBusyToFinish(page);
    await expect(page.getByText('Inventario de servicios', { exact: true })).toBeVisible();
    for (const [tab, placeholder] of [
      ['Materiales', 'Buscar material...'],
      ['Insumos', 'Buscar insumo...'],
      ['Stock', 'Buscar material o insumo...'],
    ]) {
      await page.getByRole('tablist').getByRole('button', { name: new RegExp(`^${tab}$`) }).click();
      await expect(page.getByPlaceholder(placeholder)).toBeVisible();
    }
  });

  test('@crud @critical categoría + unidad + trabajador + servicio + composición: ciclo completo', async ({ page }) => {
    await requireMutations(test, page);

    const unitName = uniqueName('UNIDAD-CATALOGO', 70);
    const unitNameUpdated = `${unitName}-EDIT`.slice(0, 70);
    const categoryName = uniqueName('CAT-SERVICIO', 100);
    const categoryNameUpdated = `${categoryName}-EDIT`.slice(0, 100);
    const workerName = uniqueName('TRABAJADOR', 100);
    const serviceName = uniqueName('SERVICIO', 120);
    const serviceNameUpdated = `${serviceName}-EDIT`.slice(0, 120);
    const articleName = uniqueName('MATERIAL-COMP', 120);

    let unitId = 0;
    let categoryId = 0;
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

      const categoryCreated = await apiPost(page, 'servicios_categoria_crear', {
        nombre: categoryName,
        descripcion: 'CATEGORIA E2E SERVICIOS',
      });
      categoryId = idOf(categoryCreated, 'id_categoria');
      expect(categoryId).toBeGreaterThan(0);
      let categories = (await apiGet(page, 'servicios_categorias_listar', { activo: 'todos' })).categorias;
      expect(exactName(categories, categoryName)).toBeTruthy();
      await apiPost(page, 'servicios_categoria_actualizar', {
        id_categoria: categoryId,
        nombre: categoryNameUpdated,
        descripcion: 'CATEGORIA E2E EDITADA',
      });
      await apiPost(page, 'servicios_categoria_dar_baja', { id_categoria: categoryId });
      categories = (await apiGet(page, 'servicios_categorias_listar', { activo: 0 })).categorias;
      expect(exactName(categories, categoryNameUpdated)).toBeTruthy();
      await apiPost(page, 'servicios_categoria_reactivar', { id_categoria: categoryId });

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
        id_categoria: categoryId,
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
        id_categoria: categoryId,
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
      if (categoryId) await bestEffortPost(page, 'servicios_categoria_eliminar', { id_categoria: categoryId });
      if (unitId) await bestEffortPost(page, 'servicios_unidad_eliminar', { id_unidad: unitId });
    }
  });
});
