'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const gateway = require('./auth-gateway.cjs');

// Ejecuta la lógica REAL de users.js con APIRequestContext simulado. Esto
// prueba decisiones de renovación sin llamar a Hostinger ni tocar bases de datos.
const source = fs.readFileSync(path.join(__dirname, 'users.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '')
  .replace(/^export\s+/gm, '') + '\nmodule.exports = { ensureAdministratorSession };';

function response(status, body, headers = {}) {
  return {
    status: () => status,
    headers: () => headers,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    dispose: async () => {},
  };
}

function createFixture(getResponses) {
  const requests = { gets: 0, posts: 0, writes: 0 };
  const queue = [...getResponses];
  const origin = 'http://127.0.0.1:3000';
  let sessionKey = 'VALID_SESSION_KEY';
  const context = {
    request: {
      get: async () => { requests.gets += 1; return queue.shift() || response(200, { exito: true, sesion_valida: true }); },
      post: async () => {
        requests.posts += 1;
        return response(200, { exito: true, session_key: 'REFRESHED_SESSION_KEY', usuario: { usuario: 'admin' } });
      },
    },
    storageState: async (opts) => {
      if (opts?.path) requests.writes += 1;
      return { origins: [{ origin, localStorage: [{ name: 'session_key', value: sessionKey }] }] };
    },
  };
  const page = {
    context: () => context,
    addInitScript: async () => {},
    goto: async () => {},
    evaluate: async (_, args) => { sessionKey = args.key; },
  };

  const sandbox = {
    module: { exports: {} },
    authGateway: gateway,
    authenticatedApi: () => {},
    expect: (v) => ({ not: { toBe: (other) => assert.notEqual(v, other) } }),
    AUTH_FILE: '/tmp/fake-auth.json',
    ENV: {
      baseURL: origin, apiURL: 'https://test.invalid/api',
      loginApiURL: 'https://login.test.invalid', user: 'admin', password: 'placeholder',
    },
    patchContextNavigation: () => {},
    patchPageNavigation: () => {},
    setTimeout,
    URL,
    Date,
    console,
  };
  vm.runInNewContext(source, sandbox, { filename: 'users.js' });
  return { page, requests, ensure: sandbox.module.exports.ensureAdministratorSession };
}

test('cachea una sesión aprobada; dos tests no provocan dos verificaciones ni login', async () => {
  const fixture = createFixture([response(200, { exito: true, sesion_valida: true })]);
  await fixture.ensure(fixture.page);
  await fixture.ensure(fixture.page);
  assert.equal(fixture.requests.gets, 1);
  assert.equal(fixture.requests.posts, 0);
});

test('403 del CDN detiene la prueba sin POST de login', async () => {
  const fixture = createFixture([response(403, '<html>Checking your browser before accessing /hcdn-cgi/jschallenge</html>', {
    'content-type': 'text/html', 'x-hcdn-request-id': 'hostinger-test',
  })]);
  await assert.rejects(fixture.ensure(fixture.page), /HOSTINGER_CDN_CHALLENGE/);
  assert.equal(fixture.requests.posts, 0);
});

test('401 de SESSION_EXPIRED renueva una sola vez y guarda sesión', async () => {
  const fixture = createFixture([response(401, { exito: false, codigo: 'SESSION_EXPIRED' })]);
  await fixture.ensure(fixture.page);
  await fixture.ensure(fixture.page);
  assert.equal(fixture.requests.gets, 1);
  assert.equal(fixture.requests.posts, 1);
  assert.equal(fixture.requests.writes, 1);
});

test('403 JSON de permisos NO fuerza login', async () => {
  const fixture = createFixture([response(403, { exito: false, codigo: 'ORIGEN_NO_PERMITIDO' })]);
  await assert.rejects(fixture.ensure(fixture.page), /ORIGEN_NO_PERMITIDO/);
  assert.equal(fixture.requests.posts, 0);
});

test('500 final no se interpreta como credenciales vencidas', async () => {
  const fixture = createFixture(Array.from({length: 3}, () => response(500, {exito: false, mensaje:'error servidor'})));
  await assert.rejects(fixture.ensure(fixture.page), /HTTP 500/);
  assert.equal(fixture.requests.posts, 0);
  assert.equal(fixture.requests.gets, 3);
});
