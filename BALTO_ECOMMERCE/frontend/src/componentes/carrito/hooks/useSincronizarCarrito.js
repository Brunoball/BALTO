import { useEffect } from 'react';
import { useCarrito } from '../contexto/CarritoContext';

/**
 * Revalida el carrito contra el servidor al montar y cada vez que cambian
 * productos o cantidades (con espera breve para no consultar en cada clic).
 */
export function useSincronizarCarrito(enabled = true, delay = 450) {
  const { signature, validarCarrito, items } = useCarrito();
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!enabled || !hasItems) return undefined;
    const t = setTimeout(() => { validarCarrito(); }, delay);
    return () => clearTimeout(t);
  }, [enabled, hasItems, signature, validarCarrito, delay]);
}
