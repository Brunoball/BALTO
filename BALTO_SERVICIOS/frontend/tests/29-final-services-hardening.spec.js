import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import {
  requireMutations,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  createPurchaseFixtureViaApi,
  createSale,
  deletePurchase,
  deleteSale,
  getPurchaseFixtureViaApi,
} from './support/flows.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  ensureActiveServiceUnit,
  expectServiceStock,
  serviciosApi,
} from './support/services.js';

function movementId(body) {
  return Number(
    body?.id_movimiento ??
      body?.id_compra ??
      body?.data?.id_movimiento ??
      body?.data?.id_compra ??
      0,
  );
}

function itemArticleId(item) {
  return Number(item?.id_articulo ?? item?.id_stock_producto ?? item?.idStockProducto ?? 0);
}

function itemId(item) {
  return Number(item?.id_item ?? item?.idItem ?? 0);
}

function purchaseItems(purchase) {
  return Array.isArray(purchase?.items_detalle) ? purchase.items_detalle : [];
}

function purchaseEditItem(item, patch = {}) {
  const idArticulo = itemArticleId(item);
  return {
    id_item: itemId(item) || undefined,
    tipo_item: 'ARTICULO',
    id_articulo: idArticulo || null,
    id_stock_producto: idArticulo || null,
    id_detalle: idArticulo ? null : Number(item?.id_detalle || 0) || null,
    descripcion: String(item?.descripcion ?? item?.nombre ?? item?.detalle ?? '').trim(),
    cantidad: Number(patch.quantity ?? item?.cantidad ?? 1),
    precio: Number(patch.price ?? item?.precio ?? 0),
    iva_pct: Number(patch.ivaPct ?? item?.iva_pct ?? 0),
  };
}

async function locateMovementRow(page, route, query, placeholder, idMovimiento) {
  await page.goto(route);
  await waitForBusyToFinish(page);
  const search = page.getByPlaceholder(placeholder).first();
  await expect(search).toBeVisible({ timeout: 20_000 });

  const row = page.locator(
    `.mov-gridTable--row:visible:not(.mov-row--skeleton)[data-movement-id="${Number(idMovimiento)}"]`,
  );

  await expect(async () => {
    await search.fill(query);
    await search.press('Enter');
    await waitForBusyToFinish(page);
    await expect(row).toBeVisible({ timeout: 8_000 });
  }).toPass({
    timeout: 35_000,
    intervals: [300, 700, 1_500],
  });

  return row;
}

async function createServiceUsingArticle(page, { serviceName, articleId, quantity = 2, price = 200 }) {
  const unit = await ensureActiveServiceUnit(page);
  const result = expectApiSuccess(
    await serviciosApi(page, 'servicios_servicio_crear', {
      method: 'POST',
      body: {
        nombre: serviceName,
        id_categoria: null,
        id_unidad_cobro: Number(unit.id_unidad),
        descripcion: `SERVICIO E2E ${serviceName}`,
        costo_base: 0,
        duracion_estimada_minutos: 30,
        precio_venta: Number(price),
        iva_pct: 21,
        composicion: {
          articulos: [{ id_articulo: Number(articleId), cantidad: Number(quantity) }],
          trabajadores: [],
        },
      },
    }),
    `No se pudo crear el servicio ${serviceName}`,
  );
  const idServicio = Number(result?.id_servicio ?? result?.data?.id_servicio ?? 0);
  expect(idServicio, `El alta de ${serviceName} debe devolver id_servicio`).toBeGreaterThan(0);
  return idServicio;
}

async function cleanupService(page, idServicio) {
  if (!(Number(idServicio) > 0)) return;
  await serviciosApi(page, 'servicios_composicion_guardar', {
    method: 'POST',
    body: {
      id_servicio: Number(idServicio),
      composicion: { articulos: [], trabajadores: [] },
    },
  }).catch(() => null);
  const deleted = await serviciosApi(page, 'servicios_servicio_eliminar', {
    method: 'POST',
    body: { id_servicio: Number(idServicio) },
  }).catch(() => null);
  if (deleted?.status === 409) {
    await serviciosApi(page, 'servicios_servicio_dar_baja', {
      method: 'POST',
      body: { id_servicio: Number(idServicio) },
    }).catch(() => null);
  }
}

