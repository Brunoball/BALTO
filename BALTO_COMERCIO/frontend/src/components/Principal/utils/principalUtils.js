// Registro compartido entre pestañas de BALTO COMERCIO, ligado a la sesión actual.
export const LAST_ACTIVITY_KEY = "balto_last_activity_ts";
export const IDLE_MS = 60 * 60 * 1000;

function currentSessionKey() {
  try {
    return String(localStorage.getItem("session_key") || "").trim();
  } catch {
    return "";
  }
}


export function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const AUTH_FAILURE_CODES = new Set([
  "SESSION_REQUIRED", "SESSION_INVALID", "SESSION_REVOKED", "SESSION_EXPIRED",
  "SESION_REQUERIDA", "SESION_INVALIDA", "SESION_REVOCADA", "SESION_EXPIRADA",
  "USUARIO_INACTIVO", "USUARIO_DESHABILITADO",
  "TENANT_INACTIVO", "TENANT_DESHABILITADO", "SISTEMA_NO_AUTORIZADO",
]);

export function looksLikeUnauthorizedPayload(text, contentType = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;

  let msg = raw;
  if (String(contentType || "").toLowerCase().includes("application/json")) {
    const data = safeJsonParse(raw);
    if (data && typeof data === "object") {
      const code = String(data.codigo || data.code || "").trim().toUpperCase();
      if (code) return AUTH_FAILURE_CODES.has(code);
      if (data.exito === true || data.ok === true) return false;
      msg = String(data.mensaje || data.error || "");
    }
  }

  const s = String(msg).trim().toLowerCase();
  return /^(?:error en api: )?(?:sesión|sesion) (?:expirada|inválida|invalida|no autorizada)\.?$/.test(s)
    || /^falta x-session\.?$/.test(s)
    || /^session_key inv[aá]lida\.?$/.test(s);
}

export function isSessionExpiredResponse(status, text = "", contentType = "") {
  // Un 401 genérico (ej. token de descarga caducado) o un 403 de permisos
  // NO deben revocar una sesión MASTER válida.
  return (Number(status) === 401 || Number(status) === 403)
    && looksLikeUnauthorizedPayload(text, contentType);
}

export function normalizeRol(value, idRol = null) {
  const id = Number(idRol);
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    id === 1 ||
    ["1", "admin", "administrator", "administrador", "superadmin"].includes(v)
  ) {
    return "admin";
  }

  return "empleado_basico";
}

export function normalizePlanNivel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n <= 1) return 1;
  if (n === 2) return 2;
  return 3;
}

export function normalizePlanId(value, planName = "") {
  const n = Number(value);
  const name = String(planName || "").trim().toLowerCase();
  if (n === 10 || name.includes("demo")) return 10;
  if (n === 3 || name.includes("pro") || name.includes("avanzado")) return 3;
  if (n === 2 || name.includes("intermedio")) return 2;
  return 1;
}

export function planAllowsNavKey(planId, key) {
  // Política temporal: BASICO, INTERMEDIO, PRO y DEMO ven todos los módulos.
  // Se conservan los parámetros para volver a aplicar la matriz real más adelante.
  void planId;
  void key;
  return true;
}

export function getModuleKeyByPath(pathname) {
  const path = String(pathname || "");

  if (path === "/panel" || path === "/panel/" || path.startsWith("/panel/dashboard")) {
    return "dashboard";
  }

  if (
    path.startsWith("/panel/movimientos") ||
    path.startsWith("/panel/ventas") ||
    path.startsWith("/panel/compras") ||
    path.startsWith("/panel/recibos") ||
    path.startsWith("/panel/OrdenesPago") ||
    path.startsWith("/panel/Otrosingresos") ||
    path.startsWith("/panel/Otrosegresos") ||
    path.startsWith("/panel/documentos_comerciales") ||
    path.startsWith("/panel/presupuesto")
  ) {
    return "movimientos";
  }

  if (path.startsWith("/panel/flujo-de-caja")) return "flujo-de-caja";
  if (path.startsWith("/panel/cuentas-corrientes")) return "cuentas-corrientes";
  if (path.startsWith("/panel/stock")) return "stock";
  if (path.startsWith("/panel/contabilidad")) return "contabilidad";
  if (path.startsWith("/panel/cheques")) return "cheques";
  if (path.startsWith("/panel/analisis-financiero")) return "analisis-financiero";
  if (path.startsWith("/panel/configuracion")) return "configuracion";

  return "dashboard";
}

export function slugify(name) {
  return (
    String(name ?? "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "seccion"
  );
}

export function normalizeTema(value) {
  const t = String(value ?? "claro").trim().toLowerCase();
  return t === "oscuro" ? "oscuro" : "claro";
}

export function applyTheme(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  document.body.classList.toggle("dark", tema === "oscuro");
}

export function setLastActivityNow() {
  const session = currentSessionKey();
  if (!session) return;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, JSON.stringify({ session, at: Date.now() }));
  } catch {}
}

export function getLastActivityTs() {
  const session = currentSessionKey();
  if (!session) return 0;
  try {
    const record = JSON.parse(localStorage.getItem(LAST_ACTIVITY_KEY) || "null");
    const at = Number(record?.at);
    return record?.session === session && Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

export function getLogoToneFromImageSrc(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve("dark");
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 56;

        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve("dark");
          return;
        }

        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);

        const { data } = ctx.getImageData(0, 0, size, size);

        let brightnessTotal = 0;
        let visiblePixels = 0;

        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 45) continue;

          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;

          brightnessTotal += brightness;
          visiblePixels += 1;
        }

        if (!visiblePixels) {
          resolve("dark");
          return;
        }

        resolve(brightnessTotal / visiblePixels >= 155 ? "light" : "dark");
      } catch {
        resolve("dark");
      }
    };

    img.onerror = () => resolve("dark");
    img.src = src;
  });
}
