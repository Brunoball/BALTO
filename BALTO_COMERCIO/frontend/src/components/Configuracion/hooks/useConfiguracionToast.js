import { useCallback, useState } from "react";

function defaultNormalizeMessage(value) {
  return String(value || "").trim();
}

export default function useConfiguracionToast({
  defaultDuration = 2800,
  fallbackMessage = "Aviso del sistema.",
  normalizeMessage = defaultNormalizeMessage,
} = {}) {
  const [toast, setToast] = useState(null);

  const mostrarToast = useCallback(
    (tipo, mensaje, duracion = defaultDuration) => {
      setToast({
        tipo,
        mensaje: normalizeMessage(mensaje) || fallbackMessage,
        duracion,
        key: Date.now(),
      });
    },
    [defaultDuration, fallbackMessage, normalizeMessage]
  );

  const cerrarToast = useCallback(() => setToast(null), []);

  return { toast, setToast, mostrarToast, cerrarToast };
}
