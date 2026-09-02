import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faFileInvoiceDollar, faEye, faTrash, faUpload, faMoneyCheckDollar, faCheck } from "@fortawesome/free-solid-svg-icons";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import ProductStockAutocomplete from "../../_shared/ProductStockAutocomplete.jsx";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import BASE_URL from "../../../../config/config";
import ModalNuevoCheque from "../../../Global/Modales/ModalNuevoCheque.jsx";
import ModalClienteFiscalArca from "../../../Global/Modales/ModalClienteFiscalArca.jsx";
import ModalNuevaDescripcion from "./ModalNuevaDescripcion.jsx";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalFacturaBaltoResumen from "../../Facturacion/ModalFacturaBaltoResumen.jsx";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalIngreso.css";
import { otrosIngresosFetch } from "../api/otrosIngresosApi.js";

// ─── Constantes ────────────────────────────────────────────────────────────────
const NULL_OPTION = "";
const NOMBRE_COMPROBANTE_GENERICO = "Comprobante adjunto";
const ADD_CLIENTE_OPTION = { __action: "add_cliente", id: "__add_cliente__", nombre: "➕ Agregar cliente" };
const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

// ─── Helpers generales ─────────────────────────────────────────────────────────
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeStr(v) {
  return String(v ?? "").trim();
}
function onlyDigits(v) {
  return String(v ?? "").replace(/\D/g, "");
}
function plusDaysISOFrom(base, days) {
  const raw = safeStr(base).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function uid() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function moneyARS(v) {
  try {
    return Number(v || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${Number(v || 0).toFixed(2)}`;
  }
}
function formatMoneyInputARS(v) {
  return moneyARS(v);
}
function parseMoneyInputARS(v) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/\$/g, "").replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function formatEditableMoney(v) {
  const n = safeNumber(v);
  return n === 0 ? "" : String(n).replace(".", ",");
}
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m)
    return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return s;
}
function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

function isAllowedComprobanteFile(file) {
  if (!file) return false;

  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  const isImageMime = mime.startsWith("image/");
  const isPdfMime = mime === "application/pdf";
  const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif|avif|tif|tiff)$/i.test(name);
  const isPdfExt = /\.pdf$/i.test(name);

  return isImageMime || isPdfMime || isImageExt || isPdfExt;
}

// ─── Helpers de listas ─────────────────────────────────────────────────────────
function getDetalleId(d) {
  const c =
    d?.id ?? d?.id_detalle ?? d?.idDetalle ?? d?.detalle_id ??
    d?.id_categoria_ingreso ?? d?.idCategoriaIngreso ?? d?.categoria_ingreso_id ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getClienteId(c) {
  const cand = c?.id ?? c?.id_cliente ?? c?.idCliente ?? c?.cliente_id ?? c?.idcliente ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function isAddClienteOption(option) {
  return option?.__action === "add_cliente";
}
function normalizeClienteSimple(data) {
  const s = data && typeof data === "object" ? data : {};
  const id = getClienteId(s) || null;
  return {
    id_cliente: id,
    id,
    nombre: safeStr(s.nombre || s.razon_social || s.label || ""),
    activo: Number(s.activo ?? 1) === 0 ? 0 : 1,
  };
}
function resolveClienteByInput(clientes, inputValue) {
  const q = normalizeText(inputValue);
  if (!q) return null;
  const matches = (Array.isArray(clientes) ? clientes : [])
    .map((cliente) => ({ cliente, id: getClienteId(cliente), nombre: normalizeText(cliente?.nombre) }))
    .filter((item) => item.id && item.nombre);
  const exact = matches.find((item) => item.nombre === q);
  if (exact) return exact.cliente;
  const starts = matches.filter((item) => item.nombre.startsWith(q));
  if (starts.length === 1) return starts[0].cliente;
  const contains = matches.filter((item) => item.nombre.includes(q));
  return contains.length === 1 ? contains[0].cliente : null;
}
function normalizeArcaSummary(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  return {
    cuit: safeStr(s.cuit),
    razon_social: safeStr(s.razon_social),
    condicion_iva: safeStr(s.iva || s.condicion_iva || s.cond_iva),
    domicilio: safeStr(s.domicilio),
    doc_tipo: 80,
    doc_nro: safeStr(s.cuit),
    origen: "arca_cuit",
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
    razon_social: safeStr(s.razon_social),
    condicion_iva: safeStr(s.condicion_iva || s.cond_iva),
    domicilio: safeStr(s.domicilio),
    origen: safeStr(s.origen || "manual"),
  };
}
function normalizeConfigFacturacionPdf(config) {
  const c = config && typeof config === "object" ? config : {};
  const razonSocial = safeStr(c.razon_social || c.nombre_fantasia || c.nombre || "BALTO");
  const domicilio = safeStr(c.domicilio_comercial || c.domicilio || c.domicilio_fiscal);
  const condicionIva = safeStr(c.condicion_iva || c.cond_iva);
  const inicioActividades = safeStr(c.fecha_inicio_actividades || c.inicio_actividades);
  return {
    emisor_nombre: razonSocial,
    emisor_domicilio: domicilio,
    cuit_emisor: safeStr(c.cuit),
    cond_iva_emisor: condicionIva,
    ingresos_brutos_emisor: safeStr(c.ingresos_brutos),
    fecha_inicio_actividades_emisor: inicioActividades,
    logo_url: safeStr(c.logo_url),
    emisor: {
      ...c,
      razon_social: razonSocial,
      domicilio_comercial: domicilio,
      domicilio,
      condicion_iva: condicionIva,
      cond_iva: condicionIva,
      fecha_inicio_actividades: inicioActividades,
      inicio_actividades: inicioActividades,
    },
  };
}
function configFacturacionKey(config) {
  const c = config && typeof config === "object" ? config : {};
  const id = Number(c.id_config_facturacion || c.idConfigFacturacion || 0) || 0;
  const cuit = onlyDigits(c.cuit || c.cuit_emisor);
  return id > 0 ? `id:${id}` : cuit ? `cuit:${cuit}` : JSON.stringify(c);
}
function extractConfigsFacturacionResponse(data) {
  for (const value of [
    data?.configs,
    data?.data?.configs,
    data?.cuentas_fiscales,
    data?.data?.cuentas_fiscales,
    data?.cuentas,
    data?.data?.cuentas,
    data?.configuraciones,
    data?.data?.configuraciones,
  ]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}
function mergeConfigsFacturacionList(...lists) {
  const out = [];
  const seen = new Set();
  lists.flat().forEach((config) => {
    if (!config || typeof config !== "object" || Number(config.activo ?? 1) === 0) return;
    const key = configFacturacionKey(config);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(config);
  });
  return out;
}
function getStockProductoId(d) {
  const c = d?.id_stock_producto ?? d?.idStockProducto ?? d?.stock_producto_id ?? d?.id_producto ?? d?.idProducto ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockVarianteId(d) {
  const c = d?.id_stock_variante ?? d?.idStockVariante ?? d?.stock_variante_id ?? d?.id_variante ?? d?.idVariante ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockDisponible(d) {
  const c = d?.stock ?? d?.stock_disponible ?? d?.stockDisponible ?? d?.cantidad_stock ?? null;
  if (c === null || c === undefined || c === "") return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}
function getProductoNombre(d) {
  return safeStr(d?.nombre ?? d?.producto_nombre ?? d?.stock_producto_nombre ?? d?.descripcion ?? d?.label ?? "");
}
function getPrecioVenta(d) {
  const precios = Array.isArray(d?.precios) ? d.precios : [];
  const venta = precios.find((p) => {
    const nombre = normalizeText(p?.tipo_precio ?? p?.nombre ?? "");
    return nombre === "precio de venta" || nombre === "precio venta" || nombre === "venta";
  }) || precios.find((p) => Number(p?.id_tipo_precio_stock || 0) === 2) || precios[0];
  const n = Number(venta?.monto ?? venta?.precio ?? d?.precio_venta ?? d?.precio ?? d?.precio_promocional ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function getMedioPagoId(c) {
  const cand = c?.id ?? c?.id_medio_pago ?? c?.idMedioPago ?? c?.medio_pago_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function optionLabel(x) {
  return safeStr(x?.nombre ?? x?.categoria ?? x?.descripcion ?? x?.detalle ?? "");
}
function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}
function getSavedMovimientoIdFromResponse(data, init = null) {
  for (const c of [
    data?.id_movimiento, data?.movimiento_id, data?.id,
    data?.ingreso?.id_movimiento, data?.ingreso?.id,
    data?.otro_ingreso?.id_movimiento, data?.otro_ingreso?.id,
    init?.id_movimiento, init?.id,
  ]) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function buildIngresoFacturaDraft(payload, operationKey, context = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const itemsFacturacion = items.map((item, index) => ({
    codigo: String(
      item?.id_stock_variante ||
        item?.id_stock_producto ||
        item?.id_detalle ||
        index + 1
    ),
    descripcion: safeStr(item?.descripcion ?? item?.detalle ?? item?.concepto),
    cantidad: safeNumber(item?.cantidad),
    precio: safeNumber(item?.precio),
    precio_unitario: safeNumber(item?.precio),
    iva_pct: safeNumber(item?.iva_pct),
    subtotal: safeNumber(item?.subtotal),
    iva_monto: safeNumber(item?.iva_monto),
    total: safeNumber(item?.total),
  }));
  const total = safeNumber(payload?.monto_total ?? payload?.total);
  const cliente = normalizeClienteSimple(context?.cliente || {});
  const clienteFiscal = normalizeClienteFiscalDb(context?.clienteFiscal || {});
  const configFacturacion = context?.configFacturacion || {};
  const emisorPdf = normalizeConfigFacturacionPdf(configFacturacion);
  const puntoVenta = Number(onlyDigits(configFacturacion?.punto_venta || "2")) || 2;
  const codigoComprobante = Number(onlyDigits(configFacturacion?.codigo_comprobante || "11")) || 11;

  return {
    id_movimiento: null,
    operacion_key: operationKey,
    operacion_contexto: "OTRO_INGRESO_FACTURA",
    operacion_id_origen: null,
    id_cliente: cliente.id_cliente || null,
    labelCliente: cliente.nombre || clienteFiscal.razon_social || "Cliente",
    labelSistema: "Nuevo otro ingreso",
    fecha_cbte_iso: safeStr(payload?.fecha).slice(0, 10) || todayISO(),
    vto_pago_iso: plusDaysISOFrom(payload?.fecha, 10),
    cbte_tipo: codigoComprobante,
    pto_vta: puntoVenta,
    cliente_facturacion: {
      ...clienteFiscal,
      cond_iva: clienteFiscal.condicion_iva,
    },
    config_facturacion: configFacturacion,
    ...emisorPdf,
    items_facturacion: itemsFacturacion,
    total_ars: total,
    monto: total,
    importe: total,
    observaciones: `Comprobante correspondiente a otro ingreso: ${safeStr(
      payload?.detalle ?? payload?.descripcion
    )}`,
    emisor: emisorPdf.emisor,
  };
}
function getAuthInfo() {
  const sessionKey =
    localStorage.getItem("session_key") || localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") || localStorage.getItem("X-Session") || "";
  const token = localStorage.getItem("token") || "";
  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const c = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(c))) idUsuario = Number(c);
  } catch {}
  return { sessionKey, token, idUsuario, idUsuarioMaster: idUsuario };
}

function nuevoIngresoArcaStorageKey() {
  const { idUsuario } = getAuthInfo();
  return `balto:arca:nuevo-otro-ingreso:${Number(idUsuario || 0)}`;
}

function makeNuevoIngresoArcaOperationKey() {
  const { idUsuario } = getAuthInfo();
  const randomPart =
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `factura-otro-ingreso-${Number(idUsuario || 0)}-${randomPart}`.slice(0, 100);
}

function getOrCreateNuevoIngresoArcaKey() {
  try {
    const storageKey = nuevoIngresoArcaStorageKey();
    const existing = safeStr(localStorage.getItem(storageKey));
    if (existing) return existing;
    const created = makeNuevoIngresoArcaOperationKey();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return makeNuevoIngresoArcaOperationKey();
  }
}

function clearNuevoIngresoArcaKey(expectedKey = "") {
  try {
    const storageKey = nuevoIngresoArcaStorageKey();
    const current = safeStr(localStorage.getItem(storageKey));
    const expected = safeStr(expectedKey);
    if (expected && current && current !== expected) return;
    localStorage.removeItem(storageKey);
  } catch {}
}
function buildAuthHeaders(isJson = true) {
  const { sessionKey, token } = getAuthInfo();
  const h = {};
  if (isJson) h["Content-Type"] = "application/json";
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta inválida del servidor.`);
  }
  if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  return data;
}
async function apiPostForm(url, fd) {
  return await parseJsonOrThrow(await otrosIngresosFetch(url, {
    method: "POST",
    headers: buildAuthHeaders(false),
    body: fd,
  }));
}
async function apiGetJson(url) {
  return await parseJsonOrThrow(await otrosIngresosFetch(url, {
    method: "GET",
    headers: buildAuthHeaders(false),
  }));
}
async function apiPostJson(url, payload) {
  return await parseJsonOrThrow(await otrosIngresosFetch(url, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload ?? {}),
  }));
}

