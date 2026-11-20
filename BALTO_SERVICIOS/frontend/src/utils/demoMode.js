// Modo DEMO es una propiedad del TENANT, independiente del plan comercial.
// El servidor valida el modo y las capacidades; este helper sólo controla UI.
// Compatibilidad transitoria: los tenants del antiguo plan 10 siguen siendo DEMO.

export function normalizeBaltoPlanId(value, planName = "") {
  const n = Number(value);
  if ([1, 2, 3, 10].includes(n)) return n;
  const name = String(planName || "").trim().toLowerCase();
  if (name.includes("intermedio") || name.includes("insumos")) return 2;
  if (name.includes("pro") || name.includes("avanzado") || name.includes("venta")) return 3;
  if (name.includes("demo")) return 10; // sesión legacy sin idPlan
  return 1;
}

export function getBaltoUsuario() {
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    return u && typeof u === "object" ? u : null;
  } catch {
    return null;
  }
}

export function getBaltoPlanIdFromUsuario(usuario = null) {
  const u = usuario || getBaltoUsuario() || {};
  return normalizeBaltoPlanId(
    u?.idPlan ?? u?.id_plan ?? u?.plan_id ?? u?.plan_nivel,
    u?.plan_nombre ?? u?.plan ?? u?.nombre_plan ?? ""
  );
}

function isDemoFlag(value) {
  return value === true || value === 1 || value === "1";
}

export function isBaltoDemoMode(usuario = null) {
  const u = usuario || getBaltoUsuario() || {};
  return (
    isDemoFlag(u.plan_es_demo) ||
    isDemoFlag(u.es_demo) ||
    isDemoFlag(u.demo) ||
    isDemoFlag(u.is_demo) ||
    isDemoFlag(u.modo_demo) ||
    getBaltoPlanIdFromUsuario(u) === 10
  );
}

export const DEMO_BLOCK_MESSAGE =
  "Modo demo: esta acción está bloqueada para evitar cambios reales. Podés navegar y probar el sistema, pero no emitir comprobantes fiscales ni modificar configuraciones sensibles.";
