import { test, expect } from './support/test.js';
import { ENV } from './support/env.js';

test('@safety otros ingresos: la suite entregada no habilita emisiones ARCA reales', async () => {
  expect(
    ENV.allowArca,
    'PW_ALLOW_ARCA debe permanecer deshabilitado: esta suite prueba sólo operaciones locales/internas.',
  ).toBe(false);
});
