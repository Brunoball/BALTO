import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let value = line.slice(eq + 1).trim();

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

  return ['1', 'true', 'yes', 'si', 'sÃ­', 'on'].includes(
    String(value).trim().toLowerCase(),
  );
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveFrontendRoot() {
  const cwd = process.cwd();

  const candidates = [
    cwd,
    path.join(cwd, 'frontend'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'playwright.config.js'))) {
      return candidate;
    }
  }

  return cwd;
}

function isProductionApi(apiURL) {
  try {
    const host = new URL(apiURL).hostname.toLowerCase();
    return host === 'app.balto.com.ar' || host === 'www.app.balto.com.ar';
  } catch {
    return false;
  }
}

const root = resolveFrontendRoot();
const envFile = path.join(root, '.env.playwright');

if (!fs.existsSync(envFile)) {
  console.error("Falta .env.playwright en:", envFile);
  process.exit(1);
}

const values = parseEnvFile(envFile);

// .env.playwright es la Ãºnica fuente de verdad del testing.
for (const [key, value] of Object.entries(values)) {
  process.env[key] = value;
}

if (process.env.PW_API_URL) {
  process.env.REACT_APP_API_URL = process.env.PW_API_URL;
}

const startFrontend = bool(process.env.PW_START_FRONTEND, true);

export const ENV = Object.freeze({
  profileFile: envFile,

  baseURL: String(process.env.PW_BASE_URL || 'http://127.0.0.1:3000').trim(),
  apiURL: String(
    process.env.PW_API_URL || 'https://balto.3devsnet.com/api/routes',
  ).trim(),

  user: String(process.env.PW_USER || '').trim(),
  password: String(process.env.PW_PASSWORD || ''),

  allowMutations: bool(process.env.PW_ALLOW_MUTATIONS, false),
  allowProduction: bool(process.env.PW_ALLOW_PRODUCTION, false),
  allowArca: bool(process.env.PW_ALLOW_ARCA, false),

  arcaClientName: String(process.env.PW_ARCA_CLIENT_NAME || '').trim(),
  arcaClientCuit: String(process.env.PW_ARCA_CLIENT_CUIT || '').replace(/\D/g, ''),

  expectedTenantId: String(process.env.PW_EXPECTED_TENANT_ID || '').trim(),
  expectedTenantName: String(process.env.PW_EXPECTED_TENANT_NAME || '').trim(),

  startFrontend,
  startBackend: bool(process.env.PW_START_BACKEND, false),
  skipWebServer: bool(process.env.PW_SKIP_WEBSERVER, !startFrontend),

  startCommand: String(process.env.PW_START_COMMAND || 'npm start').trim(),

  cleanup: bool(process.env.PW_CLEANUP, true),
  skipTiendaNube: bool(process.env.PW_SKIP_TIENDA_NUBE, true),

  timeoutMs: integer(process.env.PW_TIMEOUT_MS, 60_000),
  expectTimeoutMs: integer(process.env.PW_EXPECT_TIMEOUT_MS, 15_000),
  slowMoMs: integer(process.env.PW_SLOW_MO_MS, 0),

  runLabel: String(process.env.PW_RUN_LABEL || '').trim(),
});

export const AUTH_FILE = path.join(root, 'tests', '.auth', 'user.json');

export function assertCredentialsConfigured() {
  if (!ENV.user || !ENV.password) {
    throw new Error(
      'Faltan PW_USER o PW_PASSWORD en frontend/.env.playwright.',
    );
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
      'Bloqueado: PW_API_URL apunta a producciÃ³n y PW_ALLOW_PRODUCTION no estÃ¡ habilitado.',
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
