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

export async function apiFetchTiendaNube(paramsObj = {}, options = {}) {
  const {
    timeoutMs = 0,
    dispatchUnauthorized = true,
    ...fetchOptions
  } = options || {};

  const headers = buildHeaders(fetchOptions);
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
    const res = await singleFlightFetch(buildConfiguracionApiUrl(paramsObj), {
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

async function configuracionGet(action, params = {}) {
  const res = await apiFetch({ action, ...params }, { method: "GET" });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok || !data?.exito) throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  return data;
}

async function configuracionPost(action, body = {}) {
  const res = await apiFetch({ action }, { method: "POST", body: JSON.stringify(body || {}) });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok || !data?.exito) throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  return data;
}

export function listarResumenListasCategoriasConfiguracion(params = {}) {
  return configuracionGet("config_listas_categorias_resumen_listar", params);
}
export function crearDetalleConfiguracion(body) { return configuracionPost("config_listas_categorias_detalle_crear", body); }
export function actualizarDetalleConfiguracion(body) { return configuracionPost("config_listas_categorias_detalle_actualizar", body); }
export function darBajaDetalleConfiguracion(id) { return configuracionPost("config_listas_categorias_detalle_dar_baja", { id_detalle: id }); }
export function reactivarDetalleConfiguracion(id) { return configuracionPost("config_listas_categorias_detalle_reactivar", { id_detalle: id }); }
export function eliminarDetalleConfiguracion(id) { return configuracionPost("config_listas_categorias_detalle_eliminar", { id_detalle: id }); }
export function crearCategoriaStockConfiguracion(body) { return configuracionPost("config_listas_categorias_stock_categoria_crear", body); }
export function actualizarCategoriaStockConfiguracion(body) { return configuracionPost("config_listas_categorias_stock_categoria_actualizar", body); }
export function darBajaCategoriaStockConfiguracion(id) { return configuracionPost("config_listas_categorias_stock_categoria_dar_baja", { id_stock_categoria: id }); }
export function reactivarCategoriaStockConfiguracion(id) { return configuracionPost("config_listas_categorias_stock_categoria_reactivar", { id_stock_categoria: id }); }
export function eliminarCategoriaStockConfiguracion(id) { return configuracionPost("config_listas_categorias_stock_categoria_eliminar", { id_stock_categoria: id }); }
