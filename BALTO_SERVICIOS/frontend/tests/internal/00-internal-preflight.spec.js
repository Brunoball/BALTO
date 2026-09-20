import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { RUN_PREFIX } from '../support/data.js';
import { internalIntegrity } from './support/internal-api.js';

test('@internal @internal-preflight herramientas internas habilitadas y tenant consistente antes de mutar', async ({ page }) => {
  await requireMutations(test, page);
  const audit = await internalIntegrity(page, 'prefix');
  expect(audit?.prefix).toBe(RUN_PREFIX);
  expect(audit?.integridad_ok, JSON.stringify(audit?.checks_fallidos || [])).toBe(true);
  expect(Number(audit?.checks_total || 0)).toBeGreaterThanOrEqual(10);
});
