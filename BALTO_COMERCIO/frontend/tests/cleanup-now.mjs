import { cleanupE2EFromStorage, e2eCleanupStatusFromStorage } from './support/cleanup.js';

async function main() {
  console.log('[Playwright cleanup] Limpieza manual segura: SOLO datos identificados como E2E/PW.');

  const cleanup = await cleanupE2EFromStorage({ scope: 'all', phase: 'manual' });
  if (cleanup === null) {
    throw new Error(
      '[Playwright cleanup] La limpieza está deshabilitada por configuración. ' +
      'Revisá ENV.cleanup / ENV.allowMutations y la configuración segura del entorno E2E.',
    );
  }

  const status = await e2eCleanupStatusFromStorage({ scope: 'all' });
  if (status === null) {
    throw new Error(
      '[Playwright cleanup] No se pudo verificar el estado porque la limpieza E2E está deshabilitada.',
    );
  }

  const remaining = Number(status?.restantes_total || 0);
  if (remaining !== 0) {
    throw new Error(
      `[Playwright cleanup] Verificación final: quedaron ${remaining} registro(s) E2E. ` +
      JSON.stringify(status?.restantes || {}),
    );
  }

  console.log('[Playwright cleanup] Verificación final OK: 0 registros E2E restantes.');
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
