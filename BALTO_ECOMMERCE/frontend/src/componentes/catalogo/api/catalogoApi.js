import { apiGet } from '../../global/api/clienteApi';

/**
 * Caché corta EN MEMORIA de las consultas públicas del catálogo (no se guarda nada en el navegador).
 *  - Volver del producto al catálogo, o paginar hacia atrás, es instantáneo (sin pedir de nuevo).
 *  - Dos componentes que piden lo mismo a la vez comparten un solo pedido.
 * Precio y stock definitivos siempre los revalida el servidor en el carrito y el checkout.
 */
const TTL_MS = 30_000;
const MAX_ENTRADAS = 60;
const cache = new Map();

function limpiarParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) out[k] = v === true ? '1' : String(v);
  return out;
}

function conCache(action, params, signal, pedir) {
  const limpios = limpiarParams(params);
  const clave = `${action}?${new URLSearchParams(Object.entries(limpios).sort()).toString()}`;
  const previo = cache.get(clave);
  if (previo && Date.now() - previo.t < TTL_MS) return esperar(previo.promesa, signal);
  // El pedido compartido no usa la señal de un componente: si uno se desmonta, el otro sigue recibiendo.
  const promesa = pedir(limpios);
  cache.set(clave, { t: Date.now(), promesa });
  promesa.catch(() => { if (cache.get(clave)?.promesa === promesa) cache.delete(clave); });
  if (cache.size > MAX_ENTRADAS) cache.delete(cache.keys().next().value);
  return esperar(promesa, signal);
}

function esperar(promesa, signal) {
  if (!signal) return promesa;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abortar = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abortar, { once: true });
    promesa.then((v) => { signal.removeEventListener('abort', abortar); resolve(v); },
      (e) => { signal.removeEventListener('abort', abortar); reject(e); });
  });
}

/**
 * Listado con filtros aplicados en el SERVIDOR sobre todo el catálogo.
 * @param {{pagina?:number, limite?:number, q?:string, categoria?:string|number, orden?:string,
 *          precio_min?:string|number, precio_max?:string|number, solo_disponibles?:boolean, signal?:AbortSignal}} opciones
 */
export const listarProductos = ({ signal, pagina = 1, limite = 12, ...filtros } = {}) =>
  conCache('catalogo_productos', { pagina, limite, ...filtros }, signal, (p) => apiGet('catalogo_productos', p));

/** Varios productos por slug en UNA consulta (favoritos). */
export const listarPorSlugs = (slugs, signal) =>
  conCache('catalogo_productos', { slugs: slugs.slice(0, 60).join(','), limite: Math.min(40, slugs.length) || 1 }, signal,
    (p) => apiGet('catalogo_productos', p));

/** Ficha del producto: precio y stock al momento (con la misma caché corta para ir y volver). */
export const obtenerProducto = (slug, signal) => conCache('catalogo_producto', { slug }, signal, (p) => apiGet('catalogo_producto', p));

/** Solo para pruebas. */
export const vaciarCacheCatalogo = () => cache.clear();
