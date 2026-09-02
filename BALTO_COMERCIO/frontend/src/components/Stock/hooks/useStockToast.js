import { useCallback, useEffect, useState } from "react";
import { tiendaNubeFeedback } from "../../../utils/tiendaNubeSync";
import { esToastCarga, tiendaNubeNoConectada } from "../utils/stockUtils";

const TOAST_LOADING_DURATION = 300000;

export default function useStockToast() {
  const [toast, setToast] = useState(null);

  const mostrarToast = useCallback((tipo, mensaje, duracion = 2500) => {
    setToast({ tipo, mensaje, duracion, id: Date.now() + Math.random() });
  }, []);

  const mostrarToastCarga = useCallback(
    (mensaje) => {
      mostrarToast("loading", mensaje, TOAST_LOADING_DURATION);
    },
    [mostrarToast]
  );

  const mostrarResultadoTiendaNube = useCallback(
    (response, mensajeLocal) => {
      const sync =
        response?.tiendanube_sync ??
        response?.tiendanube_delete ??
        response?.tiendanube_sync_producto ??
        response?.data?.tiendanube_sync ??
        response?.data?.tiendanube_delete ??
        response?.data?.tiendanube_sync_producto ??
        response?.data ??
        response ??
        null;

      if (tiendaNubeNoConectada(response)) {
        mostrarToast("exito", mensajeLocal, 2500);
        return;
      }

      const encolados = Number(sync?.encolados ?? sync?.pendientes ?? 0);
      const erroresCola = Number(sync?.errores ?? 0);
      const colaAceptada =
        encolados > 0 &&
        erroresCola === 0 &&
        (sync?.procesamiento_segundo_plano === true ||
          sync?.requiere_procesamiento_cliente === true ||
          Array.isArray(sync?.resultados));

      if (colaAceptada) {
        mostrarToast("exito", mensajeLocal, 2500);
        return;
      }

      const feedback = tiendaNubeFeedback(response, mensajeLocal);
      mostrarToast(
        feedback.tipo,
        feedback.mensaje,
        feedback.tipo === "advertencia" ? 5000 : 2500
      );
    },
    [mostrarToast]
  );

  const mostrarResultadoTiendaNubeConfirmado = useCallback(
    (response, mensajeLocal, confirmacion) => {
      if (!confirmacion?.esperado) {
        mostrarResultadoTiendaNube(response, mensajeLocal);
        return;
      }

      if (confirmacion.exitoso) {
        mostrarToast("exito", mensajeLocal, 2500);
        return;
      }

      const detalle = String(confirmacion?.error || "").trim();
      mostrarToast(
        "advertencia",
        confirmacion?.finalizado
          ? `${mensajeLocal} Tienda Nube no pudo completar el cambio: ${detalle || "revisá la sincronización."}`
          : `${mensajeLocal} Tienda Nube sigue procesando el cambio y quedó protegido en la cola.`,
        8000
      );
    },
    [mostrarResultadoTiendaNube, mostrarToast]
  );

  const cerrarToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast || !esToastCarga(toast.tipo) || !Number(toast.duracion || 0)) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), Number(toast.duracion));
    return () => window.clearTimeout(timer);
  }, [toast]);

  return {
    toast,
    cerrarToast,
    mostrarResultadoTiendaNube,
    mostrarResultadoTiendaNubeConfirmado,
    mostrarToast,
    mostrarToastCarga,
  };
}