// ─── Normalización de listas ───────────────────────────────────────────────────
function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src?.listas && typeof src.listas === "object" ? src.listas : src;
  const pick = (k) => (Array.isArray(l?.[k]) ? l[k] : []);
  const pickExplicitArray = (keys) => {
    for (const k of keys) {
      if (Array.isArray(l?.[k])) return l[k];
    }
    return [];
  };

  const medios_pago =
    pick("medios_pago").length ? pick("medios_pago") :
    pick("mediosPago").length ? pick("mediosPago") :
    pick("medios").length ? pick("medios") : [];

  // IMPORTANTE:
  // En las listas globales, `detalles` pertenece al stock (`stock_productos`).
  // Otros ingresos debe trabajar exclusivamente con la tabla `detalles`, que llega
  // por las claves específicas `detalles_ingresos` / variantes. Si esa tabla está
  // vacía, el autocompletado debe quedar vacío y permitir crear una descripción,
  // nunca caer a productos de stock.
  const detalles = pickExplicitArray([
    "detalles_ingresos",
    "detallesIngresos",
    "detalles_ingreso",
    "detallesIngreso",
  ]);

  const productos =
    pick("detalles").length ? pick("detalles") :
    pick("stock_productos").length ? pick("stock_productos") :
    pick("productos_stock").length ? pick("productos_stock") : [];

  return { clientes: pick("clientes"), medios_pago, detalles, productos };
}

// ─── Detección de cheque desde medio de pago ───────────────────────────────────
function detectChequeTipo(nombre) {
  const s = normalizeText(nombre);
  if (!s) return null;
  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) return "echeq";
  if (s.includes("cheque")) return "cheque";
  return null;
}

// ─── Builders de filas vacías ──────────────────────────────────────────────────
function buildEmptyRow(tipoItem = "servicio") {
  return {
    id: uid(),
    tipo_item: tipoItem,
    id_detalle: NULL_OPTION,
    id_stock_producto: NULL_OPTION,
    id_stock_variante: NULL_OPTION,
    detalle: "",
    cantidad: 1,
    precio: 0,
    precioDraft: "",
    precioFocused: false,
    ivaPct: 0,
    stock_disponible: null,
    sinStock: false,
  };
}

function buildRowsFromInitialData(data) {
  const src = data && typeof data === "object" ? data : {};
  const rawItems =
    (Array.isArray(src.items_detalle) && src.items_detalle.length && src.items_detalle) ||
    (Array.isArray(src.items) && src.items.length && src.items) ||
    (Array.isArray(src.detalles) && src.detalles.length && src.detalles) ||
    [];

  const source = rawItems.length ? rawItems : [src];
  const rows = source.map((it) => {
    const idStockProducto = getStockProductoId(it);
    const idStockVariante = getStockVarianteId(it);
    const esProducto = Boolean(idStockProducto || idStockVariante);
    const cantidad = Number(it?.cantidad ?? 1) || 1;
    const precio = Number(it?.precio ?? it?.importe ?? 0) || 0;
    const ivaPct = Number(it?.iva_pct ?? it?.ivaPct ?? 0) || 0;
    const producto = safeStr(it?.stock_producto_nombre ?? it?.producto_nombre ?? "");
    const variante = safeStr(it?.stock_variante_nombre ?? it?.variante_nombre ?? "");
    const descripcion = safeStr(
      it?.descripcion ?? it?.detalle ?? it?.concepto ?? it?.detalle_nombre ??
      [producto, variante].filter(Boolean).join(" - ")
    );
    return {
      ...buildEmptyRow(esProducto ? "producto" : "servicio"),
      id_detalle: Number(it?.id_detalle || 0) > 0 ? String(Number(it.id_detalle)) : NULL_OPTION,
      id_stock_producto: idStockProducto ? String(idStockProducto) : NULL_OPTION,
      id_stock_variante: idStockVariante ? String(idStockVariante) : NULL_OPTION,
      detalle: descripcion || [producto, variante].filter(Boolean).join(" - "),
      cantidad,
      precio,
      ivaPct,
      stock_disponible: getStockDisponible(it),
      sinStock: false,
    };
  }).filter((r) => safeStr(r.detalle) || Number(r.id_detalle) > 0 || Number(r.id_stock_producto) > 0 || r.precio > 0);

  return rows.length ? rows : [buildEmptyRow("servicio")];
}

function buildMediosFromInitialData(data) {
  const src = data && typeof data === "object" ? data : {};
  const medios = Array.isArray(src.medios_pago_detalle) ? src.medios_pago_detalle : [];
  if (!medios.length) {
    const idMedio = Number(src?.id_medio_pago || 0);
    if (!idMedio) return [buildEmptyMedioPago()];
    return [{ ...buildEmptyMedioPago(), id_medio_pago: String(idMedio), monto: Number(src?.monto_total ?? src?.total ?? 0) || 0 }];
  }
  return medios.map((mp) => ({
    ...buildEmptyMedioPago(),
    id_medio_pago: Number(mp?.id_medio_pago || 0) > 0 ? String(Number(mp.id_medio_pago)) : NULL_OPTION,
    monto: Number(mp?.monto ?? mp?.cheque_importe ?? 0) || 0,
    id_movimiento_medio_pago: Number(mp?.id_movimiento_medio_pago || 0) || null,
    id_cheque: Number(mp?.id_cheque || 0) || null,
    cheque: Number(mp?.id_cheque || 0) > 0 ? {
      id_cheque: Number(mp.id_cheque),
      tipo: safeStr(mp?.cheque_tipo || detectChequeTipo(mp?.medio_pago_nombre) || "cheque"),
      tipo_cheque: safeStr(mp?.cheque_tipo || detectChequeTipo(mp?.medio_pago_nombre) || "cheque"),
      emisor: safeStr(mp?.emisor),
      numero_cheque: safeStr(mp?.numero_cheque),
      fecha_emision: safeStr(mp?.fecha_emision),
      fecha_pago: safeStr(mp?.fecha_pago),
      importe: Number(mp?.cheque_importe ?? mp?.monto ?? 0) || 0,
    } : null,
  }));
}
function buildEmptyMedioPago() {
  return {
    id: uid(),
    id_medio_pago: NULL_OPTION,
    monto: 0,
    montoDraft: "",
    montoFocused: false,
    cheque: null,
    id_movimiento_medio_pago: null,
    id_cheque: null,
  };
}

// ─── Subcomponente: resumen visual de un cheque cargado ────────────────────────
function ChequeResumen({ cheque, tipoCheque }) {
  if (!cheque) return null;
  const esEcheq = tipoCheque === "echeq";
  return (
    <div className="gm-checks-list">
      <div className={`gm-check-item gm-check-item--selected${esEcheq ? " gm-check-item--echeck" : ""}`}>
        <div className="gm-check-main">
          <div className="gm-check-top">
            <span className="gm-check-number">N° {safeText(cheque?.numero_cheque)}</span>
            {esEcheq && <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>}
          </div>
          <div className="gm-check-meta">
            <span className="gm-check-issuer" title={safeText(cheque?.emisor)}>
              {safeText(cheque?.emisor)}
            </span>
            <span className="gm-check-separator">·</span>
            <span>Pago: {formatFechaDMY(cheque?.fecha_pago)}</span>
          </div>
        </div>
        <span className="gm-check-amount">{moneyARS(cheque?.importe || 0)}</span>
        <div
          aria-hidden="true"
          className={`gm-check-icon gm-check-icon--corner${
            esEcheq ? " gm-check-icon--echeck" : " gm-check-icon--check"
          }`}
        >
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponente: fila de medio de pago ──────────────────────────────────────
function MedioPagoRow({
  row,
  mediosPagoList,
  totalIngreso,
  sumaMediosPago,
  onUpdate,
  onRemove,
  saving,
  showToast,
  apiCheckNumero,
  mediosFilas = [],
}) {
  const [openChequeModal, setOpenChequeModal] = useState(false);

  const mpSeleccionado = useMemo(
    () =>
      mediosPagoList.find(
        (x) => String(getMedioPagoId(x) ?? "") === String(row.id_medio_pago ?? "")
      ) || null,
    [mediosPagoList, row.id_medio_pago]
  );

  const tipoCheque = useMemo(
    () => detectChequeTipo(mpSeleccionado?.nombre || ""),
    [mpSeleccionado]
  );
  const esCheque = tipoCheque !== null;

  const montoActual = esCheque && row.cheque
    ? safeNumber(row.cheque?.importe)
    : safeNumber(row.monto);

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - montoActual);
    return Math.max(0, safeNumber(totalIngreso) - sumaOtros);
  }, [sumaMediosPago, totalIngreso, montoActual]);

  const puedeCompletarRestante = !saving && !esCheque && totalIngreso > 0 && restanteParaEstaFila > 0.009;

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(val));
      const tipo = detectChequeTipo(mp?.nombre || "");
      onUpdate(row.id, {
        id_medio_pago: val,
        monto: tipo === null ? safeNumber(row.monto) : safeNumber(row.cheque?.importe),
        montoDraft: "",
        montoFocused: false,
        cheque: tipo === null ? null : row.cheque,
      });
    },
    [mediosPagoList, onUpdate, row.id, row.monto, row.cheque]
  );

  const handleSaveCheque = useCallback(
    (datosCheque) => {
      const cheque = {
        ...datosCheque,
        tipo: tipoCheque || "cheque",
        archivo_nombre:
          datosCheque?.archivo_nombre ||
          (datosCheque?.archivo instanceof File ? datosCheque.archivo.name : ""),
      };
      onUpdate(row.id, {
        cheque,
        monto: safeNumber(cheque.importe),
        montoDraft: "",
        montoFocused: false,
      });
      setOpenChequeModal(false);
      showToast?.(
        "exito",
        `${tipoCheque === "echeq" ? "eCheq" : "Cheque"} ${cheque.numero_cheque || ""} cargado.`);
    },
    [onUpdate, row.id, showToast, tipoCheque]
  );

  const verificarNumeroCheque = useCallback(
    async ({ numero_cheque, tipoCheque: tc, initialData }) => {
      const numeroCheque = String(numero_cheque ?? "").replace(/\D/g, "");
      if (!numeroCheque) {
        return {
          ok: false,
          tipo: "advertencia",
          mensaje: "Ingresá el número de cheque antes de confirmar.",
        };
      }
      const duplicadoEnFormulario = Array.isArray(mediosFilas) && mediosFilas.some((mp) => {
        if (!mp || String(mp.id) === String(row.id)) return false;
        const numero = String(mp?.cheque?.numero_cheque ?? "").replace(/\D/g, "");
        return numero && numero === numeroCheque;
      });

      if (duplicadoEnFormulario) {
        return {
          ok: false,
          tipo: "error",
          mensaje: `Ya cargaste otro cheque/eCheq con el número ${numeroCheque} en este ingreso.`,
        };
      }

      const params = new URLSearchParams();
      params.set("numero_cheque", numeroCheque);
      params.set("tipo", String(tc || "cheque"));
      const idChequeActual = Number(initialData?.id_cheque || row?.cheque?.id_cheque || 0);
      if (Number.isFinite(idChequeActual) && idChequeActual > 0) {
        params.set("id_cheque", String(idChequeActual));
      }
      const res = await otrosIngresosFetch(`${apiCheckNumero}&${params.toString()}`, {
        method: "GET",
        headers: buildAuthHeaders(false),
      });
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo verificar el número del cheque.");
      if (data?.existe || data?.disponible === false) {
        return {
          ok: false,
          tipo: "error",
          mensaje: data?.mensaje || "Ese número de cheque ya existe.",
        };
      }
      return { ok: true };
    },
    [apiCheckNumero, mediosFilas, row.id, row?.cheque?.id_cheque]
  );

  return (
    <div className="gm-payment-card">
      {/* Selector de medio */}
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select
            className="gm-input gm-select"
            value={String(row.id_medio_pago || "")}
            onChange={(e) => handleChangeMedio(e.target.value)}
            disabled={saving}
          >
            <option value={NULL_OPTION}>Seleccionar…</option>
            {mediosPagoList.map((x) => {
              const idMp = getMedioPagoId(x);
              return (
                <option key={idMp ?? x?.nombre ?? uid()} value={idMp != null ? String(idMp) : ""}>
                  {String(x?.nombre ?? "").trim() || "Medio"}
                </option>
              );
            })}
          </select>
          <label className={`gm-label${row.id_medio_pago && row.id_medio_pago !== "" ? " gm-label--up" : ""}`}>
            Medio de pago
          </label>
        </div>
      </div>

      {/* Monto */}
      <div className="gm-payment-row gm-payment-row--amount">
        <div className="gm-field gm-payment-amount-field" style={{ position: "relative" }}>
          <input
            className="gm-input gm-payment-amount-input"
            type="text"
            inputMode="decimal"
            value={row.montoFocused ? row.montoDraft ?? "" : formatMoneyInputARS(montoActual)}
            onFocus={(e) => {
              if (saving || (esCheque && !!row.cheque)) return;
              onUpdate(row.id, {
                montoFocused: true,
                montoDraft: formatEditableMoney(montoActual),
              });
              setTimeout(() => e.target.select(), 0);
            }}
            onChange={(e) => {
              if (saving || (esCheque && !!row.cheque)) return;
              const c = e.target.value.replace(/[^\d,.\-]/g, "");
              onUpdate(row.id, { montoDraft: c, monto: parseMoneyInputARS(c) });
            }}
            onBlur={() => {
              if (saving || (esCheque && !!row.cheque)) return;
              const p = parseMoneyInputARS(row.montoDraft);
              onUpdate(row.id, { monto: p, montoDraft: "", montoFocused: false });
            }}
            onKeyDown={(e) => {
              if (saving || (esCheque && !!row.cheque)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="$ 0,00"
            disabled={saving || (esCheque && !!row.cheque)}
            style={{ height: 32, padding: "0 10px", fontSize: 13, textAlign: "right" }}
          />
          <label className="gm-label gm-label--up">Monto</label>
        </div>

        <div className="gm-payment-actions-col">
          {!esCheque && (
            <button
              type="button"
              className="gm-payment-complete"
              onClick={() =>
                onUpdate(row.id, { monto: restanteParaEstaFila, montoDraft: "", montoFocused: false })
              }
              disabled={!puedeCompletarRestante}
              title="Completar importe restante"
            >
              ↓ Rest.
            </button>
          )}
          <button
            type="button"
            className="gm-payment-delete"
            onClick={() => onRemove(row.id)}
            disabled={saving}
            title="Quitar"
          >
            ×
          </button>
        </div>
      </div>

      {/* Cheque */}
      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 12 }} />
            {tipoCheque === "echeq" ? "eCheq cargado" : "Cheque cargado"}
          </div>

          {row.cheque ? (
            <>
              <ChequeResumen cheque={row.cheque} tipoCheque={tipoCheque} />
              <button
                type="button"
                className="gm-payment-btn"
                onClick={() => setOpenChequeModal(true)}
                disabled={saving}
              >
                Editar {tipoCheque === "echeq" ? "eCheq" : "cheque"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="gm-payment-btn"
              onClick={() => setOpenChequeModal(true)}
              disabled={saving}
            >
              Cargar {tipoCheque === "echeq" ? "eCheq" : "cheque"}
            </button>
          )}
        </div>
      )}

      {openChequeModal && (
        <ModalNuevoCheque
          open={openChequeModal}
          onClose={() => setOpenChequeModal(false)}
          onSave={handleSaveCheque}
          initialData={
            row.cheque
              ? {
                  fecha_emision: row.cheque.fecha_emision,
                  emisor: row.cheque.emisor,
                  numero_cheque: row.cheque.numero_cheque,
                  importe: row.cheque.importe,
                  fecha_pago: row.cheque.fecha_pago,
                  observaciones: row.cheque.observaciones,
                  archivo: row.cheque.archivo,
                  archivo_nombre: row.cheque.archivo_nombre,
                }
              : undefined
          }
          tipoCheque={tipoCheque || "cheque"}
          saving={false}
          verificarNumeroCheque={verificarNumeroCheque}
        />
      )}
    </div>
  );
}

