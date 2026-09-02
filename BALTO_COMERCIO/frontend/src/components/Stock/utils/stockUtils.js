import { withSessionKey } from "../api/stockApi";

export function extraerIdsJobsTiendaNube(response) {
  const ids = new Set();
  const visitados = new WeakSet();

  const recorrer = (value) => {
    if (!value || typeof value !== "object") return;
    if (visitados.has(value)) return;
    visitados.add(value);

    if (Array.isArray(value)) {
      value.forEach(recorrer);
      return;
    }

    const id = Number(value.id_job ?? value.job_id ?? value.idJob ?? 0);
    if (id > 0) ids.add(id);

    Object.entries(value).forEach(([key, nested]) => {
      if (
        key === "tiendanube_sync" ||
        key === "tiendanube_reintento" ||
        key === "job_reintento" ||
        key === "resultados" ||
        key === "resultados_proceso" ||
        key === "data"
      ) {
        recorrer(nested);
      }
    });
  };

  recorrer(response?.tiendanube_sync ?? response?.data?.tiendanube_sync ?? response);
  return Array.from(ids);
}


export function tiendaNubeNoConectada(response) {
  const sync = response?.tiendanube_sync ?? response?.data?.tiendanube_sync ?? null;
  const motivo = String(sync?.motivo || "").trim().toLowerCase();
  return motivo === "sin_conexion_tiendanube_activa" || motivo === "tiendanube_no_conectada";
}

export async function esperarSincronizacionTiendaNube(response) {
  const idsJobs = extraerIdsJobsTiendaNube(response);
  if (idsJobs.length === 0) {
    return { esperado: false, finalizado: true, exitoso: true, estado: null, error: "" };
  }

  // El guardado local ya terminó y la cola durable aceptó la sincronización.
  // A partir de acá el worker/cron es el único responsable de Tienda Nube:
  // el navegador no procesa jobs ni espera llamadas externas que podrían activar
  // el aviso global de conexión aunque Balto ya haya guardado correctamente.
  return {
    esperado: true,
    finalizado: false,
    exitoso: true,
    diferido: true,
    ids_jobs: idsJobs,
    estado: null,
    error: "",
  };
}

