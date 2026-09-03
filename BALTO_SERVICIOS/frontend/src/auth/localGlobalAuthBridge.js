const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
const DEV_PORT = "3000";
const HANDOFF_PARAM = "balto_auth";
const MAX_HANDOFF_AGE_MS = 20 * 60 * 1000;
const BRIDGE_VERSION = "20260901_v7";

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

function parseUsuario(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function cleanAuthFragment() {
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
    const usuario = parseUsuario(usuarioRaw);
    const issuedAt = Number(payload?.issued_at || 0);
    const age = Date.now() - issuedAt;

    if (payload?.v !== 1) throw new Error("Versión de handoff inválida.");
    if (!sessionKey || !usuario) throw new Error("Handoff incompleto.");
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || age < -5000 || age > MAX_HANDOFF_AGE_MS) {
      throw new Error("Handoff vencido.");
    }

    localStorage.setItem("session_key", sessionKey);
    localStorage.setItem("usuario", usuarioRaw);
    localStorage.removeItem("token");

    cleanAuthFragment();
    window.__BALTO_LOCAL_AUTH_BRIDGE__ = { status: "received", at: Date.now() };
    return true;
  } catch (error) {
    console.warn("[BALTO auth bridge] No se pudo consumir el handoff local:", error);
    cleanAuthFragment();
    return false;
  }
}

function hasUsableLocalAuth() {
  try {
    const sessionKey = String(localStorage.getItem("session_key") || "").trim();
    const usuarioRaw = String(localStorage.getItem("usuario") || "").trim();
    return Boolean(sessionKey && parseUsuario(usuarioRaw));
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

function getDevBridgeStartUrl() {
  const configured = String(process.env.REACT_APP_DEV_AUTH_START_URL || "").trim();
  return configured || "https://balto.3devsnet.com/BALTO_COMERCIO/dev-auth-start.html";
}

export function redirectToGlobalLoginBridge() {
  if (!isLocalDevelopmentOrigin()) return false;
  if (window.__BALTO_LOCAL_AUTH_BRIDGE__?.status === "redirecting") return true;

  const startUrl = new URL(getDevBridgeStartUrl());
  // Evita que el navegador o LiteSpeed reutilicen una versión anterior del
  // gateway. El return_to suele ser siempre igual durante el desarrollo.
  startUrl.searchParams.set("balto_bridge", BRIDGE_VERSION);
  startUrl.searchParams.set("return_to", buildLocalReturnUrl());
  window.__BALTO_LOCAL_AUTH_BRIDGE__ = { status: "redirecting", at: Date.now() };
  window.location.replace(startUrl.toString());
  return true;
}

export function bootstrapLocalGlobalAuthBridge() {
  if (!isLocalDevelopmentOrigin()) return false;
  if (consumeHandoffFromFragment()) return true;
  if (hasUsableLocalAuth()) {
    window.__BALTO_LOCAL_AUTH_BRIDGE__ = { status: "ready", at: Date.now() };
    return true;
  }
  redirectToGlobalLoginBridge();
  return true;
}

bootstrapLocalGlobalAuthBridge();
