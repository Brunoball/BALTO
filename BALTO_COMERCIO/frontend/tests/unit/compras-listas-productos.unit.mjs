// Pruebas unitarias de la lista de productos de Compras (entrada de mercadería).
// Ejecutar:  node tests/unit/compras-listas-productos.unit.mjs
// listasCompras.js no importa nada: se copia a un .mjs temporal y se importa.
//
// Error corregido: ListasContext descartaba `detalles_compras` y, cuando el
// contexto se recargaba al abrir el modal, Compras quedaba con la lista vendible
// (sólo productos con stock positivo).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.BALTO_SRC_DIR
  ? join(process.env.BALTO_SRC_DIR, 'components/Mov_Subsection/_shared/listasCompras.js')
  : resolve(here, '../../src/components/Mov_Subsection/_shared/listasCompras.js');
const tmp = join(mkdtempSync(join(tmpdir(), 'balto-compras-')), 'listasCompras.mjs');
writeFileSync(tmp, readFileSync(src, 'utf8'));
const u = await import(pathToFileURL(tmp).href);

let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

const TODOS = [{ id: 1, stock: 20 }, { id: 2, stock: 0 }, { id: 3, stock: -3 }, { id: 4, stock: null }];
const VENDIBLES = [{ id: 1, stock: 20 }];

t('toma la lista completa de la respuesta del backend (listas.* o plana)', () => {
  assert.deepEqual(u.pickDetallesCompras({ listas: { detalles: VENDIBLES, detalles_compras: TODOS } }), TODOS);
  assert.deepEqual(u.pickDetallesCompras({ listas: { detalles: VENDIBLES, detallesCompras: TODOS } }), TODOS);
  assert.deepEqual(u.pickDetallesCompras({ listas: { detalles: VENDIBLES }, detalles_todos: TODOS }), TODOS);
  assert.deepEqual(u.pickDetallesCompras({ detalles: VENDIBLES, detalles_compras: TODOS }), TODOS);
});
t('"no vino" (null) se distingue de "vino vacía" ([])', () => {
  assert.equal(u.pickDetallesCompras({ listas: { detalles: VENDIBLES } }), null);
  assert.deepEqual(u.pickDetallesCompras({ listas: { detalles_compras: [] } }), []);
  assert.equal(u.pickDetallesCompras(null), null);
});
t('una recarga sin lista de compras no reemplaza la lista completa', () => {
  assert.deepEqual(u.conservarDetallesCompras(TODOS, []), TODOS);
  assert.deepEqual(u.conservarDetallesCompras(TODOS, undefined), TODOS);
});
t('una lista de compras nueva sí reemplaza (por ejemplo tras dar de baja un producto)', () => {
  const sinBaja = TODOS.filter((p) => p.id !== 4);
  assert.deepEqual(u.conservarDetallesCompras(TODOS, sinBaja), sinBaja);
});
t('la lista de compras incluye stock 0, negativo y sin existencias', () => {
  const ids = u.pickDetallesCompras({ listas: { detalles_compras: TODOS } }).map((p) => p.id);
  assert.deepEqual(ids, [1, 2, 3, 4]);
});

console.log(`\n${ok} pruebas OK`);
