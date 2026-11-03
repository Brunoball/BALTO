import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obtenerResumenAnalisisFinanciero } from "../api/analisisFinancieroApi";
import { formatDateISO } from "../utils/analisisFinancieroUtils";

/**
 * Resumen de Análisis Financiero.
 *
 * Mismo arreglo que useFlujoCajaResumen: la consulta depende de las FECHAS del
 * rango, no de la identidad del objeto `dateRange`. Al cargar la configuración
 * del calendario, DateRangeContext vuelve a construir el mismo rango (mismas
 * fechas, objeto nuevo). Antes eso disparaba otra consulta que ponía
 * `data = null`: las tarjetas quedaban en cero durante la recarga y el botón
 * Exportar fallaba ("No se cargaron los datos para exportar").
 *
 * - Mismas fechas: no se vuelve a consultar.
 * - Refresco del mismo rango (`refetch`): se conservan los datos visibles hasta
 *   que llega la respuesta nueva.
 * - Rango distinto: se limpian los datos para no mostrar importes del rango
 *   anterior con el filtro nuevo (comportamiento original).
 */
export default function useAnalisisFinanciero({ dateRange, onError }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const skelTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const dataRangeKeyRef = useRef("");

  const desde = formatDateISO(dateRange?.from);
  const hasta = formatDateISO(dateRange?.to || dateRange?.from);
  const rangeKey = desde ? `${desde}|${hasta}` : "";

  // Último rango y callback recibidos: la consulta usa siempre los vigentes.
  const dateRangeRef = useRef(dateRange);
  dateRangeRef.current = dateRange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
    const range = dateRangeRef.current;
    if (!range?.from || !rangeKey) return;

    const requestId = ++requestIdRef.current;
    const mismoRango = dataRangeKeyRef.current === rangeKey;
    setLoading(true);
    setError("");
    if (!mismoRango) {
      // Evita mostrar importes de un rango anterior con el filtro nuevo.
      setData(null);
      beginSkeleton();
    }

    try {
      const json = await obtenerResumenAnalisisFinanciero(range);
      if (requestId === requestIdRef.current) {
        dataRangeKeyRef.current = rangeKey;
        setData(json);
      }
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      dataRangeKeyRef.current = "";
      setData(null);
      const msg = e?.message || "Error cargando análisis financiero";
      setError(msg);
      onErrorRef.current?.(msg);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setHasFetched(true);
        endSkeleton();
      }
    }
  }, [rangeKey, beginSkeleton, endSkeleton]);

  // Sólo se vuelve a consultar cuando cambian las fechas.
  useEffect(() => {
    fetchAnalisis();
  }, [fetchAnalisis]);

  return useMemo(() => ({
    data,
    error,
    hasFetched,
    loading,
    showSkeleton,
    refetch: fetchAnalisis,
  }), [data, error, hasFetched, loading, showSkeleton, fetchAnalisis]);
}
