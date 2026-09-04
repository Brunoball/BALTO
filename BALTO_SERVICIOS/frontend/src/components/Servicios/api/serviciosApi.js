import BASE_URL from "../../../config/config";
import { singleFlightFetch } from "../../../utils/singleFlightFetch";

export const SERVICIOS_API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

const CACHE_PREFIX = "balto_servicios_api_v2";
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
  try {
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Si el navegador no permite almacenar el payload, queda el caché en memoria.
  }
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
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("La API de Servicios devolvió una respuesta inválida.");
  }
  if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  return data || {};
}

export async function serviciosGet(action, params = {}, options = {}) {
  const url = buildUrl(action, params);
  const force = options?.force === true;
  const cacheable = action === "servicios_resumen" || String(action).endsWith("_listar");

  if (cacheable && !force) {
    const cached = readCache(url);
    if (cached) return cached;
  }

  const generationAtStart = readGeneration;
  const res = await singleFlightFetch(url, {
    method: "GET",
    headers: authHeaders(false),
    cache: "no-store",
  });
  const data = await parseResponse(res);

  // Una escritura ocurrida mientras este GET estaba en vuelo invalida el
  // resultado para caché. El caller actual puede usarlo, pero no queda guardado.
  if (cacheable && generationAtStart === readGeneration) writeCache(url, data);
  return data;
}

export async function serviciosPost(action, body = {}) {
  // Invalida antes de escribir para que un GET anterior no quede reutilizable.
  invalidateReads();

  const res = await singleFlightFetch(buildUrl(action), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body || {}),
  });
  const data = await parseResponse(res);

  // La escritura exitosa cambia el catálogo: cualquier lectura anterior deja
  // de ser válida y la próxima carga irá al backend.
  invalidateReads();
  return data;
}

export const obtenerResumenServicios = () => serviciosGet("servicios_resumen");
export const listarUnidadesServicios = () => serviciosGet("servicios_unidades_listar");

// SERVICIOS
export const listarCategoriasServicios = (params = {}) => serviciosGet("servicios_categorias_listar", params);
export const crearCategoriaServicios = (body) => serviciosPost("servicios_categoria_crear", body);
export const actualizarCategoriaServicios = (body) => serviciosPost("servicios_categoria_actualizar", body);
export const darBajaCategoriaServicios = (id) => serviciosPost("servicios_categoria_dar_baja", { id_servicio_categoria: id });
export const reactivarCategoriaServicios = (id) => serviciosPost("servicios_categoria_reactivar", { id_servicio_categoria: id });
export const eliminarCategoriaServicios = (id) => serviciosPost("servicios_categoria_eliminar", { id_servicio_categoria: id });
export const listarCatalogoServicios = (params = {}) => serviciosGet("servicios_catalogo_listar", params);
export const obtenerServicioServicios = (id) => serviciosGet("servicios_servicio_obtener", { id_servicio: id });
export const crearServicioServicios = (body) => serviciosPost("servicios_servicio_crear", body);
export const actualizarServicioServicios = (body) => serviciosPost("servicios_servicio_actualizar", body);
export const darBajaServicioServicios = (id) => serviciosPost("servicios_servicio_dar_baja", { id_servicio: id });
export const reactivarServicioServicios = (id) => serviciosPost("servicios_servicio_reactivar", { id_servicio: id });
export const eliminarServicioServicios = (id) => serviciosPost("servicios_servicio_eliminar", { id_servicio: id });
export const guardarRecetaServicios = (id, receta) => serviciosPost("servicios_receta_guardar", { id_servicio: id, receta });
export const guardarComposicionServicios = (id, insumos = [], productosStock = []) =>
  serviciosPost("servicios_composicion_guardar", {
    id_servicio: id,
    composicion: { insumos, stock: productosStock },
  });

// INSUMOS: catálogo totalmente independiente de Stock.
export const listarCategoriasInsumosServicios = (params = {}) => serviciosGet("servicios_insumos_categorias_listar", params);
export const crearCategoriaInsumoServicios = (body) => serviciosPost("servicios_insumo_categoria_crear", body);
export const actualizarCategoriaInsumoServicios = (body) => serviciosPost("servicios_insumo_categoria_actualizar", body);
export const darBajaCategoriaInsumoServicios = (id) => serviciosPost("servicios_insumo_categoria_dar_baja", { id_categoria: id });
export const reactivarCategoriaInsumoServicios = (id) => serviciosPost("servicios_insumo_categoria_reactivar", { id_categoria: id });
export const eliminarCategoriaInsumoServicios = (id) => serviciosPost("servicios_insumo_categoria_eliminar", { id_categoria: id });
export const listarInsumosServicios = (params = {}) => serviciosGet("servicios_insumos_listar", params);
export const obtenerInsumoServicios = (id) => serviciosGet("servicios_insumo_obtener", { id_insumo: id });
export const crearInsumoServicios = (body) => serviciosPost("servicios_insumo_crear", body);
export const actualizarInsumoServicios = (body) => serviciosPost("servicios_insumo_actualizar", body);
export const darBajaInsumoServicios = (id) => serviciosPost("servicios_insumo_dar_baja", { id_insumo: id });
export const reactivarInsumoServicios = (id) => serviciosPost("servicios_insumo_reactivar", { id_insumo: id });
export const eliminarInsumoServicios = (id) => serviciosPost("servicios_insumo_eliminar", { id_insumo: id });

// STOCK: catálogo propio. No comparte registros, IDs, categorías ni CRUD con Insumos.
export const listarCategoriasStockServicios = (params = {}) => serviciosGet("servicios_stock_categorias_listar", params);
export const crearCategoriaStockServicios = (body) => serviciosPost("servicios_stock_categoria_crear", body);
export const actualizarCategoriaStockServicios = (body) => serviciosPost("servicios_stock_categoria_actualizar", body);
export const darBajaCategoriaStockServicios = (id) => serviciosPost("servicios_stock_categoria_dar_baja", { id_stock_categoria: id });
export const reactivarCategoriaStockServicios = (id) => serviciosPost("servicios_stock_categoria_reactivar", { id_stock_categoria: id });
export const eliminarCategoriaStockServicios = (id) => serviciosPost("servicios_stock_categoria_eliminar", { id_stock_categoria: id });
export const listarStockServicios = (params = {}) => serviciosGet("servicios_stock_listar", params);
export const obtenerStockServicios = (id) => serviciosGet("servicios_stock_obtener", { id_stock: id });
export const crearStockServicios = (body) => serviciosPost("servicios_stock_crear", body);
export const actualizarStockServicios = (body) => serviciosPost("servicios_stock_actualizar", body);
export const darBajaStockServicios = (id) => serviciosPost("servicios_stock_dar_baja", { id_stock: id });
export const reactivarStockServicios = (id) => serviciosPost("servicios_stock_reactivar", { id_stock: id });
export const eliminarStockServicios = (id) => serviciosPost("servicios_stock_eliminar", { id_stock: id });
