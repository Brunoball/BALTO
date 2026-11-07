// Entorno único de la suite E2E de BALTO eCommerce (equivalente a support/env.js de Comercio).
// Lee .env.playwright y los .env del frontend; calcula URLs, tienda, modo y protecciones.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FRONTEND = path.resolve(__dirname, '..', '..');

// Igual que Comercio: antes de leer los .env se sincroniza BALTO_CONFIG/balto.env, para que
// el runner y el `npm start` del frontend apunten al mismo servidor.
function sincronizarBaltoConfig() {
  if (process.env.BALTO_PW_CONFIG_SYNCED === '1') return;
  process.env.BALTO_PW_CONFIG_SYNCED = '1';
  const script = [path.resolve(FRONTEND, '../../BALTO_CONFIG/sync-env.cjs'), path.resolve(FRONTEND, '../BALTO_CONFIG/sync-env.cjs')].find((f) => fs.existsSync(f));
  if (!script) return;
  const r = spawnSync(process.execPath, [script, '--quiet'], { cwd: path.dirname(script), env: process.env, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) {
    // eslint-disable-next-line no-console
    console.warn(`[Playwright] BALTO_CONFIG/sync-env.cjs no terminó bien (${r.error?.message || `código ${r.status}`}). Se usan los .env actuales.`);
  }
}
sincronizarBaltoConfig();

function leerEnv(archivo) {
  const ruta = path.join(FRONTEND, archivo);
  if (!fs.existsSync(ruta)) return {};
  const out = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const n = l.startsWith('export ') ? l.slice(7).trim() : l;
    const eq = n.indexOf('=');
    if (eq <= 0) continue;
    let v = n.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[n.slice(0, eq).trim()] = v; // la última aparición gana (sync-env repite algunas claves)
  }
  return out;
}

const bool = (v) => ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

// Prioridad: variables del proceso > .env.playwright > .env.development.local > .env.development > .env
const frontendEnv = { ...leerEnv('.env'), ...leerEnv('.env.development'), ...leerEnv('.env.development.local') };
const pwEnv = leerEnv('.env.playwright');
const get = (k, def = '') => String(process.env[k] ?? pwEnv[k] ?? frontendEnv[k] ?? def).trim();

const apiURL = get('PW_API_URL').replace(/\/+$/, '');
const tienda = (get('PW_ECOMMERCE_TIENDA') || get('REACT_APP_ECOMMERCE_DEV_TIENDA')).toLowerCase();
const puerto = get('PORT', '3002') || '3002';

function entornoDe(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return 'invalido'; }
  if (host === 'app.balto.com.ar' || host === 'www.app.balto.com.ar') return 'produccion';
  if (host === 'balto.3devsnet.com') return 'staging';
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  return 'desconocido';
}

const ENV = Object.freeze({
  frontendRoot: FRONTEND,
  srcDir: path.join(FRONTEND, 'src'),
  apiURL,
  tienda,
  origenTienda: tienda ? `https://${tienda}` : '',
  baseURL: get('PW_BASE_URL') || `http://localhost:${puerto}`,
  proxyOrigin: get('REACT_APP_BALTO_ORIGIN').replace(/\/+$/, ''),
  apiFrontend: get('REACT_APP_API_URL'),
  entorno: entornoDe(apiURL),
  allowMutations: bool(get('PW_ALLOW_MUTATIONS', '0')),
  allowProduction: bool(get('PW_ALLOW_PRODUCTION', '0')),
  sesionComprador: get('PW_SESION_COMPRADOR'),
  emailPedidos: get('PW_EMAIL_PEDIDOS', 'pedido.prueba@example.com'),
  timeoutMs: Number.parseInt(get('PW_TIMEOUT_MS', '60000'), 10) || 60000,
  expectTimeoutMs: Number.parseInt(get('PW_EXPECT_TIMEOUT_MS', '15000'), 10) || 15000,
  startCommand: get('PW_FRONTEND_COMMAND', 'npm start'),
  arrancarFrontend: get('PW_START_FRONTEND', '1') !== '0',
});

/** Errores de configuración que impiden correr la suite (se muestran en el preflight). */
function problemasDeConfiguracion() {
  const p = [];
  if (!ENV.apiURL) p.push('Falta PW_API_URL en .env.playwright.');
  else if (!/\/BALTO_ECOMMERCE\/api\/index\.php$/.test(new URL(ENV.apiURL).pathname)) p.push(`PW_API_URL debe terminar en /BALTO_ECOMMERCE/api/index.php (recibido ${ENV.apiURL}).`);
  if (['invalido', 'desconocido'].includes(ENV.entorno)) p.push(`Host no permitido en PW_API_URL: usá balto.3devsnet.com (staging) o app.balto.com.ar (producción).`);
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(ENV.tienda)) p.push('Falta PW_ECOMMERCE_TIENDA (o REACT_APP_ECOMMERCE_DEV_TIENDA) con el dominio de la tienda.');
  return p;
}

/** Las escrituras nunca van a producción salvo PW_ALLOW_PRODUCTION=1 explícito. */
function assertMutacionSegura() {
  if (!ENV.allowMutations) throw new Error('[E2E] Mutaciones deshabilitadas: definí PW_ALLOW_MUTATIONS=1 (solo staging).');
  if (ENV.entorno === 'produccion' && !ENV.allowProduction) {
    throw new Error('[E2E] PW_API_URL apunta a PRODUCCIÓN y PW_ALLOW_PRODUCTION no está en 1: no se ejecutan escrituras.');
  }
}

/** Salta el test si no se permiten escrituras (como requireMutations de Comercio). */
function requiereMutaciones(test) {
  const motivo = !ENV.allowMutations
    ? 'Escribe datos: definí PW_ALLOW_MUTATIONS=1 (solo staging).'
    : (ENV.entorno === 'produccion' && !ENV.allowProduction ? 'PW_API_URL es producción y PW_ALLOW_PRODUCTION=0.' : null);
  test.skip(Boolean(motivo), motivo || '');
}

module.exports = { ENV, problemasDeConfiguracion, assertMutacionSegura, requiereMutaciones, leerEnv };
