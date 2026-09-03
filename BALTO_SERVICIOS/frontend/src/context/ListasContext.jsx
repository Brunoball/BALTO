// src/context/ListasContext.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import BASE_URL from "../config/config";

const LISTS_TTL_MS = 0;
const CACHE_PREFIX = "balto_lists_cache_v1";

function getSessionKey() {
  return String(localStorage.getItem("session_key") || "").trim();
}

function getCacheKey() {
  const sk = getSessionKey();
  const tag = sk ? sk.slice(0, 12) : "nosession";
  return `${CACHE_PREFIX}:${tag}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function periodoToMMYYYY(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";

  let m = "";
  let y = "";

  if (/^\d{4}[-/]\d{1,2}$/.test(s)) {
    const parts = s.split(/[-/]/);
    y = parts[0];
    m = parts[1];
  } else if (/^\d{1,2}[-/]\d{4}$/.test(s)) {
    const parts = s.split(/[-/]/);
    m = parts[0];
    y = parts[1];
  } else if (/^\d{6}$/.test(s)) {
    const a = Number(s.slice(0, 4));
    if (a >= 1900 && a <= 2100) {
      y = s.slice(0, 4);
      m = s.slice(4);
    } else {
      m = s.slice(0, 2);
      y = s.slice(2);
    }
  } else {
    return s;
  }

  const mm = String(Number(m)).padStart(2, "0");
  const yyyy = String(y);
  return `${mm}-${yyyy}`;
}

const emptyLists = {
  periodos: [],
  clasificaciones: [],
  clientes: [],
  cuentas_corrientes: [],
  detalles: [],
  detalles_ingresos: [],
  medios_pago: [],
  proveedores: [],
  tipos_movimiento: [],
  tipos_venta: [],
  tipos_operacion: [],
  stock_categorias: [],
  stock_tipos_precio: [],
};

function normalizeLists(raw) {
  const src = raw?.listas && typeof raw.listas === "object" ? raw.listas : raw;
  const getArr = (k) => (Array.isArray(src?.[k]) ? src[k] : []);
  const periodosUI = (getArr("periodos") || []).map(periodoToMMYYYY);

  return {
    periodos: periodosUI,
    clasificaciones: getArr("clasificaciones"),
    clientes: getArr("clientes"),
    cuentas_corrientes: getArr("cuentas_corrientes"),
    detalles: getArr("detalles"),
    detalles_ingresos: getArr("detalles_ingresos"),
    medios_pago: getArr("medios_pago"),
    proveedores: getArr("proveedores"),
    tipos_movimiento: getArr("tipos_movimiento"),
    tipos_venta: getArr("tipos_venta"),
    tipos_operacion: getArr("tipos_operacion"),
    stock_categorias: getArr("stock_categorias"),
    stock_tipos_precio: getArr("stock_tipos_precio"),
  };
}

const ListasCtx = createContext(null);

export function ListasProvider({ children }) {
  const API = `${BASE_URL}/api.php`;

  const [lists, setLists] = useState(emptyLists);
  const [loadingLists, setLoadingLists] = useState(false);
  const [errorLists, setErrorLists] = useState("");
  const [lastUpdated, setLastUpdated] = useState(0);

  const inflightRef = useRef(null);
  const requestSeqRef = useRef(0);

  const buildHeadersGET = useCallback(() => {
    const sk = getSessionKey();
    const h = {};
    if (sk) h["X-Session"] = sk;
    return h;
  }, []);

  const parseJsonOrThrow = useCallback(async (res) => {
    const text = await res.text();
    if (!text) throw new Error("Respuesta vacía del servidor.");
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.length > 700 ? text.slice(0, 700) + "..." : text;
      throw new Error(`Respuesta inválida (no es JSON). HTTP ${res.status}\n${preview}`);
    }
    return data;
  }, []);

  const fetchLists = useCallback(async () => {
    const url = `${API}?action=global_obtener_listas&_ts=${Date.now()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: buildHeadersGET(),
    });
    const data = await parseJsonOrThrow(res);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar listas.");
    return normalizeLists(data);
  }, [API, buildHeadersGET, parseJsonOrThrow]);

  const writeCache = useCallback((_payload) => {
    // Las listas globales contienen entidades editables (clientes/proveedores/stock).
    // No se persisten en localStorage para evitar que los selectores muestren datos viejos.
  }, []);

  const readCache = useCallback(() => {
    // Cache desactivada: cada carga real consulta al backend con timestamp para evitar datos viejos.
    return null;
  }, []);

  const clearListsCache = useCallback(() => {
    try {
      const key = getCacheKey();
      localStorage.removeItem(key);
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`${CACHE_PREFIX}:`)) {
          localStorage.removeItem(k);
        }
      }
    } catch {}
  }, []);

  const ensureListsLoaded = useCallback(
    async ({ force = false, background = false } = {}) => {
      const cached = readCache();
      const now = Date.now();
      const cacheFresh = cached && now - Number(cached.ts || 0) <= LISTS_TTL_MS;

      if (cached?.lists && !force) {
        setLists(cached.lists);
        setLastUpdated(Number(cached.ts) || now);
      }

      if (cacheFresh && !force) {
        return cached.lists;
      }

      if (inflightRef.current && !force) {
        return inflightRef.current;
      }

      const doRequest = (async () => {
        const requestSeq = ++requestSeqRef.current;
        if (!background) setLoadingLists(true);
        setErrorLists("");

        try {
          const fresh = await fetchLists();
          if (requestSeq === requestSeqRef.current) {
            setLists(fresh);
            setLastUpdated(Date.now());
            writeCache(fresh);
          }
          return fresh;
        } catch (e) {
          const msg = e?.message || "Error cargando listas.";
          if (requestSeq === requestSeqRef.current) {
            setErrorLists(msg);
            if (!cached?.lists) setLists(emptyLists);
          }
          return cached?.lists || emptyLists;
        } finally {
          if (requestSeq === requestSeqRef.current) {
            setLoadingLists(false);
            inflightRef.current = null;
          }
        }
      })();

      inflightRef.current = doRequest;
      return doRequest;
    },
    [fetchLists, readCache, writeCache]
  );

  useEffect(() => {
    const cached = readCache();
    if (cached?.lists) {
      setLists(cached.lists);
      setLastUpdated(Number(cached.ts) || 0);
    }

    ensureListsLoaded({ force: false, background: true });
  }, [readCache, ensureListsLoaded]);

  useEffect(() => {
    const handleListsUpdated = async () => {
      clearListsCache();
      await ensureListsLoaded({ force: true, background: true });
    };

    window.addEventListener("balto:listas-updated", handleListsUpdated);
    window.addEventListener("balto:clientes-updated", handleListsUpdated);
    window.addEventListener("balto:proveedores-updated", handleListsUpdated);
    return () => {
      window.removeEventListener("balto:listas-updated", handleListsUpdated);
      window.removeEventListener("balto:clientes-updated", handleListsUpdated);
      window.removeEventListener("balto:proveedores-updated", handleListsUpdated);
    };
  }, [clearListsCache, ensureListsLoaded]);

  const refreshLists = useCallback(async () => {
    clearListsCache();
    return await ensureListsLoaded({ force: true, background: false });
  }, [clearListsCache, ensureListsLoaded]);

  const value = useMemo(
    () => ({
      lists,
      loadingLists,
      errorLists,
      lastUpdated,
      ensureListsLoaded,
      refreshLists,
      clearListsCache,
      setLists,
    }),
    [lists, loadingLists, errorLists, lastUpdated, ensureListsLoaded, refreshLists, clearListsCache]
  );

  return <ListasCtx.Provider value={value}>{children}</ListasCtx.Provider>;
}

export function useListas() {
  const ctx = useContext(ListasCtx);
  if (!ctx) {
    throw new Error("useListas() debe usarse dentro de <ListasProvider />");
  }
  return ctx;
}
