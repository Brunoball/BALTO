// src/utils/fetchWithGuard.js
const DEFAULT_TIMEOUT_MS = 12000;

function mergeSignals(signalA, signalB) {
  if (!signalA) return signalB;
  if (!signalB) return signalA;

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any([signalA, signalB]);
  }

  return signalB;
}

export async function fetchWithGuard(input, init = {}) {
  const ctrl = new AbortController();
  const timeoutMs = Number(init.timeoutMs || DEFAULT_TIMEOUT_MS);

  const timeoutId = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);

  try {
    const res = await fetch(input, {
      ...init,
      signal: mergeSignals(init.signal, ctrl.signal),
    });

    window.dispatchEvent(new CustomEvent("net:fetch_ok"));

    return res;
  } catch (err) {
    const isAbort = err?.name === "AbortError";

    window.dispatchEvent(
      new CustomEvent(isAbort ? "net:fetch_timeout" : "net:fetch_failed", {
        detail: {
          url: typeof input === "string" ? input : "",
          timeoutMs,
        },
      })
    );

    throw new Error(
      isAbort
        ? "La conexión tardó demasiado. Verificá tu red."
        : "No se pudo conectar con el servidor."
    );
  } finally {
    clearTimeout(timeoutId);
  }
}