import BASE_URL from "../../../config/config";
import { singleFlightFetch } from "../../../utils/singleFlightFetch";

const API_RELATIVE = "api.php";

export function buildConfiguracionApiUrl(paramsObj = {}) {
  const baseRaw = String(BASE_URL || "").trim();
  const base = baseRaw.replace(/\/+$/, "") + "/";
  const url = new URL(API_RELATIVE, base);
  const qs = new URLSearchParams();

  Object.entries(paramsObj || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });

  url.search = qs.toString();
  return url.toString();
}

export function getConfiguracionSessionKey() {
  return String(localStorage.getItem("session_key") || "").trim();
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildHeaders(options = {}) {
  const headers = new Headers(options.headers || {});
  const sessionKey = getConfiguracionSessionKey();

  if (sessionKey) headers.set("X-Session", sessionKey);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function apiFetch(paramsObj = {}, options = {}) {
  const headers = buildHeaders(options);
  return singleFlightFetch(buildConfiguracionApiUrl(paramsObj), { ...options, headers });
}


export async function apiFetchJson(paramsObj = {}, options = {}) {
  const headers = buildHeaders(options);
  const res = await singleFlightFetch(buildConfiguracionApiUrl(paramsObj), { ...options, headers });
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Respuesta inválida del servidor.");
  }
}

export async function apiFetchActionJson(action, options = {}) {
  const headers = buildHeaders(options);
  const res = await singleFlightFetch(buildConfiguracionApiUrl({ action }), { ...options, headers });
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok || !data?.exito) {
    throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  }

  return data;
}

