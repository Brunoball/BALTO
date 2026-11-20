import {
  getBaltoPlanIdFromUsuario,
  isBaltoDemoMode,
  normalizeBaltoPlanId,
} from "./demoMode";

describe("Modo DEMO separado del plan contratado", () => {
  beforeEach(() => localStorage.clear());

  test.each([1, 2, 3])("plan %s DEMO conserva idPlan y se detecta", (idPlan) => {
    const u = { idPlan, plan_nombre: "PLAN DEMO", es_demo: 1, plan_es_demo: 1 };
    expect(getBaltoPlanIdFromUsuario(u)).toBe(idPlan);
    expect(isBaltoDemoMode(u)).toBe(true);
  });

  test.each([1, 2, 3])("plan %s normal no es DEMO", (idPlan) => {
    expect(isBaltoDemoMode({ idPlan, es_demo: 0, plan_es_demo: 0 })).toBe(false);
  });

  test("no transforma un plan 1 en 10 por un nombre decorativo", () => {
    expect(normalizeBaltoPlanId(1, "DEMO BASIC")).toBe(1);
    expect(isBaltoDemoMode({ idPlan: 1, plan_nombre: "DEMO BASIC", es_demo: 0 })).toBe(false);
  });

  test("flag de sesión prevalece y funciona en localStorage", () => {
    localStorage.setItem("usuario", JSON.stringify({ idPlan: 2, plan_es_demo: 1 }));
    expect(isBaltoDemoMode()).toBe(true);
    expect(getBaltoPlanIdFromUsuario()).toBe(2);
    localStorage.setItem("usuario", JSON.stringify({ idPlan: 2, plan_es_demo: 0 }));
    expect(isBaltoDemoMode()).toBe(false);
  });

  test("compatibilidad con plan 10 sin flag", () => {
    expect(isBaltoDemoMode({ idPlan: 10 })).toBe(true);
  });

  test("sin sesión válida no se inventa modo demo", () => {
    localStorage.setItem("usuario", "{err");
    expect(isBaltoDemoMode()).toBe(false);
  });
});
