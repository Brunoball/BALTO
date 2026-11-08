// Regresión del descuento general de Nueva Venta, sin navegador ni escrituras.
// Ejecutar desde frontend/:  node tests/venta-descuento-general.regression.cjs
//
// 1. Escenarios con importes esperados (incluido el caso del video: 42.700 − 15 %).
// 2. Invariantes sobre miles de ventas aleatorias: el descuento se aplica una sola
//    vez, Σ renglones netos = total final exacto, subtotal + IVA = total por renglón
//    y la presentación comercial (renglones) no cambia al aplicar el descuento.
// 3. Paridad React ↔ PHP: mov_venta_prorratear_descuento (helpers.php) debe dar
//    exactamente los mismos centavos que ventaDescuento.js. Requiere `php` y la
//    carpeta del backend (BALTO_API_DIR, por defecto ../api). Si no están, se omite
//    con aviso (no se declara como aprobada).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const FRONT = path.resolve(__dirname, '..');
const MODULE = path.join(FRONT, 'src/components/Mov_Subsection/Ventas/utils/ventaDescuento.js');
const API_DIR = path.resolve(process.env.BALTO_API_DIR || path.join(FRONT, '..', 'api'));

let fallas = 0;
function caso(nombre, fn) {
  try { fn(); console.log(`  ✓ ${nombre}`); }
  catch (e) { fallas += 1; console.log(`  ✗ ${nombre}\n    ${e.message}`); }
}

