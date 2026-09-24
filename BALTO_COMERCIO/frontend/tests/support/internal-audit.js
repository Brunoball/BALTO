import { expect } from '@playwright/test';
import { authenticatedApi, expectApiSuccess } from './api.js';
import { ENV } from './env.js';

export async function loadInternalAudit(page) {
  const result = await authenticatedApi(page, 'config_testing_e2e_audit');
  const body = expectApiSuccess(result, 'No se pudo ejecutar la auditoría interna Etapa 4');
  expect(body?.checks, 'La auditoría debe devolver el set cerrado de invariantes').toBeTruthy();
  return body;
}

export function expectCheckOk(audit, id) {
  const check = audit?.checks?.[id];
  expect(check, `Falta la invariante interna ${id}`).toBeTruthy();
  expect(check.ok, `${id}: ${JSON.stringify(check?.examples || [])}`).toBe(true);
  expect(Number(check.violations || 0), `${id} debe quedar sin violaciones`).toBe(0);
  return check;
}

export function auditEndpoint() {
  return `${ENV.apiURL.replace(/\/$/, '')}/api.php?action=config_testing_e2e_audit`;
}
