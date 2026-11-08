import { expect } from '@playwright/test';

const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /ResizeObserver loop/i,
  /Download the React DevTools/i,
  /Failed to load resource.*404/i,
  /net::ERR_ABORTED/i,
  /Failed to load resource: net::ERR_CONNECTION_CLOSED/i,
  /Failed to load resource: net::ERR_FILE_NOT_FOUND/i,
];

// Recursos decorativos servidos por la API (logo/ícono del tenant). Un corte de
// red transitorio al cargarlos (p. ej. ERR_QUIC_PROTOCOL_ERROR) no es una falla
// funcional: se ignora igual que las imágenes .png/.jpg. Cualquier otra acción
// de la API que falle se sigue reportando.
const DECORATIVE_API_RESOURCE = /[?&]action=tenant_logo_ver(&|$)/i;
const IMAGE_URL = /\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i;
const isDecorativeResource = (url) => IMAGE_URL.test(url) || DECORATIVE_API_RESOURCE.test(url);

function ignoredConsoleMessage(text, location) {
  if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  // "Failed to load resource" no incluye la URL en el texto: se toma de location().
  return /^Failed to load resource/i.test(text) && isDecorativeResource(String(location?.url || ''));
}

export function installDiagnostics(page) {
  const state = {
    pageErrors: [],
    consoleErrors: [],
    serverErrors: [],
    failedRequests: [],
  };

  page.on('pageerror', (error) => {
    state.pageErrors.push(error.message || String(error));
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!ignoredConsoleMessage(text, message.location())) state.consoleErrors.push(text);
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status < 500) return;
    const url = response.url();
    if (isDecorativeResource(url)) return;
    state.serverErrors.push(`${status} ${url}`);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText || 'request failed';
    if (/ERR_ABORTED/i.test(failure)) return;
    if (/^blob:/i.test(url) && /ERR_FILE_NOT_FOUND/i.test(failure)) return;
    if (isDecorativeResource(url)) return;
    state.failedRequests.push(`${failure} ${url}`);
  });

  return state;
}

export async function assertNoCriticalErrors(state, testInfo, options = {}) {
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
