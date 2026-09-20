import { test, expect } from '../support/test.js';
import { requireMutations } from '../support/ui.js';
import { internalIntegrity } from './support/internal-api.js';

test('@internal @integrity cierre ampliado: todas las invariantes siguen verdes después de la batería secundaria completa', async ({ page }) => {
  await requireMutations(test, page);
  const audit = await internalIntegrity(page, 'prefix');
  const failed = Array.isArray(audit?.checks_fallidos) ? audit.checks_fallidos : [];
  expect(failed, JSON.stringify(audit?.checks || {}, null, 2)).toEqual([]);
  expect(audit?.integridad_ok).toBe(true);

  const required = [
    'stock_current_vs_history',
    'stock_arithmetic',
    'stock_chain',
    'stock_negative',
    'movement_item_math',
    'payment_non_positive',
    'cheque_invalid_state',
    'cheque_in_portfolio_with_egress',
    'cheque_egressed_without_egress',
    'orphan_movement_items',
    'orphan_payments',
  ];
  for (const key of required) {
    expect(audit?.checks?.[key], `Debe existir la invariante ${key}`).toBeTruthy();
    expect(audit.checks[key].ok, `${key}: ${JSON.stringify(audit.checks[key].muestras || [])}`).toBe(true);
  }
});
