import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerResumenAnalisisFinanciero } from "../api/analisisFinancieroApi";

export default function useAnalisisFinanciero({ dateRange, onError }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const skelTimerRef = useRef(null);
  const requestIdRef = useRef(0);

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
      requestIdRef.current += 1;
    };
  }, []);

  const fetchAnalisis = useCallback(async () => {
    if (!dateRange?.from) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setData(null); // Evita mostrar importes de un rango anterior con el filtro nuevo.
    setError("");
    beginSkeleton();

    try {
      const json = await obtenerResumenAnalisisFinanciero(dateRange);
      if (requestId === requestIdRef.current) setData(json);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setData(null);
      const msg = e?.message || "Error cargando análisis financiero";
      setError(msg);
      onError(msg);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setHasFetched(true);
        endSkeleton();
      }
    }
  }, [dateRange, onError, beginSkeleton, endSkeleton]);

  useEffect(() => {
    fetchAnalisis();
  }, [fetchAnalisis]);

  return {
    data,
    error,
    hasFetched,
    loading,
    showSkeleton,
    refetch: fetchAnalisis,
  };
}
