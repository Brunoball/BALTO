import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
import { createVariantStockProduct } from './support/barcodes.js';
import { getStockE2EFixtureUnit } from './support/stock-units.js';
import { uniqueName, uniqueSku } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';

const unwrap = response => response?.data && typeof response.data === 'object'
  ? { ...response.data, ...response } : response || {};
const localDay = (offset = 0) => {
  const pieces = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Cordoba', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + offset * 86400000));
  const p = Object.fromEntries(pieces.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
async function api(page, action, body, query) {
  return unwrap(expectApiSuccess(await authenticatedApi(page, action, body
    ? { method: 'POST', body } : { query: query || {} }), `Error en ${action}`));
}
async function consultar(page, id) {
  return await api(page, 'stock_vencimientos_consultar', null, { id_stock_producto: id });
}

test('@stock @vencimientos @critical retiro dirigido no hace FEFO doble y deja stock real correcto', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180000);
  const fraccionable = await getStockE2EFixtureUnit(page);
  const name = uniqueName('VENC-RETIRO');
  let created = false;
  try {
    const producto = unwrap(await createStockProductFixture(page, {
      name, sku: uniqueSku('VRET'), stock: 10, cost: 10, price: 20, unitId: Number(fraccionable.id_stock_unidad),
    }));
    const id = Number(producto.producto?.id_stock_producto || producto.producto?.id);
    expect(id).toBeGreaterThan(0);
    created = true;
    const temprano = await api(page, 'stock_vencimientos_guardar', {
      id_stock_producto: id, fecha_vencimiento: localDay(-2), cantidad: 4,
    });
    const tardio = await api(page, 'stock_vencimientos_guardar', {
      id_stock_producto: id, fecha_vencimiento: localDay(30), cantidad: 3,
    });
    const idPrimero = Number(temprano.id_vencimiento);
    const idSegundo = Number(tardio.id_vencimiento);
    const sinMotivo = await authenticatedApi(page, 'stock_vencimientos_retirar', {
      method: 'POST', body: { id_vencimiento: idSegundo, cantidad: 1, motivo: 'a' },
    });
    expect(sinMotivo.status).toBe(400);
    const excede = await authenticatedApi(page, 'stock_vencimientos_retirar', {
      method: 'POST', body: { id_vencimiento: idSegundo, cantidad: 4, motivo: 'Descarte por rotura de envase' },
    });
    expect(excede.status).toBe(409);
    const retirado = await api(page, 'stock_vencimientos_retirar', {
      id_vencimiento: idSegundo, cantidad: 2, motivo: 'Descarte preventivo de partida',
    });
    expect(Number(retirado.cantidad_retirada)).toBe(2);
    expect(Number(retirado.stock_restante)).toBe(8);
    const estado = await consultar(page, id);
    expect(Number(estado.producto.stock)).toBe(8);
    expect(Number(estado.vencimientos.find(v => Number(v.id_vencimiento) === idPrimero).cantidad_disponible)).toBe(4);
    expect(Number(estado.vencimientos.find(v => Number(v.id_vencimiento) === idSegundo).cantidad_disponible)).toBe(1);
    const alerta = await api(page, 'stock_vencimientos_alertas', null, { dias_aviso: 7 });
    expect(alerta.alertas.some(v => Number(v.id_vencimiento) === idPrimero)).toBe(true);
    expect(alerta.alertas.some(v => Number(v.id_vencimiento) === idSegundo)).toBe(false);
  } finally {
    // El retiro deja movimientos auditados: la UI prohíbe correctamente la
    // eliminación definitiva de productos con historial. La fixture global
    // _baltoE2ECleanup elimina sólo los registros del RUN_PREFIX al finalizar
    // el worker; no alterar esa protección para facilitar el testing.
    if (created) console.info(`[E2E] ${name}: limpieza diferida al cierre del worker (retiro auditado).`);
  }
});

