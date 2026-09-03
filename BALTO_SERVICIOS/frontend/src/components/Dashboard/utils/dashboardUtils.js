export const EMPTY_DASHBOARD = {
  rango: null,
  kpis: {},
  series_diaria: [],
};

export function normalizeRol(value) {
  if (value == null) return "empleado_basico";
  const v = String(value).trim().toLowerCase();
  if (["1", "admin", "administrator", "administrador", "superadmin"].includes(v)) {
    return "admin";
  }
  return "empleado_basico";
}

export function getUsuarioFromStorage() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u) u.rol = normalizeRol(u.rol ?? u.tipo_rol ?? u.id_rol);
    return u || null;
  } catch {
    return null;
  }
}

export function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$ 0,00";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(
    Math.round(n)
  );
}

export function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function moneyClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n < 0 ? "is-negative" : "is-positive";
}

export function formatDateES(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

export function formatMonthLabel(iso) {
  let date = null;

  if (iso) {
    const [y, m] = String(iso).split("-");
    if (y && m) date = new Date(Number(y), Number(m) - 1, 1);
  }

  if (!date || Number.isNaN(date.getTime())) {
    const now = new Date();
    date = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const label = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function normalizePayload(payload) {
  const data = payload?.data ?? payload ?? {};

  return {
    rango: data.rango ?? null,
    kpis: data.kpis ?? {},
    series_diaria: Array.isArray(data.series_diaria) ? data.series_diaria : [],
  };
}
