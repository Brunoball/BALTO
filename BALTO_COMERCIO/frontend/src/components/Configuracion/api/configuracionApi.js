import BASE_URL from "../../../config/config";

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

export function getConfiguracionSessionKey({ includeLegacy = false } = {}) {
  const primary = String(localStorage.getItem("session_key") || "").trim();
  if (primary || !includeLegacy) return primary;
  return String(localStorage.getItem("sessionKey") || "").trim();
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildHeaders(options = {}, includeLegacySessionKey = false) {
  const headers = new Headers(options.headers || {});
  const sessionKey = getConfiguracionSessionKey({ includeLegacy: includeLegacySessionKey });

  if (sessionKey) headers.set("X-Session", sessionKey);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function apiFetch(paramsObj = {}, options = {}) {
  const headers = buildHeaders(options, false);
  return fetch(buildConfiguracionApiUrl(paramsObj), { ...options, headers });
}

export async function apiFetchTiendaNube(paramsObj = {}, options = {}) {
  const {
    timeoutMs = 0,
    dispatchUnauthorized = true,
    ...fetchOptions
  } = options || {};

  const headers = buildHeaders(fetchOptions, false);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const externalSignal = fetchOptions.signal;
  let timeoutId = null;

  if (controller && externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  if (controller) {
    timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const res = await fetch(buildConfiguracionApiUrl(paramsObj), {
      ...fetchOptions,
      headers,
      signal: controller?.signal || externalSignal,
    });

    if (dispatchUnauthorized && (res.status === 401 || res.status === 403)) {
      try {
        window.dispatchEvent(
          new CustomEvent("auth:unauthorized", {
            detail: { status: res.status },
          })
        );
      } catch {}
    }

    return res;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

export async function apiFetchJson(paramsObj = {}, options = {}) {
  const headers = buildHeaders(options, true);
  const res = await fetch(buildConfiguracionApiUrl(paramsObj), { ...options, headers });
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Respuesta inválida del servidor.");
  }
}

export async function apiFetchActionJson(action, options = {}) {
  const headers = buildHeaders(options, false);
  const res = await fetch(buildConfiguracionApiUrl({ action }), { ...options, headers });
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
