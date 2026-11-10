const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
// Test aislado de la lógica real de los fixtures, sin navegador ni credenciales.
const source = fs.readFileSync(path.resolve(__dirname, '../support/services.js'), 'utf8');
const extract = (start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))).replace(/^export /,'');
const code = [
  extract('export async function createServiceArticleFixture(', 'export async function getTypedServiceArticleByName('),
  extract('export async function getAnyServiceArticleByName(', 'export async function updateServiceArticleFixture('),
].join('\n');
const plan = {stock:false,stockPanel:false};
let posts=[], lookup=[];
const mockExpect = (v) => ({
  toBeGreaterThan(n) { assert.ok(v>n, `${v} debe ser > ${n}`); },
  toBeTruthy() { assert.ok(v); }
});
const c = {
  planCan: async (_p,cap)=>cap==='resources.stock'?plan.stock:cap==='stock.panel'?plan.stockPanel:false,
  ensureActiveServiceUnit:async()=>({id_unidad:12}),
  serviciosApi:async (_p,action, opts)=>{
    posts.push({action,body:opts.body});
    return {status:201,body:{id_articulo:41}};
  },
  expectApiSuccess:(result)=>result.body,
  getTypedServiceArticleByName:async (_p,name,type)=>{lookup.push(type);return {id_articulo:41,nombre:name,tipo:type,controla_stock:plan.stock?1:0,stock_actual:plan.stock?20:0};},
  getServiceArticleByName:async()=>{lookup.push('STOCK');return {id_articulo:41,controla_stock:1,stock_actual:20};},
  expect:(_v)=>mockExpect(_v),
  uniqueName:()=> 'NOMBRE E2E',
  Number, String, Error,
};
vm.runInNewContext(`${code}\nthis.fns = {createServiceArticleFixture, getAnyServiceArticleByName}`,c);
(async()=>{
  let art=await c.fns.createServiceArticleFixture(null,{type:'MATERIAL',name:'TEST2',stock:20,cost:15,price:30,idUnit:12,controlStock:false});
  assert.equal(posts[0].body.stock_actual,0);
  assert.equal(posts[0].body.controla_stock,0);
  assert.equal(art.controla_stock,0);
  posts=[];lookup=[];
  const defaultPlan2 = await c.fns.createServiceArticleFixture(null,{type:'INSUMO',name:'TEST2-DEFAULT',stock:12,idUnit:12});
  assert.equal(posts[0].body.stock_actual,0);
  assert.equal(posts[0].body.controla_stock,0);
  assert.equal(defaultPlan2.controla_stock,0);
  posts=[];lookup=[];
  await c.fns.getAnyServiceArticleByName(null,'TEST2');
  assert.deepEqual(lookup,['MATERIAL']);
  plan.stock=true;plan.stockPanel=true;
  art=await c.fns.createServiceArticleFixture(null,{type:'MATERIAL',name:'TEST3',stock:20,cost:15,price:30,idUnit:12});
  assert.equal(posts[0].body.stock_actual,20);
  assert.equal(posts[0].body.controla_stock,1);
  lookup=[];
  await c.fns.getAnyServiceArticleByName(null,'TEST3');
  assert.deepEqual(lookup,['STOCK']);
  plan.stock=false;plan.stockPanel=false;
  posts=[];
  await assert.rejects(()=>c.fns.createServiceArticleFixture(null,{type:'MATERIAL',name:'BAD',stock:20,idUnit:12,controlStock:true}),/necesita resources.stock/);
  assert.equal(posts.length,0);
  console.log('OK: fixtures plan 2 con stock 0; plan 3 stock 20; limpieza plan 2 sin API Stock; alta ilegal bloqueada.');
})().catch(e=>{console.error(e);process.exitCode=1;});
