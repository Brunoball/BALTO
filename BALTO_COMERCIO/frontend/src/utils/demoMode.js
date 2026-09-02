// src/utils/demoMode.js
// Helper central para detectar el plan DEMO desde el usuario guardado en localStorage.
// IDs vigentes en master: 1=BASICO, 2=INTERMEDIO, 3=PRO y 10=DEMO.
// Durante la transición, los tres planes comerciales tienen acceso completo.
// DEMO conserva sus bloqueos sensibles actuales.

export function normalizeBaltoPlanId(value, planName = "") {
  const n = Number(value);
  const name = String(planName || "").trim().toLowerCase();

  if (n === 10 || name.includes("demo")) return 10;
  if (n === 3 || name.includes("pro") || name.includes("avanzado")) return 3;
  if (n === 2 || name.includes("intermedio")) return 2;
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
    u?.idPlan ?? u?.id_plan ?? u?.plan_id ?? u?.plan_nivel ?? 1,
    u?.plan_nombre ?? u?.plan ?? u?.nombre_plan ?? ""
  );
}

export function isBaltoDemoMode(usuario = null) {
  const u = usuario || getBaltoUsuario() || {};
  const name = String(u?.plan_nombre ?? u?.plan ?? u?.nombre_plan ?? "").trim().toLowerCase();
  return (
    getBaltoPlanIdFromUsuario(u) === 10 ||
    name.includes("demo") ||
    Number(u?.es_demo || 0) === 1 ||
    Number(u?.demo || 0) === 1 ||
    Number(u?.is_demo || 0) === 1 ||
    Number(u?.modo_demo || 0) === 1
  );
}

export const DEMO_BLOCK_MESSAGE =
  "Modo demo: esta acción está bloqueada para evitar cambios reales. Podés navegar y probar el sistema, pero no emitir comprobantes fiscales ni modificar configuraciones sensibles.";
