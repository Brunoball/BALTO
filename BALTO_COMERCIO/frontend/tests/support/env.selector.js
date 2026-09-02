import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compatibilidad temporal con configuraciones que todavía importan env.selector.js.
// Ya NO existe selector STOCK/SERVICIOS/PRODUCCION.
// Todo sale directamente de frontend/.env.playwright.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '../..');
const envFile = path.join(frontendRoot, '.env.playwright');

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

if (!fs.existsSync(envFile)) {
  throw new Error(`[Playwright] Falta .env.playwright en: ${envFile}`);
}

const values = parseEnv(fs.readFileSync(envFile, 'utf8'));

for (const [key, value] of Object.entries(values)) {
  process.env[key] = String(value);
}

if (process.env.PW_API_URL) {
  process.env.REACT_APP_API_URL = process.env.PW_API_URL;
}
