/**
 * CRA development only (react-scripts start).
 * /ecom-api?action=... -> BALTO_ORIGIN/BALTO_ECOMMERCE/api/index.php?action=...
 * De esta forma localhost no necesita CORS ni acceso directo a MySQL.
 * Las peticiones son del MISMO origen (localhost), asi que la cookie de sesion del
 * comprador funciona sin cookies de terceros (ver apiCookieToDev / devCookiesToApi).
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  const origin = String(process.env.REACT_APP_BALTO_ORIGIN || '').trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    throw new Error('BALTO_CONFIG debe generar REACT_APP_BALTO_ORIGIN (ej: https://balto.3devsnet.com).');
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('REACT_APP_BALTO_ORIGIN debe ser una URL de origen sin rutas.');
  }
  if (/localhost|127\.0\.0\.1/.test(parsed.hostname)) {
    throw new Error('El proxy eCommerce requiere un BALTO_ORIGIN remoto para evitar bucles.');
  }
  // Checkout de PRUEBA (opcional). Variable SIN prefijo REACT_APP_: CRA no la
  // incluye en el bundle; solo la conoce este proxy del servidor de desarrollo.
  // Se define en .env.development.local (no versionado) y debe coincidir con
  // ECOMMERCE_CHECKOUT_TEST_TOKEN del servidor. Nunca existe en el build de produccion.
  const checkoutTestToken = String(process.env.BALTO_ECOMMERCE_CHECKOUT_TEST_TOKEN || '').trim();
  if (checkoutTestToken && checkoutTestToken.length < 32) {
    throw new Error('BALTO_ECOMMERCE_CHECKOUT_TEST_TOKEN debe tener al menos 32 caracteres.');
  }
  if (checkoutTestToken) {
    // eslint-disable-next-line no-console
    console.log('[BALTO_ECOMMERCE] Proxy local con checkout de PRUEBA habilitado (solo este equipo).');
  }

  app.use('/ecom-api', createProxyMiddleware({
    target: origin,
    changeOrigin: true,
    secure: true,
    logLevel: 'warn',
    // Usar originalUrl evita ambiguedades por el prefijo que Express
    // pueda recortar al montar /ecom-api. Siempre va al unico entrypoint PHP.
    pathRewrite(_path, req) {
      const query = new URL(req.originalUrl || req.url, 'http://localhost').search;
      return '/BALTO_ECOMMERCE/api/index.php' + query;
    },
    onProxyReq(proxyReq, req) {
      // Solo en servidor de desarrollo. El backend resuelve la tienda
      // por el parametro publico ?tienda= y valida su registro en MASTER.
      // El navegador manda Origin http://localhost:3002, que el servidor no conoce. Se
      // reemplaza por el origen de la tienda pedida en ?tienda= (el mismo que mandaria el
      // navegador en produccion). Sin Origin, un checkout PUBLICO (checkout_habilitado = 1)
      // responde 403 ORIGEN_REQUERIDO. El servidor igual valida la tienda contra MASTER.
      proxyReq.removeHeader('origin');
      const tiendaOrigin = devTiendaOrigin(req.originalUrl || req.url);
      if (tiendaOrigin) proxyReq.setHeader('origin', tiendaOrigin);
      // Sesion de comprador: SOLO se reenvian las cookies del eCommerce (renombradas,
      // ver devCookiesToApi). Nunca otras cookies de localhost.
      const apiCookies = devCookiesToApi(req.headers.cookie);
      if (apiCookies) proxyReq.setHeader('cookie', apiCookies);
      else proxyReq.removeHeader('cookie');
      // Nunca reenviar un encabezado de prueba que venga del navegador.
      proxyReq.removeHeader('x-balto-checkout-test');
      if (checkoutTestToken) proxyReq.setHeader('X-Balto-Checkout-Test', checkoutTestToken);
    },
    onProxyRes(proxyRes) {
      const set = proxyRes.headers['set-cookie'];
      if (Array.isArray(set)) {
        const out = set.map(apiCookieToDev).filter(Boolean);
        if (out.length) proxyRes.headers['set-cookie'] = out;
        else delete proxyRes.headers['set-cookie'];
      }
    },
  }));
};

/*
 * Cookies de sesion en DESARROLLO (http://localhost):
 * El servidor emite "__Host-balto_ecs_<idTienda>" (y "__Host-balto_ecn_<id>" para el nonce
 * de Google) con Secure. En http://localhost Safari no acepta cookies Secure y el prefijo
 * __Host- exige Secure, por eso este proxy las traduce:
 *   respuesta:  __Host-balto_ecs_1=TOKEN; Path=/; Secure; HttpOnly; SameSite=Lax
 *            -> balto_dev_ecs_1=TOKEN; Path=/; HttpOnly; SameSite=Lax   (sin Secure, host localhost)
 *   solicitud:  balto_dev_ecs_1=TOKEN -> __Host-balto_ecs_1=TOKEN
 * Siguen siendo HttpOnly: React nunca ve el token. Esto existe SOLO en `npm start`.
 */
const API_COOKIE_RE = /^__Host-balto_(ec[sn])_(\d{1,9})=([A-Za-z0-9_-]*)(;.*)?$/i;
const DEV_COOKIE_RE = /^balto_dev_(ec[sn])_(\d{1,9})$/;

function apiCookieToDev(header) {
  const m = API_COOKIE_RE.exec(String(header || '').trim());
  if (!m) return null; // cualquier otra cookie del servidor se descarta en local
  const attrs = (m[4] || '').split(';').map((a) => a.trim()).filter((a) => a && !/^(secure|domain=.*)$/i.test(a));
  return [`balto_dev_${m[1].toLowerCase()}_${m[2]}=${m[3]}`, ...attrs].join('; ');
}

function devCookiesToApi(cookieHeader) {
  return String(cookieHeader || '').split(';').map((c) => c.trim()).map((c) => {
    const eq = c.indexOf('=');
    if (eq < 1) return null;
    const m = DEV_COOKIE_RE.exec(c.slice(0, eq));
    const value = c.slice(eq + 1);
    return m && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? `__Host-balto_${m[1]}_${m[2]}=${value}` : null;
  }).filter(Boolean).join('; ');
}

module.exports.apiCookieToDev = apiCookieToDev;
module.exports.devCookiesToApi = devCookiesToApi;

/** https://<dominio> de ?tienda=, solo si es un hostname valido (sin puertos, rutas ni localhost). */
function devTiendaOrigin(url) {
  let tienda = '';
  try { tienda = new URL(url, 'http://localhost').searchParams.get('tienda') || ''; } catch (_) { return null; }
  tienda = tienda.trim().toLowerCase();
  if (tienda.length > 253 || !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(tienda)) return null;
  if (/^(localhost|127\.)/.test(tienda)) return null;
  return 'https://' + tienda;
}

module.exports.devTiendaOrigin = devTiendaOrigin;
