import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import BASE_URL from "../config/config";

// ─── helpers de fecha ────────────────────────────────────────────────────────

function startOfDay(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function normalizeDiasAtras(dias) {
  return Math.max(0, Math.min(Number(dias) || 0, 365));
}

function sameDay(a, b) {
  const da = startOfDay(a);
  const db = startOfDay(b);

  if (!da || !db) return false;

  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function sameMaybeDay(a, b) {
  if (!a && !b) return true;
  return sameDay(a, b);
}

function sameRange(a, b) {
  if (!a || !b) return false;
  return sameMaybeDay(a.from, b.from) && sameMaybeDay(a.to, b.to);
}

// ─── helpers de rango ────────────────────────────────────────────────────────

function rangoMesCompleto() {
  const now = new Date();

  return {
    from: startOfMonth(now),
    to: endOfMonth(now),
  };
}

function rangoDiasAtras(dias) {
  const d = normalizeDiasAtras(dias);

  const to = endOfDay(new Date());
  const from = startOfDay(new Date());

  from.setDate(from.getDate() - d);

  return { from, to };
}

function buildRangeFromConfig(config) {
  if (!config) return rangoMesCompleto();

  if (config.modo === "dias_atras") {
    return rangoDiasAtras(config.dias_atras ?? 10);
  }

  return rangoMesCompleto();
}

function normalizeConfig(config) {
  const modo = ["mes_completo", "dias_atras"].includes(config?.modo)
    ? config.modo
    : "mes_completo";

  const dias_atras = normalizeDiasAtras(config?.dias_atras ?? 10);

  return {
    modo,
    dias_atras,
  };
}

/**
 * Normaliza cualquier rango que venga de una vista.
 *
 * La configuración del calendario define SOLO el rango inicial al entrar al panel
 * o al guardar una nueva configuración. Después, si el usuario elige otro
 * período, ese rango se respeta y no se pisa automáticamente.
 */
function sanitizeRangeForConfig(range, config) {
  const cfg = normalizeConfig(config);
  const from = startOfDay(range?.from);
  const to = range?.to ? endOfDay(range.to) : null;

  if (!from && !to) {
    return buildRangeFromConfig(cfg);
  }

  if (from && to && from > to) {
    return {
      from: startOfDay(to),
      to: endOfDay(from),
    };
  }

  return { from, to };
}

function getConfigSignature(config) {
  const cfg = normalizeConfig(config);
  return `${cfg.modo}_${cfg.dias_atras}`;
}

// ─── helpers de sesión ───────────────────────────────────────────────────────

function getSessionKey() {
  return (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    ""
  ).trim();
}

function getTenantId() {
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null") || {};

    return (
      u?.idTenant ||
      u?.id_tenant ||
      u?.tenant_id ||
      u?.tenant?.idTenant ||
      ""
    );
  } catch {
    return "";
  }
}

// ─── caché en sessionStorage ─────────────────────────────────────────────────

const CACHE_KEY = "cfg_calendario_v2";

function getLocalCachedConfig() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    return normalizeConfig(parsed);
  } catch {
    return null;
  }
}

function saveLocalCachedConfig(cfg) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(normalizeConfig(cfg)));

    // Limpio caché vieja para que no quede arrastrando datos anteriores.
    sessionStorage.removeItem("cfg_calendario");
  } catch {
    // sin acción
  }
}

const DEFAULT_CONFIG = { modo: "mes_completo", dias_atras: 10 };

function initialState() {
  const cached = getLocalCachedConfig();
  const config = cached ?? DEFAULT_CONFIG;
  const cleanConfig = normalizeConfig(config);

  return {
    dateRange: buildRangeFromConfig(cleanConfig),
    calendarConfig: cleanConfig,
    configLoaded: !!cached,
  };
}

