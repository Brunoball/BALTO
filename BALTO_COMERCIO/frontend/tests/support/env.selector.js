import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Selector único de entorno para Playwright.
// En .env.playwright sólo se cambia PW_API_URL.
// El resto de URLs y banderas se calculan automáticamente acá.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');
const envFile = path.join(frontendRoot, '.env.playwright');

function syncCentralConfigBeforePlaywright() {
  if (process.env.BALTO_PW_CONFIG_SYNCED === '1') return;

  const candidates = [
    path.resolve(frontendRoot, '../../BALTO_CONFIG/sync-env.cjs'),
    path.resolve(frontendRoot, '../BALTO_CONFIG/sync-env.cjs'),
  ];
  const syncScript = candidates.find((file) => fs.existsSync(file));
  if (!syncScript) return;

  const result = spawnSync(process.execPath, [syncScript, '--quiet'], {
    cwd: path.dirname(syncScript),
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`[Playwright] No se pudo ejecutar BALTO_CONFIG/sync-env.cjs: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(
      `[Playwright] BALTO_CONFIG/sync-env.cjs terminó con código ${result.status}.` +
      (detail ? ` ${detail}` : ''),
    );
  }

  process.env.BALTO_PW_CONFIG_SYNCED = '1';
}

function applyFrontendRuntimeEnv(values) {
  const origin = new URL(values.PW_API_URL).origin;
  process.env.REACT_APP_BALTO_ORIGIN = origin;
  process.env.REACT_APP_API_URL = values.PW_API_URL;
  process.env.REACT_APP_BALTO_LOGIN_URL = values.PW_LOGIN_URL;
  process.env.REACT_APP_BALTO_ACCESS_URL = values.PW_LOGIN_URL;
  process.env.REACT_APP_ROUTER_BASENAME = '/';
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function parseEnv(text) {
  const values = {};

  String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;

      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const equalsAt = normalized.indexOf('=');
      if (equalsAt <= 0) return;

      const key = normalized.slice(0, equalsAt).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;

      values[key] = unquote(normalized.slice(equalsAt + 1));
    });

  return values;
}

function resolveTargetCredentials(values, isProduction) {
  const user = String(
    (isProduction ? values.PW_PRODUCTION_USER : values.PW_STAGING_USER) ||
    values.PW_USER ||
    (isProduction ? '' : 'admin'),
  ).trim();
  const password = String(
    (isProduction ? values.PW_PRODUCTION_PASSWORD : values.PW_STAGING_PASSWORD) ||
    values.PW_PASSWORD ||
    (isProduction ? '' : '1234'),
  );
  return { user, password };
}

function deriveTarget(values) {
  const rawApiURL = String(values.PW_API_URL || '').trim().replace(/\/+$/, '');
  if (!rawApiURL) {
    throw new Error('[Playwright] Falta PW_API_URL en .env.playwright.');
  }

  let apiURL;
  try {
    apiURL = new URL(rawApiURL);
  } catch {
    throw new Error(`[Playwright] PW_API_URL inválida: ${rawApiURL}`);
  }

  const host = apiURL.hostname.toLowerCase();
  const isStaging = host === 'balto.3devsnet.com';
  const isProduction = host === 'app.balto.com.ar' || host === 'www.app.balto.com.ar';

  if (!isStaging && !isProduction) {
    throw new Error(
      `[Playwright] Host no permitido en PW_API_URL: ${host}. ` +
      'Usá balto.3devsnet.com o app.balto.com.ar.',
    );
  }

  const expectedPath = '/BALTO_COMERCIO/api/routes';
  if (apiURL.pathname.replace(/\/+$/, '') !== expectedPath) {
    throw new Error(
      `[Playwright] PW_API_URL debe terminar exactamente en ${expectedPath}. Recibido: ${rawApiURL}`,
    );
  }

  const remoteOrigin = `${apiURL.protocol}//${apiURL.host}`;
  const credentials = resolveTargetCredentials(values, isProduction);

  return {
    ...values,
    // BALTO_CONFIG cambia PW_API_URL. Permisos y credenciales permanecen
    // explícitos en .env.playwright y se seleccionan según el host destino.
    PW_API_URL: rawApiURL,
    PW_TEST_URL: 'http://127.0.0.1:3000',
    PW_BASE_URL: 'http://127.0.0.1:3000',
    PW_APP_PATH_PREFIX: '',
    PW_LOGIN_API_URL: `${remoteOrigin}/BALTO_LOGIN/api/routes`,
    PW_LOGIN_URL: `${remoteOrigin}/`,
    PW_START_FRONTEND: '1',
    PW_SKIP_WEBSERVER: '0',
    PW_ALLOW_PRODUCTION: String(values.PW_ALLOW_PRODUCTION || '0'),
    PW_ENVIRONMENT: isProduction ? 'production' : 'staging',
    PW_USER: credentials.user,
    PW_PASSWORD: credentials.password,
  };
}

syncCentralConfigBeforePlaywright();

if (!fs.existsSync(envFile)) {
  throw new Error(`[Playwright] Falta .env.playwright en: ${envFile}`);
}

const values = deriveTarget(parseEnv(fs.readFileSync(envFile, 'utf8')));

for (const [key, value] of Object.entries(values)) {
  process.env[key] = String(value);
}

applyFrontendRuntimeEnv(values);
