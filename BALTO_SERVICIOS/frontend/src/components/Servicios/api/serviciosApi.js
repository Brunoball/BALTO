import BASE_URL from "../../../config/config";
import { singleFlightFetch } from "../../../utils/singleFlightFetch";

export const SERVICIOS_API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

const CACHE_PREFIX = "balto_servicios_api_v11_db15";
const CACHE_TTL_MS = 45 * 1000;
const memoryCache = new Map();
let readGeneration = 0;

function getSessionKey() {
  return String(localStorage.getItem("session_key") || "").trim();
}

function authHeaders(json = false) {
  const sessionKey = getSessionKey();
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  return headers;
}

function buildUrl(action, params = {}) {
  const search = new URLSearchParams({ action });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return `${SERVICIOS_API_URL}?${search.toString()}`;
}

function cacheKey(url) {
  const scope = getSessionKey().slice(0, 18) || "nosession";
  return `${CACHE_PREFIX}:${scope}:${url}`;
}

function readCache(url) {
  const key = cacheKey(url);
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.savedAt <= CACHE_TTL_MS) return mem.data;
  if (mem) memoryCache.delete(key);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || now - Number(parsed.savedAt) > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    memoryCache.set(key, { savedAt: Number(parsed.savedAt), data: parsed.data });
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function writeCache(url, data) {
  const key = cacheKey(url);
  const payload = { savedAt: Date.now(), data };
  memoryCache.set(key, payload);
  try { sessionStorage.setItem(key, JSON.stringify(payload)); } catch {}
}

export function clearServiciosApiCache() {
  memoryCache.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(`${CACHE_PREFIX}:`)) sessionStorage.removeItem(key);
    }
  } catch {}
}

