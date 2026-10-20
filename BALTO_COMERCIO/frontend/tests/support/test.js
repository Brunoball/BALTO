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
 * Instala el cierre automático de notificaciones solamente en páginas E2E
 * que NO están probando el centro de notificaciones.
 *
 * Debe registrarse también en toda pestaña creada con context.newPage() y
 * en contextos independientes creados por los tests de autenticación: las
 * fixtures de Playwright no instalan handlers automáticamente allí.
 *
 * El click se ejecuta mediante el botón real de React, sin forzar la acción
 * contra la interfaz que está probando el test. Así sigue funcionando incluso
 * cuando la notificación queda detrás de otro modal.
 */
export async function autoDismissStockNotifications(page) {
  const popup = page.getByRole('dialog', { name: 'Notificaciones de Stock' });
  await page.addLocatorHandler(popup, async () => {
    const close = popup.getByRole('button', { name: 'Cerrar notificaciones' });
    await close.evaluate((button) => button.click());
    await expect(popup).toBeHidden({ timeout: 5_000 });
  }, { noWaitAfter: true });
}

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
    async ({ page, context }, use, testInfo) => {
      patchContextNavigation(context);
      patchPageNavigation(page);

      // El centro de notificaciones se carga de forma asíncrona y puede abrirse
      // después de waitForBusyToFinish. En tests ajenos a notificaciones,
      // cerrarlo justo antes de una interacción evita que tape cualquier botón,
      // aunque aparezca varios segundos después de la navegación.
      // Los tests @notificaciones-ui comprueban el popup real sin este manejador.
      if (!testInfo.title.includes('@notificaciones-ui')) {
        await autoDismissStockNotifications(page);
      }

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
    {
      scope: 'worker',
      auto: true,
      timeout: Math.max(5 * 60_000, ENV.cleanupTimeoutMs + 120_000),
    },
  ],
});

export { expect };
