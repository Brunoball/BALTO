import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalPresupuesto.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faFileInvoiceDollar,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";
import ModalFacturaBaltoResumen from "../../Facturacion/ModalFacturaBaltoResumen.jsx";
import { PanelMediosPagoInlineVenta } from "../../Ventas/modales/ModalNuevaVenta.jsx";
import { saveVentaNoFacturadaPdf } from "../../../../utils/VentaNoFacturadaPdfBuilder";
import { saveRemitoPdf } from "../../../../utils/RemitoPdfBuilder";
import { DEMO_BLOCK_MESSAGE, isBaltoDemoMode } from "../../../../utils/demoMode";
import { DOCUMENTOS_API, documentosRequest } from "../api/documentosComercialesApi.js";

const NULL_OPTION = "";
const API = DOCUMENTOS_API;
const API_PRESUPUESTO_GET = `${API}?action=presupuestos_obtener`;
const API_VENTA_GET = `${API}?action=ventas_obtener`;
const API_CONVERTIR = `${API}?action=presupuestos_convertir_venta`;
const API_CONFIG_FACTURACION = `${API}?action=config_facturacion_get`;
const API_CLIENTE_FISCAL_GET = `${API}?action=cliente_fiscal_get`;
const API_CLIENTE_FISCAL_SAVE = `${API}?action=cliente_fiscal_upsert`;
const API_PADRON_CUIT = `${API}?action=padron_cuit&op=padron_cuit`;
const API_VINCULAR_COMPROBANTE = `${API}?action=ventas_comprobantes_vincular_movimiento`;
const API_CHEQUES_ACTUALIZAR = `${API}?action=mov_global_cheques_actualizar`;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clampFechaHastaHoy(value) {
  const hoy = todayISO();
  const next = String(value ?? "").slice(0, 10);
  return next && next > hoy ? hoy : next;
}