function invalidateReads() {
  readGeneration += 1;
  clearServiciosApiCache();
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error("La API de Servicios devolvió una respuesta inválida."); }
  if (!res.ok || data?.exito === false) {
    const error = new Error(data?.mensaje || `Error HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data || {};
}

export async function serviciosGet(action, params = {}, options = {}) {
  const url = buildUrl(action, params);
  const force = options?.force === true;
  const cacheable = /_(categorias|unidades)_listar$/.test(String(action));
  if (cacheable && !force) {
    const cached = readCache(url);
    if (cached) return cached;
  }
  const generationAtStart = readGeneration;
  const res = await singleFlightFetch(url, { method: "GET", headers: authHeaders(false), cache: "no-store" });
  const data = await parseResponse(res);
  if (cacheable && generationAtStart === readGeneration) writeCache(url, data);
  return data;
}

export async function serviciosPost(action, body = {}) {
  invalidateReads();
  // Las escrituras NO se deduplican: dos POST con payload distinto nunca deben
  // compartir una respuesta sólo por apuntar al mismo action.
  const res = await fetch(buildUrl(action), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  const data = await parseResponse(res);
  invalidateReads();
  window.dispatchEvent(new Event("balto:listas-updated"));
  return data;
}

export const obtenerResumenServicios = () => serviciosGet("servicios_resumen");

export async function cargarModuloServicios({ seccion = "servicios", limit = 1000 } = {}) {
  return serviciosGet("servicios_modulo_cargar", { seccion, limit });
}

// SERVICIOS
export const listarCatalogoServicios = (params = {}) => serviciosGet("servicios_catalogo_listar", params);
export const obtenerServicioServicios = (id) => serviciosGet("servicios_servicio_obtener", { id_servicio: id });
export const crearServicioServicios = (body) => serviciosPost("servicios_servicio_crear", body);
export const actualizarServicioServicios = (body) => serviciosPost("servicios_servicio_actualizar", body);
export const darBajaServicioServicios = (id) => serviciosPost("servicios_servicio_dar_baja", { id_servicio: id });
export const reactivarServicioServicios = (id) => serviciosPost("servicios_servicio_reactivar", { id_servicio: id });
export const eliminarServicioServicios = (id) => serviciosPost("servicios_servicio_eliminar", { id_servicio: id });
export const historialServicioServicios = (id) => serviciosGet("servicios_servicio_historial_precios", { id_servicio: id }, { force: true });
export const guardarComposicionServicios = (id, articulos = [], trabajadores = []) =>
  serviciosPost("servicios_composicion_guardar", { id_servicio: id, composicion: { articulos, trabajadores } });

// CATEGORÍAS (alta rápida desde los desplegables de Servicios)
export const crearCategoriaServicioServicios = (body) => serviciosPost("servicios_categoria_crear", body);
export const crearCategoriaMaterialServicios = (body) => serviciosPost("servicios_material_categoria_crear", body);
export const crearCategoriaInsumoServicios = (body) => serviciosPost("servicios_insumo_categoria_crear", body);
export const crearCategoriaProductoServicios = (body) => serviciosPost("servicios_articulos_categoria_crear", { ...(body || {}), tipo: "PRODUCTO" });

// ARTÍCULOS
export const listarArticulosServicios = (params = {}) => serviciosGet("servicios_articulos_listar", params);
export const obtenerArticuloServicios = (id) => serviciosGet("servicios_articulo_obtener", { id_articulo: id });
export const crearArticuloServicios = (body) => serviciosPost("servicios_articulo_crear", body);
export const actualizarArticuloServicios = (body) => serviciosPost("servicios_articulo_actualizar", body);
export const darBajaArticuloServicios = (id) => serviciosPost("servicios_articulo_dar_baja", { id_articulo: id });
export const reactivarArticuloServicios = (id) => serviciosPost("servicios_articulo_reactivar", { id_articulo: id });
export const eliminarArticuloServicios = (id) => serviciosPost("servicios_articulo_eliminar", { id_articulo: id });
export const historialArticuloServicios = (id) => serviciosGet("servicios_articulo_historial_precios", { id_articulo: id }, { force: true });

// MATERIALES (comparten servicio_articulos, filtrados por tipo=MATERIAL)
export const listarMaterialesServicios = (params = {}) => serviciosGet("servicios_materiales_listar", params);
export const obtenerMaterialServicios = (id) => serviciosGet("servicios_material_obtener", { id_articulo: id });
export const crearMaterialServicios = (body) => serviciosPost("servicios_material_crear", body);
export const actualizarMaterialServicios = (body) => serviciosPost("servicios_material_actualizar", body);
export const darBajaMaterialServicios = (id) => serviciosPost("servicios_material_dar_baja", { id_articulo: id });
export const reactivarMaterialServicios = (id) => serviciosPost("servicios_material_reactivar", { id_articulo: id });
export const eliminarMaterialServicios = (id) => serviciosPost("servicios_material_eliminar", { id_articulo: id });
export const historialMaterialServicios = (id) => serviciosGet("servicios_material_historial_precios", { id_articulo: id }, { force: true });

// INSUMOS (comparten servicio_articulos, filtrados por tipo=INSUMO)
export const listarInsumosServicios = (params = {}) => serviciosGet("servicios_insumos_listar", params);
export const obtenerInsumoServicios = (id) => serviciosGet("servicios_insumo_obtener", { id_articulo: id });
export const crearInsumoServicios = (body) => serviciosPost("servicios_insumo_crear", body);
export const actualizarInsumoServicios = (body) => serviciosPost("servicios_insumo_actualizar", body);
export const darBajaInsumoServicios = (id) => serviciosPost("servicios_insumo_dar_baja", { id_articulo: id });
export const reactivarInsumoServicios = (id) => serviciosPost("servicios_insumo_reactivar", { id_articulo: id });
export const eliminarInsumoServicios = (id) => serviciosPost("servicios_insumo_eliminar", { id_articulo: id });
export const historialInsumoServicios = (id) => serviciosGet("servicios_insumo_historial_precios", { id_articulo: id }, { force: true });

// STOCK CONSOLIDADO SOBRE servicio_articulos
// No existe una tabla servicio_stock: esta vista reúne recursos con controla_stock=1 y productos independientes.
export const listarStockServicios = (params = {}) => serviciosGet("servicios_stock_listar", params);
export const obtenerStockServicios = (id) => serviciosGet("servicios_stock_obtener", { id_articulo: id });
export const ajustarStockServicios = (body) => serviciosPost("servicios_stock_ajustar", body);
export const historialStockServicios = (id) => serviciosGet("servicios_stock_historial", { id_articulo: id }, { force: true });

// PRODUCTOS DE STOCK (tipo=PRODUCTO, siempre controla_stock=1)
export const crearProductoStockServicios = (body) => serviciosPost("servicios_stock_producto_crear", body);
export const actualizarProductoStockServicios = (body) => serviciosPost("servicios_stock_producto_actualizar", body);
export const darBajaProductoStockServicios = (id) => serviciosPost("servicios_stock_producto_dar_baja", { id_articulo: id });
export const reactivarProductoStockServicios = (id) => serviciosPost("servicios_stock_producto_reactivar", { id_articulo: id });
export const eliminarProductoStockServicios = (id) => serviciosPost("servicios_stock_producto_eliminar", { id_articulo: id });

// TRABAJADORES
export const listarTrabajadoresServicios = (params = {}) => serviciosGet("servicios_trabajadores_listar", params);
export const obtenerTrabajadorServicios = (id) => serviciosGet("servicios_trabajador_obtener", { id_trabajador: id });
export const crearTrabajadorServicios = (body) => serviciosPost("servicios_trabajador_crear", body);
export const actualizarTrabajadorServicios = (body) => serviciosPost("servicios_trabajador_actualizar", body);
export const darBajaTrabajadorServicios = (id) => serviciosPost("servicios_trabajador_dar_baja", { id_trabajador: id });
export const reactivarTrabajadorServicios = (id) => serviciosPost("servicios_trabajador_reactivar", { id_trabajador: id });
export const eliminarTrabajadorServicios = (id) => serviciosPost("servicios_trabajador_eliminar", { id_trabajador: id });
export const historialTrabajadorServicios = (id) => serviciosGet("servicios_trabajador_historial_tarifas", { id_trabajador: id }, { force: true });

// UNIDADES
export const listarUnidadesServicios = (params = {}, options = {}) => serviciosGet("servicios_unidades_listar", params, options);
export const crearUnidadServicios = (body) => serviciosPost("servicios_unidad_crear", body);
export const actualizarUnidadServicios = (body) => serviciosPost("servicios_unidad_actualizar", body);
export const darBajaUnidadServicios = (id) => serviciosPost("servicios_unidad_dar_baja", { id_unidad: id });
export const reactivarUnidadServicios = (id) => serviciosPost("servicios_unidad_reactivar", { id_unidad: id });
export const eliminarUnidadServicios = (id) => serviciosPost("servicios_unidad_eliminar", { id_unidad: id });

