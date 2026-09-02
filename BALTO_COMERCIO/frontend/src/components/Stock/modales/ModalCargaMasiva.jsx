import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "./ModalCargaMasiva.css";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante";
import ModalCargaIndividualProducto from "./ModalCargaIndividualProducto";
import { useListas } from "../../../context/ListasContext";
import Toast from "../../Global/Toast.jsx";
import { isBaltoDemoMode } from "../../../utils/demoMode";
import { isTopStockModal } from "./modalStackUtils";
import {
  clasificarTextoStock,
  crearCategoriaStock,
  crearProductoStock,
  crearTipoPrecioStock,
  importarArchivoStock,
} from "../api/stockApi";

import {
  faBoxOpen,
  faCloudArrowUp,
  faFileCsv,
  faImage,
  faXmark,
  faArrowUpFromBracket,
  faDownload,
  faTrashCan,
  faCircleExclamation,
  faCheckCircle,
  faBoxesStacked,
  faFilePdf,
  faTag,
  faBarcode,
  faCubesStacked,
  faAlignLeft,
  faEye,
  faListCheck,
  faPlus,
  faMoneyBillTrendUp,
  faLayerGroup,
  faPaperclip,
} from "@fortawesome/free-solid-svg-icons";

import {
  emptyExtraPriceRow,
  formatMoneyFocus,
  getUsuarioAuditData,
  moneyToApi,
  moneyToInput,
  normalizeMoneyInput,
  onlyNumbers,
  recalculatePricingGroup,
  toUpperCaseValue,
} from "../utils/stockFormUtils";

const EXTENSIONES_IMAGEN = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"];
const DEMO_CARGA_MASIVA_MESSAGE = "La carga masiva está disponible únicamente en cuentas activas con plan avanzado.";

function errorToText(error, fallback = "Ocurrió un error inesperado") {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  if (error.error) return error.error;
  return fallback;
}

