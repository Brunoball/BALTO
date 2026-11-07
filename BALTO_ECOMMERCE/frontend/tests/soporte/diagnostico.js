// Diagnóstico automático de cada página (equivalente a support/diagnostics.js de Comercio):
// errores de JavaScript, respuestas 5xx de la API y respuestas no-JSON de /ecom-api.
// Los recursos externos (fuentes, Google) no cuentan: dependen de la red del equipo.
const EXTERNOS = /fonts\.googleapis|fonts\.gstatic|accounts\.google\.com|gstatic\.com|googleusercontent|r2\.cloudflarestorage|r2\.dev/i;

function instalarDiagnostico(page) {
  const d = { errores: [], api5xx: [], noJson: [], consola: [] };
  page.on('pageerror', (e) => d.errores.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (EXTERNOS.test(t) || /Failed to load resource|ERR_|net::/i.test(t)) return;
    d.consola.push(t);
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/ecom-api')) return;
    if (res.status() >= 500) d.api5xx.push(`${res.status()} ${new URL(url).searchParams.get('action')}`);
    const ct = res.headers()['content-type'] || '';
    const action = new URL(url).searchParams.get('action');
    if (res.status() !== 204 && res.status() < 300 && action !== 'pago_comprobante_descargar' && action !== 'producto_imagen' && !ct.includes('application/json')) {
      d.noJson.push(`${action} -> ${ct}`);
    }
  });
  return d;
}

function problemasCriticos(d, { permitirApi5xx = false, permitirConsola = [] } = {}) {
  const p = [];
  if (d.errores.length) p.push(`Errores de JavaScript: ${d.errores.join(' | ')}`);
  if (!permitirApi5xx && d.api5xx.length) p.push(`La API respondió 5xx: ${d.api5xx.join(', ')}`);
  if (d.noJson.length) p.push(`Respuestas sin JSON en /ecom-api: ${d.noJson.join(', ')}`);
  const consola = d.consola.filter((t) => !permitirConsola.some((re) => re.test(t)));
  if (consola.length) p.push(`Errores de consola: ${consola.join(' | ')}`);
  return p;
}

module.exports = { instalarDiagnostico, problemasCriticos, EXTERNOS };
