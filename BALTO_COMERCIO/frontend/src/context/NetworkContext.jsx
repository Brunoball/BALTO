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
import { clearClientSession, redirectToCentralAccess } from "../session/sessionClient";
import Toast from "../components/Global/Toast.jsx";

import "../components/Global/Global_css/roots.css";

const NetworkContext = createContext(null);
export const useNetwork = () => useContext(NetworkContext);

const PING_INTERVAL_MS = 2500;
const PING_TIMEOUT_MS = 3500;
const PING_TIMEOUT_CONFIRM_MS = 6000;
const FAILS_TO_LOCK = 2;
const SUCCESSES_TO_UNLOCK = 3;
// Pausa entre los dos pings de confirmación antes de declarar "Sin conexión".
const CONFIRM_RETRY_DELAY_MS = 1500;
// No repetir el aviso de "servidor demorando" más seguido que esto.
const SLOW_NOTICE_COOLDOWN_MS = 30000;

function apiBase() {
  return String(BASE_URL || "").trim().replace(/\/+$/, "");
}

/**
 * Solo cuentan las fallas de requests a NUESTRA API (no R2, CDNs, etc.) y nunca
 * las del propio ping (evita bucles de eventos).
 */
function isRelevantApiFailure(event) {
  const url = String(event?.detail?.url || "");
  if (!url) return true; // sin URL (Request object): por las dudas, verificar
  if (/[?&]action=ping\b/i.test(url)) return false;
  if (/^https?:\/\//i.test(url)) {
    const base = apiBase();
    if (!base) return true;
    try {
      return new URL(url).origin === new URL(base).origin;
    } catch {
      return true;
    }
  }
  return true; // URL relativa = mismo origen
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const [toastSlow, setToastSlow] = useState(false);

  const retryTimer = useRef(null);
  const failCountRef = useRef(0);
  const successCountRef = useRef(0);
  const prevOfflineRef = useRef(!navigator.onLine);
  const runningCheckRef = useRef(false);
  const confirmingRef = useRef(false);
  const lastSlowNoticeRef = useRef(0);
  const offlineRef = useRef(!navigator.onLine);

  const enterOfflineMode = useCallback(() => {
    successCountRef.current = 0;
    setOffline(true);
  }, []);

  /**
   * Una request a la API falló o tardó demasiado. Eso NO alcanza para decir
   * "Sin conexión": antes pasaba lo mismo cuando el servidor estaba lento y el
   * cliente creía que era su WiFi. Ahora confirmamos con pings livianos (no
   * tocan la base): solo si fallan seguidos bloqueamos la pantalla. Si el ping
   * responde, la red está bien y avisamos que el servidor está demorando.
   */
  const confirmFailure = useCallback(async () => {
    if (offlineRef.current || confirmingRef.current) return;

    if (!navigator.onLine) {
      enterOfflineMode();
      return;
    }

    confirmingRef.current = true;
    try {
      let fails = 0;
      for (let i = 0; i < FAILS_TO_LOCK; i += 1) {
        const ok = await pingServidor(buildPingUrl(), PING_TIMEOUT_CONFIRM_MS);
        if (ok) {
          failCountRef.current = 0;
          const now = Date.now();
          if (now - lastSlowNoticeRef.current > SLOW_NOTICE_COOLDOWN_MS) {
            lastSlowNoticeRef.current = now;
            setToastSlow(true);
          }
          return;
        }
        fails += 1;
        if (i < FAILS_TO_LOCK - 1) await sleep(CONFIRM_RETRY_DELAY_MS);
      }

      failCountRef.current = fails;
      if (fails >= FAILS_TO_LOCK) enterOfflineMode();
    } finally {
      confirmingRef.current = false;
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
    const onFetchFailed = (event) => {
      if (!isRelevantApiFailure(event)) return;
      void confirmFailure();
    };

    const onForceOffline = () => {
      void confirmFailure();
    };

    const onFetchOk = () => {
      registerSuccess();
    };

    window.addEventListener("net:fetch_failed", onFetchFailed);
    window.addEventListener("net:fetch_timeout", onFetchFailed);
    window.addEventListener("net:fetch_ok", onFetchOk);
    window.addEventListener("net:force_offline", onForceOffline);

    return () => {
      window.removeEventListener("net:fetch_failed", onFetchFailed);
      window.removeEventListener("net:fetch_timeout", onFetchFailed);
      window.removeEventListener("net:fetch_ok", onFetchOk);
      window.removeEventListener("net:force_offline", onForceOffline);
    };
  }, [confirmFailure, registerSuccess]);

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
    offlineRef.current = offline;
    if (offline) setToastSlow(false);
  }, [offline]);

  useEffect(() => {
    const prev = prevOfflineRef.current;

    if (prev === true && offline === false) {
      setToastOk(true);

      // La conexión ya fue validada como estable (varios pings correctos).
      // Recargamos una sola vez para reconstruir sesión, requests y estado
      // exactamente igual que un F5. Al iniciar de nuevo, prevOfflineRef
      // arranca en false si seguimos online, por lo que no genera un bucle.
      window.location.reload();
      return;
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

      {toastSlow && !offline && (
        <Toast
          tipo="info"
          mensaje="El servidor está demorando más de lo normal. Tu conexión está bien; reintentá en unos segundos."
          duracion={5000}
          onClose={() => setToastSlow(false)}
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
                  clearClientSession();
                  redirectToCentralAccess();
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
