import { baltoConfig, validarConfiguracion } from '../config/baltoConfig';

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

function buildUrl(action, params = {}) {
  validarConfiguracion();
  const url = new URL(baltoConfig.apiUrl, window.location.href);
  url.searchParams.set('action', action);
  url.searchParams.set('tienda', baltoConfig.tiendaDominio);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request(url, init, signal) {
  let response;
  try {
    response = await fetch(url, { ...init, credentials: 'omit', cache: 'no-store', signal });
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
    throw new EcommerceApiError(
      data?.mensaje || `Error al consultar la tienda (${response.status}).`,
      data?.codigo || 'ERROR_API',
      response.status,
      data && typeof data === 'object' ? data : null
    );
  }
  return data;
}

/**
 * En local /ecom-api se proxya a Hostinger desde CRA (sin CORS, ver setupProxy.js).
 * En producción se consulta la API central; la tienda la resuelve el servidor.
 */
export function apiGet(action, params = {}, options = {}) {
  return request(buildUrl(action, params), { method: 'GET', headers: { Accept: 'application/json' } }, options.signal);
}

/** POST JSON (validación de carrito y checkout). Nunca se envían credenciales ni cookies. */
export function apiPost(action, body, options = {}) {
  return request(buildUrl(action), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }, options.signal);
}
