// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import NetworkProvider from "./context/NetworkContext";

if (!window.__BALTO_FETCH_PATCHED__) {
  window.__BALTO_FETCH_PATCHED__ = true;

  const realFetch = window.fetch.bind(window);
  const DEFAULT_TIMEOUT_MS = 20000;

  function createMergedSignal(signalA, signalB) {
    if (!signalA) return signalB;
    if (!signalB) return signalA;

    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
      return AbortSignal.any([signalA, signalB]);
    }

    const mergedCtrl = new AbortController();
    const abortMerged = () => {
      if (!mergedCtrl.signal.aborted) mergedCtrl.abort();
    };

    if (signalA.aborted || signalB.aborted) {
      abortMerged();
      return mergedCtrl.signal;
    }

    signalA.addEventListener("abort", abortMerged, { once: true });
    signalB.addEventListener("abort", abortMerged, { once: true });

    return mergedCtrl.signal;
  }

  function normalizeFetchError(error, { input, timeoutMs, timedOut, callerSignal }) {
    const rawMessage = String(error?.message || error || "");
    const isAbort = error?.name === "AbortError" || /abort|aborted/i.test(rawMessage);
    const cancelledByCaller = isAbort && !timedOut && callerSignal?.aborted === true;

    if (cancelledByCaller) {
      const cancelled = new Error("Solicitud cancelada.");
      cancelled.name = "AbortError";
      cancelled.isCancelled = true;
      cancelled.isNetworkError = false;
      return cancelled;
    }

    const offlineNow = typeof navigator !== "undefined" && navigator.onLine === false;
    const message = offlineNow
      ? "Sin conexión. Revisá tu WiFi o Internet."
      : isAbort || timedOut
        ? "La conexión tardó demasiado. Estamos verificando la red."
        : "No se pudo conectar con el servidor. Verificá tu conexión e intentá nuevamente.";

    const friendly = new Error(message);
    friendly.name = isAbort || timedOut ? "TimeoutError" : "NetworkError";
    friendly.isNetworkError = true;
    friendly.isTimeout = Boolean(isAbort || timedOut);
    friendly.originalError = error;
    friendly.url = typeof input === "string" ? input : "";
    friendly.timeoutMs = timeoutMs;
    return friendly;
  }

  window.fetch = async (input, init = {}) => {
    const ctrl = new AbortController();
    const callerSignal = init?.signal;
    const timeoutMs =
      typeof init?.timeoutMs === "number" && init.timeoutMs > 0
        ? init.timeoutMs
        : DEFAULT_TIMEOUT_MS;

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        ctrl.abort("timeout");
      } catch {
        ctrl.abort();
      }
    }, timeoutMs);

    const { timeoutMs: _timeoutMs, signal: _signal, ...fetchInit } = init || {};

    try {
      const response = await realFetch(input, {
        ...fetchInit,
        signal: createMergedSignal(callerSignal, ctrl.signal),
      });

      try {
        window.dispatchEvent(new CustomEvent("net:fetch_ok"));
      } catch {}

      return response;
    } catch (error) {
      const friendly = normalizeFetchError(error, {
        input,
        timeoutMs,
        timedOut,
        callerSignal,
      });

      if (!friendly.isCancelled) {
        try {
          window.dispatchEvent(
            new CustomEvent(friendly.isTimeout ? "net:fetch_timeout" : "net:fetch_failed", {
              detail: {
                error: friendly.message,
                url: typeof input === "string" ? input : "",
                timeoutMs,
              },
            })
          );
        } catch {}
      }

      throw friendly;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <NetworkProvider>
      <App />
    </NetworkProvider>
  </React.StrictMode>
);

reportWebVitals();
