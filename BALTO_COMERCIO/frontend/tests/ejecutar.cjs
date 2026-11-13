#!/usr/bin/env node
'use strict';
/**
 * BALTO Comercio: ejecución por módulo funcional.
 * Uso normal: GLOBAL + módulo modificado (dos comandos); COMPLETO para regresión total.
 * Los impactos directos están definidos en perfiles.json y nunca se duplican.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { modulos } = require('./perfiles.json');
const testsDir = __dirname;
const frontend = path.resolve(testsDir, '..');
const requested = (process.argv[2] || '').trim().toLowerCase().replaceAll('-', '_');
const flags = process.argv.slice(3);
function fail(message) { console.error('ERROR: ' + message); process.exit(1); }
function normal(filepath) { return path.relative(frontend,filepath).split(path.sep).join('/'); }
function discover(directory) {
  if (!fs.existsSync(directory)) fail('No existe la carpeta: ' + directory);
  const files = [];
  for (const item of fs.readdirSync(directory, {withFileTypes:true})) {
    const full=path.join(directory,item.name);
    if (item.isDirectory()) files.push(...discover(full));
    else if (item.isFile() && item.name.endsWith('.spec.js')) files.push(full);
  }
  return files.sort();
}
function verify() {
  const actual = new Set(discover(testsDir).map(p => normal(p).replace(/^tests\//,'')));
  const assigned = new Set();
  for (const [name, profile] of Object.entries(modulos)) {
    const dir = path.join(testsDir,profile.carpeta);
    for (const f of discover(dir)) {
      const key=normal(f).replace(/^tests\//,'');
      if (assigned.has(key)) fail('Test clasificado dos veces: '+key);
      assigned.add(key);
    }
    for (const target of [...profile.impactos,...(profile.excluir||[])]) {
      if (!fs.statSync(path.join(testsDir,target),{throwIfNoEntry:false})?.isFile()) fail(`Referencia inexistente (${name}): ${target}`);
    }
  }
  const missed = [...actual].filter(x => !assigned.has(x));
  if (missed.length) fail('Tests sin dueño: '+missed.join(', '));
  return actual.size;
}
if (!requested || ['ayuda','help','--help'].includes(requested)) {
  console.log('Uso: node tests/ejecutar.cjs global | <modulo> | completo');
  console.log('Módulos: '+Object.keys(modulos).filter(m=>m!=='global').join(', '));
  process.exit(0);
}
if (!['--list'].every(f=>flags.filter(x=>x===f).length<=1) || flags.some(f=>f!=='--list')) fail('Opciones no reconocidas.');
if (requested==='verificar') { console.log('OK: '+verify()+' tests originales y de navegación clasificados.'); process.exit(0); }
if (requested!=='completo' && !modulos[requested]) fail('Módulo no registrado: '+requested);
verify();
const profile=modulos[requested];
const selected=requested==='completo' ? [] : [...new Set([
  ...discover(path.join(testsDir,profile.carpeta)).map(normal),
  ...profile.impactos.map(f=>'tests/'+f),
].filter(f=>!(profile.excluir||[]).some(ex=>f==='tests/'+ex)))].sort();
console.log('\nBALTO COMERCIO: '+requested.toUpperCase());
if (requested==='completo') console.log('Suite completa, sin filtrado de archivos.');
else console.log(selected.length+' archivos seleccionados (módulo y sus impactos directos).');
if (flags.includes('--list')) { selected.forEach(x=>console.log(x)); process.exit(0); }
const candidates=[path.join(frontend,'node_modules','playwright','cli.js'),path.join(frontend,'node_modules','@playwright','test','cli.js')];
const cli=candidates.find(p=>fs.existsSync(p));
if (!cli) fail('No encontré Playwright en frontend/node_modules. Primero instalá las dependencias del proyecto.');
const args=[cli,'test',...selected,'--project=chromium','--workers=1','--reporter=list'];
if(requested!=='completo') args.push('--max-failures=2');
const result=spawnSync(process.execPath,args,{cwd:frontend,stdio:'inherit',env:process.env});
if(result.error) fail(result.error.message);
process.exit(result.status??1);
