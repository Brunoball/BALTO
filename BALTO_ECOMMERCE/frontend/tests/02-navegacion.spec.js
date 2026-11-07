// Navegación: todas las rutas públicas de Aplicacion.jsx, menú, buscador, pie y 404.
const { test, expect } = require('./soporte/test');

const RUTAS = [
  ['/', /Todo lo que buscás/],
  ['/catalogo', /Nuestro catálogo/],
  ['/favoritos', /Mis favoritos/],
  ['/contacto', /Hablemos/],
  ['/carrito', /Carrito/],
  ['/pedido/confirmado', null],
  ['/iniciar-sesion', null],
  ['/esta-ruta-no-existe', /Esta página no está disponible/],
];

test.describe('Navegación', () => {
  for (const [ruta, titulo] of RUTAS) {
    test(`@smoke la ruta ${ruta} carga sin errores`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page.locator('.site-header')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
      if (titulo) await expect(page.getByRole('heading', { level: 1 })).toHaveText(titulo);
    });
  }

  test('el checkout sin productos invita a ir al catálogo', async ({ page }) => {
    await page.goto('/checkout');
    await expect(page.getByText('No hay productos para comprar')).toBeVisible();
    await page.getByRole('link', { name: 'Ir al catálogo' }).click();
    await expect(page).toHaveURL(/\/catalogo$/);
  });

  test('la confirmación sin pedido reciente no inventa datos', async ({ page }) => {
    await page.goto('/pedido/confirmado');
    await expect(page.getByText('No hay un pedido reciente para mostrar')).toBeVisible();
    await expect(page.getByTestId('order-number')).toHaveCount(0);
  });

  test('menú principal: cada enlace navega y queda marcado como actual', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    for (const [nombre, ruta] of [['Todos los productos', '/catalogo'], ['Favoritos', '/favoritos'], ['Carrito', '/carrito'], ['Contacto', '/contacto'], ['Inicio', '/']]) {
      await nav.getByRole('link', { name: nombre, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${ruta.replace('/', '\\/')}$`));
      await expect(nav.getByRole('link', { name: nombre, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('el buscador del encabezado lleva al catálogo con el término', async ({ page }) => {
    await page.goto('/');
    const buscar = page.getByRole('search').getByRole('textbox');
    await buscar.fill('remera azul');
    await buscar.press('Enter');
    await expect(page).toHaveURL(/\/catalogo\?q=remera(%20|\+)azul$/);
    await expect(page.getByRole('textbox', { name: 'Buscar productos de esta página' })).toHaveValue('remera azul');
  });

  test('el logo vuelve al inicio y el pie tiene los enlaces de la tienda', async ({ page }) => {
    await page.goto('/contacto');
    await page.getByRole('link', { name: 'Ir al inicio de la tienda' }).click();
    await expect(page).toHaveURL(/\/$/);
    const pie = page.locator('.site-footer');
    for (const enlace of ['Inicio', 'Catálogo', 'Mis favoritos', 'Carrito', 'Contacto']) {
      await expect(pie.getByRole('link', { name: enlace, exact: true })).toBeVisible();
    }
    await pie.getByRole('link', { name: 'Catálogo', exact: true }).click();
    await expect(page).toHaveURL(/\/catalogo$/);
  });

  test('la página 404 vuelve al inicio', async ({ page }) => {
    await page.goto('/ruta/inexistente/e2e');
    await expect(page.getByText('ERROR 404')).toBeVisible();
    await page.getByRole('link', { name: 'Volver al inicio' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('el carrito del encabezado abre y cierra el panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Abrir carrito/ }).click();
    const panel = page.getByRole('dialog', { name: /carrito/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Tu carrito está vacío')).toBeVisible();
    await panel.getByRole('button', { name: 'Cerrar carrito' }).first().click();
    await expect(panel).toBeHidden();
  });
});
