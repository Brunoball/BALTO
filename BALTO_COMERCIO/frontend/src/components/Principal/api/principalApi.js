import BASE_URL from "../../../config/config";
import {
  getSessionKey,
  isSessionExpiredResponse,
  looksLikeUnauthorizedPayload,
} from "../utils/principalUtils";

const API_RELATIVE = "api.php";

function buildApiUrl(paramsObj) {
  const baseRaw = String(BASE_URL || "").trim();
  const base = baseRaw.replace(/\/+$/, "") + "/";
  const url = new URL(API_RELATIVE, base);

  const qs = new URLSearchParams();
  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    qs.set(k, String(v));
  });

  url.search = qs.toString();
  return url.toString();
}

function isLocalApiBase() {
  try {
    const base = String(BASE_URL || "").toLowerCase().trim();
    return base.includes("localhost") || base.includes("127.0.0.1");
  } catch {
    return false;
  }
}

export async function principalApiFetch(paramsObj, options = {}) {
  const sessionKey = getSessionKey();

  const headers = new Headers(options.headers || {});
  if (sessionKey) headers.set("X-Session", sessionKey);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = buildApiUrl(paramsObj);

  const res = await fetch(url, {
    ...options,
    headers,
  });

  try {
    const clone = res.clone();
    const text = await clone.text();
    const ct = clone.headers.get("content-type") || "";

    if (isSessionExpiredResponse(res.status, text, ct)) {
      try {
        window.dispatchEvent(
          new CustomEvent("auth:unauthorized", {
            detail: { status: res.status },
          })
        );
      } catch {}
      return res;
    }

    if (looksLikeUnauthorizedPayload(text, ct)) {
      try {
        window.dispatchEvent(
          new CustomEvent("auth:unauthorized", {
            detail: { status: 401, reason: "payload-session-expired" },
          })
        );
      } catch {}

      return new Response(
        JSON.stringify({ exito: false, mensaje: "Sesión expirada." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }
  } catch {}

  return res;
}

export function cerrarSesionBackend() {
  return principalApiFetch(
    { action: "logout" },
    { method: "POST", body: JSON.stringify({}) }
  );
}

export function actualizarTemaBackend(tema) {
  return principalApiFetch(
    { action: "usuario_tema_actualizar" },
    { method: "POST", body: JSON.stringify({ tema }) }
  );
}

export async function obtenerTenantLogo(tipo = "principal") {
  const sessionKey = getSessionKey();
  if (!sessionKey || isLocalApiBase()) return null;

  const res = await fetch(buildApiUrl({ action: "tenant_logo_ver", tipo }), {
    method: "GET",
    headers: {
      "X-Session": sessionKey,
    },
    cache: "no-store",
  });

  if (res.status === 401) {
    try {
      window.dispatchEvent(
        new CustomEvent("auth:unauthorized", {
          detail: { status: res.status },
        })
      );
    } catch {}
  }

  return res;
}
