import { expect } from '@playwright/test';

const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
  /Failed to load resource.*404/i,
  /net::ERR_ABORTED/i,
  /Failed to load resource: net::ERR_CONNECTION_CLOSED/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
  // Un 409 es una respuesta de negocio válida en varios blindajes (p. ej.
  // hard-delete bloqueado por historial). Los tests que esperan ese conflicto
  // validan el status/body explícitamente; no debe contarse además como un
  // console.error crítico genérico del navegador.
  /Failed to load resource: the server responded with a status of 409/i,
];

function ignoredConsoleMessage(text) {
  return IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

export function installDiagnostics(page) {
  const state = {
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    failedRequests: [],
    pendingResponses: [],
  };

  page.on('pageerror', (error) => {
    state.pageErrors.push(error.message || String(error));
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!ignoredConsoleMessage(text)) state.consoleErrors.push(text);
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status < 500) return;
    const url = response.url();
    if (/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(url)) return;

    // Desde el hardening de producción los 500 ya no exponen SQL/stack y
    // devuelven request_id. Capturamos también el body para que el reporte de
    // Playwright permita ubicar el error real en error_log sin volver a correr.
    const pending = response.text()
      .catch(() => '')
      .then((body) => {
        const compact = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
        state.serverErrors.push(`${status} ${url}${compact ? `\n  ${compact}` : ''}`);
      });
    state.pendingResponses.push(pending);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText || 'request failed';
    if (/ERR_ABORTED/i.test(failure)) return;
    if (/^blob:/i.test(url) && /ERR_FILE_NOT_FOUND/i.test(failure)) return;
    if (/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(url)) return;
    state.failedRequests.push(`${failure} ${url}`);
  });

  return state;
}

export async function assertNoCriticalErrors(state, testInfo, options = {}) {
  if (Array.isArray(state.pendingResponses) && state.pendingResponses.length) {
    await Promise.allSettled(state.pendingResponses);
  }

  const allowConsole = options.allowConsole || [];
  const consoleErrors = state.consoleErrors.filter(
    (message) => !allowConsole.some((pattern) => pattern.test(message))
  );

  const report = [
    state.pageErrors.length ? `PAGE ERRORS:\n${state.pageErrors.join('\n')}` : '',
    consoleErrors.length ? `CONSOLE ERRORS:\n${consoleErrors.join('\n')}` : '',
    state.serverErrors.length ? `HTTP 5XX:\n${state.serverErrors.join('\n')}` : '',
    state.failedRequests.length ? `REQUEST FAILED:\n${state.failedRequests.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (report) {
    await testInfo.attach('diagnostico-balto.txt', {
      body: Buffer.from(report, 'utf8'),
      contentType: 'text/plain',
    });
  }

  expect(state.pageErrors, 'No debe haber errores JavaScript no controlados').toEqual([]);
  expect(state.serverErrors, 'No debe haber respuestas HTTP 5xx').toEqual([]);
  expect(consoleErrors, 'No debe haber console.error relevantes').toEqual([]);
}