export function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";

  const raw = typeof value === "string" ? value.replace(",", ".") : value;
  const n = Number(raw);

  if (!Number.isFinite(n)) return "—";

  return `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function toNonNegativeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function esToastCarga(tipo) {
  const t = String(tipo || "").toLowerCase().trim();
  return t === "loading" || t === "cargando" || t === "carga" || t === "loader";
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function compareValues(a, b, campo) {
  const va = a?.[campo];
  const vb = b?.[campo];

  if (campo === "stock" || campo === "precio_costo" || campo === "precio" || campo === "precio_promo") {
    const na = Number(String(va ?? 0).replace(",", "."));
    const nb = Number(String(vb ?? 0).replace(",", "."));
    return na - nb;
  }

  return String(va ?? "").localeCompare(String(vb ?? ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

export function getProductoId(prod) {
  return Number(prod?.id ?? prod?.id_stock_producto ?? 0);
}

export function getProductoCategoriaId(prod) {
  return Number(
    prod?.id_stock_categoria ??
      prod?.stock_categoria_id ??
      prod?.id_categoria_stock ??
      prod?.id_categoria ??
      0
  );
}

export function productoTieneCategoria(prod, categoriaId) {
  const id = Number(categoriaId || 0);
  if (!id) return true;
  if (getProductoCategoriaId(prod) === id) return true;
  const cats = Array.isArray(prod?.categorias) ? prod.categorias : [];
  return cats.some((cat) => Number(cat?.id_stock_categoria ?? cat?.id ?? 0) === id);
}

export function productoTieneCategoriaEnSet(prod, categoriaIds) {
  if (!(categoriaIds instanceof Set) || categoriaIds.size === 0) return true;

  const principal = getProductoCategoriaId(prod);
  if (principal > 0 && categoriaIds.has(principal)) return true;

  const cats = Array.isArray(prod?.categorias) ? prod.categorias : [];
  return cats.some((cat) => {
    const id = Number(cat?.id_stock_categoria ?? cat?.id ?? cat?.id_categoria_stock ?? 0);
    return id > 0 && categoriaIds.has(id);
  });
}

export function normalizeCategoria(cat = {}) {
  const id = Number(cat?.id ?? cat?.id_stock_categoria ?? 0);
  return {
    ...cat,
    id,
    id_stock_categoria: id,
    id_categoria_padre: Number(cat?.id_categoria_padre || 0) || null,
    nivel: Number(cat?.nivel || 0),
    nombre: String(cat?.nombre ?? cat?.label ?? ""),
    nombre_mostrar: String(cat?.nombre_mostrar ?? `${"— ".repeat(Number(cat?.nivel || 0))}${cat?.nombre ?? cat?.label ?? ""}`),
  };
}

export function normalizeProductoListItem(prod = {}) {
  const id = getProductoId(prod);
  if (!id) return null;

  const categoriaId = Number(
    prod?.id_stock_categoria ??
      prod?.stock_categoria_id ??
      prod?.id_categoria_stock ??
      prod?.id_categoria ??
      0
  );
  const totalVariantes = Number(prod?.cantidad_variantes_total ?? prod?.cantidad_variantes ?? 0);
  const tieneVariantes = Number(prod?.tiene_variantes || 0) === 1 || totalVariantes > 0;
  const stockResumen = tieneVariantes
    ? (prod?.stock_variantes ?? prod?.stock ?? 0)
    : (prod?.stock ?? 0);

  return {
    ...prod,
    id,
    id_stock_producto: Number(prod?.id_stock_producto ?? id),
    nombre: String(prod?.nombre ?? ""),
    sku: String(prod?.sku ?? ""),
    // En productos con variantes `stock_productos.stock` es deliberadamente 0.
    // La fila padre debe mostrar la suma calculada de variantes activas, también
    // después de una recarga cuando todavía no se abrió el detalle.
    stock: stockResumen,
    precio_costo: prod?.precio_costo ?? null,
    precio: prod?.precio ?? null,
    precio_promo: prod?.precio_promo ?? null,
    descripcion: prod?.descripcion ?? "",
    imagen_archivo_id:
      Number(prod?.imagen_archivo_id ?? prod?.id_archivo_imagen ?? prod?.archivo_id ?? prod?.id_archivo ?? 0) || 0,
    id_archivo_imagen:
      Number(prod?.id_archivo_imagen ?? prod?.imagen_archivo_id ?? prod?.archivo_id ?? prod?.id_archivo ?? 0) || 0,
    archivo_id:
      Number(prod?.archivo_id ?? prod?.imagen_archivo_id ?? prod?.id_archivo_imagen ?? prod?.id_archivo ?? 0) || 0,
    imagen_path: String(prod?.imagen_path ?? prod?.archivo_path ?? prod?.path_imagen ?? ""),
    archivo_path: String(prod?.archivo_path ?? prod?.imagen_path ?? prod?.path_imagen ?? ""),
    imagen_actualizada_en: prod?.imagen_actualizada_en ?? prod?.updated_at ?? prod?.fecha_actualizacion ?? "",
    id_stock_categoria: categoriaId || null,
    id_categoria_stock: categoriaId || null,
    activo: Number(prod?.activo ?? 1),
    tiene_variantes: tieneVariantes,
    cantidad_variantes: Number(prod?.cantidad_variantes || 0),
    cantidad_variantes_total: totalVariantes,
    cantidad_variantes_activas: Number(prod?.cantidad_variantes_activas ?? prod?.cantidad_variantes ?? 0),
    cantidad_variantes_inactivas: Number(prod?.cantidad_variantes_inactivas ?? 0),
    categorias: Array.isArray(prod?.categorias) ? prod.categorias : [],
    updated_at:
      prod?.updated_at ??
      prod?.updatedAt ??
      prod?.fecha_actualizacion ??
      prod?.fecha_modificacion ??
      prod?.modificado_en ??
      prod?.imagen_actualizada_en ??
      prod?.ultima_actualizacion ??
      "",
  };
}


export function getVarianteId(variante) {
  return Number(variante?.id ?? variante?.id_stock_variante ?? 0);
}

export function getPrecioVariante(variante = {}, idTipo) {
  const precios = Array.isArray(variante?.precios) ? variante.precios : [];
  const item = precios.find((p) => Number(p?.id_tipo_precio_stock ?? p?.id_tipo ?? 0) === Number(idTipo));
  const value = item?.monto ?? item?.precio ?? item?.importe ?? null;
  return value === null || value === undefined || value === "" ? null : value;
}

export function normalizeVarianteListItem(variante = {}) {
  const id = getVarianteId(variante);
  if (!id) return null;

  return {
    ...variante,
    id,
    id_stock_variante: Number(variante?.id_stock_variante ?? id),
    nombre_variante: String(variante?.nombre_variante ?? variante?.nombre ?? ""),
    sku: String(variante?.sku ?? ""),
    stock: variante?.stock ?? 0,
    activo: Number(variante?.activo ?? 1),
    precio_costo: variante?.precio_costo ?? getPrecioVariante(variante, 1),
    precio: variante?.precio ?? getPrecioVariante(variante, 2),
    precio_promo: variante?.precio_promo ?? getPrecioVariante(variante, 3),
    precios_extra: (Array.isArray(variante?.precios) ? variante.precios : [])
      .filter((p) => {
        const idTipo = Number(p?.id_tipo_precio_stock ?? p?.id_tipo ?? 0);
        return idTipo > 3;
      })
      .map((p) => ({
        id_tipo_precio_stock: Number(p?.id_tipo_precio_stock ?? p?.id_tipo ?? 0),
        tipo_nombre: String(p?.tipo_nombre ?? p?.nombre ?? ""),
        precio: p?.monto ?? p?.precio ?? p?.importe ?? null,
      })),
    atributos: Array.isArray(variante?.atributos) ? variante.atributos : [],
    categorias: Array.isArray(variante?.categorias) ? variante.categorias : [],
    categorias_heredadas: !!variante?.categorias_heredadas,
  };
}

export function normalizeVariantesCollection(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeVarianteListItem(item))
    .filter(Boolean);
}

export function mergeVariantesPreferenciaLocal(variantesServidor = [], variantesLocales = []) {
  const servidor = normalizeVariantesCollection(variantesServidor);
  const locales = normalizeVariantesCollection(variantesLocales);
  if (locales.length === 0) return servidor;
  if (servidor.length === 0) return locales;

  // El snapshot optimista conserva los valores recién guardados en Balto, pero no
  // debe ocultar una variante nueva que ya ingresó a la DB desde Tienda Nube.
  // Los IDs compartidos mantienen la copia local; sólo se anexan filas realmente
  // nuevas informadas por el servidor.
  const idsLocales = new Set(locales.map((variante) => getVarianteId(variante)).filter((id) => id > 0));
  const nuevasDelServidor = servidor.filter((variante) => {
    const id = getVarianteId(variante);
    return id > 0 && !idsLocales.has(id);
  });

  return [...locales, ...nuevasDelServidor];
}

export function preservarVariantesInactivasOmitidas(variantesServidor = [], variantesConocidas = []) {
  const servidor = normalizeVariantesCollection(variantesServidor);
  const conocidas = normalizeVariantesCollection(variantesConocidas);
  if (conocidas.length === 0) return servidor;

  const idsServidor = new Set(
    servidor.map((variante) => getVarianteId(variante)).filter((id) => id > 0)
  );
  const bajasOmitidas = conocidas.filter((variante) => {
    const id = getVarianteId(variante);
    return id > 0 && Number(variante?.activo ?? 1) === 0 && !idsServidor.has(id);
  });

  if (bajasOmitidas.length === 0) return servidor;
  return [...servidor, ...bajasOmitidas].sort(
    (a, b) => getVarianteId(a) - getVarianteId(b)
  );
}

export function aplicarProteccionMutacionVariantes(variantes = [], proteccion = null) {
  const normalizadas = normalizeVariantesCollection(variantes);
  if (!proteccion || Number(proteccion?.expiresAt || 0) <= Date.now()) return normalizadas;
  if (proteccion?.forceNoVariants === true) return [];

  const eliminadas = new Set(
    Object.keys(proteccion?.deletedIds || {}).map((id) => Number(id)).filter((id) => id > 0)
  );
  const estados = proteccion?.desiredActive || {};

  return normalizadas
    .filter((variante) => !eliminadas.has(getVarianteId(variante)))
    .map((variante) => {
      const id = getVarianteId(variante);
      if (!id || !Object.prototype.hasOwnProperty.call(estados, id)) return variante;
      return { ...variante, activo: Number(estados[id]) === 1 ? 1 : 0 };
    });
}

export function variantAttributesLabel(variante = {}) {
  const attrs = Array.isArray(variante?.atributos) ? variante.atributos : [];
  const label = attrs
    .map((attr) => {
      const nombre = String(attr?.atributo ?? attr?.nombre_atributo ?? attr?.nombre ?? "").trim();
      const valor = String(attr?.valor ?? attr?.nombre_valor ?? "").trim();
      if (nombre && valor) return `${nombre}: ${valor}`;
      return nombre || valor;
    })
    .filter(Boolean)
    .join(" · ");

  return label || "Sin atributos";
}

export function variantCategoriasLabel(variante = {}) {
  const cats = Array.isArray(variante?.categorias) ? variante.categorias : [];
  const label = cats
    .map((cat) => String(cat?.nombre_mostrar ?? cat?.nombre ?? cat?.label ?? "").replace(/^—\s*/, "").trim())
    .filter(Boolean)
    .join(" · ");

  return label || "Hereda categorías del producto";
}


export function mergeProductoEnLista(lista = [], producto = null) {
  const normalizado = normalizeProductoListItem(producto);
  if (!normalizado) return Array.isArray(lista) ? lista : [];

  const base = Array.isArray(lista) ? [...lista] : [];
  const idx = base.findIndex((item) => getProductoId(item) === getProductoId(normalizado));

  if (idx === -1) {
    return [normalizado, ...base];
  }

  base[idx] = {
    ...base[idx],
    ...normalizado,
  };

  return base;
}

export function normalizeProductosCollection(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeProductoListItem(item))
    .filter(Boolean);
}

export function mergeProductoPreferenciaLocal(productoServidor = null, productoLocal = null) {
  const servidor = normalizeProductoListItem(productoServidor);
  const local = normalizeProductoListItem(productoLocal);

  if (!servidor) return local;
  if (!local) return servidor;

  const categoriasLocal = Array.isArray(local?.categorias) ? local.categorias : [];
  const categoriasServidor = Array.isArray(servidor?.categorias) ? servidor.categorias : [];

  return normalizeProductoListItem({
    ...servidor,
    ...local,
    categorias: categoriasLocal.length > 0 ? categoriasLocal : categoriasServidor,
    precios:
      Array.isArray(local?.precios) && local.precios.length > 0
        ? local.precios
        : servidor?.precios,
    variantes: mergeVariantesPreferenciaLocal(servidor?.variantes, local?.variantes),
  });
}

export function getProductoImageRefreshToken(prod, refreshKey = 0, intento = 0) {
  const archivoId = Number(prod?.imagen_archivo_id || 0);
  const estadoToken = Number(prod?.activo ?? 1) === 0 ? "baja" : "activo";
  const pathToken = String(prod?.imagen_path ?? prod?.archivo_path ?? "");

  // No usar updated_at del producto: cambiar nombre, precio o stock no debe
  // cambiar la URL de la imagen ni forzar que el navegador la descargue otra vez.
  return `${archivoId}-${estadoToken}-${pathToken}-${String(refreshKey)}-${String(intento)}`;
}

export function getProductoImageUrl(prod, apiUrl, refreshKey = 0, intento = 0) {
  const archivoId = Number(prod?.imagen_archivo_id || 0);
  if (!archivoId) return "";

  const params = new URLSearchParams({
    action: "stock_producto_imagen_ver",
    id_archivo: String(archivoId),
    _imgv: getProductoImageRefreshToken(prod, refreshKey, intento),
  });

  return withSessionKey(`${apiUrl}?${params.toString()}`);
}

export function extractProductoFromApiResponse(data) {
  const candidates = [
    data?.producto,
    data?.data?.producto,
    data?.data,
    data?.resultado?.producto,
    data?.resultado,
  ];

  return candidates.find((item) => item && typeof item === "object" && getProductoId(item) > 0) || null;
}


export const COLUMNS = [
  { key: "nombre", label: "PRODUCTO", fr: 2.2, align: "left", sortable: true },
  { key: "sku", label: "SKU", fr: 0.95, align: "center", sortable: true },
  { key: "stock", label: "STOCK", fr: 0.7, align: "center", sortable: true },
  { key: "precio_costo", label: "PRECIO COSTO", fr: 1.0, align: "right", sortable: true },
  { key: "precio", label: "PRECIO VENTA", fr: 1.0, align: "right", sortable: true },
  { key: "precio_promo", label: "PRECIO PROMO", fr: 1.0, align: "right", sortable: true },
  { key: "acciones", label: "ACCIONES", fr: 1, align: "center", sortable: false },
];

export const GRID_COLS = COLUMNS.map((c) => `${c.fr}fr`).join(" ");
export const SKELETON_ROWS = 10;

export const SKEL_WIDTHS = {
  nombre: ["68%", "52%", "60%", "48%"],
  sku: ["44%", "36%", "40%", "32%"],
  stock: ["38%", "30%", "34%", "28%"],
  precio_costo: ["48%", "40%", "44%", "36%"],
  precio: ["50%", "42%", "46%", "38%"],
  precio_promo: ["46%", "38%", "42%", "34%"],
};
