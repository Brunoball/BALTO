/* =========================================================
   Política temporal de medios de pago por plan SaaS.
   BASICO, INTERMEDIO, PRO y DEMO permiten todos los medios.
   DEMO conserva únicamente sus bloqueos sensibles específicos.
========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTruthyDemo(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const v = normalizeText(value);
  return ["1", "TRUE", "SI", "YES", "DEMO"].includes(v);
}

function getUsuarioStorage() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function normalizePlanFromUsuario(usuario) {
  const u = usuario && typeof usuario === "object" ? usuario : {};
  const tenant = u.tenant && typeof u.tenant === "object" ? u.tenant : {};
  const planObj = u.plan_saas && typeof u.plan_saas === "object" ? u.plan_saas : {};

  const names = [
    u.plan_nombre,
    u.nombre_plan,
    u.plan,
    u.tipo_plan,
    u.planName,
    u.nombrePlan,
    u.plan_nombre_real,
    tenant.plan_nombre,
    tenant.nombre_plan,
    tenant.plan,
    planObj.nombre,
    planObj.plan_nombre,
  ]
    .map(normalizeText)
    .filter(Boolean);

  const nums = [
    u.idPlan,
    u.id_plan,
    u.plan_id,
    u.planId,
    u.plan_nivel,
    u.nivel,
    u.nivel_plan,
    u.tenant_idPlan,
    u.tenant_id_plan,
    u.idPlan_real,
    u.id_plan_real,
    u.plan_nivel_real,
    tenant.idPlan,
    tenant.id_plan,
    tenant.plan_id,
    tenant.plan_nivel,
    planObj.idPlan,
    planObj.id_plan,
    planObj.nivel,
  ]
    .map(toIntOrNull)
    .filter((n) => n !== null);

  const demoFlag =
    isTruthyDemo(u.es_demo) ||
    isTruthyDemo(u.demo) ||
    isTruthyDemo(u.is_demo) ||
    isTruthyDemo(u.modo_demo) ||
    isTruthyDemo(u.tenant_demo) ||
    isTruthyDemo(tenant.es_demo) ||
    isTruthyDemo(tenant.demo) ||
    isTruthyDemo(planObj.es_demo) ||
    isTruthyDemo(planObj.demo);

  if (demoFlag || nums.includes(10) || names.some((n) => n.includes("DEMO"))) return 10;

  if (
    nums.includes(3) ||
    names.some(
      (n) =>
        n.includes("PRO") ||
        n.includes("AVANZADO") ||
        n.includes("ADVANCED")
    )
  ) {
    return 3;
  }

  if (nums.includes(2) || names.some((n) => n.includes("INTERMEDIO"))) return 2;

  return 1;
}

export function getPlanSaasIdActual() {
  return normalizePlanFromUsuario(getUsuarioStorage());
}

export function esPlanBasicoSaas() {
  return getPlanSaasIdActual() === 1;
}

export function esPlanProSaas() {
  return getPlanSaasIdActual() === 3;
}

export function esPlanDemoSaas() {
  return getPlanSaasIdActual() === 10;
}

export function esPlanConMediosCompletosSaas() {
  return [1, 2, 3, 10].includes(getPlanSaasIdActual());
}

export function esMedioPagoChequeOEcheq(medio) {
  const nombre = normalizeText(
    typeof medio === "string"
      ? medio
      : medio?.nombre ?? medio?.medio_pago ?? medio?.label ?? medio?.descripcion ?? ""
  );

  if (!nombre) return false;

  return (
    nombre === "CHEQUE" ||
    nombre === "ECHEQ" ||
    nombre === "E CHEQ" ||
    nombre.includes("CHEQUE") ||
    nombre.includes("ECHEQ") ||
    nombre.includes("E CHEQ")
  );
}

export function medioPagoPermitidoPorPlan(medio) {
  void medio;
  return true;
}

export function filtrarMediosPagoPorPlan(mediosPago) {
  const lista = Array.isArray(mediosPago) ? mediosPago : [];

  return lista;
}
