import { useEffect, useMemo, useState } from 'react';
import { listarProductos } from '../api/catalogoApi';

export const LIMITE_PREDETERMINADO = 12;

const VACIO = { productos: [], total: 0, totalPaginas: 1, masPaginas: false, categorias: [], precioRango: null };

/**
 * Catálogo con filtros aplicados en el servidor sobre TODOS los productos publicados.
 *
 * Fluidez: mientras llega una nueva página o un nuevo filtro se siguen mostrando los
 * resultados anteriores (`actualizando`), sin vaciar la grilla ni mostrar el cargador
 * de pantalla completa. `cargando` solo es true en la primera carga.
 *
 * @param {boolean} habilitado
 * @param {{pagina?:number, limite?:number, q?:string, categoria?:string, orden?:string,
 *          precio_min?:string, precio_max?:string, solo_disponibles?:boolean}} consulta
 */
export function useCatalogo(habilitado, consulta = {}, revision = 0) {
  const clave = JSON.stringify(consulta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => consulta, [clave]);
  const [state, setState] = useState({ ...VACIO, cargando: !!habilitado, actualizando: false, error: null, listo: false });

  useEffect(() => {
    if (!habilitado) {
      setState({ ...VACIO, cargando: false, actualizando: false, error: null, listo: true });
      return undefined;
    }
    const controller = new AbortController();
    const claveActual = `${clave}|${revision}`;
    setState((old) => ({ ...old, cargando: !old.listo, actualizando: old.listo, error: null }));
    listarProductos({ limite: LIMITE_PREDETERMINADO, ...params, signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({
          productos: Array.isArray(data.productos) ? data.productos : [],
          total: Number.isFinite(data.total) ? data.total : (data.productos || []).length,
          totalPaginas: Number.isFinite(data.total_paginas) ? data.total_paginas : 1,
          masPaginas: Boolean(data.siguiente_pagina_posible),
          categorias: Array.isArray(data.categorias) ? data.categorias : [],
          precioRango: data.precio_rango || null,
          cargando: false, actualizando: false, error: null, listo: true, clave: claveActual,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ ...VACIO, cargando: false, actualizando: false, error, listo: false });
      });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, params, revision]);

  // Se atenúa la grilla en el MISMO instante en que cambia el filtro (sin esperar al efecto).
  const pendiente = habilitado && state.listo && state.clave !== undefined && state.clave !== `${clave}|${revision}`;
  return pendiente && !state.actualizando ? { ...state, actualizando: true } : state;
}
