import BASE_URL from "../../../config/config";

// Evita trabajo duplicado si React o dos consumidores solicitan el mismo resumen
// exactamente al mismo tiempo. No es caché: al terminar la petición se elimina.
const dashboardInflight = new Map();

function getSessionKey() {
  return String(localStorage.getItem("session_key") || "").trim();
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
  const sessionKey = getSessionKey();
  const headers = { Accept: "application/json" };

  if (sessionKey) headers["X-Session"] = sessionKey;

  const url = buildApiUrl("dashboard_resumen");
  const requestKey = `${sessionKey}::${url}`;

  const existing = dashboardInflight.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    const res = await fetch(url, {
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
  })();

  dashboardInflight.set(requestKey, request);

  try {
    return await request;
  } finally {
    if (dashboardInflight.get(requestKey) === request) {
      dashboardInflight.delete(requestKey);
    }
  }
}
