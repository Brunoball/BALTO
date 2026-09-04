import { movSubsectionFetch } from "../../_shared/api/singleFlightFetch.js";

/**
 * Capa HTTP de Ventas.
 * Usa exclusivamente la sesión global MASTER mediante X-Session y expone el
 * transporte crudo para los modales que tienen reglas particulares de reintento/validación.
 */
export function getVentasAuthInfo() {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}

  return { sessionKey, idUsuario };
}

function buildHeadersGET() {
  const { sessionKey } = getVentasAuthInfo();
  const h = {};
  if (sessionKey) h["X-Session"] = sessionKey;
  return h;
}

function buildHeadersPOST() {
  const { sessionKey } = getVentasAuthInfo();
  const h = { "Content-Type": "application/json" };
  if (sessionKey) h["X-Session"] = sessionKey;
  return h;
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
    throw new Error(`Respuesta inválida (no es JSON). HTTP ${res.status}\n${preview}`);
  }
}

export function ventasFetch(url, options = {}) {
  return movSubsectionFetch(url, options);
}

export async function ventasApiGet(url) {
  const res = await ventasFetch(url, { method: "GET", headers: buildHeadersGET() });
  return parseJsonOrThrow(res);
}

export async function ventasApiPostJson(url, payload) {
  const res = await ventasFetch(url, {
    method: "POST",
    headers: buildHeadersPOST(),
    body: JSON.stringify(payload ?? {}),
  });
  return parseJsonOrThrow(res);
}
