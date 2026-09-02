import { test as base, expect } from '@playwright/test';
import { ENV } from './env.js';
import { RUN_PREFIX } from './data.js';
import { cleanupE2EFromStorage } from './cleanup.js';
import { ensureAdministratorSession } from './users.js';

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
    async ({ page }, use) => {
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
        }
      }
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect };
