export const LAST_ACTIVITY_KEY = "balto_last_activity_ts";
export const IDLE_MS = 2 * 60 * 60 * 1000;

export function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function looksLikeUnauthorizedPayload(text, contentType = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;

  let msg = raw;

  if (String(contentType || "").toLowerCase().includes("application/json")) {
    const data = safeJsonParse(raw);
    if (data && typeof data === "object") {
      msg = [data.mensaje, data.error, data.detalle, raw]
        .filter(Boolean)
        .join(" | ");
    }
  }

  const s = String(msg).toLowerCase();

  return (
    s.includes("sesión expirada") ||
    s.includes("sesion expirada") ||
    s.includes("sesión no autorizada") ||
    s.includes("sesion no autorizada") ||
    s.includes("session_key inválida") ||
    s.includes("session_key invalida") ||
    s.includes("falta x-session") ||
    s.includes("error en api: sesión expirada") ||
    s.includes("error en api: sesion expirada") ||
    s.includes("sesión inválida") ||
    s.includes("sesion invalida")
  );
}

export function isSessionExpiredResponse(status, text = "", contentType = "") {
  if (Number(status) === 401) return true;
  if (Number(status) !== 403) return false;
  return looksLikeUnauthorizedPayload(text, contentType);
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
  if (path.startsWith("/panel/servicios")) return "servicios";
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
  try {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {}
}

export function getLastActivityTs() {
  try {
    const v = sessionStorage.getItem(LAST_ACTIVITY_KEY);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
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
