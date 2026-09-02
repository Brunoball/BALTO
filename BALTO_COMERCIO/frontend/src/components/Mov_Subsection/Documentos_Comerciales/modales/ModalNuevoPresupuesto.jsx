import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalPresupuesto.css";
import "./ModalPresupuestosChecklist.css";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import ProductStockAutocomplete from "../../_shared/ProductStockAutocomplete.jsx";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import ModalClienteFiscalArca from "../../../Global/Modales/ModalClienteFiscalArca.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileInvoiceDollar,
  faPlus,
  faTrashCan,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { savePresupuestoPdf } from "../../../../utils/PresupuestoPdfBuilder";
import { DOCUMENTOS_API, documentosRequest } from "../api/documentosComercialesApi.js";

const NULL_OPTION = "";
const ADD_CLIENTE_OPTION = { __action: "add_cliente", id: "__add_cliente__", nombre: "➕ Agregar cliente" };
const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

const DEFAULT_CONDICIONES_PRESUPUESTO = {
  validezDias: "7",
  plazoEntrega: "",
  formaPago: "A convenir con el cliente. Puede ser efectivo, transferencia bancaria, cheque u otro medio acordado.",
  condicionesComerciales:
    "Los precios se mantienen durante la vigencia indicada. No incluye fletes, instalación ni gastos adicionales salvo que estén detallados en el presupuesto.",
  notas: "",
  garantia: "",
  lugarEntrega: "",
  moneda: "ARS",
};

function buildDefaultCondicionesPresupuesto() {
  return {
    ...DEFAULT_CONDICIONES_PRESUPUESTO,
    plazoEntrega: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.plazoEntrega),
    formaPago: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.formaPago),
    condicionesComerciales: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.condicionesComerciales),
    notas: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.notas),
    garantia: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.garantia),
    lugarEntrega: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.lugarEntrega),
    moneda: upperInput(DEFAULT_CONDICIONES_PRESUPUESTO.moneda),
  };
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clampFechaHastaHoy(value) {
  const hoy = todayISO();
  const next = String(value ?? "").slice(0, 10);
  return next && next > hoy ? hoy : next;
}

function addDaysISO(fechaISO, dias) {
  const base = String(fechaISO || "").slice(0, 10);
  const n = Number(dias);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base) || !Number.isFinite(n) || n <= 0) return "";
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Math.floor(n));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function formatFechaCorta(fechaISO) {
  const raw = String(fechaISO || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const [y, m, d] = raw.split("-");
  return `${d}/${m}/${y}`;
}

function normalizeCondicionesPresupuesto(input, fechaBase) {
  const data = input && typeof input === "object" ? input : {};
  const rawValidez = String(data.validezDias ?? data.validez_dias ?? "").trim();
  const validezDias = rawValidez === "" ? null : Math.max(0, Math.min(3650, Number(rawValidez) || 0));
  const fechaValidez = validezDias && validezDias > 0 ? addDaysISO(fechaBase, validezDias) : "";
  return {
    validez_dias: validezDias,
    fecha_validez: fechaValidez,
    plazo_entrega: upperStr(data.plazoEntrega ?? data.plazo_entrega),
    forma_pago: upperStr(data.formaPago ?? data.forma_pago),
    condiciones_comerciales: upperStr(data.condicionesComerciales ?? data.condiciones_comerciales),
    notas: upperStr(data.notas),
    garantia: upperStr(data.garantia),
    lugar_entrega: upperStr(data.lugarEntrega ?? data.lugar_entrega),
    moneda: upperStr(data.moneda || "ARS"),
  };
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function upperInput(v) {
  return String(v ?? "").toLocaleUpperCase("es-AR");
}

function upperStr(v) {
  return upperInput(v).trim();
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
  try {
    return Number(v || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${Number(v || 0).toFixed(2)}`;
  }
}


function parsePrecioInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  let clean = raw
    .replace(/\$/g, "")
    .replace(/ARS/gi, "")
    .replace(/\s+/g, "")
    .trim();

  if (!clean) return 0;

  // Formato argentino: 1.234,56 => 1234.56
  if (clean.includes(",")) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  }

  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function precioInputDraft(value) {
  const n = parsePrecioInput(value);
  if (!n) return "";
  return String(Math.round(n * 100) / 100);
}

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getClienteId(c) {
  const cand = c?.id ?? c?.id_cliente ?? c?.idCliente ?? c?.cliente_id ?? c?.idcliente ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getDetalleId(d) {
  const cand = d?.id ?? d?.id_detalle ?? d?.idDetalle ?? d?.detalle_id ?? d?.iddetalle ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getStockProductoId(d) {
  const cand = d?.id_stock_producto ?? d?.idStockProducto ?? d?.stock_producto_id ?? d?.id_producto ?? d?.idProducto ?? getDetalleId(d);
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getStockVarianteId(d) {
  const cand = d?.id_stock_variante ?? d?.idStockVariante ?? d?.stock_variante_id ?? d?.id_variante ?? d?.idVariante ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getClienteNombre(c) {
  return safeStr(c?.nombre || c?.razon_social || c?.cliente || c?.label || "");
}

function isAddClienteOption(option) {
  return option?.__action === "add_cliente";
}

function onlyDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

function normalizeArcaSummaryPresupuesto(data) {
  const x = data && typeof data === "object" ? data : {};
  return {
    cuit: onlyDigits(x.cuit || x.doc_nro || ""),
    razon_social: safeStr(x.razon_social || x.nombre || x.denominacion || ""),
    condicion_iva: safeStr(x.iva || x.condicion_iva || x.cond_iva || ""),
    domicilio: safeStr(x.domicilio || x.direccion || ""),
    doc_tipo: 80,
    doc_nro: onlyDigits(x.cuit || x.doc_nro || ""),
    origen: safeStr(x.origen || "arca_cuit"),
  };
}

function normalizeClienteFiscalDbPresupuesto(data) {
  const s = data && typeof data === "object" ? data : {};
  return {
    id_cliente_fiscal: Number(s.id_cliente_fiscal || 0) || null,
    id_cliente: Number(s.id_cliente || 0) || null,
    doc_tipo: Number(s.doc_tipo || 80) || 80,
    doc_nro: onlyDigits(s.doc_nro || s.cuit || ""),
    cuit: onlyDigits(s.cuit || s.doc_nro || ""),
    razon_social: safeStr(s.razon_social || s.nombre || s.cliente || ""),
    condicion_iva: safeStr(s.condicion_iva || s.cond_iva || ""),
    domicilio: safeStr(s.domicilio || ""),
    origen: safeStr(s.origen || "manual"),
  };
}

function normalizeClienteSimplePresupuesto(data) {
  const s = data && typeof data === "object" ? data : {};
  const id = getClienteId(s) || Number(s.id_cliente || s.id || 0) || null;
  return {
    ...s,
    id,
    id_cliente: id,
    nombre: safeStr(s.nombre || s.razon_social || s.label || s.cliente || ""),
    activo: Number(s.activo ?? 1) === 0 ? 0 : 1,
  };
}

function normalizeClienteFiscalPresupuesto(fiscalSource, clienteSource, nombreFallback = "Cliente") {
  const fiscal = fiscalSource && typeof fiscalSource === "object" ? fiscalSource : {};
  const cliente = clienteSource && typeof clienteSource === "object" ? clienteSource : {};
  const nombre =
    safeStr(fiscal.razon_social) ||
    safeStr(cliente.razon_social) ||
    safeStr(cliente.nombre) ||
    safeStr(nombreFallback) ||
    "Cliente";
  const docTipo = Number(fiscal.doc_tipo || (fiscal.cuit || cliente.cuit ? 80 : 96)) || null;
  const docNro = safeStr(fiscal.doc_nro || fiscal.cuit || cliente.doc_nro || cliente.cuit || cliente.dni || "");
  const cuit = safeStr(fiscal.cuit || cliente.cuit || (docTipo === 80 ? docNro : ""));
  const condicion = safeStr(fiscal.condicion_iva || fiscal.cond_iva || cliente.condicion_iva || cliente.cond_iva || "");
  const domicilio = safeStr(fiscal.domicilio || cliente.domicilio || cliente.direccion || "");

  return {
    id_cliente_fiscal: Number(fiscal.id_cliente_fiscal || 0) || null,
    id_cliente: Number(fiscal.id_cliente || getClienteId(cliente) || 0) || null,
    doc_tipo: docTipo,
    doc_nro: docNro,
    cuit,
    razon_social: nombre,
    cond_iva: condicion,
    condicion_iva: condicion,
    domicilio,
    origen: safeStr(fiscal.origen || (fiscal.id_cliente_fiscal ? "clientes_fiscales" : "cliente")),
  };
}

function normalizeConfigFacturacionPresupuesto(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const nombre = safeStr(c.razon_social || c.nombre_fantasia || c.nombre || "BALTO");
  const domicilio = safeStr(c.domicilio_comercial || c.domicilio || c.domicilio_fiscal || "");
  const condicionIva = safeStr(c.condicion_iva || c.cond_iva || "");
  const inicio = safeStr(c.fecha_inicio_actividades || c.inicio_actividades || "");

  return {
    emisor_nombre: nombre,
    emisor_domicilio: domicilio,
    cuit_emisor: safeStr(c.cuit || ""),
    cond_iva_emisor: condicionIva,
    ingresos_brutos_emisor: safeStr(c.ingresos_brutos || ""),
    fecha_inicio_actividades_emisor: inicio,
    emisor: {
      razon_social: nombre,
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
    },
  };
}

function getDetalleNombre(d) {
  return upperStr(d?.nombre || d?.descripcion || d?.detalle || d?.producto || d?.label || "");
}

function getDetalleCodigo(d) {
  return upperStr(d?.sku || d?.codigo || d?.codigo_barra || d?.codigo_producto || "");
}

function getStockDisponible(detalle) {
  const cand =
    detalle?.stock ??
    detalle?.stock_disponible ??
    detalle?.stockDisponible ??
    detalle?.cantidad_stock ??
    detalle?.cantidad ??
    null;
  if (cand === null || cand === undefined || cand === "") return null;
  const n = Number(cand);
  return Number.isFinite(n) ? n : null;
}

function isSinStock(stock) {
  return stock !== null && stock !== undefined && Number(stock) <= 0;
}

function normalizeTipoPrecioNombre(nombre) {
  return String(nombre ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getDetallePreciosDisponibles(detalle) {
  const lista = Array.isArray(detalle?.precios) ? detalle.precios : [];
  const out = [];
  const seen = new Set();

  lista.forEach((p, i) => {
    const idTipo = Number(p?.id_tipo_precio_stock ?? 0);
    const monto = Number(p?.monto ?? p?.precio ?? p?.precio_venta ?? 0);
    const tipoPrecio = safeStr(p?.tipo_precio || p?.nombre || (idTipo > 0 ? `Precio ${idTipo}` : `Precio ${i + 1}`));
    if (!Number.isFinite(monto)) return;
    const key = `${idTipo}|${tipoPrecio}|${monto}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      value: idTipo > 0 ? String(idTipo) : `precio_${i + 1}`,
      id_tipo_precio_stock: idTipo > 0 ? idTipo : null,
      tipo_precio: tipoPrecio || `Precio ${i + 1}`,
      monto,
      label: `${tipoPrecio || `Precio ${i + 1}`} - ${moneyARS(monto)}`,
    });
  });

  if (!out.length) {
    const montoFallback = Number(detalle?.precio ?? detalle?.precio_venta ?? detalle?.precio_promocional ?? 0);
    out.push({
      value: "default",
      id_tipo_precio_stock: null,
      tipo_precio: "PRECIO",
      monto: Number.isFinite(montoFallback) ? montoFallback : 0,
      label: `PRECIO - ${moneyARS(Number.isFinite(montoFallback) ? montoFallback : 0)}`,
    });
  }

  return out;
}

