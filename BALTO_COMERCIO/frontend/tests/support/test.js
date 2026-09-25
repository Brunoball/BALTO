import { test as base, expect } from '@playwright/test';
import { ENV, patchContextNavigation, patchPageNavigation } from './env.js';
import { RUN_PREFIX } from './data.js';
import { cleanupE2EFromStorage } from './cleanup.js';
import { ensureAdministratorSession } from './users.js';

let workerCleanupCompleted = false;
let processFallbackStarted = false;

// Red de seguridad adicional. El teardown del fixture sigue siendo el mecanismo
// principal; beforeExit sólo actúa si el worker llega a cerrarse sin haber podido
// completar esa limpieza (por ejemplo, un fallo del worker después del último test).
// No intenta scope=all: usa exclusivamente el RUN_PREFIX de este proceso, por lo que
// sigue siendo seguro incluso si alguna vez se ejecutan varios workers en paralelo.
process.once('beforeExit', () => {
  if (workerCleanupCompleted || processFallbackStarted || !ENV.cleanup || !ENV.allowMutations) return;
  processFallbackStarted = true;

  cleanupE2EFromStorage({
    scope: 'prefix',
    prefix: RUN_PREFIX,
    phase: 'fallback cierre de worker',
  })
    .then(() => {
      workerCleanupCompleted = true;
    })
    .catch((error) => {
      console.error(
        '[Playwright cleanup] Fallback de cierre no pudo completar la limpieza:',
        error?.message || error,
      );
    });
});

/**
 * Fixture automática de seguridad para toda la suite Balto.
 *
 * - Corre una sola vez al finalizar cada worker, incluso si un test normal falla.
 * - Borra únicamente el prefijo exacto PW-... generado por ese worker.
 * - El setup hace además una limpieza general al comienzo para levantar residuos
 *   de una corrida anterior que haya sido interrumpida por cierre de terminal/PC.
 */
export const test = base.extend({
  _baltoSessionRefresh: [
    async ({ page, context }, use) => {
      patchContextNavigation(context);
      patchPageNavigation(page);
      await ensureAdministratorSession(page);
      await use();
    },
    { scope: 'test', auto: true },
  ],
  _baltoE2ECleanup: [
    async ({}, use, workerInfo) => {
      try {
        await use();
      } finally {
        if (ENV.cleanup && ENV.allowMutations) {
          await cleanupE2EFromStorage({
            scope: 'prefix',
            prefix: RUN_PREFIX,
            phase: `fin worker ${workerInfo.workerIndex}`,
          });
          workerCleanupCompleted = true;
        }
      }
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect };
