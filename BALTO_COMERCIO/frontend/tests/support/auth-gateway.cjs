'use strict';

// Respuestas de la capa CDN y de la API de Balto deben tratarse distinto.
// No intentamos resolver retos antibot de Hostinger ni reintentar logins ante 403.
const CHALLENGE_MARKERS = [
  /\/hcdn-cgi\/jschallenge/i,
  /checking your browser before accessing/i,
  /just a moment\.\.\./i,
];

function isHostingerChallenge(status, headers, body) {
  const code = Number(status);
  const html = String(body || '');
  const contentType = String(headers?.['content-type'] || '').toLowerCase();
  if (![403, 429, 503].includes(code)) return false;
  const explicitChallenge = CHALLENGE_MARKERS.some((pattern) => pattern.test(html));
  const hostingerHeader = Object.keys(headers || {}).some((key) => /^x-hcdn-/i.test(key));
  return explicitChallenge || (hostingerHeader && contentType.includes('text/html'));
}

function requestId(headers) {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === 'x-hcdn-request-id');
  return entry ? String(entry[1]).trim() : '';
}

function makeGatewayError(label, status, headers) {
  const id = requestId(headers);
  const message = `[HOSTINGER_CDN_CHALLENGE] ${label} recibió HTTP ${status}: ` +
    'Hostinger respondió con una verificación antibot en lugar de JSON. ' +
    'La prueba se interrumpe sin volver a iniciar sesión; revisar CDN o usar un entorno E2E autorizado.' +
    (id ? ` x-hcdn-request-id=${id}` : '');
  const error = new Error(message);
  error.code = 'HOSTINGER_CDN_CHALLENGE';
  error.status = status;
  return error;
}

async function readAuthResponse(response, label) {
  const status = response.status();
  const headers = response.headers();
  const text = await response.text();
  if (isHostingerChallenge(status, headers, text)) {
    throw makeGatewayError(label, status, headers);
  }

  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Respuesta no JSON (proxy/CDN/app): NO se interpreta como sesión vencida.
  }
  const validJson = body !== null && typeof body === 'object' && !Array.isArray(body);
  return { status, body: validJson ? body : {}, validJson, requestId: requestId(headers) };
}

function requireJson(info, label) {
  if (info.validJson) return info.body;
  throw new Error(
    `[AUTH_NON_JSON] ${label} devolvió HTTP ${info.status}, pero no devolvió JSON válido. ` +
    'No se renueva la sesión a ciegas; revisar API, CDN y logs.' +
    (info.requestId ? ` x-hcdn-request-id=${info.requestId}` : ''),
  );
}

function authHttpError(label, info) {
  const body = info.body || {};
  const code = String(body.codigo || body.code || '').slice(0, 100);
  const message = String(body.mensaje || body.message || '').slice(0, 180);
  return new Error(
    `${label} respondió HTTP ${info.status}` +
    (code ? ` (${code})` : '') +
    (message ? `: ${message}` : '') +
    (info.requestId ? ` [x-hcdn-request-id=${info.requestId}]` : ''),
  );
}

module.exports = { isHostingerChallenge, readAuthResponse, requireJson, authHttpError };
