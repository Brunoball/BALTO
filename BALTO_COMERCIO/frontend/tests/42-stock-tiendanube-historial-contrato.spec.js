import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

async function backendRoot() {
  const cwd = process.cwd();
  const candidates = [
    process.env.BALTO_API_SOURCE_DIR,
    path.resolve(cwd, 'api'),
    path.resolve(cwd, '..', 'api'),
    path.resolve(cwd, '..', 'backend'),
    path.resolve(cwd, '..', 'backend', 'api'),
    path.resolve(cwd, '..', '..', 'api'),
    path.resolve(cwd, '..', '..', 'backend'),
    path.resolve(cwd, '..', '..', 'backend', 'api'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'api'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'backend'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'backend', 'api'),
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(path.join(candidate, 'modules', 'tiendanube', 'global', 'services', 'TnProductoSyncService.php'));
      return candidate;
    } catch {
      // Los tests funcionales de Hostinger no requieren descargar su PHP.
    }
  }
  return null;
}

test('@stock @tiendanube @historial @contract la ruta inbound TN registra cambios reales sin reactivar el sync outbound', async () => {
  const root = await backendRoot();
  test.skip(!root, 'No se encontró el backend local: para validar el contrato del código configurar BALTO_API_SOURCE_DIR.');
  const tn = await fs.readFile(path.join(root, 'modules/tiendanube/global/services/TnProductoSyncService.php'), 'utf8');
  const repository = await fs.readFile(path.join(root, 'modules/stock/global/repositories/PrecioRepository.php'), 'utf8');
  const history = await fs.readFile(path.join(root, 'modules/stock/global/services/StockPriceHistoryService.php'), 'utf8');

  // Camino de importación, webhook y escritura directa: todos terminan en el
  // registrador de historial, SIN invocar la API real de Tienda Nube en E2E.
  expect(tn).toContain("StockPriceHistoryService::withOrigin('tiendanube'");
  expect(tn).toContain('StockIntegracionService::withSyncDisabled($run)');
  expect(tn).toContain('StockPriceHistoryService::record($pdo, array(array(');
  expect(tn).toContain(")), 'tiendanube');");
  expect(repository).toContain('StockPriceHistoryService::record(StockDbHelper::pdo(), $changes)');
  expect(history).toContain('abs($newAmount - $oldAmount) < 0.005');
  expect(history).toContain("'tiendanube' => 'Precio recibido desde Tienda Nube'");
});
