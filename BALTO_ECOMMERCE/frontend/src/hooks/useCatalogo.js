import { useEffect, useState } from 'react';
import { listarProductos } from '../services/catalogoService';

export function useCatalogo(habilitado, pagina, revision = 0) {
  const [state, setState] = useState({ cargando: !!habilitado, error: null, productos: [], masPaginas: false });
  useEffect(() => {
    if (!habilitado) {
      setState({ cargando: false, error: null, productos: [], masPaginas: false });
      return;
    }
    const controller = new AbortController();
    setState((old) => ({ ...old, cargando: true, error: null }));
    listarProductos({ pagina, limite: 12, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setState({
          cargando: false,
          error: null,
          productos: Array.isArray(data.productos) ? data.productos : [],
          masPaginas: Boolean(data.siguiente_pagina_posible),
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ cargando: false, error, productos: [], masPaginas: false });
      });
    return () => controller.abort();
  }, [habilitado, pagina, revision]);
  return state;
}
