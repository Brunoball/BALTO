const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEV_PORT = "3000";
const HANDOFF_PARAM = "balto_auth";
const MAX_PENDING_AGE_MS = 30 * 60 * 1000;

const QUERY_RETURN = "balto_dev_return";
const QUERY_SYSTEM = "balto_dev_system";
const QUERY_ISSUED = "balto_dev_issued";

const GENERIC_PENDING_KEY = "balto_dev_return_v2";
const LEGACY_KEYS = {
  COMERCIO: "balto_comercio_dev_return_v1",
  SERVICIOS: "balto_servicios_dev_return_v1",
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeSystem(value) {
  return String(value || "").trim().toUpperCase();
}

function isAllowedLocalReturn(raw) {
  try {
    const url = new URL(String(raw || ""));
    return (
      url.protocol === "http:" &&
      DEV_HOSTS.has(String(url.hostname || "").toLowerCase()) &&
      url.port === DEV_PORT
    );
  } catch {
    return false;
  }
}

function isFresh(issuedAt) {
  const ts = Number(issuedAt || 0);
  const age = Date.now() - ts;
  return (
    Number.isFinite(ts) &&
    ts > 0 &&
    age >= -5000 &&
    age <= MAX_PENDING_AGE_MS
  );
}

function encodeBase64UrlUtf8(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseStoredIntent(raw, fallbackSystem = "") {
  try {
    const parsed = JSON.parse(String(raw || ""));
    const returnTo = String(parsed?.return_to || "").trim();
    const system = normalizeSystem(parsed?.system || parsed?.sistema || fallbackSystem);
    const issuedAt = Number(parsed?.created_at || parsed?.issued_at || 0);

    if (!isAllowedLocalReturn(returnTo) || !isFresh(issuedAt)) return null;
    if (!["COMERCIO", "SERVICIOS"].includes(system)) return null;

    return { returnTo, system, issuedAt };
  } catch {
    return null;
  }
}

function readIntentFromQuery() {
  if (!isBrowser()) return null;

  const params = new URLSearchParams(window.location.search || "");
  const returnTo = String(params.get(QUERY_RETURN) || "").trim();
  if (!returnTo) return null;

  const system = normalizeSystem(params.get(QUERY_SYSTEM));
  const issuedAt = Number(params.get(QUERY_ISSUED) || 0);

  if (!isAllowedLocalReturn(returnTo) || !isFresh(issuedAt)) return null;
  if (!["COMERCIO", "SERVICIOS"].includes(system)) return null;

  return { returnTo, system, issuedAt, source: "query" };
}

function readIntentFromStorage() {
  if (!isBrowser()) return null;

  try {
    const generic = localStorage.getItem(GENERIC_PENDING_KEY);
    const parsedGeneric = parseStoredIntent(generic);
    if (parsedGeneric) return { ...parsedGeneric, source: GENERIC_PENDING_KEY };
    if (generic) localStorage.removeItem(GENERIC_PENDING_KEY);
  } catch {}

  for (const [system, key] of Object.entries(LEGACY_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = parseStoredIntent(raw, system);
      if (parsed) return { ...parsed, source: key };
      if (raw) localStorage.removeItem(key);
    } catch {}
  }

  return null;
}

function readPendingIntent() {
  return readIntentFromQuery() || readIntentFromStorage();
}

function clearPendingIntent() {
  if (!isBrowser()) return;

  try {
    localStorage.removeItem(GENERIC_PENDING_KEY);
    Object.values(LEGACY_KEYS).forEach((key) => localStorage.removeItem(key));
  } catch {}
}

/**
 * Si el login fue abierto por un frontend local, devuelve la nueva sesión
 * directamente a localhost mediante #balto_auth=..., sin abrir el build
 * productivo de COMERCIO/SERVICIOS en Hostinger.
 *
 * Retorna true cuando realizó el redirect local; false cuando fue un login
 * productivo normal. Lanza error si hay un retorno local válido pero la cuenta
 * autenticada pertenece a otra vertical.
 */
export function redirectLoginToPendingLocalFrontend({ sessionKey, usuario, sistema }) {
  if (!isBrowser()) return false;

  const pending = readPendingIntent();
  if (!pending) return false;

  const loggedSystem = normalizeSystem(
    sistema?.codigo || usuario?.sistema_codigo || usuario?.sistema?.codigo
  );

  if (loggedSystem !== pending.system) {
    clearPendingIntent();
    throw new Error(
      `Abriste BALTO_${pending.system} en localhost, pero la cuenta ingresada pertenece a ${loggedSystem || "otra vertical"}.`
    );
  }

  const key = String(sessionKey || "").trim();
  if (!key || !usuario || typeof usuario !== "object") {
    clearPendingIntent();
    throw new Error("No se pudo preparar la sesión para el frontend local.");
  }

  const target = new URL(pending.returnTo);
  const payload = {
    v: 1,
    issued_at: Date.now(),
    session_key: key,
    usuario: JSON.stringify(usuario),
  };

  const fragment = new URLSearchParams();
  fragment.set(HANDOFF_PARAM, encodeBase64UrlUtf8(JSON.stringify(payload)));
  target.hash = fragment.toString();

  clearPendingIntent();
  window.location.replace(target.toString());
  return true;
}
