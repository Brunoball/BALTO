import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { internalIntegrity } from './support/internal-api.js';

test('@internal @integrity auditoría SQL final: stock, importes, cheques, pagos y relaciones quedan coherentes', async ({ page }) => {
  await requireMutations(test, page);
  const audit = await internalIntegrity(page, 'prefix');

  const failed = Array.isArray(audit?.checks_fallidos) ? audit.checks_fallidos : [];
  const details = failed.map((key) => ({ key, ...(audit?.checks?.[key] || {}) }));
  expect(audit?.integridad_ok, JSON.stringify(details, null, 2)).toBe(true);
  expect(failed).toEqual([]);

  for (const [key, check] of Object.entries(audit?.checks || {})) {
    expect(check?.ok, `${key}: ${check?.label}\n${JSON.stringify(check?.muestras || [], null, 2)}`).toBe(true);
    expect(Number(check?.hallazgos || 0), `${key}: ${check?.label}`).toBe(0);
  }
});
