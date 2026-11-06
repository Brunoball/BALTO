import { useCallback, useEffect, useState } from 'react';
import { consultarTienda } from '../services/tiendaService';

export function useTienda() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ cargando: true, error: null, config: null, tienda: null });
  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, cargando: true, error: null }));
    consultarTienda(controller.signal)
      .then(({ tienda, configuracion }) => {
        if (!controller.signal.aborted) setState({ cargando: false, error: null, config: configuracion, tienda });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ cargando: false, error, config: null, tienda: null });
      });
    return () => controller.abort();
  }, [revision]);
  const reintentar = useCallback(() => setRevision((n) => n + 1), []);
  return { ...state, reintentar };
}
