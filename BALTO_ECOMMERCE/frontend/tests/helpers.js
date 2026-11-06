// Utilidades de las pruebas visuales. Los productos se DESCUBREN desde la API real
// (no hay datos inventados): las pruebas se adaptan a lo que esté publicado.
const { expect } = require('@playwright/test');

const tienda = () => String(process.env.PW_ECOMMERCE_TIENDA || process.env.REACT_APP_ECOMMERCE_DEV_TIENDA || 'mrnat.3devsnet.com').toLowerCase();

async function api(request, action, params = {}) {
  const q = new URLSearchParams({ action, tienda: tienda(), ...params });
  const res = await request.get(`/ecom-api?${q}`);
  const json = await res.json();
  return { status: res.status(), json };
}

async function catalogo(request) {
  const { json } = await api(request, 'catalogo_productos', { limite: 40 });
  return Array.isArray(json.productos) ? json.productos : [];
}

async function configuracion(request) {
  return (await api(request, 'tienda_configuracion')).json.configuracion || {};
}

const pick = {
  simple: (ps) => ps.find((p) => !p.tiene_variantes && p.disponible && !p.unidad?.permite_decimales && Number(p.cantidad_maxima) >= 3),
  variantes: (ps) => ps.find((p) => p.tiene_variantes && p.variantes?.some((v) => v.disponible)),
  dosVariantes: (ps) => ps.find((p) => p.tiene_variantes && p.variantes?.filter((v) => v.disponible && Number(v.cantidad_maxima) >= 1).length >= 2),
  decimal: (ps) => ps.find((p) => !p.tiene_variantes && p.disponible && p.unidad?.permite_decimales && Number(p.cantidad_maxima) >= 1.5),
  sinImagen: (ps) => ps.find((p) => !p.imagen_url),
};

async function limpiar(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

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
  await expect(page.getByRole('dialog', { name: /carrito/i })).toBeVisible();
}

const money = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(Number(n));

module.exports = { tienda, api, catalogo, configuracion, pick, limpiar, agregarDesdeFicha, money };
