'use strict';

/**
 * Cerrojo local de la suite Playwright. Nunca debe cursarse una emisión fiscal
 * real por accidente. Esto NO sustituye el bloqueo E2E del backend: el runner
 * puede controlar browser/context routes, pero no las solicitudes desde PHP.
 */
const BLOCKED_ACTIONS = new Set([
  'wsfe_emitir', 'wsfe_nc_emitir', 'arca_wsfe_emitir',
  'factura_emitir', 'facturas_emitir', 'facturacion_emitir',
  'factura_electronica_emitir', 'comprobante_emitir',
  'nota_credito_fiscal_emitir', 'nota_credito_arca_emitir',
]);
const FISCAL_ROOT = /(?:^|_)(?:wsfe|arca|afip)(?:_|$)/;
const FISCAL_WRITE = /(?:^|_)(?:emitir|emision|facturar|facturacion|autorizar|autorizacion|crear|registrar|generar|anular|cancelar|confirmar|cae|nota_credito|nc)(?:_|$)/;
const INVOICE_WRITE = /(?:^|_)(?:factura|facturas|comprobante|comprobantes|nota_credito_fiscal)(?:_|$).*(?:^|_)(?:emitir|autorizar|generar|anular)(?:_|$)/;

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function actionFromRequest(url, body) {
  let parsed;
  try { parsed = new URL(url); } catch { return ''; }
  const action = parsed.searchParams.get('action') || '';
  if (action) return normalized(action);
  if (body && typeof body === 'object') return normalized(body.action);
  if (typeof body === 'string') {
    try {
      const data = JSON.parse(body);
      if (data && typeof data.action === 'string') return normalized(data.action);
    } catch {}
    try { return normalized(new URLSearchParams(body).get('action')); } catch {}
  }
  return '';
}

function isBlockedFiscalRequest({ url, method = 'GET', body = null }) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  const path = decodeURIComponent(parsed.pathname).toLowerCase();
  // Un PHP de emisión invocado por GET también es inseguro.
  if (/(?:^|\/)(?:wsfe|arca|afip)[\w-]*(?:emitir|emision|facturar|autorizar|anular|nota.credito)[\w-]*\.php$/.test(path) ||
      /(?:^|\/)(?:wsfe_emitir|factura_emitir)\.php$/.test(path)) return true;

  const action = actionFromRequest(url, body);
  if (BLOCKED_ACTIONS.has(action)) return true;
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase());
  // Endpoints fiscales directos, aunque el nombre de la acción venga en otro campo.
  if (isWrite && /(?:^|\/)(?:wsfe|arca|afip)[\w-]*\.php$/.test(path)) return true;
  return isWrite && ((FISCAL_ROOT.test(action) && FISCAL_WRITE.test(action)) || INVOICE_WRITE.test(action));
}

module.exports = { actionFromRequest, isBlockedFiscalRequest };
