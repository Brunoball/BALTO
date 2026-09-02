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

  if (fs.existsSync(path.join(requested, '.env.playwright'))) {
    return requested;
  }

  const nestedFrontend = path.join(requested, 'frontend');
  if (fs.existsSync(path.join(nestedFrontend, '.env.playwright'))) {
    return nestedFrontend;
  }

  // Fallback estable calculado desde tests/helpers/env.helper.js.
  return path.resolve(__dirname, '../..');
}

function loadTestEnv(rootDir = process.cwd()) {
  const frontendRoot = resolveFrontendRoot(rootDir);
  const baseFile = path.join(frontendRoot, '.env.playwright');

  if (!fs.existsSync(baseFile)) {
    throw new Error(`[Playwright] Falta .env.playwright en: ${baseFile}`);
  }

  const baseValues = parseEnvText(fs.readFileSync(baseFile, 'utf8'));

  for (const [key, value] of Object.entries(baseValues)) {
    process.env[key] = String(value);
  }

  if (process.env.PW_API_URL) {
    process.env.REACT_APP_API_URL = process.env.PW_API_URL;
  }

  const required = ['PW_BASE_URL', 'PW_API_URL', 'PW_USER', 'PW_PASSWORD'];
  const missing = required.filter((key) => !String(process.env[key] || '').trim());

  if (missing.length) {
    throw new Error(
      `[Playwright] Faltan ${missing.join(', ')} en frontend/.env.playwright.`,
    );
  }

  let environment = 'staging';
  try {
    const host = new URL(process.env.PW_API_URL).hostname.toLowerCase();
    if (host === 'app.balto.com.ar' || host === 'www.app.balto.com.ar') {
      environment = 'production';
    }
  } catch {
    environment = 'staging';
  }

  return {
    environment,
    baseURL: process.env.PW_BASE_URL,
    apiURL: process.env.PW_API_URL,
    user: process.env.PW_USER,
  };
}

module.exports = {
  envBoolean,
  loadTestEnv,
  parseEnvText,
};
