const fs = require('fs');
const path = require('path');

function stripOptionalQuotes(value) {
  const text = String(value ?? '').trim();
  if (text.length < 2) return text;

  const first = text[0];
  const last = text[text.length - 1];

  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1);
  }

  return text;
}

function parseEnvText(text) {
  const result = {};

  String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;

      const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eq = normalized.indexOf('=');
      if (eq <= 0) return;

      const key = normalized.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;

      result[key] = stripOptionalQuotes(normalized.slice(eq + 1));
    });

  return result;
}

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;

  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'si', 'sí'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;

  return fallback;
}

function resolveFrontendRoot(rootDir) {
  const requested = path.resolve(rootDir || process.cwd());

  if (fs.existsSync(path.join(requested, '.env.playwright'))) return requested;

  const nestedFrontend = path.join(requested, 'frontend');
  if (fs.existsSync(path.join(nestedFrontend, '.env.playwright'))) return nestedFrontend;

  return path.resolve(__dirname, '../..');
}

function normalizePrefix(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

function deriveTarget(values) {
  const rawApiURL = String(values.PW_API_URL || '').trim().replace(/\/+$/, '');
  if (!rawApiURL) throw new Error('[Playwright] Falta PW_API_URL en .env.playwright.');

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

  const expectedPath = '/BALTO_SERVICIOS/api/routes';
  if (apiURL.pathname.replace(/\/+$/, '') !== expectedPath) {
    throw new Error(
      `[Playwright] PW_API_URL debe terminar exactamente en ${expectedPath}. Recibido: ${rawApiURL}`,
    );
  }

  const remoteOrigin = `${apiURL.protocol}//${apiURL.host}`;

  return {
    ...values,
    PW_API_URL: rawApiURL,
    PW_TEST_URL: 'http://127.0.0.1:3000',
    PW_BASE_URL: 'http://127.0.0.1:3000',
    PW_APP_PATH_PREFIX: '',
    PW_LOGIN_API_URL: `${remoteOrigin}/BALTO_LOGIN/api/routes`,
    PW_LOGIN_URL: `${remoteOrigin}/`,
    PW_START_FRONTEND: '1',
    PW_SKIP_WEBSERVER: '0',
    PW_ALLOW_PRODUCTION: isProduction ? '1' : '0',
    PW_ENVIRONMENT: isProduction ? 'production' : 'staging',
    PW_USER: 'admin_servicios',
    PW_PASSWORD: isProduction ? '@CrServicios_2026' : '1234',
  };
}

function loadTestEnv(rootDir = process.cwd()) {
  const frontendRoot = resolveFrontendRoot(rootDir);
  const baseFile = path.join(frontendRoot, '.env.playwright');

  if (!fs.existsSync(baseFile)) {
    throw new Error(`[Playwright] Falta .env.playwright en: ${baseFile}`);
  }

  const values = deriveTarget(parseEnvText(fs.readFileSync(baseFile, 'utf8')));

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = String(value);
  }

  process.env.REACT_APP_API_URL = values.PW_API_URL;
  process.env.REACT_APP_BALTO_LOGIN_URL = values.PW_LOGIN_URL;

  const required = ['PW_API_URL', 'PW_TEST_URL', 'PW_USER', 'PW_PASSWORD'];
  const missing = required.filter((key) => !String(process.env[key] || '').trim());

  if (missing.length) {
    throw new Error(`[Playwright] Faltan ${missing.join(', ')} en frontend/.env.playwright.`);
  }

  return {
    environment: process.env.PW_ENVIRONMENT || 'staging',
    testURL: String(process.env.PW_TEST_URL).trim().replace(/\/+$/, ''),
    baseURL: String(process.env.PW_BASE_URL).trim().replace(/\/+$/, ''),
    appPathPrefix: normalizePrefix(process.env.PW_APP_PATH_PREFIX),
    apiURL: String(process.env.PW_API_URL).trim().replace(/\/+$/, ''),
    loginApiURL: String(process.env.PW_LOGIN_API_URL).trim().replace(/\/+$/, ''),
    loginURL: String(process.env.PW_LOGIN_URL).trim().replace(/\/+$/, ''),
    user: process.env.PW_USER,
  };
}

module.exports = {
  envBoolean,
  loadTestEnv,
  parseEnvText,
};
