// Pruebas unitarias de las utilidades puras del cierre de caja (React).
// Ejecutar:  node tests/unit/cierres-caja.unit.mjs
// cierresUtils.js no importa nada: se copia a un .mjs temporal y se importa.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.env.BALTO_SRC_DIR
  ? join(process.env.BALTO_SRC_DIR, 'components/Flujo_de_Caja/utils/cierresUtils.js')
  : resolve(here, '../../src/components/Flujo_de_Caja/utils/cierresUtils.js');
const tmp = join(mkdtempSync(join(tmpdir(), 'balto-cc-')), 'cierresUtils.mjs');
writeFileSync(tmp, readFileSync(src, 'utf8'));
const u = await import(pathToFileURL(tmp).href);

let ok = 0;
const t = (name, fn) => { fn(); ok += 1; console.log(`[OK] ${name}`); };

t('sin verificar ≠ cero', () => {
  assert.equal(u.tipoDiferencia(100, null), null);
  assert.equal(u.tipoDiferencia(0, 0), 'SIN_DIFERENCIA');
});
t('sobrante / faltante en centavos exactos', () => {
  assert.equal(u.tipoDiferencia(100000, 115000), 'SOBRANTE');
  assert.equal(u.tipoDiferencia(0.3, 0.1 + 0.2), 'SIN_DIFERENCIA');
  assert.equal(u.diferenciaCents(100000, 90000), -1000000);
});
t('totales sin compensar medios entre sí', () => {
  const r = u.totalesCierre([
    { saldo_esperado: 100000, verificado: 110000 },
    { saldo_esperado: 350000, verificado: 340000 },
    { saldo_esperado: 5, verificado: null },
  ]);
  assert.deepEqual([r.sobrantes, r.faltantes, r.neto, r.diferencias, r.sinVerificar], [10000, 10000, 0, 2, 1]);
});
t('conciliación parcial con ajuste provisional ⇒ compensación negativa', () => {
  const p = u.previewConciliacionLocal({ diferencia: 15000, conciliado: 0, cubierto: true, tipo: 'MOVIMIENTO_REGISTRADO', importe: 10000 });
  assert.deepEqual([p.compensacion, p.pendientePosterior, p.estado, p.error], [-10000, 5000, 'PARCIALMENTE_CONCILIADA', '']);
});
t('faltante bancario sin ajuste ⇒ sin compensación', () => {
  const p = u.previewConciliacionLocal({ diferencia: -10000, conciliado: 0, cubierto: false, tipo: 'MOVIMIENTO_REGISTRADO', importe: 10000 });
  assert.deepEqual([p.compensacion, p.estado], [0, 'CONCILIADA']);
});
t('importe mayor al pendiente y aceptar sin ajuste muestran error', () => {
  assert.match(u.previewConciliacionLocal({ diferencia: 15000, conciliado: 10000, cubierto: true, tipo: 'ERROR_DE_ARQUEO', importe: 6000 }).error, /supera/);
  assert.match(u.previewConciliacionLocal({ diferencia: -500, conciliado: 0, cubierto: false, tipo: 'DIFERENCIA_ACEPTADA', importe: 500 }).error, /ajuste/);
});
t('número de cierre', () => assert.equal(u.numeroCierre(12), 'CC-000012'));


t('transferencia interna: parcial del faltante con ajuste, compensa en positivo', () => {
  const p = u.previewConciliacionLocal({ diferencia: -1500, conciliado: 200, cubierto: true, tipo: 'TRANSFERENCIA_INTERNA', importe: 500 });
  assert.deepEqual([p.compensacion, p.pendientePosterior, p.estado, p.error], [500, 800, 'PARCIALMENTE_CONCILIADA', '']);
});
t('transferencia interna: sin ajuste no inventa compensación', () => {
  const p = u.previewConciliacionLocal({ diferencia: 600, conciliado: 0, cubierto: false, tipo: 'TRANSFERENCIA_INTERNA', importe: 600 });
  assert.deepEqual([p.compensacion, p.pendientePosterior, p.estado], [0, 0, 'CONCILIADA']);
  assert.equal(u.TIPOS_RESOLUCION.find((t) => t.codigo === 'TRANSFERENCIA_INTERNA').requiereTransferencias, true);
});

console.log(`\n${ok} pruebas unitarias OK`);
