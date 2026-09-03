import "../auth/localGlobalAuthBridge";

/**
 * Base de la API de BALTO COMERCIO.
 * En desarrollo apunta al backend publicado en Hostinger, salvo override por .env.
 */
const BASE_URL = String(
  process.env.REACT_APP_API_URL ||
    "https://balto.3devsnet.com/BALTO_COMERCIO/api/routes"
).replace(/\/+$/, "");

/**
 * URL pública del LOGIN GLOBAL.
 * La raíz de balto.3devsnet.com sirve internamente BALTO_LOGIN.
 */
export const BALTO_LOGIN_URL = String(
  process.env.REACT_APP_BALTO_LOGIN_URL || "https://balto.3devsnet.com/"
).trim();

/**
 * Basename del router de BALTO COMERCIO.
 * Local: /
 * Producción futura: se puede definir REACT_APP_ROUTER_BASENAME=/BALTO_COMERCIO
 */
export const APP_BASENAME = String(
  process.env.REACT_APP_ROUTER_BASENAME || "/"
).trim() || "/";

export default BASE_URL;


//npx playwright test --project=chromium --workers=1 --reporter=list