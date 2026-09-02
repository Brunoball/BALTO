import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { obtenerDashboardResumen } from "../api/dashboardApi";
import {
  EMPTY_DASHBOARD,
  getUsuarioFromStorage,
  normalizePayload,
} from "../utils/dashboardUtils";

export default function useDashboardDatos({ ensureListsLoaded, showToast }) {
  const [loadingInicial, setLoadingInicial] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);

  const didWarmupRef = useRef(false);
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
    if (didWarmupRef.current) return;

    didWarmupRef.current = true;

    let alive = true;

    const fallback = setTimeout(() => {
      if (!alive) return;
      setLoadingInicial(false);
    }, 8000);

    (async () => {
      try {
        await ensureListsLoaded({ force: true, background: true });
      } catch {
        // El provider ya maneja el error general de listas.
      } finally {
        if (!alive) return;
        clearTimeout(fallback);
        setLoadingInicial(false);
      }
    })();

    return () => {
      alive = false;
      clearTimeout(fallback);
    };
  }, [ensureListsLoaded]);

  useEffect(() => {
    mountedRef.current = true;
    fetchDashboard();

    return () => {
      mountedRef.current = false;
    };
  }, [fetchDashboard]);

  return {
    loadingInicial,
    loadingDashboard,
    dashboard,
    fetchDashboard,
  };
}
