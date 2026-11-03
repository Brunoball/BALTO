import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obtenerResumenFlujoCaja } from "../api/flujoCajaApi";
import { formatDateISO } from "../utils/flujoCajaUtils";

/**
 * Resumen de Flujo de Caja.
 *
 * La consulta depende de las FECHAS del rango, no de la identidad del objeto
 * `dateRange`. Al cargar la configuración del calendario, DateRangeContext
 * vuelve a construir el mismo rango (mismas fechas, objeto nuevo). Antes eso
 * disparaba otra consulta que ponía `data = null`: la tabla quedaba en
 * "Mostrando 0 registros" durante la recarga y, si en ese instante se
 * exportaba, aparecía "No hay datos para exportar".
 *
 * - Mismas fechas: no se vuelve a consultar.
 * - Refresco del mismo rango (p. ej. después de un ajuste de saldo): se
 *   conservan los datos visibles hasta que llega la respuesta nueva.
 * - Rango distinto: se limpian los datos para no mostrar importes del rango
 *   anterior con el filtro nuevo (comportamiento original).
 */
export default function useFlujoCajaResumen(dateRange, showToast) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const skelTimerRef = useRef(null);
  const requestIdRef = useRef(0);
  const dataRangeKeyRef = useRef("");

  const desde = formatDateISO(dateRange?.from);
  const hasta = formatDateISO(dateRange?.to || dateRange?.from);
  const rangeKey = desde ? `${desde}|${hasta}` : "";

  // Último rango recibido: la consulta usa siempre las fechas vigentes.
  const dateRangeRef = useRef(dateRange);
  dateRangeRef.current = dateRange;

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

  const fetchResumen = useCallback(async () => {
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
      const json = await obtenerResumenFlujoCaja(range);
      if (requestId === requestIdRef.current) {
        dataRangeKeyRef.current = rangeKey;
        setData(json);
      }
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      dataRangeKeyRef.current = "";
      setData(null);
      const msg = e?.message || "Error cargando flujo de caja";
      setError(msg);
      showToast?.("error", msg, 4200);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        endSkeleton();
      }
    }
  }, [rangeKey, showToast, beginSkeleton, endSkeleton]);

  // Sólo se vuelve a consultar cuando cambian las fechas (o showToast).
  useEffect(() => {
    fetchResumen();
  }, [fetchResumen]);

  return useMemo(() => ({
    data,
    error,
    fetchResumen,
    loading,
    showSkeleton,
  }), [data, error, fetchResumen, loading, showSkeleton]);
}
