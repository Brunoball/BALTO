// Carga src/utils/descuentoGeneral.js (ESM sin "type": "module") como módulo
// para poder probarlo con `node` puro, sin depender de Jest ni de un bundler.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadDescuentoUtil() {
  const candidates = [
    process.env.BALTO_SRC_DIR && join(process.env.BALTO_SRC_DIR, 'utils/descuentoGeneral.js'),
    resolve(here, '../../src/utils/descuentoGeneral.js'),
    resolve(here, '../../../src/utils/descuentoGeneral.js'),
  ].filter(Boolean);
  let source = null;
  let used = '';
  for (const c of candidates) {
    try { source = readFileSync(c, 'utf8'); used = c; break; } catch { /* siguiente */ }
  }
  if (source === null) {
    throw new Error(`No se encontró src/utils/descuentoGeneral.js. Definí BALTO_SRC_DIR. Probados: ${candidates.join(', ')}`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'balto-desc-'));
  const file = join(dir, 'descuentoGeneral.mjs');
  writeFileSync(file, source);
  const mod = await import(pathToFileURL(file).href);
  return { ...mod, __source: used };
}
