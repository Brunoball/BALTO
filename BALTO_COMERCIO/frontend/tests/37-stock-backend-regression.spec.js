import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName, uniqueSku, RUN_PREFIX } from './support/data.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { listStockUnits } from './support/stock-units.js';
import { requireMutations } from './support/ui.js';

function stockPayload(body) {
  return body?.data && typeof body.data === 'object' ? { ...body.data, ...body } : body || {};
}

function stockVersions(body) {
  const data = stockPayload(body);
  return {
    catalogo_version: String(data.catalogo_version || ''),
    imagenes_version: String(data.imagenes_version || ''),
    categorias_version: String(data.categorias_version || ''),
  };
}

async function getStockChanges(page, previous = null) {
  const result = await authenticatedApi(page, 'stock_cambios_consultar', {
    query: {
      ...(previous || {}),
      _: Date.now(),
    },
  });
  const body = expectApiSuccess(result, 'No se pudo consultar el change-feed de Stock');
  const data = stockPayload(body);

  expect(data.catalogo_version, 'El change-feed debe devolver catalogo_version').toMatch(/^[a-f0-9]{64}$/i);
  expect(data.imagenes_version, 'El change-feed debe devolver imagenes_version').toMatch(/^[a-f0-9]{64}$/i);
  expect(data.categorias_version, 'El change-feed debe devolver categorias_version').toMatch(/^[a-f0-9]{64}$/i);
  expect(String(data.server_time || ''), 'El change-feed debe devolver server_time').not.toBe('');

  return data;
}

async function expectCatalogChange(page, previousVersions) {
  let last = null;
  await expect.poll(async () => {
    last = await getStockChanges(page, previousVersions);
    return last.catalogo_cambio === true;
  }, {
    timeout: 30_000,
    intervals: [150, 300, 600, 1_000],
    message: 'Una mutación de Stock debe invalidar catalogo_version',
  }).toBe(true);
  return last;
}

function extractProduct(createdBody) {
  const body = stockPayload(createdBody);
  return body.producto || body.data?.producto || null;
}

function priceRows(body) {
  const data = stockPayload(body);
  return Array.isArray(data.precios) ? data.precios : [];
}

function priceForType(rows, typeId) {
  return rows.find((row) => Number(row?.id_tipo_precio_stock || row?.id_tipo_precio || 0) === Number(typeId)) || null;
}

function assertNoTiendaNubeJobs(sync, context) {
  if (!sync || typeof sync !== 'object') return;
  expect(Number(sync.encolados || 0), `${context}: el fixture fraccionable no debe encolar Tienda Nube`).toBe(0);
  expect(Number(sync.pendientes || 0), `${context}: no debe dejar jobs TN pendientes`).toBe(0);
}

test('@stock @backend @critical change-feed: las lecturas del catálogo no producen cambios', async ({ page }) => {
  const baseline = await getStockChanges(page);
  expect(baseline.catalogo_cambio).toBe(false);
  expect(baseline.imagenes_cambio).toBe(false);
  expect(baseline.categorias_cambio).toBe(false);

  const reads = await Promise.all([
    authenticatedApi(page, 'stock_ping', { query: { _: Date.now() } }),
    authenticatedApi(page, 'stock_productos_listar', { query: { pagina: 1, por_pagina: 25, _: Date.now() } }),
    authenticatedApi(page, 'stock_categorias_listar', { query: { activo: 'todos', _: Date.now() } }),
    authenticatedApi(page, 'stock_atributos_listar', { query: { activo: 'todos', _: Date.now() } }),
    authenticatedApi(page, 'stock_tipos_precio_listar', { query: { _: Date.now() } }),
    authenticatedApi(page, 'stock_precios_ajustes_historial', { query: { limit: 20, _: Date.now() } }),
    authenticatedApi(page, 'stock_unidades_listar', { query: { activo: 'todos', _: Date.now() } }),
    authenticatedApi(page, 'stock_reportes_generar', { query: { tipo: 'inventario_general', _: Date.now() } }),
  ]);
  reads.forEach((result, index) => expectApiSuccess(result, `Falló la lectura segura #${index + 1} de Stock`));

  const afterReads = await getStockChanges(page, stockVersions(baseline));
  expect(afterReads.catalogo_cambio, 'Ping, listados, historial y reportes no deben mutar el catálogo').toBe(false);
  expect(afterReads.imagenes_cambio, 'Las lecturas no deben tocar imágenes').toBe(false);
  expect(afterReads.categorias_cambio, 'Listar categorías no debe mutarlas').toBe(false);
  expect(afterReads.catalogo_version).toBe(baseline.catalogo_version);
  expect(afterReads.imagenes_version).toBe(baseline.imagenes_version);
  expect(afterReads.categorias_version).toBe(baseline.categorias_version);
});

