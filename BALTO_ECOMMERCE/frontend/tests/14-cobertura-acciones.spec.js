// Cobertura: mantiene la suite 100% al día con la web.
//  - Toda acción que llama el frontend (src/componentes/**/api/*.js) está en soporte/acciones.js.
//  - Toda acción del catálogo se prueba al menos en un spec además del contrato (13).
//  - Las acciones con cookie del frontend (ACCIONES_CON_SESION) coinciden con el catálogo.
//  - Los hooks y las llamadas a la API viven dentro del módulo que corresponde (estructura).
// Si alguien agrega una acción o mueve un archivo sin actualizar los tests, esto falla.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./soporte/test');
const { ENV } = require('./soporte/entorno');
const { ACCIONES, SOLO_BACKEND } = require('./soporte/acciones');

const COMPONENTES = path.join(ENV.srcDir, 'componentes');
const listar = (dir, filtro) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? listar(p, filtro) : (filtro(p) ? [p] : []);
});
const rel = (p) => path.relative(ENV.srcDir, p).split(path.sep).join('/');

function accionesDelFrontend() {
  const out = new Map();
  for (const f of listar(COMPONENTES, (p) => /[\\/]api[\\/][^\\/]+\.js$/.test(p))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\b(?:apiGet|apiPost|buildUrl)\(\s*'([a-z_]+)'/g)) out.set(m[1], rel(f));
  }
  return out;
}

test.describe('Cobertura de acciones y estructura', () => {
  test.skip(!fs.existsSync(COMPONENTES), `No se encontró ${COMPONENTES}: ejecutá desde la raíz del frontend.`);

  test('toda acción que usa la web está catalogada y viceversa', () => {
    const front = accionesDelFrontend();
    const faltan = [...front.keys()].filter((a) => !ACCIONES[a]);
    expect(faltan, 'Acciones nuevas en el frontend: agregalas a tests/soporte/acciones.js y probalas').toEqual([]);
    const sinUso = Object.keys(ACCIONES).filter((a) => !front.has(a) && !SOLO_BACKEND.has(a));
    expect(sinUso, 'Acciones del catálogo que la web ya no usa').toEqual([]);
    for (const [accion, archivo] of front) {
      const modulo = archivo.split('/')[1];
      expect([ACCIONES[accion].modulo, 'global'], `${accion} se llama desde ${archivo}`).toContain(modulo);
    }
  });

  test('cada acción tiene al menos una prueba funcional además del contrato', () => {
    const specs = fs.readdirSync(__dirname).filter((f) => /^\d{2}-.*\.spec\.js$/.test(f) && !/^1[34]-/.test(f));
    const texto = specs.map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');
    const sinPrueba = Object.keys(ACCIONES).filter((a) => !new RegExp(`['"\`]${a}['"\`]|action=${a}\\b`).test(texto));
    expect(sinPrueba, 'Acciones sin prueba funcional').toEqual([]);
  });

  test('las acciones con cookie del frontend coinciden con el catálogo (EC_ACCIONES_CON_CREDENCIALES)', () => {
    const src = fs.readFileSync(path.join(COMPONENTES, 'global', 'api', 'clienteApi.js'), 'utf8');
    const bloque = /ACCIONES_CON_SESION = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] || '';
    const front = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const catalogo = Object.entries(ACCIONES).filter(([, d]) => d.credenciales).map(([a]) => a).sort();
    expect(front).toEqual(catalogo);
  });

  test('estructura: todo vive en componentes/<modulo>/ con api/ y hooks/ propios', () => {
    const raiz = fs.readdirSync(ENV.srcDir, { withFileTypes: true });
    const carpetas = raiz.filter((e) => e.isDirectory()).map((e) => e.name);
    expect(carpetas, 'En src/ solo queda la carpeta componentes').toEqual(['componentes']);
    for (const viejo of ['servicios', 'hooks', 'paginas', 'contexto', 'utilidades', 'estilos', 'configuracion']) {
      expect(fs.existsSync(path.join(ENV.srcDir, viejo)), `src/${viejo} ya no debe existir`).toBe(false);
    }
    const hooks = listar(COMPONENTES, (p) => /[\\/]use[A-Z]\w+\.js$/.test(p) && !/[\\/]global[\\/]/.test(p));
    for (const h of hooks) expect(rel(h), 'Los hooks de módulo van en componentes/<modulo>/hooks/').toMatch(/^componentes\/[a-z]+\/hooks\//);
    const usosFetch = listar(COMPONENTES, (p) => /\.jsx?$/.test(p) && !/[\\/]api[\\/]/.test(p))
      .filter((p) => /\bfetch\(|XMLHttpRequest/.test(fs.readFileSync(p, 'utf8')));
    expect(usosFetch.map(rel), 'Las llamadas HTTP van en la carpeta api/ de cada módulo').toEqual([]);
  });
});
