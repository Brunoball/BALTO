/** Opciones de orden del catálogo (el valor es el que usa filterProducts). */
export const ORDER_OPTIONS = [
  { value: 'destacados', label: 'Destacados primero' },
  { value: 'precio-asc', label: 'Precio: menor a mayor' },
  { value: 'precio-desc', label: 'Precio: mayor a menor' },
  { value: 'nombre', label: 'Nombre A–Z' },
];

const MAX_PRICE_DIGITS = 10;

export function getCategories(products = []) {
  const seen = new Set();
  return products.reduce((list, product) => {
    const name = String(product.categoria || '').trim();
    if (name && !seen.has(name)) { seen.add(name); list.push(name); }
    return list;
  }, []);
}

/**
 * Limpia lo que la persona escribe en un campo de precio: solo dígitos
 * (sin signo negativo, letras, puntos ni comas) y con un largo razonable.
 */
export function sanitizePriceInput(value) {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_PRICE_DIGITS);
}

function parsePrice(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
}

/**
 * Convierte los textos de mínimo/máximo en un rango numérico válido.
 * Si el rango es incorrecto devuelve `error` y no aplica ningún límite.
 */
export function normalizePriceRange(minValue, maxValue) {
  const min = parsePrice(minValue);
  const max = parsePrice(maxValue);
  if (Number.isNaN(min) || Number.isNaN(max)) return { min: null, max: null, error: 'Ingresá solo números.' };
  if ((min !== null && min < 0) || (max !== null && max < 0)) return { min: null, max: null, error: 'Los importes no pueden ser negativos.' };
  if (min !== null && max !== null && min > max) return { min: null, max: null, error: 'El mínimo no puede superar al máximo.' };
  return { min, max, error: null };
}

function productPrice(product) {
  const raw = product?.precio;
  if (raw === undefined || raw === null || raw === '') return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function comparePrices(a, b, direction) {
  const pa = productPrice(a);
  const pb = productPrice(b);
  if (pa === null || pb === null) return (pa === null) - (pb === null);
  return (pa - pb) * direction;
}

export function filterProducts(products = [], { term = '', category = 'todas', stockOnly = false, order = 'destacados', minPrice = null, maxPrice = null } = {}) {
  const normalized = String(term).trim().toLocaleLowerCase('es-AR');
  const hasMin = typeof minPrice === 'number' && Number.isFinite(minPrice);
  const hasMax = typeof maxPrice === 'number' && Number.isFinite(maxPrice);
  const filtered = products.filter((p) => {
    const terms = `${p.nombre || ''} ${p.categoria || ''} ${p.sku || ''}`.toLocaleLowerCase('es-AR');
    if (normalized && !terms.includes(normalized)) return false;
    if (category !== 'todas' && p.categoria !== category) return false;
    if (stockOnly && !p.disponible) return false;
    if (hasMin || hasMax) {
      // Con un rango activo, los productos sin precio publicado ("Consultar precio") no coinciden.
      const price = productPrice(p);
      if (price === null) return false;
      if (hasMin && price < minPrice) return false;
      if (hasMax && price > maxPrice) return false;
    }
    return true;
  });
  switch (order) {
    // Los productos sin precio publicado ("Consultar precio") quedan al final en ambos sentidos.
    case 'precio-asc': return filtered.sort((a,b) => comparePrices(a, b, 1));
    case 'precio-desc': return filtered.sort((a,b) => comparePrices(a, b, -1));
    case 'nombre': return filtered.sort((a,b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es-AR'));
    default: return filtered.sort((a,b) => Number(Boolean(b.destacado)) - Number(Boolean(a.destacado)));
  }
}

export function cartKey(product, variant = null) {
  return `${String(product.idPublicacion)}:${variant ? String(variant.idVariante) : 'simple'}`;
}