(async () => {
  // El proyecto CRA no declara "type":"module"; se importa una copia .mjs.
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'balto-desc-')), 'ventaDescuento.mjs');
  fs.copyFileSync(MODULE, tmp);
  const m = await import(pathToFileURL(tmp).href);
  const tiene = () => true;
  const calc = (rows, tipo, valor) => {
    const base = m.calcularRenglonesBrutos(rows, tiene);
    const d = m.calcularDescuentoGeneral(base, tipo, valor);
    const rc = m.prorratearDescuentoGeneral(base, d);
    return { base, d, rc, res: m.calcularResumenVenta(rc, d) };
  };
  const P = (cantidad, precio, ivaPct = 0) => ({ cantidad, precio, ivaPct });
  const cents = (n) => Math.round(n * 100);

  console.log('Escenarios');
  caso('sin descuento', () => {
    const { rc, res } = calc([P(2, 8500), P(1, 1000, 21)], 'PORCENTAJE', 0);
    assert.equal(res.descuento, 0); assert.equal(res.total, 18210);
    assert.deepEqual(rc.map((r) => r.total), [17000, 1210]);
  });
  caso('video: 3 productos + 15 % → 42.700 − 6.405 = 36.295, renglones con precio original', () => {
    const { rc, res } = calc([P(2, 8500), P(2, 8100), P(1, 9500)], 'PORCENTAJE', 15);
    assert.deepEqual(rc.map((r) => r.totalBruto), [17000, 16200, 9500]); // lo que muestra la grilla
    assert.deepEqual(rc.map((r) => r.precioLista), [8500, 8100, 9500]);
    assert.equal(res.totalBruto, 42700); assert.equal(res.descuento, 6405); assert.equal(res.total, 36295);
    assert.deepEqual(rc.map((r) => r.total), [14450, 13770, 8075]); // representación fiscal interna
  });
  caso('1 producto + 15 %', () => { const { res } = calc([P(2, 8500)], 'PORCENTAJE', 15); assert.equal(res.total, 14450); });
  caso('descuento fijo', () => { const { res } = calc([P(2, 8500), P(1, 9500)], 'MONTO', 1000); assert.equal(res.total, 25500); });
  caso('cambio de cantidad con descuento', () => { const { res } = calc([P(3, 8500), P(2, 8100), P(1, 9500)], 'PORCENTAJE', 15); assert.equal(res.totalBruto, 51200); assert.equal(res.total, 43520); });
  caso('eliminación de producto con descuento', () => { const { res } = calc([P(2, 8500), P(1, 9500)], 'PORCENTAJE', 15); assert.equal(res.total, 22525); });
  caso('prorrateo con residuo: 3 × $100 − $100 → 66,67 + 66,67 + 66,66', () => {
    const { rc, res } = calc([P(1, 100), P(1, 100), P(1, 100)], 'MONTO', 100);
    assert.deepEqual(rc.map((r) => r.total), [66.67, 66.67, 66.66]); assert.equal(res.total, 200);
  });
  caso('IVA mixto + 12,5 %: 11.204,59 − 1.400,57 = 9.804,02', () => {
    const { res } = calc([P(3, 1999.99, 21), P(0.5, 7139.6, 10.5)], 'PORCENTAJE', 12.5);
    assert.equal(res.totalBruto, 11204.59); assert.equal(res.descuento, 1400.57); assert.equal(res.total, 9804.02);
  });

  console.log('Invariantes (5.000 ventas aleatorias)');
  let seed = 20261108; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const qtys = [1, 2, 3, 0.25, 0.1, 0.15, 0.5, 7, 12, 50, 0.333]; const ivas = [0, 10.5, 21, 27];
  const muestras = [];
  caso('descuento único, Σ netos = total final, subtotal + IVA = total, grilla sin descuento', () => {
    for (let k = 0; k < 5000; k += 1) {
      const rows = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => P(qtys[Math.floor(rnd() * qtys.length)], Math.round((1 + rnd() * 50000) * 100) / 100, ivas[Math.floor(rnd() * ivas.length)]));
      const tipo = rnd() < 0.5 ? 'PORCENTAJE' : 'MONTO';
      const sinDesc = calc(rows, 'PORCENTAJE', 0);
      const valor = tipo === 'PORCENTAJE' ? [2.5, 5, 10, 15, 33.33, 50][Math.floor(rnd() * 6)] : Math.round(rnd() * sinDesc.res.total * 0.5 * 100) / 100;
      const { rc, res } = calc(rows, tipo, valor);
      const ctx = JSON.stringify({ rows, tipo, valor });
      assert.equal(cents(res.totalBruto) - cents(res.descuento), cents(res.total), `doble descuento ${ctx}`);
      assert.equal(rc.reduce((a, r) => a + cents(r.total), 0), cents(res.total), `Σ netos ${ctx}`);
      rc.forEach((r, i) => {
        assert.equal(cents(r.subtotal) + cents(r.ivaMonto), cents(r.total), `renglón ${i} ${ctx}`);
        assert.equal(r.totalBruto, sinDesc.rc[i].total, `la grilla cambió con el descuento ${ctx}`);
      });
      if (k < 3000 && res.descuento > 0) muestras.push({ items: rows.map((r) => ({ cantidad: r.cantidad, precio_lista: r.precio, iva_pct: r.ivaPct })), tipo, valor, js: { monto: res.descuento, tb: res.totalBruto, tf: res.total, l: rc.map((r) => [r.precio, r.subtotal, r.ivaMonto, r.total]) } });
    }
  });

  console.log('Paridad React ↔ PHP');
  const helpers = path.join(API_DIR, 'modules/movimientos/global/helpers.php');
  const php = spawnSync('php', ['-v']);
  if (php.status !== 0 || !fs.existsSync(helpers)) {
    console.log(`  ⚠ OMITIDA: no se encontró php o ${helpers} (definí BALTO_API_DIR).`);
  } else {
    const script = `require ${JSON.stringify(helpers)}; $c=json_decode(stream_get_contents(STDIN),true);$bad=[];
      foreach($c as $k=>$x){$p=mov_venta_prorratear_descuento($x['items'],$x['tipo'],$x['valor']);
        $ok=$p['monto']==$x['js']['monto']&&$p['total_bruto']==$x['js']['tb']&&$p['total_final']==$x['js']['tf'];
        foreach($p['lineas'] as $i=>$l){if([$l['precio'],$l['subtotal'],$l['iva_monto'],$l['total']]!=$x['js']['l'][$i])$ok=false;}
        if(!$ok)$bad[]=$k;} echo json_encode(['n'=>count($c),'bad'=>array_slice($bad,0,5)]);`;
    const r = spawnSync('php', ['-d', 'memory_limit=1G', '-r', script], { input: JSON.stringify(muestras), maxBuffer: 1 << 26 });
    caso(`mismos centavos en ${muestras.length} ventas`, () => {
      assert.equal(r.status, 0, String(r.stderr));
      const out = JSON.parse(String(r.stdout));
      assert.deepEqual(out.bad, [], `ventas con diferencias: ${JSON.stringify(out.bad.map((i) => muestras[i]))}`);
    });
  }

  console.log(fallas ? `\n${fallas} prueba(s) fallaron.` : '\nTodas las pruebas pasaron.');
  process.exit(fallas ? 1 : 0);
})();
