'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isHostingerChallenge, readAuthResponse, requireJson, authHttpError } = require('./auth-gateway.cjs');

function fakeResponse(status, body, headers = {}) {
  return {
    status: () => status,
    headers: () => headers,
    text: async () => body,
  };
}

test('403 con challenge de Hostinger se detecta y no incluye el HTML en el error', async () => {
  const html = '<html>Checking your browser before accessing<script src="/hcdn-cgi/jschallenge"></script></html>';
  await assert.rejects(
    readAuthResponse(fakeResponse(403, html, {
      'content-type': 'text/html',
      'x-hcdn-request-id': 'request-test-123',
    }), 'auth_session_check'),
    (error) => error.code === 'HOSTINGER_CDN_CHALLENGE' &&
      error.message.includes('request-test-123') &&
      !error.message.includes('<html>'),
  );
});

test('403 JSON de backend no se confunde con desafío antibot', async () => {
  const info = await readAuthResponse(fakeResponse(403, JSON.stringify({
    exito: false, codigo: 'ORIGEN_NO_PERMITIDO', mensaje: 'Origen no permitido',
  }), { 'content-type': 'application/json' }), 'auth_session_check');
  assert.equal(info.status, 403);
  assert.equal(info.validJson, true);
  assert.equal(info.body.codigo, 'ORIGEN_NO_PERMITIDO');
  assert.match(authHttpError('auth_session_check', info).message, /ORIGEN_NO_PERMITIDO/);
});

test('401 de sesión expirada se mantiene como JSON de la aplicación', async () => {
  const info = await readAuthResponse(fakeResponse(401, '{"exito":false,"codigo":"SESSION_EXPIRED"}'), 'auth_session_check');
  assert.equal(requireJson(info, 'auth_session_check').codigo, 'SESSION_EXPIRED');
});

test('403 HTML inesperado no se interpreta como token expirado', async () => {
  const info = await readAuthResponse(fakeResponse(403, '<html>Acceso denegado</html>', { 'content-type': 'text/html' }), 'auth_session_check');
  assert.equal(info.validJson, false);
  assert.throws(() => requireJson(info, 'auth_session_check'), /AUTH_NON_JSON/);
});

test('JSON correcto sigue permitido', async () => {
  const info = await readAuthResponse(fakeResponse(200, '{"exito":true,"sesion_valida":true}'), 'auth_session_check');
  assert.equal(requireJson(info, 'auth_session_check').exito, true);
});

test('un HTML de 403 con encabezados hcdn también se marca como desafío', () => {
  assert.equal(isHostingerChallenge(403, { 'x-hcdn-foo': 'x', 'content-type': 'text/html' }, '<html>Forbidden</html>'), true);
  assert.equal(isHostingerChallenge(200, { 'content-type': 'text/html' }, '<html>Okay</html>'), false);
});

test('un error no JSON no filtra datos de respuesta en los logs', async () => {
  const html = '<html><body>SECRET_DATA_DO_NOT_LOG</body></html>';
  const info = await readAuthResponse(fakeResponse(403, html), 'auth_session_check');
  assert.throws(() => requireJson(info, 'auth_session_check'), (error) => !error.message.includes('SECRET_DATA_DO_NOT_LOG'));
});