function plusDaysISOFrom(baseIso, days = 10) {
  const base = String(baseIso || todayISO()).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(base) ? new Date(`${base}T00:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function safeText(v) {
  const s = safeStr(v);
  return s || "—";
}

function arcaStorageScope() {
  try {
    const auth = getAuthInfo();
    return Number(auth?.idUsuarioMaster || auth?.idUsuario || 0) || 0;
  } catch {
    return 0;
  }
}

function makeArcaOperationKey(prefix, id) {
  const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${arcaStorageScope()}-${Number(id || 0)}-${uuid}`.slice(0, 100);
}

function presupuestoArcaStorageKey(idPresupuesto) {
  return `balto:arca:presupuesto:${arcaStorageScope()}:${Number(idPresupuesto || 0)}`;
}

function getOrCreatePresupuestoArcaKey(idPresupuesto) {
  const id = Number(idPresupuesto || 0);
  if (!id) return "";
  const storageKey = presupuestoArcaStorageKey(id);
  try {
    const existing = safeStr(window.localStorage?.getItem(storageKey));
    if (existing) return existing;
    const created = makeArcaOperationKey("presupuesto-venta", id);
    window.localStorage?.setItem(storageKey, created);
    return created;
  } catch {
    return makeArcaOperationKey("presupuesto-venta", id);
  }
}

function clearPresupuestoArcaKey(idPresupuesto) {
  const id = Number(idPresupuesto || 0);
  if (!id) return;
  try {
    window.localStorage?.removeItem(presupuestoArcaStorageKey(id));
  } catch {
    // El almacenamiento local es una ayuda de recuperación, no debe bloquear la venta.
  }
}

function onlyDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function moneyARS(v) {
  const n = safeNumber(v);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
}

function formatFechaDMY(v) {
  const s = safeStr(v);
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return s;
}

function getAuthInfo() {
  let usuario = null;
  try {
    usuario = JSON.parse(localStorage.getItem("usuario") || "null");
  } catch {
    usuario = null;
  }

  const candMaster = usuario?.idUsuarioMaster ?? usuario?.id_usuario_master ?? 0;
  const candUser = usuario?.idUsuario ?? usuario?.id_usuario ?? usuario?.id ?? usuario?.user_id ?? candMaster ?? 0;
  const idUsuarioMaster = Number.isFinite(Number(candMaster)) && Number(candMaster) > 0 ? Number(candMaster) : 0;
  const idUsuarioBase = Number.isFinite(Number(candUser)) && Number(candUser) > 0 ? Number(candUser) : 0;
  const idUsuario = idUsuarioBase || idUsuarioMaster || 0;

  return {
    usuario,
    idUsuario,
    idUsuarioMaster: idUsuarioMaster || idUsuario || 0,
    token: localStorage.getItem("token") || localStorage.getItem("auth_token") || "",
    sessionKey:
      localStorage.getItem("session_key") ||
      localStorage.getItem("sessionKey") ||
      localStorage.getItem("x_session") ||
      localStorage.getItem("X-Session") ||
      "",
  };
}

function buildAuthHeaders(isJson = true) {
  const { token, sessionKey } = getAuthInfo();
  const headers = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function getAuditUserPayload() {
  const { idUsuario, idUsuarioMaster } = getAuthInfo();
  return {
    idUsuario,
    idUsuarioMaster,
    id_usuario: idUsuario,
    id_usuario_master: idUsuarioMaster || idUsuario || 0,
  };
}

function getIdUsuarioLocal() {
  const { idUsuario } = getAuthInfo();
  return Number(idUsuario || 0) || null;
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}`);
  }
  if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  return data;
}

async function apiGetJson(url) {
  const res = await documentosRequest(url, { method: "GET", headers: buildAuthHeaders(false) });
  return await parseJsonOrThrow(res);
}

async function apiPostJson(url, payload) {
  const res = await documentosRequest(url, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload ?? {}),
  });
  return await parseJsonOrThrow(res);
}

function buildFormHeaders() {
  return buildAuthHeaders(false);
}

function getMovimientoId(r) {
  const n = Number(r?.id_movimiento ?? r?.idMovimiento ?? r?.id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getClienteId(r) {
  const n = Number(r?.id_cliente ?? r?.cliente_id ?? r?.idCliente ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getTipoVentaId(t) {
  const n = Number(t?.id_tipo_venta ?? t?.id ?? t?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getMedioPagoId(mp) {
  const n = Number(mp?.id_medio_pago ?? mp?.id ?? mp?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getMedioPagoNombre(mp) {
  return safeStr(mp?.nombre ?? mp?.descripcion ?? mp?.detalle ?? mp?.label ?? mp?.medio_pago ?? "");
}

function isContadoTipoVenta(tipo) {
  const n = normalizeText(tipo?.nombre ?? tipo?.descripcion ?? tipo?.detalle ?? tipo?.label ?? tipo ?? "");
  return n.includes("contado") || n.includes("efectivo") || n === "cash";
}

function isCuentaCorrienteTipoVenta(tipo) {
  const n = normalizeText(tipo?.nombre ?? tipo?.descripcion ?? tipo?.detalle ?? tipo?.label ?? tipo ?? "");
  return n.includes("cuenta corriente") || n.includes("cta corriente") || n.includes("credito") || n.includes("crédito");
}

function normalizeChequeTipoFromMedio(nombre) {
  const n = normalizeText(nombre);
  if (n.includes("echeq") || n.includes("e-cheq") || n.includes("e cheq")) return "echeq";
  if (n.includes("cheque")) return "cheque";
  return null;
}

function normalizeList(arr) {
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function normalizeLists(lists) {
  const l = lists && typeof lists === "object" ? lists : {};
  return {
    tiposVenta: normalizeList(l.tiposVenta || l.tipos_venta || l.tipoVenta || []),
    mediosPago: normalizeList(l.mediosPago || l.medios_pago || l.medioPago || []),
  };
}

function normalizeItem(it, i = 0) {
  const cantidad = safeNumber(it?.cantidad ?? it?.cant ?? 0);
  const precio = safeNumber(it?.precio ?? it?.precio_unitario ?? it?.importe_unitario ?? 0);
  const ivaPct = safeNumber(it?.iva_pct ?? it?.ivaPct ?? it?.iva ?? 0);
  const subtotal = safeNumber(it?.subtotal) || cantidad * precio;
  const ivaMonto = safeNumber(it?.iva_monto ?? it?.ivaMonto) || subtotal * ivaPct / 100;
  const total = safeNumber(it?.total ?? it?.ars) || subtotal + ivaMonto;

  return {
    id: it?.id || it?.id_item || `item-${i + 1}`,
    id_detalle: null,
    id_stock_producto: Number(it?.id_stock_producto ?? it?.idStockProducto ?? 0) || null,
    codigo: safeStr(it?.codigo || it?.codigo_producto || i + 1),
    descripcion: safeStr(it?.descripcion || it?.detalle || it?.nombre || it?.producto || it?.nombre_producto || "Producto o servicio"),
    cantidad,
    unidad: safeStr(it?.unidad || "u"),
    precio_unitario: precio,
    precio,
    bonif_pct: 0,
    impBonif: 0,
    subtotal,
    ars: total,
    iva_pct: ivaPct,
    iva_monto: ivaMonto,
    total,
  };
}

function normalizeClienteFiscalDb(data) {
  const s = data && typeof data === "object" ? data : {};
  return {
    id_cliente_fiscal: Number(s.id_cliente_fiscal || 0) || null,
    id_cliente: Number(s.id_cliente || 0) || null,
    doc_tipo: Number(s.doc_tipo || 80) || 80,
    doc_nro: safeStr(s.doc_nro || s.cuit),
    cuit: safeStr(s.cuit || s.doc_nro),
    razon_social: safeStr(s.razon_social || s.nombre || s.cliente),
    condicion_iva: safeStr(s.condicion_iva || s.cond_iva || s.iva),
    cond_iva: safeStr(s.cond_iva || s.condicion_iva || s.iva),
    domicilio: safeStr(s.domicilio || s.direccion),
    origen: safeStr(s.origen || "db"),
  };
}

function normalizeArcaSummary(s) {
  const x = s && typeof s === "object" ? s : {};
  return {
    cuit: safeStr(x.cuit || x.doc_nro),
    razon_social: safeStr(x.razon_social || x.nombre || x.denominacion || x.apellido_nombre),
    condicion_iva: safeStr(x.condicion_iva || x.cond_iva || x.iva || x.descripcion_iva),
    cond_iva: safeStr(x.cond_iva || x.condicion_iva || x.iva || x.descripcion_iva),
    domicilio: safeStr(x.domicilio || x.direccion || x.direccion_fiscal),
    doc_tipo: 80,
    doc_nro: safeStr(x.cuit || x.doc_nro),
    origen: "arca_cuit",
  };
}

function normalizeConfigFacturacionPdf(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const razon = safeStr(c.razon_social || c.nombre_fantasia || c.nombre || c.emisor_razon_social || "BALTO");
  const domicilio = safeStr(
    c.domicilio_comercial ||
      c.emisor_domicilio ||
      c.domicilio ||
      c.domicilio_fiscal ||
      c.direccion ||
      ""
  );
  const condicionIva = safeStr(c.condicion_iva || c.cond_iva || c.iva || c.emisor_condicion_iva || "");
  const ingresosBrutos = safeStr(c.ingresos_brutos || c.iibb || "");
  const inicio = safeStr(c.fecha_inicio_actividades || c.inicio_actividades || "");
  const cuit = safeStr(c.cuit || c.emisor_cuit || "");
  const logoUrl = safeStr(c.logo_url || "");

  return {
    raw: c,
    config_pdf: c,
    emisor_nombre: razon,
    emisor_domicilio: domicilio,
    cuit_emisor: cuit,
    cond_iva_emisor: condicionIva,
    ingresos_brutos_emisor: ingresosBrutos,
    fecha_inicio_actividades_emisor: inicio,
    logo_url: logoUrl,
    emisor: {
      razon_social: razon,
      nombre_fantasia: safeStr(c.nombre_fantasia || ""),
      domicilio_comercial: domicilio,
      domicilio_fiscal: domicilio,
      domicilio,
      direccion: domicilio,
      cuit,
      condicion_iva: condicionIva,
      cond_iva: condicionIva,
      ingresos_brutos: ingresosBrutos,
      iibb: ingresosBrutos,
      fecha_inicio_actividades: inicio,
      inicio_actividades: inicio,
      punto_venta: safeStr(c.punto_venta || ""),
      tipo_comprobante_default: safeStr(c.tipo_comprobante_default || ""),
      codigo_comprobante: safeStr(c.codigo_comprobante || ""),
      logo_url: logoUrl,
    },
  };
}

function buildClienteFiscalPdf(fiscal, clienteBase, nombreFallback) {
  const f = fiscal && typeof fiscal === "object" ? fiscal : {};
  const c = clienteBase && typeof clienteBase === "object" ? clienteBase : {};
  const cuit = safeStr(f.cuit || f.doc_nro || c.cuit || c.doc_nro);
  return {
    id_cliente: Number(f.id_cliente || c.id_cliente || 0) || null,
    doc_tipo: Number(f.doc_tipo || (cuit ? 80 : 99)) || 99,
    doc_nro: safeStr(f.doc_nro || cuit || c.doc_nro),
    cuit,
    razon_social: safeStr(f.razon_social || c.razon_social || c.nombre || nombreFallback || "Cliente"),
    cond_iva: safeStr(f.cond_iva || f.condicion_iva || c.cond_iva || c.condicion_iva),
    condicion_iva: safeStr(f.condicion_iva || f.cond_iva || c.condicion_iva || c.cond_iva),
    domicilio: safeStr(f.domicilio || c.domicilio || c.direccion),
    origen: safeStr(f.origen || "documento_comercial"),
  };
}

function buildMediosPagoPayload(mediosFilas, mediosPagoList) {
  return (Array.isArray(mediosFilas) ? mediosFilas : [])
    .filter((mp) => mp?.id_medio_pago && mp.id_medio_pago !== "")
    .map((mp) => {
      const mpRow = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago));
      const medioPagoNombre = getMedioPagoNombre(mpRow);
      const tipoCheque = normalizeChequeTipoFromMedio(medioPagoNombre);

      const base = {
        frontend_row_uid: mp.id,
        id_medio_pago: Number(mp.id_medio_pago),
        nombre: medioPagoNombre,
        medio_pago: medioPagoNombre,
        descripcion: medioPagoNombre,
        monto: tipoCheque !== null ? safeNumber(mp.cheque?.importe) : safeNumber(mp.monto),
      };

      if (tipoCheque !== null && mp.cheque) {
        return {
          ...base,
          cheque: {
            tipo: tipoCheque,
            fecha_emision: mp.cheque.fecha_emision,
            emisor: mp.cheque.emisor,
            numero_cheque: mp.cheque.numero_cheque,
            importe: safeNumber(mp.cheque.importe),
            fecha_pago: mp.cheque.fecha_pago,
            observaciones: mp.cheque.observaciones || "",
            archivo_nombre:
              mp.cheque.archivo_nombre ||
              (mp.cheque.archivo instanceof File ? mp.cheque.archivo.name : ""),
          },
        };
      }

      return base;
    });
}

function formatEditableMoney(v) {
  const n = safeNumber(v);
  if (!n) return "";
  return String(n).replace(".", ",");
}

function buildEmptyMedioPago(montoInicial = 0) {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `mp-${Date.now()}-${Math.random()}`;
  const monto = safeNumber(montoInicial);
  return {
    id,
    id_medio_pago: NULL_OPTION,
    monto,
    montoDraft: formatEditableMoney(monto),
    montoFocused: false,
    cheque: null,
  };
}


function getVentaGeneradaId(source) {
  const s = source && typeof source === "object" ? source : {};
  const candidates = [
    s.id_venta_generada,
    s.id_movimiento_venta,
    s.id_venta,
    s.venta_id,
    s.id_movimiento_generado,
    s.id_movimiento_destino,
    s.id_destino,
    s.venta_generada?.id_movimiento,
    s.venta_generada?.id_venta,
    s.venta?.id_movimiento,
    s.venta?.id_venta,
    s.movimiento_venta?.id_movimiento,
    s.movimiento_venta?.id_venta,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function getFirstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function getTipoVentaNombreFromSource(source) {
  const s = source && typeof source === "object" ? source : {};
  return safeStr(
    s.tipo_venta_nombre ||
      s.nombre_tipo_venta ||
      s.tipo_pago_nombre ||
      s.forma_pago_nombre ||
      s.tipo_venta ||
      s.tipo_pago ||
      s.forma_pago ||
      s.condicion_venta ||
      s.condicion_pago ||
      s.tipoVenta?.nombre ||
      s.tipoVenta?.descripcion ||
      ""
  );
}

function resolveTipoVentaIdFromVenta(venta, tiposVentaList) {
  const v = venta && typeof venta === "object" ? venta : {};
  const explicit = Number(v.id_tipo_venta ?? v.tipo_venta_id ?? v.idTipoVenta ?? v.id_tipo_pago ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return String(explicit);

  const nombre = normalizeText(getTipoVentaNombreFromSource(v));
  if (!nombre) return "";

  const found = (Array.isArray(tiposVentaList) ? tiposVentaList : []).find((t) => {
    const txt = normalizeText(t?.nombre || t?.descripcion || t?.detalle || t?.label || "");
    return txt && (txt === nombre || txt.includes(nombre) || nombre.includes(txt));
  });

  const id = found ? getTipoVentaId(found) : null;
  return id ? String(id) : "__tipo_convertido__";
}

function resolveMedioPagoIdFromSource(mp, mediosPagoList) {
  const source = mp && typeof mp === "object" ? mp : {};
  const explicit = Number(source.id_medio_pago ?? source.medio_pago_id ?? source.idMedioPago ?? source.id ?? source.value ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const nombre = normalizeText(
    source.medio_pago_nombre ||
      source.nombre_medio ||
      source.nombre ||
      source.medio_pago ||
      source.descripcion ||
      source.detalle ||
      source.label ||
      ""
  );
  if (!nombre) return null;

  const found = (Array.isArray(mediosPagoList) ? mediosPagoList : []).find((m) => {
    const txt = normalizeText(m?.nombre || m?.descripcion || m?.detalle || m?.label || m?.medio_pago || "");
    return txt && (txt === nombre || txt.includes(nombre) || nombre.includes(txt));
  });

  const id = found ? getMedioPagoId(found) : null;
  return id || null;
}

function getMedioPagoNombreFromSource(mp, mediosPagoList) {
  const source = mp && typeof mp === "object" ? mp : {};
  const direct = safeStr(
    source.medio_pago_nombre ||
      source.nombre_medio ||
      source.nombre ||
      source.medio_pago ||
      source.descripcion ||
      source.detalle ||
      source.label ||
      ""
  );
  if (direct) return direct;

  const id = resolveMedioPagoIdFromSource(source, mediosPagoList);
  const found = (Array.isArray(mediosPagoList) ? mediosPagoList : []).find(
    (m) => String(getMedioPagoId(m) ?? "") === String(id ?? "")
  );
  return getMedioPagoNombre(found);
}

function buildChequeFromMedioSource(mp, medioNombre, monto) {
  const source = mp && typeof mp === "object" ? mp : {};
  const chequeSource = source.cheque && typeof source.cheque === "object" ? source.cheque : source;
  const medioIndicaCheque = normalizeChequeTipoFromMedio(medioNombre);
  const tipoExplicito = normalizeChequeTipoFromMedio(
    source.cheque_tipo ||
      source.tipo_cheque ||
      source.tipo ||
      chequeSource.cheque_tipo ||
      chequeSource.tipo_cheque ||
      chequeSource.tipo ||
      ""
  );
  const tipoDetectado = tipoExplicito || medioIndicaCheque;
  const hasChequeObject = !!(source.cheque && typeof source.cheque === "object");
  const hasChequeObjectData = hasChequeObject
    ? Object.values(source.cheque).some((v) => v !== null && v !== undefined && String(v).trim() !== "")
    : false;

  const idCheque = Number(source.id_cheque || chequeSource.id_cheque || 0) || null;
  const numeroCheque = safeStr(
    source.numero_cheque ||
      source.nro_cheque ||
      source.cheque_numero ||
      source.numero ||
      chequeSource.numero_cheque ||
      chequeSource.nro_cheque ||
      chequeSource.cheque_numero ||
      chequeSource.numero ||
      ""
  );
  const emisor = safeStr(source.emisor || source.librador || chequeSource.emisor || chequeSource.librador || "");
  const fechaEmision = safeStr(source.fecha_emision || chequeSource.fecha_emision || "").slice(0, 10);
  const fechaPago = safeStr(
    source.fecha_pago || source.fecha_vencimiento || chequeSource.fecha_pago || chequeSource.fecha_vencimiento || ""
  ).slice(0, 10);
  const importe = safeNumber(
    source.cheque_importe ??
      chequeSource.cheque_importe ??
      source.importe ??
      chequeSource.importe ??
      source.monto ??
      monto
  );
  const observaciones = safeStr(
    source.cheque_descripcion ||
      source.descripcion_cheque ||
      source.observaciones ||
      source.descripcion ||
      chequeSource.cheque_descripcion ||
      chequeSource.descripcion_cheque ||
      chequeSource.observaciones ||
      chequeSource.descripcion ||
      ""
  );

  const hasChequeIdentity = idCheque || numeroCheque || emisor || tipoDetectado;
  const hasChequePayload = hasChequeObjectData && (fechaEmision || fechaPago || importe || observaciones);

  // Los pagos comunes también traen fecha_pago. No alcanza para tratarlos como cheque:
  // solo mostramos el bloque de cheque si el medio/tipo lo indica, viene id_cheque,
  // número/emisor o un objeto cheque explícito.
  if (!hasChequeIdentity && !hasChequePayload) return null;

  return {
    id_cheque: idCheque,
    tipo: tipoDetectado || safeStr(source.cheque_tipo || source.tipo_cheque || chequeSource.tipo || "cheque"),
    fecha_emision: fechaEmision,
    emisor,
    numero_cheque: numeroCheque,
    importe: importe || safeNumber(source.monto ?? monto),
    fecha_pago: fechaPago,
    observaciones,
    descripcion: observaciones,
    cheque_descripcion: observaciones,
    archivo_nombre: safeStr(source.archivo_nombre || chequeSource.archivo_nombre || source.nombre_archivo || ""),
  };
}

function buildMediosFilasFromVenta(venta, mediosPagoList, totalFallback = 0) {
  const v = venta && typeof venta === "object" ? venta : {};
  const detalles = getFirstArray(
    v.medios_pago_detalle,
    v.medios_pago,
    v.medios,
    v.pagos,
    v.detalle_medios_pago,
    v.movimientos_medios_pago
  );

  const rows = detalles
    .map((mp, idx) => {
      const idMedio = resolveMedioPagoIdFromSource(mp, mediosPagoList);
      if (!idMedio) return null;
      const monto = safeNumber(mp?.monto ?? mp?.importe ?? mp?.total ?? mp?.monto_pagado ?? totalFallback);
      const medioNombre = getMedioPagoNombreFromSource(mp, mediosPagoList);
      return {
        id: `convertido-mp-${mp?.id_movimiento_medio_pago || mp?.id_pago_medio || mp?.id || idx}`,
        id_medio_pago: String(idMedio),
        monto,
        montoDraft: formatEditableMoney(monto),
        montoFocused: false,
        cheque: buildChequeFromMedioSource(mp, medioNombre, monto),
      };
    })
    .filter(Boolean);

  if (rows.length) return rows;

  const legacyId = resolveMedioPagoIdFromSource(v, mediosPagoList);
  if (legacyId) {
    const monto = safeNumber(v.monto_pagado ?? v.importe_pagado ?? v.monto_total ?? v.total ?? totalFallback);
    const medioNombre = getMedioPagoNombreFromSource(v, mediosPagoList);
    return [
      {
        id: "convertido-mp-legacy",
        id_medio_pago: String(legacyId),
        monto,
        montoDraft: formatEditableMoney(monto),
        montoFocused: false,
        cheque: buildChequeFromMedioSource(v, medioNombre, monto),
      },
    ];
  }

  return [];
}

function getChequeFileFromRows(rows, uid) {
  const row = (Array.isArray(rows) ? rows : []).find((r) => String(r.id) === String(uid));
  const file = row?.cheque?.archivo;
  return file instanceof File ? file : null;
}


function ReadOnlyMediosPagoVenta({ mediosFilas, mediosPagoList }) {
  const rows = (Array.isArray(mediosFilas) ? mediosFilas : []).filter((mp) => mp?.id_medio_pago);

  if (!rows.length) {
    return (
      <div className="dc-info">
        No se encontraron medios de pago vinculados a la venta generada.
      </div>
    );
  }

  return (
    <div className="dc-payment-readonly-panel">
      {rows.map((mp, idx) => {
        const found = mediosPagoList.find((m) => String(getMedioPagoId(m) ?? "") === String(mp.id_medio_pago ?? ""));
        const medioNombre = safeText(getMedioPagoNombre(found));
        const cheque = mp?.cheque || null;
        const monto = cheque ? safeNumber(cheque.importe ?? mp.monto) : safeNumber(mp.monto);
        const chequeTipo = normalizeChequeTipoFromMedio(cheque?.tipo || medioNombre);

        return (
          <div key={mp.id || `readonly-mp-${idx}`} className="dc-payment-readonly-card">
            <div className="dc-payment-readonly-main">
              <div>
                <b>{medioNombre}</b>
                <span>Pago registrado</span>
              </div>
              <strong>{moneyARS(monto)}</strong>
            </div>

            {cheque ? (
              <div className="dc-payment-readonly-cheque">
                <b>{chequeTipo === "echeq" ? "E-Cheq cargado" : "Cheque cargado"}</b>
                {cheque.numero_cheque ? <span><b>N°:</b> {cheque.numero_cheque}</span> : null}
                {cheque.emisor ? <span><b>Emisor:</b> {cheque.emisor}</span> : null}
                {cheque.fecha_emision ? <span><b>Emisión:</b> {formatFechaDMY(cheque.fecha_emision)}</span> : null}
                {cheque.fecha_pago ? <span><b>Pago:</b> {formatFechaDMY(cheque.fecha_pago)}</span> : null}
                <span><b>Importe:</b> {moneyARS(monto)}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ModalAsignarPresupuestoVenta({
  open,
  row,
  lists,
  onClose,
  onSaved,
  onToast,
}) {
  const showToast = useCallback(
    (tipo, mensaje, duracion = 3600) => {
      if (typeof onToast === "function") onToast(tipo, mensaje, duracion);
    },
    [onToast]
  );

  const listas = useMemo(() => normalizeLists(lists), [lists]);
  const mediosPagoList = useMemo(() => listas.mediosPago, [listas.mediosPago]);
  const tiposVentaList = useMemo(() => listas.tiposVenta, [listas.tiposVenta]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [fecha, setFecha] = useState(todayISO());
  const [idTipoVenta, setIdTipoVenta] = useState("");
  const [mediosFilas, setMediosFilas] = useState([]);
  const [clienteFiscalDb, setClienteFiscalDb] = useState(null);
  const [fiscalCuitInput, setFiscalCuitInput] = useState("");
  const [fiscalArcaData, setFiscalArcaData] = useState(null);
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [openResumenFactura, setOpenResumenFactura] = useState(false);
  const [resumenFacturaData, setResumenFacturaData] = useState(null);
  const [fiscalParaFacturar, setFiscalParaFacturar] = useState(null);
  const [mostrarCuitFiscal, setMostrarCuitFiscal] = useState(false);
  const [arcaOperationKey, setArcaOperationKey] = useState("");
  const abortRef = useRef(null);

  const convertido = Number(row?.convertido_a_venta ?? row?.convertido ?? 0) === 1;
  const idPresupuesto = useMemo(() => getMovimientoId(row), [row]);

  const clienteBase = useMemo(() => {
    const mov = detalle?.presupuesto || detalle?.movimiento || row || {};
    return {
      id_cliente: getClienteId(mov) || getClienteId(row),
      nombre: safeStr(mov?.cliente || mov?.cliente_nombre || row?.cliente || row?.cliente_nombre || "Cliente"),
      razon_social: safeStr(mov?.razon_social || row?.razon_social || ""),
      domicilio: safeStr(mov?.domicilio || row?.domicilio || ""),
    };
  }, [detalle, row]);

  const items = useMemo(() => {
    const arr = Array.isArray(detalle?.items) ? detalle.items : [];
    return arr.map(normalizeItem);
  }, [detalle]);

  const total = useMemo(() => {
    const mov = detalle?.presupuesto || detalle?.movimiento || row || {};
    const n = safeNumber(mov?.monto_total ?? row?.monto_total ?? row?.total);
    return n > 0 ? n : items.reduce((acc, it) => acc + safeNumber(it.total), 0);
  }, [detalle, row, items]);

  const subtotal = useMemo(() => items.reduce((acc, it) => acc + safeNumber(it.subtotal), 0), [items]);
  const ivaTotal = useMemo(() => items.reduce((acc, it) => acc + safeNumber(it.iva_monto), 0), [items]);

  const ventaGeneradaConvertida = useMemo(() => {
    const conv = detalle?.conversion && typeof detalle.conversion === "object" ? detalle.conversion : {};
    return detalle?.venta_generada || conv?.venta_generada || conv?.venta || row?.venta_generada || row?.venta || {};
  }, [detalle, row]);

  const tipoVentaConvertidaNombre = useMemo(() => {
    if (!convertido) return "";
    return safeStr(
      getTipoVentaNombreFromSource(ventaGeneradaConvertida) ||
        getTipoVentaNombreFromSource(detalle?.conversion) ||
        getTipoVentaNombreFromSource(row)
    );
  }, [convertido, ventaGeneradaConvertida, detalle, row]);

  const tipoVentaSelected = useMemo(() => {
    const found = tiposVentaList.find((t) => String(getTipoVentaId(t) ?? "") === String(idTipoVenta));
    if (found) return found;
    if (convertido && tipoVentaConvertidaNombre) {
      return { id: idTipoVenta || "__tipo_convertido__", nombre: tipoVentaConvertidaNombre };
    }
    return null;
  }, [tiposVentaList, idTipoVenta, convertido, tipoVentaConvertidaNombre]);

  const isContado = useMemo(() => isContadoTipoVenta(tipoVentaSelected), [tipoVentaSelected]);
  const isCuentaCorriente = useMemo(() => !isContado && (tipoVentaSelected ? isCuentaCorrienteTipoVenta(tipoVentaSelected) || true : false), [isContado, tipoVentaSelected]);

  const mediosPayload = useMemo(() => buildMediosPagoPayload(mediosFilas, mediosPagoList), [mediosFilas, mediosPagoList]);
  const sumaMedios = useMemo(() => mediosPayload.reduce((acc, mp) => acc + safeNumber(mp.monto), 0), [mediosPayload]);

  const fiscalActual = useMemo(() => {
    if (fiscalArcaData?.cuit) return fiscalArcaData;
    if (clienteFiscalDb?.cuit || clienteFiscalDb?.doc_nro) return clienteFiscalDb;
    return null;
  }, [fiscalArcaData, clienteFiscalDb]);

  const fetchClienteFiscal = useCallback(async (idCliente) => {
    if (!idCliente) {
      setClienteFiscalDb(null);
      return null;
    }
    try {
      const p = new URLSearchParams({ id_cliente: String(idCliente) });
      const data = await apiGetJson(`${API_CLIENTE_FISCAL_GET}&${p.toString()}`);
      const raw = data?.cliente_fiscal || data?.cliente || data?.data || data;
      const fiscal = normalizeClienteFiscalDb(raw || {});
      if (fiscal.cuit || fiscal.doc_nro || fiscal.razon_social) {
        setClienteFiscalDb(fiscal);
        setFiscalCuitInput(onlyDigits(fiscal.cuit || fiscal.doc_nro));
        return fiscal;
      }
      setClienteFiscalDb(null);
      return null;
    } catch {
      setClienteFiscalDb(null);
      return null;
    }
  }, []);


  const fetchVentaGeneradaInfo = useCallback(async (idVenta) => {
    const id = Number(idVenta || 0);
    if (!id) return null;
    try {
      const data = await apiGetJson(`${API_VENTA_GET}&id_movimiento=${encodeURIComponent(id)}`);
      const venta =
        data?.venta ||
        data?.movimiento ||
        data?.venta_generada ||
        data?.data?.venta ||
        data?.data?.movimiento ||
        (Array.isArray(data?.ventas) ? data.ventas[0] : null) ||
        (Array.isArray(data?.movimientos) ? data.movimientos[0] : null) ||
        (Array.isArray(data?.data) ? data.data[0] : null) ||
        {};
      const medios = getFirstArray(
        data?.medios_pago_detalle,
        data?.medios_pago,
        data?.medios,
        venta?.medios_pago_detalle,
        venta?.medios_pago,
        venta?.medios,
        venta?.movimientos_medios_pago
      );
      return { ...venta, medios_pago_detalle: medios };
    } catch {
      return null;
    }
  }, []);

  const fetchDetalle = useCallback(async () => {
    if (!idPresupuesto) return;
    abortRef.current?.abort?.();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const data = await apiGetJson(`${API_PRESUPUESTO_GET}&id_movimiento=${encodeURIComponent(idPresupuesto)}`);
      if (controller.signal.aborted) return;
      const conversion = data?.conversion || data?.presupuesto_conversion || data?.conversion_presupuesto || null;
      const presupuestoBase = data?.presupuesto || data?.movimiento || row || null;
      let ventaGenerada =
        data?.venta_generada ||
        data?.venta_convertida ||
        data?.movimiento_venta ||
        data?.venta ||
        conversion?.venta_generada ||
        conversion?.venta ||
        row?.venta_generada ||
        row?.venta ||
        null;

      const idVentaGenerada = getVentaGeneradaId({
        ...row,
        ...(conversion || {}),
        venta_generada: ventaGenerada,
      });

      if (convertido && idVentaGenerada) {
        const ventaCompleta = await fetchVentaGeneradaInfo(idVentaGenerada);
        if (ventaCompleta) {
          const mediosBase = getFirstArray(
            ventaGenerada?.medios_pago_detalle,
            ventaGenerada?.medios_pago,
            ventaGenerada?.medios
          );
          const mediosCompletos = getFirstArray(
            ventaCompleta?.medios_pago_detalle,
            ventaCompleta?.medios_pago,
            ventaCompleta?.medios
          );
          ventaGenerada = {
            ...(ventaGenerada || {}),
            ...ventaCompleta,
            medios_pago_detalle: mediosCompletos.length ? mediosCompletos : mediosBase,
          };
        }
      }

      const nextDetalle = {
        presupuesto: presupuestoBase,
        items: Array.isArray(data?.items) ? data.items : [],
        conversion,
        venta_generada: ventaGenerada,
      };
      setDetalle(nextDetalle);

      if (convertido) {
        const ventaSource = { ...(conversion || {}), ...(ventaGenerada || {}) };
        const fechaConvertida = clampFechaHastaHoy(
          ventaSource?.fecha || ventaSource?.fecha_movimiento || conversion?.fecha_conversion || row?.fecha_conversion || row?.fecha || todayISO()
        );
        if (fechaConvertida) setFecha(String(fechaConvertida).slice(0, 10));

        const nextTipoVenta = resolveTipoVentaIdFromVenta(ventaSource, tiposVentaList);
        if (nextTipoVenta) setIdTipoVenta(nextTipoVenta);

        const nextMedios = buildMediosFilasFromVenta(
          ventaSource,
          mediosPagoList,
          safeNumber(ventaSource?.monto_total ?? ventaSource?.total ?? presupuestoBase?.monto_total ?? row?.monto_total ?? row?.total)
        );
        setMediosFilas(nextMedios);
      }

      const clienteId = getClienteId(nextDetalle.presupuesto) || getClienteId(row);
      fetchClienteFiscal(clienteId);
    } catch (e) {
      if (!controller.signal.aborted) showToast("error", e?.message || "No se pudo cargar el presupuesto.", 5200);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [idPresupuesto, row, fetchClienteFiscal, showToast, convertido, fetchVentaGeneradaInfo, tiposVentaList, mediosPagoList]);

  useEffect(() => {
    if (!open) return undefined;
    setDetalle(null);
    setFiscalArcaData(null);
    setClienteFiscalDb(null);
    setFiscalCuitInput("");
    setMostrarCuitFiscal(false);
    setIdTipoVenta("");
    setMediosFilas(convertido ? [] : [buildEmptyMedioPago(0)]);
    setFecha(todayISO());
    setArcaOperationKey(
      !convertido && idPresupuesto ? getOrCreatePresupuestoArcaKey(idPresupuesto) : ""
    );
    fetchDetalle();
    return () => abortRef.current?.abort?.();
  }, [open, row, fetchDetalle, convertido, idPresupuesto]);

  useEffect(() => {
    if (!open || !isContado || convertido) return;
    setMediosFilas((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.length ? arr : [buildEmptyMedioPago(0)];
    });
  }, [open, isContado, convertido]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving && !openResumenFactura) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving, openResumenFactura, onClose]);

  const updateMedioPago = useCallback((id, patch) => {
    setMediosFilas((prev) => (Array.isArray(prev) ? prev : []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeMedioPago = useCallback((id) => {
    setMediosFilas((prev) => {
      const arr = (Array.isArray(prev) ? prev : []).filter((r) => r.id !== id);
      return arr.length ? arr : [buildEmptyMedioPago(0)];
    });
  }, []);

  const addMedioPago = useCallback(() => {
    setMediosFilas((prev) => [...(Array.isArray(prev) ? prev : []), buildEmptyMedioPago(0)]);
  }, []);

  const fetchConfigFacturacion = useCallback(async () => {
    try {
      const data = await apiGetJson(API_CONFIG_FACTURACION);
      return data?.config || data?.config_facturacion || data?.data || data || {};
    } catch {
      return {};
    }
  }, []);

  const guardarClienteFiscal = useCallback(async (fiscal) => {
    const idCliente = clienteBase.id_cliente;
    if (!idCliente || !fiscal?.cuit) return fiscal;
    try {
      const payload = {
        id_cliente: idCliente,
        doc_tipo: 80,
        doc_nro: onlyDigits(fiscal.cuit || fiscal.doc_nro),
        cuit: onlyDigits(fiscal.cuit || fiscal.doc_nro),
        razon_social: safeStr(fiscal.razon_social),
        condicion_iva: safeStr(fiscal.condicion_iva || fiscal.cond_iva),
        domicilio: safeStr(fiscal.domicilio),
      };
      const data = await apiPostJson(API_CLIENTE_FISCAL_SAVE, payload);
      const saved = normalizeClienteFiscalDb(data?.cliente_fiscal || data?.data || payload);
      setClienteFiscalDb(saved);
      return saved;
    } catch {
      return fiscal;
    }
  }, [clienteBase.id_cliente]);

  const buscarFiscalEnArca = useCallback(async () => {
    const cuit = onlyDigits(fiscalCuitInput);
    if (cuit.length !== 11) {
      showToast("advertencia", "Ingresá un CUIT válido de 11 dígitos para facturar.", 4200);
      return null;
    }
    setFiscalLoading(true);
    try {
      const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${encodeURIComponent(cuit)}`);
      const raw = data?.data?.summary || data?.summary || data?.persona || data?.fiscal || data?.data || data?.resultado || data;
      const fiscal = normalizeArcaSummary({ ...raw, cuit });
      if (!fiscal.razon_social) fiscal.razon_social = clienteBase.nombre || "Cliente";
      setFiscalArcaData(fiscal);
      await guardarClienteFiscal(fiscal);
      showToast("exito", "Datos fiscales cargados correctamente.", 2600);
      return fiscal;
    } catch (e) {
      showToast("error", e?.message || "No se pudo consultar el CUIT.", 5200);
      return null;
    } finally {
      setFiscalLoading(false);
    }
  }, [fiscalCuitInput, clienteBase.nombre, guardarClienteFiscal, showToast]);

  const resolveFiscalParaFacturar = useCallback(async () => {
    let fiscal = fiscalArcaData || clienteFiscalDb;
    if (!fiscal?.cuit && onlyDigits(fiscalCuitInput).length === 11) {
      fiscal = await buscarFiscalEnArca();
    }
    if (!fiscal?.cuit && !fiscal?.doc_nro) {
      throw new Error("Para emitir factura real tenés que cargar el CUIT/datos fiscales del cliente.");
    }
    return buildClienteFiscalPdf(fiscal, clienteBase, clienteBase.nombre);
  }, [fiscalArcaData, clienteFiscalDb, fiscalCuitInput, buscarFiscalEnArca, clienteBase]);

  const fiscalPdfParaInterno = useCallback(() => {
    return buildClienteFiscalPdf(fiscalActual || {}, clienteBase, clienteBase.nombre);
  }, [fiscalActual, clienteBase]);

  const validate = useCallback((modo) => {
    if (convertido) return "Este presupuesto ya fue convertido en venta.";
    if (!idPresupuesto) return "No se encontró el ID del presupuesto.";
    if (!clienteBase.id_cliente) return "El presupuesto no tiene un cliente válido.";
    if (!items.length) return "El presupuesto no tiene productos o servicios cargados.";
    if (!idTipoVenta) return "Seleccioná la forma de venta.";
    if (total <= 0) return "El total del presupuesto debe ser mayor a cero.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return "Seleccioná una fecha válida.";
    if (String(fecha).slice(0, 10) > todayISO()) return "La fecha no puede ser posterior al día actual.";
    if (isContado) {
      if (!mediosPayload.length) return "Para venta contado cargá al menos un medio de pago.";
      if (sumaMedios < total - 0.05) return "La suma de los medios de pago no cubre el total de la venta.";
    }
    if (modo === "facturar" && !clienteBase.id_cliente) return "Para facturar necesitás un cliente válido.";
    return "";
  }, [convertido, idPresupuesto, clienteBase.id_cliente, items.length, idTipoVenta, total, fecha, isContado, mediosPayload.length, sumaMedios]);

  const buildComprobantePayload = useCallback((cfg, fiscal, idVenta, extra = {}) => {
    const puntoVenta = Number(String(cfg?.punto_venta || "2").replace(/\D/g, "")) || 2;
    const codigoCbte = Number(String(cfg?.codigo_comprobante || "11").replace(/\D/g, "")) || 11;
    const primerMedioId = mediosPayload[0]?.id_medio_pago || null;
    const emisorPdf = normalizeConfigFacturacionPdf(cfg || {});
    const tipoVentaNombre = safeStr(tipoVentaSelected?.nombre || tipoVentaSelected?.descripcion || tipoVentaSelected?.detalle || (isContado ? "Contado" : "Cuenta corriente"));

    return {
      id_pago: null,
      id_sistema: null,
      labelCliente: fiscal?.razon_social || clienteBase.nombre || "Cliente",
      labelSistema: "Venta desde presupuesto",
      cliente_facturacion: fiscal || fiscalPdfParaInterno(),
      config_facturacion: cfg || {},
      ...emisorPdf,
      id_cliente: clienteBase.id_cliente || null,
      id_tipo_venta: Number(idTipoVenta || 0) || null,
      tipo_venta_nombre: tipoVentaNombre,
      id_medio_pago: isContado ? primerMedioId : null,
      id_clasificacion: null,
      fecha_cbte_iso: String(fecha).slice(0, 10),
      vto_pago_iso: plusDaysISOFrom(fecha, 10),
      cbte_tipo: extra.cbte_tipo ?? codigoCbte,
      pto_vta: extra.pto_vta ?? puntoVenta,
      items_facturacion: items,
      medios_pago: isContado ? mediosPayload : [],
      total_ars: total,
      monto: total,
      importe: total,
      ids_movimiento: idVenta ? [Number(idVenta)] : [],
      id_presupuesto_origen: idPresupuesto,
      operacion_key: arcaOperationKey || getOrCreatePresupuestoArcaKey(idPresupuesto),
      operacion_contexto: "PRESUPUESTO_VENTA",
      operacion_id_origen: idPresupuesto,
      observaciones: extra.observaciones || "",
      emisor: emisorPdf.emisor,
      ...extra,
    };
  }, [mediosPayload, tipoVentaSelected, isContado, clienteBase, idTipoVenta, fecha, items, total, idPresupuesto, fiscalPdfParaInterno, arcaOperationKey]);

  const subirPdfDocumento = useCallback(async ({ tipo, idMovimiento, blob, filename, meta, emitidoEnArca = false, factura = null }) => {
    if (!idMovimiento || !blob) throw new Error(`No se pudo generar o subir ${String(tipo || "comprobante").toLowerCase()}.`);
    const fd = new FormData();
    fd.append("tipo", tipo);
    fd.append("id_movimiento", String(idMovimiento));
    if (Array.isArray(meta?.ids_movimiento) && meta.ids_movimiento.length) {
      fd.append("ids_movimiento", JSON.stringify(meta.ids_movimiento));
    }
    fd.append("pdf", blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }), filename || `${String(tipo || "comprobante").toLowerCase()}.pdf`);
    fd.append("meta", JSON.stringify({
      tipo,
      estado: emitidoEnArca ? "emitida" : String(tipo || "").toLowerCase(),
      emitido_en_arca: emitidoEnArca ? 1 : 0,
      id_pago: meta?.id_pago ?? null,
      id_sistema: meta?.id_sistema ?? null,
      id_cliente: meta?.id_cliente ?? clienteBase.id_cliente ?? null,
      ids_movimiento: Array.isArray(meta?.ids_movimiento) ? meta.ids_movimiento : [],
      monto_ars: Number(meta?.total_ars ?? meta?.importe ?? total ?? 0),
      fecha_cbte: meta?.fecha_cbte_iso ?? null,
      razon_social: meta?.cliente_facturacion?.razon_social || meta?.labelCliente || null,
      cond_iva: meta?.cliente_facturacion?.cond_iva || meta?.cliente_facturacion?.condicion_iva || null,
      domicilio: meta?.cliente_facturacion?.domicilio || null,
      cliente_facturacion: meta?.cliente_facturacion || null,
      emisor: meta?.emisor || null,
      config_facturacion: meta?.config_facturacion || null,
      resultado: emitidoEnArca ? "A" : "P",
      cae: factura?.cae ?? null,
      cae_vto: factura?.cae_vto ?? null,
      cbte_tipo: meta?.cbte_tipo ?? factura?.cbte_tipo ?? null,
      pto_vta: meta?.pto_vta ?? factura?.pto_vta ?? null,
      cbte_nro: factura?.cbte_nro ?? factura?.numero ?? null,
      json_arca: factura?.json_arca || factura?.raw_min || factura || null,
      resumen_facturacion: {
        ...meta,
        tipo,
        emitido_en_arca: emitidoEnArca ? 1 : 0,
        items_facturacion: Array.isArray(meta?.items_facturacion) ? meta.items_facturacion : [],
      },
    }));

    const data = await documentosRequest(API_VINCULAR_COMPROBANTE, {
      method: "POST",
      headers: buildFormHeaders(),
      body: fd,
    }).then(parseJsonOrThrow);
    return data;
  }, [clienteBase.id_cliente, total]);

  const getIdVentaFromResponse = useCallback((info) => {
    const id = Number(
      info?.id_movimiento_venta ||
        info?.id_movimiento ||
        info?.id_venta ||
        info?.ids?.[0] ||
        info?.ids_movimiento?.[0] ||
        info?.conversion?.id_venta ||
        0
    );
    return Number.isFinite(id) && id > 0 ? id : 0;
  }, []);

  const actualizarChequeConArchivo = useCallback(async ({ idCheque, idMovimiento, cheque }) => {
    if (!(cheque?.archivo instanceof File)) return null;

    const idMov = Number(idMovimiento || 0);
    if (!idMov) {
      throw new Error("No se pudo adjuntar el archivo del cheque porque no se recibió el movimiento de la venta.");
    }

    const fd = new FormData();
    const { idUsuario } = getAuthInfo();

    fd.append("id_cheque", String(idCheque));
    fd.append("id_movimiento", String(idMov));
    fd.append("idUsuario", String(idUsuario || 0));
    fd.append("tipo", String(cheque?.tipo || "cheque"));
    fd.append("tipo_cheque", String(cheque?.tipo || "cheque"));

    const fechaEmisionCheque = String(cheque?.fecha_emision || "").slice(0, 10);
    const fechaPagoCheque = String(cheque?.fecha_pago || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaEmisionCheque)) {
      fd.append("fecha_emision", fechaEmisionCheque);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaPagoCheque)) {
      fd.append("fecha_pago", fechaPagoCheque);
    }

    fd.append("emisor", String(cheque?.emisor || "").trim().toUpperCase());
    fd.append("numero_cheque", String(cheque?.numero_cheque || "").trim());
    fd.append("importe", String(safeNumber(cheque?.importe || 0)));
    fd.append("observaciones", String(cheque?.observaciones || "").trim());
    fd.append("archivo", cheque.archivo, cheque.archivo_nombre || cheque.archivo.name || "cheque.pdf");

    const data = await documentosRequest(API_CHEQUES_ACTUALIZAR, {
      method: "POST",
      headers: buildFormHeaders(),
      body: fd,
    }).then(parseJsonOrThrow);

    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo adjuntar el archivo del cheque.");
    return data;
  }, []);

  const subirArchivosChequesCreados = useCallback(async (info) => {
    const creados = Array.isArray(info?.cheques_creados) ? info.cheques_creados : [];
    if (!creados.length) return;

    const idVentaFallback = getIdVentaFromResponse(info);

    await Promise.all(creados.map(async (ch) => {
      const uid = String(ch?.frontend_row_uid || "");
      const idCheque = Number(ch?.id_cheque || 0);
      const idMovimiento = Number(ch?.id_movimiento || idVentaFallback || 0);
      const rowMedio = (Array.isArray(mediosFilas) ? mediosFilas : []).find((r) => String(r.id) === uid);
      const file = getChequeFileFromRows(mediosFilas, uid);
      if (!idCheque || !file || !rowMedio?.cheque) return;

      await actualizarChequeConArchivo({
        idCheque,
        idMovimiento,
        cheque: rowMedio.cheque,
      });
    }));
  }, [mediosFilas, actualizarChequeConArchivo, getIdVentaFromResponse]);

  const guardarConversion = useCallback(async ({ modo, fiscal = null }) => {
    const fechaEnvio = String(fecha || "").slice(0, 10);
    const payload = {
      id_presupuesto: idPresupuesto,
      fecha: fechaEnvio,
      id_tipo_venta: Number(idTipoVenta || 0) || null,
      id_medio_pago: isContado ? (mediosPayload[0]?.id_medio_pago || null) : null,
      medios_pago: isContado ? mediosPayload : [],
      ...getAuditUserPayload(),
      id_usuario: getIdUsuarioLocal(),
      accion_venta: modo,
      es_facturada: modo === "facturar" ? 1 : 0,
      cliente_fiscal: fiscal || null,
    };

    return await apiPostJson(API_CONVERTIR, payload);
  }, [idPresupuesto, fecha, idTipoVenta, isContado, mediosPayload]);

  const afterSaved = useCallback(async (data, mensaje) => {
    showToast("exito", mensaje, 4600);
    await Promise.resolve(onSaved?.(data));
    onClose?.();
  }, [onSaved, onClose, showToast]);

  const guardarComoVenta = useCallback(async () => {
    const error = validate("guardar");
    if (error) return showToast("advertencia", error, 5200);

    setSaving(true);
    try {
      const [cfg] = await Promise.all([fetchConfigFacturacion()]);
      const fiscal = fiscalPdfParaInterno();
      const data = await guardarConversion({ modo: "guardar", fiscal });
      const idVenta = Number(data?.id_movimiento || data?.id_venta || data?.ids?.[0] || data?.ids_movimiento?.[0] || 0);
      if (!idVenta) throw new Error("La venta se creó, pero no se recibió su ID para vincular comprobantes.");

      const ventaMeta = buildComprobantePayload(cfg, fiscal, idVenta, {
        cbte_tipo: null,
        pto_vta: null,
        observaciones: "Comprobante interno generado desde un presupuesto. Sin CAE, sin QR fiscal y sin validez fiscal.",
      });

      const ventaPdf = await saveVentaNoFacturadaPdf({ data: ventaMeta, download: false });
      await subirPdfDocumento({
        tipo: "VENTA_NO_FACTURADA",
        idMovimiento: idVenta,
        blob: ventaPdf?.blob,
        filename: ventaPdf?.filename,
        meta: ventaMeta,
      });

      const remitoMeta = {
        ...ventaMeta,
        tipo: "REMITO",
        estado: "remito",
        observaciones_remito: "Remito generado automáticamente desde un presupuesto convertido en venta.",
      };
      const remitoPdf = await saveRemitoPdf({ data: remitoMeta, download: false });
      await subirPdfDocumento({
        tipo: "REMITO",
        idMovimiento: idVenta,
        blob: remitoPdf?.blob,
        filename: remitoPdf?.filename,
        meta: remitoMeta,
      });

      await subirArchivosChequesCreados(data);
      clearPresupuestoArcaKey(idPresupuesto);
      setArcaOperationKey("");
      await afterSaved(data, "Presupuesto guardado como venta. Se generaron la factura no emitida y el remito.");
    } catch (e) {
      showToast("error", e?.message || "No se pudo guardar como venta.", 6500);
    } finally {
      setSaving(false);
    }
  }, [validate, showToast, fetchConfigFacturacion, fiscalPdfParaInterno, guardarConversion, buildComprobantePayload, subirPdfDocumento, subirArchivosChequesCreados, afterSaved, idPresupuesto]);

  const abrirFacturacion = useCallback(async () => {
    if (isBaltoDemoMode()) {
      showToast("advertencia", DEMO_BLOCK_MESSAGE, 5200);
      return;
    }

    const error = validate("facturar");
    if (error) return showToast("advertencia", error, 5200);

    setMostrarCuitFiscal(true);

    try {
      const fiscalGuardado = clienteFiscalDb || (clienteBase.id_cliente ? await fetchClienteFiscal(clienteBase.id_cliente) : null);
      if (!(fiscalGuardado?.cuit || fiscalGuardado?.doc_nro) && onlyDigits(fiscalCuitInput).length !== 11) {
        showToast(
          "advertencia",
          "Este cliente no tiene datos fiscales guardados. Ingresá el CUIT y presioná Facturar en ARCA nuevamente.",
          5200
        );
        return;
      }
    } catch {
      // Si la consulta puntual falla, se deja visible el CUIT para que el usuario pueda completarlo manualmente.
      if (onlyDigits(fiscalCuitInput).length !== 11) {
        showToast(
          "advertencia",
          "No se encontraron datos fiscales guardados. Ingresá el CUIT y presioná Facturar en ARCA nuevamente.",
          5200
        );
        return;
      }
    }

    setSaving(true);
    try {
      const [cfg, fiscal] = await Promise.all([fetchConfigFacturacion(), resolveFiscalParaFacturar()]);
      const data = buildComprobantePayload(cfg, fiscal, null, {
        observaciones: "Factura emitida desde presupuesto convertido en venta.",
      });
      setFiscalParaFacturar(fiscal);
      setResumenFacturaData(data);
      setOpenResumenFactura(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo preparar la facturación.", 6200);
    } finally {
      setSaving(false);
    }
  }, [
    validate,
    showToast,
    clienteFiscalDb,
    clienteBase.id_cliente,
    fetchClienteFiscal,
    fiscalCuitInput,
    fetchConfigFacturacion,
    resolveFiscalParaFacturar,
    buildComprobantePayload,
  ]);

  const shouldNeedFiscalPanel = open && mostrarCuitFiscal && !clienteFiscalDb && clienteBase.id_cliente > 0;

  const finalizarFacturacionYGuardarVenta = useCallback(async (factEmitida) => {
    setSaving(true);
    try {
      const data = await guardarConversion({ modo: "facturar", fiscal: fiscalParaFacturar || resumenFacturaData?.cliente_facturacion || null });
      const idVenta = Number(data?.id_movimiento || data?.id_venta || data?.ids?.[0] || data?.ids_movimiento?.[0] || 0);
      if (!idVenta) throw new Error("La factura se emitió, pero no se recibió el ID de venta para guardar los documentos.");

      const facturaMeta = {
        ...(resumenFacturaData || {}),
        ids_movimiento: [idVenta],
        id_movimiento: idVenta,
        emitido_en_arca: 1,
        cae: factEmitida?.cae ?? null,
        cae_vto: factEmitida?.cae_vto ?? null,
        cbte_nro: factEmitida?.cbte_nro ?? factEmitida?.numero ?? null,
      };

      if (factEmitida?.pdf_blob) {
        await subirPdfDocumento({
          tipo: "FACTURA",
          idMovimiento: idVenta,
          blob: factEmitida.pdf_blob,
          filename: factEmitida.pdf_filename || "factura.pdf",
          meta: facturaMeta,
          emitidoEnArca: true,
          factura: factEmitida,
        });
      }

      const remitoMeta = {
        ...facturaMeta,
        tipo: "REMITO",
        estado: "remito",
        observaciones_remito: "Remito generado automáticamente desde una factura real emitida en ARCA.",
      };
      const remitoPdf = await saveRemitoPdf({ data: remitoMeta, download: false });
      await subirPdfDocumento({
        tipo: "REMITO",
        idMovimiento: idVenta,
        blob: remitoPdf?.blob,
        filename: remitoPdf?.filename,
        meta: remitoMeta,
      });

      await subirArchivosChequesCreados(data);
      clearPresupuestoArcaKey(idPresupuesto);
      setArcaOperationKey("");
      setOpenResumenFactura(false);
      await afterSaved(data, "Presupuesto facturado correctamente. Se guardaron la factura emitida y el remito.");
    } catch (e) {
      showToast("error", e?.message || "La factura se emitió, pero no se pudo terminar de guardar la venta.", 7000);
    } finally {
      setSaving(false);
    }
  }, [guardarConversion, fiscalParaFacturar, resumenFacturaData, subirPdfDocumento, subirArchivosChequesCreados, afterSaved, showToast, idPresupuesto]);

  if (!open) return null;

  const modal = (
    <>
      <div className="gm-modal-overlay dc-asignar-overlay" onMouseDown={(event) => event.stopPropagation()}>
        <div
          className="gm-modal-container gm-modal-container--movement gm-modal-v2 dc-asignar-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faFileInvoiceDollar} />
            </div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">Asignar como venta</h2>
            </div>
            <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">
              ✕
            </button>
          </div>

          {convertido ? (
            <div className="dc-asignar-convertido">
              <FontAwesomeIcon icon={faCheckCircle} />
              <div>
                <b>Este presupuesto ya fue convertido en venta.</b>
                <span>No se vuelve a crear otra venta para evitar duplicados.</span>
              </div>
            </div>
          ) : null}

          <div className="gm-modal-content dc-asignar-content">
            {loading ? (
              <div className="dc-asignar-loading">
                <FontAwesomeIcon icon={faSpinner} spin /> Cargando datos del presupuesto…
              </div>
            ) : (
              <div className="gm-movement-layout dc-asignar-grid">
                <section className="gm-table gm-table--movement gm-movement-main dc-asignar-products">
                  <div className="gm-table-head">
                    <div className="gm-table-th" style={{ paddingLeft: 10 }}>Detalle</div>
                    <div className="gm-table-th">Cant.</div>
                    <div className="gm-table-th right">Precio</div>
                    <div className="gm-table-th">IVA %</div>
                    <div className="gm-table-th right">IVA $</div>
                    <div className="gm-table-th right">Total</div>
                    <div className="gm-table-th" />
                  </div>

                  <div className="gm-table-body dc-asignar-products__rows">
                    {items.map((it) => {
                      const itemCantidad = safeNumber(it.cantidad);
                      const itemPrecio = safeNumber(it.precio);
                      const itemIvaPct = safeNumber(it.iva_pct);
                      const itemSubtotal = safeNumber(it.subtotal) || itemCantidad * itemPrecio;
                      const itemIvaMonto = safeNumber(it.iva_monto) || itemSubtotal * itemIvaPct / 100;
                      const itemTotal = safeNumber(it.total) || itemSubtotal + itemIvaMonto;

                      return (
                        <div key={it.id} className="gm-table-row dc-asignar-product-row">
                          <div className="gm-table-cell gm-table-cell--detail">
                            <div className="gm-cell-input dc-asignar-readonly-input dc-asignar-readonly-input--detalle">
                              <span>{safeText(it.descripcion)}</span>
                              {it.codigo ? <small>Código: {it.codigo}</small> : null}
                            </div>
                          </div>

                          <div className="gm-table-cell gm-table-cell--center stock_cant">
                            <input
                              className="gm-cell-input gm-cell-input--center dc-asignar-readonly-field-input"
                              type="text"
                              value={itemCantidad.toLocaleString("es-AR")}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>

                          <div className="gm-table-cell gm-table-cell--center">
                            <input
                              className="gm-cell-input gm-cell-input--right dc-asignar-readonly-field-input"
                              type="text"
                              value={moneyARS(itemPrecio)}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>

                          <div className="gm-table-cell gm-table-cell--center">
                            <input
                              className="gm-cell-input gm-cell-input--center dc-asignar-readonly-field-input"
                              type="text"
                              value={`${itemIvaPct.toLocaleString("es-AR")}%`}
                              readOnly
                              tabIndex={-1}
                            />
                          </div>

                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                            {moneyARS(itemIvaMonto)}
                          </div>
                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                            {moneyARS(itemTotal)}
                          </div>
                          <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                            <span className="dc-asignar-row-lock" aria-hidden="true" />
                          </div>
                        </div>
                      );
                    })}
                    {!items.length ? (
                      <div className="dc-asignar-empty">No hay productos cargados.</div>
                    ) : null}
                  </div>

                  <div className="gm-table-foot dc-asignar-products__foot">
                    <div className="gm-foot-actions">
                      <div className="dc-asignar-doc-chip">
                        <span>Documento</span>
                        <b>N° {idPresupuesto || "—"}</b>
                      </div>
                      <div className="gm-foot-sep" />
                    </div>
                    <div className="gm-summary-chips">
                      <div className="gm-summary-chip gm-summary-chip--sub">
                        <span>Subtotal</span>
                        <b>{moneyARS(subtotal)}</b>
                      </div>
                      <div className="gm-summary-chip gm-summary-chip--iva">
                        <span>IVA</span>
                        <b>{moneyARS(ivaTotal)}</b>
                      </div>
                      <div className="gm-summary-chip gm-summary-chip--total">
                        <span>Total</span>
                        <b>{moneyARS(total)}</b>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="gm-movement-side dc-asignar-side">
                  <aside className="gm-aside">
                    <div className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>Datos de venta</span>
                      </div>

                      <div className="gm-section-body">
                        <div
                          className="gm-field dc-asignar-date-field"
                          onClick={() => {
                            if (!saving) document.getElementById("dc-asignar-fecha")?.showPicker?.();
                          }}
                        >
                          <input
                            id="dc-asignar-fecha"
                            className="gm-input"
                            type="date"
                            placeholder=" "
                            value={fecha}
                            max={todayISO()}
                            onChange={(e) => setFecha(clampFechaHastaHoy(e.target.value))}
                            disabled={saving || convertido}
                          />
                          <label className="gm-label">Fecha</label>
                        </div>

                        <div className="gm-field dc-asignar-readonly-field">
                          <select
                            className="gm-input gm-select"
                            value="cliente-presupuesto"
                            disabled
                            title="El cliente viene del presupuesto seleccionado y no se puede cambiar."
                          >
                            <option value="cliente-presupuesto">
                              {safeText(clienteBase.nombre || clienteBase.razon_social)}
                            </option>
                          </select>
                          <label className="gm-label gm-label--up">Cliente *</label>
                        </div>

                        {convertido ? (
                          <div className="gm-field dc-asignar-readonly-field">
                            <input
                              className="gm-input"
                              type="text"
                              value={safeText(
                                tipoVentaSelected?.nombre ||
                                  tipoVentaSelected?.descripcion ||
                                  tipoVentaSelected?.detalle ||
                                  tipoVentaConvertidaNombre ||
                                  "Tipo de pago guardado"
                              )}
                              readOnly
                              disabled
                            />
                            <label className="gm-label gm-label--up">Tipo de pago *</label>
                          </div>
                        ) : (
                          <div className="gm-field">
                            <select
                              className="gm-input gm-select"
                              value={idTipoVenta}
                              onChange={(e) => setIdTipoVenta(e.target.value)}
                              disabled={saving}
                            >
                              <option value="">Seleccionar</option>
                              {tiposVentaList.map((t) => {
                                const id = getTipoVentaId(t);
                                return <option key={id || safeStr(t.nombre)} value={id || ""}>{safeText(t.nombre || t.descripcion || t.detalle)}</option>;
                              })}
                            </select>
                            <label className={`gm-label${idTipoVenta ? " gm-label--up" : ""}`}>Tipo de pago *</label>
                          </div>
                        )}



                        {isCuentaCorriente && !convertido ? (
                          <div className="dc-info">
                            Quedará registrada como <b>pendiente de cobro</b> en la cuenta corriente del cliente.
                          </div>
                        ) : null}

                        {convertido && mediosFilas.length ? (
                          <ReadOnlyMediosPagoVenta
                            mediosFilas={mediosFilas}
                            mediosPagoList={mediosPagoList}
                          />
                        ) : isContado ? (
                          <PanelMediosPagoInlineVenta
                            mediosFilas={mediosFilas}
                            mediosPagoList={mediosPagoList}
                            totalCompra={total}
                            onUpdate={updateMedioPago}
                            onRemove={removeMedioPago}
                            onAdd={addMedioPago}
                            showToast={showToast}
                            saving={saving}
                          />
                        ) : null}

                        {shouldNeedFiscalPanel ? (
                          <>
                            <div className="gm-section-divider" />

                            {fiscalLoading ? (
                              <div className="dc-cheques-loading">Consultando datos fiscales…</div>
                            ) : (
                              <div className="gm-field">
                                <input
                                  className="gm-input"
                                  value={fiscalCuitInput}
                                  maxLength={11}
                                  onChange={(e) => {
                                    setFiscalCuitInput(onlyDigits(e.target.value).slice(0, 11));
                                    setFiscalArcaData(null);
                                  }}
                                  placeholder=" "
                                  disabled={saving}
                                  inputMode="numeric"
                                />
                                <label className={`gm-label${fiscalCuitInput ? " gm-label--up" : ""}`}>CUIT *</label>
                              </div>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </aside>

                  <div className="gm-actions gm-actions--sticky dc-asignar-actions">
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--save"
                      onClick={guardarComoVenta}
                      disabled={saving || loading || convertido}
                    >
                      {saving ? "Guardando..." : "Guardar venta"}
                    </button>
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--invoice"
                      onClick={abrirFacturacion}
                      disabled={saving || loading || convertido}
                    >
                      {saving ? "Procesando..." : "Facturar"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ModalFacturaBaltoResumen
        open={openResumenFactura}
        onClose={() => setOpenResumenFactura(false)}
        onBack={() => setOpenResumenFactura(false)}
        onCloseAll={() => setOpenResumenFactura(false)}
        apiBase={API}
        action="ventas"
        data={resumenFacturaData}
        docTipo={Number(resumenFacturaData?.cliente_facturacion?.doc_tipo || 80)}
        docNro={String(resumenFacturaData?.cliente_facturacion?.doc_nro || resumenFacturaData?.cliente_facturacion?.cuit || "")}
        cbteTipo={Number(resumenFacturaData?.cbte_tipo || 11)}
        ptoVta={String(resumenFacturaData?.pto_vta || 2)}
        onDone={finalizarFacturacionYGuardarVenta}
        skipMovimientoAutocreacion
        closeOnBackdrop={false}
      />
    </>
  );

  return createPortal(modal, document.body);
}
