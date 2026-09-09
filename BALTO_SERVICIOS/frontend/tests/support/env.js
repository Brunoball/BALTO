import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let value = normalized.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;

  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(
    String(value).trim().toLowerCase(),
  );
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFrontendRoot() {
  const cwd = process.cwd();
  const candidates = [cwd, path.join(cwd, 'frontend')];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, '.env.playwright')) ||
      fs.existsSync(path.join(candidate, 'playwright.config.js'))
    ) {
      return candidate;
    }
  }

  return cwd;
}

function normalizePrefix(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

function isAbsoluteNavigation(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '').trim()) || String(value || '').startsWith('//');
}

function isProductionApi(apiURL) {
  try {
    const host = new URL(apiURL).hostname.toLowerCase();
    return host === 'app.balto.com.ar' || host === 'www.app.balto.com.ar';
  } catch {
    return false;
  }
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

  const expectedPath = '/BALTO_SERVICIOS/api/routes';
  if (apiURL.pathname.replace(/\/+$/, '') !== expectedPath) {
    throw new Error(
      `[Playwright] PW_API_URL debe terminar exactamente en ${expectedPath}. Recibido: ${rawApiURL}`,
    );
  }

  const remoteOrigin = `${apiURL.protocol}//${apiURL.host}`;

  return {
    ...values,
    // El único selector manual es PW_API_URL. Todo lo demás se deriva.
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

const root = resolveFrontendRoot();
const envFile = path.join(root, '.env.playwright');

if (!fs.existsSync(envFile)) {
  console.error('Falta .env.playwright en:', envFile);
  process.exit(1);
}

const values = deriveTarget(parseEnvFile(envFile));

// .env.playwright es la única fuente de verdad del testing. PW_API_URL selecciona todo.
for (const [key, value] of Object.entries(values)) {
  process.env[key] = value;
}

if (process.env.PW_API_URL) {
  process.env.REACT_APP_API_URL = process.env.PW_API_URL;
}
if (process.env.PW_LOGIN_URL) {
  process.env.REACT_APP_BALTO_LOGIN_URL = process.env.PW_LOGIN_URL;
}

const startFrontend = bool(process.env.PW_START_FRONTEND, true);
const appPathPrefix = normalizePrefix(process.env.PW_APP_PATH_PREFIX);
const loginApiURL = String(process.env.PW_LOGIN_API_URL || '').trim().replace(/\/+$/, '');
const loginURL = String(process.env.PW_LOGIN_URL || '').trim().replace(/\/+$/, '');

export const ENV = Object.freeze({
  profileFile: envFile,
  testURL: String(process.env.PW_TEST_URL || '').trim().replace(/\/+$/, ''),

  // En local baseURL apunta al dev-server. En ejecución publicada apunta sólo al
  // ORIGIN (ej. https://app.balto.com.ar) y appPathPrefix agrega /BALTO_SERVICIOS.
  baseURL: String(process.env.PW_BASE_URL || 'http://127.0.0.1:3000').trim().replace(/\/+$/, ''),
  appPathPrefix,
  apiURL: String(process.env.PW_API_URL || '').trim().replace(/\/+$/, ''),
  loginApiURL,
  loginURL,

  user: String(process.env.PW_USER || '').trim(),
  password: String(process.env.PW_PASSWORD || ''),

  allowMutations: bool(process.env.PW_ALLOW_MUTATIONS, false),
  allowProduction: bool(process.env.PW_ALLOW_PRODUCTION, false),
  allowArca: bool(process.env.PW_ALLOW_ARCA, false),

  arcaClientName: String(process.env.PW_ARCA_CLIENT_NAME || '').trim(),
  arcaClientCuit: String(process.env.PW_ARCA_CLIENT_CUIT || '').replace(/\D/g, ''),

  expectedTenantId: String(process.env.PW_EXPECTED_TENANT_ID || '').trim(),
  expectedTenantName: String(process.env.PW_EXPECTED_TENANT_NAME || '').trim(),
  expectedSystem: String(process.env.PW_EXPECTED_SYSTEM || 'SERVICIOS').trim().toUpperCase(),

  startFrontend,
  startBackend: bool(process.env.PW_START_BACKEND, false),
  skipWebServer: bool(process.env.PW_SKIP_WEBSERVER, !startFrontend),

  startCommand: String(process.env.PW_START_COMMAND || 'npm start').trim(),

  cleanup: bool(process.env.PW_CLEANUP, true),
  timeoutMs: integer(process.env.PW_TIMEOUT_MS, 60_000),
  expectTimeoutMs: integer(process.env.PW_EXPECT_TIMEOUT_MS, 15_000),
  slowMoMs: integer(process.env.PW_SLOW_MO_MS, 0),

  runLabel: String(process.env.PW_RUN_LABEL || '').trim(),
});

export const AUTH_FILE = path.join(root, 'tests', '.auth', 'user.json');

export function resolveAppURL(target) {
  const value = String(target ?? '').trim();
  if (!value || !ENV.appPathPrefix || isAbsoluteNavigation(value)) return target;

  const [pathAndQuery, hash = ''] = value.split('#', 2);
  const queryAt = pathAndQuery.indexOf('?');
  const pathname = queryAt >= 0 ? pathAndQuery.slice(0, queryAt) : pathAndQuery;
  const query = queryAt >= 0 ? pathAndQuery.slice(queryAt) : '';

  let normalizedPath = pathname || '/';
  if (!normalizedPath.startsWith('/')) normalizedPath = `/${normalizedPath}`;

  if (
    normalizedPath === ENV.appPathPrefix ||
    normalizedPath.startsWith(`${ENV.appPathPrefix}/`)
  ) {
    return `${normalizedPath}${query}${hash ? `#${hash}` : ''}`;
  }

  const suffix = normalizedPath === '/' ? '/' : normalizedPath;
  return `${ENV.appPathPrefix}${suffix}${query}${hash ? `#${hash}` : ''}`;
}

export function stripAppPathPrefix(value) {
  const text = String(value || '');
  if (!ENV.appPathPrefix) return text;
  if (text === ENV.appPathPrefix) return '/';
  if (text.startsWith(`${ENV.appPathPrefix}/`)) {
    return text.slice(ENV.appPathPrefix.length) || '/';
  }
  return text;
}

export function patchPageNavigation(page) {
  if (!page || page.__baltoNavigationPatched) return page;

  const originalGoto = page.goto.bind(page);
  Object.defineProperty(page, '__baltoNavigationPatched', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  page.goto = (target, options) => originalGoto(resolveAppURL(target), options);
  return page;
}

export function patchContextNavigation(context) {
  if (!context || context.__baltoNavigationPatched) return context;

  Object.defineProperty(context, '__baltoNavigationPatched', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  for (const page of context.pages()) patchPageNavigation(page);
  context.on('page', (page) => patchPageNavigation(page));
  return context;
}

export function assertCredentialsConfigured() {
  const missing = [];
  if (!ENV.testURL) missing.push('PW_TEST_URL');
  if (!ENV.user) missing.push('PW_USER');
  if (!ENV.password) missing.push('PW_PASSWORD');
  if (!ENV.apiURL) missing.push('PW_API_URL (derivada)');
  if (!ENV.loginApiURL) missing.push('PW_LOGIN_API_URL (derivada)');
  if (!ENV.loginURL) missing.push('PW_LOGIN_URL (derivada)');

  if (missing.length) {
    throw new Error(`Faltan ${missing.join(', ')} en frontend/.env.playwright.`);
  }
}

export function assertSafeMutationConfiguration() {
  if (!ENV.allowMutations) {
    throw new Error(
      'Las pruebas mutables requieren PW_ALLOW_MUTATIONS=1 en .env.playwright.',
    );
  }

  if (isProductionApi(ENV.apiURL) && !ENV.allowProduction) {
    throw new Error(
      'Bloqueado: el destino derivado apunta a producción sin habilitación. Revisá PW_API_URL en .env.playwright.',
    );
  }
}

function normalizeTenantName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function assertExpectedTenant(tenant) {
  if (!tenant || typeof tenant !== 'object') return;

  const realId = String(
    tenant.id ??
    tenant.tenant_id ??
    tenant.id_tenant ??
    tenant.idTenant ??
    '',
  ).trim();

  const realName = String(
    tenant.nombre ??
    tenant.name ??
    tenant.razon_social ??
    tenant.tenant ??
    '',
  ).trim();

  if (ENV.expectedTenantId && realId && realId !== ENV.expectedTenantId) {
    throw new Error(
      `Tenant incorrecto. Esperado ID ${ENV.expectedTenantId}; recibido ${realId}.`,
    );
  }

  if (
    ENV.expectedTenantName &&
    realName &&
    normalizeTenantName(realName) !== normalizeTenantName(ENV.expectedTenantName)
  ) {
    throw new Error(
      `Tenant incorrecto. Esperado "${ENV.expectedTenantName}"; recibido "${realName}".`,
    );
  }
}