function cleanDecoratedNumber(value) {
  return String(value ?? "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function parseDecoratedNumber(value) {
  const cleaned = cleanDecoratedNumber(value);
  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;

  const num = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function formatPriceDisplay(value) {
  const num = parseDecoratedNumber(value);
  if (num === null) return cleanDecoratedNumber(value);

  return `$ ${num.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercentDisplay(value) {
  const num = parseDecoratedNumber(value);
  if (num === null) return cleanDecoratedNumber(value);

  return `${num.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} %`;
}

function inferPriceInputKind(name = "") {
  const n = String(name).toLowerCase();

  if (
    n.includes("porcentaje") ||
    n.includes("_pct") ||
    n.includes("pct_") ||
    n.includes("tipo_pct") ||
    n.includes("margen_pct") ||
    n.includes("extra_margen_pct")
  ) {
    return "percent";
  }

  if (
    n.includes("precio") ||
    n.includes("costo") ||
    n.includes("margen_venta_valor") ||
    n.includes("margen_promo_valor") ||
    n.includes("margen_valor") ||
    n.includes("margen_val") ||
    n.includes("tipo_val") ||
    n.includes("extra_margen_val") ||
    n.includes("marginvalue")
  ) {
    return "money";
  }

  return "number";
}

function decoratePriceInputValue(value, kind, focused) {
  const cleaned = cleanDecoratedNumber(value);
  if (!cleaned) return "";
  if (focused) return cleaned;
  if (kind === "percent") return formatPercentDisplay(cleaned);
  if (kind === "money") return formatPriceDisplay(cleaned);
  return cleaned;
}

function withCleanPriceEvent(event, cleanValue) {
  return {
    ...event,
    target: {
      ...event.target,
      name: event.target?.name,
      value: cleanValue,
    },
    currentTarget: {
      ...event.currentTarget,
      name: event.currentTarget?.name,
      value: cleanValue,
    },
  };
}


function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

function getTipoArchivo(nombre) {
  if (!nombre) return "";
  const ext = nombre.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "pdf") return "pdf";
  if (EXTENSIONES_IMAGEN.includes(ext)) return "imagen";
  return "";
}

function getMetodoLabel(metodo) {
  switch (metodo) {
    case "google_vision":
      return "Google Vision OCR";
    case "php_pdfparser":
      return "PDF Parser";
    case "pdf_ocr_google_vision":
    case "imagick_google_vision":
      return "PDF escaneado + Google Vision OCR";
    default:
      return metodo || "No informado";
  }
}

function normalizarNombreTipoPrecio(nombre) {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function buscarTipoPrecioExistentePorNombre(tiposPrecio = [], nombre = "") {
  const nombreNormalizado = normalizarNombreTipoPrecio(nombre);
  if (!nombreNormalizado) return null;
  return (
    tiposPrecio.find(
      (tipo) => normalizarNombreTipoPrecio(tipo?.nombre) === nombreNormalizado
    ) || null
  );
}

function esTipoPrecioBaseCosto(nombre) {
  const n = normalizarNombreTipoPrecio(nombre);
  return ["COSTO", "PRECIO DE COSTO"].includes(n);
}

function esTipoPrecioBaseVenta(nombre) {
  const n = normalizarNombreTipoPrecio(nombre);
  return [
    "VENTA",
    "PRECIO DE VENTA",
    "PRECIO VENTA",
    "PUBLICO",
    "PRECIO PUBLICO",
    "LISTA",
    "PRECIO LISTA",
    "FINAL",
  ].includes(n);
}

function esTipoPrecioBasePromo(nombre) {
  const n = normalizarNombreTipoPrecio(nombre);
  return [
    "PROMO",
    "PROMOCION",
    "PROMOCIONAL",
    "PRECIO PROMO",
    "PRECIO PROMOCIONAL",
    "OFERTA",
    "DESCUENTO",
  ].includes(n);
}

function normalizarFilaTipoPrecioExtra(row = {}, tiposPrecio = []) {
  const tipoNombre = toUpperCaseValue(
    String(row.tipo_nombre ?? row.nombre ?? row.tipo ?? row.label ?? "").trim()
  );
  const existente = buscarTipoPrecioExistentePorNombre(tiposPrecio, tipoNombre);
  const idTipo = row.id_tipo_precio_stock ?? row.id ?? existente?.id ?? existente?.id_tipo_precio_stock ?? "";
  return {
    id_tipo_precio_stock: idTipo ? String(idTipo) : "",
    tipo_nombre: tipoNombre || toUpperCaseValue(String(existente?.nombre || "").trim()),
    precio: moneyToInput(row.precio ?? row.monto ?? ""),
    margen_porcentaje: moneyToInput(row.margen_porcentaje ?? ""),
    margen_valor: moneyToInput(row.margen_valor ?? ""),
  };
}

function precioPrincipalVariante(variante = {}, idTipo, camposDirectos = []) {
  for (const campo of camposDirectos) {
    const valor = variante?.[campo];
    if (valor !== null && valor !== undefined && String(valor).trim() !== "") return moneyToInput(valor);
  }
  const fila = (Array.isArray(variante?.precios) ? variante.precios : []).find(
    (precio) => Number(precio?.id_tipo_precio_stock ?? precio?.id ?? 0) === Number(idTipo)
  );
  return moneyToInput(fila?.monto ?? fila?.precio ?? "");
}

function normalizarVarianteDetectada(variante = {}) {
  return {
    ...variante,
    nombre_variante: toUpperCaseValue(String(variante.nombre_variante ?? variante.nombre ?? "").trim()),
    sku: toUpperCaseValue(String(variante.sku ?? variante.sku_variante ?? "").trim()),
    stock: variante.stock === null || variante.stock === undefined ? "" : String(variante.stock),
    precio_costo: precioPrincipalVariante(variante, 1, ["precio_costo", "costo"]),
    precio: precioPrincipalVariante(variante, 2, ["precio", "precio_venta"]),
    precio_promo: precioPrincipalVariante(variante, 3, ["precio_promo", "precio_promocional"]),
    atributos: (Array.isArray(variante.atributos) ? variante.atributos : [])
      .filter((atributo) => atributo && (atributo.atributo || atributo.nombre) && (atributo.valor || atributo.nombre_valor))
      .map((atributo) => ({
        atributo: toUpperCaseValue(String(atributo.atributo ?? atributo.nombre ?? "").trim()),
        valor: toUpperCaseValue(String(atributo.valor ?? atributo.nombre_valor ?? "").trim()),
      })),
  };
}

function prepararVarianteDetectadaParaApi(variante = {}) {
  const principales = new Set([1, 2, 3]);
  const precios = (Array.isArray(variante.precios) ? variante.precios : [])
    .filter((fila) => !principales.has(Number(fila?.id_tipo_precio_stock ?? fila?.id ?? 0)))
    .map((fila) => ({ ...fila }));
  [
    [1, variante.precio_costo],
    [2, variante.precio],
    [3, variante.precio_promo],
  ].forEach(([idTipo, valor]) => {
    const monto = moneyToApi(valor);
    if (monto !== "") precios.push({ id_tipo_precio_stock: idTipo, monto, precio: monto });
  });
  return {
    ...variante,
    nombre_variante: toUpperCaseValue(String(variante.nombre_variante || "").trim()),
    sku: toUpperCaseValue(String(variante.sku || "").trim()),
    stock: variante.stock !== "" ? String(variante.stock) : "0",
    atributos: Array.isArray(variante.atributos) ? variante.atributos : [],
    precios,
  };
}

function stockTotalVariantes(variantes = []) {
  return (Array.isArray(variantes) ? variantes : []).reduce(
    (total, variante) => total + Math.max(0, Number(variante?.stock || 0) || 0),
    0
  );
}

function TipoBadge({ tipo }) {
  const map = {
    csv: { label: "CSV", cls: "cmi-badge--csv" },
    pdf: { label: "PDF", cls: "cmi-badge--pdf" },
    imagen: { label: "Imagen", cls: "cmi-badge--img" },
    "": { label: "NO VÁLIDO", cls: "cmi-badge--none" },
  };
  const { label, cls } = map[tipo] ?? map[""];
  return <span className={`cmi-badge ${cls}`}>{label}</span>;
}

function IconoArchivo({ tipo }) {
  if (tipo === "csv") return <FontAwesomeIcon icon={faFileCsv} />;
  if (tipo === "pdf") return <FontAwesomeIcon icon={faFilePdf} />;
  if (tipo === "imagen") return <FontAwesomeIcon icon={faImage} />;
  return <FontAwesomeIcon icon={faCircleExclamation} />;
}

const ErrorMsg = ({ msg }) => (
  <span
    style={{
      fontSize: "0.76rem",
      color: "#ef4444",
      marginTop: 2,
      display: "flex",
      alignItems: "center",
      gap: 4,
    }}
  >
    <FontAwesomeIcon icon={faCircleExclamation} style={{ fontSize: 10 }} />
    {msg}
  </span>
);

const plantillaCsvMasivo = `nombre;sku;precio_costo;precio_venta;margen_venta_porcentaje;margen_venta_valor;precio_promocional;margen_promo_porcentaje;margen_promo_valor;stock;descripcion
SMARTWATCH MI BAND 9 XIAOMI;04163;65000;89999;;;79999;;;12;Pulsera inteligente Xiaomi
CARGADOR UNIVERSAL NOTEBOOK - ONLY - CON FICHA HP - 8 PINES;00410;18000;25999;;; ;;;33;Cargador notebook HP
AFEITADORA CORPORAL 3 EN 1;04162;32000;45999;;;39999;;;8;Afeitadora corporal
`;

function FloatingField({ label, icon, error, children, style }) {
  return (
    <div className="cmi-floatingField cmi-floatingField--active" style={style}>
      <label className="cmi-floatingLabel cmi-floatingLabel--active">
        {icon && (
          <FontAwesomeIcon
            icon={icon}
            style={{ marginRight: 5, opacity: 0.7, fontSize: 11 }}
          />
        )}
        {label}
      </label>
      {children}
      {error && <ErrorMsg msg={error} />}
    </div>
  );
}

function PriceInput({ name, value, onChange, onBlur, onFocus, placeholder, disabled, className }) {
  const [focused, setFocused] = useState(false);
  const kind = inferPriceInputKind(name);
  const displayValue = decoratePriceInputValue(value, kind, focused);

  const handleChange = (e) => {
    const cleanValue = cleanDecoratedNumber(e.target.value);
    onChange?.(withCleanPriceEvent(e, cleanValue));
  };

  const handleFocus = (e) => {
    setFocused(true);
    const cleanValue = cleanDecoratedNumber(e.target.value);
    onFocus?.(withCleanPriceEvent(e, cleanValue));
  };

  const handleBlur = (e) => {
    setFocused(false);
    const cleanValue = cleanDecoratedNumber(e.target.value);
    onBlur?.(withCleanPriceEvent(e, cleanValue));
  };

  return (
    <input
      name={name}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={className || "cmi-input"}
      placeholder={placeholder || (kind === "percent" ? "0 %" : "$ 0,00")}
      disabled={disabled}
      inputMode="decimal"
    />
  );
}

function MiniCreateModal({ open, title, value, loading, onChange, onCancel, onSave }) {
  if (!open) return null;
  return createPortal(
    <div className="cmi-miniOverlay">
      <div className="cmi-miniModal">
        <div className="cmi-miniModal__head">{title}</div>
        <div className="cmi-miniModal__body">
          <FloatingField label="Nombre *">
            <input
              className="cmi-input"
              value={value}
              onChange={(e) => onChange(toUpperCaseValue(e.target.value))}
              placeholder="ESCRIBÍ EL NOMBRE"
              style={{ textTransform: "uppercase" }}
              autoFocus
            />
          </FloatingField>
          <div className="cmi-miniModal__actions">
            <button type="button" className="mit-btn mit-btn--ghost" onClick={onCancel} disabled={loading}>
              Cancelar
            </button>
            <button type="button" className="mit-btn mit-btn--solid" onClick={onSave} disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function recalcularProductoDetectadoInicial(producto = {}) {
  const venta = recalculatePricingGroup({
    cost: producto.precio_costo,
    price: producto.precio,
    marginPct: producto.margen_venta_porcentaje,
    marginValue: producto.margen_venta_valor,
    source: producto.precio
      ? "price"
      : producto.margen_venta_porcentaje
      ? "marginPct"
      : producto.margen_venta_valor
      ? "marginValue"
      : null,
  });

  const promo = recalculatePricingGroup({
    cost: producto.precio_costo,
    price: producto.precio_promo,
    marginPct: producto.margen_promo_porcentaje,
    marginValue: producto.margen_promo_valor,
    source: producto.precio_promo
      ? "price"
      : producto.margen_promo_porcentaje
      ? "marginPct"
      : producto.margen_promo_valor
      ? "marginValue"
      : null,
  });

  const extras = (producto.tipos_precio_extra || []).map((row) => {
    const r = recalculatePricingGroup({
      cost: producto.precio_costo,
      price: row.precio,
      marginPct: row.margen_porcentaje,
      marginValue: row.margen_valor,
      source: row.precio
        ? "price"
        : row.margen_porcentaje
        ? "marginPct"
        : row.margen_valor
        ? "marginValue"
        : null,
    });
    return {
      ...row,
      precio: r.price,
      margen_porcentaje: r.marginPct,
      margen_valor: r.marginValue,
    };
  });

  return {
    ...producto,
    precio: venta.price,
    margen_venta_porcentaje: venta.marginPct,
    margen_venta_valor: venta.marginValue,
    precio_promo: promo.price,
    margen_promo_porcentaje: promo.marginPct,
    margen_promo_valor: promo.marginValue,
    tipos_precio_extra: extras,
  };
}

function normalizarProductoDetectado(item = {}, tiposPrecio = []) {
  const variantes = (Array.isArray(item.variantes) ? item.variantes : []).map(normalizarVarianteDetectada);
  let precioCosto = moneyToInput(item.precio_costo ?? "");
  let precioVenta = moneyToInput(item.precio ?? item.precio_venta ?? "");
  let precioPromo = moneyToInput(item.precio_promo ?? item.precio_promocional ?? "");

  // En productos con variantes, el formulario general muestra la primera variante
  // como referencia; cada valor real se conserva y se edita en su tarjeta individual.
  if (variantes.length > 0) {
    if (!precioCosto) precioCosto = variantes[0].precio_costo;
    if (!precioVenta) precioVenta = variantes[0].precio;
    if (!precioPromo) precioPromo = variantes[0].precio_promo;
  }

  const tiposExtra = [];
  const vistos = new Set();

  (Array.isArray(item.tipos_precio_extra) ? item.tipos_precio_extra : []).forEach((row) => {
    const fila = normalizarFilaTipoPrecioExtra(row, tiposPrecio);
    const tipoNormalizado = normalizarNombreTipoPrecio(fila.tipo_nombre);
    const precioFila = fila.precio;

    if (!tipoNormalizado || !precioFila) return;
    if (esTipoPrecioBaseCosto(tipoNormalizado)) { if (!precioCosto) precioCosto = precioFila; return; }
    if (esTipoPrecioBaseVenta(tipoNormalizado)) { if (!precioVenta) precioVenta = precioFila; return; }
    if (esTipoPrecioBasePromo(tipoNormalizado)) { if (!precioPromo) precioPromo = precioFila; return; }
    if (vistos.has(tipoNormalizado)) return;
    vistos.add(tipoNormalizado);
    tiposExtra.push(fila);
  });

  const productoBase = {
    nombre: toUpperCaseValue(String(item.nombre ?? "").trim()),
    sku: toUpperCaseValue(String(item.sku ?? "").trim()),
    precio_costo: precioCosto,
    precio: precioVenta,
    margen_venta_porcentaje: moneyToInput(item.margen_venta_porcentaje ?? ""),
    margen_venta_valor: moneyToInput(item.margen_venta_valor ?? ""),
    precio_promo: precioPromo,
    margen_promo_porcentaje: moneyToInput(item.margen_promo_porcentaje ?? ""),
    margen_promo_valor: moneyToInput(item.margen_promo_valor ?? ""),
    stock: variantes.length > 0
      ? String(stockTotalVariantes(variantes))
      : item.stock === null || item.stock === undefined ? "" : String(item.stock),
    descripcion: toUpperCaseValue(String(item.descripcion ?? "").trim()),
    id_categoria_stock:
      item.id_categoria_stock === null || item.id_categoria_stock === undefined
        ? ""
        : String(item.id_categoria_stock),
    imagen: null,
    tipos_precio_extra: tiposExtra,
    tiene_variantes: Boolean(item.tiene_variantes) || variantes.length > 0,
    variantes,
  };

  return recalcularProductoDetectadoInicial(productoBase);
}

function ModalConfirmarProductosIA({
  open,
  dark,
  productos,
  categorias,
  tiposPrecio,
  loadingCategorias,
  loadingTiposPrecio,
  onClose,
  onChangeProducto,
  onPricingBlur,
  onRecalcByCost,
  onAddFila,
  onRemoveFila,
  onTakeImage,
  onRemoveImage,
  onPreviewImage,
  onConfirm,
  confirmando,
  errores,
  onCategoriaCreate,
  onTipoCreate,
  mostrarToast,
  onPricingChange,
  onExtraPricingChange,
}) {
  const [miniCategoriaOpen, setMiniCategoriaOpen] = useState(false);
  const [miniCategoriaNombre, setMiniCategoriaNombre] = useState("");
  const [miniCategoriaFila, setMiniCategoriaFila] = useState(null);
  const [guardandoMiniCategoria, setGuardandoMiniCategoria] = useState(false);

  const [miniTipoOpen, setMiniTipoOpen] = useState(false);
  const [miniTipoNombre, setMiniTipoNombre] = useState("");
  const [miniTipoFila, setMiniTipoFila] = useState(null);
  const [guardandoMiniTipo, setGuardandoMiniTipo] = useState(false);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e) => {
      if (e.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;

      e.preventDefault();
      e.stopPropagation();
      if (!confirmando && !miniCategoriaOpen && !miniTipoOpen) onClose?.();
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open, confirmando, miniCategoriaOpen, miniTipoOpen, onClose]);

  if (!open) return null;

  const guardarCategoria = async () => {
    if (miniCategoriaFila === null || !miniCategoriaNombre.trim()) return;
    setGuardandoMiniCategoria(true);
    try {
      const nueva = await onCategoriaCreate(toUpperCaseValue(miniCategoriaNombre.trim()));
      onChangeProducto(miniCategoriaFila, "id_categoria_stock", String(nueva.id ?? nueva.id_stock_categoria ?? ""));
      setMiniCategoriaOpen(false);
      setMiniCategoriaNombre("");
      setMiniCategoriaFila(null);
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear la categoría"), "error");
    } finally {
      setGuardandoMiniCategoria(false);
    }
  };

  const guardarTipo = async () => {
    if (miniTipoFila === null || !miniTipoNombre.trim()) return;
    setGuardandoMiniTipo(true);
    try {
      const nuevo = await onTipoCreate(toUpperCaseValue(miniTipoNombre.trim()));
      const current = productos[miniTipoFila]?.tipos_precio_extra || [];
      onChangeProducto(miniTipoFila, "tipos_precio_extra", [...current, emptyExtraPriceRow(nuevo)]);
      setMiniTipoOpen(false);
      setMiniTipoNombre("");
      setMiniTipoFila(null);
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear el tipo de precio"), "error");
    } finally {
      setGuardandoMiniTipo(false);
    }
  };

  const handleTipoSelectChange = (idx, item, val) => {
    if (!val) return;
    if (val === "__nuevo_tipo__") {
      setMiniTipoFila(idx);
      setMiniTipoOpen(true);
      return;
    }
    const tipo = tiposPrecio.find((t) => String(t.id ?? t.id_tipo_precio_stock) === String(val));
    if (!tipo) return;
    const nombreTipo = normalizarNombreTipoPrecio(tipo.nombre);
    const existe = (item.tipos_precio_extra || []).some((x) => {
      const mismoId = String(x.id_tipo_precio_stock || "") === String(val);
      const mismoNombre = normalizarNombreTipoPrecio(x.tipo_nombre) === nombreTipo;
      return mismoId || mismoNombre;
    });
    if (existe) return;
    onChangeProducto(idx, "tipos_precio_extra", [
      ...(item.tipos_precio_extra || []),
      emptyExtraPriceRow(tipo),
    ]);
  };

  const cambiarVariante = (productoIdx, varianteIdx, field, value) => {
    const actuales = Array.isArray(productos[productoIdx]?.variantes)
      ? productos[productoIdx].variantes
      : [];
    const siguientes = actuales.map((variante, idx) =>
      idx === varianteIdx ? { ...variante, [field]: value } : variante
    );
    onChangeProducto(productoIdx, "variantes", siguientes);
    if (field === "stock") onChangeProducto(productoIdx, "stock", String(stockTotalVariantes(siguientes)));
  };

  const quitarVariante = (productoIdx, varianteIdx) => {
    const actuales = Array.isArray(productos[productoIdx]?.variantes)
      ? productos[productoIdx].variantes
      : [];
    const siguientes = actuales.filter((_, idx) => idx !== varianteIdx);
    onChangeProducto(productoIdx, "variantes", siguientes);
    onChangeProducto(productoIdx, "tiene_variantes", siguientes.length > 0);
    onChangeProducto(productoIdx, "stock", String(stockTotalVariantes(siguientes)));
  };

  return createPortal(
    <>
      <div ref={overlayRef} data-stock-modal-overlay="true" className={["mi-modal__overlay", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}>
        <div
          className={["mi-modal__container", "cmi-container", dark ? "mi-modal--dark" : ""].join(" ").trim()}
          role="dialog"
          aria-modal="true"
          style={{ width: "min(1180px, 96vw)", maxHeight: "92vh" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mi-modal__header">
            <div className="mi-modal__head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faListCheck} />
            </div>
            <div className="mi-modal__head-left">
              <h2 className="mi-modal__title">Confirmar productos detectados</h2>
              <p className="mi-modal__subtitle">Revisá y corregí los datos antes de cargarlos a la base</p>
            </div>
            <button className="mi-modal__close" onClick={onClose} aria-label="Cerrar" disabled={confirmando} type="button">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="mi-modal__content" style={{ overflowY: "auto", padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div className="mi-card__hint">
                Se detectaron <b>{productos.length}</b> producto{productos.length !== 1 ? "s" : ""}.
              </div>
              <button
                type="button"
                className="mit-btn mit-btn--ghost"
                onClick={onAddFila}
                disabled={confirmando}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <FontAwesomeIcon icon={faPlus} /> Agregar fila
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {productos.map((item, idx) => {
                const err = errores[`fila_${idx}`] || {};
                const tieneVariantes = Array.isArray(item.variantes) && item.variantes.length > 0;
                return (
                  <div
                    key={idx}
                    style={{
                      border: "1px solid var(--nv-border-md)",
                      borderRadius: 14,
                      padding: 14,
                      background: "var(--nv-bg-soft, rgba(255,255,255,0.02))",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Producto {idx + 1}</div>
                      <button
                        type="button"
                        className="mit-btn mit-btn--ghost"
                        onClick={() => onRemoveFila(idx)}
                        disabled={confirmando || productos.length <= 1}
                      >
                        <FontAwesomeIcon icon={faTrashCan} /> Quitar
                      </button>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <FloatingField label="Nombre *" error={err.nombre}>
                        <input
                          className="cmi-input"
                          value={item.nombre}
                          onChange={(e) => onChangeProducto(idx, "nombre", toUpperCaseValue(e.target.value))}
                          placeholder="NOMBRE DEL PRODUCTO"
                        />
                      </FloatingField>

                      <div className="fl-row">
                        <FloatingField label="SKU / Código" icon={faBarcode}>
                          <input
                            className="cmi-input"
                            value={item.sku}
                            onChange={(e) => onChangeProducto(idx, "sku", toUpperCaseValue(e.target.value))}
                            placeholder="Ej: 04163"
                          />
                        </FloatingField>
                        <FloatingField label={tieneVariantes ? "Stock total de variantes" : "Stock"} icon={faCubesStacked} error={err.stock}>
                          <input
                            className="cmi-input"
                            value={tieneVariantes ? String(stockTotalVariantes(item.variantes)) : item.stock}
                            onChange={(e) => onChangeProducto(idx, "stock", onlyNumbers(e.target.value))}
                            placeholder="Ej: 25"
                            inputMode="numeric"
                            readOnly={tieneVariantes}
                          />
                        </FloatingField>
                      </div>

                      {Array.isArray(item.variantes) && item.variantes.length > 0 ? (
                        <div className="mi-card__hint" style={{ marginTop: -4 }}>
                          Se detectaron <b>{item.variantes.length}</b> variante{item.variantes.length !== 1 ? "s" : ""}.
                        </div>
                      ) : null}

                      {tieneVariantes ? (
                        <div className="cmi-priceBlock">
                          <div className="cmi-priceBlock__title">
                            <FontAwesomeIcon icon={faBoxesStacked} /> Variantes detectadas: stock y precios
                          </div>
                          {err.variantes ? <ErrorMsg msg={err.variantes} /> : null}

                          {item.variantes.map((variante, varianteIdx) => (
                            <div
                              className="cmi-extraPriceCard"
                              key={`${variante.sku || variante.nombre_variante || "variante"}-${varianteIdx}`}
                              style={{ display: "flex", flexDirection: "column", gap: 12 }}
                            >
                              <div className="cmi-extraPriceCard__head">
                                <div className="cmi-extraPriceCard__title">Variante {varianteIdx + 1}</div>
                                <button
                                  type="button"
                                  className="mit-btn mit-btn--ghost"
                                  onClick={() => quitarVariante(idx, varianteIdx)}
                                  disabled={confirmando || item.variantes.length <= 1}
                                >
                                  <FontAwesomeIcon icon={faTrashCan} /> Quitar
                                </button>
                              </div>

                              <div className="fl-row" style={{ gridTemplateColumns: "1.5fr 1fr 0.7fr" }}>
                                <FloatingField label="Nombre de variante *">
                                  <input
                                    className="cmi-input"
                                    value={variante.nombre_variante || ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "nombre_variante", toUpperCaseValue(e.target.value))}
                                    placeholder="Ej: NEGRO / M"
                                  />
                                </FloatingField>
                                <FloatingField label="SKU variante" icon={faBarcode}>
                                  <input
                                    className="cmi-input"
                                    value={variante.sku || ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "sku", toUpperCaseValue(e.target.value))}
                                    placeholder="SKU"
                                  />
                                </FloatingField>
                                <FloatingField label="Stock" icon={faCubesStacked}>
                                  <input
                                    className="cmi-input"
                                    value={variante.stock ?? ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "stock", onlyNumbers(e.target.value))}
                                    inputMode="numeric"
                                    placeholder="0"
                                  />
                                </FloatingField>
                              </div>

                              {Array.isArray(variante.atributos) && variante.atributos.length > 0 ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {variante.atributos.map((atributo, atributoIdx) => (
                                    <span
                                      key={`${atributo.atributo}-${atributoIdx}`}
                                      className="cmi-badge"
                                      style={{ padding: "6px 9px" }}
                                    >
                                      {atributo.atributo}: {atributo.valor}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              <div className="fl-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                                <FloatingField label="Precio de costo">
                                  <PriceInput
                                    name={`variante_precio_costo_${idx}_${varianteIdx}`}
                                    value={variante.precio_costo || ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "precio_costo", normalizeMoneyInput(e.target.value))}
                                  />
                                </FloatingField>
                                <FloatingField label="Precio de venta *">
                                  <PriceInput
                                    name={`variante_precio_${idx}_${varianteIdx}`}
                                    value={variante.precio || ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "precio", normalizeMoneyInput(e.target.value))}
                                  />
                                </FloatingField>
                                <FloatingField label="Precio promocional">
                                  <PriceInput
                                    name={`variante_precio_promo_${idx}_${varianteIdx}`}
                                    value={variante.precio_promo || ""}
                                    onChange={(e) => cambiarVariante(idx, varianteIdx, "precio_promo", normalizeMoneyInput(e.target.value))}
                                  />
                                </FloatingField>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {/* ── PRECIOS ── */}
                      <div className="cmi-priceBlock">
                        <div className="cmi-priceBlock__title">
                          <FontAwesomeIcon icon={faMoneyBillTrendUp} /> {tieneVariantes ? "Precio de referencia (primera variante)" : "Precios principales"}
                        </div>

                        <FloatingField label="Precio de costo" error={err.precio_costo}>
                          <PriceInput
                            name={`precio_costo_${idx}`}
                            value={item.precio_costo}
                            onChange={(e) => onRecalcByCost(idx, e.target.value)}
                            onBlur={(e) => onRecalcByCost(idx, e.target.value)}
                            onFocus={(e) => onChangeProducto(idx, "precio_costo", formatMoneyFocus(e.target.value))}
                            disabled={tieneVariantes}
                          />
                        </FloatingField>

                        <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                          <FloatingField label="Precio de venta *" error={err.precio}>
                            <PriceInput
                              name={`precio_${idx}`}
                              value={item.precio}
                              onChange={(e) => onPricingChange(idx, e.target.value, "price", "venta")}
                              onBlur={() => onPricingBlur(idx, "price", "venta")}
                              onFocus={(e) => onChangeProducto(idx, "precio", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes}
                            />
                          </FloatingField>
                          <FloatingField label="Margen %">
                            <PriceInput
                              name={`margen_venta_porcentaje_${idx}`}
                              value={item.margen_venta_porcentaje}
                              onChange={(e) => onPricingChange(idx, e.target.value, "marginPct", "venta")}
                              onBlur={() => onPricingBlur(idx, "marginPct", "venta")}
                              onFocus={(e) => onChangeProducto(idx, "margen_venta_porcentaje", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes || !item.precio_costo}
                            />
                          </FloatingField>
                          <FloatingField label="Margen $">
                            <PriceInput
                              name={`margen_venta_valor_${idx}`}
                              value={item.margen_venta_valor}
                              onChange={(e) => onPricingChange(idx, e.target.value, "marginValue", "venta")}
                              onBlur={() => onPricingBlur(idx, "marginValue", "venta")}
                              onFocus={(e) => onChangeProducto(idx, "margen_venta_valor", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes || !item.precio_costo}
                            />
                          </FloatingField>
                        </div>

                        <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                          <FloatingField label="Precio promocional" error={err.precio_promo}>
                            <PriceInput
                              name={`precio_promo_${idx}`}
                              value={item.precio_promo}
                              onChange={(e) => onPricingChange(idx, e.target.value, "price", "promo")}
                              onBlur={() => onPricingBlur(idx, "price", "promo")}
                              onFocus={(e) => onChangeProducto(idx, "precio_promo", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes}
                            />
                          </FloatingField>
                          <FloatingField label="Margen %">
                            <PriceInput
                              name={`margen_promo_porcentaje_${idx}`}
                              value={item.margen_promo_porcentaje}
                              onChange={(e) => onPricingChange(idx, e.target.value, "marginPct", "promo")}
                              onBlur={() => onPricingBlur(idx, "marginPct", "promo")}
                              onFocus={(e) => onChangeProducto(idx, "margen_promo_porcentaje", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes || !item.precio_costo}
                            />
                          </FloatingField>
                          <FloatingField label="Margen $">
                            <PriceInput
                              name={`margen_promo_valor_${idx}`}
                              value={item.margen_promo_valor}
                              onChange={(e) => onPricingChange(idx, e.target.value, "marginValue", "promo")}
                              onBlur={() => onPricingBlur(idx, "marginValue", "promo")}
                              onFocus={(e) => onChangeProducto(idx, "margen_promo_valor", formatMoneyFocus(e.target.value))}
                              disabled={tieneVariantes || !item.precio_costo}
                            />
                          </FloatingField>
                        </div>
                      </div>

                      {/* ── TIPOS DE PRECIO ADICIONALES ── */}
                      <div className="cmi-priceBlock">
                        <div className="cmi-priceBlock__title">
                          <FontAwesomeIcon icon={faLayerGroup} /> Tipos de precio adicionales
                        </div>

                        <FloatingField label="Agregar tipo de precio">
                          <select
                            className="cmi-input cmi-select"
                            value=""
                            onChange={(e) => handleTipoSelectChange(idx, item, e.target.value)}
                            disabled={loadingTiposPrecio || confirmando}
                          >
                            <option value="">{loadingTiposPrecio ? "Cargando tipos..." : "Seleccionar tipo para agregar..."}</option>
                            <option value="__nuevo_tipo__">+ Nuevo tipo de precio</option>
                            {tiposPrecio.map((tipo) => (
                              <option key={tipo.id ?? tipo.id_tipo_precio_stock} value={tipo.id ?? tipo.id_tipo_precio_stock}>
                                {tipo.nombre}
                              </option>
                            ))}
                          </select>
                        </FloatingField>

                        {(item.tipos_precio_extra || []).map((tipoItem, tIdx) => (
                          <div className="cmi-extraPriceCard" key={`${tipoItem.id_tipo_precio_stock}-${tIdx}`}>
                            <div className="cmi-extraPriceCard__head">
                              <div className="cmi-extraPriceCard__title">{tipoItem.tipo_nombre || `Tipo ${tIdx + 1}`}</div>
                              <button
                                type="button"
                                className="mit-btn mit-btn--ghost"
                                onClick={() =>
                                  onChangeProducto(
                                    idx,
                                    "tipos_precio_extra",
                                    (item.tipos_precio_extra || []).filter((_, i) => i !== tIdx)
                                  )
                                }
                              >
                                <FontAwesomeIcon icon={faTrashCan} /> Quitar
                              </button>
                            </div>

                            <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                              <FloatingField label="Precio">
                                <PriceInput
                                  name={`tipo_precio_${idx}_${tIdx}`}
                                  value={tipoItem.precio}
                                  onChange={(e) => onExtraPricingChange(idx, tIdx, e.target.value, "price")}
                                  onBlur={() => {
                                    const result = recalculatePricingGroup({
                                      cost: item.precio_costo,
                                      price: tipoItem.precio,
                                      marginPct: tipoItem.margen_porcentaje,
                                      marginValue: tipoItem.margen_valor,
                                      source: "price",
                                    });
                                    const next = [...(item.tipos_precio_extra || [])];
                                    next[tIdx] = { ...next[tIdx], precio: result.price, margen_porcentaje: result.marginPct, margen_valor: result.marginValue };
                                    onChangeProducto(idx, "tipos_precio_extra", next);
                                  }}
                                />
                              </FloatingField>
                              <FloatingField label="Margen %">
                                <PriceInput
                                  name={`tipo_pct_${idx}_${tIdx}`}
                                  value={tipoItem.margen_porcentaje}
                                  onChange={(e) => onExtraPricingChange(idx, tIdx, e.target.value, "marginPct")}
                                  onBlur={() => {
                                    const result = recalculatePricingGroup({
                                      cost: item.precio_costo,
                                      price: tipoItem.precio,
                                      marginPct: tipoItem.margen_porcentaje,
                                      marginValue: tipoItem.margen_valor,
                                      source: "marginPct",
                                    });
                                    const next = [...(item.tipos_precio_extra || [])];
                                    next[tIdx] = { ...next[tIdx], precio: result.price, margen_porcentaje: result.marginPct, margen_valor: result.marginValue };
                                    onChangeProducto(idx, "tipos_precio_extra", next);
                                  }}
                                  disabled={!item.precio_costo}
                                />
                              </FloatingField>
                              <FloatingField label="Margen $">
                                <PriceInput
                                  name={`tipo_val_${idx}_${tIdx}`}
                                  value={tipoItem.margen_valor}
                                  onChange={(e) => onExtraPricingChange(idx, tIdx, e.target.value, "marginValue")}
                                  onBlur={() => {
                                    const result = recalculatePricingGroup({
                                      cost: item.precio_costo,
                                      price: tipoItem.precio,
                                      marginPct: tipoItem.margen_porcentaje,
                                      marginValue: tipoItem.margen_valor,
                                      source: "marginValue",
                                    });
                                    const next = [...(item.tipos_precio_extra || [])];
                                    next[tIdx] = { ...next[tIdx], precio: result.price, margen_porcentaje: result.marginPct, margen_valor: result.marginValue };
                                    onChangeProducto(idx, "tipos_precio_extra", next);
                                  }}
                                  disabled={!item.precio_costo}
                                />
                              </FloatingField>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* ── CATEGORÍA ── */}
                      <FloatingField label="Categoría" icon={faTag}>
                        <select
                          className="cmi-input cmi-select"
                          value={item.id_categoria_stock}
                          onChange={(e) => {
                            if (e.target.value === "__nueva_categoria__") {
                              setMiniCategoriaFila(idx);
                              setMiniCategoriaOpen(true);
                              return;
                            }
                            onChangeProducto(idx, "id_categoria_stock", e.target.value);
                          }}
                          disabled={loadingCategorias || confirmando}
                        >
                          <option value="">{loadingCategorias ? "Cargando categorías..." : "Sin categoría"}</option>
                          <option value="__nueva_categoria__">+ Nueva categoría</option>
                          {categorias.map((cat) => (
                            <option key={cat.id ?? cat.id_stock_categoria} value={cat.id ?? cat.id_stock_categoria}>
                              {cat.nombre}
                            </option>
                          ))}
                        </select>
                      </FloatingField>

                      {/* ── DESCRIPCIÓN ── */}
                      <FloatingField label="Descripción" icon={faAlignLeft}>
                        <textarea
                          className="cmi-input cmi-textarea"
                          rows={3}
                          value={item.descripcion}
                          onChange={(e) => onChangeProducto(idx, "descripcion", toUpperCaseValue(e.target.value))}
                          placeholder="DESCRIPCIÓN OPCIONAL"
                        />
                      </FloatingField>

                      {/* ── IMAGEN (diseño unificado con ModalCargaIndividualProducto) ── */}
                      <div className="cmi-uploadBox">
                        <div className="cmi-uploadBox__title">
                          <FontAwesomeIcon icon={faPaperclip} />
                          Imagen del producto
                        </div>

                        <input
                          id={`imagen_detectada_${idx}`}
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp,.gif,image/*"
                          hidden
                          onChange={(e) => onTakeImage?.(idx, e.target.files?.[0])}
                        />

                        {!item.imagen ? (
                          <button
                            type="button"
                            className="mit-btn mit-btn--ghost"
                            onClick={() => document.getElementById(`imagen_detectada_${idx}`)?.click()}
                            disabled={confirmando}
                            style={{
                              alignSelf: "flex-start",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                            }}
                          >
                            <FontAwesomeIcon icon={faArrowUpFromBracket} style={{ fontSize: 12 }} />
                            Seleccionar imagen
                          </button>
                        ) : (
                          <div className="cmi-fileResume">
                            <div className="cmi-fileResume__left">
                              <span className="cmi-fileResume__icon">
                                <FontAwesomeIcon icon={faImage} />
                              </span>
                              <div className="cmi-fileResume__meta">
                                <div className="cmi-fileResume__name">{item.imagen.name}</div>
                                <TipoBadge tipo="imagen" />
                              </div>
                            </div>

                            <div className="cmi-fileActions">
                              <button
                                type="button"
                                className="mit-btn mit-btn--ghost"
                                onClick={() => onPreviewImage?.(item.imagen)}
                                style={{ padding: "6px 10px", fontSize: 13 }}
                                title="Ver imagen"
                              >
                                <FontAwesomeIcon icon={faEye} />
                              </button>
                              <button
                                type="button"
                                className="mit-btn mit-btn--ghost"
                                onClick={() => onRemoveImage?.(idx)}
                                disabled={confirmando}
                                style={{
                                  padding: "6px 10px",
                                  fontSize: 13,
                                  color: "#ef4444",
                                  borderColor: "rgba(239,68,68,0.25)",
                                }}
                                title="Quitar imagen"
                              >
                                <FontAwesomeIcon icon={faTrashCan} />
                              </button>
                            </div>
                          </div>
                        )}

                        {err.imagen && <ErrorMsg msg={err.imagen} />}
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="cmi-footer">
            <div className="mi-card__hint cmi-footer__hint">Confirmá solo cuando los datos estén correctos.</div>
            <div className="cmi-footer__btns">
              <button type="button" className="mit-btn mit-btn--ghost" onClick={onClose} disabled={confirmando}>
                Cancelar
              </button>
              <button
                type="button"
                className="mit-btn mit-btn--solid"
                onClick={onConfirm}
                disabled={confirmando || !productos.length}
                style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              >
                <FontAwesomeIcon icon={faCheckCircle} />
                {confirmando ? "Cargando..." : "Confirmar y cargar"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <MiniCreateModal
        open={miniCategoriaOpen}
        title="Nueva categoría"
        value={miniCategoriaNombre}
        loading={guardandoMiniCategoria}
        onChange={setMiniCategoriaNombre}
        onCancel={() => { setMiniCategoriaOpen(false); setMiniCategoriaNombre(""); setMiniCategoriaFila(null); }}
        onSave={guardarCategoria}
      />
      <MiniCreateModal
        open={miniTipoOpen}
        title="Nuevo tipo de precio"
        value={miniTipoNombre}
        loading={guardandoMiniTipo}
        onChange={setMiniTipoNombre}
        onCancel={() => { setMiniTipoOpen(false); setMiniTipoNombre(""); setMiniTipoFila(null); }}
        onSave={guardarTipo}
      />
    </>,
    document.body
  );
}

export default function ModalCargaMasiva({
  open,
  onClose,
  onGuardado,
  onToast,
  onImportado,
  categorias: categoriasProp,
  loadingCategorias: loadingCategoriasProp,
}) {
  const closeBtnRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputMasivoRef = useRef(null);

  const [tab, setTab] = useState("individual");
  const [dark, setDark] = useState(isTemaOscuro);
  const [toast, setToast] = useState({ open: false, tipo: "error", mensaje: "" });

  const [categoriasLocal, setCategoriasLocal] = useState(categoriasProp || []);

  const { lists, loadingLists, ensureListsLoaded, refreshLists, setLists } = useListas();

  const tiposPrecio = useMemo(
    () => (Array.isArray(lists?.stock_tipos_precio) ? lists.stock_tipos_precio : []),
    [lists]
  );

  const loadingTiposPrecio = loadingLists && tiposPrecio.length === 0;
  const loadingCategorias = loadingCategoriasProp || false;

  const [individualLoading, setIndividualLoading] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [clasificando, setClasificando] = useState(false);
  const [confirmandoDetectados, setConfirmandoDetectados] = useState(false);

  const isLoading = individualLoading || subiendo || clasificando || confirmandoDetectados;
  const esModoDemo = isBaltoDemoMode();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMime, setPreviewMime] = useState("");
  const [previewFileName, setPreviewFileName] = useState("");
  const [previewTitle, setPreviewTitle] = useState("Archivo");

  const [archivo, setArchivo] = useState(null);
  const [resultado, setResultado] = useState(null);

  const [modalConfirmOpen, setModalConfirmOpen] = useState(false);
  const [productosDetectados, setProductosDetectados] = useState([]);
  const [erroresDetectados, setErroresDetectados] = useState({});
  const [textoDetectadoOriginal, setTextoDetectadoOriginal] = useState("");

  const mostrarToast = (mensaje, tipo = "error") => {
    setToast({ open: true, tipo, mensaje: errorToText(mensaje) });
  };

  useEffect(() => { setCategoriasLocal(categoriasProp || []); }, [categoriasProp]);

  const nombreArchivo = useMemo(() => archivo?.name || "", [archivo]);
  const tipoArchivo = useMemo(() => getTipoArchivo(archivo?.name), [archivo]);

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());
    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const o2 = new MutationObserver(update);
    if (document.body) o2.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => { o1.disconnect(); o2.disconnect(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;
      if (!isLoading && !previewOpen && !modalConfirmOpen) {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [open, onClose, isLoading, previewOpen, modalConfirmOpen]);

  useEffect(() => {
    if (open) setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      resetMasivo();
      cerrarPreview();
      cerrarModalConfirmacion();
      setTab("individual");
      setIndividualLoading(false);
      setToast({ open: false, tipo: "error", mensaje: "" });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    ensureListsLoaded?.({ force: false, background: true });
  }, [open, ensureListsLoaded]);

  useEffect(() => {
    if (!open || !esModoDemo) return;
    if (tab !== "individual") {
      setTab("individual");
      resetMasivo();
      cerrarModalConfirmacion();
    }
  }, [open, esModoDemo, tab]);

  function resetMasivo() {
    setArchivo(null);
    setSubiendo(false);
    setClasificando(false);
    setConfirmandoDetectados(false);
    setResultado(null);
    setTextoDetectadoOriginal("");
    if (fileInputMasivoRef.current) fileInputMasivoRef.current.value = "";
  }

  function cerrarModalConfirmacion() {
    setModalConfirmOpen(false);
    setProductosDetectados([]);
    setErroresDetectados({});
  }

  const cerrarPreview = () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewOpen(false);
    setPreviewUrl("");
    setPreviewMime("");
    setPreviewFileName("");
    setPreviewTitle("Archivo");
  };

  const abrirPreviewLocal = ({ file, title }) => {
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setPreviewUrl(blobUrl);
    setPreviewMime(file.type || "");
    setPreviewFileName(file.name || "archivo");
    setPreviewTitle(title || "Archivo");
    setPreviewOpen(true);
  };

  const handleArchivoChange = (file) => {
    if (!file) return;
    setArchivo(file);
    setResultado(null);
    setTextoDetectadoOriginal("");
    cerrarModalConfirmacion();
  };

  const descargarPlantilla = () => {
    const blob = new Blob([plantillaCsvMasivo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_productos.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  async function clasificarTextoDetectado(textoDetectado) {
    return clasificarTextoStock(textoDetectado);
  }

  const registrarCategoriaCreadaLocal = async (nueva) => {
    if (!nueva) return null;
    setCategoriasLocal((prev) => {
      const idNuevo = String(nueva.id ?? nueva.id_stock_categoria ?? "");
      const existe = prev.some((x) => String(x.id ?? x.id_stock_categoria) === idNuevo);
      if (existe) return prev;
      return [...prev, nueva].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    });
    try { window.dispatchEvent(new Event("balto:listas-updated")); } catch {}
    return nueva;
  };

  const registrarTipoPrecioCreadoLocal = async (nuevo) => {
    if (!nuevo) return null;
    setLists((prev) => {
      const actuales = Array.isArray(prev?.stock_tipos_precio) ? prev.stock_tipos_precio : [];
      const idNuevo = String(nuevo.id ?? nuevo.id_tipo_precio_stock ?? "");
      const existe = actuales.some((x) => String(x.id ?? x.id_tipo_precio_stock) === idNuevo);
      const next = existe
        ? actuales
        : [...actuales, nuevo].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
      return { ...(prev || {}), stock_tipos_precio: next };
    });
    try {
      if (typeof refreshLists === "function") refreshLists().catch(() => {});
      else window.dispatchEvent(new Event("balto:listas-updated"));
    } catch {}
    return nuevo;
  };

  const crearCategoriaRapida = async (nombre) => {
    const data = await crearCategoriaStock({ nombre });
    const nueva = data.categoria || { id: data.id_stock_categoria, id_stock_categoria: data.id_stock_categoria, nombre };
    setCategoriasLocal((prev) => {
      const existe = prev.some((x) => String(x.id ?? x.id_stock_categoria) === String(nueva.id ?? nueva.id_stock_categoria));
      if (existe) return prev;
      return [...prev, nueva].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
    });
    try { window.dispatchEvent(new Event("balto:listas-updated")); } catch {}
    return nueva;
  };

  const crearTipoPrecioRapido = async (nombre) => {
    const nombreLimpio = String(nombre ?? "").trim().toUpperCase();
    if (!nombreLimpio) throw new Error("El nombre del tipo de precio es obligatorio.");
    const data = await crearTipoPrecioStock({ nombre: nombreLimpio });
    const nuevo = data.tipo_precio || { id: data.id_tipo_precio_stock, id_tipo_precio_stock: data.id_tipo_precio_stock, nombre: nombreLimpio };
    setLists((prev) => {
      const actuales = Array.isArray(prev?.stock_tipos_precio) ? prev.stock_tipos_precio : [];
      const idNuevo = String(nuevo.id ?? nuevo.id_tipo_precio_stock ?? "");
      const existe = actuales.some((x) => String(x.id ?? x.id_tipo_precio_stock) === idNuevo);
      if (existe) return prev;
      const next = [...actuales, nuevo].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));
      return { ...(prev || {}), stock_tipos_precio: next };
    });
    try {
      if (typeof refreshLists === "function") refreshLists().catch(() => {});
      else window.dispatchEvent(new Event("balto:listas-updated"));
    } catch {}
    return nuevo;
  };

  const handleImportar = async () => {
    if (!archivo) { mostrarToast("Seleccioná un archivo CSV, PDF o imagen.", "error"); return; }
    if (!tipoArchivo) { mostrarToast("Formato no válido. Admitido: CSV, PDF, JPG, PNG y otros formatos de imagen.", "error"); return; }

    try {
      setSubiendo(true);
      setResultado(null);
      cerrarModalConfirmacion();

      const formData = new FormData();
      let action = "";
      if (tipoArchivo === "csv") { action = "stock_productos_importar_csv"; formData.append("archivo_csv", archivo); }
      if (tipoArchivo === "pdf") { action = "stock_productos_importar_pdf"; formData.append("archivo_pdf", archivo); }
      if (tipoArchivo === "imagen") { action = "stock_productos_ocr_imagen"; formData.append("archivo_imagen", archivo); }

      const data = await importarArchivoStock(action, formData);
      setResultado(data);

      if (tipoArchivo === "csv") {
        onImportado?.(`Importación finalizada. Creados: ${data.creados || 0}. Actualizados: ${data.actualizados || 0}.`);
        return;
      }

      const textoDetectado = String(data.texto_detectado || "").trim();
      setTextoDetectadoOriginal(textoDetectado);
      mostrarToast(`Texto extraído con ${getMetodoLabel(data.metodo)}: ${data.total_caracteres ?? 0} caracteres.`, "success");

      if (!textoDetectado) { mostrarToast("No se detectó texto para clasificar productos.", "error"); return; }

      setClasificando(true);
      const clasificado = await clasificarTextoDetectado(textoDetectado);
      const productos = Array.isArray(clasificado.productos)
        ? clasificado.productos.map((item) =>
            recalcularProductoDetectadoInicial(normalizarProductoDetectado(item, tiposPrecio))
          )
        : [];

      if (!productos.length) { mostrarToast("No se pudieron detectar productos confiables desde el texto.", "error"); return; }

      setProductosDetectados(productos);
      setErroresDetectados({});
      setModalConfirmOpen(true);
      mostrarToast(`Se detectaron ${productos.length} producto${productos.length !== 1 ? "s" : ""}. Revisalos y confirmá.`, "success");
    } catch (err) {
      mostrarToast(err.message || "Error al procesar el archivo.", "error");
    } finally {
      setSubiendo(false);
      setClasificando(false);
    }
  };

  const handleProductoDetectadoChange = (idx, field, value) => {
    setProductosDetectados((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
    setErroresDetectados((prev) => {
      const next = { ...prev };
      if (next[`fila_${idx}`]?.[field]) next[`fila_${idx}`] = { ...next[`fila_${idx}`], [field]: "" };
      return next;
    });
  };

  const handlePricingBlurDetectado = (idx, source, groupName) => {
    setProductosDetectados((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const result = recalculatePricingGroup({
          cost: item.precio_costo,
          price: groupName === "venta" ? item.precio : item.precio_promo,
          marginPct: groupName === "venta" ? item.margen_venta_porcentaje : item.margen_promo_porcentaje,
          marginValue: groupName === "venta" ? item.margen_venta_valor : item.margen_promo_valor,
          source,
        });
        return groupName === "venta"
          ? { ...item, precio: result.price, margen_venta_porcentaje: result.marginPct, margen_venta_valor: result.marginValue }
          : { ...item, precio_promo: result.price, margen_promo_porcentaje: result.marginPct, margen_promo_valor: result.marginValue };
      })
    );
  };

  const handlePricingChangeDetectado = (idx, rawValue, source, groupName) => {
    const value = normalizeMoneyInput(rawValue);
    setProductosDetectados((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const result = recalculatePricingGroup({
          cost: item.precio_costo,
          price: source === "price" ? value : groupName === "venta" ? item.precio : item.precio_promo,
          marginPct: source === "marginPct" ? value : groupName === "venta" ? item.margen_venta_porcentaje : item.margen_promo_porcentaje,
          marginValue: source === "marginValue" ? value : groupName === "venta" ? item.margen_venta_valor : item.margen_promo_valor,
          source,
        });
        return groupName === "venta"
          ? { ...item, precio: result.price, margen_venta_porcentaje: result.marginPct, margen_venta_valor: result.marginValue }
          : { ...item, precio_promo: result.price, margen_promo_porcentaje: result.marginPct, margen_promo_valor: result.marginValue };
      })
    );
  };

  const handleExtraPricingChangeDetectado = (idx, tIdx, rawValue, source) => {
    const value = normalizeMoneyInput(rawValue);
    setProductosDetectados((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = [...(item.tipos_precio_extra || [])];
        const actual = next[tIdx] || {};
        const result = recalculatePricingGroup({
          cost: item.precio_costo,
          price: source === "price" ? value : actual.precio,
          marginPct: source === "marginPct" ? value : actual.margen_porcentaje,
          marginValue: source === "marginValue" ? value : actual.margen_valor,
          source,
        });
        next[tIdx] = { ...actual, precio: result.price, margen_porcentaje: result.marginPct, margen_valor: result.marginValue };
        return { ...item, tipos_precio_extra: next };
      })
    );
  };

  const handleRecalcByCostDetectado = (idx, value) => {
    setProductosDetectados((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const venta = recalculatePricingGroup({ cost: value, price: item.precio, marginPct: item.margen_venta_porcentaje, marginValue: item.margen_venta_valor, source: item.precio ? "price" : item.margen_venta_porcentaje ? "marginPct" : item.margen_venta_valor ? "marginValue" : null });
        const promo = recalculatePricingGroup({ cost: value, price: item.precio_promo, marginPct: item.margen_promo_porcentaje, marginValue: item.margen_promo_valor, source: item.precio_promo ? "price" : item.margen_promo_porcentaje ? "marginPct" : item.margen_promo_valor ? "marginValue" : null });
        const extras = (item.tipos_precio_extra || []).map((row) => {
          const r = recalculatePricingGroup({ cost: value, price: row.precio, marginPct: row.margen_porcentaje, marginValue: row.margen_valor, source: row.precio ? "price" : row.margen_porcentaje ? "marginPct" : row.margen_valor ? "marginValue" : null });
          return { ...row, precio: r.price, margen_porcentaje: r.marginPct, margen_valor: r.marginValue };
        });
        return { ...item, precio_costo: normalizeMoneyInput(value), precio: venta.price, margen_venta_porcentaje: venta.marginPct, margen_venta_valor: venta.marginValue, precio_promo: promo.price, margen_promo_porcentaje: promo.marginPct, margen_promo_valor: promo.marginValue, tipos_precio_extra: extras };
      })
    );
  };

  const handleAddFilaDetectada = () => {
    setProductosDetectados((prev) => [...prev, recalcularProductoDetectadoInicial(normalizarProductoDetectado({}, tiposPrecio))]);
  };

  const handleRemoveFilaDetectada = (idx) => {
    setProductosDetectados((prev) => prev.filter((_, i) => i !== idx));
    setErroresDetectados({});
  };

  const handleImagenProductoDetectado = (idx, file) => {
    if (!file) return;
    const tipos = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (!tipos.includes(file.type)) {
      setErroresDetectados((prev) => ({ ...prev, [`fila_${idx}`]: { ...(prev[`fila_${idx}`] || {}), imagen: "La imagen debe ser JPG, PNG, WEBP o GIF" } }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErroresDetectados((prev) => ({ ...prev, [`fila_${idx}`]: { ...(prev[`fila_${idx}`] || {}), imagen: "La imagen no puede superar los 5 MB" } }));
      return;
    }
    setProductosDetectados((prev) => prev.map((item, i) => (i === idx ? { ...item, imagen: file } : item)));
  };

  const handleQuitarImagenProductoDetectado = (idx) => {
    setProductosDetectados((prev) => prev.map((item, i) => (i === idx ? { ...item, imagen: null } : item)));
  };

  function validarProductosDetectados() {
    const errs = {};
    let hayError = false;
    productosDetectados.forEach((item, idx) => {
      const fila = {};
      const variantes = Array.isArray(item.variantes) ? item.variantes : [];
      const tieneVariantes = variantes.length > 0 || Boolean(item.tiene_variantes);
      const venta = Number(String(item.precio || "").replace(",", "."));
      const costo = item.precio_costo !== "" ? Number(String(item.precio_costo).replace(",", ".")) : null;
      const promo = item.precio_promo !== "" ? Number(String(item.precio_promo).replace(",", ".")) : null;
      if (!String(item.nombre || "").trim()) fila.nombre = "El nombre es obligatorio";
      if (costo !== null && (Number.isNaN(costo) || costo < 0)) fila.precio_costo = "Costo inválido";
      if (!tieneVariantes && (!item.precio || Number.isNaN(venta) || venta < 0)) fila.precio = "Ingresá un precio válido";
      if (item.precio_promo && (Number.isNaN(promo) || promo < 0)) fila.precio_promo = "Precio promo inválido";
      if (item.stock !== "" && (Number.isNaN(Number(item.stock)) || Number(item.stock) < 0)) fila.stock = "Stock inválido";
      if (tieneVariantes) {
        const varianteInvalida = variantes.find((variante) => {
          const nombre = String(variante?.nombre_variante || "").trim();
          const stock = Number(variante?.stock ?? 0);
          const precio = Number(String(variante?.precio || "").replace(",", "."));
          const costoRaw = String(variante?.precio_costo || "").trim();
          const costoVariante = costoRaw === "" ? 0 : Number(costoRaw.replace(",", "."));
          const promoRaw = String(variante?.precio_promo || "").trim();
          const promoVariante = promoRaw === "" ? 0 : Number(promoRaw.replace(",", "."));
          return !nombre || Number.isNaN(stock) || stock < 0 || !variante?.precio || Number.isNaN(precio) || precio < 0
            || Number.isNaN(costoVariante) || costoVariante < 0 || Number.isNaN(promoVariante) || promoVariante < 0;
        });
        if (!variantes.length || varianteInvalida) {
          fila.variantes = "Revisá nombre, stock y precio de venta de todas las variantes.";
        }
      }
      const extrasInvalidos = (item.tipos_precio_extra || []).some((x) => {
        const nombreTipo = String(x.tipo_nombre || "").trim();
        const precioTipo = String(x.precio || "").trim();
        if (!nombreTipo || !precioTipo) return true;
        const precioNumero = Number(precioTipo.replace(",", "."));
        return Number.isNaN(precioNumero) || precioNumero < 0;
      });
      if (extrasInvalidos) fila.tipos = "Revisá los tipos de precio adicionales detectados";
      if (item.imagen) {
        const tipos = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
        if (!tipos.includes(item.imagen.type)) fila.imagen = "La imagen debe ser JPG, PNG, WEBP o GIF";
        if (item.imagen.size > 5 * 1024 * 1024) fila.imagen = "La imagen no puede superar los 5 MB";
      }
      if (Object.keys(fila).length > 0) { errs[`fila_${idx}`] = fila; hayError = true; }
    });
    if (hayError) errs.global = "Revisá los productos marcados antes de confirmar.";
    return errs;
  }

  const resolverTiposPrecioExtrasPendientes = async (productosBase) => {
    const cache = new Map();
    const normalizados = (Array.isArray(productosBase) ? productosBase : []).map((item) => ({
      ...item,
      tipos_precio_extra: (item.tipos_precio_extra || []).map((row) => ({ ...row })),
    }));
    for (const item of normalizados) {
      for (const row of item.tipos_precio_extra || []) {
        if (Number(row.id_tipo_precio_stock) > 0) continue;
        const nombreOriginal = toUpperCaseValue(String(row.tipo_nombre || row.nombre || "").trim());
        const nombreNormalizado = normalizarNombreTipoPrecio(nombreOriginal);
        if (!nombreNormalizado) continue;
        const existente = buscarTipoPrecioExistentePorNombre(tiposPrecio, nombreOriginal);
        if (existente) {
          row.id_tipo_precio_stock = String(existente.id ?? existente.id_tipo_precio_stock ?? "");
          row.tipo_nombre = toUpperCaseValue(String(existente.nombre || nombreOriginal).trim());
          continue;
        }
        if (!cache.has(nombreNormalizado)) cache.set(nombreNormalizado, crearTipoPrecioRapido(nombreOriginal));
        const nuevo = await cache.get(nombreNormalizado);
        row.id_tipo_precio_stock = String(nuevo?.id ?? nuevo?.id_tipo_precio_stock ?? "");
        row.tipo_nombre = toUpperCaseValue(String(nuevo?.nombre || nombreOriginal).trim());
      }
    }
    return { productos: normalizados, cantidadNuevosTipos: cache.size };
  };

  const handleConfirmarDetectados = async () => {
    const errs = validarProductosDetectados();
    if (Object.keys(errs).length > 0) { setErroresDetectados(errs); return; }

    setConfirmandoDetectados(true);
    setErroresDetectados({});
    let creados = 0;
    const erroresCarga = [];
    let sincronizacionesEncoladas = 0;

    try {
      const { productos: productosPreparados, cantidadNuevosTipos } = await resolverTiposPrecioExtrasPendientes(productosDetectados);
      setProductosDetectados(productosPreparados);
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
      const batchSize = 3;
      const batches = [];
      for (let i = 0; i < productosPreparados.length; i += batchSize) batches.push(productosPreparados.slice(i, i + batchSize));

      for (const batch of batches) {
        const batchPromises = batch.map(async (item) => {
          const globalIdx = productosPreparados.indexOf(item);
          try {
            const fd = new FormData();
            fd.append("nombre", toUpperCaseValue(String(item.nombre || "").trim()));
            fd.append("sku", toUpperCaseValue(String(item.sku || "").trim()));
            fd.append("precio_costo", moneyToApi(item.precio_costo));
            fd.append("precio", moneyToApi(item.precio));
            fd.append("margen_venta_porcentaje", moneyToApi(item.margen_venta_porcentaje));
            fd.append("margen_venta_valor", moneyToApi(item.margen_venta_valor));
            fd.append("precio_promo", moneyToApi(item.precio_promo));
            fd.append("margen_promo_porcentaje", moneyToApi(item.margen_promo_porcentaje));
            fd.append("margen_promo_valor", moneyToApi(item.margen_promo_valor));
            fd.append("stock", item.stock !== "" ? String(item.stock) : "");
            fd.append("descripcion", toUpperCaseValue(String(item.descripcion || "").trim()));
            const variantesPayload = Array.isArray(item.variantes)
              ? item.variantes.map(prepararVarianteDetectadaParaApi)
              : [];
            if (variantesPayload.length > 0 || item.tiene_variantes) {
              fd.append("tiene_variantes", "1");
              fd.append("variantes", JSON.stringify(variantesPayload));
            }
            if (item.id_categoria_stock !== "") fd.append("id_categoria_stock", String(item.id_categoria_stock));
            if (idUsuarioMaster > 0) fd.append("idUsuarioMaster", String(idUsuarioMaster));
            if (idTenant) fd.append("tenant_id", String(idTenant));
            fd.append("diferir_sync", "1");
            const tiposPrecioPayload = (item.tipos_precio_extra || []).map((row) => ({
              id_tipo_precio_stock: Number(row.id_tipo_precio_stock) || 0,
              tipo_nombre: String(row.tipo_nombre || "").trim(),
              nombre: String(row.tipo_nombre || "").trim(),
              precio: moneyToApi(row.precio),
              margen_porcentaje: moneyToApi(row.margen_porcentaje),
              margen_valor: moneyToApi(row.margen_valor),
            }));
            fd.append("tipos_precio", JSON.stringify(tiposPrecioPayload));
            if (item.imagen) fd.append("imagen", item.imagen);
            const data = await crearProductoStock(fd);
            return { success: true, idx: globalIdx, sync: data?.tiendanube_sync ?? data?.data?.tiendanube_sync ?? null };
          } catch (err) {
            return { success: false, idx: globalIdx, error: `Producto ${globalIdx + 1} (${item.nombre || "sin nombre"}): ${err.message || "Error al guardar"}` };
          }
        });
        const results = await Promise.all(batchPromises);
        for (const result of results) {
          if (result.success) {
            creados++;
            sincronizacionesEncoladas += Number(result?.sync?.encolados || result?.sync?.pendientes || (result?.sync?.job_reintento?.encolado ? 1 : 0) || 0);
          } else erroresCarga.push(result.error);
        }
      }

      setResultado((prev) => ({
        ...(prev || {}),
        confirmacion_ia: { creados, errores: erroresCarga, productos_confirmados: productosPreparados.length },
        texto_detectado: textoDetectadoOriginal,
      }));

      cerrarModalConfirmacion();
      if (creados > 0) onGuardado?.();
      if (erroresCarga.length > 0) {
        mostrarToast(`Se cargaron ${creados} producto(s), pero hubo ${erroresCarga.length} error(es).`, "error");
      } else {
        const msgTipos = cantidadNuevosTipos > 0 ? ` y se crearon ${cantidadNuevosTipos} tipo(s) de precio nuevo(s)` : "";
        const msgSync = sincronizacionesEncoladas > 0 ? ` La sincronización con Tienda Nube quedó encolada para ${sincronizacionesEncoladas} producto(s).` : "";
        onImportado?.(`Se cargaron correctamente ${creados} producto(s)${msgTipos}.${msgSync}`);
        mostrarToast(`Se cargaron correctamente ${creados} producto(s)${msgTipos}.${msgSync}`, sincronizacionesEncoladas > 0 ? "advertencia" : "success");
      }
    } catch (err) {
      mostrarToast(errorToText(err, "Error inesperado al confirmar los productos"), "error");
    } finally {
      setConfirmandoDetectados(false);
    }
  };

  const btnMasivoLabel = subiendo
    ? tipoArchivo === "csv" ? "Importando..." : tipoArchivo === "pdf" ? "Extrayendo..." : "Procesando..."
    : clasificando ? "Clasificando..."
    : tipoArchivo === "csv" ? "Importar productos"
    : tipoArchivo === "pdf" ? "Extraer y clasificar PDF"
    : tipoArchivo === "imagen" ? "Reconocer y clasificar"
    : "Seleccioná un archivo";

  if (!open) return null;

  return createPortal(
    <>
      <div ref={overlayRef} data-stock-modal-overlay="true" className={["mi-modal__overlay", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}>
        <div
          className={["mi-modal__container", "cmi-container", dark ? "mi-modal--dark" : ""].join(" ").trim()}
          role="dialog"
          aria-modal="true"
          style={{ minHeight: "auto", maxHeight: "92vh" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mi-modal__header">
            <div className="mi-modal__head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faBoxesStacked} />
            </div>
            <div className="mi-modal__head-left">
              <h2 className="mi-modal__title">Productos</h2>
              <p className="mi-modal__subtitle">Agregá uno por uno o importá de forma masiva</p>
            </div>
            <button
              ref={closeBtnRef}
              className="mi-modal__close"
              onClick={() => !isLoading && onClose?.()}
              aria-label="Cerrar"
              disabled={isLoading}
              type="button"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          {/* ── TABS ── */}
          <div style={{ display: "flex", gap: 4, padding: "0 20px", borderBottom: "1px solid var(--nv-border-md)", background: "var(--nv-bg)", flexShrink: 0 }}>
            {[
              { key: "individual", icon: faBoxOpen, label: "Individual" },
              { key: "masivo", icon: faCloudArrowUp, label: "Carga masiva" },
            ].map(({ key, icon, label }) => {
              const bloqueadoDemo = esModoDemo && key === "masivo";

              return (
                <button
                  key={key}
                  onClick={() => {
                    if (bloqueadoDemo) {
                      mostrarToast(DEMO_CARGA_MASIVA_MESSAGE, "advertencia");
                      return;
                    }
                    setTab(key);
                    cerrarModalConfirmacion();
                  }}
                  type="button"
                  aria-disabled={bloqueadoDemo ? "true" : undefined}
                  title={bloqueadoDemo ? "Bloqueado en modo demo" : undefined}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "11px 16px", border: "none",
                    borderBottom: tab === key ? "2px solid var(--nv-action)" : "2px solid transparent",
                    background: "none", cursor: bloqueadoDemo ? "not-allowed" : "pointer",
                    fontWeight: tab === key ? 700 : 400,
                    color: tab === key ? "var(--nv-action)" : "var(--nv-muted)",
                    opacity: bloqueadoDemo ? 0.55 : 1,
                    fontSize: "0.88rem", transition: "all .15s", fontFamily: "inherit",
                  }}
                >
                  <FontAwesomeIcon icon={icon} style={{ fontSize: 13 }} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── TAB INDIVIDUAL ── */}
          <ModalCargaIndividualProducto
            open={open}
            visible={tab === "individual"}
            categorias={categoriasLocal}
            loadingCategorias={loadingCategorias}
            tiposPrecio={tiposPrecio}
            loadingTiposPrecio={loadingTiposPrecio}
            onGuardado={onGuardado}
            onRequestClose={() => !isLoading && onClose?.()}
            onLoadingChange={setIndividualLoading}
            onCategoriaCreada={registrarCategoriaCreadaLocal}
            onTipoPrecioCreado={registrarTipoPrecioCreadoLocal}
            onToast={mostrarToast}
          />

          {/* ── TAB MASIVO ── */}
          <div style={{ display: tab === "masivo" ? "contents" : "none" }}>
            <div className="mi-modal__content" style={{ overflowY: "auto", padding: 20 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="cmi-uploadBox">
                  <div className="cmi-uploadBox__title">
                    <FontAwesomeIcon icon={faCloudArrowUp} /> Archivo masivo
                  </div>

                  <input
                    ref={fileInputMasivoRef}
                    type="file"
                    hidden
                    accept=".csv,.pdf,.jpg,.jpeg,.png,.gif,.bmp,.webp,.tiff,.tif"
                    onChange={(e) => handleArchivoChange(e.target.files?.[0])}
                  />

                  <div className="cmi-uploadActions">
                    <button type="button" className="mit-btn mit-btn--ghost" onClick={() => fileInputMasivoRef.current?.click()}>
                      <FontAwesomeIcon icon={faArrowUpFromBracket} /> Seleccionar archivo
                    </button>
                    <button type="button" className="mit-btn mit-btn--ghost" onClick={descargarPlantilla}>
                      <FontAwesomeIcon icon={faDownload} /> Descargar plantilla CSV
                    </button>
                  </div>

                  {nombreArchivo && (
                    <div className="cmi-fileResume">
                      <div className="cmi-fileResume__left">
                        <span className="cmi-fileResume__icon">
                          <IconoArchivo tipo={tipoArchivo} />
                        </span>
                        <div className="cmi-fileResume__meta">
                          <div className="cmi-fileResume__name">{nombreArchivo}</div>
                          <TipoBadge tipo={tipoArchivo} />
                        </div>
                      </div>
                      <div className="cmi-fileActions">
                        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => abrirPreviewLocal({ file: archivo, title: "Archivo masivo" })}>
                          <FontAwesomeIcon icon={faEye} />
                        </button>
                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() => {
                            setArchivo(null); setResultado(null); setTextoDetectadoOriginal("");
                            cerrarModalConfirmacion();
                            if (fileInputMasivoRef.current) fileInputMasivoRef.current.value = "";
                          }}
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {resultado && tipoArchivo === "csv" && (
                  <div className="cmi-okBox">
                    <div className="cmi-okBox__title">
                      <FontAwesomeIcon icon={faCheckCircle} style={{ marginRight: 8 }} /> Resultado de importación
                    </div>
                    <div className="cmi-resultGrid">
                      <div className="cmi-resultItem"><span className="cmi-resultItem__label">Creados</span><b className="cmi-resultItem__val cmi-resultItem__val--ok">{resultado.creados ?? 0}</b></div>
                      <div className="cmi-resultItem"><span className="cmi-resultItem__label">Actualizados</span><b className="cmi-resultItem__val">{resultado.actualizados ?? 0}</b></div>
                    </div>
                  </div>
                )}

                {resultado && tipoArchivo !== "csv" && (
                  <div className="cmi-okBox">
                    <div className="cmi-okBox__title">
                      <FontAwesomeIcon icon={faCheckCircle} style={{ marginRight: 8 }} /> Resultado del procesamiento
                    </div>
                    <div className="cmi-resultGrid">
                      <div className="cmi-resultItem"><span className="cmi-resultItem__label">Método</span><b className="cmi-resultItem__val">{getMetodoLabel(resultado.metodo)}</b></div>
                      <div className="cmi-resultItem"><span className="cmi-resultItem__label">Páginas</span><b className="cmi-resultItem__val">{resultado.total_paginas ?? 1}</b></div>
                      <div className="cmi-resultItem"><span className="cmi-resultItem__label">Caracteres</span><b className="cmi-resultItem__val cmi-resultItem__val--ok">{resultado.total_caracteres ?? 0}</b></div>
                    </div>
                    {resultado?.confirmacion_ia && (
                      <div className="cmi-resultGrid" style={{ marginTop: 12 }}>
                        <div className="cmi-resultItem"><span className="cmi-resultItem__label">Confirmados</span><b className="cmi-resultItem__val">{resultado.confirmacion_ia.productos_confirmados ?? 0}</b></div>
                        <div className="cmi-resultItem"><span className="cmi-resultItem__label">Cargados</span><b className="cmi-resultItem__val cmi-resultItem__val--ok">{resultado.confirmacion_ia.creados ?? 0}</b></div>
                        <div className="cmi-resultItem"><span className="cmi-resultItem__label">Errores</span><b className="cmi-resultItem__val">{resultado.confirmacion_ia.errores?.length ?? 0}</b></div>
                      </div>
                    )}
                    {productosDetectados.length > 0 && (
                      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => setModalConfirmOpen(true)}>
                          <FontAwesomeIcon icon={faImage} /> Cargar imágenes / revisar productos detectados
                        </button>
                      </div>
                    )}
                    {resultado.texto_detectado && (
                      <div className="fl-field" style={{ marginTop: 12 }}>
                        <textarea readOnly value={resultado.texto_detectado} className="fl-input cmi-textarea" placeholder=" " />
                        <label className="fl-label">Texto extraído</label>
                      </div>
                    )}
                  </div>
                )}

                {resultado && Array.isArray(resultado.errores) && resultado.errores.length > 0 && (
                  <div className="cmi-warnBox">
                    <div className="cmi-warnBox__title"><FontAwesomeIcon icon={faCircleExclamation} style={{ marginRight: 8 }} /> Observaciones</div>
                    <ul className="cmi-warnBox__list">{resultado.errores.map((err, i) => <li key={i}>{err}</li>)}</ul>
                  </div>
                )}

                {resultado?.confirmacion_ia?.errores?.length > 0 && (
                  <div className="cmi-warnBox">
                    <div className="cmi-warnBox__title"><FontAwesomeIcon icon={faCircleExclamation} style={{ marginRight: 8 }} /> Errores al cargar productos</div>
                    <ul className="cmi-warnBox__list">{resultado.confirmacion_ia.errores.map((err, i) => <li key={i}>{err}</li>)}</ul>
                  </div>
                )}
              </div>
            </div>

            <div className="cmi-footer">
              <div className="mi-card__hint cmi-footer__hint">
                {tipoArchivo === "csv" && "El CSV se procesará fila a fila creando productos y variantes detectadas."}
                {tipoArchivo === "pdf" && "Se extraerá el texto, se clasificarán los productos y luego vas a poder confirmarlos."}
                {tipoArchivo === "imagen" && "Se aplicará OCR, se clasificarán los productos y luego vas a poder confirmarlos."}
                {tipoArchivo === "" && !nombreArchivo && "Seleccioná un archivo para continuar."}
                {tipoArchivo === "" && nombreArchivo && "El formato no es válido."}
              </div>
              <div className="cmi-footer__btns">
                <button type="button" className="mit-btn mit-btn--ghost" onClick={() => !isLoading && onClose?.()} disabled={isLoading}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="mit-btn mit-btn--solid"
                  onClick={handleImportar}
                  disabled={subiendo || clasificando || !tipoArchivo}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                  <FontAwesomeIcon icon={faCloudArrowUp} /> {btnMasivoLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ModalVerComprobante open={previewOpen} url={previewUrl} mime={previewMime} fileName={previewFileName} title={previewTitle} onClose={cerrarPreview} />

      <ModalConfirmarProductosIA
        open={modalConfirmOpen}
        dark={dark}
        productos={productosDetectados}
        categorias={categoriasLocal}
        tiposPrecio={tiposPrecio}
        loadingCategorias={loadingCategorias}
        loadingTiposPrecio={loadingTiposPrecio}
        onClose={() => !confirmandoDetectados && cerrarModalConfirmacion()}
        onChangeProducto={handleProductoDetectadoChange}
        onPricingBlur={handlePricingBlurDetectado}
        onRecalcByCost={handleRecalcByCostDetectado}
        onAddFila={handleAddFilaDetectada}
        onRemoveFila={handleRemoveFilaDetectada}
        onTakeImage={handleImagenProductoDetectado}
        onRemoveImage={handleQuitarImagenProductoDetectado}
        onPreviewImage={(file) => abrirPreviewLocal({ file, title: "Imagen del producto detectado" })}
        onConfirm={handleConfirmarDetectados}
        confirmando={confirmandoDetectados}
        errores={erroresDetectados}
        onCategoriaCreate={crearCategoriaRapida}
        onTipoCreate={crearTipoPrecioRapido}
        mostrarToast={mostrarToast}
        onPricingChange={handlePricingChangeDetectado}
        onExtraPricingChange={handleExtraPricingChangeDetectado}
      />

      {toast.open && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        />
      )}
    </>,
    document.body
  );
}
