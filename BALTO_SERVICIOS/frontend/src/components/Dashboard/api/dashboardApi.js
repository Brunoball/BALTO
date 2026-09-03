import BASE_URL from "../../../config/config";

function getSessionKey(usuario) {
  return (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x-session") ||
    usuario?.session_key ||
    usuario?.sessionKey ||
    usuario?.token ||
    ""
  );
}

function getApiEndpoint() {
  const base = String(BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base) return "api.php";
  if (base.endsWith("/api.php") || base.endsWith(".php")) return base;
  return `${base}/api.php`;
}

function buildApiUrl(action, params = {}) {
  const api = getApiEndpoint();
  const query = new URLSearchParams({ action, ...params });
  const separator = api.includes("?") ? "&" : "?";
  return `${api}${separator}${query.toString()}`;
}

export async function obtenerDashboardResumen(usuario) {
  const sessionKey = getSessionKey(usuario);
  const headers = { Accept: "application/json" };

  if (sessionKey) headers["X-Session"] = sessionKey;

  const res = await fetch(buildApiUrl("dashboard_resumen"), {
    method: "GET",
    headers,
  });

  const text = await res.text();

  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text?.slice(0, 180) || "La API no devolvió JSON válido.");
  }

  if (!res.ok || json?.exito === false) {
    throw new Error(json?.mensaje || `Error HTTP ${res.status}`);
  }

  return json;
}