test('@stock @backend @critical mutaciones locales: update, SKU, impacto y precios invalidan el catálogo sin probar Tienda Nube', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);

  const units = await listStockUnits(page, 'todos');
  const fractionalUnit = units.find((unit) =>
    Number(unit?.activo ?? 1) === 1 &&
    Number(unit?.permite_decimales || 0) === 1 &&
    Number(unit?.es_default || 0) !== 1,
  );
  expect(fractionalUnit, 'Debe existir al menos una unidad fraccionable activa para aislar este test de Tienda Nube').toBeTruthy();

  const productName = uniqueName('STOCK-BACKEND-REG');
  const sku = uniqueSku('SBR');
  const baseline = await getStockChanges(page);

  const createdBody = await createStockProductFixture(page, {
    name: productName,
    sku,
    stock: 2.75,
    cost: 100,
    price: 175,
    unitId: Number(fractionalUnit.id_stock_unidad),
  });
  const created = extractProduct(createdBody);
  const productId = Number(created?.id_stock_producto || created?.id || 0);
  expect(productId, 'El alta debe devolver el ID real del producto').toBeGreaterThan(0);
  expect(Number(created?.id_stock_unidad || 0)).toBe(Number(fractionalUnit.id_stock_unidad));
  expect(Number(created?.stock || 0)).toBeCloseTo(2.75, 3);
  assertNoTiendaNubeJobs(stockPayload(createdBody).tiendanube_sync, 'Alta del producto E2E');

  await expectCatalogChange(page, stockVersions(baseline));

  const beforeUpdate = await getStockChanges(page);
  const updateResult = await authenticatedApi(page, 'stock_productos_actualizar', {
    method: 'POST',
    body: {
      id_stock_producto: productId,
      stock: 3.125,
      descripcion: `${RUN_PREFIX} REGRESION STOCK BACKEND`,
    },
  });
  const updateBody = expectApiSuccess(updateResult, 'No se pudo actualizar parcialmente el producto de Stock');
  const updated = extractProduct(updateBody);
  expect(Number(updated?.id_stock_producto || updated?.id || 0)).toBe(productId);
  expect(Number(updated?.stock || 0)).toBeCloseTo(3.125, 3);
  expect(String(updated?.nombre || '')).toBe(productName);
  expect(Number(updated?.id_stock_unidad || 0)).toBe(Number(fractionalUnit.id_stock_unidad));
  assertNoTiendaNubeJobs(stockPayload(updateBody).tiendanube_sync, 'Update parcial del producto E2E');
  await expectCatalogChange(page, stockVersions(beforeUpdate));

  const detailResult = await authenticatedApi(page, 'stock_producto_obtener', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const detailBody = expectApiSuccess(detailResult, 'No se pudo releer el producto actualizado');
  const detail = extractProduct(detailBody);
  expect(Number(detail?.stock || 0)).toBeCloseTo(3.125, 3);
  expect(String(detail?.descripcion || '')).toContain(RUN_PREFIX);

  const imagesResult = await authenticatedApi(page, 'stock_imagenes_listar', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const imagesBody = expectApiSuccess(imagesResult, 'No se pudieron listar las imágenes del producto');
  const images = stockPayload(imagesBody).imagenes;
  expect(Array.isArray(images), 'El listado de imágenes debe exponer imagenes como array').toBeTruthy();
  expect(images, 'Un producto E2E recién creado no debe traer imágenes heredadas').toEqual([]);

  const duplicateSku = await authenticatedApi(page, 'stock_variante_validar_sku', {
    query: { sku, _: Date.now() },
  });
  const duplicateBody = expectApiSuccess(duplicateSku, 'Falló la validación global de SKU duplicado');
  expect(stockPayload(duplicateBody).disponible, 'El SKU del producto debe quedar reservado globalmente').toBe(false);

  const freeSku = await authenticatedApi(page, 'stock_variante_validar_sku', {
    query: { sku: uniqueSku('LIBRE'), _: Date.now() },
  });
  const freeBody = expectApiSuccess(freeSku, 'Falló la validación de un SKU libre');
  expect(stockPayload(freeBody).disponible).toBe(true);

  const impactResult = await authenticatedApi(page, 'stock_producto_impacto_eliminacion', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const impactBody = expectApiSuccess(impactResult, 'No se pudo calcular el impacto de eliminación');
  const impact = stockPayload(impactBody).impacto || {};
  expect(Number(impact.total_items_afectados || 0)).toBe(0);
  expect(Number(impact.total_movimientos_afectados || 0)).toBe(0);

  const typesResult = await authenticatedApi(page, 'stock_tipos_precio_listar', { query: { _: Date.now() } });
  const typesBody = expectApiSuccess(typesResult, 'No se pudieron listar los tipos de precio');
  const types = stockPayload(typesBody).tipos_precio || [];
  const saleType = types.find((row) => /VENTA/i.test(String(row?.nombre || '')));
  expect(saleType, 'Debe existir el tipo PRECIO DE VENTA').toBeTruthy();
  const saleTypeId = Number(saleType.id_tipo_precio_stock || 0);
  expect(saleTypeId).toBeGreaterThan(0);

  const pricesBeforeResult = await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const pricesBeforeBody = expectApiSuccess(pricesBeforeResult, 'No se pudieron obtener los precios iniciales');
  const initialPrices = priceRows(pricesBeforeBody);
  const saleBefore = priceForType(initialPrices, saleTypeId);
  expect(saleBefore, 'El producto debe tener un precio de venta inicial').toBeTruthy();
  const initialSaleAmount = Number(saleBefore.monto || saleBefore.precio || 0);
  expect(initialSaleAmount).toBeGreaterThan(0);

  const beforeIndividualPrice = await getStockChanges(page);
  const individualSaleAmount = Number((initialSaleAmount + 1.11).toFixed(2));
  const individualPriceResult = await authenticatedApi(page, 'stock_precio_guardar', {
    method: 'POST',
    body: {
      id_stock_producto: productId,
      precios: initialPrices
        .map((row) => ({
          id_tipo_precio_stock: Number(row?.id_tipo_precio_stock || 0),
          monto: Number(row?.monto || row?.precio || 0),
          margen_porcentaje: row?.margen_porcentaje ?? null,
          margen_valor: row?.margen_valor ?? null,
        }))
        .filter((row) => row.id_tipo_precio_stock > 0)
        .map((row) => row.id_tipo_precio_stock === saleTypeId ? { ...row, monto: individualSaleAmount } : row),
    },
  });
  const individualPriceBody = expectApiSuccess(individualPriceResult, 'No se pudo guardar un precio individual');
  const individualPriceData = stockPayload(individualPriceBody);
  const savedSale = priceForType(priceRows(individualPriceBody), saleTypeId);
  expect(savedSale, 'El guardado individual debe devolver el precio de venta').toBeTruthy();
  expect(Number(savedSale.monto || savedSale.precio || 0)).toBeCloseTo(individualSaleAmount, 2);
  assertNoTiendaNubeJobs(individualPriceData.tiendanube_sync, 'Guardado individual de precio E2E');
  await expectCatalogChange(page, stockVersions(beforeIndividualPrice));

  const previousAmount = individualSaleAmount;
  const optionsResult = await authenticatedApi(page, 'stock_precios_ajuste_opciones', {
    query: { id_tipo_precio_stock: saleTypeId, buscar: sku, _: Date.now() },
  });
  const optionsBody = expectApiSuccess(optionsResult, 'No se pudieron cargar las opciones de ajuste de precios');
  const options = stockPayload(optionsBody).opciones || [];
  const target = options.find((row) =>
    Number(row?.id_stock_producto || 0) === productId &&
    (row?.id_stock_variante === null || Number(row?.id_stock_variante || 0) === 0),
  );
  expect(target, 'El ajuste masivo debe poder seleccionar el producto base').toBeTruthy();

  const beforePriceChange = await getStockChanges(page);
  const adjustmentValue = 12.34;
  const adjustmentResult = await authenticatedApi(page, 'stock_precios_ajuste_crear', {
    method: 'POST',
    body: {
      id_tipo_precio_stock: saleTypeId,
      tipo_ajuste: 'valor',
      valor_ajuste: adjustmentValue,
      observacion: `${RUN_PREFIX} REGRESION AJUSTE PRECIO`,
      items: [{ id_stock_producto: productId, id_stock_variante: null }],
    },
  });
  const adjustmentBody = expectApiSuccess(adjustmentResult, 'No se pudo guardar el ajuste de precio');
  const adjustmentData = stockPayload(adjustmentBody);
  const adjustmentId = Number(adjustmentData.id_ajuste_precio || 0);
  expect(adjustmentId, 'El ajuste debe devolver su ID').toBeGreaterThan(0);
  expect(Number(adjustmentData.total_items || 0)).toBe(1);
  assertNoTiendaNubeJobs(adjustmentData.tiendanube_sync, 'Ajuste de precio E2E');
  await expectCatalogChange(page, stockVersions(beforePriceChange));

  const pricesAfterResult = await authenticatedApi(page, 'stock_precios_obtener', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const pricesAfterBody = expectApiSuccess(pricesAfterResult, 'No se pudieron releer los precios ajustados');
  const saleAfter = priceForType(priceRows(pricesAfterBody), saleTypeId);
  expect(saleAfter).toBeTruthy();
  expect(Number(saleAfter.monto || saleAfter.precio || 0)).toBeCloseTo(previousAmount + adjustmentValue, 2);

  const historyResult = await authenticatedApi(page, 'stock_precios_historial_producto', {
    query: { id_stock_producto: productId, limit: 50, _: Date.now() },
  });
  const historyBody = expectApiSuccess(historyResult, 'No se pudo consultar el historial de precios del producto');
  const history = stockPayload(historyBody).items || [];
  const historyRow = history.find((row) => Number(row?.id_ajuste_precio || 0) === adjustmentId);
  expect(historyRow, 'El historial debe contener exactamente el ajuste recién creado').toBeTruthy();
  expect(Number(historyRow.precio_anterior || 0)).toBeCloseTo(previousAmount, 2);
  expect(Number(historyRow.precio_nuevo || 0)).toBeCloseTo(previousAmount + adjustmentValue, 2);
  expect(Number(historyRow.diferencia || 0)).toBeCloseTo(adjustmentValue, 2);

  const adjustmentDetailResult = await authenticatedApi(page, 'stock_precios_ajuste_obtener', {
    query: { id_ajuste_precio: adjustmentId, _: Date.now() },
  });
  const adjustmentDetailBody = expectApiSuccess(adjustmentDetailResult, 'No se pudo recuperar el detalle del ajuste');
  const adjustmentDetail = stockPayload(adjustmentDetailBody);
  expect(Number(adjustmentDetail.ajuste?.id_ajuste_precio || 0)).toBe(adjustmentId);
  expect(Array.isArray(adjustmentDetail.items)).toBeTruthy();
  expect(adjustmentDetail.items.some((row) => Number(row?.id_stock_producto || 0) === productId)).toBeTruthy();

  const adjustmentsHistoryResult = await authenticatedApi(page, 'stock_precios_ajustes_historial', {
    query: { limit: 100, _: Date.now() },
  });
  const adjustmentsHistoryBody = expectApiSuccess(adjustmentsHistoryResult, 'No se pudo recuperar el historial global de ajustes');
  const adjustmentsHistory = stockPayload(adjustmentsHistoryBody).ajustes || [];
  expect(adjustmentsHistory.some((row) => Number(row?.id_ajuste_precio || 0) === adjustmentId)).toBeTruthy();
});

test('@stock @backend @variants @critical variante: transición simple→variantes y update parcial preservan contrato local', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(3 * 60_000);

  const units = await listStockUnits(page, 'todos');
  const fractionalUnit = units.find((unit) =>
    Number(unit?.activo ?? 1) === 1 &&
    Number(unit?.permite_decimales || 0) === 1 &&
    Number(unit?.es_default || 0) !== 1,
  );
  expect(fractionalUnit, 'Debe existir una unidad fraccionable activa para aislar variantes de Tienda Nube').toBeTruthy();

  const productName = uniqueName('STOCK-VAR-BACKEND');
  const productSku = uniqueSku('SVB-P');
  const createdBody = await createStockProductFixture(page, {
    name: productName,
    sku: productSku,
    stock: 6.5,
    cost: 80,
    price: 140,
    unitId: Number(fractionalUnit.id_stock_unidad),
  });
  const product = extractProduct(createdBody);
  const productId = Number(product?.id_stock_producto || product?.id || 0);
  expect(productId).toBeGreaterThan(0);
  assertNoTiendaNubeJobs(stockPayload(createdBody).tiendanube_sync, 'Alta del padre fraccionable');

  const baseline = await getStockChanges(page);
  const variantName = uniqueName('VARIANTE-BACKEND', 65);
  const variantSku = uniqueSku('SVB-V');
  const createVariantResult = await authenticatedApi(page, 'stock_variante_crear', {
    method: 'POST',
    body: {
      id_stock_producto: productId,
      nombre_variante: variantName,
      sku: variantSku,
      stock: 1.375,
      id_stock_unidad: Number(fractionalUnit.id_stock_unidad),
      atributos: [],
      categorias: [],
      precios: [],
    },
  });
  const createVariantBody = expectApiSuccess(createVariantResult, 'No se pudo crear la variante por API');
  const createVariantData = stockPayload(createVariantBody);
  const variant = createVariantData.variante || {};
  const variantId = Number(createVariantData.id_stock_variante || variant.id_stock_variante || 0);
  expect(variantId, 'El alta de variante debe devolver un ID real').toBeGreaterThan(0);
  expect(String(variant.nombre_variante || '')).toBe(variantName);
  expect(String(variant.sku || '')).toBe(variantSku);
  expect(Number(variant.stock || 0)).toBeCloseTo(1.375, 3);
  expect(Number(variant.id_stock_unidad || 0)).toBe(Number(fractionalUnit.id_stock_unidad));
  assertNoTiendaNubeJobs(createVariantData.tiendanube_sync, 'Alta de variante fraccionable');
  await expectCatalogChange(page, stockVersions(baseline));

  const parentResult = await authenticatedApi(page, 'stock_producto_obtener', {
    query: { id_stock_producto: productId, _: Date.now() },
  });
  const parentBody = expectApiSuccess(parentResult, 'No se pudo releer el padre tras crear la variante');
  const parent = extractProduct(parentBody);
  expect(Number(parent?.tiene_variantes || 0), 'El padre debe pasar a modo variantes').toBe(1);
  expect(Number(parent?.stock_producto || 0), 'La fila física del producto padre debe quedar con stock 0 al pasar a variantes').toBeCloseTo(0, 3);
  expect(Number(parent?.stock_variantes || 0), 'El resumen debe reflejar el stock de las variantes activas').toBeCloseTo(1.375, 3);
  expect(Number(parent?.stock || 0), 'El campo stock público debe representar el stock agregado de variantes').toBeCloseTo(1.375, 3);

  const listResult = await authenticatedApi(page, 'stock_variantes_listar', {
    query: { id_stock_producto: productId, activo: 'todos', _: Date.now() },
  });
  const listBody = expectApiSuccess(listResult, 'No se pudieron listar las variantes del producto');
  const listed = stockPayload(listBody).variantes || [];
  expect(listed.some((row) => Number(row?.id_stock_variante || 0) === variantId)).toBeTruthy();

  const getVariantResult = await authenticatedApi(page, 'stock_variante_obtener', {
    query: { id_stock_variante: variantId, _: Date.now() },
  });
  const getVariantBody = expectApiSuccess(getVariantResult, 'No se pudo obtener la variante por ID');
  const obtained = stockPayload(getVariantBody).variante || {};
  expect(Number(obtained.id_stock_variante || 0)).toBe(variantId);
  expect(String(obtained.sku || '')).toBe(variantSku);

  const beforeUpdate = await getStockChanges(page);
  const updateVariantResult = await authenticatedApi(page, 'stock_variante_actualizar', {
    method: 'POST',
    body: {
      id_stock_variante: variantId,
      stock: 4.875,
    },
  });
  const updateVariantBody = expectApiSuccess(updateVariantResult, 'No se pudo actualizar parcialmente la variante');
  const updateVariantData = stockPayload(updateVariantBody);
  const updatedVariant = updateVariantData.variante || {};
  expect(Number(updatedVariant.id_stock_variante || 0)).toBe(variantId);
  expect(String(updatedVariant.nombre_variante || '')).toBe(variantName);
  expect(String(updatedVariant.sku || '')).toBe(variantSku);
  expect(Number(updatedVariant.stock || 0)).toBeCloseTo(4.875, 3);
  expect(Number(updatedVariant.id_stock_unidad || 0)).toBe(Number(fractionalUnit.id_stock_unidad));
  assertNoTiendaNubeJobs(updateVariantData.tiendanube_sync, 'Update parcial de variante fraccionable');
  await expectCatalogChange(page, stockVersions(beforeUpdate));

  const duplicateSku = await authenticatedApi(page, 'stock_variante_validar_sku', {
    query: { sku: variantSku, id_stock_variante: 0, _: Date.now() },
  });
  const duplicateBody = expectApiSuccess(duplicateSku, 'No se pudo verificar el SKU de la variante');
  expect(stockPayload(duplicateBody).disponible).toBe(false);

  const impactResult = await authenticatedApi(page, 'stock_variante_impacto_eliminacion', {
    query: { id_stock_variante: variantId, _: Date.now() },
  });
  const impactBody = expectApiSuccess(impactResult, 'No se pudo calcular el impacto de eliminación de variante');
  const impact = stockPayload(impactBody).impacto || {};
  expect(Number(impact.total_items_afectados || 0)).toBe(0);
  expect(Number(impact.total_movimientos_afectados || 0)).toBe(0);
});
