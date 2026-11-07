/**
 * Todas las URLs se generan desde BALTO_CONFIG/balto.env mediante sync-env.cjs.
 * Ningun dato de conexion MySQL se almacena en React.
 */
const isBrowser = typeof window !== 'undefined';
const currentHost = isBrowser ? window.location.hostname.toLowerCase() : '';
const isLocal = ['localhost', '127.0.0.1'].includes(currentHost);

export const baltoConfig = Object.freeze({
  apiUrl: String(process.env.REACT_APP_API_URL || '').trim(),
  origin: String(process.env.REACT_APP_BALTO_ORIGIN || '').trim(),
  tiendaDominio: isLocal
    ? String(process.env.REACT_APP_ECOMMERCE_DEV_TIENDA || '').trim().toLowerCase()
    : currentHost,
  modoLocal: isLocal,
  routerBasename: process.env.REACT_APP_ROUTER_BASENAME || '/',
});

/** Dominio publico (no idTenant), resuelto de forma segura por el servidor. */
export function validarConfiguracion() {
  if (!baltoConfig.apiUrl) {
    throw new Error('Falta REACT_APP_API_URL. Ejecuta npm run balto:sync.');
  }
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(baltoConfig.tiendaDominio)) {
    throw new Error('Falta el dominio de la tienda de prueba en BALTO_CONFIG.');
  }
}