function pickDetallePrecioInicial(precios) {
  if (!Array.isArray(precios) || !precios.length) return null;
  const byName = precios.find((p) => {
    const nombre = normalizeTipoPrecioNombre(p?.tipo_precio);
    return nombre === "PRECIO DE VENTA" || nombre === "PRECIO VENTA" || nombre === "VENTA";
  });
  if (byName) return byName;
  return precios.find((p) => Number(p?.id_tipo_precio_stock ?? 0) === 2) || precios[0] || null;
}



/* ================================================================
   ABREVIADOR DE TIPO PRECIO
   Mismo criterio visual que Nueva Venta
================================================================ */
function abreviarTipoPrecio(nombre) {
  const raw = safeStr(nombre);
  const n = normalizeTipoPrecioNombre(raw);
  if (n === "PRECIO DE VENTA" || n === "PRECIO VENTA" || n === "VENTA") return "P. Venta";
  if (n === "PRECIO DE COSTO" || n === "COSTO") return "P. de COSTO";
  if (n === "PRECIO PROMOCIONAL" || n === "PROMOCIONAL" || n === "PROMO") return "P. Promo";
  if (n === "PRECIO MAYORISTA" || n === "MAYORISTA") return "P. Mayor.";
  if (n === "PRECIO MINORISTA" || n === "MINORISTA") return "P. Minor.";
  if (n === "PRECIO ESPECIAL" || n === "ESPECIAL") return "P. Especial";
  if (n === "PRECIO COSTO" || n === "COSTO") return "P. Costo";
  if (n === "PRECIO LISTA" || n === "LISTA") return "P. Lista";
  if (n === "PRECIO" || n === "PRECIO 1") return "Precio";
  return raw.length > 12 ? raw.slice(0, 11).trim() + "…" : raw;
}

