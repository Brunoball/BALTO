/**
 * CRA development only (react-scripts start).
 * /ecom-api?action=... -> BALTO_ORIGIN/BALTO_ECOMMERCE/api/index.php?action=...
 * De esta forma localhost no necesita CORS ni acceso directo a MySQL.
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
    onProxyReq(proxyReq) {
      // Solo en servidor de desarrollo. El backend resuelve la tienda
      // por el parametro publico ?tienda= y valida su registro en MASTER.
      proxyReq.removeHeader('origin');
      proxyReq.removeHeader('cookie');
      // Nunca reenviar un encabezado de prueba que venga del navegador.
      proxyReq.removeHeader('x-balto-checkout-test');
      if (checkoutTestToken) proxyReq.setHeader('X-Balto-Checkout-Test', checkoutTestToken);
    },
  }));
};
