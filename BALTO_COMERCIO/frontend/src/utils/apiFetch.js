// src/utils/apiFetch.js
import BASE_URL from "../config/config";
import { singleFlightFetch } from "./singleFlightFetch";
import { isSessionExpiredResponse } from "../components/Principal/utils/principalUtils";

/**
 * Fetch centralizado:
 * - Agrega X-Session automáticamente
 * - Sólo errores definitivos de sesión (no errores de permisos) notifican logout.
 *
 * Uso:
 *  apiFetch("/api/routes/api.php", { params: { action:"movimientos_listar", periodo:"2026-02" } })
 *  apiFetch("/api/routes/api.php?action=logout", { method:"POST" })
 */
export async function apiFetch(path, options = {}) {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();

  const headers = new Headers(options.headers || {});
  if (sessionKey) headers.set("X-Session", sessionKey);

  // body => si no se seteó Content-Type, asumimos JSON
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // ✅ params opcional: options.params = { action: "...", ... }
  let finalPath = path;
  if (options.params && typeof options.params === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(options.params)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
    finalPath += (finalPath.includes("?") ? "&" : "?") + qs.toString();
  }

  // sacamos params del options para no pasarlo al fetch nativo
  const { params, ...fetchOptions } = options;

  const res = await singleFlightFetch(`${BASE_URL}${finalPath}`, {
    ...fetchOptions,
    headers,
    credentials: "omit", // si algún día usás cookies, cambiás a "include"
  });

  if (res.status === 401 || res.status === 403) {
    let bodyText = "";
    try {
      bodyText = await res.clone().text();
    } catch {}

    if (isSessionExpiredResponse(res.status, bodyText, res.headers.get("content-type") || "")) {
      try {
        window.dispatchEvent(
          new CustomEvent("auth:unauthorized", {
            detail: { status: 401, reason: "session-invalid" },
          })
        );
      } catch {}
    }
  }

  return res;
}