test.describe('Blindajes finales BALTO Servicios', () => {
  test('@crud @critical compra multiítem: preserva filas, permite altas/bajas explícitas y rechaza payload truncado', async ({ page }) => {
    test.setTimeout(7 * 60_000);
    await requireMutations(test, page);

    const productA = uniqueName('CIERRE-COMPRA-A', 110);
    const productB = uniqueName('CIERRE-COMPRA-B', 110);
    const productC = uniqueName('CIERRE-COMPRA-C', 110);
    let purchaseCreated = false;

    try {
      const articleA = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: productA, stock: 10, cost: 50, price: 90,
      });
      const articleB = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: productB, stock: 20, cost: 60, price: 100,
      });
      const articleC = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: productC, stock: 30, cost: 70, price: 110,
      });

      const created = await createPurchaseFixtureViaApi(page, {
        items: [
          { productName: productA, quantity: 3, price: 50, ivaPct: 21 },
          { productName: productB, quantity: 4, price: 60, ivaPct: 21 },
        ],
      });
      const idCompra = movementId(created);
      expect(idCompra).toBeGreaterThan(0);
      purchaseCreated = true;

      await expectServiceStock(page, productA, 13);
      await expectServiceStock(page, productB, 24);
      await expectServiceStock(page, productC, 30);

      const original = await getPurchaseFixtureViaApi(page, idCompra);
      const originalItems = purchaseItems(original);
      expect(originalItems, 'La fixture debe persistir dos renglones reales').toHaveLength(2);
      const originalIds = originalItems.map(itemId).filter(Boolean).sort((a, b) => a - b);
      expect(originalIds).toHaveLength(2);

      // Blindaje backend: simula exactamente el cliente viejo que enviaba sólo el
      // primer renglón. Debe rechazarse y conservar compra + stock sin cambios.
      const truncatedResult = await authenticatedApi(page, 'compras_editar', {
        method: 'POST',
        body: {
          id_movimiento: idCompra,
          fecha: original.fecha,
          id_tipo_venta: Number(original.id_tipo_venta),
          id_proveedor: Number(original.id_proveedor),
          items: [purchaseEditItem(originalItems[0], { price: 55 })],
        },
      });
      expect(truncatedResult.status, truncatedResult.text).toBe(409);
      expect(String(truncatedResult.body?.mensaje || truncatedResult.body?.message || '')).toMatch(
        /todos|renglones|recarg|editor/i,
      );
      expect(purchaseItems(await getPurchaseFixtureViaApi(page, idCompra))).toHaveLength(2);
      await expectServiceStock(page, productA, 13);
      await expectServiceStock(page, productB, 24);

      // Edición UI normal: modificar el primer renglón NO debe perder el segundo.
      let row = await locateMovementRow(
        page,
        '/panel/compras',
        productA,
        /Buscar por descripción, proveedor/i,
        idCompra,
      );
      await row.getByTitle('Editar').click();
      let dialog = await waitDialog(page, 'Editar compra');
      let rows = dialog.locator('.gm-table-body .gm-table-row');
      await expect(rows).toHaveCount(2);
      const firstPrice = rows.nth(0).locator('input[type="number"]').nth(1);
      await firstPrice.fill('55');
      await firstPrice.blur();

      let editRequestBody = null;
      const captureFirstEdit = (request) => {
        if (request.method() !== 'POST') return;
        if (new URL(request.url()).searchParams.get('action') !== 'compras_editar') return;
        editRequestBody = request.postDataJSON();
      };
      page.on('request', captureFirstEdit);
      try {
        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === 'POST'
            && new URL(response.url()).searchParams.get('action') === 'compras_editar',
          { timeout: 90_000 },
        );
        await dialog.getByRole('button', { name: /Guardar cambios/i }).last().click();
        const response = await responsePromise;
        const body = await response.json().catch(() => ({}));
        expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
        expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
        await expect(dialog).toBeHidden({ timeout: 90_000 });
      } finally {
        page.off('request', captureFirstEdit);
      }
      expect(editRequestBody?.items, 'La UI debe mandar los dos renglones originales').toHaveLength(2);
      expect(
        [...(editRequestBody?.ids_items_originales || [])].map(Number).sort((a, b) => a - b),
      ).toEqual(originalIds);

      let afterPreserve = await getPurchaseFixtureViaApi(page, idCompra);
      const afterPreserveItems = purchaseItems(afterPreserve);
      expect(afterPreserveItems).toHaveLength(2);
      expect(afterPreserveItems.map(itemArticleId).sort((a, b) => a - b)).toEqual(
        [Number(articleA.id_articulo), Number(articleB.id_articulo)].sort((a, b) => a - b),
      );
      // ComprasService::replaceItems() puede recrear físicamente los renglones al editar,
      // por lo que los id_item válidos para una edición posterior son los que quedaron
      // persistidos después de la primera edición, no los IDs de creación originales.
      const currentIds = afterPreserveItems.map(itemId).filter(Boolean).sort((a, b) => a - b);
      expect(currentIds).toHaveLength(2);
      const currentArticleBItemId = itemId(
        afterPreserveItems.find((item) => itemArticleId(item) === Number(articleB.id_articulo)),
      );
      expect(currentArticleBItemId).toBeGreaterThan(0);
      await expectServiceStock(page, productA, 13);
      await expectServiceStock(page, productB, 24);

      // Segunda edición: agrega C y elimina B. La baja debe viajar declarada por
      // id_item y el nuevo artículo debe persistirse sin reutilizar snapshots ajenos.
      row = await locateMovementRow(
        page,
        '/panel/compras',
        productA,
        /Buscar por descripción, proveedor/i,
        idCompra,
      );
      await row.getByTitle('Editar').click();
      dialog = await waitDialog(page, 'Editar compra');
      rows = dialog.locator('.gm-table-body .gm-table-row');
      await expect(rows).toHaveCount(2);

      await dialog.getByTitle('Agregar otro artículo a la compra').click();
      await expect(rows).toHaveCount(3);
      const newRow = rows.nth(2);
      await newRow.locator('select').first().selectOption(String(articleC.id_articulo));
      await newRow.locator('input[type="number"]').nth(0).fill('2');
      await newRow.locator('input[type="number"]').nth(1).fill('70');
      await newRow.locator('select').nth(1).selectOption('21');

      await dialog.getByRole('button', { name: /Eliminar fila 2/i }).click();
      await expect(rows).toHaveCount(2);

      let secondEditBody = null;
      const captureSecondEdit = (request) => {
        if (request.method() !== 'POST') return;
        if (new URL(request.url()).searchParams.get('action') !== 'compras_editar') return;
        secondEditBody = request.postDataJSON();
      };
      page.on('request', captureSecondEdit);
      try {
        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === 'POST'
            && new URL(response.url()).searchParams.get('action') === 'compras_editar',
          { timeout: 90_000 },
        );
        await dialog.getByRole('button', { name: /Guardar cambios/i }).last().click();
        const response = await responsePromise;
        const body = await response.json().catch(() => ({}));
        expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
        expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
        await expect(dialog).toBeHidden({ timeout: 90_000 });
      } finally {
        page.off('request', captureSecondEdit);
      }

      expect(secondEditBody?.items).toHaveLength(2);
      expect(secondEditBody?.ids_items_originales?.map(Number).sort((a, b) => a - b)).toEqual(currentIds);
      expect(secondEditBody?.ids_items_eliminados?.map(Number)).toHaveLength(1);
      expect(Number(secondEditBody.ids_items_eliminados[0])).toBe(currentArticleBItemId);

      const finalPurchase = await getPurchaseFixtureViaApi(page, idCompra);
      const finalArticleIds = purchaseItems(finalPurchase).map(itemArticleId).sort((a, b) => a - b);
      expect(finalArticleIds).toEqual(
        [Number(articleA.id_articulo), Number(articleC.id_articulo)].sort((a, b) => a - b),
      );
      expect(purchaseItems(finalPurchase).some((item) => itemArticleId(item) === Number(articleB.id_articulo))).toBe(false);

      await expectServiceStock(page, productA, 13);
      await expectServiceStock(page, productB, 20);
      await expectServiceStock(page, productC, 32);
    } finally {
      if (purchaseCreated) {
        try { await deletePurchase(page, productA); } catch {}
      }
      for (const name of [productA, productB, productC]) {
        try { await deleteServiceArticleFixture(page, name, { tolerateHistoricalUse: true }); } catch {}
      }
    }
  });

  test('@critical compra: editar precio con stock parcialmente consumido aplica delta y no genera negativo transitorio', async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('CIERRE-DELTA-COMPRA', 110);
    const serviceName = uniqueName('CIERRE-DELTA-SERVICIO', 110);
    let articleId = 0;
    let serviceId = 0;
    let purchaseCreated = false;
    let saleCreated = false;

    try {
      const article = await createServiceArticleFixture(page, {
        type: 'INSUMO', name: articleName, stock: 0, cost: 10, price: 25,
      });
      articleId = Number(article.id_articulo);

      const created = await createPurchaseFixtureViaApi(page, {
        productName: articleName,
        quantity: 10,
        price: 10,
        ivaPct: 21,
      });
      const idCompra = movementId(created);
      expect(idCompra).toBeGreaterThan(0);
      purchaseCreated = true;
      await expectServiceStock(page, articleName, 10);

      serviceId = await createServiceUsingArticle(page, {
        serviceName,
        articleId,
        quantity: 2,
        price: 200,
      });
      await createSale(page, { serviceName, quantity: 3, price: 200 });
      saleCreated = true;
      await expectServiceStock(page, articleName, 4);

      const purchase = await getPurchaseFixtureViaApi(page, idCompra);
      const items = purchaseItems(purchase);
      expect(items).toHaveLength(1);
      const originalItemId = itemId(items[0]);
      expect(originalItemId).toBeGreaterThan(0);

      const result = await authenticatedApi(page, 'compras_editar', {
        method: 'POST',
        body: {
          id_movimiento: idCompra,
          fecha: purchase.fecha,
          id_tipo_venta: Number(purchase.id_tipo_venta),
          id_proveedor: Number(purchase.id_proveedor),
          items: [purchaseEditItem(items[0], { price: 17 })],
          ids_items_originales: [originalItemId],
          ids_items_eliminados: [],
        },
      });
      expectApiSuccess(
        result,
        'Editar sólo el precio debe funcionar aunque el servicio ya haya consumido parte del stock comprado',
      );

      await expectServiceStock(page, articleName, 4);
      const edited = await getPurchaseFixtureViaApi(page, idCompra);
      expect(purchaseItems(edited)).toHaveLength(1);
      expect(Number(purchaseItems(edited)[0].cantidad)).toBeCloseTo(10, 6);
      expect(Number(purchaseItems(edited)[0].precio)).toBeCloseTo(17, 2);
    } finally {
      if (saleCreated) {
        try { await page.goto('/panel/ventas'); await deleteSale(page, serviceName); } catch {}
      }
      if (purchaseCreated) {
        try { await deletePurchase(page, articleName); } catch {}
      }
      await cleanupService(page, serviceId);
      if (articleId) {
        try { await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true }); } catch {}
      }
    }
  });

  test('@critical orden de pago multiítem: preserva todos los renglones y edita por delta con stock ya consumido', async ({ page }) => {
    test.setTimeout(7 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('CIERRE-OP-INSUMO', 110);
    const secondName = uniqueName('CIERRE-OP-SEGUNDO', 110);
    const serviceName = uniqueName('CIERRE-OP-SERVICIO', 110);
    let articleId = 0;
    let secondId = 0;
    let serviceId = 0;
    let purchaseCreated = false;
    let saleCreated = false;

    try {
      const first = await createServiceArticleFixture(page, {
        type: 'INSUMO', name: articleName, stock: 0, cost: 20, price: 40,
      });
      const second = await createServiceArticleFixture(page, {
        type: 'PRODUCTO', name: secondName, stock: 5, cost: 30, price: 60,
      });
      articleId = Number(first.id_articulo);
      secondId = Number(second.id_articulo);

      const created = await createPurchaseFixtureViaApi(page, {
        items: [
          { productName: articleName, quantity: 5, price: 20, ivaPct: 21 },
          { productName: secondName, quantity: 2, price: 30, ivaPct: 21 },
        ],
      });
      const idCompra = movementId(created);
      expect(idCompra).toBeGreaterThan(0);
      purchaseCreated = true;
      await expectServiceStock(page, articleName, 5);
      await expectServiceStock(page, secondName, 7);

      serviceId = await createServiceUsingArticle(page, {
        serviceName,
        articleId,
        quantity: 2,
        price: 180,
      });
      await createSale(page, { serviceName, quantity: 2, price: 180 });
      saleCreated = true;
      await expectServiceStock(page, articleName, 1);

      const row = await locateMovementRow(
        page,
        '/panel/OrdenesPago',
        articleName,
        /Buscar por descripción, proveedor/i,
        idCompra,
      );
      await row.getByTitle('Editar').click();
      const dialog = await waitDialog(page, 'Editar orden de pago');

      const priceInput = dialog
        .locator('.gm-field')
        .filter({ hasText: /Precio unitario/i })
        .locator('input[type="number"]')
        .first();
      await expect(priceInput).toBeVisible();
      await priceInput.fill('25');
      await priceInput.blur();

      let sentBody = null;
      const captureRequest = (request) => {
        if (request.method() !== 'POST') return;
        if (new URL(request.url()).searchParams.get('action') !== 'ordenes_pago_actualizar') return;
        sentBody = request.postDataJSON();
      };
      page.on('request', captureRequest);
      try {
        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === 'POST'
            && new URL(response.url()).searchParams.get('action') === 'ordenes_pago_actualizar',
          { timeout: 90_000 },
        );
        await dialog.getByRole('button', { name: /Guardar cambios/i }).last().click();
        const response = await responsePromise;
        const body = await response.json().catch(() => ({}));
        expect(response.status(), JSON.stringify(body)).toBeLessThan(400);
        expect(body?.exito !== false && body?.success !== false, body?.mensaje || body?.message).toBeTruthy();
        await expect(dialog).toBeHidden({ timeout: 90_000 });
      } finally {
        page.off('request', captureRequest);
      }

      expect(sentBody?.items_completos).toBe(true);
      expect(sentBody?.items, 'La OP debe reenviar los dos renglones de la compra').toHaveLength(2);
      const sentArticleIds = sentBody.items.map(itemArticleId).sort((a, b) => a - b);
      expect(sentArticleIds).toEqual([articleId, secondId].sort((a, b) => a - b));

      const persisted = await getPurchaseFixtureViaApi(page, idCompra);
      expect(purchaseItems(persisted)).toHaveLength(2);
      expect(purchaseItems(persisted).map(itemArticleId).sort((a, b) => a - b)).toEqual(
        [articleId, secondId].sort((a, b) => a - b),
      );
      expect(Number(purchaseItems(persisted)[0].precio)).toBeCloseTo(25, 2);

      // La edición fue sólo monetaria: aun con 4/5 unidades ya consumidas por el
      // servicio, no debe existir reversión total temporal ni tocar existencias.
      await expectServiceStock(page, articleName, 1);
      await expectServiceStock(page, secondName, 7);
    } finally {
      if (saleCreated) {
        try { await page.goto('/panel/ventas'); await deleteSale(page, serviceName); } catch {}
      }
      if (purchaseCreated) {
        try { await deletePurchase(page, articleName); } catch {}
      }
      await cleanupService(page, serviceId);
      for (const name of [articleName, secondName]) {
        try { await deleteServiceArticleFixture(page, name, { tolerateHistoricalUse: true }); } catch {}
      }
    }
  });
});
