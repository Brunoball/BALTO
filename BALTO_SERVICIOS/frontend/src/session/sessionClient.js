import BASE_URL, { BALTO_ACCESS_URL } from "../config/config";
import { redirectToCentralAccessBridge } from "./localSessionBridge";

const SESSION_KEY = "session_key";
const USER_KEY = "usuario";
const FORCE_DASHBOARD_KEY = "balto_force_dashboard_after_login";

export function getSessionKey() {
  try {
    return String(localStorage.getItem(SESSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function hasSession() {
  return Boolean(getSessionKey());
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function storeValidatedUser(usuario) {
  if (!usuario || typeof usuario !== "object") return;

  try {
    localStorage.setItem(USER_KEY, JSON.stringify(usuario));
  } catch {}
}

export function markDashboardForNextLogin() {
  try {
    localStorage.setItem(FORCE_DASHBOARD_KEY, "1");
  } catch {}

  try {
    sessionStorage.setItem(FORCE_DASHBOARD_KEY, "1");
  } catch {}
}

export function consumeDashboardAfterLogin() {
  let shouldRedirect = false;

  try {
    shouldRedirect = localStorage.getItem(FORCE_DASHBOARD_KEY) === "1";
    localStorage.removeItem(FORCE_DASHBOARD_KEY);
  } catch {}

  try {
    shouldRedirect =
      sessionStorage.getItem(FORCE_DASHBOARD_KEY) === "1" || shouldRedirect;
    sessionStorage.removeItem(FORCE_DASHBOARD_KEY);
  } catch {}

  return shouldRedirect;
}

export function clearClientSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem("balto_sistema");

    // Limpieza de claves legacy que Servicios ya no debe utilizar.
    localStorage.removeItem("token");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("sessionKey");
    localStorage.removeItem("x_session");
    localStorage.removeItem("X-Session");
  } catch {}

  try {
    sessionStorage.clear();
  } catch {}
}

export function redirectToCentralAccess() {
  // Si BALTO Servicios debe volver al Login Global, el próximo ingreso
  // comienza siempre en Dashboard y no conserva la sección anterior.
  markDashboardForNextLogin();

  if (redirectToCentralAccessBridge()) return;

  try {
    if (window.location.href !== BALTO_ACCESS_URL) {
      window.location.replace(BALTO_ACCESS_URL);
    }
  } catch {
    window.location.href = BALTO_ACCESS_URL;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function sessionFailureCode(data) {
  return String(data?.codigo || data?.code || "").trim().toUpperCase();
}

export function isDefinitiveSessionFailure(status, data) {
  const code = sessionFailureCode(data);

  if (Number(status) === 401) return true;

  return [
    "SESSION_REQUIRED",
    "SESSION_INVALID",
    "SESSION_REVOKED",
    "SESSION_EXPIRED",
    "SESION_REQUERIDA",
    "SESION_INVALIDA",
    "SESION_REVOCADA",
    "SESION_EXPIRADA",
    "USUARIO_INACTIVO",
    "USUARIO_DESHABILITADO",
    "TENANT_INACTIVO",
    "TENANT_DESHABILITADO",
    "SISTEMA_NO_AUTORIZADO",
  ].includes(code);
}

export async function validateServicesSession() {
  const sessionKey = getSessionKey();

  if (!sessionKey) {
    return {
      ok: false,
      status: 401,
      data: { codigo: "SESSION_REQUIRED" },
    };
  }

  const response = await fetch(`${BASE_URL}/api.php?action=auth_session_check`, {
    method: "GET",
    headers: {
      "X-Session": sessionKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  const data = safeJsonParse(text) || {};

  if (!response.ok || data?.exito === false || data?.sesion_valida !== true) {
    return { ok: false, status: response.status, data };
  }

  const sistema = String(data?.sistema?.codigo || data?.sistema_codigo || "")
    .trim()
    .toUpperCase();

  if (sistema !== "SERVICIOS") {
    return {
      ok: false,
      status: 403,
      data: {
        exito: false,
        codigo: "SISTEMA_NO_AUTORIZADO",
        mensaje: "La sesión activa no corresponde a BALTO_SERVICIOS.",
      },
    };
  }

  return { ok: true, status: response.status, data };
}
