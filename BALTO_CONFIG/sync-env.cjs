#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = __dirname;
const REPO_ROOT = path.resolve(CONFIG_DIR, '..');
const CENTRAL_FILE = path.join(CONFIG_DIR, 'balto.env');
const QUIET = process.argv.includes('--quiet');

const APPS = {
  BALTO_LOGIN: {
    apiPath: '/BALTO_LOGIN/api/routes',
    system: 'LOGIN',
    productionBase: '/',
  },
  BALTO_COMERCIO: {
    apiPath: '/BALTO_COMERCIO/api/routes',
    system: 'COMERCIO',
    productionBase: '/BALTO_COMERCIO',
  },
  BALTO_SERVICIOS: {
    apiPath: '/BALTO_SERVICIOS/api/routes',
    system: 'SERVICIOS',
    productionBase: '/BALTO_SERVICIOS',
  },
};

const MANAGED_KEYS = new Set([
  'REACT_APP_BALTO_ORIGIN',
  'REACT_APP_API_URL',
  'REACT_APP_AUTH_API_BASE',
  'REACT_APP_BALTO_LOGIN_URL',
  'REACT_APP_BALTO_ACCESS_URL',
  'REACT_APP_COMERCIO_URL',
  'REACT_APP_SERVICIOS_URL',
  'REACT_APP_ALLOWED_APP_ORIGINS',
  'REACT_APP_ROUTER_BASENAME',
  'PUBLIC_URL',
  'PW_API_URL',
  'PW_EXPECTED_SYSTEM',
]);

function log(message) {
  if (!QUIET) console.log(message);
}

function fail(message) {
  console.error(`\n[BALTO_CONFIG] ERROR: ${message}\n`);
  process.exit(1);
}

function readKeyValueFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function normalizeOrigin(value) {
  let origin = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) {
    fail(`BALTO_ORIGIN debe comenzar con http:// o https://. Valor actual: ${JSON.stringify(value)}`);
  }
  try {
    const parsed = new URL(origin);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      fail(`BALTO_ORIGIN debe contener solamente protocolo + dominio, sin rutas. Valor actual: ${origin}`);
    }
    origin = `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    fail(`BALTO_ORIGIN no es una URL valida: ${origin}`);
  }
  return origin;
}

function findFrontendRoot(appName) {
  const appRoot = path.join(REPO_ROOT, appName);
  const candidates = [path.join(appRoot, 'frontend'), appRoot];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

function getExtraAssignments(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const extras = [];
  const seen = new Set();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=.*$/);
    if (!match) continue;
    const key = match[1];
    if (MANAGED_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push(trimmed);
  }
  return extras;
}

function writeManagedEnv(file, managedEntries, createIfMissing = true) {
  if (!createIfMissing && !fs.existsSync(file)) return false;

  const extras = getExtraAssignments(file);
  const lines = [
    '# ============================================================',
    '# GENERADO AUTOMATICAMENTE POR BALTO_CONFIG/sync-env.cjs',
    '# NO EDITAR. CAMBIAR SOLO: BALTO_CONFIG/balto.env',
    '# ============================================================',
    ...managedEntries.map(([key, value]) => `${key}=${value}`),
  ];

  if (extras.length) {
    lines.push('', '# Variables adicionales preservadas del archivo anterior:', ...extras);
  }
  lines.push('');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return true;
}

function frontendEntries(appName, origin, mode) {
  const app = APPS[appName];
  const apiUrl = origin + app.apiPath;
  const isProduction = mode === 'production';
  const isCommon = mode === 'common';
  const base = isProduction ? app.productionBase : '/';
  const entries = [
    ['REACT_APP_BALTO_ORIGIN', origin],
    ['REACT_APP_API_URL', apiUrl],
  ];

  // Alias viejos + nuevos: evita romper cualquiera de los frontends actuales.
  if (appName === 'BALTO_LOGIN') {
    entries.push(
      ['REACT_APP_AUTH_API_BASE', apiUrl],
      ['REACT_APP_BALTO_ACCESS_URL', `${origin}/`],
      ['REACT_APP_COMERCIO_URL', '/BALTO_COMERCIO/'],
      ['REACT_APP_SERVICIOS_URL', '/BALTO_SERVICIOS/'],
      ['REACT_APP_ALLOWED_APP_ORIGINS', origin],
    );
  } else {
    entries.push(
      ['REACT_APP_BALTO_LOGIN_URL', `${origin}/`],
      // config.jsx de COMERCIO/SERVICIOS actualmente usa este nombre.
      ['REACT_APP_BALTO_ACCESS_URL', `${origin}/`],
    );
  }

  if (!isCommon) {
    entries.push(['REACT_APP_ROUTER_BASENAME', base]);
    if (isProduction && appName !== 'BALTO_LOGIN') {
      entries.push(['PUBLIC_URL', base]);
    }
  }
  return entries;
}

function playwrightEntries(appName, origin) {
  const app = APPS[appName];
  return [
    ['PW_API_URL', origin + app.apiPath],
    ['PW_EXPECTED_SYSTEM', app.system],
  ];
}

function syncApp(appName, origin) {
  const frontend = findFrontendRoot(appName);
  if (!frontend) {
    log(`[BALTO_CONFIG] ${appName}: carpeta no encontrada, se omite.`);
    return { appName, found: false };
  }

  // Archivos CRA que SI participan del runtime/build.
  writeManagedEnv(path.join(frontend, '.env'), frontendEntries(appName, origin, 'development'), true);
  writeManagedEnv(path.join(frontend, '.env.production'), frontendEntries(appName, origin, 'production'), true);

  // Si existen overrides de mayor precedencia, tambien se sincronizan para que
  // nunca quede una URL vieja escondida pisando la configuracion central.
  const optionalRuntimeFiles = [
    ['.env.development', 'development'],
    // .env.local se carga tanto en development como en production. Solo URLs:
    // no debe pisar ROUTER_BASENAME/PUBLIC_URL del modo concreto.
    ['.env.local', 'common'],
    ['.env.development.local', 'development'],
    ['.env.production.local', 'production'],
  ];
  for (const [name, mode] of optionalRuntimeFiles) {
    writeManagedEnv(path.join(frontend, name), frontendEntries(appName, origin, mode), false);
  }

  // Los examples no ejecutan nada, pero se limpian si existen para no confundir.
  for (const name of ['.env.example', '.env.development.local.example']) {
    writeManagedEnv(path.join(frontend, name), frontendEntries(appName, origin, 'development'), false);
  }

  // Playwright: conserva todas las flags actuales y cambia solamente el destino
  // central (mas PW_EXPECTED_SYSTEM). No toca tests ni credenciales/logica.
  const pwFile = path.join(frontend, '.env.playwright');
  if (fs.existsSync(pwFile) || appName !== 'BALTO_LOGIN') {
    writeManagedEnv(pwFile, playwrightEntries(appName, origin), true);
  }

  log(`[BALTO_CONFIG] ${appName}: OK -> ${frontend}`);
  return { appName, found: true, frontend };
}

function main() {
  if (!fs.existsSync(CENTRAL_FILE)) {
    fail(`No existe ${CENTRAL_FILE}`);
  }
  const central = readKeyValueFile(CENTRAL_FILE);
  const origin = normalizeOrigin(central.BALTO_ORIGIN);

  log('');
  log(`[BALTO_CONFIG] ORIGEN CENTRAL: ${origin}`);
  log('');

  const results = Object.keys(APPS).map((appName) => syncApp(appName, origin));
  const found = results.filter((r) => r.found).length;
  if (found === 0) {
    fail(`No encontre BALTO_LOGIN, BALTO_COMERCIO ni BALTO_SERVICIOS debajo de ${REPO_ROOT}`);
  }

  log('');
  log('[BALTO_CONFIG] URLs derivadas:');
  log(`  LOGIN API     ${origin}/BALTO_LOGIN/api/routes`);
  log(`  COMERCIO API  ${origin}/BALTO_COMERCIO/api/routes`);
  log(`  SERVICIOS API ${origin}/BALTO_SERVICIOS/api/routes`);
  log(`  ACCESO BALTO  ${origin}/`);
  log('');
}

main();
