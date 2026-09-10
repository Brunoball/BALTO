import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { uniqueName } from './data.js';
import { waitForBusyToFinish } from './ui.js';

function normalize(value) {
  return String(value || '').trim().toLocaleUpperCase('es-AR');
}

async function ensureAppDocument(page, route = '/panel/servicios') {
  if (!/^https?:\/\//i.test(page.url())) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await waitForBusyToFinish(page);
  }
}

function exactByName(rows, name) {
  const expected = normalize(name);
  return (Array.isArray(rows) ? rows : []).find((row) => normalize(row?.nombre) === expected) || null;
}

export async function serviciosApi(page, action, options = {}) {
  await ensureAppDocument(page);
  return authenticatedApi(page, action, options);
}

export async function listServiceUnits(page, activo = 'todos') {
  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_unidades_listar', { query: { activo } }),
    'No se pudieron listar las unidades de Servicios',
  );
  return Array.isArray(body?.unidades) ? body.unidades : [];
}

export async function ensureActiveServiceUnit(page) {
  const units = await listServiceUnits(page, 'todos');
  const existing = units.find((row) => Number(row?.activo) === 1);
  if (existing) return existing;

  const name = uniqueName('UNIDAD-E2E', 70);
  const symbol = `U${Date.now().toString(36).slice(-5)}`.toUpperCase();
  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_unidad_crear', {
      method: 'POST',
      body: { nombre: name, simbolo: symbol },
    }),
    'No se pudo crear una unidad temporal para el testing',
  );
  return body?.unidad || body?.data?.unidad || {
    id_unidad: body?.id_unidad || body?.data?.id_unidad,
    nombre: name,
    simbolo: symbol,
    activo: 1,
  };
}

export async function createServiceFixture(page, options = {}) {
  const unit = options.idUnit
    ? { id_unidad: Number(options.idUnit) }
    : await ensureActiveServiceUnit(page);
  const name = String(options.name || uniqueName('SERVICIO-E2E', 120)).trim();

  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_servicio_crear', {
      method: 'POST',
      body: {
        nombre: name,
        id_categoria: Number(options.categoryId || 0) || null,
        id_unidad_cobro: Number(unit.id_unidad),
        descripcion: options.description || `FIXTURE ${name}`,
        costo_base: Number(options.baseCost ?? 0),
        duracion_estimada_minutos: Number(options.durationMinutes ?? 60),
        precio_venta: Number(options.price ?? 100),
        iva_pct: Number(options.ivaPct ?? 0),
        composicion: {
          articulos: Array.isArray(options.articles) ? options.articles : [],
          trabajadores: Array.isArray(options.workers) ? options.workers : [],
        },
      },
    }),
    `No se pudo crear el servicio ${name}`,
  );

  const id = Number(body?.id_servicio || body?.data?.id_servicio || body?.servicio?.id_servicio || 0);
  expect(id, `El alta de ${name} debe devolver id_servicio`).toBeGreaterThan(0);
  return { id_servicio: id, nombre: name, body };
}

export async function deleteServiceFixture(page, idServicio, { tolerateHistoricalUse = true } = {}) {
  const id = Number(idServicio || 0);
  if (!id) return { deleted: true, missing: true };

  try {
    await serviciosApi(page, 'servicios_composicion_guardar', {
      method: 'POST',
      body: { id_servicio: id, composicion: { articulos: [], trabajadores: [] } },
    });
  } catch {
    // Si el servicio ya no existe, el delete siguiente decidirá el resultado.
  }

  const result = await serviciosApi(page, 'servicios_servicio_eliminar', {
    method: 'POST',
    body: { id_servicio: id },
  });
  if (result.status < 400 && result.body?.exito !== false) {
    return { deleted: true, id_servicio: id, body: result.body };
  }

  if (!tolerateHistoricalUse || result.status !== 409) {
    expectApiSuccess(result, `No se pudo eliminar el servicio #${id}`);
  }

  const down = await serviciosApi(page, 'servicios_servicio_dar_baja', {
    method: 'POST',
    body: { id_servicio: id },
  });
  if (down.status < 400 && down.body?.exito !== false) {
    return { deleted: false, deactivated: true, id_servicio: id, body: down.body };
  }

  if (down.status !== 409) expectApiSuccess(down, `No se pudo dar de baja el servicio #${id}`);
  return { deleted: false, deactivated: false, historical: true, id_servicio: id };
}

