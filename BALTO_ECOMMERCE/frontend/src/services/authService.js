import { apiGet, apiPost, setCsrfToken } from './apiClient';

/** Sesión de comprador. El token de sesión vive en una cookie HttpOnly: JavaScript nunca lo ve. */
export async function consultarSesion(signal) {
  const data = await apiGet('auth_sesion', {}, { signal });
  setCsrfToken(data.autenticado ? data.csrf : null);
  return data;
}

/** Nonce de un solo uso (el servidor lo liga a este navegador con una cookie HttpOnly). */
export const obtenerNonce = (signal) => apiGet('auth_nonce', {}, { signal });

/** Envía SOLO la credencial (ID token) de Google: el servidor la verifica criptográficamente. */
export async function loginGoogle(credential) {
  const data = await apiPost('auth_google', { credential });
  setCsrfToken(data.csrf);
  return data;
}

export async function cerrarSesion({ todas = false } = {}) {
  try {
    return await apiPost('auth_logout', todas ? { todas: true } : {});
  } finally {
    setCsrfToken(null);
  }
}
