import BASE_URL from "../../../config/config";

const API_RELATIVE = "api.php";

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getApiEndpoint() {
  const base = cleanBase(BASE_URL);

  if (!base) return API_RELATIVE;
  if (base.endsWith("/api.php") || base.endsWith(".php")) return base;

  return `${base}/${API_RELATIVE}`;
}

function getSessionKey() {
  let usuario = null;

  try {
    usuario = JSON.parse(localStorage.getItem("usuario") || "null");
  } catch {
    usuario = null;
  }

  return String(
    localStorage.getItem("session_key") ||
      localStorage.getItem("sessionKey") ||
      localStorage.getItem("x-session") ||
      usuario?.session_key ||
      usuario?.sessionKey ||
      usuario?.token ||
      ""
  ).trim();
}

function buildApiUrl(action, params = {}) {
  const api = getApiEndpoint();
  const query = new URLSearchParams();

  query.set("action", action);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });

  const separator = api.includes("?") ? "&" : "?";
  return `${api}${separator}${query.toString()}`;
}

function buildHeaders() {
  const headers = {
    Accept: "application/json",
  };

  const sessionKey = getSessionKey();
  if (sessionKey) headers["X-Session"] = sessionKey;

  return headers;
}

function safeJsonParse(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function isInvalidActionMessage(data) {
  const msg = String(data?.mensaje || data?.message || "").toLowerCase();
  return (
    msg.includes("acción no válida") ||
    msg.includes("accion no valida") ||
    (msg.includes("action") && msg.includes("not found"))
  );
}

function makeApiError(message, tryAlias = false) {
  const err = new Error(message);
  err.tryAlias = tryAlias;
  return err;
}

async function readJsonResponse(res) {
  const text = await res.text();
  const data = safeJsonParse(text);

  if (!data) {
    const preview = text
      ? text.slice(0, 220).replace(/\s+/g, " ")
      : "respuesta vacía";

    throw makeApiError(`La API no devolvió JSON válido. HTTP ${res.status}. Respuesta: ${preview}`, res.status === 404);
  }

  return data;
}

export async function fetchContabilidadJson(action, params = {}, aliases = []) {
  const actions = [action, ...(Array.isArray(aliases) ? aliases : [])].filter(Boolean);
  const errors = [];

  for (const currentAction of actions) {
    const url = buildApiUrl(currentAction, params);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        cache: "no-store",
      });

      const data = await readJsonResponse(res);

      if (!res.ok || data?.exito === false) {
        const message = data?.mensaje || data?.message || `Error HTTP ${res.status}`;
        errors.push(`${currentAction}: ${message}`);

        const canTryAlias = (res.status === 404 || isInvalidActionMessage(data)) && currentAction !== actions[actions.length - 1];
        throw makeApiError(message, canTryAlias);
      }

      return data;
    } catch (error) {
      const message = error?.message || "Error conectando con la API.";
      errors.push(`${currentAction}: ${message}`);

      if (error?.tryAlias && currentAction !== actions[actions.length - 1]) continue;

      throw new Error(message);
    }
  }

  throw new Error(errors[errors.length - 1] || "No se pudo cargar Contabilidad.");
}

export function getContabilidadApiUrl(action, params = {}) {
  return buildApiUrl(action, params);
}
