const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEV_PORT = "3000";
const HANDOFF_PARAM = "balto_auth";
const MAX_HANDOFF_AGE_MS = 20 * 60 * 1000;
const BRIDGE_VERSION = "20260903_v12";

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isLocalDevelopmentOrigin() {
  if (!isBrowser()) return false;
  const { protocol, hostname, port } = window.location;
  return protocol === "http:" && DEV_HOSTS.has(hostname) && port === DEV_PORT;
}

function decodeBase64UrlUtf8(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseStoredUser(raw) {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function cleanHandoffFragment() {
  try {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(window.history.state, "", cleanUrl || "/");
  } catch {}
}

function consumeHandoffFromFragment() {
  if (!isLocalDevelopmentOrigin()) return false;

  const rawHash = String(window.location.hash || "").replace(/^#/, "");
  if (!rawHash) return false;

  const params = new URLSearchParams(rawHash);
  const encoded = params.get(HANDOFF_PARAM);
  if (!encoded) return false;

  try {
    const payload = JSON.parse(decodeBase64UrlUtf8(encoded));
    const sessionKey = String(payload?.session_key || "").trim();
    const usuarioRaw = String(payload?.usuario || "").trim();
    const usuario = parseStoredUser(usuarioRaw);
    const issuedAt = Number(payload?.issued_at || 0);
    const age = Date.now() - issuedAt;

    if (payload?.v !== 1) throw new Error("Versión de handoff inválida.");
    if (!sessionKey || !usuario) throw new Error("Handoff incompleto.");
    if (
      !Number.isFinite(issuedAt) ||
      issuedAt <= 0 ||
      age < -5000 ||
      age > MAX_HANDOFF_AGE_MS
    ) {
      throw new Error("Handoff vencido.");
    }

    localStorage.setItem("session_key", sessionKey);
    localStorage.setItem("usuario", usuarioRaw);

    // Migra navegadores viejos: la única credencial operativa es session_key.
    ["token", "auth_token", "sessionKey", "x_session", "X-Session", "x-session"].forEach(
      (key) => localStorage.removeItem(key)
    );

    cleanHandoffFragment();
    window.__BALTO_LOCAL_SESSION_BRIDGE__ = {
      status: "received",
      at: Date.now(),
    };

    return true;
  } catch (error) {
    console.warn("[BALTO session bridge] No se pudo consumir el handoff local:", error);
    cleanHandoffFragment();
    return false;
  }
}

function hasUsableLocalSession() {
  try {
    const sessionKey = String(localStorage.getItem("session_key") || "").trim();
    const usuarioRaw = String(localStorage.getItem("usuario") || "").trim();
    return Boolean(sessionKey && parseStoredUser(usuarioRaw));
  } catch {
    return false;
  }
}

function buildLocalReturnUrl() {
  const target = new URL(window.location.href);
  target.hash = "";

  if (target.pathname === "/" || target.pathname === "") {
    target.pathname = "/panel";
  }

  return target.toString();
}

function getGlobalLoginUrl() {
  const configured = String(process.env.REACT_APP_BALTO_LOGIN_URL || "").trim();
  const fallback = "https://balto.3devsnet.com/";

  if (!configured) return fallback;

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

export function redirectToCentralAccessBridge() {
  if (!isLocalDevelopmentOrigin()) return false;
  if (window.__BALTO_LOCAL_SESSION_BRIDGE__?.status === "redirecting") return true;

  // Desarrollo local: ir DIRECTO al Login Global. El Login Global devuelve
  // la sesión mediante
  // #balto_auth=... al return_to local indicado abajo.
  const loginUrl = new URL(getGlobalLoginUrl());
  loginUrl.searchParams.set("balto_dev_return", buildLocalReturnUrl());
  loginUrl.searchParams.set("balto_dev_system", "COMERCIO");
  loginUrl.searchParams.set("balto_dev_issued", String(Date.now()));
  loginUrl.searchParams.set("balto_bridge", BRIDGE_VERSION);

  window.__BALTO_LOCAL_SESSION_BRIDGE__ = {
    status: "redirecting",
    at: Date.now(),
  };

  window.location.replace(loginUrl.toString());
  return true;
}

export function bootstrapLocalSessionBridge() {
  if (!isLocalDevelopmentOrigin()) return false;
  if (consumeHandoffFromFragment()) return true;

  if (hasUsableLocalSession()) {
    window.__BALTO_LOCAL_SESSION_BRIDGE__ = {
      status: "ready",
      at: Date.now(),
    };
    return true;
  }

  redirectToCentralAccessBridge();
  return true;
}
