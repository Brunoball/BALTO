import { useCallback, useEffect, useRef, useState } from "react";

export default function useRecibosToast() {
  const [toast, setToast] = useState(null);
  const toastRafRef = useRef(null);

  const showToast = useCallback((tipo, mensaje) => {
    if (toastRafRef.current) {
      cancelAnimationFrame(toastRafRef.current);
      toastRafRef.current = null;
    }
    const nextId = Date.now() + Math.random();
    setToast(null);
    toastRafRef.current = window.requestAnimationFrame(() => {
      setToast({ id: nextId, tipo, mensaje });
      toastRafRef.current = null;
    });
  }, []);

  const closeToast = useCallback(() => {
    if (toastRafRef.current) {
      cancelAnimationFrame(toastRafRef.current);
      toastRafRef.current = null;
    }
    setToast(null);
  }, []);

  useEffect(() => () => {
    if (toastRafRef.current) cancelAnimationFrame(toastRafRef.current);
  }, []);

  return { toast, showToast, closeToast };
}
