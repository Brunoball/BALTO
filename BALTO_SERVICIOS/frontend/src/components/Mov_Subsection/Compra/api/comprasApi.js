import { movSubsectionFetch } from "../../_shared/api/singleFlightFetch.js";

/**
 * Capa HTTP de Compras.
 * La pantalla principal usa exclusivamente la sesión global mediante X-Session.
 * Los modales usan comprasFetch porque tienen contratos
 * propios (multipart, no-store y validaciones específicas).
 */
export function getComprasAuthInfo() {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();

  let idUsuario = 0;
  let idUsuarioMaster = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const candMaster = u?.idUsuarioMaster ?? 0;
    const candNormal = u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;

    if (Number.isFinite(Number(candMaster)) && Number(candMaster) > 0) {
      idUsuarioMaster = Number(candMaster);
      idUsuario = Number(candMaster);
    } else if (Number.isFinite(Number(candNormal)) && Number(candNormal) > 0) {
      idUsuario = Number(candNormal);
      idUsuarioMaster = Number(candNormal);
    }
  } catch {}

  return { sessionKey, idUsuario, idUsuarioMaster };
}

function buildHeadersJSON() {
  const { sessionKey } = getComprasAuthInfo();
  const h = { "Content-Type": "application/json" };
  if (sessionKey) h["X-Session"] = sessionKey;
  return h;
}

function buildHeadersGET() {
  const { sessionKey } = getComprasAuthInfo();
  const h = {};
  if (sessionKey) h["X-Session"] = sessionKey;
  return h;
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacia del servidor.");
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
    throw new Error(`Respuesta invalida (no es JSON). HTTP ${res.status}\n${preview}`);
  }
}

export function comprasFetch(url, options = {}) {
  return movSubsectionFetch(url, options);
}

export async function comprasApiGet(url) {
  const res = await comprasFetch(url, { method: "GET", headers: buildHeadersGET() });
  return parseJsonOrThrow(res);
}

export async function comprasApiPostJson(url, payload) {
  const res = await comprasFetch(url, {
    method: "POST",
    headers: buildHeadersJSON(),
    body: JSON.stringify(payload ?? {}),
  });
  return parseJsonOrThrow(res);
}
