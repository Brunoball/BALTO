/**
 * Lógica pura del carrito (sin React). Cantidades en milésimas e importes en
 * centavos para no acumular errores de punto flotante. Estos cálculos son
 * ORIENTATIVOS: el servidor siempre recalcula precios, stock y totales.
 */
import { cartKey } from './catalog';

export const CART_VERSION = 'v2';
export const MAX_LINEAS = 30;
export const MAX_POR_LINEA = 999;
const SCALE = 1000;

/** Texto o número -> milésimas (entero). null si no es una cantidad válida (>= 0, hasta 3 decimales). */
export function toMilli(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  let s = typeof value === 'number' ? (Number.isFinite(value) ? value.toFixed(6) : '') : String(value).trim().replace(',', '.');
  if (typeof value === 'number') s = s.replace(/\.?0+$/, '');
  const m = /^(\d{1,7})(?:\.(\d{1,3})0*)?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * SCALE + Number((m[2] || '').padEnd(3, '0'));
}

export const fromMilli = (milli) => Math.round(milli) / SCALE;

export function toCents(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * round(cantidad × precio, 2) half-up en enteros.
 * Se separa la cantidad en parte entera y milésimas para que ningún producto
 * intermedio supere Number.MAX_SAFE_INTEGER (sin BigInt).
 */
export function lineCents(precio, cantidad) {
  const c = toCents(precio);
  const m = toMilli(cantidad);
  if (c === null || m === null) return 0;
  const enteras = Math.floor(m / SCALE);
  const milesimas = m % SCALE;
  return c * enteras + Math.floor((c * milesimas + SCALE / 2) / SCALE);
}

export const centsToNumber = (cents) => cents / 100;

export function stepFor(permiteDecimales) { return permiteDecimales ? 0.1 : 1; }
export function minFor(permiteDecimales) { return permiteDecimales ? 0.001 : 1; }

/** Límite efectivo de una línea: stock disponible informado por el servidor y tope por línea. */
export function maxFor(cantidadMaxima) {
  const m = toMilli(cantidadMaxima);
  return m === null ? MAX_POR_LINEA : Math.min(fromMilli(m), MAX_POR_LINEA);
}

/**
 * Valida una cantidad según la unidad del producto (stock_unidades.permite_decimales).
 * Devuelve { ok, value, error }.
 */
export function validateQuantity(raw, { permiteDecimales = false, max = MAX_POR_LINEA } = {}) {
  const milli = toMilli(raw);
  if (milli === null) return { ok: false, value: null, error: permiteDecimales ? 'Ingresá una cantidad válida (hasta 3 decimales).' : 'Ingresá una cantidad entera.' };
  if (milli <= 0) return { ok: false, value: null, error: 'La cantidad debe ser mayor a cero.' };
  if (!permiteDecimales && milli % SCALE !== 0) return { ok: false, value: null, error: 'Este producto se vende por unidades enteras.' };
  const limit = Math.min(max ?? MAX_POR_LINEA, MAX_POR_LINEA);
  if (milli > Math.round(limit * SCALE)) return { ok: false, value: fromMilli(Math.round(limit * SCALE)), error: `La cantidad máxima disponible es ${formatQuantity(limit, permiteDecimales)}.` };
  return { ok: true, value: fromMilli(milli), error: null };
}

/** Suma o resta un paso respetando mínimos, máximos y decimales. */
export function stepQuantity(current, direction, { permiteDecimales = false, max = MAX_POR_LINEA } = {}) {
  const step = Math.round(stepFor(permiteDecimales) * SCALE);
  const min = Math.round(minFor(permiteDecimales) * SCALE);
  const top = Math.round(Math.min(max ?? MAX_POR_LINEA, MAX_POR_LINEA) * SCALE);
  const cur = toMilli(current) ?? min;
  let next = direction > 0 ? cur + step : cur - step;
  if (direction < 0 && next < min) next = min;
  if (next > top) next = top;
  if (!permiteDecimales) next = Math.max(SCALE, Math.round(next / SCALE) * SCALE);
  return fromMilli(next);
}

export function formatQuantity(value, permiteDecimales) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return permiteDecimales
    ? n.toLocaleString('es-AR', { maximumFractionDigits: 3 })
    : Math.trunc(n).toLocaleString('es-AR');
}

