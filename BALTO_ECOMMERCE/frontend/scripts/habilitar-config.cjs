#!/usr/bin/env node
'use strict';
// Prepara solamente el package.json existente de BALTO_ECOMMERCE.
// Nunca reemplaza dependencias ni package-lock.json.
const fs = require('fs');
const path = require('path');
const frontend = path.resolve(__dirname, '..');
const file = path.join(frontend, 'package.json');
const sync = path.resolve(frontend, '..', '..', 'BALTO_CONFIG', 'sync-env.cjs');
if (!fs.existsSync(sync)) throw new Error('BALTO_CONFIG/sync-env.cjs no encontrado. Extrae el ZIP desde la raiz BALTO.');
if (!fs.existsSync(file)) throw new Error('No existe el package.json de React.');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const backup = file + '.backup-ecommerce';
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
pkg.scripts = pkg.scripts || {};
pkg.scripts['balto:sync'] = 'node ../../BALTO_CONFIG/sync-env.cjs --quiet';
for (const script of ['prestart', 'prebuild']) {
  const current = String(pkg.scripts[script] || '').trim();
  if (!current.includes('balto:sync')) pkg.scripts[script] = `npm run balto:sync${current ? ` && ${current}` : ''}`;
}
pkg.scripts['test:e2e'] = 'playwright test';
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('[BALTO_ECOMMERCE] package.json conectado a BALTO_CONFIG; respaldo:', path.basename(backup));
