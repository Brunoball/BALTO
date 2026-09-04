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

export async function configuracionGet(action, params = {}) {
  const headers = buildHeaders({});
  const res = await singleFlightFetch(buildConfiguracionApiUrl({ action, ...params }), {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok || !data?.exito) {
    const error = new Error(data?.mensaje || `Error HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function configuracionPost(action, body = {}) {
  return apiFetchActionJson(action, {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}

export const listarResumenListasCategoriasConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_resumen_listar", params);

export const listarDetallesConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_detalles_listar", params);
export const crearDetalleConfiguracion = (body) =>
  configuracionPost("config_listas_categorias_detalle_crear", body);
export const actualizarDetalleConfiguracion = (body) =>
  configuracionPost("config_listas_categorias_detalle_actualizar", body);
export const darBajaDetalleConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_detalle_dar_baja", { id_detalle: id });
export const reactivarDetalleConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_detalle_reactivar", { id_detalle: id });
export const eliminarDetalleConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_detalle_eliminar", { id_detalle: id });

export const listarUnidadesConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_unidades_listar", params);
export const crearUnidadConfiguracion = (body) =>
  configuracionPost("config_listas_categorias_unidad_crear", body);
export const actualizarUnidadConfiguracion = (body) =>
  configuracionPost("config_listas_categorias_unidad_actualizar", body);
export const darBajaUnidadConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_unidad_dar_baja", { id_unidad: id });
export const reactivarUnidadConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_unidad_reactivar", { id_unidad: id });
export const eliminarUnidadConfiguracion = (id) =>
  configuracionPost("config_listas_categorias_unidad_eliminar", { id_unidad: id });

// Categorías del módulo Servicios administradas desde Configuración.
export const listarCategoriasServiciosConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_categorias_servicios_listar", params);
export const listarCategoriasMaterialesConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_categorias_materiales_listar", params);
export const listarCategoriasInsumosConfiguracion = (params = {}) =>
  configuracionGet("config_listas_categorias_categorias_insumos_listar", params);
export const crearCategoriaServiciosConfiguracion = (grupo, body) =>
  configuracionPost("config_listas_categorias_categoria_crear", { ...(body || {}), grupo });
export const actualizarCategoriaServiciosConfiguracion = (grupo, body) =>
  configuracionPost("config_listas_categorias_categoria_actualizar", { ...(body || {}), grupo });
export const darBajaCategoriaServiciosConfiguracion = (grupo, id) =>
  configuracionPost("config_listas_categorias_categoria_dar_baja", { grupo, id_categoria: id });
export const reactivarCategoriaServiciosConfiguracion = (grupo, id) =>
  configuracionPost("config_listas_categorias_categoria_reactivar", { grupo, id_categoria: id });
export const eliminarCategoriaServiciosConfiguracion = (grupo, id) =>
  configuracionPost("config_listas_categorias_categoria_eliminar", { grupo, id_categoria: id });
