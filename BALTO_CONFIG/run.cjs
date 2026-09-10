#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_DIR = __dirname;
const REPO_ROOT = path.resolve(CONFIG_DIR, '..');
const CENTRAL_FILE = path.join(CONFIG_DIR, 'balto.env');

const APPS = {
  login: { dir: 'BALTO_LOGIN', apiPath: '/BALTO_LOGIN/api/routes', system: 'LOGIN' },
  comercio: { dir: 'BALTO_COMERCIO', apiPath: '/BALTO_COMERCIO/api/routes', system: 'COMERCIO' },
  servicios: { dir: 'BALTO_SERVICIOS', apiPath: '/BALTO_SERVICIOS/api/routes', system: 'SERVICIOS' },
};

function readOrigin() {
  const text = fs.readFileSync(CENTRAL_FILE, 'utf8').replace(/^\uFEFF/, '');
  const match = text.match(/^\s*BALTO_ORIGIN\s*=\s*(.+?)\s*$/m);
  if (!match) throw new Error('Falta BALTO_ORIGIN en BALTO_CONFIG/balto.env');
  return match[1].trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
}

function frontendRoot(app) {
  const root = path.join(REPO_ROOT, app.dir);
  for (const candidate of [path.join(root, 'frontend'), root]) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`No se encontro package.json para ${app.dir}`);
}

function run(cmd, args, cwd, env = process.env) {
  const executable = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx') ? `${cmd}.cmd` : cmd;
  const result = spawnSync(executable, args, { cwd, env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function sync() {
  run(process.execPath, [path.join(CONFIG_DIR, 'sync-env.cjs'), '--quiet'], REPO_ROOT);
}

function usage() {
  console.log(`
Uso:
  node BALTO_CONFIG/run.cjs status
  node BALTO_CONFIG/run.cjs sync
  node BALTO_CONFIG/run.cjs build login|comercio|servicios|all
  node BALTO_CONFIG/run.cjs start login|comercio|servicios
  node BALTO_CONFIG/run.cjs test comercio|servicios [argumentos de Playwright]
`);
}

function main() {
  const [actionRaw, appRaw, ...rest] = process.argv.slice(2);
  const action = String(actionRaw || '').toLowerCase();
  const appName = String(appRaw || '').toLowerCase();
  const origin = readOrigin();

  if (action === 'status') {
    console.log('');
    console.log(`BALTO_ORIGIN   ${origin}`);
    console.log(`LOGIN API      ${origin}/BALTO_LOGIN/api/routes`);
    console.log(`COMERCIO API   ${origin}/BALTO_COMERCIO/api/routes`);
    console.log(`SERVICIOS API  ${origin}/BALTO_SERVICIOS/api/routes`);
    console.log(`ACCESO BALTO   ${origin}/`);
    console.log('');
    return;
  }

  if (action === 'sync') {
    sync();
    console.log(`[BALTO_CONFIG] Sincronizado con ${origin}`);
    return;
  }

  if (action === 'build') {
    sync();
    const names = appName === 'all' ? ['login', 'comercio', 'servicios'] : [appName];
    for (const name of names) {
      const app = APPS[name];
      if (!app) { usage(); process.exit(1); }
      console.log(`\n[BALTO_CONFIG] BUILD ${app.dir} -> ${origin}\n`);
      run('npm', ['run', 'build'], frontendRoot(app));
    }
    return;
  }

  if (action === 'start') {
    const app = APPS[appName];
    if (!app) { usage(); process.exit(1); }
    sync();
    console.log(`\n[BALTO_CONFIG] START ${app.dir} -> ${origin}\n`);
    run('npm', ['start'], frontendRoot(app));
    return;
  }

  if (action === 'test') {
    const app = APPS[appName];
    if (!app || appName === 'login') { usage(); process.exit(1); }
    sync();
    const args = rest.length
      ? ['playwright', 'test', ...rest]
      : ['playwright', 'test', '--project=chromium', '--workers=1', '--reporter=list'];
    const env = {
      ...process.env,
      PW_API_URL: origin + app.apiPath,
      PW_EXPECTED_SYSTEM: app.system,
    };
    console.log(`\n[BALTO_CONFIG] TEST ${app.dir} -> ${env.PW_API_URL}\n`);
    run('npx', args, frontendRoot(app), env);
    return;
  }

  usage();
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`\n[BALTO_CONFIG] ERROR: ${error.message}\n`);
  process.exit(1);
}
