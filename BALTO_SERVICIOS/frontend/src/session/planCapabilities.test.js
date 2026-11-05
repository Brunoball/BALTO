// Pruebas del store de capacidades (Jest / CRA: `npm test -- planCapabilities`).
import {
  can,
  canAccessRoute,
  getPlanSnapshot,
  handlePlanSignature,
  isPlanDeniedPayload,
  requiredCapabilityForRoute,
} from "./planCapabilities";

const PLAN_1 = ["accounts.current", "billing.arca", "budgets.manage", "finance.manage", "reports.financial", "services.manage", "services.sell", "settings.sensitive"];
const PLAN_2 = [...PLAN_1, "resources.manage", "resources.stock", "services.composition", "services.costing", "workers.manage"];
const PLAN_3 = [...PLAN_2, "products.manage", "products.sell", "reports.profit_by_type", "sales.mixed"];

function setUser(capacidades, firma) {
  localStorage.setItem("session_key", "k");
  localStorage.setItem("usuario", JSON.stringify({ idPlan: 1, capacidades, plan_firma: firma, plan_comercial: "X" }));
}

describe("planCapabilities", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ exito: true, sesion_valida: true, sistema: { codigo: "SERVICIOS" }, usuario: { capacidades: PLAN_2, plan_firma: "f2" } }),
      headers: { get: () => null },
    }));
  });

  test("sin capacidades (sesión no validada) no habilita nada", () => {
    expect(getPlanSnapshot().ready).toBe(false);
    expect(can("services.manage")).toBe(false);
  });

  test("plan 1: sólo capacidades comunes", () => {
    setUser(PLAN_1, "f1");
    expect(can("services.sell")).toBe(true);
    expect(can("services.composition")).toBe(false);
    expect(can("products.sell")).toBe(false);
  });

  test("plan 2 y 3 son acumulativos", () => {
    setUser(PLAN_2, "f2");
    expect(can("resources.stock")).toBe(true);
    expect(can("products.manage")).toBe(false);
    setUser(PLAN_3, "f3");
    expect(can("products.manage")).toBe(true);
    expect(can("services.composition")).toBe(true);
  });

  test("inventario bloqueado por URL directa con ?seccion=inventario en plan 1", () => {
    setUser(PLAN_1, "f1");
    expect(requiredCapabilityForRoute("/panel/servicios", "?seccion=inventario")).toBe("resources.manage");
    expect(canAccessRoute("/panel/servicios", "?seccion=inventario")).toBe(false);
    expect(canAccessRoute("/panel/servicios", "")).toBe(true);
    expect(canAccessRoute("/panel/ventas", "")).toBe(true);
    setUser(PLAN_2, "f2");
    expect(canAccessRoute("/panel/servicios", "?seccion=INVENTARIO")).toBe(true);
  });

  test("una firma distinta refresca la sesión una sola vez; la misma firma no consulta", async () => {
    setUser(PLAN_1, "f1");
    handlePlanSignature("f1");
    expect(global.fetch).toHaveBeenCalledTimes(0);
    handlePlanSignature("f2");
    handlePlanSignature("f2");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getPlanSnapshot().firma).toBe("f2");
    expect(can("services.composition")).toBe(true);
  });

  test("detecta el 403 de plan (no es error de sesión)", () => {
    expect(isPlanDeniedPayload({ codigo: "FUNCIONALIDAD_NO_INCLUIDA_PLAN" })).toBe(true);
    expect(isPlanDeniedPayload({ codigo: "SESSION_EXPIRED" })).toBe(false);
  });
});
