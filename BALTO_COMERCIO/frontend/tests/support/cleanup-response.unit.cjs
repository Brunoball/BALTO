'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCleanupResponse,
  describeCleanupFailure,
  assertCleanupEnvelope,
} = require('./cleanup-response.cjs');

test('desafío HTML 403 del CDN se identifica y NO se considera limpieza exitosa', () => {
  const html = '<html>Checking your browser before accessing <script src="/hcdn-cgi/jschallenge"></script></html>';
  const result = normalizeCleanupResponse(403, html, { 'content-type': 'text/html', 'x-hcdn-request-id': 'request-456' });
  assert.equal(result.challenge, true);
  assert.equal(result.validJson, false);
  assert.throws(() => assertCleanupEnvelope(result, 'fin worker 1'), /HOSTINGER_CDN_CHALLENGE/);
  const message = describeCleanupFailure(result, 'fin worker 1');
  assert.match(message, /request-456/);
  assert.ok(!message.includes('<html>'));
});

test('429 con challenge CDN queda identificado como tal', () => {
  const result = normalizeCleanupResponse(429, '<html>Checking your browser before accessing</html>', { 'content-type': 'text/html' });
  assert.equal(result.challenge, true);
});

test('200 con HTML nunca declara la limpieza exitosa', () => {
  const result = normalizeCleanupResponse(200, '<!doctype html>OK', { 'content-type': 'text/html' });
  assert.equal(result.ok, true);
  assert.equal(result.validJson, false);
  assert.throws(() => assertCleanupEnvelope(result, 'fin'), /respuesta no JSON/);
});

test('200 con JSON sin exito=true no declara limpieza exitosa', () => {
  const result = normalizeCleanupResponse(200, JSON.stringify({ restantes_total: 0 }));
  assert.throws(() => assertCleanupEnvelope(result, 'fin'), /HTTP 200/);
});

test('200 con JSON sin restantes_total no declara limpieza exitosa', () => {
  const result = normalizeCleanupResponse(200, JSON.stringify({ exito: true }));
  assert.throws(() => assertCleanupEnvelope(result, 'fin'), /falta restantes_total/);
});

test('200 con restantes_total no numérico rechaza la confirmación', () => {
  const result = normalizeCleanupResponse(200, JSON.stringify({ exito: true, restantes_total: '0' }));
  assert.throws(() => assertCleanupEnvelope(result, 'fin'), /falta restantes_total/);
});

test('200 con JSON válido de limpieza permite verificar restantes', () => {
  const body = { exito: true, restantes_total: 0, eliminados_total: 71, archivos_storage_errores: [] };
  const result = normalizeCleanupResponse(200, JSON.stringify(body));
  assert.deepEqual(assertCleanupEnvelope(result, 'fin'), body);
});

test('200 con E2E restantes sigue informando los pendientes', () => {
  const result = normalizeCleanupResponse(200, JSON.stringify({ exito: true, restantes_total: 3 }));
  assert.equal(assertCleanupEnvelope(result, 'fin').restantes_total, 3);
});

test('403 JSON de permisos no se confunde con challenge', () => {
  const result = normalizeCleanupResponse(403, JSON.stringify({ exito: false, mensaje: 'Permiso denegado' }), { 'content-type': 'application/json' });
  assert.equal(result.challenge, false);
  assert.throws(() => assertCleanupEnvelope(result, 'fin'), /Permiso denegado/);
});

test('HTML de error no vuelca credenciales en mensaje', () => {
  const html = '<html>secret=token-privado body de proxy</html>';
  const result = normalizeCleanupResponse(500, html);
  const msg = describeCleanupFailure(result, 'fin');
  assert.ok(!msg.includes('token-privado'));
});
