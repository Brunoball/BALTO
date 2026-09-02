import BASE_URL from "../../../config/config";

export const API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

export function buildHeadersGET() {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();
  const token = (localStorage.getItem("token") || "").trim();
  const headers = {};
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function buildHeadersJSON() {
  return {
    "Content-Type": "application/json",
    ...buildHeadersGET(),
  };
}

export function buildHeadersMultipart() {
  return buildHeadersGET();
}

export function withSessionKey(url) {
  const base = String(url || "").trim();
  if (!base) return "";

  try {
    const sessionKey = (localStorage.getItem("session_key") || "").trim();
    const token = (localStorage.getItem("token") || "").trim();
    const parsed = new URL(base, window.location.origin);

    if (sessionKey && !parsed.searchParams.has("session_key")) {
      parsed.searchParams.set("session_key", sessionKey);
    }
    if (token && !parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", token);
    }

    return parsed.toString();
  } catch {
    return base;
  }
}

export function notifyStockListsUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("balto:listas-updated"));
  } catch {}
}

export function getUsuarioAuditData() {
  let idUsuarioMaster = 0;
  let idTenant = null;

  try {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "null");
    const usuarioCand =
      usuario?.idUsuarioMaster ??
      usuario?.id_usuario_master ??
      usuario?.idUsuario ??
      usuario?.id_usuario ??
      usuario?.id ??
      0;

    if (Number.isFinite(Number(usuarioCand))) {
      idUsuarioMaster = Number(usuarioCand);
    }

    const tenantCand =
      usuario?.idTenant ??
      usuario?.id_tenant ??
      usuario?.tenant_id ??
      usuario?.tenant?.idTenant ??
      null;

    if (
      tenantCand !== null &&
      tenantCand !== undefined &&
      tenantCand !== "" &&
      Number(tenantCand) > 0
    ) {
      idTenant = Number(tenantCand);
    }
  } catch {}

  return { idUsuarioMaster, idTenant };
}

export async function parseJsonResponse(res, { requireSuccess = false } = {}) {
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      requireSuccess
        ? "Sesión vencida o no autorizada. Volvé a iniciar sesión."
        : `${res.status}: Sesión vencida o no autorizada. Volvé a iniciar sesión.`
    );
  }

  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.length > 400 ? `${text.slice(0, 400)}...` : text;
    throw new Error(
      text.startsWith("<!DOCTYPE") || text.startsWith("<")
        ? "La API devolvió HTML en vez de JSON. Revisá la ruta del backend."
        : `Respuesta inválida del servidor. HTTP ${res.status}\n${preview}`
    );
  }

  if (requireSuccess && (!res.ok || data?.exito === false)) {
    throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  }

  return data;
}

// Mantiene el contrato histórico usado por formularios/modales: HTTP no OK o exito=false => excepción.
export async function parseJsonOrThrow(res) {
  return parseJsonResponse(res, { requireSuccess: true });
}

function buildActionUrl(action, params = {}) {
  const search = new URLSearchParams();
  if (action) search.set("action", action);

  const entries = params instanceof URLSearchParams
    ? Array.from(params.entries())
    : Object.entries(params || {});

  entries.forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  });
  return `${API_URL}?${search.toString()}`;
}

export async function stockGet(action, params = {}, { strict = true } = {}) {
  const res = await fetch(buildActionUrl(action, params), {
    method: "GET",
    headers: buildHeadersGET(),
    cache: "no-store",
  });
  return strict ? parseJsonOrThrow(res) : parseJsonResponse(res);
}

export async function stockPost(action, body = {}, { strict = true } = {}) {
  const res = await fetch(buildActionUrl(action), {
    method: "POST",
    headers: buildHeadersJSON(),
    body: JSON.stringify(body || {}),
  });
  return strict ? parseJsonOrThrow(res) : parseJsonResponse(res);
}


export async function stockGetParams(params = {}, options = {}) {
  const action = params instanceof URLSearchParams
    ? String(params.get("action") || "")
    : String(params?.action || "");
  return stockGet(action, params, options);
}

export async function stockPostPayload(payload = {}, options = {}) {
  const { action, ...body } = payload || {};
  return stockPost(action, body, options);
}

export async function stockPostMultipart(action, formData, { strict = true } = {}) {
  const res = await fetch(buildActionUrl(action), {
    method: "POST",
    headers: buildHeadersMultipart(),
    body: formData,
  });
  return strict ? parseJsonOrThrow(res) : parseJsonResponse(res);
}

