import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BASE_URL from "../../../config/config.jsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/GlobalResponsiveV2.css";
import "../../Global/Global_css/roots.css";
import "../../Global/Global_css/Global_oscuro.css";
import "./Ventas.css";

import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";

import ModalNuevaVenta from "./modales/ModalNuevaVenta.jsx";
import ModalEmitirNotaCreditoVenta from "./modales/ModalEmitirNotaCreditoVenta.jsx";
import ModalEliminar from "../../Global/Modales/ModalEliminar.jsx";
import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import { ModalDetalleMovimientoVenta } from "../../Global/Modales/ModalDetalleMovimiento.jsx";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faMagnifyingGlass,
  faPlus,
  faFileExcel,
  faTrashCan,
  faChevronDown,
  faArrowRightLong,
  faTimes,
  faEye,
  faBoxOpen,
  faInfoCircle,
  faFileInvoiceDollar,
} from "@fortawesome/free-solid-svg-icons";

import * as XLSX from "xlsx";
import { useListas } from "../../../context/ListasContext.jsx";
import { useDateRange } from "../../../context/DateRangeContext";
import { readMovPerfCache, writeMovPerfCache, clearMovPerfCache } from "../_shared/performanceCache.js";
import { getResumenProductosMovimiento } from "../_shared/detalleMovimiento.js";
import { getVentasAuthInfo as getAuthInfo, ventasApiGet as apiGet, ventasApiPostJson as apiPostJson } from "./api/ventasApi.js";
import useVentasToast from "./hooks/useVentasToast.js";
import { moneyARS } from "./utils/ventasUtils.js";

const MIN_LOADING_MS = 0;
const FORCE_SHOW_LOADER_DEV = false;
const PAGE_SIZE = 100;
const PROBE_LIMIT = PAGE_SIZE + 1;
const SKELETON_ROWS = 10;
const LIVE_POLL_MS = 5000;
const PREWARM_BATCH_SIZE = 8;
const PREWARM_DELAY_MS = 60;
const VENTAS_LIST_CACHE_KEY = "ventas:listar:cc-medios-r2-v12-nc-trazabilidad";

