import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import {
  fillMovementRow,
  fillPayment,
  requireMutations,
  selectFirstAutocomplete,
  selectFirstNonEmpty,
  waitDialog,
  waitForBusyToFinish,
} from './support/ui.js';
import {
  createSale,
  applySaleCreditNote,
  deleteSale,
  openMovementDetail,
} from './support/flows.js';
import {
  createServiceArticleFixture,
  deleteServiceArticleFixture,
  ensureActiveServiceUnit,
  expectServiceStock,
  serviciosApi,
} from './support/services.js';

async function get(page, action, query = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { query }), `Falló ${action}`);
}
async function post(page, action, body = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { method: 'POST', body }), `Falló ${action}`);
}
async function bestEffort(page, action, body = {}) {
  try { return await serviciosApi(page, action, { method: 'POST', body }); } catch { return null; }
}

test.describe('BALTO Servicios <-> Movimientos', () => {
  test('@crud @critical vender un servicio consume su composición; NC y eliminación revierten exactamente', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('INSUMO-RECETA', 120);
    const serviceName = uniqueName('SERVICIO-VENTA', 120);
    const unit = await ensureActiveServiceUnit(page);
    let articleId = 0;
    let serviceId = 0;
    let saleCreated = false;

    try {
      const article = await createServiceArticleFixture(page, {
        name: articleName,
        type: 'INSUMO',
        idUnit: Number(unit.id_unidad),
        stock: 10,
        cost: 25,
        price: 50,
      });
      articleId = Number(article.id_articulo);

      const created = await post(page, 'servicios_servicio_crear', {
        nombre: serviceName,
        id_categoria: null,
        id_unidad_cobro: Number(unit.id_unidad),
        descripcion: 'SERVICIO E2E CON CONSUMO DE INSUMO',
        costo_base: 50,
        duracion_estimada_minutos: 60,
        precio_venta: 300,
        iva_pct: 21,
        composicion: {
          articulos: [{ id_articulo: articleId, cantidad: 2 }],
          trabajadores: [],
        },
      });
      serviceId = Number(created.id_servicio || created.data?.id_servicio || 0);
      expect(serviceId).toBeGreaterThan(0);

      await createSale(page, { serviceName, quantity: 2, price: 300 });
      saleCreated = true;
      await expectServiceStock(page, articleName, 6);

      const detail = await openMovementDetail(page, serviceName, 'sale');
      await expect(detail).toContainText(serviceName);
      await detail.getByRole('button', { name: /Cerrar/i }).click();
      await expect(detail).toBeHidden();

      let history = (await get(page, 'servicios_stock_historial', { id_articulo: articleId, limit: 100 })).historial || [];
      expect(history.some((row) => /VENTA_RESTA/i.test(String(row.motivo || '')))).toBe(true);
      expect(history.some((row) => Number(row.cantidad_movimiento) === -4)).toBe(true);

      await page.goto('/panel/ventas');
      await applySaleCreditNote(page, serviceName, 1);
      await expectServiceStock(page, articleName, 8);

      history = (await get(page, 'servicios_stock_historial', { id_articulo: articleId, limit: 100 })).historial || [];
      expect(history.some((row) => /NOTA_CREDITO_VENTA_SUMA/i.test(String(row.motivo || '')))).toBe(true);
      expect(history.some((row) => Number(row.cantidad_movimiento) === 2)).toBe(true);

      await page.goto('/panel/ventas');
      await deleteSale(page, serviceName);
      saleCreated = false;
      await expectServiceStock(page, articleName, 10);

      history = (await get(page, 'servicios_stock_historial', { id_articulo: articleId, limit: 100 })).historial || [];
      expect(history.some((row) => /REVERSAR_/i.test(String(row.motivo || '')))).toBe(true);
    } finally {
      if (saleCreated) {
        try {
          await page.goto('/panel/ventas');
          await deleteSale(page, serviceName);
        } catch {
          // El teardown continúa con los recursos de catálogo aun si la venta ya no existe.
        }
      }
      if (serviceId) {
        await bestEffort(page, 'servicios_composicion_guardar', {
          id_servicio: serviceId,
          composicion: { articulos: [], trabajadores: [] },
        });
        const deleted = await bestEffort(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
        if (deleted?.status === 409) await bestEffort(page, 'servicios_servicio_dar_baja', { id_servicio: serviceId });
      }
      if (articleId) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
    }
  });

  test('@crud @critical un material en un servicio activo puede darse de baja sin romper la receta ni la venta del servicio', async ({ page }) => {
    test.setTimeout(4 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('MATERIAL-BAJA-RECETA', 120);
    const serviceName = uniqueName('SERVICIO-BAJA-RECETA', 120);
    const unit = await ensureActiveServiceUnit(page);
    let articleId = 0;
    let serviceId = 0;
    let saleCreated = false;

    try {
      const article = await createServiceArticleFixture(page, {
        name: articleName,
        type: 'MATERIAL',
        idUnit: Number(unit.id_unidad),
        stock: 10,
        cost: 25,
        price: 50,
      });
      articleId = Number(article.id_articulo);

      const created = await post(page, 'servicios_servicio_crear', {
        nombre: serviceName,
        id_categoria: null,
        id_unidad_cobro: Number(unit.id_unidad),
        descripcion: 'SERVICIO E2E CON MATERIAL QUE LUEGO SE DA DE BAJA',
        costo_base: 0,
        duracion_estimada_minutos: 30,
        precio_venta: 200,
        iva_pct: 21,
        composicion: {
          articulos: [{ id_articulo: articleId, cantidad: 2 }],
          trabajadores: [],
        },
      });
      serviceId = Number(created.id_servicio || created.data?.id_servicio || 0);
      expect(serviceId).toBeGreaterThan(0);

      // La baja lógica debe estar permitida aunque el material esté referenciado
      // por un servicio activo. No se elimina ninguna relación histórica/operativa.
      await post(page, 'servicios_material_dar_baja', { id_articulo: articleId });
      const inactive = await get(page, 'servicios_materiales_listar', { activo: 0, q: articleName, limit: 50 });
      expect((inactive.materiales || []).some((row) => Number(row.id_articulo) === articleId)).toBe(true);

      const serviceAfterDown = await get(page, 'servicios_servicio_obtener', { id_servicio: serviceId });
      const retained = serviceAfterDown.servicio?.articulos || serviceAfterDown.servicio?.composicion?.articulos || [];
      expect(retained.some((row) => Number(row.id_articulo) === articleId)).toBe(true);

      // Guardar de nuevo una receta existente con el componente ya dado de baja
      // debe seguir siendo válido; lo que se prohíbe es agregar uno inactivo nuevo.
      await post(page, 'servicios_composicion_guardar', {
        id_servicio: serviceId,
        composicion: {
          articulos: [{ id_articulo: articleId, cantidad: 2 }],
          trabajadores: [],
        },
      });

      // El servicio sigue siendo la entidad seleccionable. Su receta conservada
      // puede consumir el stock restante del material inactivo.
      await createSale(page, { serviceName, quantity: 1, price: 200 });
      saleCreated = true;
      await expectServiceStock(page, articleName, 8);

      await page.goto('/panel/ventas');
      await deleteSale(page, serviceName);
      saleCreated = false;
      await expectServiceStock(page, articleName, 10);

      await post(page, 'servicios_material_reactivar', { id_articulo: articleId });
      const active = await get(page, 'servicios_materiales_listar', { activo: 1, q: articleName, limit: 50 });
      expect((active.materiales || []).some((row) => Number(row.id_articulo) === articleId)).toBe(true);
    } finally {
      if (saleCreated) {
        try {
          await page.goto('/panel/ventas');
          await deleteSale(page, serviceName);
        } catch {}
      }
      if (articleId) await bestEffort(page, 'servicios_material_reactivar', { id_articulo: articleId });
      if (serviceId) {
        await bestEffort(page, 'servicios_composicion_guardar', {
          id_servicio: serviceId,
          composicion: { articulos: [], trabajadores: [] },
        });
        const deleted = await bestEffort(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
        if (deleted?.status === 409) await bestEffort(page, 'servicios_servicio_dar_baja', { id_servicio: serviceId });
      }
      if (articleId) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
    }
  });

  test('@critical una venta de servicio se bloquea si la receta dejaría stock negativo', async ({ page }) => {
    test.setTimeout(3 * 60_000);
    await requireMutations(test, page);

    const articleName = uniqueName('INSUMO-SIN-STOCK', 120);
    const serviceName = uniqueName('SERVICIO-SIN-STOCK', 120);
    const unit = await ensureActiveServiceUnit(page);
    let articleId = 0;
    let serviceId = 0;

    try {
      const article = await createServiceArticleFixture(page, {
        name: articleName,
        type: 'INSUMO',
        idUnit: Number(unit.id_unidad),
        stock: 1,
        cost: 25,
        price: 50,
      });
      articleId = Number(article.id_articulo);

      const created = await post(page, 'servicios_servicio_crear', {
        nombre: serviceName,
        id_categoria: null,
        id_unidad_cobro: Number(unit.id_unidad),
        descripcion: 'SERVICIO E2E BLOQUEO STOCK',
        costo_base: 0,
        duracion_estimada_minutos: 15,
        precio_venta: 100,
        iva_pct: 21,
        composicion: {
          articulos: [{ id_articulo: articleId, cantidad: 2 }],
          trabajadores: [],
        },
      });
      serviceId = Number(created.id_servicio || 0);

      await page.goto('/panel/ventas');
      await waitForBusyToFinish(page);
      await page.getByRole('button', { name: /Nueva Venta/i }).click();
      const saleDialog = await waitDialog(page, 'Nueva Venta');
      await fillMovementRow(saleDialog, { serviceName, quantity: 1, price: 100 });
      await selectFirstAutocomplete(saleDialog, 'Cliente', '');

      const typeField = saleDialog.locator('.gm-field').filter({ hasText: 'Forma de venta' }).first();
      const typeSelect = typeField.locator('select');
      const selected = await selectFirstNonEmpty(typeSelect, /CUENTA\s*CORRIENTE/i);
      if (/CONTADO/i.test(selected.text)) await fillPayment(saleDialog);

      const responsePromise = page.waitForResponse(
        (response) => {
          if (response.request().method() !== 'POST') return false;
          const action = new URL(response.url()).searchParams.get('action');
          return action === 'ventas_crear_batch' || action === 'ventas_crear';
        },
        { timeout: 60_000 },
      );
      const save = saleDialog.getByRole('button', { name: /Guardar venta/i }).last();
      await expect(save).toBeEnabled();
      await save.click();

      const response = await responsePromise;
      const body = await response.json().catch(() => ({}));
      expect(response.status()).toBe(409);
      expect(body?.exito ?? body?.success).toBe(false);
      expect(String(body?.mensaje || body?.message || '')).toMatch(/Stock insuficiente/i);
      await expect(saleDialog).toBeVisible();
      await expectServiceStock(page, articleName, 1);
    } finally {
      // Si el frontend quedó con el modal abierto por el 409, lo cerramos antes de limpiar.
      const openDialog = page.getByRole('dialog').last();
      if (await openDialog.isVisible().catch(() => false)) {
        const cancel = openDialog.getByRole('button', { name: /Cancelar|Cerrar/i }).last();
        if (await cancel.isVisible().catch(() => false)) await cancel.click().catch(() => null);
      }
      if (serviceId) {
        await bestEffort(page, 'servicios_composicion_guardar', {
          id_servicio: serviceId,
          composicion: { articulos: [], trabajadores: [] },
        });
        await bestEffort(page, 'servicios_servicio_eliminar', { id_servicio: serviceId });
      }
      if (articleId) await deleteServiceArticleFixture(page, articleName, { tolerateHistoricalUse: true });
    }
  });
});
