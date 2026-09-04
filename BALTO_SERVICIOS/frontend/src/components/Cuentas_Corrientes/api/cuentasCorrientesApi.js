import BASE_URL from "../../../config/config";

export const CC_API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

// Evita GET idénticos concurrentes sin cachear datos. Esto es importante en
// las vistas de detalle/historial, donde selección + efectos de React pueden
// solicitar el mismo recurso casi al mismo tiempo.
const inFlightGetRequests = new Map();

export function getAuthInfo() {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand =
      u?.idUsuarioMaster ??
      u?.idUsuario ??
      u?.id_usuario ??
      u?.id ??
      u?.user_id ??
      0;

    if (Number.isFinite(Number(cand))) {
      idUsuario = Number(cand);
    }
  } catch {}

  return { sessionKey, idUsuario };
}

function buildHeadersGET() {
  const { sessionKey } = getAuthInfo();
  const headers = {};
  if (sessionKey) headers["X-Session"] = sessionKey;
  return headers;
}

function buildHeadersJSON() {
  return { ...buildHeadersGET(), "Content-Type": "application/json" };
}

async function parseJsonLoose(res) {
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${res.status} (Unauthorized): Sesión vencida o no autorizada. Volvé a iniciar sesión.`
    );
  }

  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  try {
    return JSON.parse(text);
  } catch {
    const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
    throw new Error(`Respuesta inválida (no es JSON). HTTP ${res.status}\n${preview}`);
  }
}

async function parseJsonStrict(res) {
  if (res.status === 401 || res.status === 403) {
    throw new Error("Sesión vencida o no autorizada. Volvé a iniciar sesión.");
  }

  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  try {
    const data = JSON.parse(text);
    if (!res.ok || data?.exito === false) {
      throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
    }
    return data;
  } catch (e) {
    if (
      e instanceof Error &&
      e.message &&
      !e.message.startsWith("Unexpected token")
    ) {
      throw e;
    }

    const preview = text.length > 400 ? `${text.slice(0, 400)}...` : text;

    throw new Error(
      text.startsWith("<!DOCTYPE") || text.startsWith("<")
        ? "La API devolvió HTML en vez de JSON. Revisá la ruta del backend."
        : `Respuesta inválida del servidor. HTTP ${res.status}\n${preview}`
    );
  }
}


function getRequestKey(url, mode) {
  const { sessionKey } = getAuthInfo();
  return `${mode}|${sessionKey}|${String(url)}`;
}

async function getDeduped(url, mode, parser) {
  const requestKey = getRequestKey(url, mode);
  const pending = inFlightGetRequests.get(requestKey);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(url, { method: "GET", headers: buildHeadersGET() });
    return parser(res);
  })().finally(() => {
    if (inFlightGetRequests.get(requestKey) === request) {
      inFlightGetRequests.delete(requestKey);
    }
  });

  inFlightGetRequests.set(requestKey, request);
  return request;
}

export async function ccApiGet(url) {
  return getDeduped(url, "loose", parseJsonLoose);
}

export async function ccApiPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeadersJSON(),
    body: JSON.stringify(body ?? {}),
  });
  return parseJsonLoose(res);
}

export async function ccApiGetStrict(url) {
  return getDeduped(url, "strict", parseJsonStrict);
}

export async function ccApiPostActionStrict(action, body) {
  const res = await fetch(`${CC_API_URL}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: buildHeadersJSON(),
    body: JSON.stringify(body || {}),
  });
  return parseJsonStrict(res);
}
