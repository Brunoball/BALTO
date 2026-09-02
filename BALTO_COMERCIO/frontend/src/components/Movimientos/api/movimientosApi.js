import BASE_URL from "../../../config/config";

const API = `${BASE_URL}/api.php`;

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
  const token = localStorage.getItem("token") || "";
  const sessionKey =
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("X-Session") ||
    "";

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {
    // Mantiene el comportamiento tolerante original.
  }

  return { token, sessionKey, idUsuario };
}

async function apiGet(params) {
  const sessionKey = getListSessionKey();
  const headers = {};
  if (sessionKey) headers["X-Session"] = sessionKey;

  const qs = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});
  const res = await fetch(`${API}?${qs.toString()}`, { method: "GET", headers });
  return parseJsonOrThrow(res);
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
  const { token, sessionKey, idUsuario } = getCatalogAuthInfo();
  const headers = { "Content-Type": "application/json" };
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;

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
