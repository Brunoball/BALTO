import { useCallback, useEffect, useState } from 'react';
import { baltoConfig } from '../../global/configuracion/baltoConfig';
import { consultarTienda } from '../api/tiendaApi';

/**
 * Configuración pública de la tienda con "mostrar y actualizar":
 *  - Si esta pestaña ya la cargó hace poco (sessionStorage, solo datos públicos), la tienda se
 *    dibuja al instante al recargar o abrir otra página, sin la pantalla "Preparando tu tienda…".
 *  - Igual se consulta al servidor en segundo plano y se reemplaza si cambió.
 *  - Sin copia guardada (primera visita) se espera la respuesta como antes.
 * El checkout y los pagos se validan siempre en el servidor: una copia vieja no habilita nada.
 */
const CLAVE = `balto:ecommerce:tienda:${baltoConfig.tiendaDominio}`;
const VIGENCIA_MS = 10 * 60 * 1000;

function leerCopia() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CLAVE) || 'null');
    if (c && typeof c === 'object' && c.configuracion && typeof c.t === 'number' && Date.now() - c.t < VIGENCIA_MS) return c;
  } catch (_) { /* almacenamiento bloqueado o dato corrupto */ }
  return null;
}
function guardarCopia(tienda, configuracion) {
  try { sessionStorage.setItem(CLAVE, JSON.stringify({ t: Date.now(), tienda, configuracion })); } catch (_) {}
}

export function useTienda() {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(() => {
    const copia = leerCopia();
    return copia
      ? { cargando: false, error: null, config: copia.configuracion, tienda: copia.tienda }
      : { cargando: true, error: null, config: null, tienda: null };
  });
  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => (prev.config ? prev : { ...prev, cargando: true, error: null }));
    consultarTienda(controller.signal)
      .then(({ tienda, configuracion }) => {
        if (controller.signal.aborted) return;
        guardarCopia(tienda, configuracion);
        // Si no cambió nada no se vuelve a dibujar la tienda entera.
        setState((prev) => (prev.config && JSON.stringify(prev.config) === JSON.stringify(configuracion) && !prev.cargando && !prev.error
          ? prev : { cargando: false, error: null, config: configuracion, tienda }));
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        // Con una copia válida en pantalla, un error de red momentáneo no tira la tienda abajo.
        setState((prev) => (prev.config ? prev : { cargando: false, error, config: null, tienda: null }));
      });
    return () => controller.abort();
  }, [revision]);
  const reintentar = useCallback(() => setRevision((n) => n + 1), []);
  return { ...state, reintentar };
}
