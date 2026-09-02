import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerResumenFlujoCaja } from "../api/flujoCajaApi";

export default function useFlujoCajaResumen(dateRange, showToast) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const skelTimerRef = useRef(null);

  const beginSkeleton = useCallback(() => {
    if (skelTimerRef.current) clearTimeout(skelTimerRef.current);
    setShowSkeleton(false);
    skelTimerRef.current = setTimeout(() => setShowSkeleton(true), 120);
  }, []);

  const endSkeleton = useCallback(() => {
    if (skelTimerRef.current) clearTimeout(skelTimerRef.current);
    setShowSkeleton(false);
  }, []);

  useEffect(() => {
    return () => {
      if (skelTimerRef.current) clearTimeout(skelTimerRef.current);
    };
  }, []);

  const fetchResumen = useCallback(async () => {
    if (!dateRange?.from) return;

    setLoading(true);
    setError("");
    beginSkeleton();

    try {
      const json = await obtenerResumenFlujoCaja(dateRange);
      setData(json);
    } catch (e) {
      setData(null);
      const msg = e?.message || "Error cargando flujo de caja";
      setError(msg);
      showToast?.("error", msg, 4200);
    } finally {
      setLoading(false);
      endSkeleton();
    }
  }, [dateRange, showToast, beginSkeleton, endSkeleton]);

  useEffect(() => {
    fetchResumen();
  }, [fetchResumen]);

  return {
    data,
    error,
    fetchResumen,
    loading,
    showSkeleton,
  };
}
