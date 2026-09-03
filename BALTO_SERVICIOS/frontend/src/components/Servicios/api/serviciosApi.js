import BASE_URL from "../../../config/config";

export const SERVICIOS_API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

function authHeaders(json = false) {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();
  const token = (localStorage.getItem("token") || "").trim();
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function buildUrl(action, params = {}) {
  const search = new URLSearchParams({ action });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return `${SERVICIOS_API_URL}?${search.toString()}`;
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

export async function serviciosGet(action, params = {}) {
  const res = await fetch(buildUrl(action, params), {
    method: "GET",
    headers: authHeaders(false),
    cache: "no-store",
  });
  return parseResponse(res);
}

export async function serviciosPost(action, body = {}) {
  const res = await fetch(buildUrl(action), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body || {}),
  });
  return parseResponse(res);
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
