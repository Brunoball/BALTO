// Flujos de interfaz reutilizables (equivalente a support/flows.js de Comercio).
const { expect } = require('@playwright/test');

const dinero = (n, moneda = 'ARS') => new Intl.NumberFormat('es-AR', { style: 'currency', currency: moneda, maximumFractionDigits: 2 }).format(Number(n));
const panelCarrito = (page) => page.getByRole('dialog', { name: /carrito/i });

/** Abre la ficha y agrega al carrito (opcionalmente variante y cantidad). Deja el panel abierto. */
async function agregarDesdeFicha(page, producto, { variante = null, cantidad = null } = {}) {
  await page.goto(`/producto/${producto.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(producto.nombre);
  if (variante) await page.locator('#variant-select').selectOption(String(variante.idVariante));
  if (cantidad !== null) {
    const qty = page.locator('#product-qty');
    await qty.fill(String(cantidad).replace('.', ','));
    await qty.press('Enter');
  }
  await page.getByTestId('add-to-cart').click();
  await expect(panelCarrito(page)).toBeVisible();
}

async function cerrarCarrito(page) {
  await panelCarrito(page).getByRole('button', { name: 'Cerrar carrito' }).first().click();
  await expect(panelCarrito(page)).toBeHidden();
}

/** Carga los datos del comprador en el checkout. */
async function completarComprador(page, { nombre = 'Prueba', apellido = 'Automatizada', email = 'pedido.prueba@example.com', telefono = '351 555 0000', observaciones } = {}) {
  await page.locator('#checkout-nombre').fill(nombre);
  await page.locator('#checkout-apellido').fill(apellido);
  const mail = page.locator('#checkout-email');
  if (!(await mail.getAttribute('readonly').then((v) => v !== null))) await mail.fill(email);
  await page.locator('#checkout-telefono').fill(telefono);
  if (observaciones) await page.locator('#checkout-observaciones').fill(observaciones);
}

/** Elige la modalidad de entrega (si la tienda ofrece una sola, no hay nada que elegir). */
async function elegirEntrega(page, codigo) {
  const radio = page.locator(`input[name="modalidad_entrega"][value="${codigo}"]`);
  await radio.waitFor({ timeout: 5_000 }).catch(() => {});
  if (await radio.count()) await radio.check();
}

/** Completa un domicilio argentino (escrito a mano: no depende de Georef). */
async function completarDomicilio(page, prefijo, { provincia = 'Córdoba', localidad = 'Córdoba', calle = 'Colón', altura = '100', codigoPostal = '5000' } = {}) {
  const prov = page.locator(`#${prefijo}-provincia`);
  await expect(prov).toBeEnabled();
  await prov.selectOption({ label: provincia });
  await page.locator(`#${prefijo}-localidad`).fill(localidad);
  await page.keyboard.press('Escape');
  await page.locator(`#${prefijo}-calle`).fill(calle);
  await page.locator(`#${prefijo}-altura`).fill(altura);
  const cp = page.locator(`#${prefijo}-codigo_postal`);
  if (await cp.count()) await cp.fill(codigoPostal);
}

/** Elige un medio de pago en el checkout (la tienda debe tener pagos activos). */
async function elegirPago(page, codigo) {
  await page.locator(`input[name="checkout-metodo_pago"][value="${codigo}"]`).check();
}

/** Espera a que el carrito quede guardado en localStorage (lo escribe un efecto de React). */
async function esperarCarritoGuardado(page, clave, lineas = 1) {
  await expect.poll(() => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) || '[]') || []).length, clave)).toBe(lineas);
}

/**
 * Modifica el carrito guardado simulando datos viejos del navegador.
 * Se hace desde una página que NO revalida el carrito (/contacto, panel cerrado): con el panel
 * abierto la web revalida a los 450 ms y vuelve a guardar, pisando la modificación.
 */
async function modificarCarritoGuardado(page, clave, modificar, arg) {
  await esperarCarritoGuardado(page, clave);
  await page.goto('/contacto');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(([k, fn, a]) => {
    const v = JSON.parse(localStorage.getItem(k));
    new Function('v', 'a', fn)(v, a);
    localStorage.setItem(k, JSON.stringify(v));
  }, [clave, modificar, arg]);
}

/** PNG mínimo válido (1x1) para comprobantes de prueba. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

module.exports = { dinero, panelCarrito, agregarDesdeFicha, cerrarCarrito, completarComprador, elegirEntrega, completarDomicilio, elegirPago, esperarCarritoGuardado, modificarCarritoGuardado, PNG_1X1 };
