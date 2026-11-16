// src/components/Flujo_de_Caja/api/flujoCajaCierresApi.js
// Cierre de caja y conciliación de diferencias. El backend recalcula SIEMPRE
// saldos, diferencias, estados y compensaciones: el navegador sólo envía lo
// que el usuario contó, eligió o escribió, más los valores que vio en la
// vista previa para que el backend detecte datos desactualizados (HTTP 409).

import BASE_URL from "../../../config/config";
import { singleFlightFetch } from "../../../utils/singleFlightFetch";

const API = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

function getSessionKey() {
  return (localStorage.getItem("session_key") || "").toString().trim();
}

function authHeaders(extra = {}) {
  const sessionKey = getSessionKey();
  const headers = { Accept: "application/json", ...extra };
  if (sessionKey) headers["X-Session"] = sessionKey;
  return headers;
}

/** Error con código del backend (SALDOS_DESACTUALIZADOS, CIERRE_DUPLICADO, …). */
export class CierreApiError extends Error {
  constructor(message, { status = 0, codigo = "", payload = null } = {}) {
    super(message);
    this.name = "CierreApiError";
    this.status = status;
    this.codigo = codigo;
    this.payload = payload;
  }
}

async function parse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!json) {
    throw new CierreApiError(`Respuesta inválida del servidor (HTTP ${res.status}).`, { status: res.status });
  }
  if (!res.ok || json.exito === false) {
    throw new CierreApiError(json.mensaje || `Error desconocido (HTTP ${res.status}).`, {
      status: res.status,
      codigo: json.codigo || "",
      payload: json,
    });
  }
  return json;
}

function url(action, query = {}) {
  const sp = new URLSearchParams();
  sp.set("action", action);
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(","));
      return;
    }
    if (value !== undefined && value !== null && value !== "") sp.set(key, String(value));
  });
  return `${API}?${sp.toString()}`;
}

async function get(action, query) {
  const res = await singleFlightFetch(url(action, { ...query, _: Date.now() }), { method: "GET", headers: authHeaders() });
  return parse(res);
}

async function post(action, body) {
  const res = await fetch(url(action), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body || {}),
  });
  return parse(res);
}

export function nuevaClaveCierre(prefix = "cie") {
  const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export const obtenerEstadoCierres = () => get("flujo_caja_cierres_estado");

export const previsualizarCierre = ({ fechaOperativa } = {}) =>
  get("flujo_caja_cierres_previsualizar", { fecha_operativa: fechaOperativa });

export const confirmarCierre = (payload) => post("flujo_caja_cierres_confirmar", payload);

export const listarCierres = ({ fechaDesde = "", fechaHasta = "", idMedioPago = "", estado = "" } = {}) =>
  get("flujo_caja_cierres_listar", { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, id_medio_pago: idMedioPago, estado });

export const obtenerDetalleCierre = (idCierre) => get("flujo_caja_cierres_detalle", { id_cierre: idCierre });

export const obtenerCandidatosConciliacion = (idDetalle) =>
  get("flujo_caja_cierres_conciliacion_candidatos", { id_cierre_detalle: idDetalle });

export const previsualizarConciliacion = ({ idDetalle, tipo, importe, observaciones, ids }) =>
  get("flujo_caja_cierres_conciliacion_previsualizar", {
    id_cierre_detalle: idDetalle,
    tipo_resolucion: tipo,
    importe,
    observaciones,
    ids_movimiento_medio_pago: ids || [],
  });

export const conciliarDiferencia = (payload) => post("flujo_caja_cierres_conciliar", payload);

export const previsualizarAjusteCierre = (idDetalle) =>
  get("flujo_caja_cierres_ajuste_previsualizar", { id_cierre_detalle: idDetalle });

export const aplicarAjusteCierre = (payload) => post("flujo_caja_cierres_ajuste_aplicar", payload);
