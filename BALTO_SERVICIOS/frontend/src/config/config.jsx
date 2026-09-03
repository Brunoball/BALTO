/**
 * Base de la API de BALTO SERVICIOS.
 * En desarrollo apunta al backend publicado en Hostinger, salvo override por .env.
 */
const BASE_URL = String(
  process.env.REACT_APP_API_URL ||
    "https://balto.3devsnet.com/BALTO_SERVICIOS/api/routes"
).replace(/\/+$/, "");

/**
 * Entrada central de BALTO.
 */
export const BALTO_ACCESS_URL = String(
  process.env.REACT_APP_BALTO_ACCESS_URL || "https://balto.3devsnet.com/"
).trim();

/**
 * Basename del router de BALTO SERVICIOS.
 * Local: /
 * Producción: se puede definir REACT_APP_ROUTER_BASENAME=/BALTO_SERVICIOS
 */
export const APP_BASENAME = String(
  process.env.REACT_APP_ROUTER_BASENAME || "/"
).trim() || "/";

export default BASE_URL;

