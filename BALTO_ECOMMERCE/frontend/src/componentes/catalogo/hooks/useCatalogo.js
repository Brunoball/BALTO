import { useEffect, useState } from 'react';
import { listarProductos } from '../api/catalogoApi';

/** Cantidad histórica por página: es la que usa el inicio y la de respaldo si la API rechaza otra. */
export const LIMITE_PREDETERMINADO = 12;

// Si la API rechazara un `limite` mayor (validación del parámetro), se vuelve a pedir
// con el límite histórico para que el catálogo nunca quede vacío por este cambio.
const esRechazoDeLimite = (error) => error && (error.status === 400 || error.status === 422);

export function useCatalogo(habilitado, pagina, revision = 0, limite = LIMITE_PREDETERMINADO) {
  const [state, setState] = useState({ cargando: !!habilitado, error: null, productos: [], masPaginas: false });
  useEffect(() => {
    if (!habilitado) {
      setState({ cargando: false, error: null, productos: [], masPaginas: false });
      return;
    }
    const controller = new AbortController();
    const signal = controller.signal;
    setState((old) => ({ ...old, cargando: true, error: null }));
    listarProductos({ pagina, limite, signal })
      .catch((error) => {
        if (signal.aborted || limite === LIMITE_PREDETERMINADO || !esRechazoDeLimite(error)) throw error;
        return listarProductos({ pagina, limite: LIMITE_PREDETERMINADO, signal });
      })
      .then((data) => {
        if (!signal.aborted) setState({
          cargando: false,
          error: null,
          productos: Array.isArray(data.productos) ? data.productos : [],
          masPaginas: Boolean(data.siguiente_pagina_posible),
        });
      })
      .catch((error) => {
        if (!signal.aborted) setState({ cargando: false, error, productos: [], masPaginas: false });
      });
    return () => controller.abort();
  }, [habilitado, pagina, revision, limite]);
  return state;
}
