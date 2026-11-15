'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedFiscalRequest } = require('./fiscal-safety.cjs');

const api = 'https://app.balto.com.ar/BALTO_COMERCIO/api/routes/api.php';
const req = (action, method = 'POST', body = null) => ({ url: `${api}?action=${action}`, method, body });

test('bloquea toda emisión/NC/CAE fiscal aun con métodos o alias distintos', () => {
  for (const action of [
    'wsfe_emitir', 'arca_wsfe_emitir', 'wsfe_nc_emitir', 'factura_emitir',
    'facturacion_emitir', 'nota_credito_fiscal_emitir', 'arca_autorizar', 'afip_generar_cae',
  ]) assert.equal(isBlockedFiscalRequest(req(action)), true, action);
  assert.equal(isBlockedFiscalRequest({ url: 'https://x.test/wsfe_emitir.php', method: 'GET' }), true);
  assert.equal(isBlockedFiscalRequest({ url: 'https://x.test/wsfe.php', method: 'POST' }), true);
  assert.equal(isBlockedFiscalRequest({ url: api, method: 'POST', body: JSON.stringify({ action: 'wsfe_emitir' }) }), true);
});

test('no interfiere con las operaciones internas ni las lecturas fiscales', () => {
  for (const action of [
    'ventas_crear_batch', 'ventas_nota_credito_aplicar', 'compras_crear',
    'otros_ingresos_nota_credito_aplicar', 'stock_productos_actualizar', 'padron_cuit',
    'cliente_fiscal_get', 'auth_session_check', 'wsfe_consultar',
  ]) assert.equal(isBlockedFiscalRequest(req(action, action === 'ventas_crear_batch' ? 'POST' : 'GET')), false, action);
  assert.equal(isBlockedFiscalRequest(req('ventas_nota_credito_aplicar')), false);
});