/** Línea nueva a partir del producto/variante del catálogo (datos del servidor en ese momento). */
export function buildEntry(product, variant, quantity) {
  if (!product || !product.idPublicacion || !product.slug) return { ok: false, motivo: 'Producto inválido.' };
  if (product.tiene_variantes && !variant) return { ok: false, motivo: 'Elegí una variante.' };
  const src = variant || product;
  if (src.disponible === false) return { ok: false, motivo: 'Sin stock disponible.' };
  const precio = src.precio;
  if (toCents(precio) === null || toCents(precio) <= 0) return { ok: false, motivo: 'Este producto no tiene precio vigente.' };
  const unidad = src.unidad || product.unidad || {};
  const permiteDecimales = Boolean(unidad.permite_decimales);
  const max = maxFor(src.cantidad_maxima);
  const q = validateQuantity(quantity, { permiteDecimales, max });
  if (!q.ok) return { ok: false, motivo: q.error };
  return {
    ok: true,
    entry: {
      key: cartKey(product, variant),
      idPublicacion: Number(product.idPublicacion),
      idVariante: variant ? Number(variant.idVariante) : null,
      slug: String(product.slug),
      nombre: String(product.nombre || ''),
      variante: variant ? String(variant.nombre || '') : null,
      imagen_url: product.imagen_url || null,
      moneda: product.moneda || 'ARS',
      precio: String(precio),
      cantidad: q.value,
      permite_decimales: permiteDecimales,
      unidad: String(unidad.abreviatura || 'u'),
      cantidad_maxima: src.cantidad_maxima ?? null,
    },
  };
}

/** Agrega sin duplicar líneas de mismo producto+variante. Variantes distintas = líneas distintas. */
export function addEntry(items, entry) {
  const found = items.find((x) => x.key === entry.key);
  if (!found) {
    if (items.length >= MAX_LINEAS) return { items, resultado: 'limite', motivo: `Podés agregar hasta ${MAX_LINEAS} productos distintos por pedido.` };
    return { items: [...items, entry], resultado: 'agregado' };
  }
  const max = maxFor(entry.cantidad_maxima);
  const sum = fromMilli(toMilli(found.cantidad) + toMilli(entry.cantidad));
  const capped = Math.min(sum, max);
  const next = items.map((x) => (x.key === entry.key ? { ...x, ...entry, cantidad: capped } : x));
  return capped < sum
    ? { items: next, resultado: 'limitado', motivo: `Alcanzaste la cantidad máxima disponible (${formatQuantity(max, entry.permite_decimales)} ${entry.unidad}).` }
    : { items: next, resultado: 'sumado' };
}

export function setQuantity(items, key, raw) {
  return items.map((x) => {
    if (x.key !== key) return x;
    const q = validateQuantity(raw, { permiteDecimales: x.permite_decimales, max: maxFor(x.cantidad_maxima) });
    if (q.ok) return { ...x, cantidad: q.value };
    return q.value ? { ...x, cantidad: q.value } : x; // excede: se ajusta al máximo
  });
}

/** Totales orientativos. Artículos: unidades enteras + 1 por cada línea fraccionada (kg, l, m...). */
export function cartTotals(items) {
  let cents = 0;
  let articulos = 0;
  for (const x of items) {
    cents += lineCents(x.precio, x.cantidad);
    articulos += x.permite_decimales ? 1 : Math.trunc(Number(x.cantidad) || 0);
  }
  return { subtotalCents: cents, subtotal: centsToNumber(cents), articulos, lineas: items.length };
}

