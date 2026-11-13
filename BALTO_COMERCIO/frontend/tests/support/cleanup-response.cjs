'use strict';

const { isHostingerChallenge } = require('./auth-gateway.cjs');

function requestId(headers = {}) {
  const item = Object.entries(headers).find(([key]) => key.toLowerCase() === 'x-hcdn-request-id');
  return item ? String(item[1] || '').trim().slice(0, 160) : '';
}

function normalizeCleanupResponse(status, bodyText, headers = {}) {
  const code = Number(status || 0);
  const htmlOrJson = String(bodyText || '');
  let body = null;
  let validJson = false;
  try {
    const parsed = JSON.parse(htmlOrJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed;
      validJson = true;
    }
  } catch {
    // HTML/texto del CDN o una respuesta rota. Nunca se considera éxito.
  }
  return {
    status: code,
    ok: code >= 200 && code < 300,
    body,
    validJson,
    challenge: isHostingerChallenge(code, headers, htmlOrJson),
    requestId: requestId(headers),
  };
}

function describeCleanupFailure(result, phase) {
  const prefix = `[Playwright cleanup] ${phase}:`;
  const id = result.requestId ? ` x-hcdn-request-id=${result.requestId}` : '';
  if (result.challenge) {
    return `[HOSTINGER_CDN_CHALLENGE] ${prefix} HTTP ${result.status}. ` +
      'El CDN devolvió un desafío antibot, no una respuesta de la API. ' +
      'La limpieza NO está confirmada. No se vuelve a intentar inmediatamente el 403. ' +
      'Cuando se normalice el acceso, ejecutar node tests/cleanup-now.mjs en el tenant E2E autorizado.' + id;
  }
  if (!result.validJson) {
    return `${prefix} HTTP ${result.status}: respuesta no JSON de la API/CDN. ` +
      'Limpieza NO confirmada; revisar servidor y ejecutar limpieza manual segura.' + id;
  }
  const code = String(result.body?.codigo || result.body?.code || '').slice(0, 80);
  const message = String(result.body?.mensaje || result.body?.message || '').slice(0, 220);
  return `${prefix} HTTP ${result.status}` +
    (code ? ` (${code})` : '') + (message ? `: ${message}` : '') + id;
}

function assertCleanupEnvelope(result, phase) {
  if (result.challenge || !result.ok || !result.validJson || result.body?.exito !== true) {
    throw new Error(describeCleanupFailure(result, phase));
  }
  const remaining = result.body?.restantes_total;
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new Error(
      `[Playwright cleanup] ${phase}: JSON inválido: falta restantes_total como entero no negativo. ` +
      'No se declara limpieza exitosa sin confirmación del backend.',
    );
  }
  return result.body;
}

module.exports = { normalizeCleanupResponse, describeCleanupFailure, assertCleanupEnvelope };