// ─── contexto ────────────────────────────────────────────────────────────────

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const init = initialState();

  const [dateRange, setDateRangeState] = useState(init.dateRange);
  const [calendarConfig, setCalendarConfig] = useState(init.calendarConfig);
  const [configLoaded, setConfigLoaded] = useState(init.configLoaded);

  const userTouchedRange = useRef(false);
  const lastConfigSignature = useRef(getConfigSignature(init.calendarConfig));

  // ── maxDate: solo queda disponible para usos explícitos.
  // La configuración NO debe bloquear rangos elegidos manualmente. ───────────

  const maxDate = null;

  // ── rango inicial sugerido por configuración ──────────────────────────────

  const enforcedRange = useMemo(() => {
    return buildRangeFromConfig(calendarConfig);
  }, [calendarConfig]);

  // ── setter interno seguro ─────────────────────────────────────────────────

  const setSafeDateRange = useCallback(
    (range) => {
      const sanitized = sanitizeRangeForConfig(range, calendarConfig);

      setDateRangeState((prev) => {
        if (sameRange(prev, sanitized)) return prev;
        return sanitized;
      });
    },
    [calendarConfig]
  );

  // ── cargar config desde API ───────────────────────────────────────────────

  useEffect(() => {
    let alive = true;

    async function fetchConfig() {
      const tenantId = getTenantId();

      if (!tenantId) {
        if (alive) setConfigLoaded(true);
        return;
      }

      try {
        const sessionKey = getSessionKey();
        const headers = sessionKey ? { "X-Session": sessionKey } : {};

        const url =
          `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php` +
          `?action=configuracion_calendario_get&idTenant=${encodeURIComponent(
            tenantId
          )}`;

        const res = await fetch(url, { method: "GET", headers });
        const data = await res.json().catch(() => null);

        if (!alive) return;

        if (data?.exito && data?.config) {
          const cfg = normalizeConfig({
            modo: data.config.modo ?? "mes_completo",
            dias_atras: Number(data.config.dias_atras ?? 10),
          });

          const nextSignature = getConfigSignature(cfg);

          saveLocalCachedConfig(cfg);
          setCalendarConfig(cfg);
          lastConfigSignature.current = nextSignature;

          /**
           * La configuración se aplica como rango inicial únicamente mientras
           * el usuario no haya elegido manualmente otro período.
           */
          if (!userTouchedRange.current) {
            setDateRangeState(buildRangeFromConfig(cfg));
          }
        }
      } catch {
        // fallback al estado inicial
      } finally {
        if (alive) setConfigLoaded(true);
      }
    }

    fetchConfig();

    return () => {
      alive = false;
    };
  }, []);

  // ── setter público usado por las vistas ────────────────────────────────────

  const setDateRangeUser = useCallback(
    (newRange) => {
      userTouchedRange.current = true;
      setSafeDateRange(newRange);
    },
    [setSafeDateRange]
  );

  // ── cuando se guarda una nueva config desde el panel ──────────────────────

  const applyCalendarConfig = useCallback((cfg) => {
    const cleanConfig = normalizeConfig(cfg);

    saveLocalCachedConfig(cleanConfig);
    setCalendarConfig(cleanConfig);

    lastConfigSignature.current = getConfigSignature(cleanConfig);
    userTouchedRange.current = false;

    setDateRangeState(buildRangeFromConfig(cleanConfig));
  }, []);

  // ── método útil por si alguna vista necesita volver al rango global ───────

  const resetDateRangeToGlobalConfig = useCallback(() => {
    userTouchedRange.current = false;
    setDateRangeState(buildRangeFromConfig(calendarConfig));
  }, [calendarConfig]);

  return (
    <DateRangeContext.Provider
      value={{
        dateRange,
        setDateRange: setDateRangeUser,
        calendarConfig,
        configLoaded,
        maxDate,
        enforcedRange,
        applyCalendarConfig,
        resetDateRangeToGlobalConfig,
      }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);

  if (!ctx) {
    throw new Error("useDateRange debe usarse dentro de DateRangeProvider");
  }

  return ctx;
}