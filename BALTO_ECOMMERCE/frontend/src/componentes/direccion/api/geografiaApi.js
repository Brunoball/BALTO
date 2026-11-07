import { apiGet } from '../../global/api/clienteApi';
import { PROVINCIAS_AR } from '../utilidades/geografia';

/**
 * Georef (datos.gob.ar) a través del backend, con caché en memoria.
 * Si el servicio falla: provincias desde la lista local oficial y localidades
 * vacías (la persona puede escribir la localidad a mano).
 */
let provinciasCache = null;
const localidadesCache = new Map();

export async function obtenerProvincias(signal) {
  if (provinciasCache) return provinciasCache;
  try {
    const data = await apiGet('geografia_provincias', { pais: 'AR' }, { signal });
    if (Array.isArray(data.provincias) && data.provincias.length >= 20) {
      provinciasCache = { provincias: data.provincias, fuente: data.fuente || 'GEOREF' };
      return provinciasCache;
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error;
  }
  return { provincias: PROVINCIAS_AR, fuente: 'LOCAL' };
}

export async function buscarLocalidades(q, provinciaId, signal) {
  const query = String(q || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2) return { localidades: [], servicio_disponible: true };
  const key = `${provinciaId || ''}|${query.toLowerCase()}`;
  if (localidadesCache.has(key)) return localidadesCache.get(key);
  const data = await apiGet('geografia_localidades', { q: query.slice(0, 60), provincia: provinciaId || undefined }, { signal });
  const out = { localidades: Array.isArray(data.localidades) ? data.localidades : [], servicio_disponible: data.servicio_disponible !== false };
  if (out.servicio_disponible) {
    if (localidadesCache.size > 60) localidadesCache.delete(localidadesCache.keys().next().value);
    localidadesCache.set(key, out);
  }
  return out;
}
