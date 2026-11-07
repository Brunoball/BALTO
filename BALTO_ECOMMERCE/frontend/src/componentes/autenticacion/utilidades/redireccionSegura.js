/**
 * Destino interno seguro para volver después del login. Acepta SOLO rutas
 * relativas de esta tienda ("/checkout", "/mi-cuenta/pedidos?pagina=2").
 * Rechaza URLs absolutas, protocolo relativo (//evil.com), barras invertidas,
 * esquemas (javascript:) y caracteres de control.
 */
export function safeRedirect(raw, fallback = '/mi-cuenta') {
  if (typeof raw !== 'string') return fallback;
  let v = raw.trim();
  if (!v || v.length > 512) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;
  if (!v.startsWith('/') || v.startsWith('//')) return fallback;
  try {
    const base = 'https://tienda.invalid';
    const url = new URL(v, base);
    if (url.origin !== base) return fallback;
    v = url.pathname + url.search + url.hash;
  } catch (_) {
    return fallback;
  }
  if (/^\/iniciar-sesion(\/|\?|#|$)/.test(v)) return fallback;
  return v;
}

/** URL de login que vuelve a la ubicación actual. */
export function loginPath(location) {
  const destino = safeRedirect(`${location?.pathname || '/'}${location?.search || ''}`, '/mi-cuenta');
  return `/iniciar-sesion?volver=${encodeURIComponent(destino)}`;
}