export async function createServiceArticleFixture(page, options = {}) {
  const unit = options.idUnit
    ? { id_unidad: Number(options.idUnit) }
    : await ensureActiveServiceUnit(page);
  const requestedType = String(options.type || 'MATERIAL').trim().toUpperCase();
  const type = ['MATERIAL', 'INSUMO', 'PRODUCTO'].includes(requestedType) ? requestedType : 'MATERIAL';
  const action = type === 'PRODUCTO'
    ? 'servicios_stock_producto_crear'
    : type === 'INSUMO' ? 'servicios_insumo_crear' : 'servicios_material_crear';
  const name = String(options.name || uniqueName(type)).trim();
  const controlStock = type === 'PRODUCTO' ? true : options.controlStock !== false;

  const body = expectApiSuccess(
    await serviciosApi(page, action, {
      method: 'POST',
      body: {
        nombre: name,
        descripcion: options.description || `FIXTURE ${name}`,
        id_categoria: Number(options.categoryId || 0) || null,
        id_unidad: Number(unit.id_unidad),
        controla_stock: controlStock ? 1 : 0,
        stock_actual: controlStock ? Number(options.stock ?? 10) : Number(options.stock ?? 0),
        costo_unitario: Number(options.cost ?? 100),
        precio_venta: options.price === null ? null : Number(options.price ?? 150),
        iva_pct: Number(options.ivaPct ?? 21),
      },
    }),
    `No se pudo crear el ${type.toLowerCase()} ${name}`,
  );

  const id = Number(body?.id_articulo || body?.data?.id_articulo || body?.material?.id_articulo || body?.insumo?.id_articulo || body?.producto?.id_articulo || 0);
  expect(id, `El alta de ${name} debe devolver id_articulo`).toBeGreaterThan(0);

  const row = controlStock
    ? await getServiceArticleByName(page, name, { activo: 'todos' })
    : await getTypedServiceArticleByName(page, name, type, { activo: 'todos' });
  expect(row, `El artículo ${name} debe existir después del alta`).toBeTruthy();
  return { ...row, id_articulo: id || row.id_articulo };
}

export async function getTypedServiceArticleByName(page, name, type = 'MATERIAL', options = {}) {
  const normalizedType = String(type || 'MATERIAL').trim().toUpperCase();
  if (normalizedType === 'PRODUCTO') return getServiceArticleByName(page, name, options);
  const isInput = normalizedType === 'INSUMO';
  const action = isInput ? 'servicios_insumos_listar' : 'servicios_materiales_listar';
  const key = isInput ? 'insumos' : 'materiales';
  const body = expectApiSuccess(
    await serviciosApi(page, action, {
      query: { q: name, activo: options.activo ?? 'todos', limit: options.limit ?? 200 },
    }),
    `No se pudo consultar ${normalizedType.toLowerCase()} ${name}`,
  );
  return exactByName(body?.[key], name);
}

export async function getServiceArticleByName(page, name, options = {}) {
  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_stock_listar', {
      query: {
        q: name,
        activo: options.activo ?? 'todos',
        limit: options.limit ?? 200,
      },
    }),
    `No se pudo consultar el stock de Servicios para ${name}`,
  );
  return exactByName(body?.stock, name);
}

export async function getServiceArticle(page, id) {
  const body = expectApiSuccess(
    await serviciosApi(page, 'servicios_stock_obtener', { query: { id_articulo: Number(id) } }),
    `No se pudo obtener el artículo #${id}`,
  );
  return body?.stock_item || body?.articulo || body?.data?.stock_item || body?.data?.articulo || null;
}

export async function getServiceStock(page, name) {
  const row = await getServiceArticleByName(page, name, { activo: 'todos' });
  expect(row, `Debe existir el artículo ${name} en el stock de Servicios`).toBeTruthy();
  return Number(row?.stock_actual || 0);
}

export async function expectServiceStock(page, name, expected, precision = 6) {
  await expect.poll(
    async () => getServiceStock(page, name),
    {
      timeout: 45_000,
      intervals: [300, 700, 1_500, 2_500],
      message: `El stock de ${name} debe quedar en ${expected}`,
    },
  ).toBeCloseTo(Number(expected), precision);
  return getServiceArticleByName(page, name, { activo: 'todos' });
}

export async function getAnyServiceArticleByName(page, name, options = {}) {
  const stock = await getServiceArticleByName(page, name, options);
  if (stock) return stock;
  const material = await getTypedServiceArticleByName(page, name, 'MATERIAL', options);
  if (material) return material;
  return getTypedServiceArticleByName(page, name, 'INSUMO', options);
}

