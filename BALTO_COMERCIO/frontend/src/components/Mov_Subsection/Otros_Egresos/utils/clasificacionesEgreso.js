// Clasificaciones de Otros egresos (Nuevo / Editar egreso).
//
// Los IDs SIEMPRE salen del catálogo `clasificaciones` que devuelve
// obtener_listas (sólo filas activas). No hay IDs por defecto: cada tenant
// puede tener IDs distintos y OTROS EGRESOS puede recibir cualquier número
// (incluso 4, que el backend histórico interpretaba como gasto personal).
// Tampoco hay un "fallback a cualquier otra clasificación": una clasificación
// desconocida nunca se presenta como COSTO VARIABLE.

export const CLASIFICACIONES_EGRESO = [
  { key: "costo_fijo", nombre: "COSTO FIJO" },
  { key: "costo_variable", nombre: "COSTO VARIABLE" },
  { key: "otros_egresos", nombre: "OTROS EGRESOS" },
];

export function normalizeClasificacionNombre(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function toPositiveId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isInactive(row) {
  if (!row || typeof row !== "object" || !("activo" in row)) return false;
  const v = row.activo;
  return v === 0 || v === "0" || v === false;
}

/** Normaliza el catálogo crudo a [{ id, nombre }] activo y sin duplicados. */
export function parseClasificaciones(raw) {
  const src = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const row of src) {
    if (isInactive(row)) continue;
    const id = toPositiveId(row?.id ?? row?.id_clasificacion ?? row?.idClasificacion ?? row?.clasificacion_id);
    const nombre = normalizeClasificacionNombre(row?.nombre ?? row?.descripcion ?? row?.label);
    if (!id || !nombre || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, nombre });
  }
  return out;
}

function matchKey(nombre) {
  // Coincidencia exacta primero; las variantes contempladas son nombres
  // históricos ya interpretados así por el frontend/backend anteriores.
  if (nombre === "COSTO FIJO") return "costo_fijo";
  if (nombre === "COSTO VARIABLE") return "costo_variable";
  if (nombre === "OTROS EGRESOS") return "otros_egresos";
  if (nombre.includes("GASTO") && nombre.includes("PERSONAL")) return null;
  if (nombre.includes("NO ES COSTO FIJO")) return "costo_variable";
  if (nombre.includes("COSTO FIJO")) return "costo_fijo";
  if (nombre.includes("COSTO VARIABLE")) return "costo_variable";
  return null;
}

/**
 * Resuelve las tres opciones del selector a partir del catálogo real.
 * @returns {{
 *   opciones: Array<{key:string, id:number, nombre:string}>,
 *   faltantes: string[],
 *   ids: Record<string, number|null>,
 *   catalogoVacio: boolean,
 *   esValida: (id:any) => boolean,
 *   nombrePorId: (id:any) => string,
 * }}
 */
export function resolveClasificacionesEgreso(raw) {
  const parsed = parseClasificaciones(raw);
  const ids = { costo_fijo: null, costo_variable: null, otros_egresos: null };

  // Primero nombres exactos, después variantes históricas (sin pisar exactos).
  for (const pass of ["exact", "legacy"]) {
    for (const c of parsed) {
      const key = matchKey(c.nombre);
      if (!key || ids[key]) continue;
      const exact = CLASIFICACIONES_EGRESO.some((x) => x.key === key && x.nombre === c.nombre);
      if (pass === "exact" && !exact) continue;
      if (Object.values(ids).includes(c.id)) continue;
      ids[key] = c.id;
    }
  }

  const opciones = CLASIFICACIONES_EGRESO
    .filter((x) => ids[x.key])
    .map((x) => ({ key: x.key, id: ids[x.key], nombre: x.nombre }));
  const faltantes = CLASIFICACIONES_EGRESO.filter((x) => !ids[x.key]).map((x) => x.nombre);
  const validIds = new Set(opciones.map((o) => String(o.id)));
  const byId = new Map(parsed.map((c) => [String(c.id), c.nombre]));

  return {
    opciones,
    faltantes,
    ids,
    catalogoVacio: parsed.length === 0,
    esValida: (id) => validIds.has(String(id ?? "")),
    nombrePorId: (id) => {
      const opcion = opciones.find((o) => String(o.id) === String(id ?? ""));
      return opcion ? opcion.nombre : byId.get(String(id ?? "")) || "";
    },
  };
}

export function mensajeClasificacionesFaltantes(config) {
  if (!config) return "";
  if (config.catalogoVacio) {
    return "No se pudo cargar el catálogo de clasificaciones. Actualizá la pantalla; si persiste, contactá al administrador.";
  }
  if (!config.faltantes.length) return "";
  const lista = config.faltantes.join(", ");
  return config.faltantes.length === 1
    ? `La clasificación ${lista} no existe o está inactiva en la base de datos. Contactá al administrador para aplicar la migración de clasificaciones.`
    : `Las clasificaciones ${lista} no existen o están inactivas en la base de datos. Contactá al administrador para aplicar la migración de clasificaciones.`;
}
