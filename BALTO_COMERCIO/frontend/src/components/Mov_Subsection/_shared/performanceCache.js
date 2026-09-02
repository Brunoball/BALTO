const CACHE_PREFIX = "balto_movimientos_perf_v2";
const DEFAULT_TTL_MS = 45 * 1000;
const LONG_TTL_MS = 10 * 60 * 1000;

function safeStorage() {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

function authScope() {
  try {
    const sessionKey = String(
      localStorage.getItem("session_key") ||
        localStorage.getItem("sessionKey") ||
        localStorage.getItem("X-Session") ||
        ""
    ).trim();

    const usuarioRaw = localStorage.getItem("usuario") || "";
    let userId = "";
    if (usuarioRaw) {
      try {
        const u = JSON.parse(usuarioRaw);
        userId = String(u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? "").trim();
      } catch {}
    }

    return `${sessionKey.slice(0, 18)}:${userId}`;
  } catch {
    return "anon";
  }
}

export function movPerfKey(scope, parts = []) {
  const cleanScope = String(scope || "general").replace(/[^a-zA-Z0-9:_-]/g, "_");
  const cleanParts = (Array.isArray(parts) ? parts : [parts])
    .map((p) => String(p ?? "").trim())
    .join("|");
  return `${CACHE_PREFIX}:${authScope()}:${cleanScope}:${cleanParts}`;
}

export function readMovPerfCache(scope, parts = [], ttlMs = DEFAULT_TTL_MS) {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(movPerfKey(scope, parts));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const savedAt = Number(parsed?.savedAt || 0);
    const age = Date.now() - savedAt;
    if (!savedAt || age > Math.max(1000, Number(ttlMs || DEFAULT_TTL_MS))) {
      storage.removeItem(movPerfKey(scope, parts));
      return null;
    }
    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

export function writeMovPerfCache(scope, parts = [], payload = null) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(
      movPerfKey(scope, parts),
      JSON.stringify({ savedAt: Date.now(), payload })
    );
  } catch {
    // Si sessionStorage está lleno o bloqueado, la app sigue funcionando sin cache persistente.
  }
}

export function clearMovPerfCache(scopePrefix = "") {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const scope = String(scopePrefix || "").replace(/[^a-zA-Z0-9:_-]/g, "_");
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(`${CACHE_PREFIX}:`)) continue;
      if (!scope || k.includes(`:${scope}:`) || k.includes(`:${scope}`)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {}
}

export function scheduleMovIdle(fn, delayMs = 0) {
  if (typeof fn !== "function") return () => {};
  let cancelled = false;
  let idleId = null;
  let timerId = null;

  const run = () => {
    if (!cancelled) fn();
  };

  try {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: Math.max(200, Number(delayMs || 0) + 500) });
    } else {
      timerId = setTimeout(run, Math.max(0, Number(delayMs || 0)));
    }
  } catch {
    timerId = setTimeout(run, Math.max(0, Number(delayMs || 0)));
  }

  return () => {
    cancelled = true;
    try {
      if (idleId !== null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    } catch {}
    if (timerId !== null) clearTimeout(timerId);
  };
}

export const MOV_CACHE_TTL_MS = DEFAULT_TTL_MS;
export const MOV_CACHE_LONG_TTL_MS = LONG_TTL_MS;
