import { test, expect } from './support/test.js';
import { waitForBusyToFinish } from './support/ui.js';

const MANUAL_TOTAL_PAGES = 88;
const MANUAL_DOCX_NAME = 'Manual_Funcional_BALTO_Servicios.docx';

async function openManual(page) {
  await page.goto('/panel/configuracion', { waitUntil: 'domcontentloaded' });
  await waitForBusyToFinish(page);

  const card = page.getByRole('button', { name: /Manual funcional/i }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/Disponible/i);
  await expect(card).toContainText(new RegExp(`${MANUAL_TOTAL_PAGES} páginas`, 'i'));

  await card.click();

  const dialog = page.getByRole('dialog', {
    name: /Manual funcional de BALTO Servicios/i,
  });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('heading', { name: 'Manual funcional', exact: true })).toBeVisible();
  await expect(dialog).toContainText(new RegExp(`Versión 2026.*${MANUAL_TOTAL_PAGES} páginas`, 'i'));

  return dialog;
}

test.describe('Configuración - Manual funcional', () => {
  test('@configuracion @manual @smoke abre el manual y expone PDF + descarga Word', async ({ page }) => {
    const dialog = await openManual(page);

    const viewer = dialog.locator('iframe[title="Manual funcional BALTO Servicios"]');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('src', /\.pdf#page=1&zoom=page-width$/i);

    const download = dialog.getByRole('link', { name: /Descargar Word/i });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('download', MANUAL_DOCX_NAME);
    await expect(download).toHaveAttribute('href', /\.docx(?:\?|$)/i);

    await expect(dialog.getByRole('button', { name: /Abrir en una pestaña nueva/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Expandir manual/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Cerrar manual/i })).toBeVisible();
  });

  test('@configuracion @manual @critical buscador navega a módulos y actualiza la página del visor', async ({ page }) => {
    const dialog = await openManual(page);
    const search = dialog.getByRole('searchbox', { name: /Buscar módulo o sección del manual/i });
    const pageInput = dialog.getByRole('spinbutton', { name: /Número de página/i });
    const viewer = dialog.locator('iframe[title="Manual funcional BALTO Servicios"]');

    await expect(search).toBeFocused();
    await search.fill('Presupuestos');

    const result = dialog.getByRole('button', { name: /Presupuestos.*Página 36/i }).first();
    await expect(result).toBeVisible();
    await result.click();

    await expect(pageInput).toHaveValue('36');
    await expect(viewer).toHaveAttribute('src', /\.pdf#page=36&zoom=page-width$/i);
    await expect(search).toHaveValue('');

    await dialog.getByRole('button', { name: /Página anterior/i }).click();
    await expect(pageInput).toHaveValue('35');
    await expect(viewer).toHaveAttribute('src', /\.pdf#page=35&zoom=page-width$/i);

    await dialog.getByRole('button', { name: /Página siguiente/i }).click();
    await expect(pageInput).toHaveValue('36');

    await search.fill('modulo inexistente pw');
    await expect(dialog).toContainText(/No se encontraron módulos con esa búsqueda/i);
  });

  test('@configuracion @manual controles de página, expansión y cierre funcionan', async ({ page }) => {
    let dialog = await openManual(page);
    const pageInput = dialog.getByRole('spinbutton', { name: /Número de página/i });
    const viewer = dialog.locator('iframe[title="Manual funcional BALTO Servicios"]');

    await pageInput.fill('999');
    await expect(pageInput).toHaveValue(String(MANUAL_TOTAL_PAGES));
    await expect(viewer).toHaveAttribute(
      'src',
      new RegExp(`\\.pdf#page=${MANUAL_TOTAL_PAGES}&zoom=page-width$`, 'i'),
    );
    await expect(dialog.getByRole('button', { name: /Página siguiente/i })).toBeDisabled();

    await pageInput.fill('0');
    await expect(pageInput).toHaveValue('1');
    await expect(dialog.getByRole('button', { name: /Página anterior/i })).toBeDisabled();

    await dialog.getByRole('button', { name: /Expandir manual/i }).click();
    await expect(dialog.locator('.manual-modal')).toHaveClass(/is-fullscreen/);
    await expect(dialog.getByRole('button', { name: /Salir de pantalla completa/i })).toBeVisible();

    await dialog.getByRole('button', { name: /Salir de pantalla completa/i }).click();
    await expect(dialog.locator('.manual-modal')).not.toHaveClass(/is-fullscreen/);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Reabrir confirma que el estado transitorio se reinicia correctamente.
    await page.getByRole('button', { name: /Manual funcional/i }).first().click();
    dialog = page.getByRole('dialog', { name: /Manual funcional de BALTO Servicios/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('spinbutton', { name: /Número de página/i })).toHaveValue('1');
    await expect(dialog.getByRole('searchbox', { name: /Buscar módulo o sección del manual/i })).toHaveValue('');

    await dialog.getByRole('button', { name: /Cerrar manual/i }).click();
    await expect(dialog).toBeHidden();
  });
});
