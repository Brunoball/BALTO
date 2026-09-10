#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_DIR = __dirname;
const REPO_ROOT = path.resolve(CONFIG_DIR, '..');
const APP_NAMES = ['BALTO_LOGIN', 'BALTO_COMERCIO', 'BALTO_SERVICIOS'];

function findFrontendRoot(appName) {
  const appRoot = path.join(REPO_ROOT, appName);
  for (const candidate of [path.join(appRoot, 'frontend'), appRoot]) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backupFile(file, backupRoot, frontend, appName) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(frontend, file);
  const dest = path.join(backupRoot, appName, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function chainPreScript(current, syncCommand) {
  const value = String(current || '').trim();
  if (!value) return syncCommand;
  if (value.includes('balto:sync')) return value;
  return `${syncCommand} && ${value}`;
}

function patchPackage(frontend, appName, backupRoot) {
  const packageFile = path.join(frontend, 'package.json');
  backupFile(packageFile, backupRoot, frontend, appName);
  for (const name of [
    '.env', '.env.production', '.env.development', '.env.local',
    '.env.development.local', '.env.production.local', '.env.playwright',
    '.env.example', '.env.development.local.example'
  ]) {
    backupFile(path.join(frontend, name), backupRoot, frontend, appName);
  }

  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8').replace(/^\uFEFF/, ''));
  pkg.scripts = pkg.scripts || {};

  let relativeSync = path.relative(frontend, path.join(CONFIG_DIR, 'sync-env.cjs')).replace(/\\/g, '/');
  if (!relativeSync.startsWith('.')) relativeSync = `./${relativeSync}`;
  const baltoSyncCommand = `node ${relativeSync} --quiet`;
  pkg.scripts['balto:sync'] = baltoSyncCommand;

  // npm ejecuta prebuild/prestart automaticamente antes de build/start.
  pkg.scripts.prebuild = chainPreScript(pkg.scripts.prebuild, 'npm run balto:sync');
  pkg.scripts.prestart = chainPreScript(pkg.scripts.prestart, 'npm run balto:sync');

  // Si ya hay scripts npm que llaman Playwright, tambien quedan sincronizados.
  for (const [name, command] of Object.entries({ ...pkg.scripts })) {
    if (name.startsWith('pre') || name === 'balto:sync') continue;
    if (typeof command !== 'string' || !/playwright\s+test/i.test(command)) continue;
    const preName = `pre${name}`;
    pkg.scripts[preName] = chainPreScript(pkg.scripts[preName], 'npm run balto:sync');
  }

  fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[BALTO_CONFIG] package.json preparado: ${appName}`);
}

function main() {
  const backupRoot = path.join(CONFIG_DIR, 'backup-instalacion', timestamp());
  let count = 0;

  for (const appName of APP_NAMES) {
    const frontend = findFrontendRoot(appName);
    if (!frontend) {
      console.log(`[BALTO_CONFIG] ${appName}: no se encontro package.json; se omite.`);
      continue;
    }
    patchPackage(frontend, appName, backupRoot);
    count++;
  }

  if (count === 0) {
    console.error('\n[BALTO_CONFIG] No se encontro ningun frontend. Extrae BALTO_CONFIG dentro de la raiz BALTO.\n');
    process.exit(1);
  }

  const sync = spawnSync(process.execPath, [path.join(CONFIG_DIR, 'sync-env.cjs')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (sync.status !== 0) process.exit(sync.status || 1);

  console.log('');
  console.log('[BALTO_CONFIG] INSTALACION LISTA.');
  console.log('A partir de ahora cambia SOLO BALTO_CONFIG/balto.env.');
  console.log('npm run start y npm run build sincronizan automaticamente antes de ejecutarse.');
  console.log('Para Playwright usa los .bat de BALTO_CONFIG o ejecuta SYNC_CONFIG.bat antes de tus scripts actuales.');
  console.log(`Backup inicial: ${backupRoot}`);
  console.log('');
}

main();