// ─── Panel inline de medios de pago ───────────────────────────────────────────
function PanelMediosPago({
  mediosFilas,
  mediosPagoList,
  totalIngreso,
  onUpdate,
  onRemove,
  onAdd,
  saving,
  showToast,
  apiCheckNumero,
}) {
  const filas =
    Array.isArray(mediosFilas) && mediosFilas.length ? mediosFilas : [buildEmptyMedioPago()];

  const sumaMediosPago = useMemo(
    () =>
      filas.reduce((a, r) => {
        const mpObj = mediosPagoList.find(
          (x) => String(getMedioPagoId(x) ?? "") === String(r.id_medio_pago ?? "")
        );
        const tipoCheque = detectChequeTipo(String(mpObj?.nombre ?? "").trim());
        const monto =
          tipoCheque !== null && r.cheque ? safeNumber(r.cheque.importe) : safeNumber(r.monto);
        return a + monto;
      }, 0),
    [filas, mediosPagoList]
  );

  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(totalIngreso) - sumaMediosPago),
    [totalIngreso, sumaMediosPago]
  );

  return (
    <>
      {filas.map((mp) => (
        <MedioPagoRow
          key={mp.id}
          row={mp}
          mediosPagoList={mediosPagoList}
          totalIngreso={totalIngreso}
          sumaMediosPago={sumaMediosPago}
          onUpdate={onUpdate}
          onRemove={onRemove}
          saving={saving}
          showToast={showToast}
          apiCheckNumero={apiCheckNumero}
          mediosFilas={filas}
        />
      ))}

      <div className="gm-payment-totals">
        <span className="gm-payment-totals-assigned">
          Asignado: <b>{moneyARS(sumaMediosPago)}</b>
        </span>
        {diferenciaRestante > 0.01 && (
          <span className="gm-payment-totals-missing">Pendiente: {moneyARS(diferenciaRestante)}</span>
        )}
        {diferenciaRestante <= 0.01 && sumaMediosPago > 0 && (
          <span className="gm-payment-totals-ok">✓ Cobro completo</span>
        )}
      </div>

      <button
        type="button"
        className="gm-payment-btn"
        onClick={onAdd}
        disabled={saving}
      >
        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> Agregar otro medio
      </button>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function ModalNuevoIngreso({
  open,
  mode = "create",
  initialData = null,
  lists,
  onClose,
  onToast,
  onSubmit,
  onSaved,
}) {
  const API_UPLOAD = `${BASE_URL}/api.php?action=otros_ingresos_comprobantes_vincular_movimiento_upload`;
  const API_VINCULAR_FACTURA = `${BASE_URL}/api.php?action=otros_ingresos_comprobantes_vincular_movimiento`;
  const API_CHEQUES_ACTUALIZAR = `${BASE_URL}/api.php?action=mov_global_cheques_actualizar`;
  const API_DETALLES_CREAR = `${BASE_URL}/api.php?action=otros_ingresos_detalles_crear`;
  const API_CHECK_NUMERO = `${BASE_URL}/api.php?action=mov_global_cheques_obtener&modo=verificar_numero`;
  const API_GET_CLIENTE_FISCAL = `${BASE_URL}/api.php?action=cliente_fiscal_get`;
  const API_SAVE_CLIENTE_DESDE_ARCA = `${BASE_URL}/api.php?action=cliente_fiscal_crear_desde_arca`;
  const API_PADRON_CUIT = `${BASE_URL}/api.php?action=padron_cuit&op=padron_cuit`;
  const API_CONFIG_FACTURACION = `${BASE_URL}/api.php?action=config_facturacion_get`;

  const showToast = useCallback(
    (tipo, mensaje) => onToast?.(tipo, mensaje),
    [onToast]
  );

  const [dark, setDark] = useState(isTemaOscuro);
  const [saving, setSaving] = useState(false);
  const [savingAction, setSavingAction] = useState(null);
  const [fecha, setFecha] = useState(todayISO);
  const [rows, setRows] = useState(() => [buildEmptyRow()]);
  const [mediosFilas, setMediosFilas] = useState(() => [buildEmptyMedioPago()]);
  const [archivoAdjunto, setArchivoAdjunto] = useState(null);
  const [openViewer, setOpenViewer] = useState(false);
  const [viewerData, setViewerData] = useState({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });
  const [openNuevaDescripcionModal, setOpenNuevaDescripcionModal] = useState(false);
  const [currentRowIdForNewDesc, setCurrentRowIdForNewDesc] = useState(null);
  const [openFactura, setOpenFactura] = useState(false);
  const [facturaDraft, setFacturaDraft] = useState(null);
  const [cliInput, setCliInput] = useState("");
  const [selectedClienteId, setSelectedClienteId] = useState(null);
  const [clienteFiscalDb, setClienteFiscalDb] = useState(null);
  const [fiscalPanelOpen, setFiscalPanelOpen] = useState(false);
  const [fiscalCuitInput, setFiscalCuitInput] = useState("");
  const [fiscalArcaData, setFiscalArcaData] = useState(null);
  const [fiscalError, setFiscalError] = useState("");
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [fiscalLookupLoading, setFiscalLookupLoading] = useState(false);
  const [addClienteOpen, setAddClienteOpen] = useState(false);
  const [addClienteCuit, setAddClienteCuit] = useState("");
  const [addClienteFiscalData, setAddClienteFiscalData] = useState(null);
  const [addClienteError, setAddClienteError] = useState("");
  const [addClienteLoading, setAddClienteLoading] = useState(false);
  const [configFacturacion, setConfigFacturacion] = useState(null);
  const [configsFacturacion, setConfigsFacturacion] = useState([]);

  const rowsContainerRef = useRef(null);
  const [hasScroll, setHasScroll] = useState(false);
  const closeBtnRef = useRef(null);
  const prevOpenRef = useRef(false);
  const inputFileRef = useRef(null);
  const fechaRef = useRef(null);
  const facturaOperationKeyRef = useRef("");
  const facturaPendingSaveRef = useRef(null);

  const [localLists, setLocalLists] = useState(() => normalizeLists(lists));
  useEffect(() => setLocalLists(normalizeLists(lists)), [lists]);
  const mediosPagoList = useMemo(
    () => filtrarMediosPagoPorPlan(Array.isArray(localLists.medios_pago) ? localLists.medios_pago : []),
    [localLists.medios_pago]
  );
  const detallesList = useMemo(
    () => (Array.isArray(localLists.detalles) ? localLists.detalles : []),
    [localLists.detalles]
  );
  const productosList = useMemo(
    () => (Array.isArray(localLists.productos) ? localLists.productos : []),
    [localLists.productos]
  );
  const clientesList = useMemo(
    () => (Array.isArray(localLists.clientes) ? localLists.clientes : []),
    [localLists.clientes]
  );
  const clientesOptions = useMemo(() => [ADD_CLIENTE_OPTION, ...clientesList], [clientesList]);
  const selectedCliente = useMemo(
    () =>
      clientesList.find((cliente) => Number(getClienteId(cliente)) === Number(selectedClienteId)) ||
      resolveClienteByInput(clientesList, cliInput),
    [clientesList, selectedClienteId, cliInput]
  );
  const selectedClienteNombre = useMemo(
    () => safeStr(selectedCliente?.nombre || cliInput),
    [selectedCliente, cliInput]
  );
  useEffect(() => {
    if (Number(selectedClienteId) > 0) return;
    const resolvedId = getClienteId(selectedCliente);
    if (resolvedId) setSelectedClienteId(resolvedId);
  }, [selectedClienteId, selectedCliente]);
  const enhancedDetallesList = useMemo(
    () => [
      { id: "new_option", __isNewOption: true, nombre: "+ Agregar nueva descripción" },
      ...detallesList,
    ],
    [detallesList]
  );

  // Tema oscuro
  useEffect(() => {
    const update = () => setDark(isTemaOscuro());
    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const o2 = new MutationObserver(update);
    if (document.body) o2.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => { o1.disconnect(); o2.disconnect(); };
  }, []);

  // Bloqueo de scroll del body
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key !== "Escape" || saving) return;

      // Si está abierto ModalNuevoCheque, este modal padre NO debe cerrarse.
      // El Escape lo maneja únicamente el modal superior.
      if (document.body.classList.contains("modal-nuevo-cheque-open")) {
        return;
      }

      if (openViewer || openNuevaDescripcionModal || openFactura || fiscalPanelOpen || addClienteOpen) return;

      e.preventDefault();
      e.stopPropagation();


      onClose?.();
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [open, onClose, saving, openViewer, openNuevaDescripcionModal, openFactura, fiscalPanelOpen, addClienteOpen]);

  // Reset al abrir
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;
    if (!wasOpen && open) {
      setFecha(safeStr(initialData?.fecha).slice(0, 10) || todayISO());
      const initialRows = mode === "edit" ? buildRowsFromInitialData(initialData) : [buildEmptyRow()];
      setRows(initialRows);
      setMediosFilas(mode === "edit" ? buildMediosFromInitialData(initialData) : [buildEmptyMedioPago()]);
      setArchivoAdjunto(null);
      setOpenViewer(false);
      setViewerData({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });
      setSaving(false);
      setSavingAction(null);
      setOpenFactura(false);
      setFacturaDraft(null);
      const initialClienteId = Number(initialData?.id_cliente || 0) || null;
      const initialCliente = normalizeClienteSimple({
        id_cliente: initialClienteId,
        nombre: initialData?.cliente || initialData?.cliente_nombre || "",
      });
      setSelectedClienteId(initialCliente.id_cliente);
      setCliInput(initialCliente.nombre);
      setClienteFiscalDb(null);
      setFiscalPanelOpen(false);
      setFiscalCuitInput("");
      setFiscalArcaData(null);
      setFiscalError("");
      setFiscalLoading(false);
      setFiscalLookupLoading(false);
      setAddClienteOpen(false);
      setAddClienteCuit("");
      setAddClienteFiscalData(null);
      setAddClienteError("");
      setAddClienteLoading(false);
      setConfigFacturacion(null);
      setConfigsFacturacion([]);
      facturaPendingSaveRef.current = null;
      facturaOperationKeyRef.current = getOrCreateNuevoIngresoArcaKey();
      setTimeout(() => closeBtnRef.current?.focus(), 0);
    }
  }, [open, initialData, mode]);

  // Scroll detection
  useEffect(() => {
    const el = rowsContainerRef.current;
    if (!el) return;
    const check = () => setHasScroll(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => { ro.disconnect(); window.removeEventListener("resize", check); };
  }, [open, rows]);

  // ─── Cliente y datos fiscales (mismo circuito de Nueva Venta) ───────────────
  const registrarClienteLocal = useCallback((clienteRaw, fiscalRaw = null) => {
    const cliente = normalizeClienteSimple(clienteRaw);
    if (!cliente.id_cliente) return cliente;

    setLocalLists((prev) => {
      const clientes = Array.isArray(prev.clientes) ? [...prev.clientes] : [];
      const index = clientes.findIndex((item) => Number(getClienteId(item)) === Number(cliente.id_cliente));
      const next = { id: cliente.id_cliente, id_cliente: cliente.id_cliente, nombre: cliente.nombre, activo: cliente.activo };
      if (index >= 0) clientes[index] = { ...clientes[index], ...next };
      else clientes.push(next);
      return { ...prev, clientes };
    });

    setSelectedClienteId(cliente.id_cliente);
    setCliInput(cliente.nombre);
    if (fiscalRaw) {
      const fiscal = normalizeClienteFiscalDb(fiscalRaw);
      setClienteFiscalDb(fiscal);
      setFiscalArcaData(fiscal);
      setFiscalCuitInput(fiscal.cuit || fiscal.doc_nro);
    }
    return cliente;
  }, []);

  const handleClienteInputChange = useCallback((value) => {
    setCliInput(value);
    setSelectedClienteId(null);
    setClienteFiscalDb(null);
    setFiscalArcaData(null);
    setFiscalCuitInput("");
    setFiscalError("");
  }, []);

  const handleSelectCliente = useCallback((cliente) => {
    if (isAddClienteOption(cliente)) {
      setAddClienteOpen(true);
      setAddClienteCuit("");
      setAddClienteFiscalData(null);
      setAddClienteError("");
      return;
    }
    const normalizado = normalizeClienteSimple(cliente);
    setSelectedClienteId(normalizado.id_cliente);
    setCliInput(normalizado.nombre);
    setClienteFiscalDb(null);
    setFiscalArcaData(null);
    setFiscalCuitInput("");
    setFiscalError("");
  }, []);

  const consultarCuitArca = useCallback(async (cuitRaw) => {
    const cuit = onlyDigits(cuitRaw);
    if (cuit.length !== 11) throw new Error("Ingresá un CUIT válido de 11 dígitos.");
    const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${cuit}`);
    const summary = data?.data?.summary ?? data?.summary ?? null;
    if (!summary) throw new Error("ARCA no devolvió datos para ese CUIT.");
    const fiscal = normalizeArcaSummary(summary);
    if (!fiscal.cuit || !fiscal.razon_social) throw new Error("ARCA devolvió datos incompletos.");
    return fiscal;
  }, [API_PADRON_CUIT]);

  const fetchClienteFiscal = useCallback(async (idCliente) => {
    const id = Number(idCliente);
    if (!(id > 0)) return null;
    setFiscalLoading(true);
    setFiscalError("");
    try {
      const data = await apiGetJson(`${API_GET_CLIENTE_FISCAL}&id_cliente=${id}`);
      if (data?.existe && data?.cliente_fiscal) {
        const fiscal = normalizeClienteFiscalDb(data.cliente_fiscal);
        setClienteFiscalDb(fiscal);
        setFiscalCuitInput(fiscal.cuit || fiscal.doc_nro);
        return fiscal;
      }
      setClienteFiscalDb(null);
      return null;
    } catch (error) {
      setFiscalError(error?.message || "No se pudieron consultar los datos fiscales del cliente.");
      return null;
    } finally {
      setFiscalLoading(false);
    }
  }, [API_GET_CLIENTE_FISCAL]);

  const fetchConfigFacturacion = useCallback(async () => {
    const data = await apiGetJson(API_CONFIG_FACTURACION);
    const configDefault = data?.config || data?.data?.config || data?.data || data || null;
    const cuentas = mergeConfigsFacturacionList(
      extractConfigsFacturacionResponse(data),
      configDefault ? [configDefault] : [],
      configFacturacion ? [configFacturacion] : []
    );
    const config = configDefault || cuentas[0] || null;
    if (!config) throw new Error("No se pudo obtener la configuración de facturación.");
    const configCompleta = { ...config, _configs_facturacion: cuentas.length ? cuentas : [config] };
    setConfigFacturacion(configCompleta);
    setConfigsFacturacion(cuentas.length ? cuentas : [config]);
    return configCompleta;
  }, [API_CONFIG_FACTURACION, configFacturacion]);

  const guardarClienteFiscalDesdeArca = useCallback(async (fiscalSource, idCliente = null) => {
    const fiscal = normalizeClienteFiscalDb(fiscalSource || {});
    if (!fiscal.cuit || !fiscal.razon_social) throw new Error("Primero consultá un CUIT válido en ARCA.");
    const { idUsuario } = getAuthInfo();
    const saved = await apiPostJson(API_SAVE_CLIENTE_DESDE_ARCA, {
      idUsuario,
      id_cliente: Number(idCliente || 0) || null,
      doc_tipo: Number(fiscal.doc_tipo || 80),
      doc_nro: fiscal.doc_nro || fiscal.cuit,
      cuit: fiscal.cuit,
      razon_social: fiscal.razon_social,
      condicion_iva: fiscal.condicion_iva,
      domicilio: fiscal.domicilio,
      origen: fiscal.origen || "arca_cuit",
      actualizar_nombre_cliente: 1,
      activo: 1,
    });
    if (!saved?.exito || !saved?.cliente || !saved?.cliente_fiscal) {
      throw new Error(saved?.mensaje || "No se pudo guardar el cliente fiscal.");
    }
    const fiscalGuardado = normalizeClienteFiscalDb(saved.cliente_fiscal);
    const clienteGuardado = registrarClienteLocal(saved.cliente, fiscalGuardado);
    return { cliente: clienteGuardado, cliente_fiscal: fiscalGuardado, ya_existia: !!saved?.ya_existia };
  }, [API_SAVE_CLIENTE_DESDE_ARCA, registrarClienteLocal]);

  const consultarFiscalPanel = useCallback(async () => {
    setFiscalLookupLoading(true);
    setFiscalError("");
    setFiscalArcaData(null);
    try {
      const fiscal = await consultarCuitArca(fiscalCuitInput);
      setFiscalArcaData(fiscal);
      return fiscal;
    } catch (error) {
      setFiscalError(error?.message || "No se pudo consultar ARCA.");
      return null;
    } finally {
      setFiscalLookupLoading(false);
    }
  }, [consultarCuitArca, fiscalCuitInput]);

  const consultarNuevoCliente = useCallback(async () => {
    setAddClienteLoading(true);
    setAddClienteError("");
    setAddClienteFiscalData(null);
    try {
      const fiscal = await consultarCuitArca(addClienteCuit);
      setAddClienteFiscalData(fiscal);
      return fiscal;
    } catch (error) {
      setAddClienteError(error?.message || "No se pudo consultar ARCA.");
      return null;
    } finally {
      setAddClienteLoading(false);
    }
  }, [consultarCuitArca, addClienteCuit]);

  const confirmarNuevoCliente = useCallback(async () => {
    setAddClienteLoading(true);
    setAddClienteError("");
    try {
      let fiscal = addClienteFiscalData;
      if (!fiscal || onlyDigits(fiscal.cuit) !== onlyDigits(addClienteCuit)) {
        fiscal = await consultarCuitArca(addClienteCuit);
      }
      const result = await guardarClienteFiscalDesdeArca(fiscal, null);
      setAddClienteOpen(false);
      setAddClienteCuit("");
      setAddClienteFiscalData(null);
      showToast("exito", result.ya_existia ? "El cliente ya existía y quedó seleccionado." : "Cliente fiscal creado y seleccionado.");
    } catch (error) {
      setAddClienteError(error?.message || "No se pudo crear el cliente.");
    } finally {
      setAddClienteLoading(false);
    }
  }, [addClienteFiscalData, addClienteCuit, consultarCuitArca, guardarClienteFiscalDesdeArca, showToast]);

  // ─── Handlers de filas de ítems ──────────────────────────────────────────────
  const updateRow = useCallback(
    (id, patch) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    []
  );
  const addRow = useCallback(
    (tipoItem = "servicio") =>
      setRows((p) => [...p, buildEmptyRow(tipoItem === "producto" ? "producto" : "servicio")]),
    []
  );
  const removeRow = useCallback(
    (id) =>
      setRows((p) => {
        const n = p.filter((r) => r.id !== id);
        return n.length ? n : [buildEmptyRow("servicio")];
      }),
    []
  );

  const handleTipoItemChange = useCallback(
    (id, tipoItem) => {
      const tipo = tipoItem === "producto" ? "producto" : "servicio";
      updateRow(id, {
        tipo_item: tipo,
        id_detalle: NULL_OPTION,
        id_stock_producto: NULL_OPTION,
        id_stock_variante: NULL_OPTION,
        detalle: "",
        cantidad: 1,
        precio: 0,
        precioDraft: "",
        precioFocused: false,
        stock_disponible: null,
        sinStock: false,
      });
    },
    [updateRow]
  );

  // ─── Handlers de medios de pago ──────────────────────────────────────────────
  const updateMedioPago = useCallback(
    (id, patch) => setMediosFilas((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    []
  );
  const addMedioPago = useCallback(() => setMediosFilas((p) => [...p, buildEmptyMedioPago()]), []);
  const removeMedioPago = useCallback(
    (id) =>
      setMediosFilas((p) => {
        const next = p.filter((x) => x.id !== id);
        return next.length ? next : [buildEmptyMedioPago()];
      }),
    []
  );

  // ─── Descripción nueva ───────────────────────────────────────────────────────
  const handleCrearNuevaDescripcion = useCallback((rowId) => {
    setCurrentRowIdForNewDesc(rowId);
    setOpenNuevaDescripcionModal(true);
  }, []);

  const handleGuardarNuevaDescripcion = useCallback(
    async (nombreDescripcion) => {
      try {
        const { sessionKey, token, idUsuario, idUsuarioMaster } = getAuthInfo();
        const headers = { "Content-Type": "application/json" };
        if (sessionKey) headers["X-Session"] = sessionKey;
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await otrosIngresosFetch(API_DETALLES_CREAR, {
          method: "POST",
          headers,
          body: JSON.stringify({ nombre: nombreDescripcion, idUsuario, idUsuarioMaster }),
        });
        const data = await parseJsonOrThrow(response);
        const detalleCreado = data?.detalle || data?.item;
        if (data.exito && detalleCreado) {
          const precio = safeNumber(detalleCreado?.precio || 0);
          updateRow(currentRowIdForNewDesc, {
            tipo_item: "servicio",
            id_detalle: String(detalleCreado.id_detalle || detalleCreado.id || ""),
            id_stock_producto: NULL_OPTION,
            id_stock_variante: NULL_OPTION,
            detalle: detalleCreado.nombre || nombreDescripcion,
            precio,
            stock_disponible: null,
            sinStock: false,
            cantidad: 1,
          });
          showToast("exito", "Descripción creada y seleccionada correctamente.");
          return true;
        }
        throw new Error(data.mensaje || "Error al crear la descripción");
      } catch (error) {
        showToast("error", error.message || "No se pudo crear la descripción.");
        return false;
      }
    },
    [API_DETALLES_CREAR, currentRowIdForNewDesc, updateRow, showToast]
  );

  const handleSelectDetalle = useCallback(
    (item, rowId) => {
      if (item && item.__isNewOption) {
        handleCrearNuevaDescripcion(rowId);
        return;
      }
      const precio = safeNumber(item?.precio || 0);
      updateRow(rowId, {
        tipo_item: "servicio",
        id_detalle: String(getDetalleId(item) ?? ""),
        id_stock_producto: NULL_OPTION,
        id_stock_variante: NULL_OPTION,
        detalle: optionLabel(item),
        precio,
        stock_disponible: null,
        sinStock: false,
        cantidad: 1,
      });
    },
    [updateRow, showToast, handleCrearNuevaDescripcion]
  );

  const handleSelectProducto = useCallback((producto, rowId) => {
    // Las listas globales exponen el producto base como `id`; una selección de
    // variante ya trae `id_stock_producto`. Se acepta el alias sólo dentro del
    // selector de stock para no confundirlo con el id de un detalle/servicio.
    const idStockProducto = getStockProductoId(producto) || (
      Number(producto?.id || 0) > 0 ? Number(producto.id) : null
    );
    const idStockVariante = getStockVarianteId(producto);
    const stockDisponible = getStockDisponible(producto);
    const nombre = getProductoNombre(producto);
    updateRow(rowId, {
      tipo_item: "producto",
      id_detalle: NULL_OPTION,
      id_stock_producto: idStockProducto ? String(idStockProducto) : NULL_OPTION,
      id_stock_variante: idStockVariante ? String(idStockVariante) : NULL_OPTION,
      detalle: nombre,
      precio: getPrecioVenta(producto),
      stock_disponible: stockDisponible,
      sinStock: stockDisponible !== null && stockDisponible <= 0,
      cantidad: stockDisponible !== null && stockDisponible <= 0 ? "" : 1,
    });
  }, [updateRow]);

  const barcodePendingRef = useRef(null);

  const handleBarcodeProductSelect = useCallback((producto) => {
    const target = rows.find((row) =>
      !Number(row?.id_stock_producto || 0) &&
      !Number(row?.id_stock_variante || 0) &&
      !String(row?.detalle || "").trim()
    );

    if (target) {
      handleSelectProducto(producto, target.id);
      showToast("exito", `Producto leído: ${getProductoNombre(producto)}`);
      return;
    }

    const nextRow = buildEmptyRow("producto");
    barcodePendingRef.current = { rowId: nextRow.id, producto };
    setRows((prev) => [...prev, nextRow]);
  }, [rows, handleSelectProducto, showToast]);

  useEffect(() => {
    const pending = barcodePendingRef.current;
    if (!pending || !rows.some((row) => row.id === pending.rowId)) return;
    barcodePendingRef.current = null;
    handleSelectProducto(pending.producto, pending.rowId);
    showToast("exito", `Producto leído: ${getProductoNombre(pending.producto)}`);
  }, [rows, handleSelectProducto, showToast]);

  useStockBarcodeScanner({
    enabled:
      open &&
      !saving &&
      !openViewer &&
      !openNuevaDescripcionModal &&
      !openFactura &&
      !addClienteOpen,
    options: productosList,
    allowOutOfStock: false,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => showToast("advertencia", mensaje),
  });

  const handleCantidadChange = useCallback(
    (rowId, newCantidad) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      let cantidadFinal = newCantidad === "" ? "" : Number(newCantidad);
      if (typeof cantidadFinal === "number" && cantidadFinal < 0) cantidadFinal = 0;
      if (
        row.tipo_item === "producto" &&
        cantidadFinal !== "" &&
        row.stock_disponible !== null &&
        Number(cantidadFinal) > Number(row.stock_disponible)
      ) {
        showToast("advertencia", `Stock disponible: ${row.stock_disponible}.`);
        cantidadFinal = Number(row.stock_disponible);
      }
      updateRow(rowId, { cantidad: cantidadFinal });
    },
    [rows, updateRow, showToast]
  );

  // ─── Cálculos de totales ─────────────────────────────────────────────────────
  const rowsCalc = useMemo(
    () =>
      rows.map((r) => {
        const cantidad = Math.max(0, safeNumber(r.cantidad));
        const precio = Math.max(0, safeNumber(r.precio));
        const ivaPct = Math.max(0, safeNumber(r.ivaPct));
        const subtotal = cantidad * precio;
        const ivaMonto = subtotal * (ivaPct / 100);
        const total = subtotal + ivaMonto;
        return { ...r, subtotal, ivaMonto, total };
      }),
    [rows]
  );

  const resumen = useMemo(
    () => ({
      subtotal: rowsCalc.reduce((a, r) => a + safeNumber(r.subtotal), 0),
      iva: rowsCalc.reduce((a, r) => a + safeNumber(r.ivaMonto), 0),
      total: rowsCalc.reduce((a, r) => a + safeNumber(r.total), 0),
    }),
    [rowsCalc]
  );

  const sumaMediosPago = useMemo(
    () => mediosFilas.reduce((a, r) => a + safeNumber(r.monto), 0),
    [mediosFilas]
  );
  const diferenciaRestante = useMemo(
    () => Math.max(0, resumen.total - sumaMediosPago),
    [resumen.total, sumaMediosPago]
  );

  // ─── Comprobante ─────────────────────────────────────────────────────────────
  const abrirViewer = useCallback(() => {
    if (!archivoAdjunto) return;
    setViewerData({
      url: URL.createObjectURL(archivoAdjunto),
      mime: archivoAdjunto.type || "application/octet-stream",
      title: NOMBRE_COMPROBANTE_GENERICO,
    });
    setOpenViewer(true);
  }, [archivoAdjunto]);

  const cerrarViewer = useCallback(() => {
    if (viewerData?.url?.startsWith("blob:")) URL.revokeObjectURL(viewerData.url);
    setOpenViewer(false);
    setViewerData({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });
  }, [viewerData]);

  const handleArchivoAdjuntoSeleccionado = useCallback((e) => {
    const file = e.target.files?.[0] || null;

    if (!file) return;

    if (!isAllowedComprobanteFile(file)) {
      showToast("advertencia", "Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      setArchivoAdjunto(null);

      if (inputFileRef.current) inputFileRef.current.value = "";

      return;
    }

    setArchivoAdjunto(file);
  }, [showToast]);

  const openDatePicker = useCallback(() => {
    const el = fechaRef.current;
    if (!el || saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }, [saving]);

  // ⭐ FUNCIÓN DE VALIDACIÓN DE FECHA PARA EL onChange ⭐
  const handleFechaChange = useCallback((e) => {
    const nuevaFecha = e.target.value;
    
    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.");
      return;
    }
    
    setFecha(nuevaFecha);
  }, [showToast]);

  // ─── Validación ──────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    if (!safeStr(fecha)) return { ok: false, msg: "Falta la fecha." };
    if (!(Number(selectedClienteId) > 0)) {
      return { ok: false, msg: "Falta seleccionar un Cliente (obligatorio)." };
    }
    
    // ⭐ VALIDACIÓN DE FECHA FUTURA ⭐
    if (fecha > todayISO()) {
      return { ok: false, msg: "La fecha no puede ser posterior al día actual." };
    }
    
    for (let i = 0; i < mediosFilas.length; i++) {
      const mp = mediosFilas[i];
      const tieneMedio = !!mp.id_medio_pago && mp.id_medio_pago !== NULL_OPTION;
      const montoManual = safeNumber(mp.monto);
      const montoCheque = safeNumber(mp.cheque?.importe);
      const tieneMonto = montoManual > 0 || montoCheque > 0;
      const tieneCheque = !!mp.cheque;

      // Para Otros Ingresos el cobro inicial es opcional:
      // se puede crear pendiente, parcial o totalmente cobrado.
      // Si la fila no tiene importe/cheque, se ignora aunque haya quedado un medio seleccionado.
      if (!tieneMonto && !tieneCheque) continue;

      if (!tieneMedio)
        return { ok: false, msg: `Medio de pago ${i + 1}: falta seleccionar el medio.` };
      const medio = mediosPagoList.find(
        (x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago)
      );
      const tipoCheque = detectChequeTipo(medio?.nombre || "");
      if (tipoCheque) {
        if (!mp.cheque)
          return {
            ok: false,
            msg: `Medio de pago ${i + 1}: debés cargar el ${tipoCheque === "echeq" ? "eCheq" : "cheque"}.`,
          };
        if (montoCheque <= 0)
          return { ok: false, msg: `Medio de pago ${i + 1}: el importe del cheque es inválido.` };
      } else if (montoManual <= 0) {
        return { ok: false, msg: `Medio de pago ${i + 1}: el monto debe ser mayor a 0.` };
      }
    }

    // Otros ingresos es contado: debe quedar cobrado como mínimo por el total.
    // Se permite superar el total cuando el usuario usa un cheque/eCheq de mayor importe.
    if (sumaMediosPago + 0.05 < resumen.total && resumen.total > 0)
      return {
        ok: false,
        msg: `La suma de los medios de pago (${moneyARS(sumaMediosPago)}) debe cubrir el total del ingreso (${moneyARS(resumen.total)}).`,
      };

    const problems = [];
    rowsCalc.forEach((r, i) => {
      const touched =
        safeStr(r.detalle) !== "" ||
        String(r.id_detalle || "").trim() !== "" ||
        String(r.id_stock_producto || "").trim() !== "" ||
        String(r.id_stock_variante || "").trim() !== "" ||
        safeNumber(r.cantidad) !== 0 ||
        safeNumber(r.precio) !== 0;
      if (!touched) return;
      const issues = [];
      if (!safeStr(r.detalle)) issues.push("falta la descripción");
      if (r.tipo_item === "producto" && !(Number(r.id_stock_producto || 0) > 0)) {
        issues.push("falta seleccionar un producto");
      }
      if (!(safeNumber(r.cantidad) > 0)) issues.push("la cantidad debe ser > 0");
      if (
        r.tipo_item === "producto" &&
        r.stock_disponible !== null &&
        safeNumber(r.cantidad) > Number(r.stock_disponible) + 0.0001
      ) {
        issues.push(`la cantidad supera el stock disponible (${r.stock_disponible})`);
      }
      if (!(safeNumber(r.precio) > 0)) issues.push("el importe debe ser > 0");
      if (!(safeNumber(r.total) > 0)) issues.push("el total queda en 0");
      if (issues.length) problems.push(`Fila ${i + 1}: ${issues.join(", ")}.`);
    });
    const usable = rowsCalc.filter(
      (r) =>
        safeStr(r.detalle) !== "" &&
        (r.tipo_item !== "producto" || Number(r.id_stock_producto || 0) > 0) &&
        safeNumber(r.cantidad) > 0 &&
        safeNumber(r.precio) > 0 &&
        safeNumber(r.total) > 0
    );
    if (!usable.length)
      return {
        ok: false,
        msg: problems.length
          ? `No hay filas válidas. ${problems.slice(0, 2).join(" ")}${problems.length > 2 ? ` (y ${problems.length - 2} más)` : ""}`
          : "Cargá al menos 1 fila válida (detalle o producto + cantidad + importe).",
      };
    if (problems.length) {
      return {
        ok: false,
        msg: `Completá o eliminá las filas incompletas antes de guardar. ${problems.slice(0, 2).join(" ")}${problems.length > 2 ? ` (y ${problems.length - 2} más)` : ""}`,
      };
    }
    return { ok: true, usable };
  }, [fecha, selectedClienteId, mediosFilas, mediosPagoList, sumaMediosPago, resumen.total, rowsCalc]);

  // ─── Build payload ────────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => {
    const usableRows = rowsCalc.filter(
      (r) =>
        safeStr(r.detalle) !== "" &&
        (r.tipo_item !== "producto" || Number(r.id_stock_producto || 0) > 0) &&
        safeNumber(r.cantidad) > 0 &&
        safeNumber(r.precio) > 0 &&
        safeNumber(r.total) > 0
    );
    const detalleFinal =
      usableRows.length === 1
        ? safeStr(usableRows[0].detalle)
        : usableRows.map((x) => safeStr(x.detalle)).filter(Boolean).join(" | ");
    const subtotalFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.subtotal), 0);
    const ivaFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.ivaMonto), 0);
    const totalFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.total), 0);
    const mediosPayload = mediosFilas
      .filter((mp) => Number(mp.id_medio_pago || 0) > 0 && safeNumber(mp.cheque?.importe ?? mp.monto) > 0)
      .map((mp, index) => {
        const cheque = mp.cheque
          ? {
              tipo: mp.cheque.tipo || mp.cheque.tipo_cheque || mp.cheque.cheque_tipo || null,
              fecha_emision: mp.cheque.fecha_emision || null,
              emisor: mp.cheque.emisor || "",
              numero_cheque: mp.cheque.numero_cheque || "",
              importe: safeNumber(mp.cheque.importe),
              fecha_pago: mp.cheque.fecha_pago || null,
              observaciones: mp.cheque.observaciones || "",
              archivo_nombre:
                mp.cheque.archivo_nombre ||
                (mp.cheque.archivo instanceof File ? mp.cheque.archivo.name : ""),
            }
          : null;
        return {
          frontend_row_uid: mp.id,
          id_medio_pago: Number(mp.id_medio_pago),
          monto: safeNumber(mp.cheque?.importe ?? mp.monto),
          cheque_tipo: cheque?.tipo || null,
          original_index: index,
          ...(cheque ? { cheque } : {}),
        };
      });
    return {
      fecha: safeStr(fecha).slice(0, 10),
      id_cliente: Number(selectedClienteId) || null,
      cliente_nombre: selectedClienteNombre || null,
      id_medio_pago: mediosPayload[0]?.id_medio_pago || null,
      medio_pago_nombre: optionLabel(
        mediosPagoList.find(
          (x) => Number(getMedioPagoId(x)) === Number(mediosPayload[0]?.id_medio_pago)
        )
      ),
      medios_pago: mediosPayload,
      detalle: detalleFinal,
      descripcion: detalleFinal,
      concepto: detalleFinal,
      cantidad: usableRows.length === 1 ? safeNumber(usableRows[0].cantidad) : 1,
      precio:
        usableRows.length === 1 ? safeNumber(usableRows[0].precio) : safeNumber(subtotalFinal),
      subtotal: safeNumber(subtotalFinal),
      iva_monto: safeNumber(ivaFinal),
      monto_total: safeNumber(totalFinal),
      total: safeNumber(totalFinal),
      total_general: safeNumber(totalFinal),
      items: usableRows.map((x, idx) => ({
        orden: idx + 1,
        tipo_item: x.tipo_item === "producto" ? "producto" : "servicio",
        mueve_stock: x.tipo_item === "producto" ? 1 : 0,
        id_detalle: x.tipo_item === "producto" ? null : (Number(x.id_detalle || 0) || null),
        id_stock_producto: x.tipo_item === "producto" ? (Number(x.id_stock_producto || 0) || null) : null,
        id_stock_variante: x.tipo_item === "producto" ? (Number(x.id_stock_variante || 0) || null) : null,
        detalle: safeStr(x.detalle),
        descripcion: safeStr(x.detalle),
        concepto: safeStr(x.detalle),
        cantidad: safeNumber(x.cantidad),
        precio: safeNumber(x.precio),
        iva_pct: safeNumber(x.ivaPct),
        subtotal: safeNumber(x.subtotal),
        iva_monto: safeNumber(x.ivaMonto),
        total: safeNumber(x.total),
      })),
    };
  }, [rowsCalc, fecha, selectedClienteId, selectedClienteNombre, mediosFilas, mediosPagoList]);

  const abrirResumenFactura = useCallback(async (clienteFiscalSource, clienteSource = null) => {
    const fiscal = normalizeClienteFiscalDb(clienteFiscalSource || {});
    const cliente = normalizeClienteSimple(clienteSource || selectedCliente || {
      id_cliente: selectedClienteId,
      nombre: selectedClienteNombre,
    });
    if (!cliente.id_cliente) throw new Error("Seleccioná un cliente antes de facturar.");
    if (!fiscal.cuit || !fiscal.razon_social) throw new Error("El cliente no tiene datos fiscales válidos.");

    const payload = buildPayload();
    if (!facturaOperationKeyRef.current) {
      facturaOperationKeyRef.current = getOrCreateNuevoIngresoArcaKey();
    }
    const config = configFacturacion || (await fetchConfigFacturacion());
    const cuentas = Array.isArray(config?._configs_facturacion) && config._configs_facturacion.length
      ? config._configs_facturacion
      : configsFacturacion.length
        ? configsFacturacion
        : [config];
    setConfigsFacturacion(cuentas);
    setFacturaDraft({
      payload,
      data: {
        ...buildIngresoFacturaDraft(payload, facturaOperationKeyRef.current, {
          cliente,
          clienteFiscal: fiscal,
          configFacturacion: config,
        }),
        configs_facturacion: cuentas,
      },
    });
    setOpenFactura(true);
  }, [selectedCliente, selectedClienteId, selectedClienteNombre, buildPayload, configFacturacion, fetchConfigFacturacion, configsFacturacion]);

  const confirmarFiscalPanelYFacturar = useCallback(async () => {
    const cuit = onlyDigits(fiscalCuitInput);
    if (cuit.length !== 11) {
      setFiscalError("Ingresá un CUIT válido de 11 dígitos.");
      return;
    }
    setSaving(true);
    setSavingAction("facturar");
    try {
      let fiscal = fiscalArcaData;
      if (!fiscal || onlyDigits(fiscal.cuit) !== cuit) fiscal = await consultarCuitArca(cuit);
      const result = await guardarClienteFiscalDesdeArca(fiscal, selectedClienteId);
      setFiscalPanelOpen(false);
      showToast("exito", result.ya_existia
        ? "El CUIT ya estaba cargado. Se usaron los datos fiscales existentes."
        : "Datos fiscales obtenidos y guardados correctamente.");
      await abrirResumenFactura(result.cliente_fiscal, result.cliente);
    } catch (error) {
      setFiscalError(error?.message || "No se pudo resolver el cliente fiscal.");
      showToast("error", error?.message || "No se pudo resolver el cliente fiscal.");
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }, [fiscalCuitInput, fiscalArcaData, consultarCuitArca, guardarClienteFiscalDesdeArca, selectedClienteId, abrirResumenFactura, showToast]);

  const onClickFacturar = useCallback(async () => {
    if (saving) return;
    const validation = validate();
    if (!validation.ok) {
      showToast("advertencia", validation.msg || "Faltan datos.");
      return;
    }
    if (!(Number(selectedClienteId) > 0)) {
      showToast("advertencia", "Seleccioná un cliente antes de facturar.");
      return;
    }

    setSaving(true);
    setSavingAction("facturar");
    setFiscalError("");
    try {
      const fiscal =
        clienteFiscalDb && Number(clienteFiscalDb.id_cliente) === Number(selectedClienteId)
          ? clienteFiscalDb
          : await fetchClienteFiscal(selectedClienteId);
      if (fiscal?.cuit) {
        await abrirResumenFactura(fiscal, selectedCliente);
        return;
      }
      setFiscalCuitInput("");
      setFiscalArcaData(null);
      setFiscalPanelOpen(true);
    } catch (error) {
      showToast("error", error?.message || "No se pudo iniciar la facturación.");
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }, [saving, validate, showToast, selectedClienteId, clienteFiscalDb, fetchClienteFiscal, abrirResumenFactura, selectedCliente]);

  // ─── Side effects de guardado ─────────────────────────────────────────────────
  const subirArchivo = useCallback(
    async (idMovimiento, archivo) => {
      if (!archivo || !idMovimiento) return null;
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("tipo", "OTRO_INGRESO");
      fd.append("id_movimiento", String(idMovimiento));
      fd.append("force_replace", "1");
      return await apiPostForm(API_UPLOAD, fd);
    },
    [API_UPLOAD]
  );

  const actualizarChequeConArchivo = useCallback(
    async ({ idCheque, cheque }) => {
      if (!idCheque || !(cheque?.archivo instanceof File)) return null;
      const fd = new FormData();
      const { token, sessionKey } = getAuthInfo();
      fd.append("id_cheque", String(idCheque));
      fd.append("tipo", cheque.tipo === "echeq" || cheque.tipo_cheque === "echeq" ? "ECHEQ_IMAGEN" : "CHEQUE_IMAGEN");
      fd.append("archivo", cheque.archivo, cheque.archivo_nombre || cheque.archivo.name || "adjunto");
      const headers = {};
      if (sessionKey) headers["X-Session"] = sessionKey;
      if (token) headers.Authorization = `Bearer ${token}`;
      return await parseJsonOrThrow(
        await otrosIngresosFetch(API_CHEQUES_ACTUALIZAR, { method: "POST", headers, body: fd })
      );
    },
    [API_CHEQUES_ACTUALIZAR]
  );

  const subirArchivosChequesCreados = useCallback(
    async (info) => {
      const warnings = [];
      const creados = Array.isArray(info?.cheques_creados) ? info.cheques_creados : [];
      if (!creados.length) return warnings;

      const filasCheque = mediosFilas.filter((mp) => mp?.cheque?.archivo instanceof File);
      for (const mp of filasCheque) {
        const backendCheque = creados.find((x) => String(x?.frontend_row_uid || "") === String(mp.id));
        if (!backendCheque?.id_cheque) {
          warnings.push(`No se pudo vincular el archivo del cheque ${mp?.cheque?.numero_cheque || ""}.`);
          continue;
        }
        try {
          await actualizarChequeConArchivo({ idCheque: backendCheque.id_cheque, cheque: mp.cheque });
        } catch (e) {
          warnings.push(e?.message || `No se pudo adjuntar el archivo del cheque ${mp?.cheque?.numero_cheque || ""}.`);
        }
      }
      return warnings;
    },
    [mediosFilas, actualizarChequeConArchivo]
  );

  const subirFacturaYVincularIngreso = useCallback(
    async ({ idMovimiento, facturaMeta, draftData }) => {
      if (!(Number(idMovimiento) > 0) || !(facturaMeta?.pdf_blob instanceof Blob)) {
        throw new Error("Faltan datos para guardar y vincular la factura emitida.");
      }

      const resumenFactura =
        facturaMeta?.resumen_facturacion && typeof facturaMeta.resumen_facturacion === "object"
          ? facturaMeta.resumen_facturacion
          : draftData || {};
      const clienteFiscal =
        facturaMeta?.cliente_facturacion || resumenFactura?.cliente_facturacion || {};
      const configFacturacion =
        facturaMeta?.config_facturacion || resumenFactura?.config_facturacion || {};
      const emitidoEnArca = Number(facturaMeta?.emitido_en_arca || 0) === 1;

      const fd = new FormData();
      fd.append("tipo", "FACTURA");
      fd.append("id_movimiento", String(idMovimiento));
      fd.append(
        "pdf",
        facturaMeta.pdf_blob,
        facturaMeta?.pdf_filename || "factura.pdf"
      );
      fd.append(
        "meta",
        JSON.stringify({
          tipo: "FACTURA",
          estado: emitidoEnArca ? "emitida" : "solo_pdf",
          emitido_en_arca: emitidoEnArca ? 1 : 0,
          operacion_key:
            safeStr(
              facturaMeta?.operacion_arca?.key ||
                facturaMeta?.operacion_key ||
                resumenFactura?.operacion_key ||
                draftData?.operacion_key
            ) || null,
          operacion_contexto:
            safeStr(
              facturaMeta?.operacion_arca?.contexto ||
                facturaMeta?.operacion_contexto ||
                resumenFactura?.operacion_contexto ||
                "OTRO_INGRESO_FACTURA"
            ) || "OTRO_INGRESO_FACTURA",
          operacion_id_origen: Number(idMovimiento),
          id_pago: facturaMeta?.id_pago ?? null,
          id_sistema: facturaMeta?.id_sistema ?? null,
          anio: Number(facturaMeta?.anio || 0) || null,
          id_mes: Number(facturaMeta?.id_mes || 0) || null,
          monto_ars: safeNumber(
            facturaMeta?.imp_total ?? facturaMeta?.importe ?? resumenFactura?.total_ars
          ),
          doc_tipo: Number(
            facturaMeta?.doc_tipo ?? clienteFiscal?.doc_tipo ?? 80
          ),
          doc_nro: safeStr(
            facturaMeta?.doc_nro ?? clienteFiscal?.doc_nro ?? clienteFiscal?.cuit
          ),
          cbte_tipo: Number(
            facturaMeta?.cbte_tipo ?? resumenFactura?.cbte_tipo ?? 11
          ),
          pto_vta: Number(
            facturaMeta?.pto_vta ?? resumenFactura?.pto_vta ?? 2
          ),
          cbte_nro: facturaMeta?.cbte_nro ?? null,
          razon_social: clienteFiscal?.razon_social || null,
          cond_iva:
            clienteFiscal?.cond_iva || clienteFiscal?.condicion_iva || null,
          domicilio: clienteFiscal?.domicilio || null,
          cliente_facturacion: clienteFiscal,
          config_facturacion: configFacturacion,
          id_config_facturacion:
            facturaMeta?.id_config_facturacion ??
            resumenFactura?.id_config_facturacion ??
            null,
          emisor: resumenFactura?.emisor || null,
          cae: emitidoEnArca ? facturaMeta?.cae ?? null : null,
          cae_vto: emitidoEnArca ? facturaMeta?.cae_vto ?? null : null,
          fecha_cbte:
            facturaMeta?.fecha_cbte ?? resumenFactura?.fecha_cbte_iso ?? null,
          resultado: facturaMeta?.resultado ?? (emitidoEnArca ? null : "P"),
          qr_url: emitidoEnArca ? facturaMeta?.qr_url ?? null : null,
          qr_base64: emitidoEnArca ? facturaMeta?.qr_base64 ?? null : null,
          qr_payload: emitidoEnArca ? facturaMeta?.qr_payload ?? null : null,
          json_arca: emitidoEnArca
            ? facturaMeta?.json_arca ?? facturaMeta?.raw_min ?? facturaMeta
            : facturaMeta,
          resumen_facturacion: {
            ...(draftData || {}),
            ...(resumenFactura || {}),
            cliente_facturacion: clienteFiscal,
            config_facturacion: configFacturacion,
            items_facturacion: Array.isArray(resumenFactura?.items_facturacion)
              ? resumenFactura.items_facturacion
              : Array.isArray(draftData?.items_facturacion)
                ? draftData.items_facturacion
                : [],
          },
        })
      );

      const response = await otrosIngresosFetch(API_VINCULAR_FACTURA, {
        method: "POST",
        headers: buildAuthHeaders(false),
        body: fd,
      });
      const data = await parseJsonOrThrow(response);
      if (!data?.exito) {
        throw new Error(data?.mensaje || "No se pudo vincular la factura al ingreso.");
      }
      return data;
    },
    [API_VINCULAR_FACTURA]
  );

  const crearIngresoConAdjuntos = useCallback(
    async (payload) => {
      const data = await onSubmit(payload, mode === "edit");
      const idMovimientoFinal = getSavedMovimientoIdFromResponse(data, initialData);
      if (!idMovimientoFinal) {
        throw new Error("El backend no devolvió un id_movimiento válido.");
      }

      let warningArchivo = "";
      if (archivoAdjunto) {
        try {
          const result = await subirArchivo(idMovimientoFinal, archivoAdjunto);
          if (!result?.exito) {
            warningArchivo = result?.mensaje || "No se pudo vincular el archivo.";
          }
        } catch (error) {
          warningArchivo = error?.message || "No se pudo vincular el archivo.";
        }
      }

      const warningsCheques = await subirArchivosChequesCreados(data);
      if (warningsCheques.length) {
        showToast(
          "advertencia",
          `Ingreso guardado, pero hubo problemas con archivo/s de cheque: ${warningsCheques.join(" | ")}`
        );
      }
      if (warningArchivo) {
        showToast(
          "advertencia",
          `Ingreso guardado, pero el archivo no se pudo vincular: ${warningArchivo}`
        );
      }

      const ingresoBackend = data?.ingreso ?? data?.otro_ingreso ?? {};
      return {
        data,
        idMovimiento: idMovimientoFinal,
        payload,
        ingreso: {
          ...payload,
          ...(ingresoBackend && typeof ingresoBackend === "object" ? ingresoBackend : {}),
          id_movimiento: idMovimientoFinal,
          items_detalle: Array.isArray(ingresoBackend?.items_detalle)
            ? ingresoBackend.items_detalle
            : payload.items,
        },
      };
    },
    [
      onSubmit,
      mode,
      initialData,
      archivoAdjunto,
      subirArchivo,
      subirArchivosChequesCreados,
      showToast,
    ]
  );

  const finalizarFacturacionYGuardarIngreso = useCallback(
    async (facturaEmitida) => {
      if (saving) return;
      if (!facturaDraft?.payload || !facturaDraft?.data) {
        showToast("error", "No se encontró el borrador del ingreso a facturar.");
        return;
      }

      setSavingAction("facturar");
      setSaving(true);
      try {
        let pending = facturaPendingSaveRef.current;
        if (!pending) {
          pending = await crearIngresoConAdjuntos(facturaDraft.payload);
          facturaPendingSaveRef.current = pending;
        }

        if (!pending.facturaVinculada) {
          const vinculacion = await subirFacturaYVincularIngreso({
            idMovimiento: pending.idMovimiento,
            facturaMeta: facturaEmitida,
            draftData: facturaDraft.data,
          });
          pending = { ...pending, facturaVinculada: vinculacion };
          facturaPendingSaveRef.current = pending;
        }

        const resultadoFinal = {
          ...(pending.data || {}),
          id_movimiento: pending.idMovimiento,
          id_comprobante:
            pending.facturaVinculada?.id_comprobante ??
            pending.facturaVinculada?.comprobante?.id_comprobante ??
            null,
          accion_final: "facturar",
          ingreso: pending.ingreso,
          factura_emitida: facturaEmitida,
        };

        const completedOperationKey = safeStr(
          facturaEmitida?.operacion_arca?.key ||
            facturaEmitida?.operacion_key ||
            facturaDraft.data?.operacion_key ||
            facturaOperationKeyRef.current
        );
        clearNuevoIngresoArcaKey(completedOperationKey);
        facturaOperationKeyRef.current = "";
        facturaPendingSaveRef.current = null;
        setOpenFactura(false);
        setFacturaDraft(null);
        await onSaved?.(resultadoFinal);
      } catch (error) {
        const yaEmitida = Boolean(facturaEmitida?.cae);
        showToast(
          "error",
          yaEmitida
            ? `La factura fue emitida, pero no se terminó de vincular el ingreso: ${
                error?.message || "error desconocido"
              }. Volvé a presionar Facturar para reintentar sin duplicar el ingreso.`
            : error?.message || "No se pudo facturar el ingreso."
        );
      } finally {
        setSaving(false);
        setSavingAction(null);
      }
    },
    [
      saving,
      facturaDraft,
      crearIngresoConAdjuntos,
      subirFacturaYVincularIngreso,
      onSaved,
      showToast,
    ]
  );

  // ─── Submit ───────────────────────────────────────────────────────────────────
  const submit = useCallback(async (accionFinal = "guardar") => {
    if (saving) return;
    if (typeof onSubmit !== "function") {
      showToast("error", "Falta la función de guardado del modal.");
      return;
    }

    const accion = mode === "create" && accionFinal === "facturar" ? "facturar" : "guardar";
    if (accion === "facturar" && facturaPendingSaveRef.current && facturaDraft?.data) {
      setOpenFactura(true);
      return;
    }

    const v = validate();
    if (!v.ok) {
      showToast("advertencia", v.msg || "Faltan datos.");
      return;
    }
    if (archivoAdjunto && !isAllowedComprobanteFile(archivoAdjunto)) {
      showToast("advertencia", "Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      return;
    }

    const payload = buildPayload();
    if (accion === "facturar") {
      await onClickFacturar();
      return;
    }

    setSavingAction("guardar");
    setSaving(true);
    try {
      const guardado = await crearIngresoConAdjuntos(payload);
      clearNuevoIngresoArcaKey(facturaOperationKeyRef.current);
      facturaOperationKeyRef.current = "";
      await onSaved?.({
        ...(guardado.data || {}),
        id_movimiento: guardado.idMovimiento,
        accion_final: "guardar",
        ingreso: guardado.ingreso,
      });
    } catch (error) {
      showToast("error", error?.message || "No se pudo guardar el ingreso.");
    } finally {
      setSaving(false);
      setSavingAction(null);
    }
  }, [
    saving,
    onSubmit,
    showToast,
    mode,
    facturaDraft,
    validate,
    archivoAdjunto,
    buildPayload,
    onClickFacturar,
    crearIngresoConAdjuntos,
    onSaved,
  ]);

  const btnLabel = saving && savingAction === "guardar"
    ? "Guardando..."
    : mode === "edit"
      ? "Guardar cambios"
      : "Guardar ingreso";

  if (!open) return null;

  return createPortal(
    <>
      <div className={`gm-modal-overlay${dark ? " gm-modal-overlay--dark" : ""}`}>
        <div
          className={`gm-modal-container gm-modal-container--movement gm-modal-v2 oi-modal${dark ? " gm-modal-container--dark" : ""}`}
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faPlus} />
            </div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">
                {mode === "edit" ? "Editar Ingreso" : "Nuevo Ingreso"}
              </h2>
            </div>
            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={() => !saving && onClose?.()}
              aria-label="Cerrar"
              disabled={saving}
              type="button"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="gm-modal-content">
            <div className="gm-movement-layout">
              {/* Tabla de ítems */}
              <section className="gm-movement-main gm-table gm-table--movement oi-table">
                <div className={`gm-table-head${hasScroll ? " gm-table-head--body-scroll" : ""}`}>
                  <div className="gm-table-th" style={{ paddingLeft: 10 }}>
                    Tipo / detalle o producto
                  </div>
                  <div className="gm-table-th">Cant.</div>
                  <div className="gm-table-th right">Importe</div>
                  <div className="gm-table-th">IVA %</div>
                  <div className="gm-table-th right">IVA $</div>
                  <div className="gm-table-th right">Total</div>
                  <div className="gm-table-th" />
                </div>

                <div
                  ref={rowsContainerRef}
                  className={`gm-table-body${hasScroll ? " has-scroll" : ""}`}
                >
                  {rowsCalc.map((r, rowIndex) => {
                    return (
                      <div
                        key={r.id}
                        className="gm-table-row"
                      >
                        <div className="gm-table-cell gm-table-cell--detail">
                          <select
                            className="oi-item-kind"
                            value={r.tipo_item === "producto" ? "producto" : "servicio"}
                            onChange={(e) => handleTipoItemChange(r.id, e.target.value)}
                            disabled={saving}
                            aria-label={`Tipo de ítem fila ${rowIndex + 1}`}
                          >
                            <option value="servicio">Detalle / servicio (sin stock)</option>
                            <option value="producto">Producto (mueve stock)</option>
                          </select>
                          {r.tipo_item === "producto" ? (
                            <ProductStockAutocomplete
                              value={r.detalle}
                              onChange={(val) =>
                                updateRow(r.id, {
                                  detalle: val,
                                  id_detalle: NULL_OPTION,
                                  id_stock_producto: NULL_OPTION,
                                  id_stock_variante: NULL_OPTION,
                                  precio: 0,
                                  stock_disponible: null,
                                  sinStock: false,
                                })
                              }
                              onSelect={(item) => handleSelectProducto(item, r.id)}
                              options={productosList}
                              placeholder="Escribí o buscá un producto…"
                              disabled={saving}
                              showAllOnFocus={true}
                              maxItems={18}
                              inputClassName="gm-cell-input"
                              emptyMessage="No hay productos con stock"
                            />
                          ) : (
                            <GlobalAutocomplete
                              value={r.detalle}
                              onChange={(val) =>
                                updateRow(r.id, {
                                  detalle: val,
                                  id_detalle: NULL_OPTION,
                                  id_stock_producto: NULL_OPTION,
                                  id_stock_variante: NULL_OPTION,
                                  stock_disponible: null,
                                  sinStock: false,
                                })
                              }
                              onSelect={(item) => handleSelectDetalle(item, r.id)}
                              options={enhancedDetallesList}
                              getOptionLabel={(d) => optionLabel(d)}
                              getOptionValue={(d) => String(getDetalleId(d) ?? optionLabel(d))}
                              placeholder="Escribí o buscá una descripción…"
                              disabled={saving}
                              showAllOnFocus={true}
                              maxItems={18}
                              inputClassName="gm-cell-input"
                            />
                          )}
                          {r.tipo_item === "producto" && r.stock_disponible !== null && (
                            <small className="oi-stock-hint">Stock disponible: {r.stock_disponible}</small>
                          )}
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          <input
                            className="gm-cell-input gm-cell-input--center"
                            type="number"
                            min="0.01"
                            max={r.tipo_item === "producto" && r.stock_disponible !== null ? r.stock_disponible : undefined}
                            step="0.01"
                            value={r.cantidad}
                            onChange={(e) =>
                              handleCantidadChange(
                                r.id,
                                e.target.value === "" ? "" : Number(e.target.value)
                              )
                            }
                            disabled={saving || Boolean(r.tipo_item === "producto" && r.sinStock)}
                            placeholder=""
                            title=""
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--right">
                          <input
                            className="gm-cell-input gm-cell-input--right"
                            type="text"
                            inputMode="decimal"
                            value={
                              r.precioFocused
                                ? r.precioDraft ?? ""
                                : formatMoneyInputARS(r.precio)
                            }
                            onFocus={(e) => {
                              updateRow(r.id, {
                                precioFocused: true,
                                precioDraft: formatEditableMoney(r.precio),
                              });
                              setTimeout(() => e.target.select(), 0);
                            }}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(/[^\d,.\-]/g, "");
                              updateRow(r.id, {
                                precioDraft: cleaned,
                                precio: parseMoneyInputARS(cleaned),
                              });
                            }}
                            onBlur={() => {
                              const parsed = parseMoneyInputARS(r.precioDraft);
                              updateRow(r.id, {
                                precio: parsed,
                                precioDraft: "",
                                precioFocused: false,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                            placeholder="$ 0,00"
                            disabled={saving}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          <select
                            className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                            value={String(r.ivaPct)}
                            onChange={(e) => updateRow(r.id, { ivaPct: Number(e.target.value) })}
                            disabled={saving}
                            style={{ width: "100%" }}
                          >
                            {IVA_OPTIONS.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                          {moneyARS(r.ivaMonto)}
                        </div>

                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                          {moneyARS(r.total)}
                        </div>

                        <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                          <button
                            type="button"
                            className="gm-row-delete"
                            onClick={() => removeRow(r.id)}
                            disabled={saving}
                            title="Eliminar fila"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="gm-table-foot">
                  <div className="gm-foot-actions">
                    <button type="button" className="gm-foot-btn" onClick={() => addRow("servicio")} disabled={saving}>
                      <span className="gm-foot-btn__icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 1.5V8.5M1.5 5H8.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      Agregar detalle
                    </button>
                    <button type="button" className="gm-foot-btn" onClick={() => addRow("producto")} disabled={saving}>
                      <span className="gm-foot-btn__icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 1.5V8.5M1.5 5H8.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      Agregar producto
                    </button>
                  </div>
                  <div className="gm-summary-chips">
                    <div className="gm-summary-chip gm-summary-chip--sub">
                      <span>Subtotal</span>
                      <b>{moneyARS(resumen.subtotal)}</b>
                    </div>
                    <div className="gm-summary-chip gm-summary-chip--iva">
                      <span>IVA</span>
                      <b>{moneyARS(resumen.iva)}</b>
                    </div>
                    <div className="gm-summary-chip gm-summary-chip--total">
                      <span>Total</span>
                      <b>{moneyARS(resumen.total)}</b>
                    </div>
                  </div>
                </div>
              </section>

              {/* Sidebar */}
              <div className="gm-movement-side">
                <aside className="gm-aside">
                  <div className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Datos del ingreso</span>
                    </div>

                    <div className="gm-section-body">
                      {/* ⭐ FECHA CON VALIDACIONES ⭐ */}
                      <div className="gm-field" onClick={openDatePicker}>
                        <input
                          ref={fechaRef}
                          className="gm-input"
                          type="date"
                          placeholder=" "
                          value={fecha}
                          max={todayISO()}
                          onChange={handleFechaChange}
                          disabled={saving}
                        />
                        <label className="gm-label" onClick={openDatePicker}>
                          Fecha
                        </label>
                      </div>

                      <div className="oi-cliente-wrap">
                        <GlobalAutocomplete
                          value={cliInput}
                          onChange={handleClienteInputChange}
                          onSelect={handleSelectCliente}
                          options={clientesOptions}
                          getOptionLabel={(cliente) =>
                            isAddClienteOption(cliente)
                              ? "➕ Agregar cliente"
                              : safeStr(cliente?.nombre)
                          }
                          getOptionValue={(cliente) =>
                            isAddClienteOption(cliente)
                              ? "__add_cliente__"
                              : String(getClienteId(cliente) || cliente?.nombre || "")
                          }
                          label="Cliente *"
                          placeholder=" "
                          disabled={saving || addClienteOpen || fiscalPanelOpen}
                          showAllOnFocus={true}
                          maxItems={25}
                          inputClassName="gm-input"
                        />
                      </div>

                      {/* Medios de pago integrados */}
                      <PanelMediosPago
                        mediosFilas={mediosFilas}
                        mediosPagoList={mediosPagoList}
                        totalIngreso={resumen.total}
                        onUpdate={updateMedioPago}
                        onRemove={removeMedioPago}
                        onAdd={addMedioPago}
                        saving={saving}
                        showToast={showToast}
                        apiCheckNumero={API_CHECK_NUMERO}
                      />

                      {/* Comprobante */}
                      <div className="gm-upload-card">
                        <div className="gm-upload-card__head">
                          <div className="gm-upload-card__title">Comprobante</div>
                          <div className="gm-upload-card__sub">
                            Seleccioná, visualizá o quitá el archivo antes de guardar
                          </div>
                        </div>

                        <div className="gm-upload-card__body">
                          <div className={`gm-upload-file${archivoAdjunto ? " is-filled" : " is-empty"}`}>
                            {archivoAdjunto ? (
                              <>
                                <div className="gm-upload-file__icon">
                                  <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                </div>
                                <div className="gm-upload-file__meta">
                                  <div className="gm-upload-file__name" title={NOMBRE_COMPROBANTE_GENERICO}>
                                    {NOMBRE_COMPROBANTE_GENERICO}
                                  </div>

                                </div>
                                <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="gm-upload-btn gm-upload-btn--ghost"
                                    onClick={abrirViewer}
                                    disabled={saving}
                                  >
                                    <FontAwesomeIcon icon={faEye} />
                                  </button>
                                  <button
                                    type="button"
                                    className="gm-upload-btn gm-upload-btn--ghost"
                                    onClick={() => {
                                      setArchivoAdjunto(null);
                                      if (inputFileRef.current) inputFileRef.current.value = "";
                                    }}
                                    disabled={saving}
                                  >
                                    <FontAwesomeIcon icon={faTrash} />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="gm-upload-file__meta">
                                <div className="gm-upload-file__size">No hay comprobante seleccionado</div>
                              </div>
                            )}
                          </div>

                          <div className="gm-upload-bar" style={{ marginTop: 10 }}>
                            <input
                              ref={inputFileRef}
                              type="file"
                              accept="image/*,application/pdf,.pdf"
                              className="gm-upload-bar__input"
                              onChange={handleArchivoAdjuntoSeleccionado}
                              disabled={saving}
                              style={{ display: "none" }}
                            />
                            <button
                              type="button"
                              className="gm-upload-btn gm-upload-btn--primary"
                              onClick={() => inputFileRef.current?.click()}
                              disabled={saving}
                            >
                              <FontAwesomeIcon icon={faUpload} />{" "}
                              {archivoAdjunto ? "Reemplazar archivo" : "Seleccionar archivo"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>

                <div className="gm-actions gm-actions--sticky">
                  <button
                    type="button"
                    className="gm-action-btn gm-action-btn--save"
                    onClick={() => submit("guardar")}
                    disabled={saving}
                  >
                    {btnLabel}
                  </button>
                  {mode === "create" && (
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--invoice"
                      onClick={() => submit("facturar")}
                      disabled={saving}
                    >
                      {saving && savingAction === "facturar" ? "Procesando..." : "Facturar"}
                    </button>
                  )}
                  {mode === "edit" && (
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--cancel"
                      onClick={() => !saving && onClose?.()}
                      disabled={saving}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {openNuevaDescripcionModal && (
        <ModalNuevaDescripcion
          open={openNuevaDescripcionModal}
          onClose={() => setOpenNuevaDescripcionModal(false)}
          onSave={handleGuardarNuevaDescripcion}
          dark={dark}
        />
      )}

      <ModalVerComprobante
        open={openViewer}
        url={viewerData.url}
        mime={viewerData.mime}
        title={viewerData.title}
        onClose={cerrarViewer}
      />

      {mode === "create" && facturaDraft?.data && (
        <ModalFacturaBaltoResumen
          open={openFactura}
          onClose={() => {
            if (!saving) setOpenFactura(false);
          }}
          onBack={() => {
            if (!saving) setOpenFactura(false);
          }}
          onCloseAll={() => {
            if (!saving) setOpenFactura(false);
          }}
          apiBase={`${BASE_URL}/api.php`}
          action="movimientos"
          data={facturaDraft.data}
          docTipo={Number(facturaDraft.data?.cliente_facturacion?.doc_tipo || 80)}
          docNro={safeStr(
            facturaDraft.data?.cliente_facturacion?.doc_nro ||
              facturaDraft.data?.cliente_facturacion?.cuit
          )}
          cbteTipo={Number(facturaDraft.data?.cbte_tipo || 11)}
          ptoVta={String(facturaDraft.data?.pto_vta || 2)}
          configsFacturacionInicial={
            facturaDraft.data?.configs_facturacion || configsFacturacion
          }
          onDone={finalizarFacturacionYGuardarIngreso}
          skipMovimientoAutocreacion={true}
        />
      )}

      <ModalClienteFiscalArca
        open={fiscalPanelOpen}
        dark={dark}
        title="Datos fiscales para facturar"
        infoTitle="Factura por CUIT"
        description={
          <>
            Cliente seleccionado: <b>{selectedClienteNombre || "Cliente"}</b>. Si todavía no tiene ficha fiscal,
            buscá el CUIT en ARCA y confirmá para continuar al resumen completo.
          </>
        }
        cuit={fiscalCuitInput}
        fiscalData={fiscalArcaData}
        error={fiscalError}
        loading={fiscalLookupLoading || fiscalLoading}
        saving={saving && savingAction === "facturar"}
        confirmText="Confirmar y facturar"
        requireFiscalData={false}
        onCuitChange={(value) => {
          setFiscalCuitInput(value);
          setFiscalArcaData(null);
          setFiscalError("");
        }}
        onLookup={consultarFiscalPanel}
        onClose={() => {
          if (saving || fiscalLookupLoading) return;
          setFiscalPanelOpen(false);
          setFiscalError("");
        }}
        onConfirm={confirmarFiscalPanelYFacturar}
      />

      <ModalClienteFiscalArca
        open={addClienteOpen}
        dark={dark}
        title="Agregar cliente por CUIT"
        infoTitle="Alta rápida por CUIT"
        description={
          <>
            Ingresá el CUIT: se consulta ARCA, se crea el cliente y queda seleccionado en este ingreso.
          </>
        }
        cuit={addClienteCuit}
        fiscalData={addClienteFiscalData}
        error={addClienteError}
        loading={addClienteLoading}
        saving={addClienteLoading}
        confirmText="Confirmar y cargar cliente"
        requireFiscalData={true}
        onCuitChange={(value) => {
          setAddClienteCuit(value);
          setAddClienteFiscalData(null);
          setAddClienteError("");
        }}
        onLookup={consultarNuevoCliente}
        onClose={() => {
          if (addClienteLoading) return;
          setAddClienteOpen(false);
          setAddClienteError("");
        }}
        onConfirm={confirmarNuevoCliente}
      />
    </>,
    document.body
  );
}