export async function updateServiceArticleFixture(page, name, updates = {}) {
  const current = await getAnyServiceArticleByName(page, name, { activo: 'todos' });
  expect(current, `Debe existir ${name} para editarlo`).toBeTruthy();
  const type = String(current.tipo || 'MATERIAL').toUpperCase();
  const action = type === 'PRODUCTO' ? 'servicios_stock_producto_actualizar' : type === 'INSUMO' ? 'servicios_insumo_actualizar' : 'servicios_material_actualizar';

  const body = expectApiSuccess(
    await serviciosApi(page, action, {
      method: 'POST',
      body: {
        id_articulo: Number(current.id_articulo),
        nombre: updates.name || current.nombre,
        descripcion: updates.description ?? current.descripcion ?? null,
        id_categoria: updates.categoryId === undefined ? (current.id_categoria || null) : (Number(updates.categoryId) || null),
        id_unidad: Number(updates.idUnit || current.id_unidad),
        controla_stock: type === 'PRODUCTO' ? 1 : (updates.controlStock === undefined ? Number(current.controla_stock ?? 1) : (updates.controlStock ? 1 : 0)),
        costo_unitario: Number(updates.cost ?? current.costo_unitario ?? 0),
        precio_venta: updates.price === undefined ? current.precio_venta : updates.price,
        iva_pct: Number(updates.ivaPct ?? current.iva_pct ?? 0),
      },
    }),
    `No se pudo editar ${name}`,
  );

  return body?.material || body?.insumo || body?.producto || body?.articulo || body?.data?.material || body?.data?.insumo || body?.data?.producto || body?.data?.articulo
    || getAnyServiceArticleByName(page, updates.name || name, { activo: 'todos' });
}

export async function adjustServiceStock(page, nameOrId, options = {}) {
  let id = Number(nameOrId || 0);
  if (!id) {
    const row = await getServiceArticleByName(page, nameOrId, { activo: 'todos' });
    expect(row, `Debe existir ${nameOrId} para ajustar stock`).toBeTruthy();
    id = Number(row.id_articulo);
  }

  return expectApiSuccess(
    await serviciosApi(page, 'servicios_stock_ajustar', {
      method: 'POST',
      body: {
        id_articulo: id,
        operacion: String(options.operation || 'ESTABLECER').toUpperCase(),
        cantidad: Number(options.quantity ?? 0),
        motivo: options.reason || uniqueName('AJUSTE-E2E', 80),
      },
    }),
    `No se pudo ajustar el stock del artículo #${id}`,
  );
}

export async function deleteServiceArticleFixture(page, name, { tolerateHistoricalUse = true } = {}) {
  const current = await getAnyServiceArticleByName(page, name, { activo: 'todos' });
  if (!current) return { deleted: true, missing: true };

  const type = String(current.tipo || 'MATERIAL').toUpperCase();
  const deleteAction = type === 'PRODUCTO' ? 'servicios_stock_producto_eliminar' : type === 'INSUMO' ? 'servicios_insumo_eliminar' : 'servicios_material_eliminar';
  const deactivateAction = type === 'PRODUCTO' ? 'servicios_stock_producto_dar_baja' : type === 'INSUMO' ? 'servicios_insumo_dar_baja' : 'servicios_material_dar_baja';
  const result = await serviciosApi(page, deleteAction, {
    method: 'POST',
    body: { id_articulo: Number(current.id_articulo) },
  });

  if (result.status < 400 && result.body?.exito !== false) {
    return { deleted: true, id_articulo: Number(current.id_articulo), body: result.body };
  }

  if (!tolerateHistoricalUse || result.status !== 409) {
    expectApiSuccess(result, `No se pudo eliminar ${name}`);
  }

  if (Number(current.activo) === 1) {
    const down = await serviciosApi(page, deactivateAction, {
      method: 'POST',
      body: { id_articulo: Number(current.id_articulo) },
    });
    if (down.status < 400 && down.body?.exito !== false) {
      return { deleted: false, deactivated: true, id_articulo: Number(current.id_articulo), body: down.body };
    }
    if (down.status !== 409) expectApiSuccess(down, `No se pudo dar de baja ${name}`);
  }

  return { deleted: false, deactivated: false, historical: true, id_articulo: Number(current.id_articulo) };
}

export async function openServiceInventory(page, tab = 'stock') {
  await page.goto('/panel/servicios?seccion=inventario', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);
  const tabButton = page.getByRole('tablist').getByRole('button', { name: new RegExp(`^${tab}$`, 'i') });
  if (await tabButton.count()) await tabButton.click();
  return page;
}

export async function findServiceInventoryRow(page, name, tab = 'stock') {
  await openServiceInventory(page, tab);
  const placeholder = tab === 'materiales'
    ? /Buscar material/i
    : tab === 'insumos'
      ? /Buscar insumo/i
      : /Buscar producto, material o insumo/i;
  const search = page.getByPlaceholder(placeholder).first();
  await expect(search).toBeVisible();
  await search.fill(name);
  const row = page.locator('.mov-gridTable--row:visible:not(.mov-row--skeleton)').filter({ hasText: name }).first();
  await expect(row, `Debe mostrarse ${name} en ${tab}`).toBeVisible({ timeout: 20_000 });
  return row;
}
