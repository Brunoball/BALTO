/* ================================================================
   Lista de productos para COMPRAS (entrada de mercadería).

   global_obtener_listas devuelve siempre dos listas de productos:
   - `detalles`: lista VENDIBLE (stock positivo o variante con stock).
     La consumen Ventas, Presupuestos y los demás egresos de mercadería.
   - `detalles_compras` (alias detallesCompras / detalles_todos /
     detallesTodos): TODOS los productos y variantes activos, aunque tengan
     stock 0, negativo, sin existencias registradas o totalmente reservado.
     Una compra repone stock, así que no puede filtrarse por disponibilidad.

   Módulo puro (sin imports) para poder probarlo con `node`.
================================================================ */

const CLAVES_COMPRAS = ["detalles_compras", "detallesCompras", "detalles_todos", "detallesTodos"];

function origenListas(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return src.listas && typeof src.listas === "object" ? src.listas : src;
}

/**
 * Devuelve la lista completa para compras si la respuesta/listas la traen,
 * o null si no viene (no confundir "no vino" con "vino vacía").
 */
export function pickDetallesCompras(raw) {
  const l = origenListas(raw);
  for (const key of CLAVES_COMPRAS) {
    if (Array.isArray(l?.[key])) return l[key];
  }
  // Algunas respuestas sólo exponen las claves planas fuera de `listas`.
  const plano = raw && typeof raw === "object" ? raw : {};
  for (const key of CLAVES_COMPRAS) {
    if (Array.isArray(plano?.[key])) return plano[key];
  }
  return null;
}

/**
 * Combina la lista de compras ya cargada en un modal con una actualización
 * entrante (contexto global o refresco puntual). Una actualización que NO trae
 * la lista de compras nunca debe reemplazar la lista completa por la vendible:
 * ese reemplazo dejaba a Compras mostrando sólo productos con stock.
 */
export function conservarDetallesCompras(actual, entrante) {
  if (Array.isArray(entrante) && entrante.length) return entrante;
  if (Array.isArray(actual) && actual.length) return actual;
  return Array.isArray(entrante) ? entrante : Array.isArray(actual) ? actual : [];
}