export function buildStockBarcodeEndpoint(params = {}) {
  const endpoint = new URL("../modules/stock/codigos_barra/endpoint.php", API_URL);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      endpoint.searchParams.set(key, String(value));
    }
  });
  return endpoint.toString();
}

export async function stockBarcodeGet(params = {}) {
  const res = await fetch(buildStockBarcodeEndpoint(params), {
    method: "GET",
    headers: buildHeadersGET(),
    cache: "no-store",
  });
  return parseJsonOrThrow(res);
}

export async function stockBarcodePost(params = {}, body = {}) {
  const res = await fetch(buildStockBarcodeEndpoint(params), {
    method: "POST",
    headers: buildHeadersJSON(),
    body: JSON.stringify(body || {}),
  });
  return parseJsonOrThrow(res);
}

// Catálogo
export const listarCategoriasStock = (params = {}, options = {}) =>
  stockGet("stock_categorias_listar", params, options);
export const crearCategoriaStock = (body = {}, options = {}) =>
  stockPost("stock_categorias_crear", body, options);
export const listarTiposPrecioStock = (params = {}, options = {}) =>
  stockGet("stock_tipos_precio_listar", params, options);
export const crearTipoPrecioStock = (body = {}, options = {}) =>
  stockPost("stock_tipos_precio_crear", body, options);
export const listarProductosStock = (params = {}, options = {}) =>
  stockGet("stock_productos_listar", params, options);
export const obtenerProductoStock = (id, params = {}, options = {}) =>
  stockGet("stock_producto_obtener", { id, ...params }, options);
export const listarVariantesStock = (params = {}, options = {}) =>
  stockGet("stock_variantes_listar", params, options);
export const crearProductoStock = (formData, options = {}) =>
  stockPostMultipart("stock_productos_crear", formData, options);
export const actualizarProductoStock = (formData, options = {}) =>
  stockPostMultipart("stock_productos_actualizar", formData, options);

// Acciones de producto / variante
export const consultarImpactoProductoStock = (id, options = {}) =>
  stockGet("stock_producto_impacto_eliminacion", { id }, options);
export const darBajaProductoStock = (body = {}, options = {}) =>
  stockPost("stock_producto_dar_baja", body, options);
export const eliminarProductoPermanenteStock = (body = {}, options = {}) =>
  stockPost("stock_producto_eliminar_permanente", body, options);
export const reactivarProductoStock = (body = {}, options = {}) =>
  stockPost("stock_producto_reactivar", body, options);
export const consultarImpactoVarianteStock = (id, options = {}) =>
  stockGet("stock_variante_impacto_eliminacion", { id }, options);
export const darBajaVarianteStock = (body = {}, options = {}) =>
  stockPost("stock_variante_dar_baja", body, options);
export const eliminarVariantePermanenteStock = (body = {}, options = {}) =>
  stockPost("stock_variante_eliminar_permanente", body, options);
export const reactivarVarianteStock = (body = {}, options = {}) =>
  stockPost("stock_variante_reactivar", body, options);

// Cambios / sincronización
export const consultarCambiosStock = (params = {}, options = {}) =>
  stockGet("stock_cambios_consultar", params, options);
export const obtenerEstadoJobsTiendaNubeStock = (params = {}, options = {}) =>
  stockGet("stock_tiendanube_jobs_estado", params, options);
export const procesarJobsTiendaNubeStock = (body = {}, options = {}) =>
  stockPost("stock_tiendanube_jobs_procesar", body, options);

// Precios
export const obtenerOpcionesAjustePreciosStock = (params = {}, options = {}) =>
  stockGet("stock_precios_ajuste_opciones", params, options);
export const crearAjustePreciosStock = (body = {}, options = {}) =>
  stockPost("stock_precios_ajuste_crear", body, options);
export const listarHistorialAjustesPreciosStock = (params = {}, options = {}) =>
  stockGet("stock_precios_ajustes_historial", params, options);
export const obtenerAjustePreciosStock = (params = {}, options = {}) =>
  stockGet("stock_precios_ajuste_obtener", params, options);
export const obtenerHistorialPreciosProductoStock = (params = {}, options = {}) =>
  stockGet("stock_precios_historial_producto", params, options);

// Importación / clasificación / reportes
export const clasificarTextoStock = (texto, options = {}) =>
  stockPost("stock_productos_clasificar_texto", { texto }, options);
export const importarArchivoStock = (action, formData, options = {}) =>
  stockPostMultipart(action, formData, options);
export const generarReporteStock = (params = {}, options = {}) =>
  stockGet("stock_reportes_generar", params, options);
