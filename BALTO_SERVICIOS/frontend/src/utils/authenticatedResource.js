import { singleFlightFetch } from "./singleFlightFetch";

export function getSessionHeader() {
  const sessionKey = String(localStorage.getItem("session_key") || "").trim();
  return sessionKey ? { "X-Session": sessionKey } : {};
}

export function isSameOriginResource(url = "") {
  const value = String(url || "").trim();
  if (!value || value.startsWith("blob:") || value.startsWith("data:")) return false;
  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function fetchAuthenticatedResource(url, options = {}) {
  const value = String(url || "").trim();
  if (!value) throw new Error("Falta la URL del archivo.");

  const headers = new Headers(options.headers || {});
  if (isSameOriginResource(value)) {
    const sessionHeaders = getSessionHeader();
    Object.entries(sessionHeaders).forEach(([key, val]) => headers.set(key, val));
  }

  return singleFlightFetch(value, {
    ...options,
    headers,
  });
}

export async function openAuthenticatedResourceInNewTab(url) {
  const value = String(url || "").trim();
  if (!value) throw new Error("Falta la URL del archivo.");

  if (!isSameOriginResource(value)) {
    window.open(value, "_blank", "noopener,noreferrer");
    return;
  }

  // Abrimos la pestaña antes del await para no chocar con el bloqueador de popups.
  const popup = window.open("", "_blank");
  if (!popup) {
    throw new Error("El navegador bloqueó la nueva pestaña.");
  }

  try {
    const res = await fetchAuthenticatedResource(value, { method: "GET", cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Sesión vencida o sin permisos para abrir el archivo.");
    }
    if (!res.ok) {
      throw new Error(`No se pudo abrir el archivo. HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    popup.location.replace(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    try { popup.close(); } catch {}
    throw error;
  }
}
