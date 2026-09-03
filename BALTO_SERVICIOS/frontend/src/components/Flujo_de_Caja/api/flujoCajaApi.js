import BASE_URL from "../../../config/config";
import { formatDateISO } from "../utils/flujoCajaUtils";

const API = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

function getSessionKey() {
  return (localStorage.getItem("session_key") || "").toString().trim();
}

function authHeaders(extra = {}) {
  const sessionKey = getSessionKey();
  const headers = { ...extra };
  if (sessionKey) headers["X-Session"] = sessionKey;
  return headers;
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

export async function obtenerResumenFlujoCaja(dateRange) {
  const sp = new URLSearchParams();
  sp.set("action", "flujo_caja_resumen");
  sp.set("fecha_desde", formatDateISO(dateRange.from));
  sp.set("fecha_hasta", formatDateISO(dateRange.to || dateRange.from));

  const res = await fetch(`${API}?${sp.toString()}`, {
    method: "GET",
    headers: authHeaders(),
  });

  const json = await parseJsonOrThrow(res);

  if (!res.ok || !json?.exito) {
    throw new Error(json?.mensaje || `Error desconocido (HTTP ${res.status})`);
  }

  return json;
}
