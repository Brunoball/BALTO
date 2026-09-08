// src/utils/demoMode.js
// Helper central para detectar el plan DEMO desde el usuario guardado en localStorage.
// IDs vigentes en master: 1=BASICO, 2=INTERMEDIO, 3=PRO y 10=DEMO.
// Matriz vigente:
// - PRO (3): sistema completo.
// - INTERMEDIO (2): sistema completo salvo Tienda Nube y códigos de barra.
// - BASICO (1): se conserva por compatibilidad, actualmente no se comercializa.
// - DEMO (10): mantiene exactamente sus bloqueos sensibles actuales.

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
  const tenant = u?.tenant && typeof u.tenant === "object" ? u.tenant : {};
  const planObj = u?.plan_saas && typeof u.plan_saas === "object" ? u.plan_saas : {};

  const demoFlag = [
    u?.es_demo,
    u?.demo,
    u?.is_demo,
    u?.modo_demo,
    u?.tenant_demo,
    tenant?.es_demo,
    tenant?.demo,
    planObj?.es_demo,
    planObj?.demo,
  ].some((value) => {
    if (value === true || Number(value) === 1) return true;
    return ["true", "si", "yes", "demo"].includes(
      String(value ?? "").trim().toLowerCase()
    );
  });

  if (demoFlag) return 10;

  // Priorizamos el ID explícito del plan por encima de campos auxiliares como
  // plan_nivel. Así, si el tenant acaba de cambiar de PRO a INTERMEDIO, no
  // queda visible una función premium por un dato legacy o desactualizado.
  const explicitPlanIds = [
    u?.idPlan,
    u?.id_plan,
    u?.plan_id,
    u?.planId,
    u?.idPlan_real,
    u?.id_plan_real,
    u?.tenant_idPlan,
    u?.tenant_id_plan,
    tenant?.idPlan,
    tenant?.id_plan,
    tenant?.plan_id,
    planObj?.idPlan,
    planObj?.id_plan,
  ];

  for (const value of explicitPlanIds) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if ([1, 2, 3, 10].includes(n)) return n;
  }

  const planNames = [
    u?.plan_nombre,
    u?.nombre_plan,
    typeof u?.plan === "string" ? u.plan : "",
    u?.tipo_plan,
    u?.planName,
    u?.nombrePlan,
    u?.plan_nombre_real,
    tenant?.plan_nombre,
    tenant?.nombre_plan,
    typeof tenant?.plan === "string" ? tenant.plan : "",
    planObj?.nombre,
    planObj?.plan_nombre,
  ];

  for (const name of planNames) {
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.includes("demo")) return 10;
    if (normalized.includes("intermedio")) return 2;
    if (normalized.includes("pro") || normalized.includes("avanzado")) return 3;
    if (normalized.includes("basico") || normalized.includes("básico")) return 1;
  }

  const levelCandidates = [
    u?.plan_nivel,
    u?.nivel,
    u?.nivel_plan,
    u?.plan_nivel_real,
    tenant?.plan_nivel,
    planObj?.nivel,
  ];

  for (const value of levelCandidates) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if ([1, 2, 3, 10].includes(n)) return n;
  }

  return 1;
}

export function isBaltoIntermediatePlan(usuario = null) {
  return getBaltoPlanIdFromUsuario(usuario) === 2;
}

/**
 * INTERMEDIO no incluye la integración con Tienda Nube.
 * No alteramos DEMO/BASICO acá para conservar su comportamiento previo.
 */
export function canBaltoUseTiendaNube(usuario = null) {
  return !isBaltoIntermediatePlan(usuario);
}

/**
 * INTERMEDIO no incluye códigos de barra ni lectura con pistola.
 * DEMO conserva el comportamiento que ya tenía antes de separar los planes.
 */
export function canBaltoUseBarcode(usuario = null) {
  return !isBaltoIntermediatePlan(usuario);
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
