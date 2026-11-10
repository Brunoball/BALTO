/** Opciones de orden del catálogo (el valor viaja al servidor como `orden`). */
export const ORDER_OPTIONS = [
  { value: 'destacados', label: 'Destacados primero' },
  { value: 'precio-asc', label: 'Precio: menor a mayor' },
  { value: 'precio-desc', label: 'Precio: mayor a menor' },
  { value: 'nombre', label: 'Nombre A–Z' },
  { value: 'recientes', label: 'Más nuevos' },
];

const MAX_PRICE_DIGITS = 10;

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

/** Valores por defecto de los filtros (no se escriben en la URL). */
export const FILTROS_INICIALES = Object.freeze({ q: '', categoria: '', orden: 'destacados', precio_min: '', precio_max: '', disponibles: false, pagina: 1 });

/** Lee los filtros desde la URL (?q=&categoria=&orden=&precio_min=&precio_max=&disponibles=1&pagina=). */
export function leerFiltrosURL(params) {
  const orden = params.get('orden');
  const pagina = Number.parseInt(params.get('pagina') || '1', 10);
  return {
    q: (params.get('q') || '').slice(0, 80),
    categoria: (params.get('categoria') || '').slice(0, 120),
    orden: ORDER_OPTIONS.some((o) => o.value === orden) ? orden : 'destacados',
    precio_min: sanitizePriceInput(params.get('precio_min') || ''),
    precio_max: sanitizePriceInput(params.get('precio_max') || ''),
    disponibles: params.get('disponibles') === '1',
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, 10000) : 1,
  };
}

/** Arma los parámetros de URL omitiendo los valores por defecto (URLs cortas y compartibles). */
export function filtrosAParams(f) {
  const out = new URLSearchParams();
  if (f.q?.trim()) out.set('q', f.q.trim());
  if (f.categoria && f.categoria !== 'todas') out.set('categoria', String(f.categoria));
  if (f.orden && f.orden !== 'destacados') out.set('orden', f.orden);
  if (f.precio_min) out.set('precio_min', f.precio_min);
  if (f.precio_max) out.set('precio_max', f.precio_max);
  if (f.disponibles) out.set('disponibles', '1');
  if (f.pagina > 1) out.set('pagina', String(f.pagina));
  return out;
}

/**
 * Ordena las categorías que devuelve el servidor como árbol (padre y debajo sus hijas)
 * y agrega `nivel` para la sangría. Las hijas cuyo padre no vino quedan como raíz.
 */
export function arbolCategorias(categorias = []) {
  const ids = new Set(categorias.map((c) => c.id));
  const hijos = new Map();
  for (const c of categorias) {
    const padre = c.id_padre != null && ids.has(c.id_padre) ? c.id_padre : null;
    if (!hijos.has(padre)) hijos.set(padre, []);
    hijos.get(padre).push(c);
  }
  const out = [];
  const visitar = (padre, nivel) => {
    for (const c of hijos.get(padre) || []) {
      if (out.length > 500 || nivel > 8) return;
      out.push({ ...c, nivel });
      visitar(c.id, nivel + 1);
    }
  };
  visitar(null, 0);
  return out;
}

export function cartKey(product, variant = null) {
  return `${String(product.idPublicacion)}:${variant ? String(variant.idVariante) : 'simple'}`;
}
