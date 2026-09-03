import { movSubsectionFetch } from "../../_shared/api/singleFlightFetch.js";

/** Punto único de transporte HTTP para los modales de Facturación. */
export function facturacionFetch(url, options = {}) {
  return movSubsectionFetch(url, options);
}
