import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obtenerDashboardResumen } from "../api/dashboardApi";
import {
  EMPTY_DASHBOARD,
  getUsuarioFromStorage,
  normalizePayload,
} from "../utils/dashboardUtils";

export default function useDashboardDatos({ showToast }) {
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);

  const mountedRef = useRef(false);
  const dashboardRequestSeqRef = useRef(0);

  const usuario = useMemo(() => getUsuarioFromStorage(), []);

  const fetchDashboard = useCallback(async () => {
    const requestId = dashboardRequestSeqRef.current + 1;
    dashboardRequestSeqRef.current = requestId;

    setLoadingDashboard(true);

    try {
      const json = await obtenerDashboardResumen(usuario);

      if (!mountedRef.current || requestId !== dashboardRequestSeqRef.current) return;

      setDashboard(normalizePayload(json));
    } catch (error) {
      if (!mountedRef.current || requestId !== dashboardRequestSeqRef.current) return;

      const mensaje = error?.message || "No se pudo cargar el dashboard.";
      setDashboard(EMPTY_DASHBOARD);
      showToast("error", mensaje, 5200);
    } finally {
      if (mountedRef.current && requestId === dashboardRequestSeqRef.current) {
        setLoadingDashboard(false);
      }
    }
  }, [usuario, showToast]);

  useEffect(() => {
    mountedRef.current = true;
    fetchDashboard();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchDashboard]);

  return {
    loadingDashboard,
    dashboard,
    fetchDashboard,
  };
}
