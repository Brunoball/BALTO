// src/components/Flujo_de_Caja/api/flujoCajaAjustesApi.js
// Ajustes de saldos de caja. El backend recalcula SIEMPRE el saldo y la
// diferencia: el navegador sólo envía lo que el usuario tipeó.

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

/** Error con el código del backend (SALDO_DESACTUALIZADO, AJUSTE_YA_REVERTIDO, …). */
export class AjusteApiError extends Error {
  constructor(message, { status = 0, codigo = "", payload = null } = {}) {
    super(message);
    this.name = "AjusteApiError";
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
    throw new AjusteApiError(`Respuesta inválida del servidor (HTTP ${res.status}).`, { status: res.status });
  }
  if (!res.ok || json.exito === false) {
    throw new AjusteApiError(json.mensaje || `Error desconocido (HTTP ${res.status}).`, {
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
    if (value !== undefined && value !== null && value !== "") sp.set(key, String(value));
  });
  return `${API}?${sp.toString()}`;
}

async function get(action, query) {
  const res = await singleFlightFetch(url(action, query), { method: "GET", headers: authHeaders() });
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

export function obtenerMediosAjuste() {
  return get("flujo_caja_ajustes_medios", { _: Date.now() });
}

export function previsualizarAjuste({ idMedioPago, tipo, importe }) {
  return get("flujo_caja_ajustes_previsualizar", {
    id_medio_pago: idMedioPago,
    tipo_ajuste: tipo,
    importe,
    _: Date.now(),
  });
}

export function crearAjuste(payload) {
  return post("flujo_caja_ajustes_crear", payload);
}

export function revertirAjuste(payload) {
  return post("flujo_caja_ajustes_revertir", payload);
}

export function listarAjustes({ fechaDesde = "", fechaHasta = "", idMedioPago = "" } = {}) {
  return get("flujo_caja_ajustes_listar", {
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    id_medio_pago: idMedioPago,
    _: Date.now(),
  });
}

export function nuevaClaveSolicitud() {
  const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `ajs-${uuid}`.slice(0, 64);
}

/* =========================================================
   Transferencias internas entre cajas
   El navegador sólo envía qué medios, qué importe y qué saldos vio el
   usuario; el backend recalcula saldos, valida y registra atómicamente.
========================================================= */

export function obtenerMediosTransferencia() {
  return get("flujo_caja_transferencias_medios", { _: Date.now() });
}

export function previsualizarTransferencia({ idMedioOrigen, idMedioDestino, importe }) {
  return get("flujo_caja_transferencias_previsualizar", {
    id_medio_origen: idMedioOrigen,
    id_medio_destino: idMedioDestino,
    importe,
    _: Date.now(),
  });
}

export function crearTransferencia(payload) {
  return post("flujo_caja_transferencias_crear", payload);
}

export function revertirTransferencia(payload) {
  return post("flujo_caja_transferencias_revertir", payload);
}

export function listarTransferencias({ fechaDesde = "", fechaHasta = "", idMedioPago = "", tipo = "", estado = "" } = {}) {
  return get("flujo_caja_transferencias_listar", {
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    id_medio_pago: idMedioPago,
    tipo,
    estado,
    _: Date.now(),
  });
}

export function nuevaClaveTransferencia() {
  const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `trf-${uuid}`.slice(0, 64);
}
