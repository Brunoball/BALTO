import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ventasFetch } from "../api/ventasApi.js";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faCreditCard,
  faMoneyBillTrendUp,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import BASE_URL from "../../../../config/config.jsx";
import ModalFacturaBaltoResumen from "../../Facturacion/ModalFacturaBaltoResumen.jsx";
import { saveNotaCreditoPdf } from "../../../../utils/NotaCreditoPdfBuilder.js";
import "../../../Global/Global_css/roots.css";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "./ModalEmitirNotaCreditoVenta.css";
import { DEMO_BLOCK_MESSAGE, isBaltoDemoMode } from "../../../../utils/demoMode";

const MOTIVOS = [
  ["DEVOLUCION_MERCADERIA", "DEVOLUCIÓN DE MERCADERÍA"],
  ["DESCUENTO", "DESCUENTO"],
  ["BONIFICACION", "BONIFICACIÓN"],
  ["ANULACION_TOTAL", "ANULACIÓN TOTAL"],
  ["DIFERENCIA_PRECIO", "DIFERENCIA DE PRECIO"],
  ["OTRO", "OTRO AJUSTE"],
];

const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

const MOTIVOS_AJUSTE_SIN_STOCK = ["DESCUENTO", "BONIFICACION", "DIFERENCIA_PRECIO", "OTRO"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function safeStr(v) { return String(v ?? "").trim(); }
function onlyDigits(v) { return String(v ?? "").replace(/\D/g, ""); }
function money(v) {
  return Number(v || 0).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
function numberValue(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function boundedNumberValue(value, maximum) {
  const raw = String(value ?? "");
  if (raw === "") return "";

  const parsed = Number(raw.replace(",", "."));
  const max = Math.max(0, Number(maximum) || 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max + 0.000001) return null;
  return raw;
}

function preventInvalidNumberKeys(event) {
  if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault();
}
function notaCreditoStorageScope() {
  try {
    return Number(getAuthInfo()?.idUsuario || 0) || 0;
  } catch {
    return 0;
  }
}
function makeIdempotencyKey(id, modo = "NORMAL", scope = "ventas") {
  const uuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const suffix = safeStr(modo).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "normal";
  const scopeKey = safeStr(scope).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "ventas";
  return `nc-${scopeKey}-${notaCreditoStorageScope()}-${id || 0}-${suffix}-${uuid}`.slice(0, 100);
}
function notaCreditoStorageKey(id, modo = "NORMAL", scope = "ventas") {
  const suffix = safeStr(modo).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "normal";
  const scopeKey = safeStr(scope).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "ventas";
  return `balto:arca:nota-credito:${scopeKey}:${notaCreditoStorageScope()}:${Number(id || 0)}:${suffix}`;
}
function getOrCreateNotaCreditoKey(id, modo = "NORMAL", scope = "ventas") {
  const idMovimiento = Number(id || 0);
  if (!idMovimiento) return "";
  const storageKey = notaCreditoStorageKey(idMovimiento, modo, scope);
  try {
    const existing = safeStr(window.localStorage?.getItem(storageKey));
    if (existing) return existing;
    const created = makeIdempotencyKey(idMovimiento, modo, scope);
    window.localStorage?.setItem(storageKey, created);
    return created;
  } catch {
    return makeIdempotencyKey(idMovimiento, modo, scope);
  }
}
function clearNotaCreditoKey(id, modo = "NORMAL", scope = "ventas") {
  const idMovimiento = Number(id || 0);
  if (!idMovimiento) return;
  try {
    window.localStorage?.removeItem(notaCreditoStorageKey(idMovimiento, modo, scope));
  } catch {
    // La recuperación local no debe impedir que finalice la nota de crédito.
  }
}
function ymd8FromAny(v) {
  const s = safeStr(v);
  if (/^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replaceAll("-", "");
  return onlyDigits(s).slice(0, 8);
}
function normalizeCbtesAsocNC(items, facturaOriginal = null) {
  const source = Array.isArray(items) && items.length ? items : facturaOriginal ? [facturaOriginal] : [];
  const out = [];
  const seen = new Set();
  source.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const tipo = Number(row.tipo ?? row.Tipo ?? row.cbte_tipo ?? 0);
    const ptoVta = Number(row.pto_vta ?? row.PtoVta ?? row.punto_venta ?? 0);
    const nro = Number(row.nro ?? row.Nro ?? row.cbte_nro ?? row.numero ?? 0);
    if (!tipo || !ptoVta || !nro) return;
    const item = { tipo, pto_vta: ptoVta, nro, Tipo: tipo, PtoVta: ptoVta, Nro: nro };
    const cuit = onlyDigits(row.cuit ?? row.Cuit ?? row.cuit_emisor ?? "");
    const fecha = ymd8FromAny(row.fecha ?? row.cbte_fch ?? row.fecha_cbte ?? "");
    if (cuit) item.cuit = cuit;
    if (/^\d{8}$/.test(fecha)) item.fecha = fecha;
    const key = `${tipo}-${ptoVta}-${nro}`;
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  });
  return out;
}
function getAuthInfo() {
  const token = (localStorage.getItem("token") || "").trim();
  const sessionKey = (localStorage.getItem("session_key") || localStorage.getItem("sessionKey") || localStorage.getItem("X-Session") || "").trim();
  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    idUsuario = Number(u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? 0) || 0;
  } catch {}
  return { token, sessionKey, idUsuario };
}
function headers(json = false) {
  const { token, sessionKey } = getAuthInfo();
  const h = json ? { "Content-Type": "application/json" } : {};
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function parseJsonOrThrow(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { throw new Error(text || "Respuesta inválida del servidor."); }
  if (!res.ok || !data?.exito) throw new Error(data?.mensaje || data?.message || "Error en la operación.");
  return data;
}
function extractFacturaPayload(factEmitida) {
  return factEmitida?.factura || factEmitida?.data?.factura || factEmitida?.data || factEmitida || null;
}
function letraComprobante(tipo) {
  const map = { 1: "A", 3: "A", 6: "B", 8: "B", 11: "C", 13: "C" };
  return map[Number(tipo)] || "";
}
function numeroComprobante(ptoVta, numero) {
  const pv = Number(ptoVta || 0);
  const nro = Number(numero || 0);
  if (!pv || !nro) return "—";
  return `${String(pv).padStart(5, "0")}-${String(nro).padStart(8, "0")}`;
}

function ajustarItemsAlTotal(items, objetivo) {
  const totalObjetivo = Number(Number(objetivo || 0).toFixed(2));
  const base = Number(items.reduce((acc, item) => acc + Number(item.total || 0), 0).toFixed(2));
  if (!items.length || totalObjetivo <= 0 || base <= 0) return items;

  const factor = totalObjetivo / base;
  let acumulado = 0;
  return items.map((item, index) => {
    const esUltimo = index === items.length - 1;
    const totalAnterior = Number(item.total || 0);
    const subtotalAnterior = Number(item.subtotal || 0);
    const total = esUltimo
      ? Number(Math.max(0, totalObjetivo - acumulado).toFixed(2))
      : Number((totalAnterior * factor).toFixed(2));
    acumulado = Number((acumulado + total).toFixed(2));
    const proporcionSubtotal = totalAnterior > 0 ? Math.min(1, subtotalAnterior / totalAnterior) : 1;
    const subtotal = Number((total * proporcionSubtotal).toFixed(2));
    const iva_monto = Number((total - subtotal).toFixed(2));
    return { ...item, subtotal, iva_monto, total };
  });
}

export default function ModalEmitirNotaCreditoVenta({
  open,
  row,
  onClose,
  onToast,
  onDone,
  modo = "NORMAL",
  scope = "ventas",
  entityLabel = "venta",
  entityTitle = "Venta",
}) {
  const API = `${BASE_URL}/api.php`;
  const actionScope = scope === "otros_ingresos" ? "otros_ingresos" : "ventas";
  const operationContext = actionScope === "otros_ingresos"
    ? "NOTA_CREDITO_OTRO_INGRESO"
    : "NOTA_CREDITO_VENTA";
  const creditActionUrl = useCallback((operation, params = {}) => {
    const search = new URLSearchParams();
    if (actionScope === "otros_ingresos") {
      // Compatibilidad real con api.php desplegados antes de las acciones
      // `otros_ingresos_nota_credito_*`: esas versiones ya conocen Obtener y
      // Actualizar, y el subrouter traduce `operacion` al servicio de NC.
      search.set("action", operation === "contexto" ? "otros_ingresos_obtener" : "otros_ingresos_actualizar");
      search.set("operacion", `nota_credito_${operation}`);
    } else {
      search.set("action", `${actionScope}_nota_credito_${operation}`);
    }
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
    });
    return `${API}?${search.toString()}`;
  }, [API, actionScope]);
  const creditPayload = useCallback((operation, payload) => (
    actionScope === "otros_ingresos"
      ? { ...payload, operacion: `nota_credito_${operation}` }
      : payload
  ), [actionScope]);
  const esEliminacionTotal = modo === "ELIMINAR_TOTAL";
  const [contexto, setContexto] = useState(null);
  const [items, setItems] = useState([]);
  const [motivo, setMotivo] = useState("DEVOLUCION_MERCADERIA");
  const [observaciones, setObservaciones] = useState("");
  const [importeAjuste, setImporteAjuste] = useState("");
  const [ivaAjuste, setIvaAjuste] = useState("0");
  const [descripcionAjuste, setDescripcionAjuste] = useState("DESCUENTO / BONIFICACIÓN");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openResumen, setOpenResumen] = useState(false);
  const idempotencyRef = useRef("");

  const showToast = useCallback((tipo, mensaje, duracion = 3200) => onToast?.(tipo, mensaje, duracion), [onToast]);

  const cargarContexto = useCallback(async () => {
    const id = Number(row?.id_movimiento || 0);
    if (!id) return;
    setLoading(true); setError("");
    try {
      const res = await ventasFetch(creditActionUrl("contexto", { id_movimiento: id }), { headers: headers() });
      const data = await parseJsonOrThrow(res);
      const ctx = data.contexto || data.data?.contexto || null;
      setContexto(ctx);
      const itemsContexto = (ctx?.items || []).map((it) => ({
        id_item_origen: Number(it.id_item),
        descripcion: it.descripcion_resuelta || it.descripcion || "Ítem",
        disponible: Number(it.cantidad_disponible || 0),
        cantidadOriginal: Number(it.cantidad_original || it.cantidad || 0),
        precio: Number(it.precio || 0),
        subtotalOriginal: Number(it.subtotal || 0),
        ivaMontoOriginal: Number(it.iva_monto || 0),
        totalOriginal: Number(it.total || 0),
        iva_pct: Number(it.iva_pct || 0),
        cantidad: esEliminacionTotal && Number(it.cantidad_disponible || 0) > 0 ? String(Number(it.cantidad_disponible || 0)) : "",
        tiene_stock: Number(it.id_stock_producto || 0) > 0 || Number(it.id_stock_variante || 0) > 0,
        afecta_stock: Number(it.id_stock_producto || 0) > 0 || Number(it.id_stock_variante || 0) > 0,
      }));
      setItems(itemsContexto);
      if (esEliminacionTotal) setMotivo("ANULACION_TOTAL");
      const ivaVenta = itemsContexto.find((it) => Number.isFinite(it.iva_pct))?.iva_pct ?? 0;
      setIvaAjuste(String(ivaVenta));
    } catch (e) { setError(e.message || `No se pudo cargar el ${entityLabel}.`); }
    finally { setLoading(false); }
  }, [row, esEliminacionTotal, entityLabel, creditActionUrl]);

  useEffect(() => {
    if (!open) return;
    idempotencyRef.current = getOrCreateNotaCreditoKey(row?.id_movimiento, modo, actionScope);
    setContexto(null); setItems([]); setMotivo(esEliminacionTotal ? "ANULACION_TOTAL" : "DEVOLUCION_MERCADERIA"); setObservaciones("");
    setImporteAjuste(""); setIvaAjuste("0"); setDescripcionAjuste("DESCUENTO / BONIFICACIÓN");
    setError(""); setOpenResumen(false); cargarContexto();
  }, [open, row?.id_movimiento, cargarContexto, esEliminacionTotal, modo, actionScope]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const key = (e) => { if (e.key === "Escape" && !openResumen && !loading) onClose?.(); };
    document.addEventListener("keydown", key, true);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", key, true); };
  }, [open, openResumen, loading, onClose]);

  const esAjusteSinStock = MOTIVOS_AJUSTE_SIN_STOCK.includes(motivo);

  useEffect(() => {
    if (motivo === "ANULACION_TOTAL") {
      setItems((prev) => prev.map((it) => ({
        ...it,
        cantidad: it.disponible > 0 ? String(it.disponible) : "",
        afecta_stock: Boolean(it.tiene_stock),
      })));
      setImporteAjuste("");
    } else if (esAjusteSinStock) {
      setItems((prev) => prev.map((it) => ({ ...it, cantidad: "", afecta_stock: false })));
      const labels = {
        DESCUENTO: "DESCUENTO",
        BONIFICACION: "BONIFICACIÓN",
        DIFERENCIA_PRECIO: "DIFERENCIA DE PRECIO",
        OTRO: "OTRO AJUSTE",
      };
      setDescripcionAjuste(labels[motivo] || "DESCUENTO / BONIFICACIÓN");
    } else {
      setImporteAjuste("");
      setItems((prev) => prev.map((it) => ({ ...it, afecta_stock: Boolean(it.tiene_stock) })));
    }
  }, [motivo, esAjusteSinStock]);

  const totalDisponible = Number(contexto?.total_disponible || 0);
  const itemsSeleccionadosBase = useMemo(() => items.filter((it) => numberValue(it.cantidad) > 0).map((it) => {
    const cantidad = numberValue(it.cantidad);
    const qOriginal = Math.max(0.000001, it.cantidadOriginal);
    const subtotal = Number(((it.subtotalOriginal / qOriginal) * cantidad).toFixed(2));
    const iva_monto = Number(((it.ivaMontoOriginal / qOriginal) * cantidad).toFixed(2));
    const total = Number(((it.totalOriginal / qOriginal) * cantidad).toFixed(2));
    return { ...it, cantidad, subtotal, iva_monto, total };
  }), [items]);
  const itemsSeleccionados = useMemo(
    () => esEliminacionTotal ? ajustarItemsAlTotal(itemsSeleccionadosBase, totalDisponible) : itemsSeleccionadosBase,
    [esEliminacionTotal, itemsSeleccionadosBase, totalDisponible]
  );
  const ajuste = esEliminacionTotal && itemsSeleccionados.length === 0
    ? Math.max(0, totalDisponible)
    : (esAjusteSinStock ? Math.max(0, numberValue(importeAjuste)) : 0);
  const totalSeleccionado = useMemo(() => Number((itemsSeleccionados.reduce((a, it) => a + it.total, 0) + ajuste).toFixed(2)), [itemsSeleccionados, ajuste]);
  const modalidad = contexto?.modalidad_requerida || "INTERNA";
  const facturaOriginal = contexto?.factura_original || null;
  const asociacionFiscalValida = modalidad !== "ARCA" || Boolean(
    Number(facturaOriginal?.id_comprobante_fiscal || 0) > 0 &&
    Number(facturaOriginal?.cbte_tipo || 0) > 0 &&
    Number(facturaOriginal?.pto_vta || 0) > 0 &&
    Number(facturaOriginal?.cbte_nro || 0) > 0 &&
    safeStr(facturaOriginal?.cae)
  );
  const excede = totalSeleccionado - totalDisponible > 0.05;
  const coincideTotalEliminacion = !esEliminacionTotal || Math.abs(totalSeleccionado - totalDisponible) <= 0.05;
  const puedeContinuar = totalSeleccionado > 0 && !excede && coincideTotalEliminacion && asociacionFiscalValida && itemsSeleccionados.every((it) => it.cantidad <= it.disponible + 0.0001);

  const payloadBase = useCallback(() => ({
    id_movimiento_origen: Number(row?.id_movimiento),
    modalidad,
    motivo,
    fecha: todayISO(),
    observaciones,
    id_usuario: getAuthInfo().idUsuario || null,
    idempotency_key: idempotencyRef.current,
    eliminar_movimiento_total: esEliminacionTotal ? 1 : 0,
    items: esAjusteSinStock || (esEliminacionTotal && itemsSeleccionados.length === 0)
      ? []
      : itemsSeleccionados.map((it) => ({ id_item_origen: it.id_item_origen, cantidad: it.cantidad, afecta_stock: Boolean(it.afecta_stock) })),
    importe_ajuste: esAjusteSinStock || (esEliminacionTotal && itemsSeleccionados.length === 0) ? ajuste : 0,
    iva_pct_ajuste: Math.max(0, numberValue(ivaAjuste)),
    descripcion_ajuste: esEliminacionTotal ? "ANULACIÓN TOTAL" : (descripcionAjuste || "DESCUENTO / BONIFICACIÓN"),
  }), [row, modalidad, motivo, observaciones, esAjusteSinStock, esEliminacionTotal, itemsSeleccionados, ajuste, ivaAjuste, descripcionAjuste]);

  const itemsFactura = useMemo(() => {
    const out = itemsSeleccionados.map((it) => ({
      codigo: String(it.id_item_origen), descripcion: it.descripcion, cantidad: it.cantidad,
      precio: Number((it.subtotal / it.cantidad).toFixed(2)), precio_unitario: Number((it.subtotal / it.cantidad).toFixed(2)),
      subtotal: it.subtotal, iva_pct: it.iva_pct, iva_monto: it.iva_monto, total: it.total,
    }));
    if (ajuste > 0) {
      const pct = Math.max(0, numberValue(ivaAjuste));
      const subtotal = pct > 0 ? Number((ajuste / (1 + pct / 100)).toFixed(2)) : ajuste;
      out.push({ codigo: "AJ", descripcion: esEliminacionTotal ? "ANULACIÓN TOTAL" : (descripcionAjuste || "DESCUENTO / BONIFICACIÓN"), cantidad: 1, precio: subtotal, precio_unitario: subtotal, subtotal, iva_pct: pct, iva_monto: Number((ajuste - subtotal).toFixed(2)), total: ajuste });
    }
    return out;
  }, [itemsSeleccionados, ajuste, ivaAjuste, descripcionAjuste, esEliminacionTotal]);

  const resumenData = useMemo(() => {
    if (!contexto) return null;
    const mov = contexto.movimiento || {};
    const cf = contexto.cliente_facturacion || {};
    const cfg = contexto.config_facturacion || {};
    return {
      id_movimiento: Number(row?.id_movimiento || 0), labelCliente: cf.razon_social || mov.cliente_nombre || "Cliente",
      labelSistema: `Nota de crédito de ${entityLabel} #${row?.id_movimiento || ""}`, cliente_facturacion: cf,
      id_cliente: mov.id_cliente || null, id_tipo_venta: mov.id_tipo_venta || null,
      fecha_cbte_iso: todayISO(), vto_pago_iso: todayISO(), cbte_tipo: Number(contexto?.nota_credito?.cbte_tipo || 13),
      pto_vta: Number(contexto?.nota_credito?.pto_vta || 2), items_facturacion: itemsFactura,
      total_ars: totalSeleccionado, monto: totalSeleccionado, importe: totalSeleccionado,
      observaciones: observaciones || MOTIVOS.find(([k]) => k === motivo)?.[1] || "Nota de crédito", concepto: 1,
      config_facturacion: cfg, id_config_facturacion: cfg.id_config_facturacion || cfg.idConfigFacturacion || null,
      idConfigFacturacion: cfg.idConfigFacturacion || cfg.id_config_facturacion || null, emisor: cfg,
      id_comprobante_original: Number(contexto?.factura_original?.id_comprobante || 0) || null,
      id_comprobante_fiscal_original: Number(contexto?.factura_original?.id_comprobante_fiscal || 0) || null,
      cbtes_asoc: normalizeCbtesAsocNC(
        (contexto.cbtes_asoc || []).map((asoc) => ({ ...asoc, cuit_emisor: safeStr(cfg.cuit) })),
        {
          ...(contexto.factura_original || {}),
          cuit_emisor: safeStr(cfg.cuit),
        }
      ),
      factura_original: {
        ...(contexto.factura_original || {}),
        cuit_emisor: safeStr(cfg.cuit),
      },
      emisor_nombre: safeStr(cfg.razon_social || cfg.nombre_fantasia || cfg.emisor_nombre), emisor_domicilio: safeStr(cfg.domicilio_comercial),
      cuit_emisor: safeStr(cfg.cuit), cond_iva_emisor: safeStr(cfg.condicion_iva), ingresos_brutos_emisor: safeStr(cfg.ingresos_brutos),
      fecha_inicio_actividades_emisor: safeStr(cfg.fecha_inicio_actividades), logo_url: safeStr(cfg.logo_url), modalidad,
      operacion_key: idempotencyRef.current,
      operacion_contexto: operationContext,
      operacion_id_origen: Number(row?.id_movimiento || 0) || null,
    };
  }, [contexto, row, itemsFactura, totalSeleccionado, observaciones, motivo, modalidad, entityLabel, operationContext]);

  const uploadPdf = useCallback(async (idMovimientoDestino, pdfBlob, filename, tipo, meta) => {
    const fd = new FormData(); fd.append("tipo", tipo); fd.append("id_movimiento", String(idMovimientoDestino));
    fd.append("pdf", pdfBlob, filename); fd.append("meta", JSON.stringify(meta || {}));
    const res = await ventasFetch(`${API}?action=${actionScope}_comprobantes_vincular_movimiento`, { method: "POST", headers: headers(), body: fd });
    return parseJsonOrThrow(res);
  }, [API, actionScope]);

  const crearInterna = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await ventasFetch(creditActionUrl("crear"), {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(creditPayload("crear", payloadBase())),
      });
      const data = await parseJsonOrThrow(res);
      const idNcMov = Number(data.id_movimiento_nota_credito || data.data?.id_movimiento_nota_credito || 0);
      if (idNcMov) {
        try {
          const pdf = await saveNotaCreditoPdf({ ...resumenData, modalidad: "INTERNA", cbte_tipo: 0, pto_vta: 0, cbte_nro: idNcMov, resultado: "INTERNA", fecha_cbte: todayISO(), items_facturacion: itemsFactura }, { autoDownload: false });
          if (pdf?.pdfBlob) await uploadPdf(idNcMov, pdf.pdfBlob, pdf.pdfFilename || `nota_credito_interna_${idNcMov}.pdf`, "NOTA_CREDITO_INTERNA", { tipo: "NOTA_CREDITO_INTERNA", id_movimiento_origen: row.id_movimiento, motivo, observaciones });
        } catch (pdfError) { showToast("advertencia", `La nota quedó aplicada, pero no se pudo guardar el PDF: ${pdfError.message}`, 5200); }
      }
      clearNotaCreditoKey(row?.id_movimiento, modo, actionScope);
      idempotencyRef.current = "";
      showToast("exito", "Nota de crédito interna aplicada correctamente."); await onDone?.(data);
    } catch (e) { setError(e.message || "No se pudo aplicar la nota de crédito."); showToast("error", e.message || "No se pudo aplicar la nota de crédito.", 4400); }
    finally { setLoading(false); }
  }, [payloadBase, resumenData, itemsFactura, uploadPdf, row, motivo, observaciones, showToast, onDone, modo, actionScope, creditActionUrl, creditPayload]);

  const handleEmitida = useCallback(async (factEmitida) => {
    setLoading(true); setError("");
    try {
      const fiscal = extractFacturaPayload(factEmitida);
      if (!fiscal?.cae || String(fiscal?.resultado || "").toUpperCase() !== "A") throw new Error("ARCA no autorizó la nota de crédito.");
      let pdfBlob = factEmitida?.pdf_blob instanceof Blob ? factEmitida.pdf_blob : null;
      let filename = safeStr(factEmitida?.pdf_filename) || `nota_credito_${row.id_movimiento}.pdf`;
      if (!pdfBlob) {
        const out = await saveNotaCreditoPdf({ ...resumenData, ...fiscal, fecha_cbte_iso: fiscal.fecha_cbte || todayISO(), items_facturacion: itemsFactura }, { autoDownload: false });
        pdfBlob = out?.pdfBlob; filename = out?.pdfFilename || filename;
      }
      if (!(pdfBlob instanceof Blob)) throw new Error("No se pudo generar el PDF de la nota de crédito.");
      const fiscalJson = {
        ...(fiscal?.json_arca && typeof fiscal.json_arca === "object" ? fiscal.json_arca : {}),
        cuit_emisor: safeStr(fiscal.cuit_emisor || resumenData.cuit_emisor),
        comprobante: {
          cbte_tipo: Number(fiscal.cbte_tipo || resumenData.cbte_tipo),
          pto_vta: Number(fiscal.pto_vta || resumenData.pto_vta),
          cbte_nro: Number(fiscal.cbte_nro || 0),
          resultado: fiscal.resultado,
          cae: fiscal.cae,
          cae_vto: fiscal.cae_vto,
          fecha_cbte: fiscal.fecha_cbte,
          doc_tipo: fiscal.doc_tipo,
          doc_nro: fiscal.doc_nro,
          imp_total: Number(fiscal.imp_total || totalSeleccionado),
          imp_neto: Number(fiscal.imp_neto || 0),
          imp_iva: Number(fiscal.imp_iva || 0),
          cbtes_asoc: resumenData.cbtes_asoc,
        },
        cbtes_asoc: resumenData.cbtes_asoc,
        factura_original: resumenData.factura_original,
      };
      const upload = await uploadPdf(row.id_movimiento, pdfBlob, filename, "NOTA_CREDITO", {
        tipo: "NOTA_CREDITO", emitido_en_arca: 1, id_movimiento: row.id_movimiento,
        id_comprobante_origen: contexto?.factura_original?.id_comprobante,
        id_comprobante_fiscal_original: contexto?.factura_original?.id_comprobante_fiscal,
        ...fiscal, json_arca: fiscalJson, motivo, observaciones,
        cbtes_asoc: resumenData.cbtes_asoc, factura_origen: resumenData.factura_original || null,
      });
      const idArchivo = Number(upload.id_comprobante || upload.data?.id_comprobante || 0);
      if (!idArchivo) throw new Error("No se obtuvo el identificador del comprobante fiscal.");
      const body = { ...payloadBase(), modalidad: "ARCA", id_comprobante_nota_credito: idArchivo,
        id_comprobante_original: Number(contexto?.factura_original?.id_comprobante || 0),
        id_comprobante_fiscal_original: Number(contexto?.factura_original?.id_comprobante_fiscal || 0),
        factura_original: resumenData.factura_original,
        cbtes_asoc: resumenData.cbtes_asoc,
        importe_fiscal: Number(fiscal.imp_total || totalSeleccionado)
      };
      const res = await ventasFetch(creditActionUrl("aplicar"), {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(creditPayload("aplicar", body)),
      });
      const data = await parseJsonOrThrow(res);
      if (!esEliminacionTotal) {
        showToast("exito", "Nota de crédito ARCA autorizada y aplicada correctamente.", 4200);
      }
      clearNotaCreditoKey(row?.id_movimiento, modo, actionScope);
      idempotencyRef.current = "";
      setOpenResumen(false);
      await onDone?.(data);
    } catch (e) { setError(e.message || "No se pudo registrar la nota de crédito."); showToast("error", e.message || "No se pudo registrar la nota de crédito.", 4800); }
    finally { setLoading(false); }
  }, [row, contexto, resumenData, itemsFactura, totalSeleccionado, uploadPdf, motivo, observaciones, payloadBase, showToast, onDone, esEliminacionTotal, modo, actionScope, creditActionUrl, creditPayload]);

  const continuar = () => {
    if (isBaltoDemoMode()) return showToast("advertencia", DEMO_BLOCK_MESSAGE, 5200);
    if (modalidad === "ARCA" && !asociacionFiscalValida) {
      return setError("No se pudo identificar correctamente la factura ARCA original. No se emitirá ninguna nota de crédito sin el comprobante asociado.");
    }
    if (!puedeContinuar) {
      if (esEliminacionTotal && !coincideTotalEliminacion) return setError(`No se pudo calcular exactamente el saldo total pendiente del ${entityLabel}.`);
      return setError(excede ? "El importe supera el saldo disponible." : "Seleccioná ítems o ingresá un descuento.");
    }
    if (modalidad === "ARCA") setOpenResumen(true); else crearInterna();
  };

  if (!open) return null;

  const notasAnteriores = contexto?.notas_credito?.map(
    (nota) => `${nota.comprobante_numero || `#${nota.id_movimiento_nc}`} (${money(nota.total)})`
  ).join(" · ");

  return createPortal(
    <>
      <div className="gm-modal-overlay">
        <div
          className="gm-modal-container gm-modal-v2 ncv-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ncv-modal-title"
        >
          <header className="gm-modal-header">
            <div className="gm-modal-head-icon ncv-modal__head-icon" aria-hidden="true">↩</div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title" id="ncv-modal-title">
                {esEliminacionTotal ? "Emitir nota de crédito" : `Nota de crédito de ${entityLabel}`}
              </h2>
              <p className="gm-modal-subtitle">
                {entityTitle} #{row?.id_movimiento || "—"} ·{" "}
                {esEliminacionTotal
                  ? "Anulación total"
                  : modalidad === "ARCA"
                    ? "Emisión ARCA"
                    : "Comprobante interno"}
              </p>
            </div>
            <button
              type="button"
              className="gm-modal-close"
              onClick={onClose}
              disabled={loading}
              aria-label="Cerrar modal"
            >
              ✕
            </button>
          </header>

          <div className="gm-modal-content ncv-modal__body">
            {loading && !contexto && (
              <div className="ncv-feedback ncv-feedback--loading" role="status">
                <span className="ncv-feedback__dot" aria-hidden="true" />
                Cargando {entityLabel}…
              </div>
            )}

            {error && (
              <div className="ncv-feedback ncv-feedback--error" role="alert">
                {error}
              </div>
            )}

            {contexto && (
              <>
                {modalidad === "ARCA" && (
                  <div className="gm-info-box ncv-arca-notice">
                    <div className="ncv-arca-notice__title">{entityTitle} facturado en ARCA</div>
                    <div className="ncv-arca-notice__text">
                      {esEliminacionTotal ? (
                        <>
                          Se emitirá una{" "}
                          <b>NOTA DE CRÉDITO {letraComprobante(contexto?.nota_credito?.cbte_tipo)} TOTAL</b>{" "}
                          por todo el saldo pendiente y se asociará a la{" "}
                          <b>
                            FACTURA {letraComprobante(facturaOriginal?.cbte_tipo)}{" "}
                            {numeroComprobante(facturaOriginal?.pto_vta, facturaOriginal?.cbte_nro)}
                          </b>
                          . Después volverás al modal de eliminación para confirmar si querés borrar el registro.
                        </>
                      ) : (
                        <>
                          Al confirmar, Balto emitirá una{" "}
                          <b>NOTA DE CRÉDITO {letraComprobante(contexto?.nota_credito?.cbte_tipo)}</b>{" "}
                          en ARCA y la asociará obligatoriamente a la{" "}
                          <b>
                            FACTURA {letraComprobante(facturaOriginal?.cbte_tipo)}{" "}
                            {numeroComprobante(facturaOriginal?.pto_vta, facturaOriginal?.cbte_nro)}
                          </b>
                          . Podés acreditar una parte o anular el total disponible.
                        </>
                      )}
                    </div>
                    <div className="ncv-arca-notice__meta">
                      <span>Comprobante asociado</span>
                      <strong>
                        FACTURA {letraComprobante(facturaOriginal?.cbte_tipo)}{" "}
                        {numeroComprobante(facturaOriginal?.pto_vta, facturaOriginal?.cbte_nro)}
                      </strong>
                      <span>CAE</span>
                      <strong>{safeStr(facturaOriginal?.cae) || "—"}</strong>
                    </div>
                  </div>
                )}

                {esEliminacionTotal && (
                  <div className="ncv-detail-grid">
                    <section className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>Factura original</span>
                      </div>
                      <div className="gm-section-body ncv-detail-list">
                        <div className="ncv-detail-row">
                          <span>Tipo</span>
                          <strong>FACTURA {letraComprobante(facturaOriginal?.cbte_tipo) || "—"}</strong>
                        </div>
                        <div className="ncv-detail-row">
                          <span>Comprobante</span>
                          <strong>{numeroComprobante(facturaOriginal?.pto_vta, facturaOriginal?.cbte_nro)}</strong>
                        </div>
                        <div className="ncv-detail-row">
                          <span>CAE</span>
                          <strong>{safeStr(facturaOriginal?.cae) || "—"}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>Cliente fiscal</span>
                      </div>
                      <div className="gm-section-body ncv-detail-list">
                        <div className="ncv-detail-row">
                          <span>Razón social</span>
                          <strong>
                            {contexto?.cliente_facturacion?.razon_social
                              || contexto?.movimiento?.cliente_nombre
                              || "—"}
                          </strong>
                        </div>
                        <div className="ncv-detail-row">
                          <span>CUIT / Documento</span>
                          <strong>
                            {safeStr(
                              contexto?.cliente_facturacion?.doc_nro
                              || contexto?.cliente_facturacion?.cuit
                            ) || "—"}
                          </strong>
                        </div>
                      </div>
                    </section>
                  </div>
                )}

                <div
                  className={`ncv-summary-grid${esEliminacionTotal ? " ncv-summary-grid--three" : ""}`}
                  aria-label="Resumen de importes"
                >
                  <article className="ncv-summary-card ncv-summary-card--blue">
                    <div className="ncv-summary-card__icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faMoneyBillTrendUp} />
                    </div>
                    <div className="ncv-summary-card__body">
                      <span className="ncv-summary-card__label">Total original</span>
                      <b className="ncv-summary-card__value">{money(contexto.total_original)}</b>
                      <span className="ncv-summary-card__detail">Importe del {entityLabel}</span>
                    </div>
                  </article>

                  <article className="ncv-summary-card ncv-summary-card--pink">
                    <div className="ncv-summary-card__icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faCreditCard} />
                    </div>
                    <div className="ncv-summary-card__body">
                      <span className="ncv-summary-card__label">Ya acreditado</span>
                      <b className="ncv-summary-card__value">{money(contexto.total_acreditado)}</b>
                      <span className="ncv-summary-card__detail">Notas anteriores</span>
                    </div>
                  </article>

                  {!esEliminacionTotal && (
                    <article className="ncv-summary-card ncv-summary-card--yellow">
                      <div className="ncv-summary-card__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faWallet} />
                      </div>
                      <div className="ncv-summary-card__body">
                        <span className="ncv-summary-card__label">Disponible</span>
                        <b className="ncv-summary-card__value">{money(totalDisponible)}</b>
                        <span className="ncv-summary-card__detail">Saldo por acreditar</span>
                      </div>
                    </article>
                  )}

                  <article className="ncv-summary-card ncv-summary-card--green">
                    <div className="ncv-summary-card__icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faArrowDown} />
                    </div>
                    <div className="ncv-summary-card__body">
                      <span className="ncv-summary-card__label">
                        {esEliminacionTotal ? "Nota a emitir" : "Esta nota"}
                      </span>
                      <b className="ncv-summary-card__value">{money(totalSeleccionado)}</b>
                      <span className="ncv-summary-card__detail">Importe seleccionado</span>
                    </div>
                  </article>
                </div>

                <div className="ncv-form-grid">
                  {esEliminacionTotal ? (
                    <div className="gm-field">
                      <input
                        className="gm-input"
                        value="ANULACIÓN TOTAL"
                        placeholder=" "
                        disabled
                        readOnly
                      />
                      <label className="gm-label">Motivo</label>
                    </div>
                  ) : (
                    <div className="gm-field">
                      <select
                        className="gm-input gm-select"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        disabled={loading}
                      >
                        {MOTIVOS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                      <label className="gm-label gm-label--up">Motivo</label>
                    </div>
                  )}

                  <div className="gm-field">
                    <input
                      className="gm-input"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value.toUpperCase())}
                      placeholder=" "
                      disabled={loading}
                    />
                    <label className="gm-label">Observaciones</label>
                  </div>
                </div>

                {!esEliminacionTotal && !esAjusteSinStock && (
                  <section className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Ítems del {entityLabel}</span>
                    </div>
                    <div className="gm-section-body ncv-products-body">
                      <div className="gm-table ncv-table" role="table" aria-label={`Ítems del ${entityLabel}`}>
                        <div className="gm-table-head" role="row">
                          <div className="gm-table-th" role="columnheader">Producto</div>
                          <div className="gm-table-th" role="columnheader">Disponible</div>
                          <div className="gm-table-th" role="columnheader">Devuelve / acredita</div>
                          <div className="gm-table-th" role="columnheader">Reingresa stock</div>
                          <div className="gm-table-th" role="columnheader">Importe</div>
                        </div>
                        <div className="gm-table-body">
                          {items.map((item, index) => {
                            const seleccionado = itemsSeleccionados.find(
                              (selectedItem) => selectedItem.id_item_origen === item.id_item_origen
                            );
                            const stockDisabled = loading || !numberValue(item.cantidad) || !item.tiene_stock;

                            return (
                              <div className="gm-table-row" role="row" key={item.id_item_origen}>
                                <div className="gm-table-cell gm-table-cell--detail" role="cell" title={item.descripcion}>
                                  <strong className="ncv-product-name">{item.descripcion}</strong>
                                </div>
                                <div className="gm-table-cell gm-table-cell--center gm-table-cell--mono" role="cell">
                                  {item.disponible}
                                </div>
                                <div className="gm-table-cell gm-table-cell--center" role="cell">
                                  <input
                                    className="gm-input ncv-quantity-input"
                                    type="number"
                                    min="0"
                                    max={item.disponible}
                                    step="0.01"
                                    value={item.cantidad}
                                    disabled={loading}
                                    aria-label={`Cantidad a acreditar de ${item.descripcion}`}
                                    onKeyDown={preventInvalidNumberKeys}
                                    onChange={(e) => {
                                      const value = boundedNumberValue(e.target.value, item.disponible);
                                      if (value === null) return;
                                      setItems((currentItems) => currentItems.map(
                                        (currentItem, currentIndex) => currentIndex === index
                                          ? { ...currentItem, cantidad: value }
                                          : currentItem
                                      ));
                                    }}
                                  />
                                </div>
                                <div className="gm-table-cell gm-table-cell--center" role="cell">
                                  <label className={`gm-inline-check${stockDisabled ? " is-disabled" : ""}`}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(item.afecta_stock && item.tiene_stock)}
                                      disabled={stockDisabled}
                                      aria-label={`Reingresar ${item.descripcion} al stock`}
                                      onChange={(e) => setItems((currentItems) => currentItems.map(
                                        (currentItem, currentIndex) => currentIndex === index
                                          ? { ...currentItem, afecta_stock: item.tiene_stock && e.target.checked }
                                          : currentItem
                                      ))}
                                    />
                                    <span className="gm-inline-check__box" aria-hidden="true" />
                                  </label>
                                </div>
                                <div className="gm-table-cell gm-table-cell--right gm-table-cell--total" role="cell">
                                  {money(seleccionado?.total || 0)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {!esEliminacionTotal && esAjusteSinStock && (
                  <section className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Descuento o ajuste sin stock</span>
                    </div>
                    <div className="gm-section-body">
                      <div className="ncv-form-grid ncv-form-grid--adjustment">
                        <div className="gm-field">
                          <input
                            className="gm-input"
                            value={descripcionAjuste}
                            onChange={(e) => setDescripcionAjuste(e.target.value.toUpperCase())}
                            placeholder=" "
                            disabled={loading}
                          />
                          <label className="gm-label">Descripción</label>
                        </div>
                        <div className="gm-field">
                          <input
                            className="gm-input"
                            type="number"
                            min="0"
                            max={totalDisponible}
                            step="0.01"
                            value={importeAjuste}
                            onKeyDown={preventInvalidNumberKeys}
                            onChange={(e) => {
                              const value = boundedNumberValue(e.target.value, totalDisponible);
                              if (value !== null) setImporteAjuste(value);
                            }}
                            placeholder=" "
                            disabled={loading}
                          />
                          <label className="gm-label">Importe total</label>
                        </div>
                        <div className="gm-field">
                          <select
                            className="gm-input gm-select"
                            value={String(ivaAjuste)}
                            onChange={(e) => setIvaAjuste(e.target.value)}
                            disabled={loading}
                          >
                            {IVA_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <label className="gm-label gm-label--up">IVA % incluido</label>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {excede && (
                  <div className="ncv-feedback ncv-feedback--error" role="alert">
                    La nota supera el importe todavía disponible.
                  </div>
                )}

                {notasAnteriores && (
                  <div className="ncv-history">
                    <b>Notas anteriores:</b>
                    <span>{notasAnteriores}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <footer className="gm-modal-footer ncv-modal__footer">
            <button
              type="button"
              className="gm-action-btn gm-action-btn--cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="gm-action-btn gm-action-btn--save"
              onClick={continuar}
              disabled={loading || !contexto || !puedeContinuar}
            >
              {loading
                ? "Procesando…"
                : esEliminacionTotal
                  ? "Emitir nota de crédito"
                  : modalidad === "ARCA"
                    ? "Continuar con ARCA"
                    : "Aplicar nota de crédito"}
            </button>
          </footer>
        </div>
      </div>

      {openResumen && resumenData && (
        <ModalFacturaBaltoResumen
          open={openResumen}
          onClose={() => setOpenResumen(false)}
          onBack={() => setOpenResumen(false)}
          onCloseAll={() => setOpenResumen(false)}
          apiBase={`${BASE_URL}/api.php`}
          action="movimientos"
          data={resumenData}
          docTipo={Number(resumenData?.cliente_facturacion?.doc_tipo || 80)}
          docNro={safeStr(
            resumenData?.cliente_facturacion?.doc_nro
            || resumenData?.cliente_facturacion?.cuit
          )}
          cbteTipo={Number(resumenData.cbte_tipo || 13)}
          ptoVta={String(resumenData.pto_vta || 2)}
          onDone={handleEmitida}
          forceTestAmount={false}
          testAmount={null}
          skipMovimientoAutocreacion={true}
          pdfMode="nota_credito"
          configsFacturacionInicial={contexto?.config_facturacion ? [contexto.config_facturacion] : []}
        />
      )}
    </>,
    document.body
  );
}
