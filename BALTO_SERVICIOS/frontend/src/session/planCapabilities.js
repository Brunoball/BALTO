// src/session/planCapabilities.js
//
// Capacidades del plan contratado (BALTO Servicios).
//
// - La matriz NO vive en el frontend: el backend la calcula desde la sesión MASTER
//   (tenants.idPlan) y la envía en usuario.capacidades (auth_session_check).
//   Acá sólo se consulta: can("services.composition"), can("products.sell"), etc.
// - Plan y rol son ejes distintos: este módulo no reemplaza los controles de rol.
// - Sincronización sin polling: cada respuesta privada trae el header
//   X-Balto-Plan con la firma del plan efectivo. Si difiere de la guardada, se
//   refresca una sola vez la sesión y el resto de las pestañas se enteran por el
//   evento "storage" de localStorage.
// - Ante datos desactualizados el backend sigue siendo la autoridad (403
//   FUNCIONALIDAD_NO_INCLUIDA_PLAN, sin logout).

import { useSyncExternalStore } from "react";
import { storeValidatedUser, validateServicesSession } from "./sessionClient";

const USER_KEY = "usuario";
export const PLAN_DENIED_CODE = "FUNCIONALIDAD_NO_INCLUIDA_PLAN";
export const PLAN_HEADER = "X-Balto-Plan";
const PLAN_EVENT = "balto:plan-updated";
const MIN_REFRESH_INTERVAL_MS = 5000;

const EMPTY_STATE = Object.freeze({
  ready: false,
  capacidades: Object.freeze([]),
  firma: "",
  codigo: "",
  nombre: "",
  esDemo: false,
});

let cachedRaw;
let cachedState = EMPTY_STATE;

function readRawUser() {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

function buildState(raw) {
  if (!raw) return EMPTY_STATE;
  let u = null;
  try {
    u = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (!u || typeof u !== "object" || !Array.isArray(u.capacidades)) return EMPTY_STATE;

  return Object.freeze({
    ready: true,
    capacidades: Object.freeze(u.capacidades.map(String)),
    firma: String(u.plan_firma || ""),
    codigo: String(u.plan_codigo || ""),
    nombre: String(u.plan_comercial || ""),
    esDemo: Number(u.plan_es_demo || 0) === 1,
  });
}

export function getPlanSnapshot() {
  const raw = readRawUser();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = buildState(raw);
  }
  return cachedState;
}

/** Consulta no reactiva (helpers, guards fuera de componentes). */
export function can(capability, state = getPlanSnapshot()) {
  return state.capacidades.includes(String(capability));
}

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function onStorage(event) {
  if (!event || event.key === null || event.key === USER_KEY) {
    // Otra pestaña refrescó el plan: actualizar UI y, si cambió, sus listas.
    const firmaAnterior = cachedState.firma;
    emit();
    const firmaNueva = getPlanSnapshot().firma;
    if (firmaAnterior && firmaNueva && firmaNueva !== firmaAnterior) {
      try {
        window.dispatchEvent(new CustomEvent("balto:listas-updated"));
      } catch {}
    }
  }
}

export function subscribePlan(listener) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener(PLAN_EVENT, emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PLAN_EVENT, emit);
    }
  };
}

/** Hook reactivo: se re-renderiza si el plan cambia en esta u otra pestaña. */
export function usePlan() {
  const state = useSyncExternalStore(subscribePlan, getPlanSnapshot, getPlanSnapshot);
  return {
    ...state,
    can: (capability) => can(capability, state),
  };
}

export function notifyPlanUpdated() {
  try {
    window.dispatchEvent(new CustomEvent(PLAN_EVENT));
  } catch {}
}

/* =========================================================
   Rutas que dependen del plan (los controles de rol siguen en App/Principal)
========================================================= */

const ROUTE_RULES = [
  {
    // Inventario de Servicios, incluso escrito a mano: /panel/servicios?seccion=inventario
    matches: (pathname, params) =>
      pathname.startsWith("/panel/servicios") &&
      String(params.get("seccion") || "").toLowerCase() === "inventario",
    capability: "resources.manage",
  },
];

export function requiredCapabilityForRoute(pathname, search = "") {
  const path = String(pathname || "");
  let params;
  try {
    params = new URLSearchParams(search || "");
  } catch {
    params = new URLSearchParams();
  }
  const rule = ROUTE_RULES.find((r) => r.matches(path, params));
  return rule ? rule.capability : null;
}

export function canAccessRoute(pathname, search = "", state = getPlanSnapshot()) {
  const cap = requiredCapabilityForRoute(pathname, search);
  return !cap || can(cap, state);
}

/* =========================================================
   Sincronización con el backend
========================================================= */

let refreshPromise = null;
let lastRefreshAt = 0;

export async function refreshPlanFromServer({ force = false } = {}) {
  if (refreshPromise) return refreshPromise;
  const now = Date.now();
  if (!force && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return getPlanSnapshot();
  lastRefreshAt = now;

  refreshPromise = (async () => {
    const firmaAnterior = getPlanSnapshot().firma;
    try {
      const result = await validateServicesSession();
      if (result?.ok && result.data?.usuario) {
        storeValidatedUser(result.data.usuario);
        notifyPlanUpdated();
        // Las listas de movimientos (artículos vendibles/comprables, componentes)
        // dependen del plan: se recargan una vez si el plan realmente cambió.
        if (firmaAnterior && getPlanSnapshot().firma !== firmaAnterior) {
          try {
            window.dispatchEvent(new CustomEvent("balto:listas-updated"));
          } catch {}
        }
      }
    } catch {
      // Sin red: se conserva el estado actual; el backend sigue aplicando el plan.
    } finally {
      refreshPromise = null;
    }
    return getPlanSnapshot();
  })();

  return refreshPromise;
}

/** Llamado por el interceptor de fetch con cada respuesta privada. */
export function handlePlanSignature(signature) {
  const firma = String(signature || "").trim();
  if (!firma) return;
  const current = getPlanSnapshot();
  if (current.ready && current.firma === firma) return;
  refreshPlanFromServer();
}

export function isPlanDeniedPayload(data) {
  return String(data?.codigo || data?.code || "").trim().toUpperCase() === PLAN_DENIED_CODE;
}