test('@stock @vencimientos @critical retiro de una variante no altera otra', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180000);
  const name = uniqueName('VENC-RETVAR');
  let created = false;
  try {
    const fixture = await createVariantStockProduct(page, {
      name, sku: uniqueSku('RVVA'), variants: [{ name: 'AZUL', stock: 5, price: 100 }, { name: 'ROJO', stock: 6, price: 100 }],
    });
    created = true;
    const id = fixture.productId;
    const v1 = Number(fixture.variants[0].id_stock_variante || fixture.variants[0].id);
    const v2 = Number(fixture.variants[1].id_stock_variante || fixture.variants[1].id);
    const p1 = await api(page, 'stock_vencimientos_guardar', {
      id_stock_producto: id, id_stock_variante: v1, fecha_vencimiento: localDay(-1), cantidad: 3,
    });
    const p2 = await api(page, 'stock_vencimientos_guardar', {
      id_stock_producto: id, id_stock_variante: v2, fecha_vencimiento: localDay(3), cantidad: 4,
    });
    await api(page, 'stock_vencimientos_retirar', {
      id_vencimiento: p1.id_vencimiento, cantidad: 1, motivo: 'Retirado por estar vencido',
    });
    const final = await consultar(page, id);
    expect(Number(final.variantes.find(v => Number(v.id_stock_variante) === v1).stock)).toBe(4);
    expect(Number(final.variantes.find(v => Number(v.id_stock_variante) === v2).stock)).toBe(6);
    expect(Number(final.vencimientos.find(v => Number(v.id_vencimiento) === Number(p1.id_vencimiento)).cantidad_disponible)).toBe(2);
    expect(Number(final.vencimientos.find(v => Number(v.id_vencimiento) === Number(p2.id_vencimiento)).cantidad_disponible)).toBe(4);
  } finally {
    // El retiro deja movimientos auditados: la UI prohíbe correctamente la
    // eliminación definitiva de productos con historial. La fixture global
    // _baltoE2ECleanup elimina sólo los registros del RUN_PREFIX al finalizar
    // el worker; no alterar esa protección para facilitar el testing.
    if (created) console.info(`[E2E] ${name}: limpieza diferida al cierre del worker (retiro auditado).`);
  }
});

test('@stock @vencimientos @ui @notificaciones-ui notificación abre producto y pestaña de vencimientos', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180000);
  const name = uniqueName('VENC-LINK');
  const u = await getStockE2EFixtureUnit(page);
  let created = false;
  try {
    const product = unwrap(await createStockProductFixture(page, {
      name, sku: uniqueSku('VLINK'), stock: 5, cost: 10, price: 25, unitId: Number(u.id_stock_unidad),
    }));
    const id = Number(product.producto?.id_stock_producto || product.producto?.id);
    expect(id).toBeGreaterThan(0);
    created = true;
    await api(page, 'stock_vencimientos_guardar', {id_stock_producto: id, fecha_vencimiento: localDay(-1), cantidad: 2});
    await page.goto('/panel/dashboard');
    // El bootstrap inicial puede tapar la campanita durante algunos segundos:
    // esperamos su desaparición real antes de intentar interactuar.
    await expect(page.locator('#balto-bootstrap-loader')).toBeHidden({ timeout: 60_000 });
    await waitForBusyToFinish(page);
    const modal = page.getByRole('dialog', { name: 'Notificaciones de Stock' });
    if (!await modal.isVisible().catch(() => false)) {
      // La consulta de alertas puede abrir el diálogo automáticamente ENTRE
      // isVisible() y el click de la campanita. En ese caso la propia capa
      // intercepta el click: el resultado esperado YA ocurrió.
      await page.getByRole('button', { name: /Notificaciones de Stock/i })
        .click({ timeout: 8_000 })
        .catch(async (error) => {
          if (!await modal.isVisible().catch(() => false)) throw error;
        });
    }
    await expect(modal).toBeVisible();
    const fila = modal.locator('.sv-alert-entry').filter({ hasText: name });
    await expect(fila).toBeVisible({ timeout: 30_000 });
    // Cada alerta selecciona una partida; el botón para gestionarla está
    // en el pie del diálogo (no dentro de .sv-alert-entry).
    await fila.click();
    await expect(modal.getByRole('button', { name: /Ver producto y gestionar vencimiento/i })).toBeVisible();
    await modal.getByRole('button', { name: /Ver producto y gestionar vencimiento/i }).click();
    await expect(page).toHaveURL(/\/panel\/stock/);
    const editor = page.getByRole('dialog').filter({ hasText: 'Editar producto' }).first();
    await expect(editor.getByRole('tab', { name: /Vencimientos/i })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.getByText('Retirar stock').first()).toBeVisible();
  } finally {
    // El foco de esta prueba es la navegación entre alertas y edición, no la
    // eliminación de artículos. Todas sus partidas se limpian mediante el
    // cleanup por prefijo E2E al terminar el worker.
    if (created) console.info(`[E2E] ${name}: limpieza diferida al cierre del worker (partidas auditadas).`);
  }
});
