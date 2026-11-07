import { baltoConfig, validarConfiguracion } from '../configuracion/baltoConfig';

export class EcommerceApiError extends Error {
  constructor(message, codigo = 'ERROR_API', status = 0, datos = null) {
    super(message);
    this.name = 'EcommerceApiError';
    this.codigo = codigo;
    this.status = status;
    /** Cuerpo completo del error (errores por campo, líneas actualizadas, etc.). */
    this.datos = datos;
  }
}

/**
 * Acciones que usan la cookie de sesión del comprador (HttpOnly, la maneja el
 * navegador). SOLO estas viajan con `credentials: 'include'`; el catálogo, el
 * carrito y la geografía siguen siendo públicos y sin cookies.
 * Debe coincidir con EC_ACCIONES_CON_CREDENCIALES en rutas/api.php.
 */
export const ACCIONES_CON_SESION = new Set([
  'checkout_crear', 'auth_nonce', 'auth_google', 'auth_sesion', 'auth_logout',
  'cliente_perfil', 'cliente_actualizar', 'cliente_direcciones', 'cliente_direccion_guardar',
  'cliente_direccion_eliminar', 'cliente_direccion_predeterminada', 'cliente_pedidos', 'cliente_pedido_detalle',
  'pago_detalle_pedido', 'pago_comprobante_estado', 'pago_comprobante_subir', 'pago_comprobante_descargar',
]);

// Token CSRF de la sesión: SOLO en memoria (nunca localStorage/sessionStorage).
// Lo entrega el servidor en auth_sesion / auth_google y se reenvía en X-CSRF-Token.
let csrfToken = null;
export function setCsrfToken(token) { csrfToken = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : null; }
export function getCsrfToken() { return csrfToken; }

// Aviso global cuando el servidor informa que la sesión ya no es válida.
const sesionListeners = new Set();
export function onSesionInvalida(fn) { sesionListeners.add(fn); return () => sesionListeners.delete(fn); }
const CODIGOS_SESION_INVALIDA = new Set(['SESION_REQUERIDA', 'SESION_EXPIRADA']);

export function buildUrl(action, params = {}) {
  validarConfiguracion();
  const url = new URL(baltoConfig.apiUrl, window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('tienda', baltoConfig.tiendaDominio);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request(url, init, signal, conSesion) {
  let response;
  try {
    response = await fetch(url, { ...init, credentials: conSesion ? 'include' : 'omit', cache: 'no-store', signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new EcommerceApiError('No se pudo conectar con el servidor de la tienda.', 'SIN_CONEXION');
  }
  let data;
  try {
    data = await response.json();
  } catch (_) {
    throw new EcommerceApiError('El servidor no devolvió un JSON válido.', 'RESPUESTA_INVALIDA', response.status);
  }
  if (!response.ok || data?.exito !== true) {
    const err = new EcommerceApiError(
      data?.mensaje || `Error al consultar la tienda (${response.status}).`,
      data?.codigo || 'ERROR_API',
      response.status,
      data && typeof data === 'object' ? data : null
    );
    if (process.env.NODE_ENV === 'development') {
      // Solo en `npm start`: deja el codigo del servidor a la vista en la consola.
      // eslint-disable-next-line no-console
      console.warn(`[ecom-api] ${new URL(url).searchParams.get('action')} -> ${response.status} ${err.codigo}: ${err.message}`);
      if (err.codigo === 'ORIGEN_REQUERIDO') {
        // eslint-disable-next-line no-console
        console.warn('[ecom-api] El proxy de desarrollo no envió Origin: cerrá `npm start` y volvé a iniciarlo (setupProxy.js solo se carga al arrancar).');
      }
    }
    if (conSesion && response.status === 401 && CODIGOS_SESION_INVALIDA.has(err.codigo)) {
      csrfToken = null;
      sesionListeners.forEach((fn) => { try { fn(err); } catch (_) {} });
    }
    throw err;
  }
  return data;
}

/**
 * En local /ecom-api se proxya a Hostinger desde CRA (sin CORS, ver setupProxy.js).
 * En producción se consulta la API central (o el proxy de mismo origen en dominios propios).
 */
export function apiGet(action, params = {}, options = {}) {
  return request(buildUrl(action, params), { method: 'GET', headers: { Accept: 'application/json', ...(options.headers || {}) } }, options.signal, ACCIONES_CON_SESION.has(action));
}

/** POST JSON. Las acciones con sesión agregan el token CSRF en memoria. */
export function apiPost(action, body, options = {}) {
  const conSesion = ACCIONES_CON_SESION.has(action);
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (conSesion && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return request(buildUrl(action), {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  }, options.signal, conSesion);
}
