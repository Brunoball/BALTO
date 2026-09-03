/** Punto único de transporte HTTP para los modales de Facturación. */
export function facturacionFetch(url, options = {}) {
  return fetch(url, options);
}
