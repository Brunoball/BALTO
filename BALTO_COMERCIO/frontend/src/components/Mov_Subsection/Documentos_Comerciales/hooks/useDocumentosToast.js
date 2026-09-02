import { useCallback, useState } from "react";

export default function useDocumentosToast() {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((tipo, mensaje, duracion = 3200) => {
    setToast({ tipo, mensaje, duracion });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  return { toast, showToast, closeToast };
}
