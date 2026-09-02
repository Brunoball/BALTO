import { useCallback, useState } from "react";

export default function useVentasToast() {
  const [toast, setToast] = useState(null);
  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => setToast({ tipo, mensaje, duracion }),
    []
  );
  const closeToast = useCallback(() => setToast(null), []);

  return { toast, showToast, closeToast };
}
