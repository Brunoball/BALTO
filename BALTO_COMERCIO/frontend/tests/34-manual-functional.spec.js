import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

async function openManual(page) {
  await page.goto('/panel/configuracion', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  const card = page.getByRole('button', { name: /Manual funcional/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Manual funcional');
  await expect(card).toContainText(/BALTO Comercio/i);
  await expect(card).toContainText(/Versión 2026/i);
  await expect(card).toContainText(/85 páginas/i);
  await expect(card).toContainText(/Disponible/i);

  await card.click();

  const dialog = page.getByRole('dialog', { name: /Manual funcional de BALTO Comercio/i }).last();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('heading', { name: 'Manual funcional', exact: true })).toBeVisible();
  await expect(dialog).toContainText(/BALTO Comercio · Versión 2026 · 85 páginas/i);

  return { card, dialog };
}

test('@configuracion @manual-funcional tarjeta, modal, assets y cierre funcionan como contrato', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);
  const { dialog } = await openManual(page);

  // El portal del manual debe quedar directamente bajo <body> para no heredar
  // stacking contexts de Configuración y poder funcionar correctamente en fullscreen.
  await expect.poll(async () => dialog.evaluate((node) => node.parentElement === document.body)).toBe(true);
  await expect.poll(async () => page.locator('body').evaluate((node) => node.style.overflow)).toBe('hidden');

  const wordLink = dialog.getByRole('link', { name: /Descargar Word/i });
  await expect(wordLink).toBeVisible();
  await expect(wordLink).toHaveAttribute('download', 'manual_funcional_balto_comercio.docx');
  const wordHref = await wordLink.getAttribute('href');
  expect(wordHref).toMatch(/manual_funcional_balto_comercio(?:\.[a-f0-9]+)?\.docx(?:\?|$)/i);

  const viewer = dialog.locator('iframe[title="Manual funcional BALTO Comercio"]');
  await expect(viewer).toBeVisible();
  const viewerSrc = await viewer.getAttribute('src');
  expect(viewerSrc).toMatch(/manual_funcional_balto_comercio(?:\.[a-f0-9]+)?\.pdf#page=1&zoom=page-width$/i);

  // Verificamos window.open sin abrir realmente otra pestaña/PDF durante la suite.
  await page.evaluate(() => {
    window.__pwManualOpenArgs = null;
    window.open = (...args) => {
      window.__pwManualOpenArgs = args;
      return null;
    };
  });
  await dialog.getByRole('button', { name: /Abrir en una pestaña nueva/i }).click();
  const openArgs = await page.evaluate(() => window.__pwManualOpenArgs);
  expect(openArgs?.[0]).toMatch(/manual_funcional_balto_comercio(?:\.[a-f0-9]+)?\.pdf(?:\?|$)/i);
  expect(openArgs?.[1]).toBe('_blank');
  expect(openArgs?.[2]).toContain('noopener');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await expect.poll(async () => page.locator('body').evaluate((node) => node.style.overflow)).not.toBe('hidden');

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/PDF/i, /imagen/i, /Tienda Nube/i],
  });
});

test('@configuracion @manual-funcional buscador replica navegación, normalización y Ctrl+K', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);
  const { dialog } = await openManual(page);

  const search = dialog.getByRole('searchbox', { name: /Buscar módulo o sección del manual/i });
  await expect(search).toBeFocused({ timeout: 5_000 });

  // El atajo debe devolver siempre el foco al buscador.
  const pageInput = dialog.getByRole('spinbutton', { name: /Número de página/i });
  await pageInput.focus();
  await expect(pageInput).toBeFocused();
  await page.keyboard.press('Control+K');
  await expect(search).toBeFocused();

  // La búsqueda ignora tildes y acepta varios términos igual que BALTO Servicios.
  await search.fill('codigo barra');
  const barcodeResult = dialog.getByRole('button', { name: /Stock - Códigos de barra.*Página 60/i });
  await expect(barcodeResult).toBeVisible();
  await barcodeResult.click();

  await expect(search).toHaveValue('');
  await expect(pageInput).toHaveValue('60');
  await expect(dialog.locator('iframe[title="Manual funcional BALTO Comercio"]')).toHaveAttribute(
    'src',
    /#page=60&zoom=page-width$/,
  );

  // Las secciones propias de Comercio deben estar indexadas.
  await search.fill('tienda nube');
  await expect(dialog.getByRole('button', { name: /Configuración - Tienda Nube.*Página 77/i })).toBeVisible();

  await search.fill('stock');
  await expect(dialog.getByRole('button', { name: /^Stock\s+Página 57$/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Stock - Productos.*Página 58/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Stock - Variantes.*Página 59/i })).toBeVisible();

  // Comercio no debe heredar módulos exclusivos de Servicios.
  await search.fill('servicio');
  await expect(dialog.getByText(/No se encontraron módulos con esa búsqueda/i)).toBeVisible();

  const clear = dialog.getByRole('button', { name: /Limpiar búsqueda/i });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/PDF/i, /imagen/i, /Tienda Nube/i],
  });
});

test('@configuracion @manual-funcional paginador y pantalla completa respetan límites 1-85', async ({ page }, testInfo) => {
  const diagnostics = installDiagnostics(page);
  const { dialog } = await openManual(page);

  const pageInput = dialog.getByRole('spinbutton', { name: /Número de página/i });
  const previous = dialog.getByRole('button', { name: /Página anterior/i });
  const next = dialog.getByRole('button', { name: /Página siguiente/i });

  await expect(pageInput).toHaveValue('1');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();

  await next.click();
  await expect(pageInput).toHaveValue('2');
  await expect(previous).toBeEnabled();

  await previous.click();
  await expect(pageInput).toHaveValue('1');

  await pageInput.fill('999');
  await expect(pageInput).toHaveValue('85');
  await expect(next).toBeDisabled();
  await expect(dialog.locator('iframe[title="Manual funcional BALTO Comercio"]')).toHaveAttribute(
    'src',
    /#page=85&zoom=page-width$/,
  );

  await pageInput.fill('0');
  await expect(pageInput).toHaveValue('1');
  await expect(previous).toBeDisabled();

  const expand = dialog.getByRole('button', { name: /Expandir manual/i });
  await expand.click();
  await expect(dialog).toHaveClass(/is-fullscreen/);
  const compress = dialog.getByRole('button', { name: /Salir de pantalla completa/i });
  await expect(compress).toBeVisible();
  await compress.click();
  await expect(dialog).not.toHaveClass(/is-fullscreen/);
  await expect(dialog.getByRole('button', { name: /Expandir manual/i })).toBeVisible();

  await dialog.getByRole('button', { name: /Cerrar manual/i }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  await assertNoCriticalErrors(diagnostics, testInfo, {
    allowConsole: [/PDF/i, /imagen/i, /Tienda Nube/i],
  });
});
