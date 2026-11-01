import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { createStockProductFixture } from './support/stock-fixtures.js';
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
    // Esta prueba valida el aislamiento entre variantes al RETIRAR stock.
    // No depende del formulario visual de alta, que tiene su propia suite.
    // El alta por API evita que un fallo transitorio del gate de sesión en
    // /panel/stock se presente como un supuesto botón «Agregar producto» ausente.
    const unit = await getStockE2EFixtureUnit(page);
    const skuAzul = uniqueSku('RVVAZ');
    const skuRojo = uniqueSku('RVVAR');
    expect(skuAzul).not.toBe(skuRojo);
    const fixture = unwrap(await createStockProductFixture(page, {
      name, sku: uniqueSku('RVVA'), stock: 0, cost: 0, price: 0,
      unitId: Number(unit.id_stock_unidad),
      variants: [
        { nombre_variante: 'AZUL', sku: skuAzul, stock: 5, unitId: Number(unit.id_stock_unidad) },
        { nombre_variante: 'ROJO', sku: skuRojo, stock: 6, unitId: Number(unit.id_stock_unidad) },
      ],
    }));
    const id = Number(fixture.producto?.id_stock_producto || fixture.producto?.id || 0);
    expect(id).toBeGreaterThan(0);
    created = true;
    const result = await api(page, 'stock_variantes_listar', null, { id_stock_producto: id, activo: 'todos' });
    const variants = Array.isArray(result.variantes) ? result.variantes : [];
    expect(variants).toHaveLength(2);
    const azul = variants.find(v => String(v.sku || '').trim().toUpperCase() === skuAzul);
    const rojo = variants.find(v => String(v.sku || '').trim().toUpperCase() === skuRojo);
    const v1 = Number(azul?.id_stock_variante || azul?.id || 0);
    const v2 = Number(rojo?.id_stock_variante || rojo?.id || 0);
    expect(v1, 'Debe existir la variante AZUL').toBeGreaterThan(0);
    expect(v2, 'Debe existir la variante ROJO').toBeGreaterThan(0);
    expect(v1).not.toBe(v2);
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

test('@stock @vencimientos @ui @notificaciones-ui cada tarjeta abre su producto específico', async ({ page }) => {
  await requireMutations(test, page);
  test.setTimeout(180000);
  const nombreUno = uniqueName('VENC-LINK-UNO');
  const nombreDos = uniqueName('VENC-LINK-DOS');
  const skuUno = uniqueSku('VLUNO');
  const skuDos = uniqueSku('VLDOS');
  expect(skuUno, 'Los productos de prueba deben tener SKU distintos').not.toBe(skuDos);
  const u = await getStockE2EFixtureUnit(page);
  const idProductos = [];
  try {
    // Dos alertas de productos distintos: no debe depender de la primera
    // fila ni de un botón global para abrir el producto correcto.
    for (const [nombre, fecha, sku] of [
      [nombreUno, localDay(3), skuUno],
      [nombreDos, localDay(-1), skuDos],
    ]) {
      const producto = unwrap(await createStockProductFixture(page, {
        name: nombre, sku, stock: 5, cost: 10, price: 25,
        unitId: Number(u.id_stock_unidad),
      }));
      const id = Number(producto.producto?.id_stock_producto || producto.producto?.id);
      expect(id).toBeGreaterThan(0);
      idProductos.push(id);
      await api(page, 'stock_vencimientos_guardar', {
        id_stock_producto: id, fecha_vencimiento: fecha, cantidad: 2,
      });
    }

    await page.goto('/panel/dashboard');
    await expect(page.locator('#balto-bootstrap-loader')).toBeHidden({ timeout: 60_000 });
    // La API puede validar la sesión mientras Chromium sufre un corte CORS/red
    // transitorio en auth_session_check. Reintentar utiliza el botón REAL de
    // BALTO; no omite el gate ni falsifica la respuesta de autenticación.
    const bell = page.getByRole('button', { name: /Notificaciones de Stock/i });
    const retrySession = page.getByRole('button', { name: 'Reintentar', exact: true });
    await expect(bell.or(retrySession).first(), 'La sesión debe validarse antes de probar las notificaciones')
      .toBeVisible({ timeout: 45_000 });
    if (await retrySession.isVisible().catch(() => false)) {
      await retrySession.click();
    }
    await expect(bell, 'No se pudo validar la sesión en el navegador, aun después de reintentar')
      .toBeVisible({ timeout: 45_000 });
    await waitForBusyToFinish(page);
    const modal = page.getByRole('dialog', { name: 'Notificaciones de Stock' });
    if (!await modal.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /Notificaciones de Stock/i })
        .click({ timeout: 8_000 })
        .catch(async (error) => {
          if (!await modal.isVisible().catch(() => false)) throw error;
        });
    }
    await expect(modal).toBeVisible();
    const filaUno = modal.locator('.sv-alert-entry--product').filter({ hasText: nombreUno });
    const filaDos = modal.locator('.sv-alert-entry--product').filter({ hasText: nombreDos });
    await expect(filaUno).toBeVisible({ timeout: 30_000 });
    await expect(filaDos).toBeVisible({ timeout: 30_000 });
    await expect(filaDos).toContainText('Ver producto');
    await expect(modal.getByRole('button', { name: /Ver producto y gestionar vencimiento$/i })).toHaveCount(0);

    // El segundo producto (no necesariamente la primera alerta) abre el suyo.
    await filaDos.click();
    await expect(modal).toBeHidden();
    await expect(page).toHaveURL(/\/panel\/stock/);
    const editor = page.getByRole('dialog').filter({ hasText: 'Editar producto' }).first();
    await expect(editor.locator('input[name="nombre"]')).toHaveValue(nombreDos);
    await expect(editor.getByRole('tab', { name: /Vencimientos/i })).toHaveAttribute('aria-selected', 'true');
    await expect(editor.getByText('Retirar stock').first()).toBeVisible();

    // También se puede abrir otra partida desde Stock usando el teclado.
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: /Notificaciones de Stock/i }).click();
    await expect(modal).toBeVisible();
    const tarjetaUno = modal.locator('.sv-alert-entry--product').filter({ hasText: nombreUno });
    await tarjetaUno.focus();
    await tarjetaUno.press('Enter');
    await expect(modal).toBeHidden();
    await expect(editor.locator('input[name="nombre"]')).toHaveValue(nombreUno);
    await expect(editor.getByRole('tab', { name: /Vencimientos/i })).toHaveAttribute('aria-selected', 'true');
  } finally {
    // Las fixtures de retiro/vencimiento son auditadas; limpieza diferida.
    if (idProductos.length) console.info(`[E2E] ${nombreUno} y ${nombreDos}: limpieza diferida al cierre del worker.`);
  }
});