function safeText(v) { const s = String(v ?? "").trim(); return s ? s : "—"; }
function productosLabel(row) {
  const base = getResumenProductosMovimiento(row);
  const esTN = Number(row?.origen_tienda_nube ?? 0) === 1 || String(row?.origen ?? "").toUpperCase() === "TIENDA_NUBE";
  if (!esTN) return base;
  return `${base} - TIENDA NUBE`;
}
function normalizeSearchText(v) { return String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }
function formatFechaDMY(v) {
  const s = String(v ?? "").trim(); if (!s) return "—";
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return `${String(Number(m1[3])).padStart(2, "0")}/${String(Number(m1[2])).padStart(2, "0")}/${m1[1]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${String(Number(m2[1])).padStart(2, "0")}/${String(Number(m2[2])).padStart(2, "0")}/${m2[3]}`;
  return s;
}
function startOfDay(d) { if (!d) return null; const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function parseRowFecha(v) {
  const s = String(v ?? "").trim(); if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m1) return startOfDay(new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])));
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m2) return startOfDay(new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])));
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}
function dateToAPI(d) { if (!d) return ""; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function formatDateUI(d) { if (!d) return "—"; return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; }
function getMovimientoId(r) {
  const cand = r?.id_movimiento ?? r?.idMovimiento ?? r?.id_mov ?? r?.id ?? r?.id_venta ?? r?.idVenta ?? r?.venta_id ?? r?.movimiento_id ?? r?.id_movimiento_fk ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getRowItemId(r) {
  const cand = r?.id_item ?? r?.id_movimiento_item ?? r?.id_item_movimiento ?? r?.item_id ?? r?.id_detalle_item ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getRowKey(r) {
  const id = getMovimientoId(r);
  const itemId = getRowItemId(r);
  if (id && itemId) return `id:${id}:item:${itemId}`;
  if (id) {
    const d = String(r?.detalle ?? r?.descripcion ?? r?.concepto ?? "").trim();
    const c = String(r?.cantidad ?? "").trim();
    const p = String(r?.precio ?? "").trim();
    const t = String(r?.total ?? r?.monto_total ?? "").trim();
    return `id:${id}:fallback:${d}|${c}|${p}|${t}`;
  }
  const f = String(r?.fecha ?? "").trim();
  const c = String(r?.cliente ?? r?.cliente_nombre ?? "").trim();
  const d = String(r?.detalle ?? r?.descripcion ?? r?.concepto ?? "").trim();
  const m = String(Number(r?.monto_total ?? r?.total ?? r?.total_general ?? 0) || 0);
  return `fx:${f}|${c}|${d}|${m}`;
}
function normalizeComprobanteDocs(row) {
  const arr = Array.isArray(row?.comprobantes_detalle) ? row.comprobantes_detalle : [];
  return arr
    .map((doc) => {
      const id = Number(doc?.id_comprobante ?? doc?.id_archivo ?? doc?.id ?? 0);
      if (!Number.isFinite(id) || id <= 0) return null;
      const tipo = String(doc?.tipo ?? doc?.comprobante_tipo ?? "").trim().toUpperCase();
      const key = String(doc?.key ?? "").trim().toLowerCase();
      const defaultLabel = tipo === "REMITO"
        ? "Remito"
        : ["NOTA_CREDITO", "NOTA_CREDITO_INTERNA"].includes(tipo)
          ? "Nota de crédito"
          : tipo === "NOTA_DEBITO"
            ? "Nota de débito"
            : tipo === "VENTA_NO_FACTURADA"
              ? "Venta no facturada"
              : "Factura";
      const defaultKey = tipo === "REMITO"
        ? "remito"
        : ["NOTA_CREDITO", "NOTA_CREDITO_INTERNA"].includes(tipo)
          ? "nota_credito"
          : tipo === "NOTA_DEBITO"
            ? "nota_debito"
            : "factura";
      const label = String(doc?.label ?? doc?.title ?? defaultLabel).trim();
      return {
        ...doc,
        id_comprobante: id,
        id_archivo: id,
        tipo,
        key: key || defaultKey,
        label,
        title: String(doc?.title ?? label).trim() || label,
        mime: String(doc?.mime ?? doc?.archivo_mime ?? "application/pdf").trim() || "application/pdf",
        archivo_path: String(doc?.archivo_path ?? "").trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const rank = (d) => {
        const tipo = String(d?.tipo || "").toUpperCase();
        const key = String(d?.key || "").toLowerCase();
        if (tipo === "REMITO" || key.includes("remito")) return 2;
        if (["NOTA_CREDITO", "NOTA_CREDITO_INTERNA"].includes(tipo) || key.includes("nota_credito")) return 3;
        if (tipo === "NOTA_DEBITO" || key.includes("nota_debito")) return 4;
        return 1;
      };
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      return Number(a.id_comprobante || 0) - Number(b.id_comprobante || 0);
    });
}
function getFacturaDoc(row) {
  const docs = normalizeComprobanteDocs(row);
  return docs.find((d) => ["VENTA_NO_FACTURADA", "FACTURA_INTERNA", "FACTURA", "FACTURA_FISCAL"].includes(String(d?.tipo || "").toUpperCase()) || String(d?.key || "").toLowerCase().includes("factura")) || null;
}
function getRemitoDoc(row) {
  const docs = normalizeComprobanteDocs(row);
  return docs.find((d) => String(d?.tipo || "").toUpperCase() === "REMITO" || String(d?.key || "").toLowerCase() === "remito") || null;
}
function getFacturaIdComprobante(row) { const doc = getFacturaDoc(row); const n = Number(doc?.id_comprobante ?? row?.factura_id_comprobante ?? row?.id_comprobante ?? row?.comprobante_id ?? 0); return Number.isFinite(n) && n > 0 ? n : null; }
function getFacturaMime(row) {
  const doc = getFacturaDoc(row);
  return String(
    row?.factura_comprobante_mime ??
      doc?.mime ??
      doc?.archivo_mime ??
      row?.archivo_mime ??
      row?.comprobante_mime ??
      row?.mime_type ??
      row?.content_type ??
      "application/pdf"
  ).trim();
}
function getRemitoIdComprobante(row) { const doc = getRemitoDoc(row); const n = Number(doc?.id_comprobante ?? row?.remito_id_comprobante ?? row?.id_comprobante_remito ?? row?.remito_comprobante_id ?? 0); return Number.isFinite(n) && n > 0 ? n : null; }
function getRemitoMime(row) {
  const doc = getRemitoDoc(row);
  return String(
    row?.remito_comprobante_mime ??
      doc?.mime ??
      doc?.archivo_mime ??
      row?.remito_mime ??
      "application/pdf"
  ).trim();
}
function getComprobanteCacheSalt(doc) {
  return String(doc?.archivo_path ?? doc?.tipo ?? doc?.key ?? doc?.id_comprobante ?? "").trim();
}
function buildComprobanteCandidatesFromRow(row) {
  const docsDetalle = normalizeComprobanteDocs(row);
  if (docsDetalle.length) {
    return docsDetalle.map((doc) => ({
      key: `${doc.key || doc.tipo || "archivo"}-${doc.id_comprobante}`,
      label: doc.label || (doc.tipo === "REMITO" ? "Remito" : "Factura"),
      title: doc.title || doc.label || "Comprobante",
      id_comprobante: doc.id_comprobante,
      mime: doc.mime || doc.archivo_mime || "application/pdf",
      fileName: `${String(doc.label || doc.tipo || "comprobante").toLowerCase().replace(/\s+/g, "_")}.pdf`,
      cacheSalt: getComprobanteCacheSalt(doc),
    }));
  }

  const facturaId = getFacturaIdComprobante(row);
  const remitoId = getRemitoIdComprobante(row);
  const facturaTipo = String(row?.factura_comprobante_tipo || "").toUpperCase();
  const facturaLabel = facturaTipo === "VENTA_NO_FACTURADA" ? "Venta no facturada" : "Factura";
  const candidates = [];
  if (facturaId) {
    candidates.push({ key: `factura-${facturaId}`, label: facturaLabel, title: facturaLabel, id_comprobante: facturaId, mime: getFacturaMime(row) || "application/pdf", fileName: `${facturaLabel.toLowerCase().replace(/\s+/g, "_")}.pdf`, cacheSalt: String(row?.factura_comprobante_path ?? facturaTipo ?? facturaId) });
  }
  if (remitoId) {
    candidates.push({ key: `remito-${remitoId}`, label: "Remito", title: "Remito", id_comprobante: remitoId, mime: getRemitoMime(row) || "application/pdf", fileName: "remito.pdf", cacheSalt: String(row?.remito_comprobante_path ?? "REMITO") });
  }
  return candidates;
}
function hasCliente(r) { const idCli = Number(r?.id_cliente ?? 0); if (Number.isFinite(idCli) && idCli > 0) return true; return String(r?.cliente ?? "").trim().length > 0; }
function hasTipoVentaText(r) { return String(r?.pago_tipo_venta ?? r?.tipo_venta ?? "").trim().length > 0; }
function hasTipoVentaId(r) { const id = Number(r?.id_tipo_venta ?? r?.tipo_venta_id ?? 0); return Number.isFinite(id) && id > 0; }
function isSalida(r) { const tmTxt = normalizeSearchText(r?.tipo_movimiento ?? r?.pago_tipo_movimiento ?? ""); if (tmTxt.includes("salida")) return true; const id = Number(r?.id_tipo_movimiento ?? r?.tipo_movimiento_id ?? 0); return Number.isFinite(id) && id > 0; }
function isVentaRow(row) {
  const idTipoOperacion = Number(row?.id_tipo_operacion ?? row?.tipo_operacion_id ?? row?.idTipoOperacion ?? 0);
  if (Number.isFinite(idTipoOperacion) && idTipoOperacion === 1) return true;

  const tipoOperacionTxt = normalizeSearchText(row?.tipo_operacion ?? row?.tipo_operacion_nombre ?? row?.operacion ?? "");
  if (tipoOperacionTxt.includes("venta")) return true;

  if (!hasCliente(row)) return false;
  if (hasTipoVentaText(row)) return true;
  if (hasTipoVentaId(row)) return true;
  return isSalida(row);
}
function normalizeVentaRow(r) {
  const cliente = r?.cliente ?? r?.cliente_nombre ?? r?.nombre_cliente ?? r?.razon_social_cliente ?? "";
  const tipoVentaTxt = r?.pago_tipo_venta ?? r?.tipo_venta ?? "";
  const medioPagoNombre = r?.medio_pago_nombre ?? r?.medio_pago ?? r?.pago_medio_pago ?? "";
  const idMov = getMovimientoId(r);
  const docsDetalle = normalizeComprobanteDocs(r);
  const facturaId = getFacturaIdComprobante(r);
  const facturaMime = getFacturaMime(r);
  const facturaTipo = String(r?.factura_comprobante_tipo ?? r?.comprobante_tipo ?? r?.tipo_comprobante ?? "").trim();
  const remitoId = getRemitoIdComprobante(r);
  const remitoMime = getRemitoMime(r);
  const remitoTipo = String(r?.remito_comprobante_tipo ?? "").trim();
  return {
    ...r,
    id_movimiento: idMov ?? r?.id_movimiento ?? null,
    id_item: getRowItemId(r) ?? r?.id_item ?? null,
    id_movimiento_item: getRowItemId(r) ?? r?.id_movimiento_item ?? null,
    fecha: r?.fecha,
    cliente: String(cliente ?? "").trim() || "",
    pago_tipo_venta: String(tipoVentaTxt ?? "").trim() || "",
    medio_pago_nombre: String(medioPagoNombre ?? "").trim() || "",
    id_comprobante: facturaId,
    comprobante_url: String(r?.factura_comprobante_url ?? r?.comprobante_url ?? ""),
    archivo_mime: facturaMime,
    factura_comprobante_mime: facturaMime,
    factura_id_comprobante: facturaId,
    factura_comprobante_url: String(r?.factura_comprobante_url ?? ""),
    factura_comprobante_tipo: facturaTipo,
    factura_emitida_en_arca: Number(r?.factura_emitida_en_arca || 0),
    factura_tiene_nota_credito: Number(r?.factura_tiene_nota_credito || 0),
    remito_id_comprobante: remitoId,
    remito_comprobante_url: String(r?.remito_comprobante_url ?? ""),
    remito_comprobante_mime: remitoMime,
    remito_comprobante_tipo: remitoTipo,
    cantidad_medios_pago: Number(r?.cantidad_medios_pago || 0),
    medios_pago_detalle: Array.isArray(r?.medios_pago_detalle) ? r.medios_pago_detalle : [],
    cantidad_items: Number(r?.cantidad_items || 0),
    items_detalle: Array.isArray(r?.items_detalle) ? r.items_detalle : [],
    comprobantes_detalle: docsDetalle,
    origen: String(r?.origen ?? "").trim(),
    origen_tienda_nube: Number(r?.origen_tienda_nube || 0),
    origen_label: String(r?.origen_label ?? "").trim(),
    tn_order_id: r?.tn_order_id ?? null,
  };
}
function rowMatchesQuery(row, query) {
  const qq = normalizeSearchText(query); if (!qq) return true;
  const montoNum = Number(row?.monto_total || row?.total || 0);
  const parts = [];
  if (row && typeof row === "object") for (const k of Object.keys(row)) { const val = row[k]; if (val && typeof val === "object") continue; parts.push(String(val ?? "")); }
  if (Array.isArray(row?.items_detalle)) row.items_detalle.forEach((it) => parts.push(it?.producto_nombre, it?.stock_producto_nombre, it?.variante_nombre, it?.stock_variante_nombre, it?.nombre_variante, it?.producto_variante_nombre, it?.detalle_nombre, it?.nombre, it?.descripcion));
  if (Array.isArray(row?.medios_pago_detalle)) row.medios_pago_detalle.forEach((mp) => parts.push(mp?.medio_pago_nombre, mp?.cheque_tipo, mp?.numero_cheque, mp?.emisor));
  {
    const orderIdRaw = row?.tn_order_id ?? row?.tn_order_number ?? null;
    const orderId = Number(orderIdRaw ?? 0);
    const tieneOrdenTN = (Number.isFinite(orderId) && orderId > 0) || String(orderIdRaw ?? "").trim() !== "";
    const esTN = tieneOrdenTN && (Number(row?.origen_tienda_nube ?? 0) === 1 || String(row?.origen ?? "").toUpperCase() === "TIENDA_NUBE");
    if (esTN) parts.push("TIENDA NUBE", "tienda nube", "tiendanube", row?.origen_label, row?.tn_order_id);
  }
  parts.push(formatFechaDMY(row?.fecha), String(montoNum), String(Math.trunc(montoNum)), moneyARS(montoNum));
  const hay = normalizeSearchText(parts.join(" | "));
  return hay.includes(qq);
}
function rowInDateRange(row, from, to) { if (!from && !to) return true; const fecha = parseRowFecha(row?.fecha); if (!fecha) return true; if (from && fecha < startOfDay(from)) return false; if (to) { const toEnd = startOfDay(to); toEnd.setHours(23,59,59,999); if (fecha > toEnd) return false; } return true; }
function slugifySheetName(name) { const s = String(name || "Ventas").replace(/[\[\]\*\/\\\?\:]/g, " ").replace(/\s+/g, " ").trim(); return (s || "Ventas").slice(0, 31); }
function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: safeText(formatFechaDMY(r?.fecha)),
    DESCRIPCION: productosLabel(r),
    CLIENTE: safeText(r?.cliente),
    TOTAL: Number(r?.monto_total ?? r?.total ?? r?.total_general ?? 0) || 0,
  }));
}
function escapeCSV(value) { const s = String(value ?? ""); if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`; return s; }
function downloadBlob(content, fileName, mimeType) { const blob = new Blob([content], { type: mimeType }); const url = window.URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); window.URL.revokeObjectURL(url); }

export default function Ventas() {
  const API = `${BASE_URL}/api.php`;
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();
  const { lists: listasCtx, loadingLists: loadingListsCtx, errorLists: errorListsCtx, ensureListsLoaded, refreshLists } = useListas();
  const { dateRange, setDateRange } = useDateRange();
  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  useEffect(() => { rowsRef.current = Array.isArray(rows) ? rows : []; }, [rows]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [showCalendario, setShowCalendario] = useState(false);
  const [q, setQ] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);
  const [openAdd, setOpenAdd] = useState(false);
  const [openDel, setOpenDel] = useState(false);
  const [openNC, setOpenNC] = useState(false);
  const [modoNC, setModoNC] = useState("NORMAL");
  const [openDetalleMovimiento, setOpenDetalleMovimiento] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [openVerComprobante, setOpenVerComprobante] = useState(false);
  const [comprobanteUrl, setComprobanteUrl] = useState("");
  const [comprobanteMime, setComprobanteMime] = useState("");
  const [comprobanteDocs, setComprobanteDocs] = useState([]);
  const signedUrlCacheRef = useRef(new Map());
  const signedUrlInFlightRef = useRef(new Set());
  const prewarmCancelRef = useRef(false);
  const { toast, showToast, closeToast } = useVentasToast();
  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);
  const rowsReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const skipSearchRef = useRef(false);
  const liveTimerRef = useRef(null);
  const liveBusyRef = useRef(false);
  const liveTokenRef = useRef(null);
  const liveToastCooldownRef = useRef(0);
  useEffect(() => () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); if (liveTimerRef.current) clearTimeout(liveTimerRef.current); prewarmCancelRef.current = true; }, []);
  useEffect(() => {
    ["ventas:listar:cc-medios-v2", "ventas:listar:cc-medios-v3", "ventas:listar:cc-medios-r2-v4", "ventas:listar:cc-medios-r2-v5", "ventas:listar:cc-medios-r2-v6", "ventas:listar:cc-medios-r2-v7", "ventas:listar:cc-medios-r2-v8-tn"].forEach((key) => clearMovPerfCache(key));
  }, []);
  const getComprobanteSignedUrl = useCallback(async (idComprobante, cacheSalt = "") => {
    const id = Number(idComprobante || 0); if (!id) return "";
    const cacheKey = `${id}:${String(cacheSalt || "")}`;
    if (signedUrlCacheRef.current.has(cacheKey)) return signedUrlCacheRef.current.get(cacheKey) || "";
    if (signedUrlInFlightRef.current.has(cacheKey)) {
      return await new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          if (signedUrlCacheRef.current.has(cacheKey)) { clearInterval(poll); resolve(signedUrlCacheRef.current.get(cacheKey) || ""); }
          else if (!signedUrlInFlightRef.current.has(cacheKey)) { clearInterval(poll); reject(new Error("No se pudo obtener el comprobante.")); }
        }, 40);
        setTimeout(() => { clearInterval(poll); reject(new Error("Timeout esperando URL firmada.")); }, 8000);
      });
    }
    signedUrlInFlightRef.current.add(cacheKey);
    try {
      const sp = new URLSearchParams(); sp.set("action", "ventas_comprobantes_descargar"); sp.set("id_comprobante", String(id)); sp.set("_", String(Date.now()));
      const data = await apiGet(`${API}?${sp.toString()}`);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      const finalUrl = String(data?.url || "").trim(); if (!finalUrl) throw new Error("El backend no devolvió la URL del comprobante.");
      signedUrlCacheRef.current.set(cacheKey, finalUrl); return finalUrl;
    } finally { signedUrlInFlightRef.current.delete(cacheKey); }
  }, [API, apiGet]);
  const prewarmAllComprobantes = useCallback(async (rowsToWarm) => {
    prewarmCancelRef.current = true; await new Promise((r) => setTimeout(r, 0)); prewarmCancelRef.current = false;
    const docs = [];
    for (const row of rowsToWarm) {
      for (const doc of buildComprobanteCandidatesFromRow(row)) {
        const cacheKey = `${doc.id_comprobante}:${String(doc.cacheSalt || "")}`;
        if (doc.id_comprobante && !signedUrlCacheRef.current.has(cacheKey)) docs.push(doc);
      }
    }
    const seen = new Set();
    const uniqueDocs = docs.filter((doc) => { const k = `${doc.id_comprobante}:${String(doc.cacheSalt || "")}`; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!uniqueDocs.length) return;
    for (let i = 0; i < uniqueDocs.length; i += PREWARM_BATCH_SIZE) {
      if (prewarmCancelRef.current) return;
      const batch = uniqueDocs.slice(i, i + PREWARM_BATCH_SIZE);
      await Promise.allSettled(batch.map((doc) => getComprobanteSignedUrl(doc.id_comprobante, doc.cacheSalt).catch(() => {})));
      if (i + PREWARM_BATCH_SIZE < uniqueDocs.length && !prewarmCancelRef.current) await new Promise((r) => setTimeout(r, PREWARM_DELAY_MS));
    }
  }, [getComprobanteSignedUrl]);
  const refreshPeriodos = useCallback(async () => { try { await refreshLists(); } catch {} }, [refreshLists]);
  const fetchLiveToken = useCallback(async (fromParam, toParam, qParam) => {
    const fromDate = fromParam !== undefined ? fromParam : dateRange.from;
    const toDate = toParam !== undefined ? toParam : dateRange.to;
    const qLocal = typeof qParam === "string" ? qParam : q;
    const fromAPI = dateToAPI(fromDate); const toAPI = dateToAPI(toDate);
    const sp = new URLSearchParams(); sp.set("action", "ventas_live_token"); if (fromAPI) sp.set("fecha_desde", fromAPI); if (toAPI) sp.set("fecha_hasta", toAPI); if ((qLocal || "").trim()) sp.set("q", (qLocal || "").trim()); sp.set("limit", String(PAGE_SIZE));
    const data = await apiGet(`${API}?${sp.toString()}`); if (!data?.exito) throw new Error(data?.mensaje || "No se pudo obtener el token en vivo."); return String(data.live_token || "");
  }, [API, apiGet, dateRange.from, dateRange.to, q]);
  const loadRows = useCallback(async (opts = {}) => {
    const fromDate = opts.from !== undefined ? opts.from : dateRange.from;
    const toDate = opts.to !== undefined ? opts.to : dateRange.to;
    const qLocal = typeof opts.q === "string" ? opts.q : q;
    const append = !!opts.append;
    const offset = Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : 0;
    const bypassCache = opts.bypassCache === true;
    const fromAPI = dateToAPI(fromDate); const toAPI = dateToAPI(toDate); const qKey = (qLocal || "").trim();
    const cacheKey = `${fromAPI}|${toAPI}|${qKey}`; const myReqId = ++reqIdRef.current; const start = Date.now();
    if (!bypassCache && !append && offset === 0 && !cacheRef.current.has(cacheKey)) {
      const persisted = readMovPerfCache(VENTAS_LIST_CACHE_KEY, cacheKey);
      if (persisted?.rows) cacheRef.current.set(cacheKey, persisted);
    }
    if (!append) { rowsReqIdRef.current = myReqId; setLoadingRows(true); } else { moreReqIdRef.current = myReqId; setLoadingMore(true); }
    setError("");
    try {
      if (!bypassCache && !append && offset === 0 && cacheRef.current.has(cacheKey) && !FORCE_SHOW_LOADER_DEV) {
        if (rowsReqIdRef.current !== myReqId) return null;
        const cached = cacheRef.current.get(cacheKey); const cachedRows = Array.isArray(cached?.rows) ? cached.rows : [];
        rowsRef.current = cachedRows; setRows(cachedRows); setHasMore(!!cached?.hasMore); setNextOffset(cached?.nextOffset ?? null); if (rowsReqIdRef.current === myReqId) setLoadingRows(false); prewarmAllComprobantes(cachedRows); return { hasMore: !!cached?.hasMore, nextOffset: cached?.nextOffset ?? null, received: cachedRows.length };
      }
      const sp = new URLSearchParams(); sp.set("action", "ventas_listar"); if (fromAPI) sp.set("fecha_desde", fromAPI); if (toAPI) sp.set("fecha_hasta", toAPI); if (qKey) sp.set("q", qKey); sp.set("limit", String(PAGE_SIZE)); sp.set("offset", String(offset));
      const data = await apiGet(`${API}?${sp.toString()}`); if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar ventas.");
      if (myReqId !== reqIdRef.current) return null;
      const rawArr = Array.isArray(data.ventas) ? data.ventas : Array.isArray(data.movimientos) ? data.movimientos : [];
      const normAll = rawArr.map(normalizeVentaRow);
      let newHasMore = data.has_more !== undefined ? !!data.has_more : normAll.length > PAGE_SIZE;
      let newNextOffset = data.next_offset !== undefined && data.next_offset !== null ? Number(data.next_offset) : newHasMore ? offset + PAGE_SIZE : null;
      const page = newHasMore ? normAll.slice(0, PAGE_SIZE) : normAll;
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      return await new Promise((resolve) => {
        const apply = () => {
          if (myReqId !== reqIdRef.current) return resolve(null);
          if (append) {
            const base = Array.isArray(rowsRef.current) ? rowsRef.current : [];
            const seen = new Set(base.map((x) => getRowKey(x)));
            const add = page.filter((x) => { const k = getRowKey(x); return k && !seen.has(k); });
            const merged = [...base, ...add]; rowsRef.current = merged; setRows(merged);
            if (add.length === 0) { newHasMore = false; newNextOffset = null; }
            setHasMore(newHasMore); setNextOffset(newNextOffset); if (moreReqIdRef.current === myReqId) setLoadingMore(false); prewarmAllComprobantes(add);
          } else {
            rowsRef.current = page; setRows(page); setHasMore(newHasMore); setNextOffset(newNextOffset); if (offset === 0) {
              const cachePayload = { rows: page, hasMore: newHasMore, nextOffset: newNextOffset };
              cacheRef.current.set(cacheKey, cachePayload);
              writeMovPerfCache(VENTAS_LIST_CACHE_KEY, cacheKey, cachePayload);
            } if (rowsReqIdRef.current === myReqId) setLoadingRows(false); prewarmAllComprobantes(page);
          }
          resolve({ hasMore: newHasMore, nextOffset: newNextOffset, received: page.length });
        };
        if (remaining > 0) setTimeout(apply, remaining); else apply();
      });
    } catch (e) {
      const elapsed = Date.now() - start; const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      return await new Promise((resolve) => {
        setTimeout(() => {
          if (myReqId !== reqIdRef.current) return resolve(null);
          setError(e.message || "Error cargando ventas.");
          if (append) { if (moreReqIdRef.current === myReqId) setLoadingMore(false); }
          else { if (rowsReqIdRef.current === myReqId) setLoadingRows(false); }
          resolve(null);
        }, remaining);
      });
    }
  }, [API, apiGet, dateRange, q, prewarmAllComprobantes]);
  useEffect(() => { let alive = true; (async () => { try { await ensureListsLoaded({ force: false, background: true }); } catch {} if (!alive) return; await loadRows({ from: dateRange.from, to: dateRange.to, q: "", offset: 0, append: false, bypassCache: true }); try { const token = await fetchLiveToken(dateRange.from, dateRange.to, ""); if (alive) liveTokenRef.current = token; } catch {} })(); return () => { alive = false; }; }, []); // eslint-disable-line
  useEffect(() => { liveTokenRef.current = null; }, [dateRange.from, dateRange.to, q]);
  useEffect(() => {
    if (skipSearchRef.current) { skipSearchRef.current = false; return; }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      await loadRows({ from: dateRange.from, to: dateRange.to, q, offset: 0, append: false });
      try { const token = await fetchLiveToken(dateRange.from, dateRange.to, q); liveTokenRef.current = token; } catch {}
    }, 250);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [q, dateRange]); // eslint-disable-line
  const handleDateRangeChange = useCallback(async (newRange) => {
    if (!newRange.from && !newRange.to) return;
    setDateRange(newRange); cacheRef.current.clear(); clearMovPerfCache(VENTAS_LIST_CACHE_KEY); skipSearchRef.current = true; liveTokenRef.current = null; if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    await loadRows({ from: newRange.from, to: newRange.to, q, offset: 0, append: false });
    try { const token = await fetchLiveToken(newRange.from, newRange.to, q); liveTokenRef.current = token; } catch {}
  }, [setDateRange, loadRows, q, fetchLiveToken]);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden || liveBusyRef.current || loadingRows || loadingMore || loadingListsCtx || showCalendario || openAdd || openDel || openNC || openVerComprobante || openDetalleMovimiento) { liveTimerRef.current = setTimeout(tick, LIVE_POLL_MS); return; }
      liveBusyRef.current = true;
      try {
        const token = await fetchLiveToken(dateRange.from, dateRange.to, q);
        if (!token) { liveBusyRef.current = false; liveTimerRef.current = setTimeout(tick, LIVE_POLL_MS); return; }
        if (liveTokenRef.current === null) liveTokenRef.current = token;
        else if (liveTokenRef.current !== token) {
          liveTokenRef.current = token; cacheRef.current.clear(); signedUrlCacheRef.current.clear(); signedUrlInFlightRef.current.clear();
          const prevLen = rowsRef.current.length; const prevHasMore = hasMore;
          await loadRows({ from: dateRange.from, to: dateRange.to, q, offset: 0, append: false, bypassCache: true });
          const now = Date.now();
          if (now - liveToastCooldownRef.current > 4000) {
            const mensaje = prevHasMore || prevLen >= PAGE_SIZE ? "Ventas actualizadas en vivo. La vista se recargó desde el inicio." : "Ventas actualizadas en vivo.";
            showToast("exito", mensaje, 2200); liveToastCooldownRef.current = now;
          }
        }
      } catch {} finally { liveBusyRef.current = false; if (!cancelled) liveTimerRef.current = setTimeout(tick, LIVE_POLL_MS); }
    };
    liveTimerRef.current = setTimeout(tick, LIVE_POLL_MS);
    return () => { cancelled = true; if (liveTimerRef.current) clearTimeout(liveTimerRef.current); };
  }, [dateRange.from, dateRange.to, q, loadingRows, loadingMore, loadingListsCtx, showCalendario, openAdd, openDel, openNC, openVerComprobante, openDetalleMovimiento, hasMore, fetchLiveToken, loadRows, showToast]);

  const filteredRows = useMemo(() => (Array.isArray(rows) ? rows : []).filter((r) => isVentaRow(r)).filter((r) => rowInDateRange(r, dateRange.from, dateRange.to)).filter((r) => rowMatchesQuery(r, q)), [rows, dateRange, q]);
  const columns = useMemo(() => [
    { key: "fecha", label: "FECHA", align: "center", fr: 0.9, render: (r) => safeText(formatFechaDMY(r.fecha)) },
    { key: "detalle", label: "DESCRIPCIÓN", fr: 2.2, strong: true, align: "left", render: (r) => productosLabel(r) },
    { key: "cliente", label: "CLIENTE", fr: 1.6, align: "center", render: (r) => safeText(r.cliente) },
    { key: "total", label: "TOTAL", fr: 1.1, align: "right", render: (r) => moneyARS(r.monto_total ?? r.total ?? r.total_general ?? 0) },
    { key: "acciones", label: "ACCIONES", fr: 1.1, align: "center", render: () => null },
  ], []);
  const gridCols = useMemo(() => Array.isArray(columns) && columns.length ? columns.map((c) => { const n = Number(c.fr); return Number.isFinite(n) && n > 0 ? `${n}fr` : "1fr"; }).join(" ") : `repeat(${columns.length}, minmax(0, 1fr))`, [columns]);
  const dateRangeLabel = useMemo(() => { const { from, to } = dateRange; if (!from && !to) return "Seleccionar fechas"; if (from && to) { if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth() && from.getDate() === to.getDate()) return formatDateUI(from); return <><span>{formatDateUI(from)}</span><span className="mov-rangeArrow"><FontAwesomeIcon icon={faArrowRightLong} /></span><span>{formatDateUI(to)}</span></>; } if (from) return `Desde ${formatDateUI(from)}`; return `Hasta ${formatDateUI(to)}`; }, [dateRange]);
  const exportBaseName = useMemo(() => { const { from, to } = dateRange; if (from && to) return `ventas_${dateToAPI(from)}_${dateToAPI(to)}`; if (from) return `ventas_desde_${dateToAPI(from)}`; return "ventas_todos"; }, [dateRange]);
  const getExportData = useCallback(() => { const dataToExport = buildExportRows(filteredRows); if (!dataToExport.length) throw new Error("No hay datos para exportar."); return dataToExport; }, [filteredRows]);
  const exportToExcel = useCallback(() => { const dataToExport = getExportData(); const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(dataToExport); const headers = Object.keys(dataToExport[0] || {}); const totalColIndex = headers.findIndex((h) => h === "TOTAL"); if (totalColIndex >= 0 && ws["!ref"]) { const colLetter = XLSX.utils.encode_col(totalColIndex); const range = XLSX.utils.decode_range(ws["!ref"]); for (let r = range.s.r + 1; r <= range.e.r; r++) { const cell = ws[`${colLetter}${r + 1}`]; if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00'; } } XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("Ventas_Vista")); XLSX.writeFile(wb, `${exportBaseName}.xlsx`); }, [getExportData, exportBaseName]);
  const exportToCSV = useCallback(() => { const dataToExport = getExportData(); const headers = Object.keys(dataToExport[0] || {}); const lines = [headers.join(";"), ...dataToExport.map((row) => headers.map((h) => escapeCSV(row[h])).join(";"))]; const csvContent = "\uFEFF" + lines.join("\n"); downloadBlob(csvContent, `${exportBaseName}.csv`, "text/csv;charset=utf-8;"); }, [getExportData, exportBaseName]);
  const exportToTXT = useCallback(() => { const dataToExport = getExportData(); const lines = dataToExport.map((row, index) => [ `REGISTRO ${index + 1}`, `FECHA: ${row.FECHA ?? ""}`, `DESCRIPCION: ${row.DESCRIPCION ?? ""}`, `CLIENTE: ${row.CLIENTE ?? ""}`, `TOTAL: ${row.TOTAL ?? ""}`, "----------------------------------------" ].join("\n")); downloadBlob(lines.join("\n"), `${exportBaseName}.txt`, "text/plain;charset=utf-8;"); }, [getExportData, exportBaseName]);
  const handleExport = useCallback(async (type) => { try { if (hasMore) { showToast("error", 'Todavía hay más registros sin cargar. Tocá "Cargar 100 más" hasta completar todo.', 5200); return; } if (type === "excel") { exportToExcel(); showToast("exito", "Excel exportado.", 2200); return; } if (type === "csv") { exportToCSV(); showToast("exito", "CSV exportado.", 2200); return; } if (type === "txt") { exportToTXT(); showToast("exito", "TXT exportado.", 2200); } } catch (e) { showToast("error", e?.message || "Error exportando archivo.", 3500); } }, [hasMore, exportToExcel, exportToCSV, exportToTXT, showToast]);
  const exportOptions = useMemo(() => [
    { key: "excel", label: "Exportar Excel (.xlsx)", icon: faFileExcel, onClick: () => handleExport("excel") },
    { key: "csv", label: "Exportar CSV (.csv)", onClick: () => handleExport("csv") },
    { key: "txt", label: "Exportar TXT (.txt)", onClick: () => handleExport("txt") },
  ], [handleExport]);
  const reloadVista = useCallback(async () => { cacheRef.current.clear(); clearMovPerfCache(VENTAS_LIST_CACHE_KEY); signedUrlCacheRef.current.clear(); signedUrlInFlightRef.current.clear(); await loadRows({ from: dateRange.from, to: dateRange.to, q, offset: 0, append: false, bypassCache: true }); try { const token = await fetchLiveToken(dateRange.from, dateRange.to, q); liveTokenRef.current = token; } catch {} }, [dateRange.from, dateRange.to, loadRows, q, fetchLiveToken]);
  const confirmDelete = async ({ permitirFiscalAnulada = false } = {}) => {
    if (!selectedRow?.id_movimiento) return;
    const id = selectedRow.id_movimiento;
    setDeletingId(id);
    setError("");

    try {
      const { idUsuario } = getAuthInfo();
      const sp = new URLSearchParams();
      sp.set("action", "ventas_eliminar");
      sp.set("id_movimiento", String(id));

      const data = await apiPostJson(`${API}?${sp.toString()}`, {
        idUsuario,
        eliminar_fiscal_anulada: permitirFiscalAnulada ? 1 : 0,
      });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar.");

      ["presupuestos:listar:v2", "presupuestos:listar:v3", "presupuestos:listar:v4"].forEach((scope) => clearMovPerfCache(scope));
      clearMovPerfCache(VENTAS_LIST_CACHE_KEY);
      cacheRef.current.clear();
      signedUrlCacheRef.current.clear();
      signedUrlInFlightRef.current.clear();

      // La venta ya fue eliminada en backend. La sacamos de la tabla al instante
      // para no depender de un refetch que puede demorarse si Tienda Nube está lento.
      setRows((prev) => {
        const next = (Array.isArray(prev) ? prev : []).filter((r) => getMovimientoId(r) !== id);
        rowsRef.current = next;
        return next;
      });
      setOpenDel(false);
      setSelectedRow(null);

      try {
        await reloadVista();
      } catch (refreshErr) {
        console.warn("Venta eliminada, pero no se pudo refrescar la lista automáticamente:", refreshErr);
      }
      try {
        await refreshPeriodos();
      } catch (periodosErr) {
        console.warn("Venta eliminada, pero no se pudieron refrescar los períodos:", periodosErr);
      }
    } catch (e) {
      setError(e.message || "Error eliminando venta.");
      throw e;
    } finally {
      setDeletingId(null);
    }
  };
  const handleLoadMore = useCallback(async () => { if (!hasMore || loadingMore || loadingRows || loadingListsCtx || nextOffset === null) return; try { await loadRows({ from: dateRange.from, to: dateRange.to, q: (q || "").trim(), offset: nextOffset, append: true }); try { const token = await fetchLiveToken(dateRange.from, dateRange.to, q); liveTokenRef.current = token; } catch {} } catch (e) { showToast("error", e?.message || "Error cargando más ventas.", 4200); } }, [hasMore, loadingMore, loadingRows, loadingListsCtx, nextOffset, dateRange, q, loadRows, showToast, fetchLiveToken]);
  const handleVerComprobante = useCallback(async (r) => {
    const candidates = buildComprobanteCandidatesFromRow(r);

    if (!candidates.length) {
      showToast("error", "No se encontraron comprobantes para esta venta.", 3000);
      return;
    }

    try {
      const docs = (
        await Promise.all(
          candidates.map(async (doc) => ({
            ...doc,
            url: await getComprobanteSignedUrl(doc.id_comprobante, doc.cacheSalt),
          }))
        )
      ).filter((doc) => String(doc.url || "").trim());

      if (!docs.length) {
        showToast("error", "No se pudieron obtener los comprobantes.", 3000);
        return;
      }

      setComprobanteDocs(docs);
      setComprobanteUrl(docs[0]?.url || "");
      setComprobanteMime(docs[0]?.mime || "application/pdf");
      setOpenVerComprobante(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudieron abrir los comprobantes.", 3200);
    }
  }, [getComprobanteSignedUrl, showToast]);
  const handlePrewarmComprobante = useCallback(async (r) => {
    buildComprobanteCandidatesFromRow(r).forEach((doc) => getComprobanteSignedUrl(doc.id_comprobante, doc.cacheSalt).catch(() => {}));
  }, [getComprobanteSignedUrl]);
  const esVentaFiscal = useMemo(() => Number(selectedRow?.factura_emitida_en_arca || 0) === 1, [selectedRow]);
  const tieneNotaCreditoInterna = useMemo(() => {
    if (!selectedRow || esVentaFiscal) return false;
    if (Number(selectedRow?.tiene_nota_credito_fiscal || 0) === 1) return false;
    return Number(selectedRow?.tiene_nota_credito_interna || 0) === 1
      || Number(selectedRow?.tiene_nota_credito || 0) === 1
      || Number(selectedRow?.nota_credito_cantidad || 0) > 0
      || Number(selectedRow?.monto_acreditado || 0) > 0;
  }, [selectedRow, esVentaFiscal]);
  const cantidadNotasCreditoInternas = useMemo(() => {
    const cantidad = Number(selectedRow?.nota_credito_cantidad || 0);
    return Number.isFinite(cantidad) && cantidad > 0 ? cantidad : (tieneNotaCreditoInterna ? 1 : 0);
  }, [selectedRow, tieneNotaCreditoInterna]);
  const tieneNotaCreditoFiscal = useMemo(() => (
    esVentaFiscal && (
      Number(selectedRow?.tiene_nota_credito_fiscal || 0) === 1
      || Number(selectedRow?.factura_tiene_nota_credito || 0) === 1
      || Number(selectedRow?.nota_credito_cantidad || 0) > 0
      || Number(selectedRow?.monto_acreditado || 0) > 0
    )
  ), [selectedRow, esVentaFiscal]);
  const notaCreditoFiscalTotal = useMemo(() => (
    tieneNotaCreditoFiscal && (
      Number(selectedRow?.nota_credito_total || 0) === 1
      || Number(selectedRow?.monto_total ?? selectedRow?.total ?? 0) <= 0.004
    )
  ), [selectedRow, tieneNotaCreditoFiscal]);
  const cantidadNotasCreditoFiscal = useMemo(() => {
    const cantidad = Number(selectedRow?.nota_credito_cantidad || 0);
    return Number.isFinite(cantidad) && cantidad > 0 ? cantidad : (tieneNotaCreditoFiscal ? 1 : 0);
  }, [selectedRow, tieneNotaCreditoFiscal]);
  const deleteModalExtraContent = useMemo(() => {
    if (!selectedRow) return null;
    if (esVentaFiscal) {
      if (notaCreditoFiscalTotal) {
        return <div style={{ background: "#f6ffed", border: "1px solid #b7eb8f", color: "#237804", borderRadius: 12, padding: 12, marginTop: 10 }}><div style={{ fontWeight: 700, marginBottom: 6 }}>La nota de crédito ya fue emitida</div><div style={{ lineHeight: 1.5 }}>Ahora ya podés eliminar la venta.</div></div>;
      }
      const texto = tieneNotaCreditoFiscal
        ? "La venta tiene una acreditación parcial. Para eliminarla, primero emití una nota de crédito por todo el saldo pendiente en ARCA."
        : "Para eliminar esta venta, primero emití una nota de crédito por el total en ARCA.";
      return <div className="extraContent-ventas extraContent-ventas--warning"><div className="extraContent-ventas__title">Se requiere una nota de crédito total</div><div className="extraContent-ventas__text">{texto}</div></div>;
    }
    if (tieneNotaCreditoInterna) {
      const textoCantidad = cantidadNotasCreditoInternas === 1 ? "La nota de crédito interna asociada" : `Las ${cantidadNotasCreditoInternas} notas de crédito internas asociadas`;
      return <div className="extraContent-ventas extraContent-ventas--warning"><div className="extraContent-ventas__title">También se eliminarán las notas de crédito</div><div className="extraContent-ventas__text">{textoCantidad}, sus comprobantes internos y sus impactos de stock se eliminarán junto con la venta.</div></div>;
    }
    return null;
  }, [selectedRow, esVentaFiscal, notaCreditoFiscalTotal, tieneNotaCreditoFiscal, tieneNotaCreditoInterna, cantidadNotasCreditoInternas]);
  const deleteModalConfig = useMemo(() => {
    const details = [{ label: "ID Movimiento", value: `#${selectedRow?.id_movimiento ?? "—"}` }, { label: "Cliente", value: selectedRow?.cliente || "—" }, { label: "Concepto", value: selectedRow?.detalle ?? selectedRow?.descripcion ?? selectedRow?.concepto ?? "—" }, { label: "Monto neto", value: moneyARS(selectedRow?.monto_total ?? selectedRow?.total ?? selectedRow?.total_general ?? 0) }];
    if (tieneNotaCreditoInterna) details.push({ label: "Notas internas asociadas", value: String(cantidadNotasCreditoInternas) });
    if (esVentaFiscal) {
      details.push({ label: "Estado fiscal", value: notaCreditoFiscalTotal ? "ANULADA POR NOTA DE CRÉDITO" : tieneNotaCreditoFiscal ? "ACREDITACIÓN PARCIAL" : "FACTURA EMITIDA" });
      if (tieneNotaCreditoFiscal) details.push({ label: "Notas de crédito", value: String(cantidadNotasCreditoFiscal) });
      if (notaCreditoFiscalTotal) return { title: "Eliminar venta", message: "Esta venta ya tiene su nota de crédito asociada.", warning: "Ahora sí podés eliminar el registro definitivamente.", confirmLabel: "Eliminar", confirmDisabled: false, secondaryActionLabel: "", confirmVariant: "danger", details };
      return {
        title: "No se puede eliminar todavía",
        message: tieneNotaCreditoFiscal ? "La factura de ARCA todavía tiene saldo pendiente." : "Esta venta tiene una factura emitida en ARCA.",
        warning: "",
        confirmLabel: "Eliminar",
        confirmDisabled: true,
        secondaryActionLabel: "Emitir nota de crédito",
        confirmVariant: "danger",
        details,
      };
    }
    if (tieneNotaCreditoInterna) return { title: "Eliminar venta y notas de crédito", message: "¿Seguro que querés eliminar esta venta y todas sus notas de crédito internas?", warning: "Se eliminarán definitivamente la venta, las notas internas y sus comprobantes. Balto revertirá ambos impactos para dejar el stock correcto.", confirmLabel: "Eliminar todo", confirmDisabled: false, secondaryActionLabel: "", confirmVariant: "danger", details };
    return { title: "Eliminar venta", message: "¿Seguro que querés eliminar esta venta definitivamente?", warning: "Esta acción no se puede deshacer.", confirmLabel: "Eliminar", confirmDisabled: false, secondaryActionLabel: "", confirmVariant: "danger", details };
  }, [selectedRow, esVentaFiscal, tieneNotaCreditoInterna, cantidadNotasCreditoInternas, tieneNotaCreditoFiscal, notaCreditoFiscalTotal, cantidadNotasCreditoFiscal]);
  const isAnyLoading = loadingRows || loadingMore;
  const skelWidths = useMemo(() => ({ fecha: ["44%", "38%", "40%", "36%"], detalle: ["72%", "58%", "66%", "48%"], cliente: ["62%", "54%", "46%", "58%"], total: ["38%", "30%", "34%", "28%"] }), []);
  const renderSkeletonRow = (idx) => <div key={`skel-${idx}`} className="mov-gridTable mov-gridTable--row mov-row--skeleton" style={{ gridTemplateColumns: gridCols }} role="row" aria-hidden="true">{columns.map((c) => c.key === "acciones" ? <div key={c.key} className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label={c.label}><div className="mov-skelActions"><span className="mov-skelIcon" /><span className="mov-skelIcon" /><span className="mov-skelIcon" /></div></div> : <div key={c.key} className={["mov-gridCell", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : ""].join(" ")} role="cell" data-label={c.label}><span className="mov-skeletonBar" style={{ width: (skelWidths[c.key] || ["60%"])[idx % (skelWidths[c.key] || ["60% "]).length] }} /></div>)}</div>;
  const lists = listasCtx || { periodos: [], clientes: [], medios_pago: [], tipos_venta: [], clasificaciones: [], cuentas_corrientes: [], detalles: [], proveedores: [], tipos_movimiento: [] };

  return (
    <div className="mov-page">
      {toast && <Toast tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={closeToast} />}
      {errorListsCtx && <div className="mov-alert" role="alert">{errorListsCtx}</div>}
      {error && <div className="mov-alert" role="alert">{error}</div>}
      <section className="mov-card mov-card--table">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Movs · Ventas</div>
              <div className="mov-card__hint">Mostrando <b>{filteredRows.length}</b> ventas{hasMore && filteredRows.length > 0 ? " (hay más)" : ""}</div>
            </div>
            <div className="mov-headFilters">
              <div className="cc-filter cc-filter--cal"><div className={`cc-floatingField cc-floatingField--calendar is-active ${showCalendario ? "is-open" : ""}`}><button type="button" className={`cc-calTrigger ${showCalendario ? "is-open" : ""}`} onClick={() => setShowCalendario((v) => !v)} disabled={isAnyLoading || loadingListsCtx} title="Seleccionar rango de fechas">{dateRangeLabel}<span className="cc-calTrigger__iconRight"><FontAwesomeIcon icon={faChevronDown} /></span></button><span className="cc-floatingLabel cc-floatingLabel--active"><FontAwesomeIcon icon={faCalendarDays} /> Período</span>{showCalendario && <div className="cc-calDropdown"><Calendario value={dateRange} onChange={async (newRange) => { if (newRange.from && newRange.to) setShowCalendario(false); await handleDateRangeChange(newRange); }} onClose={() => setShowCalendario(false)} /></div>}</div></div>
              <div className="cc-filter"><div className="cc-floatingField cc-floatingField--search is-active"><div className="cc-searchInput"><div className="cc-searchInput__fieldWrap"><input className="cc-input cc-input--floating" id="vents-comppr-wit" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter") { e.preventDefault(); if (searchTimerRef.current) clearTimeout(searchTimerRef.current); skipSearchRef.current = true; liveTokenRef.current = null; await loadRows({ from: dateRange.from, to: dateRange.to, q: e.currentTarget.value, offset: 0, append: false }); try { const token = await fetchLiveToken(dateRange.from, dateRange.to, e.currentTarget.value); liveTokenRef.current = token; } catch {} } }} placeholder="Buscar por descripción, cliente..." disabled={loadingListsCtx} /><span className="cc-floatingLabel"><FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda</span>{q.trim() !== "" && <button type="button" className="cc-clearSearch cc-clearSearch--inside" title="Limpiar búsqueda" onClick={async () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); setQ(""); skipSearchRef.current = true; liveTokenRef.current = null; await loadRows({ from: dateRange.from, to: dateRange.to, q: "", offset: 0, append: false }); try { const token = await fetchLiveToken(dateRange.from, dateRange.to, ""); liveTokenRef.current = token; } catch {} }}><FontAwesomeIcon icon={faTimes} /></button>}</div></div></div></div>
            </div>
          </div>
          <div className="mov-card__actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <BotonExportar disabled={loadingRows || filteredRows.length === 0} loading={false} label="Exportar" title={filteredRows.length ? "Exportar archivo" : "No hay datos para exportar"} opciones={exportOptions} align="right" />
            <button type="button" className="mov-btn mov-btn--primary" onClick={() => { if (loadingListsCtx) showToast?.("cargando", "Cargando listas… podés ir completando igual.", 2400); setOpenAdd(true); }} title="Crear nuevo movimiento"><FontAwesomeIcon icon={faPlus} /> Nueva Venta</button>
          </div>
        </div>
        <div className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`} style={{ gridTemplateColumns: gridCols }} role="row">{columns.map((c) => <div key={c.key} className={["mov-gridCell", "mov-gridCell--head", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : ""].join(" ")} role="columnheader">{c.label}</div>)}</div>
        <div className="mov-tableWrap" role="rowgroup" ref={tableWrapRef}><div className={["mov-gridBody", "mov-gridBody--relative", loadingRows ? "mov-softLoading" : ""].join(" ")}>{loadingRows ? <div className="mov-skeletonWrap" aria-busy="true">{Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}</div> : <>{filteredRows.map((r) => { const key = getRowKey(r); const tieneComprobante = buildComprobanteCandidatesFromRow(r).length > 0; return <div key={key} className="mov-gridTable mov-gridTable--row" style={{ gridTemplateColumns: gridCols }} role="row">{columns.map((c) => { if (c.key === "acciones") return <div key={c.key} className={["mov-gridCell", "mov-gridCell--actions", "is-center"].join(" ")} role="cell" data-label={c.label}><div className="mov-actionsInline"><button type="button" className={["mov-iconBtn", tieneComprobante ? "mov-iconBtn--comprobante" : "mov-iconBtn--disabled"].join(" ")} title={tieneComprobante ? "Ver comprobantes" : "Sin comprobantes"} disabled={!tieneComprobante || isAnyLoading} onMouseEnter={() => { if (tieneComprobante) handlePrewarmComprobante(r); }} onPointerEnter={() => { if (tieneComprobante) handlePrewarmComprobante(r); }} onFocus={() => { if (tieneComprobante) handlePrewarmComprobante(r); }} onClick={() => { if (tieneComprobante) handleVerComprobante(r); }} style={{ opacity: tieneComprobante ? 1 : 0.35, cursor: tieneComprobante ? "pointer" : "not-allowed" }}><FontAwesomeIcon icon={faEye} /></button><button type="button" className="mov-iconBtn" title="Ver información completa del movimiento" disabled={isAnyLoading} onClick={() => { setSelectedRow(r); setOpenDetalleMovimiento(true); }}><FontAwesomeIcon icon={faInfoCircle} /></button><button type="button" className="mov-iconBtn" title="Emitir nota de crédito" disabled={isAnyLoading || loadingListsCtx} onClick={() => { setSelectedRow(r); setModoNC("NORMAL"); setOpenNC(true); }}><FontAwesomeIcon icon={faFileInvoiceDollar} /></button><button type="button" className="mov-iconBtn mov-iconBtn--danger" title="Eliminar" disabled={isAnyLoading || loadingListsCtx || deletingId === r.id_movimiento} onClick={() => { setSelectedRow(r); setOpenDel(true); }}>{deletingId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={faTrashCan} />}</button></div></div>; const val = c.render ? c.render(r) : safeText(r[c.key]); return <div key={c.key} className={["mov-gridCell", c.align === "right" ? "is-right" : "", c.align === "center" ? "is-center" : "", c.strong ? "is-strong" : ""].filter(Boolean).join(" ")} role="cell" data-label={c.label} title={typeof val === "string" ? val : undefined}><span className="mov-ellipsissss">{val}</span></div>; })}</div>; })}{!isAnyLoading && filteredRows.length === 0 && <div className="cc-emptyState"><FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" /><div className="cc-emptyText">{q.trim() ? `No se encontraron ventas para "${q.trim()}".` : "No hay ventas para mostrar en el rango de fechas seleccionado."}</div></div>}{!loadingRows && hasMore && filteredRows.length > 0 && <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}><button type="button" className="mov-btn mov-btn--loadAll" onClick={handleLoadMore} disabled={loadingMore || loadingListsCtx} title="Cargar los próximos 100 registros">{loadingMore ? "Cargando…" : "Cargar 100 más"}</button></div>}{loadingMore && <div className="mov-skeletonMore" aria-busy="true" aria-label="Cargando más registros">{Array.from({ length: 6 }).map((_, i) => renderSkeletonRow(i))}</div>}</>}</div></div>
      </section>
      <ModalNuevaVenta open={openAdd} lists={lists} periodoDefault={dateRange.from ? `${String(dateRange.from.getMonth() + 1).padStart(2, "0")}-${dateRange.from.getFullYear()}` : ""} onClose={() => setOpenAdd(false)} onToast={showToast} onSaved={async () => { try { setOpenAdd(false); setQ(""); skipSearchRef.current = true; liveTokenRef.current = null; signedUrlCacheRef.current.clear(); signedUrlInFlightRef.current.clear(); await refreshPeriodos(); await reloadVista(); } catch (e) { showToast("error", e?.message || "Se guardó, pero falló la recarga.", 4200); } }} />
      <ModalEliminar
        open={openDel}
        row={selectedRow}
        loading={deletingId === selectedRow?.id_movimiento}
        onClose={() => { setOpenDel(false); setSelectedRow(null); }}
        onConfirm={esVentaFiscal
          ? (notaCreditoFiscalTotal ? () => confirmDelete({ permitirFiscalAnulada: true }) : null)
          : confirmDelete}
        onToast={showToast}
        title={deleteModalConfig.title}
        message={deleteModalConfig.message}
        warning={deleteModalConfig.warning}
        loadingMessage={esVentaFiscal ? "Eliminando venta…" : tieneNotaCreditoInterna ? "Eliminando venta y notas de crédito…" : "Eliminando venta…"}
        successMessage={esVentaFiscal ? "Venta eliminada correctamente." : tieneNotaCreditoInterna ? "Venta y notas de crédito internas eliminadas correctamente." : "Venta eliminada correctamente."}
        errorMessage="No se pudo eliminar la venta."
        confirmLabel={deleteModalConfig.confirmLabel}
        cancelLabel="Cancelar"
        confirmDisabled={deleteModalConfig.confirmDisabled}
        confirmVariant={deleteModalConfig.confirmVariant}
        secondaryActionLabel={deleteModalConfig.secondaryActionLabel}
        onSecondaryAction={esVentaFiscal && !notaCreditoFiscalTotal ? async () => {
          setOpenDel(false);
          setModoNC("ELIMINAR_TOTAL");
          setOpenNC(true);
        } : null}
        details={deleteModalConfig.details}
        extraContent={deleteModalExtraContent}
      />
      <ModalEmitirNotaCreditoVenta
        open={openNC}
        row={selectedRow}
        modo={modoNC}
        onClose={() => { setOpenNC(false); setModoNC("NORMAL"); setSelectedRow(null); }}
        onToast={showToast}
        onDone={async () => {
          const currentId = Number(selectedRow?.id_movimiento || 0);
          const currentRow = selectedRow;
          const currentMode = modoNC;
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
          setOpenNC(false);
          setModoNC("NORMAL");

          let reloadError = null;
          try {
            await reloadVista();
          } catch (e) {
            reloadError = e;
            console.warn("Nota de crédito aplicada, pero no se pudo refrescar la lista automáticamente:", e);
          }

          if (currentMode === "ELIMINAR_TOTAL") {
            const updated = rowsRef.current.find((x) => getMovimientoId(x) === currentId) || (currentRow ? {
              ...currentRow,
              factura_tiene_nota_credito: 1,
              tiene_nota_credito_fiscal: 1,
              nota_credito_total: 1,
              monto_total: 0,
              total: 0,
            } : null);
            setSelectedRow(updated);
            setOpenDel(Boolean(updated));
            showToast(
              reloadError ? "advertencia" : "exito",
              reloadError
                ? "La nota de crédito fue emitida. Ahora confirmá la eliminación; la lista no pudo actualizarse automáticamente."
                : "Nota de crédito emitida. Ahora ya podés eliminar la venta.",
              reloadError ? 5200 : 3600
            );
            return;
          }

          setSelectedRow(null);
          showToast(
            reloadError ? "advertencia" : "exito",
            reloadError
              ? "La nota de crédito fue aplicada, pero no se pudo actualizar la lista automáticamente."
              : "Nota de crédito aplicada. La venta original se conserva en el historial.",
            reloadError ? 5200 : 3800
          );
        }}
      />
      <ModalDetalleMovimientoVenta
        open={openDetalleMovimiento}
        row={selectedRow}
        onClose={() => {
          setOpenDetalleMovimiento(false);
          if (!openDel) setSelectedRow(null);
        }}
      />
      <ModalVerComprobante open={openVerComprobante} url={comprobanteUrl} mime={comprobanteMime} documents={comprobanteDocs} title="Comprobantes de Venta" onClose={() => { setOpenVerComprobante(false); setComprobanteUrl(""); setComprobanteMime(""); setComprobanteDocs([]); }} />
    </div>
  );
}
