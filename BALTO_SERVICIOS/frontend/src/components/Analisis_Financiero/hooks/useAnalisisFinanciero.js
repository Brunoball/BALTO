import { useCallback, useEffect, useRef, useState } from "react";
import { obtenerResumenAnalisisFinanciero } from "../api/analisisFinancieroApi";

export default function useAnalisisFinanciero({ dateRange, onError }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
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

  const fetchAnalisis = useCallback(async () => {
    if (!dateRange?.from) return;

    setLoading(true);
    setError("");
    beginSkeleton();

    try {
      const json = await obtenerResumenAnalisisFinanciero(dateRange);
      setData(json);
    } catch (e) {
      setData(null);
      const msg = e?.message || "Error cargando análisis financiero";
      setError(msg);
      onError(msg);
    } finally {
      setLoading(false);
      setHasFetched(true);
      endSkeleton();
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
