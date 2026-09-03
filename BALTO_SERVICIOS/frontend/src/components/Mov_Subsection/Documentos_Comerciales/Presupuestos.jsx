import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";
import "../../Global/Global_css/Global_oscuro.css";
import "./DocumentosComerciales.css";
import "./DocumentosComercialesResponsive.css";
import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";
import ModalNuevoPresupuesto from "./modales/ModalNuevoPresupuesto.jsx";
import ModalModelosPresupuesto from "./modales/ModalModelosPresupuesto.jsx";
import ModalEliminar from "../../Global/Modales/ModalEliminar.jsx";
import ModalAsignarPresupuestoVenta from "./modales/ModalAsignarPresupuestoVenta.jsx";
import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalDetalleMovimiento from "../../Global/Modales/ModalDetalleMovimiento.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxOpen,
  faCalendarDays,
  faCartShopping,
  faCheckCircle,
  faChevronDown,
  faEye,
  faFileExcel,
  faInfoCircle,
  faMagnifyingGlass,
  faPlus,
  faTimes,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { useListas } from "../../../context/ListasContext.jsx";
import { useDateRange } from "../../../context/DateRangeContext";
import { readMovPerfCache, writeMovPerfCache, clearMovPerfCache } from "../_shared/performanceCache.js";
import { saveVentaNoFacturadaPdf } from "../../../utils/VentaNoFacturadaPdfBuilder";
import { saveRemitoPdf } from "../../../utils/RemitoPdfBuilder";
import { DOCUMENTOS_API, documentosRequest } from "./api/documentosComercialesApi.js";
import useDocumentosToast from "./hooks/useDocumentosToast.js";

const DOCUMENTOS_TABS = [
  { key: "presupuesto", label: "Presupuestos", path: "/panel/presupuesto" },
  { key: "facturas", label: "Facturas", path: "/panel/facturacion" },
  { key: "remitos", label: "Remitos", path: "/panel/remitos" },
];

