// src/context/NetworkContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from "react";
import BASE_URL from "../config/config";
import Toast from "../components/Global/Toast.jsx";

import "../components/Global/Global_css/roots.css";

const NetworkContext = createContext(null);
export const useNetwork = () => useContext(NetworkContext);

const PING_INTERVAL_MS = 2500;
const PING_TIMEOUT_MS = 3500;
const FAILS_TO_LOCK = 2;
const SUCCESSES_TO_UNLOCK = 3;
const BALTO_LOGIN_URL =
  String(process.env.REACT_APP_BALTO_LOGIN_URL || "https://balto.3devsnet.com/").trim() ||
  "https://balto.3devsnet.com/";

function buildPingUrl() {
  const base = String(BASE_URL || "").trim().replace(/\/+$/, "");

  if (/\/api\.php$/i.test(base)) {
    return `${base}?action=ping`;
  }

  if (/\/api\/routes$/i.test(base)) {
    return `${base}/api.php?action=ping`;
  }

  if (/\/api$/i.test(base)) {
    return `${base}.php?action=ping`;
  }

  return `${base}/api.php?action=ping`;
}

async function pingServidor(url, timeoutMs = PING_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) return false;

    const text = await res.text().catch(() => "");
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return data?.exito === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function NetworkProvider({ children }) {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [checking, setChecking] = useState(false);
  const [toastOk, setToastOk] = useState(false);

  const retryTimer = useRef(null);
  const failCountRef = useRef(0);
  const successCountRef = useRef(0);
  const prevOfflineRef = useRef(!navigator.onLine);
  const runningCheckRef = useRef(false);

  const enterOfflineMode = useCallback(() => {
    successCountRef.current = 0;
    setOffline(true);
  }, []);

  const registerFailure = useCallback(() => {
    failCountRef.current += 1;

    if (failCountRef.current >= FAILS_TO_LOCK) {
      enterOfflineMode();
    }
  }, [enterOfflineMode]);

  const registerSuccess = useCallback(() => {
    failCountRef.current = 0;
  }, []);

  const doHealthCheck = useCallback(async (manual = false) => {
    if (runningCheckRef.current) return;
    runningCheckRef.current = true;
    setChecking(true);

    try {
      if (!navigator.onLine) {
        successCountRef.current = 0;
        enterOfflineMode();
        return;
      }

      const ok = await pingServidor(buildPingUrl());

      if (!ok) {
        successCountRef.current = 0;
        enterOfflineMode();
        return;
      }

      // Aunque el ping haya dado bien una vez, no liberamos todavía:
      // exigimos varias seguidas para considerar la red estable.
      successCountRef.current += 1;

      if (successCountRef.current >= SUCCESSES_TO_UNLOCK) {
        failCountRef.current = 0;
        setOffline(false);
      } else if (manual) {
        // Si fue manual y todavía faltan éxitos, mantenemos bloqueado.
        setOffline(true);
      }
    } finally {
      setChecking(false);
      runningCheckRef.current = false;
    }
  }, [enterOfflineMode]);

  useEffect(() => {
    const goOffline = () => {
      enterOfflineMode();
    };

    const goOnline = () => {
      // No liberamos de una:
      // primero verificamos estabilidad real con pings
      successCountRef.current = 0;
      doHealthCheck(true);
    };

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [doHealthCheck, enterOfflineMode]);

  useEffect(() => {
    const onFetchFailed = () => {
      registerFailure();
    };

    const onFetchOk = () => {
      registerSuccess();
    };

    window.addEventListener("net:fetch_failed", onFetchFailed);
    window.addEventListener("net:fetch_timeout", onFetchFailed);
    window.addEventListener("net:fetch_ok", onFetchOk);
    window.addEventListener("net:force_offline", onFetchFailed);

    return () => {
      window.removeEventListener("net:fetch_failed", onFetchFailed);
      window.removeEventListener("net:fetch_timeout", onFetchFailed);
      window.removeEventListener("net:fetch_ok", onFetchOk);
      window.removeEventListener("net:force_offline", onFetchFailed);
    };
  }, [registerFailure, registerSuccess]);

  useEffect(() => {
    if (!offline) {
      successCountRef.current = SUCCESSES_TO_UNLOCK;
      if (retryTimer.current) clearInterval(retryTimer.current);
      retryTimer.current = null;
      return;
    }

    successCountRef.current = 0;

    if (retryTimer.current) clearInterval(retryTimer.current);

    retryTimer.current = setInterval(() => {
      void doHealthCheck(false);
    }, PING_INTERVAL_MS);

    void doHealthCheck(false);

    return () => {
      if (retryTimer.current) clearInterval(retryTimer.current);
      retryTimer.current = null;
    };
  }, [offline, doHealthCheck]);

  useEffect(() => {
    const prev = prevOfflineRef.current;

    if (prev === true && offline === false) {
      setToastOk(true);
    }

    prevOfflineRef.current = offline;
  }, [offline]);

  useEffect(() => {
    return () => {
      if (retryTimer.current) clearInterval(retryTimer.current);
    };
  }, []);

  const value = useMemo(
    () => ({
      offline,
      checking,
      forceNetworkCheck: () => doHealthCheck(true),
    }),
    [offline, checking, doHealthCheck]
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}

      {toastOk && (
        <Toast
          tipo="exito"
          mensaje="Conexión restablecida"
          duracion={4500}
          onClose={() => setToastOk(false)}
        />
      )}

      {offline && (
        <div className="net-overlay">
          <div className="net-box">
            <div className="net-iconWrap" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="72"
                height="72"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="net-icon"
              >
                <path d="M12 20h.01" />
                <path d="M8.5 16.429a5 5 0 0 1 7 0" />
                <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
                <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
                <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
                <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
                <path d="m2 2 20 20" />
              </svg>
            </div>

            <h2 className="net-title">
              {checking ? "Reconectando..." : "Sin conexión"}
            </h2>

            <p className="net-text">
              {checking
                ? "La red todavía no está estable. Estamos verificando nuevamente..."
                : "No pudimos comunicarnos con Internet o con el servidor. Estamos reintentando automáticamente…"}
            </p>

            <div className="net-actions">
              <button
                className="net-btn"
                onClick={() => {
                  void doHealthCheck(true);
                }}
                disabled={checking}
              >
                {checking ? "Verificando..." : "Reintentar ahora"}
              </button>

              <button
                className="net-btnGhost"
                onClick={() => {
                  try {
                    sessionStorage.clear();
                    localStorage.removeItem("token");
                    localStorage.removeItem("session_key");
                    localStorage.removeItem("usuario");
                  } catch {}
                  window.location.href = BALTO_LOGIN_URL;
                }}
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}
    </NetworkContext.Provider>
  );
}