/* ================================================================
   PRECIO DROPDOWN
   Replica la estética del selector de precios de Nueva Venta
================================================================ */
function PrecioDropdown({ precios, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const ref = useRef(null);

  const safePrecios = Array.isArray(precios) ? precios : [];
  const selectedIndex = Math.max(
    0,
    safePrecios.findIndex((p) => String(p.value) === String(value))
  );
  const selected = safePrecios[selectedIndex] || safePrecios[0] || null;


  useEffect(() => {
    if (!open) return;
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  const moveSelection = useCallback(
    (direction) => {
      if (!safePrecios.length) return;
      const currentIndex = safePrecios.findIndex((p) => String(p.value) === String(value));
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      let nextIndex = baseIndex + direction;

      if (nextIndex < 0) nextIndex = safePrecios.length - 1;
      if (nextIndex >= safePrecios.length) nextIndex = 0;

      const next = safePrecios[nextIndex];
      if (next) onChange(next.value);
      setHighlightIndex(nextIndex);
    },
    [safePrecios, value, onChange]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (disabled || !safePrecios.length) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection(1);
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        setHighlightIndex((prev) => (prev + 1 >= safePrecios.length ? 0 : prev + 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        setHighlightIndex((prev) => (prev - 1 < 0 ? safePrecios.length - 1 : prev - 1));
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        const item = safePrecios[highlightIndex];
        if (item) onChange(item.value);
        setOpen(false);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [disabled, safePrecios, open, selectedIndex, highlightIndex, onChange, moveSelection]
  );

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((p) => !p)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        style={{
          width: "100%",
          background: disabled ? "var(--nv-surface2)" : "var(--nv-bg)",
          border: "1px solid var(--nv-border-md)",
          borderRadius: 6,
          padding: "4px 18px 4px 8px",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          lineHeight: 1.25,
          minHeight: 38,
          position: "relative",
          transition: "border-color 0.15s, background 0.15s",
          boxSizing: "border-box",
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.borderColor = "var(--nv-action)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--nv-border-md)";
        }}
      >
        {selected ? (
          <>
            <div
              style={{
                fontSize: 9,
                color: "var(--nv-muted)",
                textTransform: "uppercase",
                fontWeight: 700,
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {abreviarTipoPrecio(selected.tipo_precio)}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--nv-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {moneyARS(selected.monto)}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--nv-placeholder)", fontSize: 12 }}>Precio</span>
        )}

        <span
          style={{
            position: "absolute",
            right: 7,
            top: "50%",
            transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
            transition: "transform 0.18s",
            fontSize: 10,
            color: "var(--nv-muted)",
            pointerEvents: "none",
            lineHeight: 1,
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 9999,
            background: "var(--nv-bg)",
            border: "1px solid var(--nv-border-md)",
            borderRadius: 8,
            boxShadow: "var(--nv-shadow-md)",
            minWidth: "100%",
            width: "max-content",
            maxWidth: 240,
            overflow: "hidden",
          }}
        >
          {safePrecios.map((p, idx) => {
            const isActive = String(p.value) === String(value);
            const isHighlighted = idx === highlightIndex;

            return (
              <div
                key={p.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlightIndex(idx)}
                style={{
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isHighlighted
                    ? "var(--nv-row-hover)"
                    : isActive
                    ? "var(--nv-action-10)"
                    : "transparent",
                  borderLeft: isActive ? "3px solid var(--nv-action)" : "3px solid transparent",
                  transition: "background 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: isActive ? "var(--nv-action)" : "var(--nv-muted)",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    marginBottom: 1,
                  }}
                >
                  {abreviarTipoPrecio(p.tipo_precio)}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: isActive ? "var(--nv-action)" : "var(--nv-text)",
                  }}
                >
                  {moneyARS(p.monto)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function buildEmptyRow() {
  return {
    id: uid(),
    id_detalle: NULL_OPTION,
    id_stock_producto: NULL_OPTION,
    id_stock_variante: NULL_OPTION,
    detalleText: "",
    codigo: "",
    cantidad: 1,
    precio: 0,
    precioDraft: "",
    precioFocused: false,
    id_tipo_precio_stock: NULL_OPTION,
    precio_tipo_label: "",
    precios_disponibles: [],
    ivaPct: 0,
    stock_disponible: null,
    sinStock: false,
  };
}

function buildRowFromModelItem(item) {
  const raw = item && typeof item === "object" ? item : {};
  const idDetalle = Number(raw.id_detalle || 0);
  const idStockProducto = Number(raw.id_stock_producto || 0);
  const idStockVariante = Number(raw.id_stock_variante || 0);
  const cantidad = safeNumber(raw.cantidad);
  const precio = safeNumber(raw.precio ?? raw.precio_unitario);
  const ivaPct = safeNumber(raw.iva_pct ?? raw.ivaPct);

  return {
    ...buildEmptyRow(),
    id_detalle: idDetalle > 0 ? idDetalle : NULL_OPTION,
    id_stock_producto: idStockProducto > 0 ? idStockProducto : NULL_OPTION,
    id_stock_variante: idStockVariante > 0 ? idStockVariante : NULL_OPTION,
    detalleText: upperStr(raw.descripcion || raw.detalle || raw.nombre || raw.detalle_nombre),
    codigo: upperStr(raw.codigo || raw.sku || raw.stock_producto_sku || raw.stock_variante_sku),
    cantidad: cantidad > 0 ? cantidad : 1,
    precio: precio >= 0 ? precio : 0,
    ivaPct: ivaPct >= 0 ? ivaPct : 0,
    stock_disponible: null,
    sinStock: false,
    precios_disponibles: [],
    id_tipo_precio_stock: NULL_OPTION,
    precio_tipo_label: "",
  };
}

function buildCondicionesFromModel(modelo) {
  const raw = modelo && typeof modelo === "object" ? modelo : {};
  const c = raw.condiciones_presupuesto && typeof raw.condiciones_presupuesto === "object"
    ? raw.condiciones_presupuesto
    : {};
  const defaults = buildDefaultCondicionesPresupuesto();
  const validez = raw.validez_dias ?? c.validez_dias ?? c.validezDias ?? defaults.validezDias;

  return {
    validezDias: validez === null || validez === undefined ? defaults.validezDias : String(validez),
    plazoEntrega: upperStr(raw.plazo_entrega || c.plazo_entrega || c.plazoEntrega || defaults.plazoEntrega),
    formaPago: upperStr(raw.forma_pago || c.forma_pago || c.formaPago || defaults.formaPago),
    condicionesComerciales: upperStr(
      raw.condiciones_comerciales || c.condiciones_comerciales || c.condicionesComerciales || defaults.condicionesComerciales
    ),
    notas: upperStr(raw.notas || raw.observaciones || c.notas || defaults.notas),
    garantia: upperStr(raw.garantia || c.garantia || defaults.garantia),
    lugarEntrega: upperStr(raw.lugar_entrega || c.lugar_entrega || c.lugarEntrega || defaults.lugarEntrega),
    moneda: upperStr(raw.moneda || c.moneda || defaults.moneda || "ARS"),
  };
}

function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src.listas && typeof src.listas === "object" ? src.listas : src;
  const pick = (k) => (Array.isArray(l?.[k]) ? l[k] : []);
  return {
    clientes: pick("clientes"),
    detalles: pick("detalles"),
  };
}

function getAuditUserPayload() {
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

  return {
    idUsuario,
    idUsuarioMaster,
    id_usuario: idUsuario,
    id_usuario_master: idUsuarioMaster,
  };
}

function buildAuthHeaders(isJson = true) {
  const sessionKey =
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") ||
    localStorage.getItem("X-Session") ||
    "";
  const token = localStorage.getItem("token") || localStorage.getItem("auth_token") || "";
  const headers = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}`);
  }
  if (!res.ok || data?.exito === false) {
    throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  }
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

async function apiPostForm(url, formData) {
  const headers = buildAuthHeaders(false);
  const res = await documentosRequest(url, { method: "POST", headers, body: formData });
  return await parseJsonOrThrow(res);
}

export default function ModalNuevoPresupuesto({ open, lists, initialModel = null, modelsOpen = false, onOpenModels, onClose, onToast, onSaved }) {
  const API = DOCUMENTOS_API;
  const API_PADRON_CUIT = `${API}?action=padron_cuit&op=padron_cuit`;
  const API_SAVE_CLIENTE_DESDE_ARCA = `${API}?action=cliente_fiscal_crear_desde_arca`;
  const normalizedLists = useMemo(() => normalizeLists(lists), [lists]);
  const clientesBaseList = normalizedLists.clientes;
  const detallesList = normalizedLists.detalles;
  const [localClientes, setLocalClientes] = useState(() => (Array.isArray(clientesBaseList) ? clientesBaseList : []));
  const clientesList = localClientes;
  const clientesOptions = useMemo(() => [ADD_CLIENTE_OPTION, ...clientesList], [clientesList]);

  const [fecha, setFecha] = useState(todayISO());
  const fechaInputRef = useRef(null);
  const [cliInput, setCliInput] = useState("");
  const [clienteSel, setClienteSel] = useState(null);
  const [observaciones, setObservaciones] = useState("");
  const [condiciones, setCondiciones] = useState(buildDefaultCondicionesPresupuesto);
  const [rows, setRows] = useState([buildEmptyRow()]);
  const [presupuestoPersonalizado, setPresupuestoPersonalizado] = useState(false);
  const [modeloOrigen, setModeloOrigen] = useState(null);
  const [guardarComoModelo, setGuardarComoModelo] = useState(false);
  const [modeloNombre, setModeloNombre] = useState("");
  const [modeloDescripcion, setModeloDescripcion] = useState("");
  const [saving, setSaving] = useState(false);
  const [configFacturacion, setConfigFacturacion] = useState(null);
  const [addUI, setAddUI] = useState({
    open: false,
    cuit: "",
    fiscalData: null,
    fiscalError: "",
    lookupLoading: false,
    saving: false,
  });
  const [dark, setDark] = useState(isTemaOscuro);

  useEffect(() => {
    setLocalClientes(Array.isArray(clientesBaseList) ? clientesBaseList : []);
  }, [clientesBaseList]);

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());
    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let o2 = null;
    if (document.body) {
      o2 = new MutationObserver(update);
      o2.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    return () => {
      o1.disconnect();
      o2?.disconnect?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setFecha(todayISO());
    setCliInput("");
    setClienteSel(null);
    setObservaciones("");
    setCondiciones(buildDefaultCondicionesPresupuesto());
    setRows([buildEmptyRow()]);
    setPresupuestoPersonalizado(false);
    setModeloOrigen(null);
    setGuardarComoModelo(false);
    setModeloNombre("");
    setModeloDescripcion("");
    setSaving(false);
    setAddUI({ open: false, cuit: "", fiscalData: null, fiscalError: "", lookupLoading: false, saving: false });
    let alive = true;
    apiGetJson(`${API}?action=config_facturacion_get`)
      .then((data) => {
        if (!alive) return;
        setConfigFacturacion(data?.config || data?.data || null);
      })
      .catch(() => {
        if (alive) setConfigFacturacion(null);
      });
    return () => {
      alive = false;
    };
  }, [open, API]);

  useEffect(() => {
    if (!open) return;
    const modelo = initialModel && Number(initialModel?.id_modelo || 0) > 0 ? initialModel : null;
    if (!modelo) return;
    const modelItems = Array.isArray(modelo.items) ? modelo.items : [];
    setObservaciones(upperInput(modelo.observaciones || modelo.notas));
    setCondiciones(buildCondicionesFromModel(modelo));
    setRows(modelItems.length ? modelItems.map(buildRowFromModelItem) : [buildEmptyRow()]);
    setPresupuestoPersonalizado(Number(modelo.es_personalizado ?? 1) === 1);
    setModeloOrigen(modelo);
    setGuardarComoModelo(false);
    setModeloNombre("");
    setModeloDescripcion("");
  }, [initialModel, open]);

  const updateRow = useCallback((rowId, patch) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((rowId) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, buildEmptyRow()]);
  }, []);

  const updateCondicion = useCallback((key, value) => {
    const nextValue = key === "validezDias" ? value : upperInput(value);
    setCondiciones((prev) => ({ ...prev, [key]: nextValue }));
  }, []);

  const handlePresupuestoPersonalizadoChange = useCallback((enabled) => {
    const next = Boolean(enabled);
    setPresupuestoPersonalizado(next);
    if (next) {
      setRows((prev) => prev.map((row) => ({
        ...row,
        precios_disponibles: [],
        id_tipo_precio_stock: NULL_OPTION,
        precio_tipo_label: "",
      })));
    } else {
      setRows((prev) => prev.map((row) => (
        row.sinStock || isSinStock(row.stock_disponible)
          ? { ...row, cantidad: "" }
          : row
      )));
    }
  }, []);

  const resetAddUIState = useCallback(() => {
    setAddUI({ open: false, cuit: "", fiscalData: null, fiscalError: "", lookupLoading: false, saving: false });
  }, []);

  const registrarClienteLocal = useCallback((clienteRaw, fiscalRaw = null) => {
    const cliente = normalizeClienteSimplePresupuesto(clienteRaw);
    if (!cliente.id_cliente) return cliente;

    const item = {
      id: Number(cliente.id_cliente),
      id_cliente: Number(cliente.id_cliente),
      nombre: cliente.nombre,
      activo: cliente.activo,
    };

    setLocalClientes((prev) => {
      const arr = Array.isArray(prev) ? prev.slice() : [];
      const idx = arr.findIndex((x) => Number(getClienteId(x)) === Number(cliente.id_cliente));
      if (idx >= 0) arr[idx] = { ...arr[idx], ...item };
      else arr.push(item);
      return arr;
    });

    setClienteSel(item);
    setCliInput(upperInput(cliente.nombre || ""));

    return { ...item, cliente_fiscal: fiscalRaw || null };
  }, []);

  const startAddCliente = useCallback(() => {
    if (saving) return;
    setAddUI({
      open: true,
      cuit: "",
      fiscalData: null,
      fiscalError: "",
      lookupLoading: false,
      saving: false,
    });
  }, [saving]);

  const closeAddCliente = useCallback(() => {
    if (addUI.saving || addUI.lookupLoading) return;
    resetAddUIState();
  }, [addUI.saving, addUI.lookupLoading, resetAddUIState]);

  const consultarArcaAddCliente = useCallback(async () => {
    const cuit = onlyDigits(addUI.cuit);
    if (cuit.length !== 11) {
      setAddUI((p) => ({ ...p, fiscalError: "Ingresá un CUIT válido de 11 dígitos." }));
      return null;
    }

    setAddUI((p) => ({ ...p, lookupLoading: true, fiscalError: "", fiscalData: null }));
    try {
      const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${encodeURIComponent(cuit)}`);
      const raw = data?.data?.summary || data?.summary || data?.persona || data?.fiscal || data?.data || data?.resultado || data;
      const fiscal = normalizeArcaSummaryPresupuesto({ ...raw, cuit });
      if (!fiscal.cuit || !fiscal.razon_social) throw new Error("ARCA devolvió datos incompletos para ese CUIT.");
      setAddUI((p) => ({ ...p, lookupLoading: false, fiscalData: fiscal, fiscalError: "" }));
      return fiscal;
    } catch (e) {
      setAddUI((p) => ({
        ...p,
        lookupLoading: false,
        fiscalData: null,
        fiscalError: e?.message || "No se pudo consultar ARCA.",
      }));
      return null;
    }
  }, [API_PADRON_CUIT, addUI.cuit]);

  const guardarNuevoClienteDesdeArca = useCallback(async () => {
    const cuit = onlyDigits(addUI.cuit);
    if (cuit.length !== 11) {
      const msg = "Ingresá un CUIT válido de 11 dígitos, presioná Consultar ARCA y después confirmá.";
      setAddUI((p) => ({ ...p, fiscalError: msg }));
      onToast?.("advertencia", msg, 3600);
      return;
    }

    setAddUI((p) => ({ ...p, saving: true, fiscalError: "" }));
    onToast?.("cargando", "Consultando ARCA y creando cliente…", 12000);

    try {
      let fiscal = addUI.fiscalData;
      if (!fiscal || onlyDigits(fiscal.cuit) !== cuit) {
        const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${encodeURIComponent(cuit)}`);
        const raw = data?.data?.summary || data?.summary || data?.persona || data?.fiscal || data?.data || data?.resultado || data;
        fiscal = normalizeArcaSummaryPresupuesto({ ...raw, cuit });
      }

      if (!fiscal?.cuit || !fiscal?.razon_social) {
        throw new Error("Primero consultá un CUIT válido en ARCA.");
      }

      const { idUsuario } = getAuditUserPayload();
      const saved = await apiPostJson(API_SAVE_CLIENTE_DESDE_ARCA, {
        idUsuario,
        id_cliente: null,
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

      const fiscalDb = normalizeClienteFiscalDbPresupuesto(saved.cliente_fiscal);
      const cliente = registrarClienteLocal(saved.cliente, fiscalDb);
      resetAddUIState();

      if (saved?.ya_existia) {
        onToast?.("exito", `El cliente ya existía. Se seleccionó "${cliente?.nombre || fiscal.razon_social}" sin duplicarlo.`, 3600);
      } else {
        onToast?.("exito", `Cliente fiscal creado: "${cliente?.nombre || fiscal.razon_social}"`, 3200);
      }
    } catch (e) {
      setAddUI((p) => ({ ...p, saving: false, fiscalError: e?.message || "No se pudo guardar el cliente desde ARCA." }));
      onToast?.("error", e?.message || "No se pudo guardar el cliente desde ARCA.", 5200);
    }
  }, [API_PADRON_CUIT, API_SAVE_CLIENTE_DESDE_ARCA, addUI.cuit, addUI.fiscalData, onToast, registrarClienteLocal, resetAddUIState]);

  const handleSelectCliente = useCallback((cliente) => {
    if (isAddClienteOption(cliente)) {
      startAddCliente();
      return;
    }

    const id = getClienteId(cliente);
    setClienteSel(id ? cliente : null);
    setCliInput(upperInput(getClienteNombre(cliente)));
  }, [startAddCliente]);

  const handleClienteInputChange = useCallback((value) => {
    const upperValue = upperInput(value);
    setCliInput(upperValue);
    const norm = normalizeText(upperValue);
    const exact = clientesList.find((c) => !isAddClienteOption(c) && normalizeText(getClienteNombre(c)) === norm) || null;
    setClienteSel(exact);
  }, [clientesList]);

  const handleSelectDetalle = useCallback((rowId, detalle) => {
    const idStockProducto = getStockProductoId(detalle);
    const idStockVariante = getStockVarianteId(detalle);
    const precios = getDetallePreciosDisponibles(detalle);
    const inicial = pickDetallePrecioInicial(precios);
    const stockDisponible = getStockDisponible(detalle);
    const sinStock = isSinStock(stockDisponible);
    const nombreDetalle = getDetalleNombre(detalle);

    updateRow(rowId, {
      id_detalle: NULL_OPTION,
      id_stock_producto: idStockProducto || NULL_OPTION,
      id_stock_variante: idStockVariante || NULL_OPTION,
      detalleText: nombreDetalle,
      codigo: getDetalleCodigo(detalle),
      cantidad: sinStock && !presupuestoPersonalizado ? "" : 1,
      precio: inicial ? safeNumber(inicial.monto) : 0,
      precioDraft: "",
      precioFocused: false,
      id_tipo_precio_stock: presupuestoPersonalizado ? NULL_OPTION : (inicial?.value || NULL_OPTION),
      precio_tipo_label: presupuestoPersonalizado ? "" : (inicial?.tipo_precio || ""),
      precios_disponibles: presupuestoPersonalizado ? [] : precios,
      stock_disponible: stockDisponible,
      sinStock,
    });

    if (sinStock && !presupuestoPersonalizado) {
      onToast?.("advertencia", `El producto "${nombreDetalle}" no tiene stock disponible. Activá Presupuesto personalizado para usarlo sin descontar stock.`, 3200);
    }
  }, [onToast, presupuestoPersonalizado, updateRow]);

  const barcodePendingRef = useRef(null);

  const handleBarcodeProductSelect = useCallback((producto) => {
    const target = rows.find((row) =>
      !Number(row?.id_stock_producto || 0) &&
      !Number(row?.id_stock_variante || 0) &&
      !String(row?.detalleText || "").trim()
    );

    if (target) {
      handleSelectDetalle(target.id, producto);
      onToast?.("exito", `Producto leído: ${getDetalleNombre(producto)}`, 1800);
      return;
    }

    const nextRow = buildEmptyRow();
    barcodePendingRef.current = { rowId: nextRow.id, producto };
    setRows((prev) => [...prev, nextRow]);
  }, [rows, handleSelectDetalle, onToast]);

  useEffect(() => {
    const pending = barcodePendingRef.current;
    if (!pending || !rows.some((row) => row.id === pending.rowId)) return;
    barcodePendingRef.current = null;
    handleSelectDetalle(pending.rowId, pending.producto);
    onToast?.("exito", `Producto leído: ${getDetalleNombre(pending.producto)}`, 1800);
  }, [rows, handleSelectDetalle, onToast]);

  useStockBarcodeScanner({
    enabled: open && !saving && !addUI.open && !modelsOpen,
    options: detallesList,
    allowOutOfStock: presupuestoPersonalizado,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => onToast?.("advertencia", mensaje, 3200),
  });

  const handleDetalleInputChange = useCallback((rowId, value) => {
    updateRow(rowId, {
      detalleText: upperInput(value),
      id_detalle: NULL_OPTION,
      id_stock_producto: NULL_OPTION,
      id_stock_variante: NULL_OPTION,
      codigo: "",
      precios_disponibles: [],
      precio_tipo_label: "",
      precioDraft: "",
      precioFocused: false,
      stock_disponible: null,
      sinStock: false,
    });
  }, [updateRow]);

  const handleCantidadChange = useCallback((rowId, newCantidad) => {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    if (!presupuestoPersonalizado && (row.sinStock || isSinStock(row.stock_disponible))) {
      updateRow(rowId, { cantidad: "" });
      return;
    }

    let cantidadFinal = newCantidad === "" ? "" : Number(newCantidad);
    if (typeof cantidadFinal === "number" && cantidadFinal < 0) cantidadFinal = 0;

    if (
      !presupuestoPersonalizado &&
      row.stock_disponible !== null &&
      row.stock_disponible !== undefined &&
      row.stock_disponible !== "" &&
      typeof cantidadFinal === "number" &&
      Number.isFinite(cantidadFinal) &&
      cantidadFinal > Number(row.stock_disponible)
    ) {
      cantidadFinal = Number(row.stock_disponible);
      onToast?.("advertencia", `Stock máximo disponible: ${row.stock_disponible}`, 2000);
    }

    updateRow(rowId, { cantidad: cantidadFinal });
  }, [onToast, presupuestoPersonalizado, rows, updateRow]);

  const handlePrecioTipoChange = useCallback((rowId, value) => {
    const row = rows.find((r) => r.id === rowId);
    const p = row?.precios_disponibles?.find((x) => String(x.value) === String(value));
    updateRow(rowId, {
      id_tipo_precio_stock: value,
      precio_tipo_label: p?.tipo_precio || "",
      precio: p ? safeNumber(p.monto) : safeNumber(row?.precio),
      precioDraft: "",
      precioFocused: false,
    });
  }, [rows, updateRow]);


  const handlePrecioFocus = useCallback((rowId) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              precioFocused: true,
              precioDraft: precioInputDraft(r.precio),
            }
          : r
      )
    );
  }, []);

  const handlePrecioInputChange = useCallback((rowId, value) => {
    const parsed = parsePrecioInput(value);
    updateRow(rowId, {
      precioDraft: value,
      precio: parsed,
    });
  }, [updateRow]);

  const commitPrecioInput = useCallback((rowId) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const parsed = parsePrecioInput(r.precioDraft !== "" ? r.precioDraft : r.precio);
        const rounded = Math.round(parsed * 100) / 100;
        return {
          ...r,
          precio: rounded,
          precioDraft: "",
          precioFocused: false,
        };
      })
    );
  }, []);

  const handlePrecioKeyDown = useCallback((e, rowId) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitPrecioInput(rowId);
    e.currentTarget.blur();
  }, [commitPrecioInput]);

  const computedRows = useMemo(() => {
    return rows.map((r) => {
      const cantidad = safeNumber(r.cantidad);
      const precio = safeNumber(r.precio);
      const ivaPct = safeNumber(r.ivaPct);
      const subtotal = cantidad * precio;
      const iva_monto = subtotal * ivaPct / 100;
      const total = subtotal + iva_monto;
      return { ...r, cantidad, precio, ivaPct, subtotal, iva_monto, total };
    });
  }, [rows]);

  const openFechaPicker = useCallback(() => {
    if (saving) return;

    const input = fechaInputRef.current;
    if (!input) return;

    input.focus();

    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // Algunos navegadores bloquean showPicker fuera de una acción directa.
      }
    }
  }, [saving]);

  const requestClose = useCallback(() => {
    if (saving) return;
    onClose?.();
  }, [onClose, saving]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (e) => {
      if (addUI.open || modelsOpen) return;
      if (e.key === "Escape" || e.key === "Esc") {
        e.preventDefault();
        requestClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, requestClose, addUI.open, modelsOpen]);

  const totals = useMemo(() => {
    return computedRows.reduce(
      (acc, r) => ({
        subtotal: acc.subtotal + safeNumber(r.subtotal),
        iva: acc.iva + safeNumber(r.iva_monto),
        total: acc.total + safeNumber(r.total),
      }),
      { subtotal: 0, iva: 0, total: 0 }
    );
  }, [computedRows]);

  const condicionesPreview = useMemo(() => normalizeCondicionesPresupuesto(condiciones, fecha), [condiciones, fecha]);

  const validate = useCallback(() => {
    const idCliente = getClienteId(clienteSel);
    if (!idCliente) return "Seleccioná un cliente del listado.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return "Seleccioná una fecha válida.";
    if (String(fecha).slice(0, 10) > todayISO()) return "La fecha no puede ser posterior al día actual.";
    const validezRaw = String(condiciones.validezDias ?? "").trim();
    if (validezRaw !== "" && (!/^\d+$/.test(validezRaw) || Number(validezRaw) > 3650)) {
      return "La validez debe ser un número de días entre 0 y 3650.";
    }
    const validItems = computedRows.filter((r) => safeStr(r.detalleText) && r.cantidad > 0 && r.precio > 0);
    if (!validItems.length) return "Agregá al menos un producto o servicio con cantidad y precio.";
    if (guardarComoModelo && !safeStr(modeloNombre)) return "Ingresá un nombre para guardar el presupuesto como modelo.";

    const problems = [];
    computedRows.forEach((r, idx) => {
      const touched = safeStr(r.detalleText) || r.cantidad > 0 || r.precio > 0;
      if (!touched) return;
      if (!safeStr(r.detalleText)) problems.push(`Fila ${idx + 1}: falta el detalle.`);
      if (!(r.cantidad > 0)) problems.push(`Fila ${idx + 1}: la cantidad debe ser mayor a 0.`);
      if (!(r.precio > 0)) problems.push(`Fila ${idx + 1}: el precio debe ser mayor a 0.`);
    });
    return problems[0] || "";
  }, [clienteSel, fecha, computedRows, condiciones.validezDias, guardarComoModelo, modeloNombre]);

  const buildItemsPayload = useCallback(() => {
    return computedRows
      .filter((r) => safeStr(r.detalleText) && r.cantidad > 0 && r.precio > 0)
      .map((r) => ({
        id_detalle: null,
        id_stock_producto: r.id_stock_producto || null,
        id_stock_variante: r.id_stock_variante || null,
        codigo: r.codigo || "",
        descripcion: upperStr(r.detalleText),
        detalle: upperStr(r.detalleText),
        cantidad: r.cantidad,
        precio: r.precio,
        precio_unitario: r.precio,
        iva_pct: r.ivaPct,
        subtotal: r.subtotal,
        iva_monto: r.iva_monto,
        total: r.total,
        id_tipo_precio_stock: r.id_tipo_precio_stock || null,
        tipo_precio: r.precio_tipo_label || "",
      }));
  }, [computedRows]);

  const uploadPresupuestoPdf = useCallback(async ({ idMovimiento, payload, items }) => {
    const clienteNombre = upperStr(getClienteNombre(clienteSel) || cliInput);
    const idCliente = getClienteId(clienteSel);
    let clienteFiscal = null;

    if (idCliente) {
      try {
        const fiscalResp = await apiGetJson(`${API}?action=cliente_fiscal_get&id_cliente=${idCliente}`);
        if (fiscalResp?.existe && fiscalResp?.cliente_fiscal) {
          clienteFiscal = fiscalResp.cliente_fiscal;
        }
      } catch {
        clienteFiscal = null;
      }
    }

    const clienteFacturacion = normalizeClienteFiscalPresupuesto(clienteFiscal, clienteSel, clienteNombre);
    const emisorPdf = normalizeConfigFacturacionPresupuesto(configFacturacion || {});

    const pdfData = {
      ...payload,
      id_movimiento: idMovimiento,
      numero_presupuesto: idMovimiento,
      fecha_cbte_iso: fecha,
      cliente_nombre: clienteNombre,
      labelCliente: clienteNombre,
      cliente: clienteFacturacion,
      cliente_facturacion: clienteFacturacion,
      config_facturacion: configFacturacion || {},
      ...emisorPdf,
      items,
      items_facturacion: items,
      subtotal_ars: totals.subtotal,
      iva_ars: totals.iva,
      total_ars: totals.total,
      observaciones: payload?.observaciones || observaciones,
      condiciones_presupuesto: payload?.condiciones_presupuesto || normalizeCondicionesPresupuesto(condiciones, fecha),
      validez_dias: payload?.validez_dias,
      fecha_validez: payload?.fecha_validez,
      plazo_entrega: payload?.plazo_entrega,
      forma_pago: payload?.forma_pago,
      condiciones_comerciales: payload?.condiciones_comerciales,
      notas: payload?.notas,
      garantia: payload?.garantia,
      lugar_entrega: payload?.lugar_entrega,
      moneda: payload?.moneda,
    };

    const { blob, filename } = await savePresupuestoPdf({ data: pdfData, download: false });
    const file = new File([blob], filename, { type: "application/pdf" });
    const fd = new FormData();
    fd.append("id_movimiento", String(idMovimiento));
    fd.append("tipo", "PRESUPUESTO");
    fd.append("force", "1");
    fd.append("pdf", file, filename);
    fd.append("meta", JSON.stringify({
      tipo: "PRESUPUESTO",
      emitido_en_arca: 0,
      id_movimiento: idMovimiento,
      ids_movimiento: [idMovimiento],
      id_cliente: getClienteId(clienteSel),
      razon_social: clienteFacturacion.razon_social || clienteNombre,
      cond_iva: clienteFacturacion.condicion_iva || clienteFacturacion.cond_iva || null,
      domicilio: clienteFacturacion.domicilio || null,
      cliente_facturacion: clienteFacturacion,
      emisor: emisorPdf.emisor,
      config_facturacion: configFacturacion || {},
      fecha_cbte: fecha.replace(/-/g, ""),
      fecha_cbte_iso: fecha,
      monto_ars: totals.total,
      condiciones_presupuesto: pdfData.condiciones_presupuesto,
      validez_dias: pdfData.validez_dias,
      fecha_validez: pdfData.fecha_validez,
      plazo_entrega: pdfData.plazo_entrega,
      forma_pago: pdfData.forma_pago,
      condiciones_comerciales: pdfData.condiciones_comerciales,
      notas: pdfData.notas,
      garantia: pdfData.garantia,
      lugar_entrega: pdfData.lugar_entrega,
      moneda: pdfData.moneda,
      resumen_facturacion: pdfData,
    }));

    return await apiPostForm(`${API}?action=ventas_comprobantes_vincular_movimiento`, fd);
  }, [API, clienteSel, cliInput, configFacturacion, fecha, observaciones, condiciones, totals]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const msg = validate();
    if (msg) {
      onToast?.("error", msg, 4200);
      return;
    }

    const idCliente = getClienteId(clienteSel);
    const items = buildItemsPayload();
    const detallePresupuesto = items.map((it) => safeStr(it.descripcion || it.detalle)).filter(Boolean).join(", ");
    const fechaEnvio = String(fecha || "").slice(0, 10);
    const condicionesPayload = normalizeCondicionesPresupuesto(condiciones, fechaEnvio);
    const payload = {
      fecha: fechaEnvio,
      id_cliente: idCliente,
      cliente_nombre: upperStr(getClienteNombre(clienteSel) || cliInput),
      detalle: detallePresupuesto,
      descripcion: detallePresupuesto,
      concepto: detallePresupuesto,
      detalle_original: detallePresupuesto,
      subtotal: totals.subtotal,
      iva_total: totals.iva,
      total: totals.total,
      monto_total: totals.total,
      observaciones: condicionesPayload.notas || observaciones,
      validez_dias: condicionesPayload.validez_dias,
      fecha_validez: condicionesPayload.fecha_validez,
      plazo_entrega: condicionesPayload.plazo_entrega,
      forma_pago: condicionesPayload.forma_pago,
      condiciones_comerciales: condicionesPayload.condiciones_comerciales,
      notas: condicionesPayload.notas,
      garantia: condicionesPayload.garantia,
      lugar_entrega: condicionesPayload.lugar_entrega,
      moneda: condicionesPayload.moneda,
      condiciones_presupuesto: condicionesPayload,
      es_personalizado: presupuestoPersonalizado ? 1 : 0,
      presupuesto_personalizado: presupuestoPersonalizado ? 1 : 0,
      id_modelo_origen: Number(modeloOrigen?.id_modelo || 0) || null,
      nombre_modelo_origen: upperStr(modeloOrigen?.nombre),
      guardar_como_modelo: guardarComoModelo ? 1 : 0,
      modelo_nombre: guardarComoModelo ? upperStr(modeloNombre) : "",
      modelo_descripcion: guardarComoModelo ? upperStr(modeloDescripcion) : "",
      items,
      ...getAuditUserPayload(),
    };

    setSaving(true);
    try {
      const creado = await apiPostJson(`${API}?action=presupuestos_crear`, payload);
      const idMovimiento = Number(creado?.id_movimiento || creado?.movimiento?.id_movimiento || 0);
      if (!idMovimiento) throw new Error("El presupuesto se guardó, pero el backend no devolvió id_movimiento.");
      await uploadPresupuestoPdf({ idMovimiento, payload, items });
      const modeloGuardado = creado?.modelo_guardado || creado?.modelo || null;
      onToast?.(
        "exito",
        guardarComoModelo || modeloGuardado
          ? "Presupuesto generado y modelo base guardado correctamente."
          : "Presupuesto generado y vinculado correctamente.",
        3400
      );
      onSaved?.({ id_movimiento: idMovimiento, modelo_guardado: modeloGuardado });
    } catch (err) {
      onToast?.("error", err?.message || "No se pudo generar el presupuesto.", 5200);
    } finally {
      setSaving(false);
    }
  }, [API, buildItemsPayload, clienteSel, cliInput, fecha, observaciones, condiciones, guardarComoModelo, modeloDescripcion, modeloNombre, modeloOrigen, onSaved, onToast, presupuestoPersonalizado, totals, uploadPresupuestoPdf, validate]);

  if (!open) return null;

  return createPortal(
    <div
      className="gm-modal-overlay presupuesto-overlay"
      role="presentation"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="gm-modal-container gm-modal-container--movement gm-modal-v2 presupuesto-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo presupuesto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gm-modal-header">
          <div className="gm-modal-head-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faFileInvoiceDollar} />
          </div>
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">Nuevo presupuesto</h2>
          </div>
          <button
            type="button"
            className="gm-modal-close"
            onClick={requestClose}
            disabled={saving}
            title="Cerrar"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <form className="gm-modal-content presupuesto-modal__content" onSubmit={handleSubmit}>
          <div className={`presupuesto-mode-panel ${presupuestoPersonalizado ? "is-active" : ""}`}>
            <label className="gm-inline-check presupuesto-check-card presupuesto-mode-toggle">
              <input
                type="checkbox"
                checked={presupuestoPersonalizado}
                onChange={(e) => handlePresupuestoPersonalizadoChange(e.target.checked)}
                disabled={saving}
              />
              <span className="gm-inline-check__box" aria-hidden="true" />
              <span className="presupuesto-check-card__copy">
                <b>Presupuesto personalizado / servicio</b>
                <small>
                  Permite escribir materiales o tareas a mano, usar cantidades decimales (metros, m², etc.) y tomar referencias del stock aunque no tengan existencia.
                </small>
              </span>
            </label>
            <div className="presupuesto-mode-actions">
              {modeloOrigen?.nombre ? (
                <span className="presupuesto-model-loaded" title={safeStr(modeloOrigen.descripcion)}>
                  Modelo cargado: <b>{modeloOrigen.nombre}</b>
                </span>
              ) : null}
              <button
                type="button"
                className="gm-action-btn gm-action-btn--secondary presupuesto-model-button"
                onClick={() => onOpenModels?.()}
                disabled={saving}
              >
                Ver modelos de presupuesto
              </button>
            </div>
          </div>

          <div className="gm-movement-layout">
            <section className="gm-table gm-table--movement gm-movement-main dc-presupuesto-table">
              <div className="gm-table-head">
                <div className="gm-table-th" style={{ paddingLeft: 10 }}>Detalle</div>
                <div className="gm-table-th">{presupuestoPersonalizado ? "Cant./medida" : "Cant."}</div>
                <div className="gm-table-th right">Precio</div>
                <div className="gm-table-th">IVA %</div>
                <div className="gm-table-th right">IVA $</div>
                <div className="gm-table-th right">Total</div>
                <div className="gm-table-th" />
              </div>

              <div className="gm-table-body">
                {computedRows.map((r) => {
                  const stockNum =
                    r.stock_disponible !== null && r.stock_disponible !== undefined
                      ? Number(r.stock_disponible)
                      : null;
                  const rowSinStock = !presupuestoPersonalizado && (r.sinStock || isSinStock(stockNum));

                  return (
                    <div key={r.id} className={`gm-table-row ${rowSinStock ? "gm-table-row--sin-stock" : ""}`}>
                      <div className="gm-table-cell gm-table-cell--detail">
                        <ProductStockAutocomplete
                          value={r.detalleText}
                          onChange={(val) => handleDetalleInputChange(r.id, val)}
                          onSelect={(d) => handleSelectDetalle(r.id, d)}
                          options={detallesList}
                          placeholder={presupuestoPersonalizado ? "Escribí un material/servicio o buscá en stock…" : "Escribí o buscá un producto…"}
                          emptyMessage={presupuestoPersonalizado ? "No existe en stock: podés dejar el texto escrito y cargarlo manualmente" : "Sin productos disponibles"}
                          allowOutOfStock={presupuestoPersonalizado}
                          disabled={saving}
                          showAllOnFocus={false}
                          maxItems={18}
                          inputClassName="gm-cell-input"
                        />
                      </div>

                      <div className="gm-table-cell gm-table-cell--center stock_cant">
                        <input
                          className="gm-cell-input gm-cell-input--center"
                          type="number"
                          min={rowSinStock ? undefined : (presupuestoPersonalizado ? "0.01" : "1")}
                          step={presupuestoPersonalizado ? "0.01" : "1"}
                          value={rowSinStock ? "" : r.cantidad}
                          onChange={(e) =>
                            handleCantidadChange(r.id, e.target.value === "" ? "" : Number(e.target.value))
                          }
                          disabled={saving || rowSinStock}
                          placeholder={rowSinStock ? "0" : ""}
                          title={rowSinStock ? "No podés ingresar cantidad porque el stock es 0" : ""}
                          style={{
                            width: "100%",
                            background: rowSinStock ? "#f3f4f6" : undefined,
                            color: rowSinStock ? "#b91c1c" : undefined,
                            borderColor: rowSinStock ? "#fca5a5" : undefined,
                            cursor: rowSinStock ? "not-allowed" : undefined,
                            opacity: rowSinStock ? 0.9 : 1,
                          }}
                        />
                        {r.stock_disponible !== null && r.stock_disponible !== undefined && (
                          <div
                            style={{
                              fontSize: "10px",
                              fontWeight: rowSinStock ? 700 : 500,
                              color: rowSinStock ? "#b91c1c" : "#666",
                            }}
                          >
                            {rowSinStock ? "Sin stock" : `Stock: ${r.stock_disponible}`}
                          </div>
                        )}
                      </div>

                    <div className="gm-table-cell gm-table-cell--center">
                      {Array.isArray(r.precios_disponibles) && r.precios_disponibles.length > 0 ? (
                        <PrecioDropdown
                          precios={r.precios_disponibles}
                          value={String(r.id_tipo_precio_stock || r.precios_disponibles?.[0]?.value || NULL_OPTION)}
                          onChange={(val) => handlePrecioTipoChange(r.id, val)}
                          disabled={saving || !r.precios_disponibles?.length}
                        />
                      ) : (
                        <input
                          className="gm-cell-input gm-cell-input--right"
                          type="text"
                          inputMode="decimal"
                          value={r.precioFocused ? r.precioDraft : moneyARS(r.precio)}
                          onFocus={(e) => {
                            handlePrecioFocus(r.id);
                            requestAnimationFrame(() => e.target.select());
                          }}
                          onChange={(e) => handlePrecioInputChange(r.id, e.target.value)}
                          onKeyDown={(e) => handlePrecioKeyDown(e, r.id)}
                          onBlur={() => commitPrecioInput(r.id)}
                          disabled={saving}
                        />
                      )}
                    </div>

                    <div className="gm-table-cell gm-table-cell--center">
                      <select
                        className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                        value={r.ivaPct}
                        onChange={(e) => updateRow(r.id, { ivaPct: Number(e.target.value) })}
                        disabled={saving}
                        style={{ width: "100%" }}
                      >
                        {IVA_OPTIONS.map((op) => (
                          <option key={op.value} value={op.value}>{op.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                      {moneyARS(r.iva_monto)}
                    </div>
                    <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                      {moneyARS(r.total)}
                    </div>
                    <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                      <button
                        type="button"
                        className="gm-row-delete dc-row-delete"
                        onClick={() => removeRow(r.id)}
                        disabled={saving || rows.length <= 1}
                        title="Eliminar fila"
                      >
                        ×
                      </button>
                    </div>
                    </div>
                  );
                })}
              </div>

              <div className="presupuesto-terms" aria-label="Condiciones comerciales del presupuesto">
                <div className="presupuesto-terms__title">Condiciones comerciales</div>
                <div className="presupuesto-terms__row">
                  <div className="gm-field presupuesto-terms__field presupuesto-terms__field--small">
                    <input
                      className="gm-input"
                      type="number"
                      min="0"
                      max="3650"
                      placeholder=" "
                      value={condiciones.validezDias}
                      onChange={(e) => updateCondicion("validezDias", e.target.value)}
                      disabled={saving}
                    />
                    <label className="gm-label">Validez (días)</label>
                  </div>
                  <div className="presupuesto-terms__hint">
                    {condicionesPreview.fecha_validez
                      ? `Válido hasta ${formatFechaCorta(condicionesPreview.fecha_validez)}`
                      : "Sin vencimiento informado"}
                  </div>
                </div>

                <div className="gm-field presupuesto-terms__field">
                  <textarea
                    className="gm-input presupuesto-terms__textarea"
                    rows={2}
                    placeholder=" "
                    value={condiciones.plazoEntrega}
                    onChange={(e) => updateCondicion("plazoEntrega", e.target.value)}
                    disabled={saving}
                  />
                  <label className="gm-label">Plazo de entrega / ejecución</label>
                </div>

                <div className="presupuesto-terms__row presupuesto-terms__row--split">
                  <div className="gm-field presupuesto-terms__field">
                    <textarea
                      className="gm-input presupuesto-terms__textarea"
                      rows={2}
                      placeholder=" "
                      value={condiciones.lugarEntrega}
                      onChange={(e) => updateCondicion("lugarEntrega", e.target.value)}
                      disabled={saving}
                    />
                    <label className="gm-label">Lugar de entrega / instalación</label>
                  </div>
                  <div className="gm-field presupuesto-terms__field">
                    <textarea
                      className="gm-input presupuesto-terms__textarea"
                      rows={2}
                      placeholder=" "
                      value={condiciones.garantia}
                      onChange={(e) => updateCondicion("garantia", e.target.value)}
                      disabled={saving}
                    />
                    <label className="gm-label">Garantía / soporte</label>
                  </div>
                </div>

                <div className="gm-field presupuesto-terms__field">
                  <textarea
                    className="gm-input presupuesto-terms__textarea"
                    rows={3}
                    placeholder=" "
                    value={condiciones.formaPago}
                    onChange={(e) => updateCondicion("formaPago", e.target.value)}
                    disabled={saving}
                  />
                  <label className="gm-label">Forma de pago</label>
                </div>

                <div className="gm-field presupuesto-terms__field">
                  <textarea
                    className="gm-input presupuesto-terms__textarea"
                    rows={3}
                    placeholder=" "
                    value={condiciones.condicionesComerciales}
                    onChange={(e) => updateCondicion("condicionesComerciales", e.target.value)}
                    disabled={saving}
                  />
                  <label className="gm-label">Aclaraciones / condiciones</label>
                </div>

                <div className="gm-field presupuesto-terms__field">
                  <textarea
                    className="gm-input presupuesto-terms__textarea"
                    rows={2}
                    placeholder=" "
                    value={condiciones.notas}
                    onChange={(e) => updateCondicion("notas", e.target.value)}
                    disabled={saving}
                  />
                  <label className="gm-label">Notas adicionales</label>
                </div>
              </div>

              <div className="gm-table-foot">
                <div className="gm-foot-actions">
                  <button type="button" className="gm-foot-btn" onClick={addRow} disabled={saving}>
                    <span className="gm-foot-btn__icon">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M5 1.5V8.5M1.5 5H8.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </span>
                    Agregar fila
                  </button>
                  <div className="gm-foot-sep" />
                </div>

                <div className="gm-summary-chips">
                  <div className="gm-summary-chip gm-summary-chip--sub">
                    <span>Subtotal</span>
                    <b>{moneyARS(totals.subtotal)}</b>
                  </div>
                  <div className="gm-summary-chip gm-summary-chip--iva">
                    <span>IVA</span>
                    <b>{moneyARS(totals.iva)}</b>
                  </div>
                  <div className="gm-summary-chip gm-summary-chip--total">
                    <span>Total</span>
                    <b>{moneyARS(totals.total)}</b>
                  </div>
                </div>
              </div>

            </section>

            <div className="gm-movement-side">
              <aside className="gm-aside">
                <div className="gm-section">
                  <div className="gm-section-head">
                    <div className="gm-section-dot" />
                    <span>Datos del presupuesto</span>
                  </div>

                  <div className="gm-section-body">
                    <div
                      className="gm-field"
                      onMouseDown={(e) => {
                        if (e.target !== fechaInputRef.current) {
                          e.preventDefault();
                        }
                      }}
                      onClick={openFechaPicker}
                    >
                      <input
                        ref={fechaInputRef}
                        className="gm-input"
                        type="date"
                        placeholder=" "
                        value={fecha}
                        onClick={openFechaPicker}
                        onFocus={openFechaPicker}
                        max={todayISO()}
                        onChange={(e) => setFecha(clampFechaHastaHoy(e.target.value))}
                        disabled={saving}
                      />
                      <label className="gm-label">Fecha</label>
                    </div>

                    <div className={`dc-prov-wrap dc-prov-wrap--cliente ${cliInput ? "dc-prov-wrap--filled" : ""}`}>
                      <GlobalAutocomplete
                        value={cliInput}
                        onChange={handleClienteInputChange}
                        onSelect={handleSelectCliente}
                        options={clientesOptions}
                        getOptionLabel={(c) => isAddClienteOption(c) ? "➕ Agregar cliente" : getClienteNombre(c)}
                        getOptionValue={(c) => isAddClienteOption(c) ? "__add_cliente__" : String(getClienteId(c) || getClienteNombre(c))}
                        label=""
                        placeholder=" "
                        disabled={saving || addUI.open}
                        showAllOnFocus={true}
                        maxItems={25}
                        inputClassName="gm-input dc-autocomplete-input"
                      />
                      <span className="gm-label dc-label--autocomplete">Cliente *</span>
                    </div>


                    <div className={`presupuesto-save-model ${guardarComoModelo ? "is-active" : ""}`}>
                      <label className="gm-inline-check presupuesto-check-card presupuesto-save-model__toggle">
                        <input
                          type="checkbox"
                          checked={guardarComoModelo}
                          onChange={(e) => setGuardarComoModelo(e.target.checked)}
                          disabled={saving}
                        />
                        <span className="gm-inline-check__box" aria-hidden="true" />
                        <span className="presupuesto-check-card__copy">
                          <b>Guardar también como modelo base</b>
                          <small>El presupuesto normal se crea igual y queda disponible para convertirlo en venta.</small>
                        </span>
                      </label>

                      {guardarComoModelo ? (
                        <div className="presupuesto-save-model__fields">
                          <div className="gm-field">
                            <input
                              className="gm-input"
                              type="text"
                              placeholder=" "
                              value={modeloNombre}
                              onChange={(e) => setModeloNombre(upperInput(e.target.value))}
                              maxLength={150}
                              disabled={saving}
                            />
                            <label className="gm-label">Nombre del modelo *</label>
                          </div>
                          <div className="gm-field">
                            <textarea
                              className="gm-input presupuesto-model-description"
                              placeholder=" "
                              value={modeloDescripcion}
                              onChange={(e) => setModeloDescripcion(upperInput(e.target.value))}
                              maxLength={500}
                              disabled={saving}
                              rows={2}
                            />
                            <label className="gm-label">Descripción del modelo</label>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="dc-info presupuesto-info">
                      Se guarda como presupuesto y genera PDF con validez, entrega, pago y condiciones. No impacta caja, ARCA ni medio de pago.
                    </div>
                  </div>
                </div>
              </aside>

              <div className="gm-actions gm-actions--sticky presupuesto-actions">
                <button
                  type="submit"
                  disabled={saving}
                  className="gm-action-btn gm-action-btn--save"
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={requestClose}
                  disabled={saving}
                  className="gm-action-btn gm-action-btn--cancel"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <ModalClienteFiscalArca
        open={addUI.open}
        dark={dark}
        title="Agregar cliente por CUIT"
        infoTitle="Alta rápida por CUIT"
        description={
          <>
            Ingresá el CUIT, consultamos ARCA, guardamos la razón social en <b>Clientes</b> y los datos completos en <b>Clientes fiscales</b>.
          </>
        }
        cuit={addUI.cuit}
        fiscalData={addUI.fiscalData}
        error={addUI.fiscalError}
        loading={addUI.lookupLoading}
        saving={addUI.saving}
        confirmText="Confirmar y cargar cliente"
        footerHelp="Primero buscá el CUIT. Cuando aparezcan los datos, confirmá para guardar la razón social en clientes y los datos completos en clientes fiscales."
        requireFiscalData={true}
        onCuitChange={(v) => setAddUI((p) => ({ ...p, cuit: v, fiscalData: null, fiscalError: "" }))}
        onLookup={consultarArcaAddCliente}
        onClose={closeAddCliente}
        onConfirm={guardarNuevoClienteDesdeArca}
      />
    </div>,
    document.body
  );
}