function DocumentosTabs({ activeKey }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleTabClick = (tab) => {
    if (!tab?.path || location.pathname === tab.path) return;
    navigate(tab.path);
  };

  return (
    <div
      className="doccom-googleTabs"
      role="tablist"
      aria-label="Pestañas de documentos comerciales"
    >
      {DOCUMENTOS_TABS.map((tab) => {
        const isActive = tab.key === activeKey;

        return (
          <button
            key={tab.key}
            type="button"
            className={`doccom-googleTab ${isActive ? "is-active" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleTabClick(tab)}
          >
            <span className="doccom-googleTab__label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const PAGE_SIZE = 100;
const PROBE_LIMIT = PAGE_SIZE + 1;
const SKELETON_ROWS = 10;
const LIVE_POLL_MS = 6000;
const PRESUPUESTOS_CACHE_NS = "presupuestos:listar:v5";
const PRESUPUESTOS_CACHE_OLD_NS = ["presupuestos:listar:v2", "presupuestos:listar:v3", "presupuestos:listar:v4"];

function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function normalizeSearchText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function plusDaysISOFrom(baseIso, days = 10) {
  const base = String(baseIso || todayISO()).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(base) ? new Date(`${base}T00:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return `${String(Number(m1[3])).padStart(2, "0")}/${String(Number(m1[2])).padStart(2, "0")}/${m1[1]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${String(Number(m2[1])).padStart(2, "0")}/${String(Number(m2[2])).padStart(2, "0")}/${m2[3]}`;
  return s;
}

function formatFechaHoraDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?)?/);
  if (!m) return formatFechaDMY(s);
  const fecha = `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  if (!m[4] || !m[5]) return fecha;
  return `${fecha} ${String(Number(m[4])).padStart(2, "0")}:${String(Number(m[5])).padStart(2, "0")}`;
}

function dateToAPI(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateUI(d) {
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function getMovimientoId(r) {
  const cand = r?.id_movimiento ?? r?.idMovimiento ?? r?.id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getComprobanteId(row) {
  const n = Number(row?.presupuesto_id_comprobante ?? row?.id_comprobante ?? row?.comprobante_id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getComprobanteMime(row) {
  return String(row?.presupuesto_comprobante_mime ?? row?.archivo_mime ?? row?.comprobante_mime ?? "").trim();
}

function getClienteId(row) {
  const n = Number(row?.id_cliente ?? row?.cliente_id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detalleProductosLabel(cantidad) {
  const n = Number(cantidad || 0);
  if (!Number.isFinite(n) || n <= 0) return "SIN PRODUCTOS";
  if (n === 1) return "1 PRODUCTO";
  return `${n} PRODUCTOS`;
}

function normalizeCompareText(value) {
  return safeStr(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function firstFilled(...values) {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = firstFilled(
        value.nombre_variante,
        value.stock_variante_nombre,
        value.variante_nombre,
        value.nombre,
        value.descripcion,
        value.detalle,
        value.valor,
        value.label
      );
      if (nested) return nested;
      continue;
    }

    const s = safeStr(value);
    if (s) return s;
  }
  return "";
}

function getItemVariantText(item) {
  const raw = item && typeof item === "object" ? item : {};
  return firstFilled(
    raw.stock_variante_nombre,
    raw.variante_nombre,
    raw.nombre_variante,
    raw.stock_variante_nombre_raw,
    raw.stock_variante,
    raw.variante,
    raw.stock_variante_valores,
    raw.stock_variante_detalle,
    raw.variant_name,
    raw.variantName,
    raw.atributos_variante,
    raw.atributos
  );
}

function compareTokens(value) {
  return normalizeCompareText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);
}

function variantAlreadyIncludedInProduct(productName, variantName) {
  const productoNorm = normalizeCompareText(productName);
  const varianteNorm = normalizeCompareText(variantName);
  if (!productoNorm || !varianteNorm) return false;
  if (productoNorm === varianteNorm) return true;

  const productoTokens = compareTokens(productoNorm);
  const varianteTokens = compareTokens(varianteNorm);
  if (!productoTokens.length || !varianteTokens.length) return false;
  if (varianteTokens.length > productoTokens.length) return false;

  for (let i = 0; i <= productoTokens.length - varianteTokens.length; i += 1) {
    let matches = true;
    for (let j = 0; j < varianteTokens.length; j += 1) {
      if (productoTokens[i + j] !== varianteTokens[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }

  return false;
}

function composeProductoVariante(productName, variantName) {
  const producto = safeStr(productName);
  const variante = safeStr(variantName);
  if (!producto && !variante) return "";
  if (!producto) return variante;
  if (!variante) return producto;

  if (variantAlreadyIncludedInProduct(producto, variante)) return producto;

  return `${producto} ${variante}`;
}

function getItemDetalleText(item) {
  const raw = item && typeof item === "object" ? item : {};
  const producto = firstFilled(
    raw.stock_producto_nombre,
    raw.producto_base_nombre,
    raw.producto_nombre,
    raw.detalle_nombre,
    raw.nombre,
    raw.descripcion,
    raw.detalle,
    raw.producto
  );
  const value = composeProductoVariante(producto, getItemVariantText(raw));

  return value && value !== "Producto / Servicio" ? value : "";
}

function buildDetalleItemsText(items) {
  const values = (Array.isArray(items) ? items : [])
    .map(getItemDetalleText)
    .filter(Boolean);

  return [...new Set(values)].join(", ");
}

function isResumenProductosText(value) {
  const text = safeStr(value).toUpperCase();
  return text === "SIN PRODUCTOS" || /^\d+\s+PRODUCTO(S)?$/.test(text);
}

function getCantidadProductosPresupuesto(row) {
  const items = Array.isArray(row?.items_detalle)
    ? row.items_detalle
    : Array.isArray(row?.items)
      ? row.items
      : [];
  if (items.length > 0) return items.length;

  const cantidad = Number(row?.cantidad_items ?? row?.cantidadItems ?? row?.productos_count ?? row?.productosCount ?? 0);
  if (Number.isFinite(cantidad) && cantidad > 0) return Math.trunc(cantidad);

  const detalle = safeStr(row?.detalle || row?.descripcion || row?.concepto);
  const match = detalle.toUpperCase().match(/^(\d+)\s+PRODUCTO(S)?$/);
  if (match) return Number(match[1]);

  const tieneProducto = safeStr(row?.id_stock_producto || row?.stock_producto_nombre || row?.producto_nombre);
  if (tieneProducto) return 1;

  return 0;
}

function getResumenPresupuesto(row) {
  return detalleProductosLabel(getCantidadProductosPresupuesto(row));
}

function getDetallePresupuesto(row) {
  const itemsText = buildDetalleItemsText(row?.items_detalle || row?.items);
  if (itemsText) return itemsText;

  const original = safeStr(row?.detalle_original || row?.descripcion_original || row?.concepto_original);
  if (original && !isResumenProductosText(original)) return original;

  const detalle = safeStr(row?.detalle || row?.descripcion || row?.concepto);
  if (detalle && !isResumenProductosText(detalle) && detalle !== "Producto / Servicio") return detalle;

  return getResumenPresupuesto(row);
}

function normalizePresupuestoItemForModal(it, idx = 0, idMovimiento = null) {
  const raw = it && typeof it === "object" ? it : {};
  const nombre =
    safeStr(raw.descripcion) ||
    safeStr(raw.detalle) ||
    safeStr(raw.detalle_nombre) ||
    safeStr(raw.producto_nombre) ||
    safeStr(raw.stock_producto_nombre) ||
    safeStr(raw.nombre) ||
    "Producto / Servicio";

  return {
    ...raw,
    id_item: raw.id_item ?? raw.id ?? idx + 1,
    id_movimiento: raw.id_movimiento ?? idMovimiento ?? null,
    id_detalle: raw.id_detalle ?? null,
    id_stock_producto: raw.id_stock_producto ?? null,
    producto_nombre: nombre,
    stock_producto_nombre: safeStr(raw.stock_producto_nombre || raw.producto_nombre || ""),
    detalle_nombre: safeStr(raw.detalle_nombre || raw.descripcion || raw.detalle || nombre),
    descripcion: safeStr(raw.descripcion || raw.detalle || nombre),
    cantidad: Number(raw.cantidad ?? 0) || 0,
    precio: Number(raw.precio ?? raw.precio_unitario ?? 0) || 0,
    precio_unitario: Number(raw.precio_unitario ?? raw.precio ?? 0) || 0,
    iva_pct: Number(raw.iva_pct ?? raw.ivaPct ?? 0) || 0,
    subtotal: Number(raw.subtotal ?? 0) || 0,
    iva_monto: Number(raw.iva_monto ?? raw.ivaMonto ?? 0) || 0,
    total: Number(raw.total ?? 0) || 0,
  };
}

function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: safeText(formatFechaDMY(r?.fecha)),
    DESCRIPCION: safeText(getDetallePresupuesto(r)),
    CLIENTE: safeText(r?.cliente ?? r?.cliente_nombre),
    ESTADO: r?.convertido_a_venta ? "CONVERTIDO EN VENTA" : "PRESUPUESTO",
    TOTAL: Number(r?.monto_total ?? r?.total ?? 0) || 0,
  }));
}

function slugifySheetName(name) {
  const s = String(name || "Documentos").replace(/[\[\]\*\/\\\?\:]/g, " ").replace(/\s+/g, " ").trim();
  return (s || "Documentos").slice(0, 31);
}

function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function getAuthInfo() {
  const token = (localStorage.getItem("token") || localStorage.getItem("auth_token") || "").trim();
  const sessionKey = (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") ||
    localStorage.getItem("X-Session") ||
    ""
  ).trim();

  let idUsuario = 0;
  let idUsuarioMaster = 0;

  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const candMaster = u?.idUsuarioMaster ?? u?.id_usuario_master ?? 0;
    const candUser = u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? candMaster ?? 0;

    if (Number.isFinite(Number(candMaster)) && Number(candMaster) > 0) idUsuarioMaster = Number(candMaster);
    if (Number.isFinite(Number(candUser)) && Number(candUser) > 0) idUsuario = Number(candUser);
    if (!idUsuario && idUsuarioMaster) idUsuario = idUsuarioMaster;
    if (!idUsuarioMaster && idUsuario) idUsuarioMaster = idUsuario;
  } catch {}

  return { token, sessionKey, idUsuario, idUsuarioMaster };
}

function getAuditUserPayload() {
  const { idUsuario, idUsuarioMaster } = getAuthInfo();
  return {
    idUsuario,
    idUsuarioMaster,
    id_usuario: idUsuario,
    id_usuario_master: idUsuarioMaster,
  };
}

function normalizeConfigFacturacionPdf(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const razon = safeStr(c.razon_social || c.nombre_fantasia || c.nombre || "BALTO");
  const domicilio = safeStr(c.domicilio_comercial || c.domicilio || c.domicilio_fiscal || "");
  const condicionIva = safeStr(c.condicion_iva || c.cond_iva || "");
  const inicio = safeStr(c.fecha_inicio_actividades || c.inicio_actividades || "");

  return {
    raw: c,
    emisor_nombre: razon,
    emisor_domicilio: domicilio,
    cuit_emisor: safeStr(c.cuit || ""),
    cond_iva_emisor: condicionIva,
    ingresos_brutos_emisor: safeStr(c.ingresos_brutos || ""),
    fecha_inicio_actividades_emisor: inicio,
    logo_url: safeStr(c.logo_url || ""),
    emisor: {
      razon_social: razon,
      nombre_fantasia: safeStr(c.nombre_fantasia || ""),
      domicilio_comercial: domicilio,
      domicilio,
      cuit: safeStr(c.cuit || ""),
      condicion_iva: condicionIva,
      cond_iva: condicionIva,
      ingresos_brutos: safeStr(c.ingresos_brutos || ""),
      fecha_inicio_actividades: inicio,
      inicio_actividades: inicio,
      punto_venta: safeStr(c.punto_venta || ""),
      tipo_comprobante_default: safeStr(c.tipo_comprobante_default || ""),
      codigo_comprobante: safeStr(c.codigo_comprobante || ""),
      logo_url: safeStr(c.logo_url || ""),
    },
  };
}

function normalizeClienteFiscalPdf(fiscalSource, clienteSource = {}, nombreFallback = "Cliente") {
  const fiscal = fiscalSource && typeof fiscalSource === "object" ? fiscalSource : {};
  const cliente = clienteSource && typeof clienteSource === "object" ? clienteSource : {};
  const nombre =
    safeStr(fiscal.razon_social) ||
    safeStr(cliente.razon_social) ||
    safeStr(cliente.nombre) ||
    safeStr(nombreFallback) ||
    "Cliente";
  const docNro = safeStr(fiscal.doc_nro || fiscal.cuit || cliente.doc_nro || cliente.cuit || cliente.dni || "");
  const cuit = safeStr(fiscal.cuit || cliente.cuit || (String(fiscal.doc_tipo || "") === "80" ? docNro : ""));
  const condicion = safeStr(fiscal.condicion_iva || fiscal.cond_iva || cliente.condicion_iva || cliente.cond_iva || "");
  const domicilio = safeStr(fiscal.domicilio || cliente.domicilio || cliente.direccion || "");

  return {
    id_cliente_fiscal: Number(fiscal.id_cliente_fiscal || 0) || null,
    id_cliente: Number(fiscal.id_cliente || cliente.id_cliente || 0) || null,
    doc_tipo: Number(fiscal.doc_tipo || (cuit ? 80 : 99)) || 99,
    doc_nro: docNro,
    cuit,
    razon_social: nombre,
    cond_iva: condicion,
    condicion_iva: condicion,
    domicilio,
    origen: safeStr(fiscal.origen || (fiscal.id_cliente_fiscal ? "clientes_fiscales" : "cliente")),
  };
}

function buildItemsFacturacionFromPresupuesto(items) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => Number(it?.total ?? 0) > 0 || Number(it?.cantidad ?? 0) > 0)
    .map((it, idx) => ({
      id: it?.id_item ?? it?.id ?? idx + 1,
      id_detalle: null,
      id_stock_producto: Number(it?.id_stock_producto || 0) || null,
      codigo: safeStr(it?.codigo || it?.sku || idx + 1),
      descripcion: safeStr(it?.descripcion || it?.detalle || it?.detalle_nombre || it?.producto_nombre || it?.nombre || "Producto / Servicio"),
      cantidad: Number(it?.cantidad || 0),
      unidad: "u",
      precio_unitario: Number(it?.precio ?? it?.precio_unitario ?? 0),
      precio: Number(it?.precio ?? it?.precio_unitario ?? 0),
      bonif_pct: 0,
      impBonif: 0,
      subtotal: Number(it?.subtotal ?? 0),
      ars: Number(it?.total ?? 0),
      iva_pct: Number(it?.iva_pct ?? 0),
      iva_monto: Number(it?.iva_monto ?? 0),
      total: Number(it?.total ?? 0),
    }));
}

function documentLabel(tipo) {
  const t = safeStr(tipo).toUpperCase();
  if (t === "PRESUPUESTO") return "Presupuesto";
  if (t === "REMITO") return "Remito";
  if (t === "VENTA_NO_FACTURADA") return "Factura no emitida";
  if (t === "FACTURA") return "Factura emitida";
  if (t === "NOTA_CREDITO") return "Nota de crédito";
  if (t === "NOTA_DEBITO") return "Nota de débito";
  return safeText(tipo || "Comprobante");
}

export default function Presupuestos() {
  const API = DOCUMENTOS_API;
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();
  const { lists: listasCtx, loadingLists, error: errorLists, ensureListsLoaded } = useListas();
  const { dateRange, setDateRange } = useDateRange();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const { toast, showToast, closeToast } = useDocumentosToast();
  const [openAdd, setOpenAdd] = useState(false);
  const [openModels, setOpenModels] = useState(false);
  const [selectedModelForNew, setSelectedModelForNew] = useState(null);
  const [openDel, setOpenDel] = useState(false);
  const [openConvert, setOpenConvert] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [showCalendario, setShowCalendario] = useState(false);
  const [openVerComprobante, setOpenVerComprobante] = useState(false);
  const [comprobanteUrl, setComprobanteUrl] = useState("");
  const [comprobanteMime, setComprobanteMime] = useState("application/pdf");
  const [comprobanteTitle, setComprobanteTitle] = useState("Comprobante");
  const [openDetalleMovimiento, setOpenDetalleMovimiento] = useState(false);
  const [loadingDetalleId, setLoadingDetalleId] = useState(null);
  const offsetRef = useRef(0);
  const searchTimerRef = useRef(null);
  const hasLoadedRowsRef = useRef(false);
  const lastQueryRef = useRef("");
  const liveTimerRef = useRef(null);
  const liveTokenRef = useRef("");
  const signedUrlCacheRef = useRef(new Map());
  const cacheRef = useRef(new Map());

  const buildHeadersGET = useCallback(() => {
    const { token, sessionKey } = getAuthInfo();
    const h = {};
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const buildHeadersPOST = useCallback(() => {
    const { token, sessionKey } = getAuthInfo();
    const h = { "Content-Type": "application/json" };
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const buildHeadersForm = useCallback(() => {
    const { token, sessionKey } = getAuthInfo();
    const h = {};
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const parseJsonOrThrow = useCallback(async (res) => {
    const text = await res.text();
    if (!text) throw new Error("Respuesta vacía del servidor.");
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.length > 600 ? `${text.slice(0, 600)}...` : text;
      throw new Error(`Respuesta inválida. HTTP ${res.status}\n${preview}`);
    }
    if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
    return data;
  }, []);

  const apiGet = useCallback(async (url) => {
    const res = await documentosRequest(url, { method: "GET", headers: buildHeadersGET() });
    return await parseJsonOrThrow(res);
  }, [buildHeadersGET, parseJsonOrThrow]);

  const apiPostJson = useCallback(async (url, payload) => {
    const res = await documentosRequest(url, { method: "POST", headers: buildHeadersPOST(), body: JSON.stringify(payload ?? {}) });
    return await parseJsonOrThrow(res);
  }, [buildHeadersPOST, parseJsonOrThrow]);

  const getComprobanteSignedUrl = useCallback(async (idComprobante) => {
    const id = Number(idComprobante || 0);
    if (!id) return "";
    const key = String(id);
    if (signedUrlCacheRef.current.has(key)) return signedUrlCacheRef.current.get(key) || "";
    const data = await apiGet(`${API}?action=ventas_comprobantes_descargar&id_comprobante=${encodeURIComponent(id)}`);
    const url = String(data?.url || data?.download_url || data?.archivo_url || "").trim();
    if (url) signedUrlCacheRef.current.set(key, url);
    return url;
  }, [API, apiGet]);

  const normalizePresupuestoRow = useCallback((r) => {
    const idMov = getMovimientoId(r);
    const cantidadItems = Number(r?.cantidad_items ?? r?.items_detalle?.length ?? 0) || 0;
    const detalleOriginal = String(r?.detalle_original ?? r?.descripcion_original ?? r?.concepto_original ?? r?.detalle ?? r?.descripcion ?? r?.concepto ?? "").trim();
    const ventaGenerada = r?.venta_generada || r?.venta || null;
    const mediosVenta = Array.isArray(r?.venta_medios_pago_detalle)
      ? r.venta_medios_pago_detalle
      : Array.isArray(ventaGenerada?.medios_pago_detalle)
        ? ventaGenerada.medios_pago_detalle
        : Array.isArray(r?.medios_pago_detalle)
          ? r.medios_pago_detalle
          : [];
    const medioPagoNombre = safeStr(r?.venta_medio_pago_nombre || ventaGenerada?.medio_pago_nombre || r?.medio_pago_nombre || "—");

    return {
      ...r,
      id_movimiento: idMov,
      id_cliente: getClienteId(r),
      cliente: String(r?.cliente ?? r?.cliente_nombre ?? "").trim(),
      detalle_original: detalleOriginal,
      detalle: detalleOriginal && !isResumenProductosText(detalleOriginal) ? detalleOriginal : detalleProductosLabel(cantidadItems),
      cantidad_items: cantidadItems,
      items_detalle: Array.isArray(r?.items_detalle)
        ? r.items_detalle.map((it, idx) => normalizePresupuestoItemForModal(it, idx, idMov))
        : [],
      cantidad_medios_pago: mediosVenta.length || Number(r?.venta_cantidad_medios_pago ?? r?.cantidad_medios_pago ?? 0) || 0,
      medios_pago_detalle: mediosVenta,
      medio_pago_nombre: medioPagoNombre,
      tipo_operacion_nombre: "PRESUPUESTO",
      monto_total: Number(r?.monto_total ?? r?.total ?? 0) || 0,
      presupuesto_id_comprobante: getComprobanteId(r),
      presupuesto_comprobante_url: String(r?.presupuesto_comprobante_url ?? r?.comprobante_url ?? "").trim(),
      presupuesto_comprobante_mime: getComprobanteMime(r),
      convertido_a_venta: Number(r?.convertido_a_venta ?? r?.convertido ?? 0) === 1,
      id_venta_generada: Number(r?.id_venta_generada ?? r?.id_venta ?? ventaGenerada?.id_venta ?? ventaGenerada?.id_movimiento ?? 0) || null,
      fecha_conversion: String(r?.fecha_conversion ?? "").trim(),
      venta_generada: ventaGenerada,
      venta_fecha: safeStr(r?.venta_fecha || ventaGenerada?.fecha || ""),
      venta_id_tipo_venta: Number(r?.venta_id_tipo_venta ?? ventaGenerada?.id_tipo_venta ?? 0) || null,
      venta_tipo_venta_nombre: safeStr(r?.venta_tipo_venta_nombre || ventaGenerada?.tipo_venta_nombre || ""),
      venta_medio_pago_nombre: medioPagoNombre,
      venta_medios_pago_detalle: mediosVenta,
    };
  }, []);

  const fetchLiveToken = useCallback(async (from, to, query) => {
    const p = new URLSearchParams({ action: "presupuestos_live_token" });
    if (from) p.set("fecha_desde", dateToAPI(from));
    if (to) p.set("fecha_hasta", dateToAPI(to));
    if (query) p.set("q", query);
    const data = await apiGet(`${API}?${p.toString()}`);
    return String(data?.token || "");
  }, [API, apiGet]);

  const loadRows = useCallback(async ({ from = dateRange.from, to = dateRange.to, query = q, offset = 0, append = false, bypassCache = false } = {}) => {
    const fromAPI = dateToAPI(from);
    const toAPI = dateToAPI(to);
    const qKey = String(query || "").trim();
    const cacheKey = `${fromAPI}|${toAPI}|${qKey}`;

    if (!bypassCache && !append && offset === 0 && !cacheRef.current.has(cacheKey)) {
      const persisted = readMovPerfCache(PRESUPUESTOS_CACHE_NS, cacheKey);
      if (persisted?.rows) cacheRef.current.set(cacheKey, persisted);
    }

    if (!bypassCache && !append && offset === 0 && cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey);
      const cachedRows = Array.isArray(cached?.rows) ? cached.rows : [];
      setRows(cachedRows);
      setHasMore(!!cached?.hasMore);
      offsetRef.current = Number(cached?.nextOffset || cachedRows.length || 0);
      setLoadingRows(false);
      setLoadingMore(false);
      return { hasMore: !!cached?.hasMore, received: cachedRows.length };
    }

    append ? setLoadingMore(true) : setLoadingRows(true);
    setError("");
    try {
      const p = new URLSearchParams({
        action: "presupuestos_listar",
        limit: String(PROBE_LIMIT),
        offset: String(offset),
      });
      if (from) p.set("fecha_desde", fromAPI);
      if (to) p.set("fecha_hasta", toAPI);
      if (query) p.set("q", query);
      const data = await apiGet(`${API}?${p.toString()}`);
      const arr = Array.isArray(data?.presupuestos) ? data.presupuestos : Array.isArray(data?.movimientos) ? data.movimientos : [];
      const normalized = arr.slice(0, PAGE_SIZE).map(normalizePresupuestoRow);
      const newHasMore = arr.length > PAGE_SIZE || !!data?.has_more;
      setHasMore(newHasMore);
      offsetRef.current = offset + normalized.length;
      setRows((prev) => {
        const nextRows = append ? [...prev, ...normalized] : normalized;
        if (!append && offset === 0) {
          const cachePayload = { rows: nextRows, hasMore: newHasMore, nextOffset: offsetRef.current };
          cacheRef.current.set(cacheKey, cachePayload);
          writeMovPerfCache(PRESUPUESTOS_CACHE_NS, cacheKey, cachePayload);
        }
        return nextRows;
      });
    } catch (e) {
      setError(e?.message || "No se pudieron cargar los presupuestos.");
    } finally {
      setLoadingRows(false);
      setLoadingMore(false);
    }
  }, [API, apiGet, dateRange.from, dateRange.to, normalizePresupuestoRow, q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureListsLoaded?.({ force: false, background: true });
      } catch {}
      if (!alive) return;
      PRESUPUESTOS_CACHE_OLD_NS.forEach((scope) => clearMovPerfCache(scope));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    const queryChanged = hasLoadedRowsRef.current && q !== lastQueryRef.current;
    const delay = queryChanged ? 300 : 0;

    searchTimerRef.current = setTimeout(async () => {
      await loadRows({ from: dateRange.from, to: dateRange.to, query: q, offset: 0, append: false, bypassCache: true });
      hasLoadedRowsRef.current = true;
      lastQueryRef.current = q;
      try { liveTokenRef.current = await fetchLiveToken(dateRange.from, dateRange.to, q); } catch {}
    }, delay);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [q, dateRange.from, dateRange.to, fetchLiveToken, loadRows]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || loadingRows || loadingMore) return;
      try {
        const token = await fetchLiveToken(dateRange.from, dateRange.to, q);
        if (!cancelled && token && liveTokenRef.current && token !== liveTokenRef.current) {
          liveTokenRef.current = token;
          await loadRows({ from: dateRange.from, to: dateRange.to, query: q, offset: 0, append: false, bypassCache: true });
        } else if (!cancelled && token && !liveTokenRef.current) {
          liveTokenRef.current = token;
        }
      } catch {}
    };
    liveTimerRef.current = setInterval(tick, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [dateRange.from, dateRange.to, fetchLiveToken, loadRows, loadingMore, loadingRows, q]);

  const handleDateRangeChange = useCallback((newRange) => {
    cacheRef.current.clear();
    clearMovPerfCache(PRESUPUESTOS_CACHE_NS);
    setDateRange(newRange);
  }, [setDateRange]);

  const reloadVista = useCallback(async () => {
    cacheRef.current.clear();
    clearMovPerfCache(PRESUPUESTOS_CACHE_NS);
    signedUrlCacheRef.current.clear();
    await loadRows({ from: dateRange.from, to: dateRange.to, query: q, offset: 0, append: false, bypassCache: true });
    try { liveTokenRef.current = await fetchLiveToken(dateRange.from, dateRange.to, q); } catch {}
  }, [dateRange.from, dateRange.to, fetchLiveToken, loadRows, q]);

  const handleLoadMore = useCallback(async () => {
    await loadRows({ from: dateRange.from, to: dateRange.to, query: q, offset: offsetRef.current, append: true });
  }, [dateRange.from, dateRange.to, loadRows, q]);

  const handleOpenNuevoPresupuesto = useCallback((event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    setSelectedModelForNew(null);
    setOpenAdd(true);
  }, []);

  const fetchPresupuestoDetalle = useCallback(async (idMovimiento) => {
    const data = await apiGet(`${API}?action=presupuestos_obtener&id_movimiento=${encodeURIComponent(idMovimiento)}`);
    return {
      presupuesto: data?.presupuesto || data?.movimiento || null,
      items: Array.isArray(data?.items) ? data.items : [],
      conversion: data?.conversion || null,
      venta_generada: data?.venta_generada || data?.venta || null,
      venta: data?.venta || data?.venta_generada || null,
      cantidad_medios_pago: Number(data?.cantidad_medios_pago ?? 0) || 0,
      medios_pago_detalle: Array.isArray(data?.medios_pago_detalle) ? data.medios_pago_detalle : [],
      medio_pago_nombre: safeStr(data?.medio_pago_nombre || "—"),
    };
  }, [API, apiGet]);

  const buildDetallePresupuestoRow = useCallback((row, detalle = null) => {
    const base = row && typeof row === "object" ? row : {};
    const mov = detalle?.presupuesto && typeof detalle.presupuesto === "object" ? detalle.presupuesto : {};
    const idMov = getMovimientoId(base) || getMovimientoId(mov);
    const rawItems = Array.isArray(detalle?.items) && detalle.items.length
      ? detalle.items
      : Array.isArray(base.items_detalle)
        ? base.items_detalle
        : [];
    const items = rawItems.map((it, idx) => normalizePresupuestoItemForModal(it, idx, idMov));
    const conversion = detalle?.conversion && typeof detalle.conversion === "object" ? detalle.conversion : null;
    const ventaGenerada = detalle?.venta_generada || detalle?.venta || base.venta_generada || base.venta || null;
    const mediosVenta = Array.isArray(detalle?.medios_pago_detalle) && detalle.medios_pago_detalle.length
      ? detalle.medios_pago_detalle
      : Array.isArray(ventaGenerada?.medios_pago_detalle)
        ? ventaGenerada.medios_pago_detalle
        : Array.isArray(base.venta_medios_pago_detalle)
          ? base.venta_medios_pago_detalle
          : Array.isArray(base.medios_pago_detalle)
            ? base.medios_pago_detalle
            : [];
    const medioPagoVenta = safeStr(detalle?.medio_pago_nombre || ventaGenerada?.medio_pago_nombre || base.venta_medio_pago_nombre || base.medio_pago_nombre || "—");
    const condicionesPresupuesto =
      (mov.condiciones_presupuesto && typeof mov.condiciones_presupuesto === "object" ? mov.condiciones_presupuesto : null) ||
      (detalle?.condiciones_presupuesto && typeof detalle.condiciones_presupuesto === "object" ? detalle.condiciones_presupuesto : null) ||
      (base.condiciones_presupuesto && typeof base.condiciones_presupuesto === "object" ? base.condiciones_presupuesto : null) ||
      {};
    const convertido = !!(base.convertido_a_venta || conversion?.id_venta || ventaGenerada?.id_venta || ventaGenerada?.id_movimiento);

    return {
      ...base,
      ...mov,
      id_movimiento: idMov,
      id_cliente: getClienteId(base) || getClienteId(mov),
      fecha: mov.fecha || base.fecha,
      cliente: safeStr(base.cliente || mov.cliente || base.cliente_nombre || mov.cliente_nombre),
      detalle: detalleProductosLabel(items.length || base.cantidad_items || 0),
      detalle_original: safeStr(base.detalle_original || mov.detalle_original || buildDetalleItemsText(items)),
      tipo_operacion_nombre: "PRESUPUESTO",
      operacion: "PRESUPUESTO",
      documento_tipo: "PRESUPUESTO",
      clasificacion: "Presupuesto",
      estado: convertido ? "CONVERTIDO EN VENTA" : "PRESUPUESTO",
      estado_documento: convertido ? "CONVERTIDO EN VENTA" : "PRESUPUESTO",
      cantidad_items: items.length || Number(base.cantidad_items || 0) || 0,
      items_detalle: items,
      cantidad_medios_pago: mediosVenta.length || Number(detalle?.cantidad_medios_pago ?? base.cantidad_medios_pago ?? 0) || 0,
      medios_pago_detalle: mediosVenta,
      medio_pago_nombre: medioPagoVenta,
      monto_total: Number(mov.monto_total ?? base.monto_total ?? base.total ?? 0) || 0,
      total: Number(mov.monto_total ?? base.monto_total ?? base.total ?? 0) || 0,
      convertido_a_venta: convertido,
      id_venta_generada: Number(conversion?.id_venta ?? base.id_venta_generada ?? ventaGenerada?.id_venta ?? ventaGenerada?.id_movimiento ?? 0) || null,
      fecha_conversion: safeStr(conversion?.fecha_conversion || base.fecha_conversion || ""),
      venta_generada: ventaGenerada,
      venta_fecha: safeStr(ventaGenerada?.fecha || base.venta_fecha || ""),
      venta_tipo_venta_nombre: safeStr(ventaGenerada?.tipo_venta_nombre || base.venta_tipo_venta_nombre || ""),
      venta_medio_pago_nombre: medioPagoVenta,
      venta_medios_pago_detalle: mediosVenta,
      condiciones_presupuesto: condicionesPresupuesto,
      validez_dias: condicionesPresupuesto.validez_dias ?? mov.validez_dias ?? base.validez_dias ?? null,
      fecha_validez: safeStr(condicionesPresupuesto.fecha_validez || mov.fecha_validez || base.fecha_validez || ""),
      plazo_entrega: safeStr(condicionesPresupuesto.plazo_entrega || mov.plazo_entrega || base.plazo_entrega || ""),
      forma_pago: safeStr(condicionesPresupuesto.forma_pago || mov.forma_pago || base.forma_pago || ""),
      condiciones_comerciales: safeStr(condicionesPresupuesto.condiciones_comerciales || mov.condiciones_comerciales || base.condiciones_comerciales || ""),
      notas: safeStr(condicionesPresupuesto.notas || mov.notas || base.notas || ""),
      garantia: safeStr(condicionesPresupuesto.garantia || mov.garantia || base.garantia || ""),
      lugar_entrega: safeStr(condicionesPresupuesto.lugar_entrega || mov.lugar_entrega || base.lugar_entrega || ""),
    };
  }, []);

  const handleVerDetallePresupuesto = useCallback(async (row) => {
    const id = getMovimientoId(row);
    if (!id) {
      setSelectedRow(buildDetallePresupuestoRow(row));
      setOpenDetalleMovimiento(true);
      return;
    }

    const convertido = !!(row?.convertido_a_venta || row?.id_venta_generada || row?.venta_generada?.id_venta || row?.venta_generada?.id_movimiento);
    if (!convertido && Array.isArray(row?.items_detalle) && row.items_detalle.length > 0) {
      setSelectedRow(buildDetallePresupuestoRow(row));
      setOpenDetalleMovimiento(true);
      return;
    }

    setLoadingDetalleId(id);
    try {
      const detalle = await fetchPresupuestoDetalle(id);
      setSelectedRow(buildDetallePresupuestoRow(row, detalle));
      setOpenDetalleMovimiento(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo cargar el detalle del presupuesto.", 4200);
    } finally {
      setLoadingDetalleId(null);
    }
  }, [buildDetallePresupuestoRow, fetchPresupuestoDetalle, showToast]);

  const fetchConfigFacturacion = useCallback(async () => {
    try {
      const data = await apiGet(`${API}?action=config_facturacion_get`);
      return data?.config || data?.data || data?.config_facturacion || data || null;
    } catch {
      return null;
    }
  }, [API, apiGet]);

  const fetchClienteFiscal = useCallback(async (idCliente) => {
    const id = Number(idCliente || 0);
    if (!id) return null;
    try {
      const data = await apiGet(`${API}?action=cliente_fiscal_get&id_cliente=${encodeURIComponent(id)}`);
      return data?.cliente_fiscal || data?.data || null;
    } catch {
      return null;
    }
  }, [API, apiGet]);

  const buildVentaPdfPayloadFromPresupuesto = useCallback(({ row, detalle, idVenta, cfg, fiscal }) => {
    const movimiento = detalle?.presupuesto || row || {};
    const items = buildItemsFacturacionFromPresupuesto(detalle?.items || []);
    const emisorPdf = normalizeConfigFacturacionPdf(cfg || {});
    const clienteSource = {
      id_cliente: getClienteId(row) || getClienteId(movimiento),
      nombre: row?.cliente || movimiento?.cliente || "Cliente",
    };
    const clienteFiscalPdf = normalizeClienteFiscalPdf(fiscal || {}, clienteSource, row?.cliente || movimiento?.cliente || "Cliente");
    const total = Number(movimiento?.monto_total ?? row?.monto_total ?? 0) || items.reduce((acc, it) => acc + Number(it.total || 0), 0);
    const fechaCbte = String(movimiento?.fecha || row?.fecha || todayISO()).slice(0, 10);

    return {
      id_pago: null,
      id_sistema: null,
      labelCliente: clienteFiscalPdf.razon_social || row?.cliente || "Cliente",
      labelSistema: `Venta desde presupuesto #${row?.id_movimiento || movimiento?.id_movimiento || ""}`.trim(),
      cliente_facturacion: clienteFiscalPdf,
      config_facturacion: cfg || {},
      ...emisorPdf,
      id_cliente: clienteFiscalPdf.id_cliente || getClienteId(row) || null,
      id_tipo_venta: null,
      tipo_venta_nombre: "Cuenta corriente",
      id_medio_pago: null,
      id_clasificacion: null,
      fecha_cbte_iso: fechaCbte,
      vto_pago_iso: plusDaysISOFrom(fechaCbte, 10),
      cbte_tipo: null,
      pto_vta: null,
      items_facturacion: items,
      medios_pago: [],
      total_ars: total,
      monto: total,
      importe: total,
      ids_movimiento: [Number(idVenta)].filter((x) => Number.isFinite(x) && x > 0),
      id_presupuesto_origen: row?.id_movimiento || movimiento?.id_movimiento || null,
      observaciones:
        "Comprobante interno generado automáticamente desde un presupuesto asignado como venta. Sin CAE, sin QR fiscal y sin validez fiscal.",
      emisor: emisorPdf.emisor,
    };
  }, []);

  const subirPdfDocumento = useCallback(async ({ tipo, idMovimiento, blob, filename, meta }) => {
    if (!idMovimiento || !blob) throw new Error(`Faltan datos para subir ${documentLabel(tipo).toLowerCase()}.`);
    const fd = new FormData();
    fd.append("tipo", tipo);
    fd.append("id_movimiento", String(idMovimiento));
    const auditUser = getAuditUserPayload();
    fd.append("idUsuario", String(auditUser.idUsuario || 0));
    fd.append("idUsuarioMaster", String(auditUser.idUsuarioMaster || 0));
    if (Array.isArray(meta?.ids_movimiento) && meta.ids_movimiento.length) {
      fd.append("ids_movimiento", JSON.stringify(meta.ids_movimiento));
    }
    fd.append("pdf", blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }), filename || `${String(tipo || "comprobante").toLowerCase()}.pdf`);
    fd.append("meta", JSON.stringify({
      tipo,
      estado: String(tipo || "").toLowerCase(),
      emitido_en_arca: 0,
      id_pago: meta?.id_pago ?? null,
      id_sistema: meta?.id_sistema ?? null,
      id_cliente: meta?.id_cliente ?? null,
      ids_movimiento: Array.isArray(meta?.ids_movimiento) ? meta.ids_movimiento : [],
      monto_ars: Number(meta?.total_ars ?? meta?.importe ?? 0),
      fecha_cbte: meta?.fecha_cbte_iso ?? null,
      razon_social: meta?.cliente_facturacion?.razon_social || meta?.labelCliente || null,
      cond_iva: meta?.cliente_facturacion?.cond_iva || meta?.cliente_facturacion?.condicion_iva || null,
      domicilio: meta?.cliente_facturacion?.domicilio || null,
      cliente_facturacion: meta?.cliente_facturacion || null,
      emisor: meta?.emisor || null,
      config_facturacion: meta?.config_facturacion || null,
      resultado: "P",
      json_arca: null,
      resumen_facturacion: {
        ...meta,
        tipo,
        items_facturacion: Array.isArray(meta?.items_facturacion) ? meta.items_facturacion : [],
      },
    }));

    const res = await documentosRequest(`${API}?action=ventas_comprobantes_vincular_movimiento`, {
      method: "POST",
      headers: buildHeadersForm(),
      body: fd,
    });
    const data = await parseJsonOrThrow(res);
    if (!data?.exito) throw new Error(data?.mensaje || `No se pudo subir ${documentLabel(tipo).toLowerCase()}.`);
    return data;
  }, [API, buildHeadersForm, parseJsonOrThrow]);

  const generarDocumentosVentaDesdePresupuesto = useCallback(async ({ row, idVenta }) => {
    const idPresupuesto = getMovimientoId(row);
    if (!idPresupuesto || !idVenta) return;
    const [detalle, cfg, fiscal] = await Promise.all([
      fetchPresupuestoDetalle(idPresupuesto),
      fetchConfigFacturacion(),
      fetchClienteFiscal(row?.id_cliente),
    ]);
    const ventaMeta = buildVentaPdfPayloadFromPresupuesto({ row, detalle, idVenta, cfg, fiscal });

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
      observaciones_remito:
        "Remito generado automáticamente desde un presupuesto asignado como venta. Lista de productos sin precios ni importes.",
    };
    const remitoPdf = await saveRemitoPdf({ data: remitoMeta, download: false });
    await subirPdfDocumento({
      tipo: "REMITO",
      idMovimiento: idVenta,
      blob: remitoPdf?.blob,
      filename: remitoPdf?.filename,
      meta: remitoMeta,
    });
  }, [buildVentaPdfPayloadFromPresupuesto, fetchClienteFiscal, fetchConfigFacturacion, fetchPresupuestoDetalle, subirPdfDocumento]);

  const marcarPresupuestoConvertido = useCallback((idPresupuesto, idVenta, fechaConversion = "") => {
    const idP = Number(idPresupuesto || 0);
    const idV = Number(idVenta || 0);
    if (!idP || !idV) return;
    setRows((prev) =>
      prev.map((r) =>
        Number(r?.id_movimiento || 0) === idP
          ? {
              ...r,
              convertido_a_venta: true,
              id_venta_generada: idV,
              fecha_conversion: fechaConversion || r?.fecha_conversion || new Date().toISOString().slice(0, 19).replace("T", " "),
            }
          : r
      )
    );
  }, []);

  const handleVerComprobante = useCallback(async (row, overrideTitle = "Presupuesto") => {
    const id = getComprobanteId(row);
    if (!id) {
      showToast("error", "Este documento todavía no tiene PDF vinculado.", 3500);
      return;
    }
    try {
      const url = await getComprobanteSignedUrl(id);
      if (!url) throw new Error("No se pudo obtener la URL del comprobante.");
      setComprobanteUrl(url);
      setComprobanteMime(getComprobanteMime(row) || "application/pdf");
      setComprobanteTitle(overrideTitle || documentLabel(row?.tipo) || "Comprobante");
      setOpenVerComprobante(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo abrir el comprobante.", 4500);
    }
  }, [getComprobanteSignedUrl, showToast]);

  const confirmConvertirVenta = useCallback(async () => {
    const id = getMovimientoId(selectedRow);
    if (!id) return;

    if (selectedRow?.convertido_a_venta) {
      showToast("advertencia", "Este presupuesto ya fue asignado como venta anteriormente.", 4200);
      setOpenConvert(false);
      setSelectedRow(null);
      return;
    }

    setConvertingId(id);
    try {
      const data = await apiPostJson(`${API}?action=presupuestos_convertir_venta`, {
        id_presupuesto: id,
        fecha: todayISO(),
        ...getAuditUserPayload(),
      });
      const idVenta = Number(data?.id_venta ?? data?.id_movimiento_venta ?? data?.id_movimiento ?? data?.conversion?.id_venta ?? 0);
      if (!idVenta) throw new Error("El backend creó la venta pero no devolvió el ID de movimiento.");

      marcarPresupuestoConvertido(id, idVenta, data?.conversion?.fecha_conversion || "");

      try {
        await generarDocumentosVentaDesdePresupuesto({ row: selectedRow, idVenta });
        showToast("exito", "Presupuesto asignado como venta correctamente. Se generaron los documentos correspondientes.", 5200);
      } catch (pdfError) {
        showToast("advertencia", `El presupuesto fue asignado como venta, pero faltó generar algún documento: ${pdfError?.message || "error desconocido"}`, 7000);
      }

      setOpenConvert(false);
      setSelectedRow(null);
      await reloadVista();
    } catch (e) {
      showToast("error", e?.message || "No se pudo asignar el presupuesto como venta.", 5200);
    } finally {
      setConvertingId(null);
    }
  }, [API, apiPostJson, generarDocumentosVentaDesdePresupuesto, marcarPresupuestoConvertido, reloadVista, selectedRow, showToast]);

  const confirmDelete = useCallback(async () => {
    const id = getMovimientoId(selectedRow);
    if (!id) throw new Error("No se pudo identificar el presupuesto seleccionado.");

    if (selectedRow?.convertido_a_venta) {
      throw new Error("Este presupuesto ya fue convertido a venta y debe conservarse como respaldo del proceso.");
    }

    setDeletingId(id);
    try {
      await apiPostJson(`${API}?action=presupuestos_eliminar`, {
        id_movimiento: id,
        ...getAuditUserPayload(),
      });
      setOpenDel(false);
      setSelectedRow(null);
      await reloadVista();
    } finally {
      setDeletingId(null);
    }
  }, [API, apiPostJson, reloadVista, selectedRow]);

  const filteredRows = useMemo(() => {
    const qq = normalizeSearchText(q);
    if (!qq) return rows;
    return rows.filter((r) => normalizeSearchText(Object.values(r).join(" | ")).includes(qq));
  }, [q, rows]);

  const dateRangeLabel = useMemo(() => {
    if (dateRange.from && dateRange.to) return `${formatDateUI(dateRange.from)} - ${formatDateUI(dateRange.to)}`;
    if (dateRange.from) return `Desde ${formatDateUI(dateRange.from)}`;
    if (dateRange.to) return `Hasta ${formatDateUI(dateRange.to)}`;
    return "Todo el período";
  }, [dateRange]);

  const columns = useMemo(() => [
    { key: "fecha", align: "center", label: "Fecha", render: (r) => formatFechaDMY(r.fecha) },
    { key: "detalle", label: "Descripción", render: (r) => safeText(getResumenPresupuesto(r)) },
    { key: "cliente", align: "center", label: "Cliente", render: (r) => safeText(r.cliente) },
    { key: "estado", align: "center", label: "Estado", render: (r) => (r.convertido_a_venta ? "CONVERTIDO EN VENTA" : "PRESUPUESTO") },
    { key: "total", label: "Total", align: "right", strong: true, render: (r) => moneyARS(r.monto_total) },
    { key: "acciones", label: "Acciones", align: "center" },
  ], []);
  const gridCols = "0.85fr 2.05fr 1.35fr 1.15fr 1fr 1fr";

  const exportOptions = useMemo(() => [
    {
      key: "excel",
      label: "Exportar Excel (.xlsx)",
      icon: faFileExcel,
      onClick: () => {
        const exportRows = buildExportRows(filteredRows);
        const ws = XLSX.utils.json_to_sheet(exportRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("Presupuestos"));
        XLSX.writeFile(wb, `presupuestos_${new Date().toISOString().slice(0, 10)}.xlsx`);
      },
    },
    {
      key: "csv",
      label: "Exportar CSV (.csv)",
      onClick: () => {
        const exportRows = buildExportRows(filteredRows);
        const headers = Object.keys(exportRows[0] || { FECHA: "", DESCRIPCION: "", CLIENTE: "", ESTADO: "", TOTAL: "" });
        const csvRows = exportRows.map((row) => headers.map((h) => escapeCSV(row[h])).join(";"));
        const csv = "\uFEFF" + [headers.join(";"), ...csvRows].join("\n");
        downloadBlob(csv, `presupuestos_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
      },
    },
    {
      key: "txt",
      label: "Exportar TXT (.txt)",
      onClick: () => {
        const exportRows = buildExportRows(filteredRows);
        const lines = exportRows.map((row, index) => [
          `REGISTRO ${index + 1}`,
          `FECHA: ${row.FECHA ?? ""}`,
          `DESCRIPCION: ${row.DESCRIPCION ?? ""}`,
          `CLIENTE: ${row.CLIENTE ?? ""}`,
          `ESTADO: ${row.ESTADO ?? ""}`,
          `TOTAL: ${moneyARS(row.TOTAL ?? 0)}`,
          "----------------------------------------",
        ].join("\n"));

        downloadBlob(lines.join("\n"), `presupuestos_${new Date().toISOString().slice(0, 10)}.txt`, "text/plain;charset=utf-8");
      },
    },
  ], [filteredRows]);

  const isAnyLoading = loadingRows || loadingMore;
  const lists = listasCtx || { clientes: [], detalles: [] };
    const renderSkeletonRow = (idx) => (
    <div key={`skel-${idx}`} className="mov-gridTable mov-gridTable--row mov-row--skeleton" style={{ gridTemplateColumns: gridCols }} role="row" aria-hidden="true">
      {columns.map((c) => (
        <div key={c.key} className={["mov-gridCell", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : ""].join(" ")} role="cell" data-label={c.label}>
          {c.key === "acciones" ? <div className="mov-skelActions"><span className="mov-skelIcon" /><span className="mov-skelIcon" /><span className="mov-skelIcon" /></div> : <span className="mov-skeletonBar" style={{ width: ["44%", "62%", "48%", "72%"][idx % 4] }} />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mov-page">
      {toast && <Toast tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={closeToast} />}
      {errorLists && <div className="mov-alert" role="alert">{errorLists}</div>}
      {error && <div className="mov-alert" role="alert">{error}</div>}

      <section className="mov-card mov-card--table doccom-presupuestosTable">
        <div className="mov-card__head  doc-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov doccom-titleBlock">
              <div className="doccom-tabsRow doccom-tabsRow--head">
                <DocumentosTabs activeKey="presupuesto" />
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="cc-filter cc-filter--cal">
                <div className={`cc-floatingField cc-floatingField--calendar is-active ${showCalendario ? "is-open" : ""}`}>
                  <button type="button" className={`cc-calTrigger ${showCalendario ? "is-open" : ""}`} onClick={() => setShowCalendario((v) => !v)} disabled={isAnyLoading || loadingLists} title="Seleccionar rango de fechas">
                    {dateRangeLabel}
                    <span className="cc-calTrigger__iconRight"><FontAwesomeIcon icon={faChevronDown} /></span>
                  </button>
                  <span className="cc-floatingLabel cc-floatingLabel--active"><FontAwesomeIcon icon={faCalendarDays} /> Período</span>
                  {showCalendario && <div className="cc-calDropdown"><Calendario value={dateRange} onChange={async (newRange) => { if (newRange.from && newRange.to) setShowCalendario(false); await handleDateRangeChange(newRange); }} onClose={() => setShowCalendario(false)} /></div>}
                </div>
              </div>

              <div className="cc-filter">
                <div className="cc-floatingField cc-floatingField--search is-active">
                  <div className="cc-searchInput">
                    <div className="cc-searchInput__fieldWrap">
                      <input className="cc-input cc-input--floating" id="presu-docs-search" value={q} onChange={(e) => setQ(String(e.target.value ?? "").toLocaleUpperCase("es-AR"))} placeholder="Buscar por descripción..." disabled={loadingLists} />
                      <span className="cc-floatingLabel"><FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda</span>
                      {q.trim() !== "" && <button type="button" className="cc-clearSearch cc-clearSearch--inside" title="Limpiar búsqueda" onClick={() => setQ("")}><FontAwesomeIcon icon={faTimes} /></button>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mov-card__actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <BotonExportar className="doccom-exportBtn" disabled={loadingRows || filteredRows.length === 0} loading={false} label="Exportar" title={filteredRows.length ? "Exportar archivo" : "No hay datos para exportar"} opciones={exportOptions} align="right" />
            <button type="button" className="mov-btn" onClick={() => setOpenModels(true)} title="Ver y administrar modelos de presupuesto">
              Modelos
            </button>
            <button type="button" className="mov-btn mov-btn--primary" onClick={handleOpenNuevoPresupuesto} title="Crear nuevo presupuesto">
              <FontAwesomeIcon icon={faPlus} /> Nuevo presupuesto
            </button>
          </div>
        </div>

        <div className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`} style={{ gridTemplateColumns: gridCols }} role="row">
          {columns.map((c) => <div key={c.key} className={["mov-gridCell", "mov-gridCell--head", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : ""].join(" ")} role="columnheader">{c.label}</div>)}
        </div>

        <div className="mov-tableWrap" role="rowgroup" ref={tableWrapRef}>
          <div className={["mov-gridBody", "mov-gridBody--relative", loadingRows ? "mov-softLoading" : ""].join(" ")}>
            {loadingRows ? <div className="mov-skeletonWrap" aria-busy="true">{Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}</div> : <>
              {filteredRows.map((r) => {
                const key = `presupuesto-${getMovimientoId(r) || `${r.fecha}-${r.cliente}-${r.monto_total}`}`;
                const idComp = getComprobanteId(r);
                const tieneComprobante = !!idComp;
                const convertido = !!r.convertido_a_venta;
                return (
                  <div key={key} className="mov-gridTable mov-gridTable--row" style={{ gridTemplateColumns: gridCols }} role="row">
                    {columns.map((c) => {
                      if (c.key === "acciones") {
                        return (
                          <div key={c.key} className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label={c.label}>
                            <div className="mov-actionsInline">
                              <button type="button" className={["mov-iconBtn", tieneComprobante ? "mov-iconBtn--comprobante" : "mov-iconBtn--disabled"].join(" ")} title={tieneComprobante ? "Ver presupuesto PDF" : "Sin presupuesto PDF"} disabled={!tieneComprobante || isAnyLoading} onClick={() => handleVerComprobante(r, "Presupuesto")} style={{ opacity: tieneComprobante ? 1 : 0.35, cursor: tieneComprobante ? "pointer" : "not-allowed" }}>
                                <FontAwesomeIcon icon={faEye} />
                              </button>
                              <button type="button" className="mov-iconBtn" title="Ver información completa del presupuesto" disabled={isAnyLoading || loadingLists || loadingDetalleId === r.id_movimiento} onClick={() => handleVerDetallePresupuesto(r)}>
                                {loadingDetalleId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={faInfoCircle} />}
                              </button>
                              <button type="button" className={["mov-iconBtn", "mov-iconBtn--comprobante"].join(" ")} title={convertido ? "Presupuesto ya asignado como venta" : "Asignar presupuesto como venta"} disabled={isAnyLoading || loadingLists || convertingId === r.id_movimiento} onClick={() => { setSelectedRow(r); setOpenConvert(true); }} style={{ opacity: 1, cursor: "pointer" }}>
                                {convertingId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={convertido ? faCheckCircle : faCartShopping} />}
                              </button>
                              <button type="button" className="mov-iconBtn mov-iconBtn--danger" title={convertido ? "No se puede eliminar: ya fue convertido a venta" : "Eliminar"} disabled={isAnyLoading || loadingLists || deletingId === r.id_movimiento || convertido} onClick={() => { setSelectedRow(r); setOpenDel(true); }} style={{ opacity: convertido ? 0.35 : 1, cursor: convertido ? "not-allowed" : "pointer" }}>
                                {deletingId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={faTrashCan} />}
                              </button>
                            </div>
                          </div>
                        );
                      }
                      const val = c.render ? c.render(r) : safeText(r[c.key]);
                      return <div key={c.key} className={["mov-gridCell", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : "", c.strong ? "is-strong" : ""].filter(Boolean).join(" ")} role="cell" data-label={c.label} title={typeof val === "string" ? val : undefined}><span className="mov-ellipsissss">{val}</span></div>;
                    })}
                  </div>
                );
              })}

              {!isAnyLoading && filteredRows.length === 0 && <div className="cc-emptyState"><FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" /><div className="cc-emptyText">{q.trim() ? `No se encontraron documentos para "${q.trim()}".` : "No hay presupuestos para mostrar en el rango de fechas seleccionado."}</div></div>}
              {!loadingRows && hasMore && filteredRows.length > 0 && <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}><button type="button" className="mov-btn mov-btn--loadAll" onClick={handleLoadMore} disabled={loadingMore || loadingLists}>{loadingMore ? "Cargando…" : "Cargar 100 más"}</button></div>}
              {loadingMore && <div className="mov-skeletonMore" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => renderSkeletonRow(i))}</div>}
            </>}
          </div>
        </div>
      </section>

      <ModalNuevoPresupuesto
        open={openAdd}
        lists={lists}
        initialModel={selectedModelForNew}
        modelsOpen={openModels}
        onOpenModels={() => setOpenModels(true)}
        onClose={() => {
          setOpenAdd(false);
          setSelectedModelForNew(null);
        }}
        onToast={showToast}
        onSaved={async () => {
          setOpenAdd(false);
          setSelectedModelForNew(null);
          setQ("");
          await reloadVista();
        }}
      />

      <ModalModelosPresupuesto
        open={openModels}
        lists={lists}
        onClose={() => setOpenModels(false)}
        onToast={showToast}
        onUseModel={(modelo) => {
          setSelectedModelForNew({ ...(modelo || {}) });
          setOpenModels(false);
          setOpenAdd(true);
        }}
      />

      <ModalAsignarPresupuestoVenta
        open={openConvert}
        row={selectedRow}
        lists={lists}
        onToast={showToast}
        onClose={() => { setOpenConvert(false); setSelectedRow(null); }}
        onSaved={async (data) => {
          // La conversión presupuesto → venta crea un movimiento nuevo fuera de la sección Ventas.
          // Invalidamos el cache persistente de Ventas para que aparezca al primer ingreso.
          [
            "ventas:listar:cc-medios-v2",
            "ventas:listar:cc-medios-v3",
            "ventas:listar:cc-medios-r2-v4",
            "ventas:listar:cc-medios-r2-v5",
            "ventas:listar:cc-medios-r2-v6",
            "ventas:listar:cc-medios-r2-v7",
          ].forEach((scope) => clearMovPerfCache(scope));
          const idVenta = Number(data?.id_venta || data?.id_movimiento || data?.ids?.[0] || data?.ids_movimiento?.[0] || 0);
          if (selectedRow?.id_movimiento && idVenta) {
            marcarPresupuestoConvertido(selectedRow.id_movimiento, idVenta, data?.conversion?.fecha_conversion || "");
          }
          setOpenConvert(false);
          setSelectedRow(null);
          await reloadVista();
        }}
      />

      <ModalEliminar
        open={openDel}
        row={selectedRow}
        loading={deletingId === selectedRow?.id_movimiento}
        onClose={() => { setOpenDel(false); setSelectedRow(null); }}
        onConfirm={confirmDelete}
        onToast={showToast}
        title="Eliminar presupuesto"
        message="¿Seguro que querés eliminar este presupuesto?"
        warning="Esta acción elimina el presupuesto. No impacta caja ni stock. Si ya fue convertido a venta, no se elimina desde acá."
        loadingMessage="Eliminando presupuesto…"
        successMessage="Presupuesto eliminado correctamente."
        errorMessage="No se pudo eliminar el presupuesto."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmVariant="danger"
        details={[
          { label: "ID Movimiento", value: `#${selectedRow?.id_movimiento ?? "—"}` },
          { label: "Cliente", value: selectedRow?.cliente || "—" },
          { label: "Concepto", value: selectedRow ? getDetallePresupuesto(selectedRow) : "—" },
          { label: "Monto", value: moneyARS(selectedRow?.monto_total || 0) },
        ]}
      />

      <ModalDetalleMovimiento
        open={openDetalleMovimiento}
        row={selectedRow}
        title="Información del presupuesto"
        onClose={() => {
          setOpenDetalleMovimiento(false);
          setSelectedRow(null);
        }}
      />

      <ModalVerComprobante open={openVerComprobante} url={comprobanteUrl} mime={comprobanteMime} title={comprobanteTitle} onClose={() => { setOpenVerComprobante(false); setComprobanteUrl(""); setComprobanteMime("application/pdf"); setComprobanteTitle("Comprobante"); }} />
    </div>
  );
}
