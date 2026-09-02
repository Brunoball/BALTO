import { test, expect } from './support/test.js';
import { installDiagnostics, assertNoCriticalErrors } from './support/diagnostics.js';
import { waitForBusyToFinish } from './support/ui.js';

const pages = [
  ['/panel/cheques/cartera', /Cheques en Cartera/i],
  ['/panel/cheques/flujo', /Flujo de Cheques/i],
  ['/panel/cheques/echeqs-cartera', /Echeqs · Cartera/i],
  ['/panel/cheques/flujo-echeqs', /Flujo de E-Cheqs/i],
];

for (const [route, title] of pages) {
  test(`@smoke cheques abre y filtra ${route}`, async ({ page }, testInfo) => {
    const diagnostics = installDiagnostics(page);
    await page.goto(route);
    await waitForBusyToFinish(page);
    await expect(page.locator('body')).toContainText(title);

    const search = page.locator('input[placeholder*="Buscar" i]').first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill('PW-CHEQUE-INEXISTENTE');
      await search.press('Enter');
      await expect(page.locator('body')).toContainText(/No hay|No se encontraron|Mostrando/i);
    }

    await assertNoCriticalErrors(diagnostics, testInfo, { allowConsole: [/comprobante/i, /imagen/i] });
  });
}