/** Lee lo guardado en localStorage (v2 o v1 heredado) descartando datos corruptos o manipulados. */
export function sanitizeStoredItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const idPublicacion = Number(x.idPublicacion);
    const idVariante = x.idVariante === null || x.idVariante === undefined ? null : Number(x.idVariante);
    if (!Number.isInteger(idPublicacion) || idPublicacion <= 0) continue;
    if (idVariante !== null && (!Number.isInteger(idVariante) || idVariante <= 0)) continue;
    if (typeof x.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,190}$/.test(x.slug)) continue;
    const key = `${idPublicacion}:${idVariante === null ? 'simple' : idVariante}`;
    if (seen.has(key)) continue;
    const permiteDecimales = Boolean(x.permite_decimales);
    const q = validateQuantity(x.cantidad, { permiteDecimales, max: MAX_POR_LINEA });
    if (!q.ok) continue;
    seen.add(key);
    out.push({
      key, idPublicacion, idVariante, slug: x.slug,
      nombre: String(x.nombre || '').slice(0, 255),
      variante: x.variante ? String(x.variante).slice(0, 255) : null,
      imagen_url: typeof x.imagen_url === 'string' ? x.imagen_url : null,
      moneda: typeof x.moneda === 'string' ? x.moneda.slice(0, 3) : 'ARS',
      precio: toCents(x.precio) === null ? null : String(x.precio),
      cantidad: q.value,
      permite_decimales: permiteDecimales,
      unidad: typeof x.unidad === 'string' ? x.unidad.slice(0, 10) : 'u',
      cantidad_maxima: x.cantidad_maxima ?? null,
    });
    if (out.length >= MAX_LINEAS) break;
  }
  return out;
}

/** Datos mínimos que se envían al servidor. Nunca precios, totales ni nombres. */
export function itemsForServer(items) {
  return items.map((x) => ({ idPublicacion: x.idPublicacion, idVariante: x.idVariante, cantidad: String(x.cantidad) }));
}

/**
 * Aplica la respuesta del servidor (carrito_validar / checkout 409):
 * actualiza precio, nombre, unidad y máximo con los datos ACTUALES de Comercio,
 * y devuelve la lista de cambios para avisar al comprador.
 */
export function applyServerLines(items, lineas = []) {
  const byKey = new Map(lineas.map((l) => [l.key, l]));
  const cambios = [];
  const next = items.map((x) => {
    const l = byKey.get(x.key);
    if (!l || !l.slug) return x; // NO_DISPONIBLE: se conserva para que el comprador lo vea y lo quite
    const upd = { ...x, nombre: l.nombre || x.nombre, variante: l.variante ?? x.variante, imagen_url: l.imagen_url ?? x.imagen_url };
    if (l.unidad) { upd.permite_decimales = Boolean(l.unidad.permite_decimales); upd.unidad = l.unidad.abreviatura || upd.unidad; }
    if ('cantidad_maxima' in l) upd.cantidad_maxima = l.cantidad_maxima;
    if (l.precio_unitario && toCents(l.precio_unitario) !== toCents(x.precio)) {
      cambios.push({ key: x.key, tipo: 'PRECIO', nombre: upd.nombre, variante: upd.variante, anterior: x.precio, nuevo: l.precio_unitario });
      upd.precio = String(l.precio_unitario);
    }
    return upd;
  });
  return { items: next, cambios };
}

/** Estados del servidor que impiden comprar una línea. */
export const BLOQUEANTES = new Set(['NO_DISPONIBLE', 'SIN_STOCK', 'VARIANTE_REQUERIDA', 'VARIANTE_NO_DISPONIBLE', 'VARIANTE_INVALIDA', 'CANTIDAD_INVALIDA', 'CANTIDAD_EXCEDE_STOCK']);

export function cartSignature(items) {
  return items.map((x) => `${x.key}=${x.cantidad}`).sort().join('|');
}
