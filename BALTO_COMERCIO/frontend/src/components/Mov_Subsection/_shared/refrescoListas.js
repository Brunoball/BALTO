// Refresco de las listas globales (productos, materiales e insumos con su stock).
//
// ListasContext escucha "balto:listas-updated" y recarga las listas en segundo
// plano (sin bloquear la pantalla). Los formularios de movimientos toman el stock
// de esas listas, así que se refrescan:
//   - al abrir cada formulario (useRefrescarListasAlAbrir), para mostrar siempre
//     el stock actual aunque haya cambiado en otra sección u otro usuario;
//   - después de cada operación que mueve stock (notificarStockActualizado).
import { useEffect } from "react";

export function notificarStockActualizado() {
  try {
    window.dispatchEvent(new Event("balto:listas-updated"));
  } catch {}
}

export function useRefrescarListasAlAbrir(open) {
  useEffect(() => {
    if (open) notificarStockActualizado();
  }, [open]);
}
