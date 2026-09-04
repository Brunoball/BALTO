import BASE_URL from "../../../config/config";

const API = `${BASE_URL}/api.php`;

// Single-flight: si React dispara el mismo GET dos veces mientras la primera
// petición todavía está en curso, ambos consumidores comparten la misma
// Promise. No guarda respuestas ni introduce datos viejos: al finalizar la
// petición la entrada se elimina inmediatamente.
const inFlightGetRequests = new Map();

function parseJsonOrThrow(res, invalidLabel = "Respuesta inválida (no es JSON).") {
  return res.text().then((text) => {
    if (!text) throw new Error("Respuesta vacía del servidor.");
    try {
      return JSON.parse(text);
    } catch {
      const preview = text.length > 600 ? `${text.slice(0, 600)}...` : text;
      throw new Error(`${invalidLabel} HTTP ${res.status}\n${preview}`);
    }
  });
}

function getListSessionKey() {
  return (localStorage.getItem("session_key") || "").trim();
}

function getCatalogAuthInfo() {
  const sessionKey = localStorage.getItem("session_key") || "";

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {
    // Mantiene el comportamiento tolerante original.
  }

  return { sessionKey, idUsuario };
}

async function apiGet(params) {
  const sessionKey = getListSessionKey();
  const headers = {};
  if (sessionKey) headers["X-Session"] = sessionKey;

  const qs = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const url = `${API}?${qs.toString()}`;
  const requestKey = `${sessionKey}|${url}`;

  const pending = inFlightGetRequests.get(requestKey);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(url, { method: "GET", headers });
    return parseJsonOrThrow(res);
  })().finally(() => {
    if (inFlightGetRequests.get(requestKey) === request) {
      inFlightGetRequests.delete(requestKey);
    }
  });

  inFlightGetRequests.set(requestKey, request);
  return request;
}

export async function listarMovimientos({ fechaDesde, fechaHasta, q = "", limit, offset, includeTotal = 0 }) {
  const sp = new URLSearchParams();
  sp.set("action", "movimientos_listar");
  sp.set("fecha_desde", fechaDesde);
  sp.set("fecha_hasta", fechaHasta);
  if (String(q || "").trim()) sp.set("q", String(q).trim());
  sp.set("limit", String(limit));
  sp.set("offset", String(offset));
  sp.set("include_total", String(includeTotal));
  return apiGet(sp);
}

export async function obtenerMovimientosLiveToken({ fechaDesde, fechaHasta, q = "", limit }) {
  const sp = new URLSearchParams();
  sp.set("action", "movimientos_live_token");
  sp.set("fecha_desde", fechaDesde);
  sp.set("fecha_hasta", fechaHasta);
  sp.set("limit", String(limit));
  if (String(q || "").trim()) sp.set("q", String(q).trim());
  return apiGet(sp);
}

export async function crearCatalogoMovimiento({ catalogo, nombre }) {
  const { sessionKey, idUsuario } = getCatalogAuthInfo();
  const headers = { "Content-Type": "application/json" };
  if (sessionKey) headers["X-Session"] = sessionKey;

  const res = await fetch(`${API}?action=catalogo_crear`, {
    method: "POST",
    headers,
    body: JSON.stringify({ catalogo, nombre, idUsuario }),
  });

  const data = await parseJsonOrThrow(
    res,
    "Respuesta inválida del servidor (no es JSON)."
  );

  if (!res.ok) {
    const msg = data?.mensaje || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}
