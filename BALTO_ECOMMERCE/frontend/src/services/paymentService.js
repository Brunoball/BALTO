import { apiGet, buildUrl, EcommerceApiError, getCsrfToken } from './apiClient';
import { baltoConfig } from '../config/baltoConfig';

/**
 * Pagos del comprador. Autorización por pedido:
 *  - cliente con sesión: cookie HttpOnly (+ CSRF en la subida);
 *  - invitado: token temporal del pedido en el encabezado X-Ecom-Pedido-Token
 *    (nunca en la URL). Se guarda solo en sessionStorage de ESTA pestaña.
 */
const TOKEN_PREFIX = `balto:ecommerce:pedido-autorizacion:${baltoConfig.tiendaDominio}:`;

export function guardarAutorizacion(numero, autorizacion) {
  if (!numero || !autorizacion?.token) return;
  try { sessionStorage.setItem(TOKEN_PREFIX + numero, JSON.stringify({ token: autorizacion.token, expira_en: autorizacion.expira_en })); } catch (_) {}
}
export function leerAutorizacion(numero) {
  try {
    const a = JSON.parse(sessionStorage.getItem(TOKEN_PREFIX + numero) || 'null');
    if (!a?.token || (a.expira_en && Date.parse(a.expira_en) <= Date.now())) return null;
    return a.token;
  } catch (_) { return null; }
}
export function borrarAutorizaciones() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(TOKEN_PREFIX)).forEach((k) => sessionStorage.removeItem(k));
  } catch (_) {}
}

const headersPara = (token) => (token ? { 'X-Ecom-Pedido-Token': token } : {});

export const metodosDisponibles = (signal) => apiGet('pagos_metodos_disponibles', {}, { signal });

export const detallePago = (numero, token, signal) => apiGet('pago_detalle_pedido', { numero }, { signal, headers: headersPara(token) });

/**
 * Sube el comprobante con FormData (multipart, sin base64) e informa el progreso.
 * No se fija Content-Type: el navegador agrega el boundary correcto.
 */
export function subirComprobante(numero, file, { token = null, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl('pago_comprobante_subir', { numero }));
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('X-Ecom-Pedido-Token', token);
    else if (getCsrfToken()) xhr.setRequestHeader('X-CSRF-Token', getCsrfToken());
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new EcommerceApiError('No se pudo conectar con el servidor de la tienda.', 'SIN_CONEXION'));
    xhr.ontimeout = xhr.onerror;
    xhr.timeout = 120000;
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* respuesta no JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data?.exito === true) resolve(data);
      else reject(new EcommerceApiError(data?.mensaje || (xhr.status === 413 ? 'El archivo es demasiado grande.' : `No pudimos subir el comprobante (${xhr.status}).`), data?.codigo || 'ERROR_API', xhr.status, data));
    };
    const fd = new FormData();
    fd.append('archivo', file, file.name);
    xhr.send(fd);
  });
}

/** Descarga privada del propio comprobante (blob, para poder enviar la autorización en el encabezado). */
export async function descargarComprobante(numero, id, token) {
  let res;
  try {
    res = await fetch(buildUrl('pago_comprobante_descargar', { numero, id }), { credentials: 'include', cache: 'no-store', headers: headersPara(token) });
  } catch (_) {
    throw new EcommerceApiError('No se pudo conectar con el servidor de la tienda.', 'SIN_CONEXION');
  }
  if (!res.ok) throw new EcommerceApiError('No pudimos descargar el comprobante.', 'DESCARGA_FALLIDA', res.status);
  return res.blob();
}
