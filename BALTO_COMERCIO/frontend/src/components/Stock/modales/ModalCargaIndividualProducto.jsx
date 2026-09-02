import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante";
import StockBarcodePanel from "./StockBarcodePanel";
import "./ModalCargaIndividualProducto.css";
import { isTopStockModal } from "./modalStackUtils";
import {
  crearCategoriaStock,
  crearProductoStock,
  crearTipoPrecioStock,
} from "../api/stockApi";

import {
  faBarcode,
  faBoxOpen,
  faCubesStacked,
  faTag,
  faAlignLeft,
  faPaperclip,
  faArrowUpFromBracket,
  faImage,
  faEye,
  faTrashCan,
  faFloppyDisk,
  faMoneyBillTrendUp,
  faLayerGroup,
  faCheck,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";

import {
  emptyExtraPriceRow,
  formatMoneyBlur,
  formatMoneyFocus,
  getUsuarioAuditData,
  moneyToApi,
  normalizeMoneyInput,
  onlyNumbers,
  recalculatePricingGroup,
  toUpperCaseValue,
} from "../utils/stockFormUtils";

/* ── Utilidades ── */
function normalizeIdValue(value) {
  if (value && typeof value === "object") {
    return String(value.id ?? value.id_stock_categoria ?? value.value ?? "");
  }

  return String(value ?? "");
}

function toCapitalizedText(value) {
  return String(value ?? "")
    .trimStart()
    .normalize("NFC")
    .toUpperCase();
}

function normalizeOptionLabel(value, fallback = "") {
  let result = fallback;

  if (value == null) {
    result = fallback;
  } else if (typeof value === "string" || typeof value === "number") {
    result = String(value);
  } else if (typeof value === "object") {
    result = String(value.nombre ?? value.label ?? value.descripcion ?? fallback);
  }

  return toCapitalizedText(result);
}

function errorToText(err, fallback = "Ocurrió un error inesperado") {
  const value = err?.message ?? err?.mensaje ?? err;

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  if (value && typeof value === "object") {
    if (typeof value.nombre === "string" && value.nombre.trim()) return value.nombre;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
    if (typeof value.mensaje === "string" && value.mensaje.trim()) return value.mensaje;

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

function hasMoneyValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
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

function formatMoneyEnter(value) {
  if (value === null || value === undefined || value === "") return "";

  const normalized = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const num = Number(normalized);

  if (!Number.isFinite(num)) return "";

  return num.toFixed(2).replace(".", ",");
}

function formatPricingResultEnter(result) {
  return {
    price: formatMoneyEnter(result.price),
    marginPct: formatMoneyEnter(result.marginPct),
    marginValue: formatMoneyEnter(result.marginValue),
  };
}

function hydratePricingGroupValues({ cost, price, marginPct, marginValue }) {
  const hasPrice = hasMoneyValue(price);
  const hasPct = hasMoneyValue(marginPct);
  const hasVal = hasMoneyValue(marginValue);

  if (hasPrice && hasPct && hasVal) {
    return {
      price: formatMoneyBlur(price),
      marginPct: formatMoneyBlur(marginPct),
      marginValue: formatMoneyBlur(marginValue),
    };
  }

  const source = hasPrice ? "price" : hasPct ? "marginPct" : hasVal ? "marginValue" : null;

  if (!source) {
    return {
      price: "",
      marginPct: "",
      marginValue: "",
    };
  }

  return recalculatePricingGroup({
    cost,
    price,
    marginPct,
    marginValue,
    source,
  });
}

function hydratePricingFormValues(sourceForm) {
  const venta = hydratePricingGroupValues({
    cost: sourceForm.precio_costo,
    price: sourceForm.precio,
    marginPct: sourceForm.margen_venta_porcentaje,
    marginValue: sourceForm.margen_venta_valor,
  });

  const promo = hydratePricingGroupValues({
    cost: sourceForm.precio_costo,
    price: sourceForm.precio_promo,
    marginPct: sourceForm.margen_promo_porcentaje,
    marginValue: sourceForm.margen_promo_valor,
  });

  const extras = (sourceForm.tipos_precio_extra || []).map((item) => {
    const result = hydratePricingGroupValues({
      cost: sourceForm.precio_costo,
      price: item.precio,
      marginPct: item.margen_porcentaje,
      marginValue: item.margen_valor,
    });

    return {
      ...item,
      precio: result.price,
      margen_porcentaje: result.marginPct,
      margen_valor: result.marginValue,
    };
  });

  return {
    ...sourceForm,
    precio_costo: formatMoneyBlur(sourceForm.precio_costo),
    precio: venta.price,
    margen_venta_porcentaje: venta.marginPct,
    margen_venta_valor: venta.marginValue,
    precio_promo: promo.price,
    margen_promo_porcentaje: promo.marginPct,
    margen_promo_valor: promo.marginValue,
    tipos_precio_extra: extras,
  };
}

function recalculatePricingFormLive(prev, fieldName, rawValue) {
  const value = normalizeMoneyInput(rawValue);
  const next = { ...prev, [fieldName]: value };

  if (fieldName === "precio_costo") return hydratePricingFormValues(next);

  if (["precio", "margen_venta_porcentaje", "margen_venta_valor"].includes(fieldName)) {
    const source =
      fieldName === "precio"
        ? "price"
        : fieldName === "margen_venta_porcentaje"
          ? "marginPct"
          : "marginValue";

    const result = recalculatePricingGroup({
      cost: next.precio_costo,
      price: next.precio,
      marginPct: next.margen_venta_porcentaje,
      marginValue: next.margen_venta_valor,
      source,
    });

    return {
      ...next,
      precio: result.price,
      margen_venta_porcentaje: result.marginPct,
      margen_venta_valor: result.marginValue,
    };
  }

  if (["precio_promo", "margen_promo_porcentaje", "margen_promo_valor"].includes(fieldName)) {
    const source =
      fieldName === "precio_promo"
        ? "price"
        : fieldName === "margen_promo_porcentaje"
          ? "marginPct"
          : "marginValue";

    const result = recalculatePricingGroup({
      cost: next.precio_costo,
      price: next.precio_promo,
      marginPct: next.margen_promo_porcentaje,
      marginValue: next.margen_promo_valor,
      source,
    });

    return {
      ...next,
      precio_promo: result.price,
      margen_promo_porcentaje: result.marginPct,
      margen_promo_valor: result.marginValue,
    };
  }

  return next;
}

/* ── Subcomponentes ── */
function TipoBadge({ tipo }) {
  const map = {
    imagen: { label: "Imagen", cls: "cmi-badge--img" },
    "": { label: "No válido", cls: "cmi-badge--none" },
  };

  const { label, cls } = map[tipo] ?? map[""];

  return <span className={`cmi-badge ${cls}`}>{label}</span>;
}

function getFirstErrorText(errs) {
  if (!errs || typeof errs !== "object") return "Revisá los campos marcados";

  const first = Object.values(errs).find((value) => {
    if (typeof value === "string") return value.trim();
    return value !== null && value !== undefined && value !== false;
  });

  return errorToText(first, "Revisá los campos marcados");
}

function variantHasContent(variant = {}) {
  return (
    String(variant.nombre_variante || variant.sku || "").trim() ||
    (Array.isArray(variant.atributos) ? variant.atributos : []).some((attr) =>
      String(attr.atributo || attr.valor || "").trim()
    )
  );
}

function isValidMoneyValue(value) {
  if (!hasMoneyValue(value)) return false;
  const parsed = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0;
}

function FloatingField({ label, icon, error, children, style }) {
  return (
    <div
      className={`cmi-floatingField fl-field ${error ? "cmi-floatingField--error" : ""}`}
      style={style}
      title={error ? errorToText(error) : undefined}
    >
      <label className="cmi-floatingLabel">
        {icon && <FontAwesomeIcon icon={icon} style={{ fontSize: 10, opacity: 0.8 }} />}
        {label}
      </label>

      {children}
    </div>
  );
}

function PriceInput({
  name,
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  onEnter,
  placeholder,
  disabled,
  className,
}) {
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const cleanValue = cleanDecoratedNumber(e.currentTarget.value);
      const originalValue = e.currentTarget.value;
      e.currentTarget.value = cleanValue;
      e.target.value = cleanValue;
      onEnter?.(e);
      e.currentTarget.value = originalValue;
      return;
    }

    onKeyDown?.(e);
  };

  return (
    <input
      name={name}
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      className={className || "cmi-input"}
      placeholder={placeholder || (kind === "percent" ? "0 %" : "$ 0,00")}
      disabled={disabled}
      inputMode="decimal"
    />
  );
}

function PriceGroupSection({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="cmi-priceBlock__title">
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--nv-action, #0055BB)",
            flexShrink: 0,
          }}
        />
        {title}
      </div>

      {children}
    </div>
  );
}

function MiniCreateModal({ open, title, value, loading, onChange, onCancel, onSave, children }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (e) => {
      if (e.key !== "Escape") return;

      if (!isTopStockModal(overlayRef.current)) return;

      e.preventDefault();
      e.stopPropagation();

      if (!loading) onCancel?.();
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const handleMiniEnter = (e) => {
    if (e.key !== "Enter") return;

    e.preventDefault();

    if (!loading) onSave?.();
  };

  return (
    <div ref={overlayRef} data-stock-modal-overlay="true" className="cmi-miniOverlay">
      <div className="cmi-miniModal">
        <div className="cmi-miniModal__head">{title}</div>

        <div className="cmi-miniModal__body">
          <FloatingField label="Nombre *">
            <input
              className="cmi-input"
              value={value}
              onChange={(e) => onChange(toCapitalizedText(e.target.value))}
              onKeyDown={handleMiniEnter}
              placeholder="ESCRIBÍ EL NOMBRE"
              style={{ textTransform: "uppercase" }}
              autoFocus
            />
          </FloatingField>

          {children}

          <div className="cmi-miniModal__actions">
            <button type="button" className="mit-btn mit-btn--ghost" onClick={onCancel} disabled={loading}>
              Cancelar
            </button>

            <button type="button" className="mit-btn mit-btn--solid" onClick={onSave} disabled={loading}>
              {loading ? (
                "Guardando..."
              ) : (
                <>
                  <FontAwesomeIcon icon={faCheck} /> Guardar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function emptyVariantAttr() {
  return { atributo: "", valor: "" };
}

function getTipoPrecioIdValue(tipo) {
  return String(tipo?.id_tipo_precio_stock ?? tipo?.id ?? "").trim();
}

function isBaseTipoPrecioId(tipoId) {
  return ["1", "2", "3"].includes(String(tipoId ?? ""));
}

function normalizeVariantExtraPriceRow(tipo = null, existing = null) {
  return {
    id_tipo_precio_stock: getTipoPrecioIdValue(tipo || existing),
    tipo_nombre: normalizeOptionLabel(tipo?.tipo_nombre ?? tipo?.nombre ?? existing?.tipo_nombre ?? existing?.nombre ?? ""),
    precio: existing?.precio ?? "",
    margen_porcentaje: existing?.margen_porcentaje ?? "",
    margen_valor: existing?.margen_valor ?? "",
  };
}

function syncVariantExtraPrices(variant = {}, tiposProducto = []) {
  const actuales = Array.isArray(variant.tipos_precio_extra) ? variant.tipos_precio_extra : [];
  const porId = new Map();

  actuales.forEach((item) => {
    const id = getTipoPrecioIdValue(item);
    if (id && !isBaseTipoPrecioId(id)) porId.set(id, item);
  });

  return (Array.isArray(tiposProducto) ? tiposProducto : [])
    .map((tipo) => {
      const id = getTipoPrecioIdValue(tipo);
      if (!id || isBaseTipoPrecioId(id)) return null;
      return normalizeVariantExtraPriceRow(tipo, porId.get(id));
    })
    .filter(Boolean);
}

function syncVariantsExtraPrices(variantes = [], tiposProducto = []) {
  return (Array.isArray(variantes) ? variantes : []).map((variant) => ({
    ...variant,
    tipos_precio_extra: syncVariantExtraPrices(variant, tiposProducto),
  }));
}

function emptyVariantRow(tiposProducto = []) {
  const variant = {
    nombre_variante: "",
    sku: "",
    stock: "0",
    categorias_ids: [],
    precio_costo: "",
    precio: "",
    precio_promo: "",
    atributos: [emptyVariantAttr()],
    tipos_precio_extra: [],
  };

  return {
    ...variant,
    tipos_precio_extra: syncVariantExtraPrices(variant, tiposProducto),
  };
}

function categoryOptionLabel(cat) {
  if (!cat) return "Categoría";
  if (cat.nombre_mostrar) return String(cat.nombre_mostrar).toUpperCase();
  const nivel = Number(cat.nivel || 0);
  return `${"— ".repeat(nivel)}${String(cat.nombre || cat.label || "Categoría")}`.toUpperCase();
}

function getCategoryIdValue(cat) {
  return normalizeIdValue(cat?.id_stock_categoria ?? cat?.id ?? cat?.id_categoria ?? "");
}

function getCategoryParentIdValue(cat) {
  return normalizeIdValue(cat?.id_categoria_padre ?? cat?.categoria_padre_id ?? cat?.parent_id ?? "");
}

function isCategoriaPadre(cat) {
  const parentId = getCategoryParentIdValue(cat);
  return !parentId || parentId === "0";
}

function normalizeCategoriaRegistro(cat, fallback = {}) {
  const base = cat || {};
  const id = normalizeIdValue(base.id_stock_categoria ?? base.id ?? fallback.id ?? fallback.id_stock_categoria ?? "");
  const idPadre = normalizeIdValue(base.id_categoria_padre ?? fallback.id_categoria_padre ?? "");
  const nivel = Number(base.nivel ?? fallback.nivel ?? (idPadre ? 1 : 0)) || 0;
  const nombre = String(base.nombre ?? fallback.nombre ?? "").trim().toUpperCase();

  return {
    ...fallback,
    ...base,
    id,
    id_stock_categoria: id,
    id_categoria_padre: idPadre || null,
    nivel,
    nombre,
    nombre_mostrar: String(base.nombre_mostrar ?? fallback.nombre_mostrar ?? `${"— ".repeat(nivel)}${nombre}`).trim(),
  };
}

function buildVariantPricePayload(variant) {
  const precios = [];
  if (variant.precio_costo !== "") {
    precios.push({ id_tipo_precio_stock: 1, nombre: "COSTO", tipo_nombre: "COSTO", precio: moneyToApi(variant.precio_costo) });
  }
  if (variant.precio !== "") {
    precios.push({ id_tipo_precio_stock: 2, nombre: "VENTA", tipo_nombre: "VENTA", precio: moneyToApi(variant.precio) });
  }
  if (variant.precio_promo !== "") {
    precios.push({ id_tipo_precio_stock: 3, nombre: "PROMO", tipo_nombre: "PROMO", precio: moneyToApi(variant.precio_promo) });
  }

  (Array.isArray(variant.tipos_precio_extra) ? variant.tipos_precio_extra : []).forEach((item) => {
    const id = Number(item.id_tipo_precio_stock || 0);
    if (!id || isBaseTipoPrecioId(id)) return;

    const precio = moneyToApi(item.precio);
    if (precio === "") return;

    precios.push({
      id_tipo_precio_stock: id,
      nombre: toCapitalizedText(item.tipo_nombre),
      tipo_nombre: toCapitalizedText(item.tipo_nombre),
      precio,
      margen_porcentaje: moneyToApi(item.margen_porcentaje),
      margen_valor: moneyToApi(item.margen_valor),
    });
  });

  return precios.filter((p) => p.precio !== "");
}

function getPayloadPrice(precios = [], idTipo) {
  const item = (Array.isArray(precios) ? precios : []).find(
    (precio) => Number(precio?.id_tipo_precio_stock || 0) === Number(idTipo)
  );

  return item?.precio ?? item?.monto ?? null;
}

function buildOptimisticVariant(savedVariant = {}, variantPayload = {}) {
  return {
    ...savedVariant,
    ...variantPayload,
    id:
      Number(savedVariant?.id ?? savedVariant?.id_stock_variante ?? variantPayload?.id_stock_variante ?? 0) ||
      undefined,
    id_stock_variante:
      Number(savedVariant?.id_stock_variante ?? savedVariant?.id ?? variantPayload?.id_stock_variante ?? 0) ||
      undefined,
    precio_costo: getPayloadPrice(variantPayload?.precios, 1),
    precio: getPayloadPrice(variantPayload?.precios, 2),
    precio_promo: getPayloadPrice(variantPayload?.precios, 3),
  };
}

function buildOptimisticProduct(savedProduct, sourceForm, variantesPayload = []) {
  if (!savedProduct || typeof savedProduct !== "object") return savedProduct;

  const id = Number(savedProduct?.id ?? savedProduct?.id_stock_producto ?? 0);
  if (!id) return savedProduct;

  const usaVariantes = !!sourceForm?.tiene_variantes;
  const variantesGuardadas = Array.isArray(savedProduct?.variantes) ? savedProduct.variantes : [];
  const variantes = usaVariantes
    ? variantesPayload.map((variant, index) =>
        buildOptimisticVariant(variantesGuardadas[index] || {}, variant)
      )
    : [];
  const varianteResumen = usaVariantes ? variantes[0] || null : null;

  return {
    ...savedProduct,
    id,
    id_stock_producto: id,
    nombre: toCapitalizedText(sourceForm?.nombre),
    sku: toUpperCaseValue(String(sourceForm?.sku || "").trim()),
    descripcion: toCapitalizedText(sourceForm?.descripcion),
    stock: usaVariantes
      ? variantes.reduce((total, variant) => total + Number(variant?.stock || 0), 0)
      : Number(sourceForm?.stock || 0),
    // Para productos con variantes, la fila padre muestra como resumen los precios
    // de la primera variante, igual que la respuesta consolidada del backend/TN.
    precio_costo: usaVariantes ? varianteResumen?.precio_costo ?? null : moneyToApi(sourceForm?.precio_costo) || null,
    precio: usaVariantes ? varianteResumen?.precio ?? null : moneyToApi(sourceForm?.precio) || null,
    precio_promo: usaVariantes ? varianteResumen?.precio_promo ?? null : moneyToApi(sourceForm?.precio_promo) || null,
    id_stock_categoria: Number(normalizeIdValue(sourceForm?.id_categoria_stock)) || null,
    id_categoria_stock: Number(normalizeIdValue(sourceForm?.id_categoria_stock)) || null,
    tiene_variantes: usaVariantes,
    cantidad_variantes: variantes.length,
    cantidad_variantes_total: variantes.length,
    cantidad_variantes_activas: variantes.length,
    cantidad_variantes_inactivas: 0,
    variantes: usaVariantes ? variantes : savedProduct?.variantes,
  };
}

function buildEmptyForm() {
  return {
    nombre: "",
    sku: "",
    precio_costo: "",
    precio: "",
    margen_venta_porcentaje: "",
    margen_venta_valor: "",
    precio_promo: "",
    margen_promo_porcentaje: "",
    margen_promo_valor: "",
    stock: "",
    descripcion: "",
    id_categoria_stock: "",
    categorias_ids: [],
    tiene_variantes: false,
    variantes: [emptyVariantRow()],
    tipos_precio_extra: [],
  };
}

/* ── Componente principal ── */
export default function ModalCargaIndividualProducto({
  open,
  visible,
  categorias = [],
  loadingCategorias = false,
  tiposPrecio = [],
  loadingTiposPrecio = false,
  onGuardado,
  onRequestClose,
  onLoadingChange,
  onCategoriaCreada,
  onTipoPrecioCreado,
  onToast,
}) {
  const inputImagenRef = useRef(null);
  const categoriasPanelRef = useRef(null);
  const variantesPanelRef = useRef(null);
  // El estado de React deshabilita el botón en el siguiente render, pero dos clicks
  // muy rápidos pueden entrar al handler antes de ese render y enviar dos POST. Este
  // candado sincrónico cierra la ventana y garantiza una sola alta por apertura.
  const guardandoRef = useRef(false);

  const [guardando, setGuardando] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMime, setPreviewMime] = useState("");
  const [previewFileName, setPreviewFileName] = useState("");
  const [previewTitle, setPreviewTitle] = useState("Archivo");
  const [form, setForm] = useState(buildEmptyForm);
  const [cargaActiva, setCargaActiva] = useState("producto");
  const [barcodeProductoGuardado, setBarcodeProductoGuardado] = useState(null);
  const [barcodeGuardadoContexto, setBarcodeGuardadoContexto] = useState(null);
  const [errores, setErrores] = useState({});
  const [imagenFile, setImagenFile] = useState(null);

  const [miniCategoriaOpen, setMiniCategoriaOpen] = useState(false);
  const [miniCategoriaNombre, setMiniCategoriaNombre] = useState("");
  const [miniCategoriaPadreId, setMiniCategoriaPadreId] = useState("");
  const [guardandoMiniCategoria, setGuardandoMiniCategoria] = useState(false);
  const [subCategoriaNombre, setSubCategoriaNombre] = useState("");
  const [guardandoSubCategoria, setGuardandoSubCategoria] = useState(false);

  const [miniTipoOpen, setMiniTipoOpen] = useState(false);
  const [miniTipoNombre, setMiniTipoNombre] = useState("");
  const [guardandoMiniTipo, setGuardandoMiniTipo] = useState(false);

  const focusNextField = (currentTarget) => {
    const root =
      currentTarget?.closest?.(".mi-modal__container") ||
      currentTarget?.closest?.(".mi-modal__content") ||
      document;

    const fields = Array.from(
      root.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      )
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    const index = fields.indexOf(currentTarget);

    if (index >= 0 && fields[index + 1]) {
      fields[index + 1].focus();
      fields[index + 1].select?.();
    }
  };

  const handleFieldEnter = (e) => {
    if (e.key !== "Enter") return;

    if (e.currentTarget?.tagName === "TEXTAREA" && e.shiftKey) return;

    e.preventDefault();
    focusNextField(e.currentTarget);
  };

  const handlePriceEnter = (e, formatAction) => {
    e.preventDefault();

    formatAction?.(e);

    requestAnimationFrame(() => {
      focusNextField(e.currentTarget);
    });
  };

  const mostrarToast = (mensaje, tipo = "error") => onToast?.(errorToText(mensaje), tipo);

  const irAPanel = (ref) => {
    ref?.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const imagenNombre = useMemo(() => imagenFile?.name || "", [imagenFile]);

  const categoriasSafe = useMemo(
    () => (Array.isArray(categorias) ? categorias.filter(Boolean) : []),
    [categorias]
  );

  const categoriasPadre = useMemo(
    () => categoriasSafe.filter(isCategoriaPadre),
    [categoriasSafe]
  );

  const categoriaPrincipalId = useMemo(
    () => normalizeIdValue(form.id_categoria_stock),
    [form.id_categoria_stock]
  );

  const categoriaPrincipal = useMemo(
    () => categoriasSafe.find((cat) => getCategoryIdValue(cat) === categoriaPrincipalId) || null,
    [categoriasSafe, categoriaPrincipalId]
  );

  const subcategoriasCategoriaPrincipal = useMemo(
    () => categoriaPrincipalId
      ? categoriasSafe.filter((cat) => getCategoryParentIdValue(cat) === categoriaPrincipalId)
      : [],
    [categoriasSafe, categoriaPrincipalId]
  );

  const tiposPrecioSafe = useMemo(
    () => (Array.isArray(tiposPrecio) ? tiposPrecio.filter(Boolean) : []),
    [tiposPrecio]
  );

  useEffect(() => {
    // Después de crear desde la pestaña Código de barra el registro ya existe,
    // pero mantenemos bloqueado el cierre del modal padre hasta que el usuario
    // termine de imprimir/escanear y pulse Finalizar.
    onLoadingChange?.(guardando || !!barcodeProductoGuardado);
  }, [guardando, barcodeProductoGuardado, onLoadingChange]);

  useEffect(() => {
    if (!open) {
      setForm(buildEmptyForm());
      setCargaActiva("producto");
      setBarcodeProductoGuardado(null);
      setBarcodeGuardadoContexto(null);
      setErrores({});
      setGuardando(false);
      setImagenFile(null);
      setMiniCategoriaPadreId("");
      setSubCategoriaNombre("");
      cerrarPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  const limpiarImagen = () => {
    setImagenFile(null);

    if (inputImagenRef.current) {
      inputImagenRef.current.value = "";
    }
  };

  const tomarImagen = (file) => {
    if (!file) return;

    const tipos = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

    if (!tipos.includes(file.type)) {
      const msg = "La imagen debe ser JPG, PNG, WEBP o GIF";
      setErrores((p) => ({ ...p, imagen: msg }));
      mostrarToast(msg, "error");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      const msg = "La imagen no puede superar los 5 MB";
      setErrores((p) => ({ ...p, imagen: msg }));
      mostrarToast(msg, "error");
      return;
    }

    setImagenFile(file);
    setErrores((p) => ({ ...p, imagen: "" }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (
      [
        "precio_costo",
        "precio",
        "margen_venta_porcentaje",
        "margen_venta_valor",
        "precio_promo",
        "margen_promo_porcentaje",
        "margen_promo_valor",
      ].includes(name)
    ) {
      setForm((p) => recalculatePricingFormLive(p, name, value));
    } else if (name === "stock") {
      setForm((p) => ({ ...p, [name]: onlyNumbers(value) }));
    } else if (["nombre", "descripcion"].includes(name)) {
      setForm((p) => ({ ...p, [name]: toCapitalizedText(value) }));
    } else if (name === "sku") {
      setForm((p) => ({ ...p, [name]: toUpperCaseValue(value) }));
    } else if (name === "id_categoria_stock") {
      if (value === "__nueva_categoria__") {
        setMiniCategoriaOpen(true);
        return;
      }

      const idNormalizado = normalizeIdValue(value);
      setForm((p) => ({
        ...p,
        [name]: idNormalizado,
        categorias_ids: idNormalizado
          ? Array.from(new Set([...(p.categorias_ids || []), idNormalizado]))
          : p.categorias_ids || [],
      }));
    } else {
      setForm((p) => ({ ...p, [name]: value }));
    }

    setErrores((p) => ({ ...p, [name]: "" }));
  };

  const handleCostoChangeLive = (rawValue) => {
    const value = normalizeMoneyInput(rawValue);

    recalcularTodoConCosto(value, false);
    setErrores((p) => ({ ...p, precio_costo: "" }));
  };

  const applyPricingResult = (prefix, result) => {
    setForm((p) => ({
      ...p,
      [prefix.price]: result.price,
      [prefix.marginPct]: result.marginPct,
      [prefix.marginVal]: result.marginValue,
    }));
  };

  const handlePricingBlur = (source, groupName, withCents = true) => {
    const prefix =
      groupName === "venta"
        ? {
            price: "precio",
            marginPct: "margen_venta_porcentaje",
            marginVal: "margen_venta_valor",
          }
        : {
            price: "precio_promo",
            marginPct: "margen_promo_porcentaje",
            marginVal: "margen_promo_valor",
          };

    const resultRaw = recalculatePricingGroup({
      cost: form.precio_costo,
      price: form[prefix.price],
      marginPct: form[prefix.marginPct],
      marginValue: form[prefix.marginVal],
      source,
    });

    const result = withCents ? formatPricingResultEnter(resultRaw) : resultRaw;

    applyPricingResult(prefix, result);
  };

  const recalcularTodoConCosto = (nuevoCosto, withCents = true) => {
    setForm((p) => {
      const ventaRaw = recalculatePricingGroup({
        cost: nuevoCosto,
        price: p.precio,
        marginPct: p.margen_venta_porcentaje,
        marginValue: p.margen_venta_valor,
        source: p.precio
          ? "price"
          : p.margen_venta_porcentaje
            ? "marginPct"
            : p.margen_venta_valor
              ? "marginValue"
              : null,
      });

      const promoRaw = recalculatePricingGroup({
        cost: nuevoCosto,
        price: p.precio_promo,
        marginPct: p.margen_promo_porcentaje,
        marginValue: p.margen_promo_valor,
        source: p.precio_promo
          ? "price"
          : p.margen_promo_porcentaje
            ? "marginPct"
            : p.margen_promo_valor
              ? "marginValue"
              : null,
      });

      const venta = withCents ? formatPricingResultEnter(ventaRaw) : ventaRaw;
      const promo = withCents ? formatPricingResultEnter(promoRaw) : promoRaw;

      const extras = (p.tipos_precio_extra || []).map((item) => {
        const resultRaw = recalculatePricingGroup({
          cost: nuevoCosto,
          price: item.precio,
          marginPct: item.margen_porcentaje,
          marginValue: item.margen_valor,
          source: item.precio
            ? "price"
            : item.margen_porcentaje
              ? "marginPct"
              : item.margen_valor
                ? "marginValue"
                : null,
        });

        const result = withCents ? formatPricingResultEnter(resultRaw) : resultRaw;

        return {
          ...item,
          precio: result.price,
          margen_porcentaje: result.marginPct,
          margen_valor: result.marginValue,
        };
      });

      return {
        ...p,
        precio_costo: withCents ? formatMoneyEnter(nuevoCosto) : formatMoneyBlur(nuevoCosto),
        precio: venta.price,
        margen_venta_porcentaje: venta.marginPct,
        margen_venta_valor: venta.marginValue,
        precio_promo: promo.price,
        margen_promo_porcentaje: promo.marginPct,
        margen_promo_valor: promo.marginValue,
        tipos_precio_extra: extras,
      };
    });
  };

  const handleExtraPriceChange = (idx, field, value) => {
    setForm((p) => {
      const next = {
        ...p,
        tipos_precio_extra: p.tipos_precio_extra.map((item, i) =>
          i === idx
            ? {
                ...item,
                [field]: ["precio", "margen_porcentaje", "margen_valor"].includes(field)
                  ? normalizeMoneyInput(value)
                  : value,
              }
            : item
        ),
      };

      if (!["precio", "margen_porcentaje", "margen_valor"].includes(field)) return next;

      return {
        ...next,
        tipos_precio_extra: next.tipos_precio_extra.map((item, i) => {
          if (i !== idx) return item;

          const source =
            field === "precio"
              ? "price"
              : field === "margen_porcentaje"
                ? "marginPct"
                : "marginValue";

          const result = recalculatePricingGroup({
            cost: next.precio_costo,
            price: item.precio,
            marginPct: item.margen_porcentaje,
            marginValue: item.margen_valor,
            source,
          });

          return {
            ...item,
            precio: result.price,
            margen_porcentaje: result.marginPct,
            margen_valor: result.marginValue,
          };
        }),
      };
    });

    setErrores((p) => ({ ...p, [`tipo_${idx}`]: "" }));
  };

  const handleExtraPriceBlur = (idx, source, withCents = true) => {
    setForm((p) => ({
      ...p,
      tipos_precio_extra: p.tipos_precio_extra.map((item, i) => {
        if (i !== idx) return item;

        const resultRaw = recalculatePricingGroup({
          cost: p.precio_costo,
          price: item.precio,
          marginPct: item.margen_porcentaje,
          marginValue: item.margen_valor,
          source,
        });

        const result = withCents ? formatPricingResultEnter(resultRaw) : resultRaw;

        return {
          ...item,
          precio: result.price,
          margen_porcentaje: result.marginPct,
          margen_valor: result.marginValue,
        };
      }),
    }));
  };

  const handleTipoSelectChange = (val) => {
    if (!val) return;

    if (val === "__nuevo_tipo__") {
      setMiniTipoOpen(true);
      return;
    }

    const yaExiste = form.tipos_precio_extra.some(
      (item) => String(item.id_tipo_precio_stock) === String(val)
    );

    if (yaExiste) return;

    const tipo = tiposPrecioSafe.find((t) => String(t.id ?? t.id_tipo_precio_stock) === String(val));

    setForm((p) => {
      const tipos_precio_extra = [...(p.tipos_precio_extra || []), emptyExtraPriceRow(tipo)];
      return {
        ...p,
        tipos_precio_extra,
        variantes: syncVariantsExtraPrices(p.variantes, tipos_precio_extra),
      };
    });
  };

  const quitarTipoPrecio = (idx) => {
    setForm((p) => {
      const tipos_precio_extra = (p.tipos_precio_extra || []).filter((_, i) => i !== idx);
      return {
        ...p,
        tipos_precio_extra,
        variantes: syncVariantsExtraPrices(p.variantes, tipos_precio_extra),
      };
    });
  };


  const toggleCategoriaMultiple = (categoriaId) => {
    const id = normalizeIdValue(categoriaId);
    if (!id) return;
    setForm((p) => {
      const actuales = Array.isArray(p.categorias_ids) ? p.categorias_ids : [];
      const existe = actuales.includes(id);
      const categorias_ids = existe ? actuales.filter((x) => x !== id) : [...actuales, id];
      return {
        ...p,
        categorias_ids,
        id_categoria_stock: p.id_categoria_stock || id,
      };
    });
  };

  const toggleVariantCategoria = (variantIdx, categoriaId) => {
    const id = normalizeIdValue(categoriaId);
    if (!id) return;

    setForm((p) => ({
      ...p,
      variantes: (p.variantes || []).map((variant, i) => {
        if (i !== variantIdx) return variant;
        const actuales = (Array.isArray(variant.categorias_ids) ? variant.categorias_ids : []).map(normalizeIdValue).filter(Boolean);
        const existe = actuales.includes(id);
        return {
          ...variant,
          categorias_ids: existe ? actuales.filter((x) => x !== id) : [...actuales, id],
        };
      }),
    }));
  };

  const updateVariant = (idx, patch) => {
    setForm((p) => ({
      ...p,
      variantes: (p.variantes || []).map((variant, i) =>
        i === idx ? { ...variant, ...patch } : variant
      ),
    }));
  };

  const updateVariantAttr = (variantIdx, attrIdx, patch) => {
    setForm((p) => ({
      ...p,
      variantes: (p.variantes || []).map((variant, i) =>
        i === variantIdx
          ? {
              ...variant,
              atributos: (variant.atributos || []).map((attr, j) =>
                j === attrIdx ? { ...attr, ...patch } : attr
              ),
            }
          : variant
      ),
    }));
  };

  const addVariant = () => {
    setForm((p) => ({ ...p, variantes: [...(p.variantes || []), emptyVariantRow(p.tipos_precio_extra)] }));
  };

  const removeVariant = (idx) => {
    setForm((p) => {
      const next = (p.variantes || []).filter((_, i) => i !== idx);
      return { ...p, variantes: next.length ? next : [emptyVariantRow(p.tipos_precio_extra)] };
    });
  };

  const addVariantAttr = (idx) => {
    setForm((p) => ({
      ...p,
      variantes: (p.variantes || []).map((variant, i) =>
        i === idx
          ? { ...variant, atributos: [...(variant.atributos || []), emptyVariantAttr()] }
          : variant
      ),
    }));
  };

  const validar = (sourceForm = form) => {
    const errs = {};

    const precioVenta = Number(String(sourceForm.precio || "").replace(",", "."));
    const precioCosto =
      sourceForm.precio_costo !== "" ? Number(String(sourceForm.precio_costo).replace(",", ".")) : null;
    const promo =
      sourceForm.precio_promo !== "" ? Number(String(sourceForm.precio_promo).replace(",", ".")) : null;

    if (!sourceForm.nombre.trim()) errs.nombre = "El nombre es obligatorio";

    if (!sourceForm.tiene_variantes) {
      if (precioCosto !== null && (Number.isNaN(precioCosto) || precioCosto < 0)) {
        errs.precio_costo = "Ingresá un costo válido";
      }

      if (!sourceForm.precio || Number.isNaN(precioVenta) || precioVenta < 0) {
        errs.precio = "Ingresá un precio de venta válido";
      }

      if (sourceForm.precio_promo && (Number.isNaN(promo) || promo < 0)) {
        errs.precio_promo = "Precio promocional inválido";
      }

      if (sourceForm.stock !== "" && (Number.isNaN(Number(sourceForm.stock)) || Number(sourceForm.stock) < 0)) {
        errs.stock = "Stock inválido";
      }
    }

    if (sourceForm.tiene_variantes) {
      const variantesValidas = (sourceForm.variantes || []).filter(variantHasContent);

      if (variantesValidas.length === 0) {
        errs.variantes = "Agregá al menos una variante";
      }

      variantesValidas.forEach((variant, idx) => {
        const numero = idx + 1;
        if (!String(variant.nombre_variante || "").trim()) {
          errs[`variante_${idx}_nombre`] = `La variante #${numero} necesita nombre.`;
        }
        if (!String(variant.sku || "").trim()) {
          errs[`variante_${idx}_sku`] = `La variante #${numero} necesita SKU.`;
        }
        if (variant.stock === "" || Number.isNaN(Number(variant.stock)) || Number(variant.stock) < 0) {
          errs[`variante_${idx}_stock`] = `La variante #${numero} necesita stock válido.`;
        }
        if (!isValidMoneyValue(variant.precio)) {
          errs[`variante_${idx}_precio`] = `La variante #${numero} necesita precio de venta propio.`;
        }
      });
    }

    if (!sourceForm.tiene_variantes) sourceForm.tipos_precio_extra.forEach((item, idx) => {
      if (!item.id_tipo_precio_stock) {
        errs[`tipo_${idx}`] = "Tipo de precio inválido";
      }

      if (
        item.precio &&
        (Number.isNaN(Number(String(item.precio).replace(",", "."))) ||
          Number(String(item.precio).replace(",", ".")) < 0)
      ) {
        errs[`tipo_${idx}`] = "Precio extra inválido";
      }
    });

    if (imagenFile) {
      const tipos = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

      if (!tipos.includes(imagenFile.type)) {
        errs.imagen = "La imagen debe ser JPG, PNG, WEBP o GIF";
      }

      if (imagenFile.size > 5 * 1024 * 1024) {
        errs.imagen = "La imagen no puede superar los 5 MB";
      }
    }

    return errs;
  };

  const guardarNuevaCategoria = async () => {
    const nombreLimpio = toCapitalizedText(miniCategoriaNombre);

    if (!nombreLimpio) return;

    setGuardandoMiniCategoria(true);

    try {
      const data = await crearCategoriaStock({
        nombre: nombreLimpio,
        id_categoria_padre: miniCategoriaPadreId || null,
      });

      const nueva = data.categoria || data.nueva || {
        id: data.id_stock_categoria,
        id_stock_categoria: data.id_stock_categoria,
        nombre: nombreLimpio,
        id_categoria_padre: miniCategoriaPadreId || null,
      };

      const categoriaRegistrada = (await onCategoriaCreada?.(nueva)) || nueva;

      const nuevaId = normalizeIdValue(categoriaRegistrada);
      setForm((p) => ({
        ...p,
        id_categoria_stock: p.id_categoria_stock || nuevaId,
        categorias_ids: nuevaId
          ? Array.from(new Set([...(p.categorias_ids || []), nuevaId]))
          : p.categorias_ids || [],
      }));

      setMiniCategoriaNombre("");
      setMiniCategoriaPadreId("");
      setMiniCategoriaOpen(false);
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear la categoría"), "error");
    } finally {
      setGuardandoMiniCategoria(false);
    }
  };

  const guardarNuevaSubcategoriaInline = async () => {
    const idPadre = normalizeIdValue(form.id_categoria_stock);
    const nombreLimpio = toCapitalizedText(subCategoriaNombre);

    if (!idPadre) {
      mostrarToast("Primero seleccioná una categoría principal.", "error");
      return;
    }

    if (!nombreLimpio) {
      mostrarToast("Ingresá el nombre de la subcategoría.", "error");
      return;
    }

    setGuardandoSubCategoria(true);

    try {
      const data = await crearCategoriaStock({
        nombre: nombreLimpio,
        id_categoria_padre: idPadre,
      });
      const nivelPadre = Number(categoriaPrincipal?.nivel || 0);
      const nueva = normalizeCategoriaRegistro(data.categoria || data.nueva || {}, {
        id: data.id_stock_categoria,
        id_stock_categoria: data.id_stock_categoria,
        nombre: nombreLimpio,
        id_categoria_padre: idPadre,
        nivel: nivelPadre + 1,
        nombre_mostrar: `${"— ".repeat(nivelPadre + 1)}${nombreLimpio}`,
      });

      const categoriaRegistrada = normalizeCategoriaRegistro((await onCategoriaCreada?.(nueva)) || nueva, nueva);
      const nuevaId = getCategoryIdValue(categoriaRegistrada);

      setForm((p) => ({
        ...p,
        categorias_ids: nuevaId
          ? Array.from(new Set([...(p.categorias_ids || []), String(idPadre), nuevaId]))
          : p.categorias_ids || [],
      }));

      setSubCategoriaNombre("");
      mostrarToast("Subcategoría creada y asignada.", "exito");
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear la subcategoría"), "error");
    } finally {
      setGuardandoSubCategoria(false);
    }
  };

  const guardarNuevoTipo = async () => {
    const nombreLimpio = toCapitalizedText(miniTipoNombre);

    if (!nombreLimpio) return;

    setGuardandoMiniTipo(true);

    try {
      const data = await crearTipoPrecioStock({ nombre: nombreLimpio });

      const nuevo = data.tipo_precio || {
        id: data.id_tipo_precio_stock,
        id_tipo_precio_stock: data.id_tipo_precio_stock,
        nombre: nombreLimpio,
      };

      let tipoRegistrado = nuevo;

      try {
        tipoRegistrado = (await onTipoPrecioCreado?.(nuevo)) || nuevo;
      } catch {}

      setForm((p) => {
        const yaExiste = (p.tipos_precio_extra || []).some(
          (item) =>
            String(item.id_tipo_precio_stock) ===
            String(tipoRegistrado.id ?? tipoRegistrado.id_tipo_precio_stock ?? "")
        );

        if (yaExiste) return p;

        const tipos_precio_extra = [...(p.tipos_precio_extra || []), emptyExtraPriceRow(tipoRegistrado)];
        return {
          ...p,
          tipos_precio_extra,
          variantes: syncVariantsExtraPrices(p.variantes, tipos_precio_extra),
        };
      });

      setMiniTipoNombre("");
      setMiniTipoOpen(false);
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear el tipo de precio"), "error");
    } finally {
      setGuardandoMiniTipo(false);
    }
  };

  const handleGuardar = async () => {
    if (guardandoRef.current) return;

    const formNormalizado = hydratePricingFormValues(form);
    const errs = validar(formNormalizado);

    if (Object.keys(errs).length > 0) {
      setErrores(errs);
      setForm((p) => ({ ...p, ...formNormalizado }));
      if (Object.keys(errs).some((key) => key === "variantes" || key.startsWith("variante_"))) {
        setCargaActiva("variantes");
      } else {
        setCargaActiva("producto");
      }
      mostrarToast(getFirstErrorText(errs), "error");
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    setErrores({});
    setForm((p) => ({ ...p, ...formNormalizado }));
    // Feedback inmediato mientras el alta espera la respuesta del backend.
    // El toast se reemplaza por éxito o error cuando termina la operación.
    mostrarToast("Agregando producto...", "cargando");

    try {
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
      const fd = new FormData();

      fd.append("nombre", toCapitalizedText(formNormalizado.nombre));
      fd.append("sku", toUpperCaseValue(formNormalizado.sku.trim()));
      const usaVariantes = !!formNormalizado.tiene_variantes;

      fd.append("precio_costo", usaVariantes ? "" : moneyToApi(formNormalizado.precio_costo));
      fd.append("precio", usaVariantes ? "" : moneyToApi(formNormalizado.precio));
      fd.append("margen_venta_porcentaje", usaVariantes ? "" : moneyToApi(formNormalizado.margen_venta_porcentaje));
      fd.append("margen_venta_valor", usaVariantes ? "" : moneyToApi(formNormalizado.margen_venta_valor));
      fd.append("precio_promo", usaVariantes ? "" : moneyToApi(formNormalizado.precio_promo));
      fd.append("margen_promo_porcentaje", usaVariantes ? "" : moneyToApi(formNormalizado.margen_promo_porcentaje));
      fd.append("margen_promo_valor", usaVariantes ? "" : moneyToApi(formNormalizado.margen_promo_valor));
      fd.append(
        "stock",
        formNormalizado.tiene_variantes ? "0" : formNormalizado.stock !== "" ? String(formNormalizado.stock) : ""
      );
      fd.append("descripcion", toCapitalizedText(formNormalizado.descripcion));
      fd.append("tiene_variantes", formNormalizado.tiene_variantes ? "1" : "0");

      // El producto se confirma primero en Balto y la sincronización con Tienda Nube
      // se procesa después de cerrar la respuesta HTTP. Así una API externa lenta no
      // hace que el navegador informe timeout aunque el alta local haya salido bien.
      fd.append("diferir_sync", "1");
      fd.append("origen_sync", "carga_individual");

      if (formNormalizado.id_categoria_stock) {
        fd.append("id_categoria_stock", normalizeIdValue(formNormalizado.id_categoria_stock));
      }

      const categoriasIdsPayload = Array.from(
        new Set([
          ...(formNormalizado.categorias_ids || []).map((id) => Number(normalizeIdValue(id))).filter(Boolean),
          Number(normalizeIdValue(formNormalizado.id_categoria_stock)) || 0,
        ].filter(Boolean))
      );
      fd.append("categorias_ids", JSON.stringify(categoriasIdsPayload));

      const variantesPayload = formNormalizado.tiene_variantes
        ? (formNormalizado.variantes || [])
            .filter((variant) =>
              String(variant.nombre_variante || variant.sku || "").trim() ||
              (variant.atributos || []).some((attr) => String(attr.atributo || attr.valor || "").trim())
            )
            .map((variant) => ({
              nombre_variante: toCapitalizedText(variant.nombre_variante),
              sku: toUpperCaseValue(String(variant.sku || "").trim()),
              stock: Number(variant.stock || 0),
              categorias_ids: Array.from(new Set((variant.categorias_ids || []).map((id) => Number(normalizeIdValue(id))).filter(Boolean))),
              atributos: (variant.atributos || [])
                .filter((attr) => String(attr.atributo || "").trim() && String(attr.valor || "").trim())
                .map((attr) => ({
                  atributo: toCapitalizedText(attr.atributo),
                  valor: toCapitalizedText(attr.valor),
                })),
              precios: buildVariantPricePayload(variant),
            }))
        : [];
      fd.append("variantes", JSON.stringify(variantesPayload));

      if (idUsuarioMaster > 0) {
        fd.append("idUsuarioMaster", String(idUsuarioMaster));
      }

      if (idTenant) {
        fd.append("tenant_id", String(idTenant));
      }

      const tiposPrecioPayload = formNormalizado.tipos_precio_extra.map((item) => ({
        id_tipo_precio_stock: Number(item.id_tipo_precio_stock) || 0,
        tipo_nombre: toCapitalizedText(item.tipo_nombre),
        nombre: toCapitalizedText(item.tipo_nombre),
        precio: usaVariantes ? "" : moneyToApi(item.precio),
        margen_porcentaje: usaVariantes ? "" : moneyToApi(item.margen_porcentaje),
        margen_valor: usaVariantes ? "" : moneyToApi(item.margen_valor),
      }));

      fd.append("tipos_precio", JSON.stringify(tiposPrecioPayload));

      if (imagenFile) {
        fd.append("imagen", imagenFile);
      }

      const data = await crearProductoStock(fd);
      const productoGuardadoBase = data?.producto ?? data?.data?.producto ?? data?.data ?? null;
      const productoGuardado = buildOptimisticProduct(
        productoGuardadoBase,
        formNormalizado,
        variantesPayload
      );

      const continuarConCodigos = cargaActiva === "codigo_barra";
      const opcionesGuardado = {
        response: data,
        tiendanube_sync: data?.tiendanube_sync ?? data?.data?.tiendanube_sync ?? null,
        imagen_actualizada: !!imagenFile,
        imagen_file: imagenFile || null,
        producto_optimista: productoGuardado,
      };

      if (continuarConCodigos) {
        setBarcodeProductoGuardado(productoGuardado);
        setBarcodeGuardadoContexto({ productoGuardado, opcionesGuardado });
        setCargaActiva("codigo_barra");
        mostrarToast("Producto guardado. Ya podés imprimir o asociar sus códigos de barra.", "exito");
      } else {
        await onGuardado?.(productoGuardado, opcionesGuardado);
      }
    } catch (err) {
      mostrarToast(errorToText(err, "Error al guardar el producto"), "error");
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const handleFinalizarCodigos = async () => {
    if (!barcodeGuardadoContexto || guardandoRef.current) {
      if (!barcodeGuardadoContexto) onRequestClose?.();
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      await onGuardado?.(
        barcodeGuardadoContexto.productoGuardado,
        barcodeGuardadoContexto.opcionesGuardado
      );
    } catch (err) {
      mostrarToast(errorToText(err, "El producto está guardado, pero no se pudo finalizar el modal."), "error");
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  if (!open) return null;

  const productoConVariantes = !!form.tiene_variantes;
  const preciosProductoBloqueados = productoConVariantes || guardando;
  const hasCosto = !!form.precio_costo && !productoConVariantes;

  return (
    <div style={{ display: visible ? "contents" : "none" }}>
      <div
        className="mi-modal__content cmi-content--individual"
      >
        <div
          className={`cmi-v2-formShell cmi-v2-formShell--${cargaActiva}`}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div className="cmi-v2-mainTabs" role="tablist" aria-label="Carga de producto">
            <button
              type="button"
              className={`cmi-v2-mainTab ${cargaActiva === "producto" ? "is-active" : ""}`}
              onClick={() => setCargaActiva("producto")}
              role="tab"
              aria-selected={cargaActiva === "producto"}
              disabled={!!barcodeProductoGuardado}
              title={barcodeProductoGuardado ? "El producto ya fue guardado. Finalizá la gestión de códigos para editar otros datos." : undefined}
            >
              <FontAwesomeIcon icon={faBoxOpen} /> Producto original
            </button>
            <button
              type="button"
              className={`cmi-v2-mainTab ${cargaActiva === "variantes" ? "is-active" : ""}`}
              onClick={() => setCargaActiva("variantes")}
              role="tab"
              aria-selected={cargaActiva === "variantes"}
              disabled={!!barcodeProductoGuardado}
              title={barcodeProductoGuardado ? "El producto ya fue guardado. Finalizá la gestión de códigos para editar variantes." : undefined}
            >
              <FontAwesomeIcon icon={faCubesStacked} /> Variantes
            </button>
            <button
              type="button"
              className={`cmi-v2-mainTab ${cargaActiva === "codigo_barra" ? "is-active" : ""}`}
              onClick={() => setCargaActiva("codigo_barra")}
              role="tab"
              aria-selected={cargaActiva === "codigo_barra"}
            >
              <FontAwesomeIcon icon={faBarcode} /> Código de barra
            </button>
          </div>

          <StockBarcodePanel
            productoId={barcodeProductoGuardado?.id_stock_producto ?? barcodeProductoGuardado?.id ?? 0}
            nombreProducto={barcodeProductoGuardado?.nombre || form.nombre}
            tieneVariantes={barcodeProductoGuardado ? !!barcodeProductoGuardado?.tiene_variantes : !!form.tiene_variantes}
            variantes={barcodeProductoGuardado?.variantes || form.variantes}
            onToast={mostrarToast}
          />
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <SectionTitle label="Datos del producto" />

            <FloatingField label="Nombre del producto *" error={errores.nombre}>
              <input
                name="nombre"
                value={form.nombre}
                onChange={handleChange}
                onKeyDown={handleFieldEnter}
                className="cmi-input"
                placeholder="Ej: Auriculares bluetooth"
                style={{ fontSize: 14, fontWeight: 600 }}
              />
            </FloatingField>

            <div className="fl-row">
              <FloatingField label="SKU / Código" icon={faBarcode}>
                <input
                  name="sku"
                  value={form.sku}
                  onChange={handleChange}
                  onKeyDown={handleFieldEnter}
                  className="cmi-input"
                  placeholder="Ej: 04163"
                  style={{ textTransform: "uppercase" }}
                />
              </FloatingField>

              <FloatingField label="Stock inicial" icon={faCubesStacked} error={errores.stock}>
                <input
                  name="stock"
                  value={form.stock}
                  onChange={handleChange}
                  onKeyDown={handleFieldEnter}
                  className="cmi-input"
                  placeholder="Ej: 25"
                  inputMode="numeric"
                  disabled={productoConVariantes}
                />
              </FloatingField>

              <FloatingField label="Categoría" icon={faTag}>
                <select
                  name="id_categoria_stock"
                  value={normalizeIdValue(form.id_categoria_stock)}
                  onChange={handleChange}
                  onKeyDown={handleFieldEnter}
                  className="cmi-input cmi-select"
                  disabled={loadingCategorias}
                >
                  <option value="">
                    {loadingCategorias ? "Cargando categorías..." : "Sin categoría"}
                  </option>
                  <option value="__nueva_categoria__">+ Nueva categoría</option>

                  {categoriasPadre.map((cat) => (
                    <option
                      key={cat.id ?? cat.id_stock_categoria}
                      value={cat.id ?? cat.id_stock_categoria}
                    >
                      {categoryOptionLabel(cat)}
                    </option>
                  ))}
                </select>
              </FloatingField>
            </div>

            <div className="cmi-v2-tabsInline">
              <button type="button" className="cmi-v2-tabBtn" onClick={() => irAPanel(categoriasPanelRef)}>
                Categorías
              </button>
              <button type="button" className="cmi-v2-tabBtn" onClick={() => setCargaActiva("variantes")}>
                Variantes
              </button>
            </div>

            <div ref={categoriasPanelRef} className="cmi-priceBlock cmi-v2-softBlock">
              <div className="cmi-priceBlock__title">
                <FontAwesomeIcon icon={faLayerGroup} /> Categorías múltiples
              </div>
              <p className="cmi-priceBlock__subtitle">
                Podés asignar el producto a varias categorías o subcategorías. La seleccionada arriba queda como principal.
              </p>
              <div className="cmi-v2-checkGrid">
                {categoriasPadre.length === 0 ? (
                  <span className="cmi-v2-muted">No hay categorías cargadas.</span>
                ) : (
                  categoriasPadre.map((cat) => {
                    const id = getCategoryIdValue(cat);
                    return (
                      <label key={id} className="cmi-v2-checkItem">
                        <input
                          type="checkbox"
                          checked={(form.categorias_ids || []).includes(id)}
                          onChange={() => toggleCategoriaMultiple(id)}
                        />
                        <span>{categoryOptionLabel(cat)}</span>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="cmi-v2-childPanel">
                <div className="cmi-v2-childPanel__head">
                  <div>
                    <strong>
                      {categoriaPrincipal
                        ? `Subcategorías de ${String(categoriaPrincipal.nombre || categoriaPrincipal.nombre_mostrar || "la categoría").replace(/^—\s*/, "")}`
                        : "Subcategorías"}
                    </strong>
                    <span>
                      {categoriaPrincipal
                        ? "Creá una subcategoría nueva o seleccioná una existente para este producto."
                        : "Seleccioná una categoría principal arriba para ver o crear subcategorías."}
                    </span>
                  </div>
                </div>

                {categoriaPrincipalId ? (
                  <>
                    <div className="cmi-v2-checkGrid cmi-v2-checkGrid--compact">
                      {subcategoriasCategoriaPrincipal.length === 0 ? (
                        <span className="cmi-v2-muted">Esta categoría todavía no tiene subcategorías.</span>
                      ) : (
                        subcategoriasCategoriaPrincipal.map((cat) => {
                          const id = getCategoryIdValue(cat);
                          return (
                            <label key={id} className="cmi-v2-checkItem">
                              <input
                                type="checkbox"
                                checked={(form.categorias_ids || []).includes(id)}
                                onChange={() => toggleCategoriaMultiple(id)}
                              />
                              <span>{String(cat.nombre || cat.nombre_mostrar || "Subcategoría").replace(/^—\s*/, "").toUpperCase()}</span>
                            </label>
                          );
                        })
                      )}
                    </div>

                    <div className="cmi-v2-inlineCreate">
                      <input
                        className="cmi-input"
                        value={subCategoriaNombre}
                        onChange={(e) => setSubCategoriaNombre(toCapitalizedText(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            guardarNuevaSubcategoriaInline();
                          }
                        }}
                        placeholder={`Nueva subcategoría de ${String(categoriaPrincipal?.nombre || "esta categoría").replace(/^—\s*/, "")}`}
                        disabled={guardandoSubCategoria}
                      />
                      <button
                        type="button"
                        className="mit-btn mit-btn--ghost"
                        onClick={guardarNuevaSubcategoriaInline}
                        disabled={guardandoSubCategoria}
                      >
                        <FontAwesomeIcon icon={faPlus} />
                        {guardandoSubCategoria ? "Creando..." : "Crear subcategoría"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          <div className={`cmi-priceBlock ${productoConVariantes ? "cmi-priceBlock--disabledByVariants" : ""}`}>
            <div className="cmi-priceBlock__title">
              <FontAwesomeIcon icon={faMoneyBillTrendUp} />
              Precios principales
            </div>

            <p className="cmi-priceBlock__subtitle">
              {productoConVariantes
                ? "Este producto usa variantes: el precio general queda bloqueado para no pisar los precios de Tienda Nube. Cargá precio, stock y SKU en cada variante."
                : "Con el costo cargado podés escribir el precio final o el margen (% / $) y se calcula automáticamente."}
            </p>

            <FloatingField label="Precio de costo" error={errores.precio_costo}>
              <PriceInput
                name="precio_costo"
                value={form.precio_costo}
                onChange={(e) => handleCostoChangeLive(e.target.value)}
                onBlur={(e) => recalcularTodoConCosto(e.target.value, true)}
                onFocus={(e) =>
                  setForm((p) => ({
                    ...p,
                    precio_costo: formatMoneyFocus(e.target.value),
                  }))
                }
                onEnter={(e) =>
                  handlePriceEnter(e, () => recalcularTodoConCosto(e.currentTarget.value, true))
                }
                placeholder="0,00"
                disabled={preciosProductoBloqueados}
              />
            </FloatingField>

            <div
              style={{
                height: 1,
                background: "var(--nv-border, rgba(15,23,42,0.08))",
                margin: "0 -16px",
              }}
            />

            <PriceGroupSection title="Precio de venta">
              <div className="fl-row">
                <FloatingField label="Precio de venta *" error={errores.precio}>
                  <PriceInput
                    name="precio"
                    value={form.precio}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("price", "venta", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        precio: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("price", "venta", true))
                    }
                    disabled={preciosProductoBloqueados}
                  />
                </FloatingField>

                <FloatingField label="Margen %">
                  <PriceInput
                    name="margen_venta_porcentaje"
                    value={form.margen_venta_porcentaje}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("marginPct", "venta", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        margen_venta_porcentaje: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("marginPct", "venta", true))
                    }
                    disabled={preciosProductoBloqueados || !hasCosto}
                  />
                </FloatingField>

                <FloatingField label="Margen $">
                  <PriceInput
                    name="margen_venta_valor"
                    value={form.margen_venta_valor}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("marginValue", "venta", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        margen_venta_valor: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("marginValue", "venta", true))
                    }
                    disabled={preciosProductoBloqueados || !hasCosto}
                  />
                </FloatingField>
              </div>
            </PriceGroupSection>

            <PriceGroupSection title="Precio promocional">
              <div className="fl-row">
                <FloatingField label="Precio promocional" error={errores.precio_promo}>
                  <PriceInput
                    name="precio_promo"
                    value={form.precio_promo}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("price", "promo", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        precio_promo: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("price", "promo", true))
                    }
                    disabled={preciosProductoBloqueados}
                  />
                </FloatingField>

                <FloatingField label="Margen %">
                  <PriceInput
                    name="margen_promo_porcentaje"
                    value={form.margen_promo_porcentaje}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("marginPct", "promo", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        margen_promo_porcentaje: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("marginPct", "promo", true))
                    }
                    disabled={preciosProductoBloqueados || !hasCosto}
                  />
                </FloatingField>

                <FloatingField label="Margen $">
                  <PriceInput
                    name="margen_promo_valor"
                    value={form.margen_promo_valor}
                    onChange={handleChange}
                    onBlur={() => handlePricingBlur("marginValue", "promo", true)}
                    onFocus={(e) =>
                      setForm((p) => ({
                        ...p,
                        margen_promo_valor: formatMoneyFocus(e.target.value),
                      }))
                    }
                    onEnter={(e) =>
                      handlePriceEnter(e, () => handlePricingBlur("marginValue", "promo", true))
                    }
                    disabled={preciosProductoBloqueados || !hasCosto}
                  />
                </FloatingField>
              </div>
            </PriceGroupSection>
          </div>

          <div className={`cmi-priceBlock ${productoConVariantes ? "cmi-priceBlock--typesForVariants" : ""}`}>
            <div className="cmi-priceBlock__title">
              <FontAwesomeIcon icon={faLayerGroup} />
              {productoConVariantes ? "Tipos de precio para variantes" : "Tipos de precio adicionales"}
            </div>

            <p className="cmi-priceBlock__subtitle">
              {productoConVariantes
                ? "Agregá acá las listas de precio que necesitás. Los importes se cargan dentro de cada variante."
                : "Agregá listas o precios alternativos del producto simple."}
            </p>

            <FloatingField label="Agregar tipo de precio">
              <select
                className="cmi-input cmi-select"
                value=""
                onChange={(e) => handleTipoSelectChange(e.target.value)}
                onKeyDown={handleFieldEnter}
                disabled={loadingTiposPrecio}
              >
                <option value="">
                  {loadingTiposPrecio ? "Cargando..." : "Seleccioná un tipo para agregar..."}
                </option>

                <option value="__nuevo_tipo__">+ Nuevo tipo de precio</option>

                {tiposPrecioSafe.map((tipo) => (
                  <option
                    key={tipo.id ?? tipo.id_tipo_precio_stock}
                    value={tipo.id ?? tipo.id_tipo_precio_stock}
                  >
                    {normalizeOptionLabel(tipo.nombre, `Tipo ${tipo.id ?? tipo.id_tipo_precio_stock ?? ""}`)}
                  </option>
                ))}
              </select>
            </FloatingField>

            {form.tipos_precio_extra.map((item, idx) => (
              <div className="cmi-extraPriceCard" key={`${item.id_tipo_precio_stock}-${idx}`}>
                <div className="cmi-extraPriceCard__head">
                  <div className="cmi-extraPriceCard__title">
                    {normalizeOptionLabel(item.tipo_nombre, `Tipo ${idx + 1}`)}
                  </div>

                  <button
                    type="button"
                    className="mit-btn mit-btn--ghost"
                    onClick={() => quitarTipoPrecio(idx)}
                    style={{
                      padding: "5px 11px",
                      fontSize: 12,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: "#ef4444",
                      borderColor: "rgba(239,68,68,0.25)",
                    }}
                  >
                    <FontAwesomeIcon icon={faTrashCan} style={{ fontSize: 11 }} />
                    Quitar
                  </button>
                </div>

                <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                  <FloatingField label="Precio">
                    <PriceInput
                      name={`extra_precio_${idx}`}
                      value={item.precio}
                      onChange={(e) => handleExtraPriceChange(idx, "precio", e.target.value)}
                      disabled={preciosProductoBloqueados}
                      onBlur={() => handleExtraPriceBlur(idx, "price", true)}
                      onEnter={(e) =>
                        handlePriceEnter(e, () => handleExtraPriceBlur(idx, "price", true))
                      }
                    />
                  </FloatingField>

                  <FloatingField label="Margen %">
                    <PriceInput
                      name={`extra_margen_pct_${idx}`}
                      value={item.margen_porcentaje}
                      onChange={(e) => handleExtraPriceChange(idx, "margen_porcentaje", e.target.value)}
                      onBlur={() => handleExtraPriceBlur(idx, "marginPct", true)}
                      onEnter={(e) =>
                        handlePriceEnter(e, () => handleExtraPriceBlur(idx, "marginPct", true))
                      }
                      disabled={preciosProductoBloqueados || !hasCosto}
                    />
                  </FloatingField>

                  <FloatingField label="Margen $">
                    <PriceInput
                      name={`extra_margen_val_${idx}`}
                      value={item.margen_valor}
                      onChange={(e) => handleExtraPriceChange(idx, "margen_valor", e.target.value)}
                      onBlur={() => handleExtraPriceBlur(idx, "marginValue", true)}
                      onEnter={(e) =>
                        handlePriceEnter(e, () => handleExtraPriceBlur(idx, "marginValue", true))
                      }
                      disabled={preciosProductoBloqueados || !hasCosto}
                    />
                  </FloatingField>
                </div>
              </div>
            ))}

            {form.tipos_precio_extra.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "12px 0 4px",
                  fontSize: 12,
                  color: "var(--nv-muted, #5A6A7E)",
                  fontStyle: "italic",
                }}
              >
                No hay tipos de precio adicionales. Seleccioná uno arriba para agregar.
              </div>
            )}
          </div>


          <div ref={variantesPanelRef} className="cmi-priceBlock cmi-v2-softBlock cmi-v2-variantPanelOnly">
            <div className="cmi-extraPriceCard__head">
              <div className="cmi-priceBlock__title">
                <FontAwesomeIcon icon={faCubesStacked} /> Variantes del producto
              </div>
              <label className="cmi-v2-switch">
                <input
                  type="checkbox"
                  checked={!!form.tiene_variantes}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setForm((p) => ({
                      ...p,
                      tiene_variantes: checked,
                      variantes: checked ? syncVariantsExtraPrices(p.variantes, p.tipos_precio_extra) : p.variantes,
                    }));
                  }}
                />
                Tiene variantes
              </label>
            </div>

            <p className="cmi-priceBlock__subtitle">
              Usalo para talles, colores, medidas, materiales o presentaciones. Si está activo, Tienda Nube toma SKU, stock y precios desde cada variante.
            </p>

            {errores.variantes ? <div className="cmi-errorText">{errores.variantes}</div> : null}

            {form.tiene_variantes ? (
              <div className="cmi-v2-variantModeNotice">
                Producto con variantes: el precio general y el stock general quedan bloqueados. Cargá nombre, SKU, stock y precio de venta en cada variante.
              </div>
            ) : null}

            {form.tiene_variantes ? (
              <div className="cmi-v2-variantsWrap">
                {(form.variantes || []).map((variant, variantIdx) => (
                  <div className="cmi-extraPriceCard cmi-v2-variantCard" key={`variant-${variantIdx}`}>
                    <div className="cmi-extraPriceCard__head">
                      <div className="cmi-extraPriceCard__title">Variante #{variantIdx + 1}</div>
                      <button
                        type="button"
                        className="mit-btn mit-btn--ghost"
                        onClick={() => removeVariant(variantIdx)}
                        style={{ padding: "5px 11px", fontSize: 12, color: "#ef4444", borderColor: "rgba(239,68,68,0.25)" }}
                      >
                        <FontAwesomeIcon icon={faTrashCan} style={{ fontSize: 11 }} /> Quitar
                      </button>
                    </div>

                    <div className="fl-row" style={{ gridTemplateColumns: "1.3fr 1fr .75fr" }}>
                      <FloatingField label="Nombre variante *">
                        <input
                          className="cmi-input"
                          value={variant.nombre_variante}
                          onChange={(e) => updateVariant(variantIdx, { nombre_variante: toCapitalizedText(e.target.value) })}
                          placeholder="Ej: TALLE M / NEGRO"
                        />
                      </FloatingField>
                      <FloatingField label="SKU variante *">
                        <input
                          className="cmi-input"
                          value={variant.sku}
                          onChange={(e) => updateVariant(variantIdx, { sku: toUpperCaseValue(e.target.value) })}
                          placeholder="SKU"
                          style={{ textTransform: "uppercase" }}
                        />
                      </FloatingField>
                      <FloatingField label="Stock *">
                        <input
                          className="cmi-input"
                          value={variant.stock}
                          onChange={(e) => updateVariant(variantIdx, { stock: onlyNumbers(e.target.value) })}
                          inputMode="numeric"
                        />
                      </FloatingField>
                    </div>

                    {categoriasSafe.length > 0 ? (
                      <div className="cmi-v2-variantCategories">
                        <div className="cmi-v2-variantCategories__head">
                          <strong>Categorías específicas</strong>
                          <span>Opcional. Si no marcás ninguna, hereda las categorías del producto.</span>
                        </div>
                        <div className="cmi-v2-checkGrid cmi-v2-checkGrid--compact">
                          {categoriasSafe.map((cat) => {
                            const id = getCategoryIdValue(cat);
                            const checked = (variant.categorias_ids || []).map(normalizeIdValue).includes(id);
                            return (
                              <label key={`variant-cat-${variantIdx}-${id}`} className="cmi-v2-checkItem">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleVariantCategoria(variantIdx, id)}
                                />
                                <span>{categoryOptionLabel(cat)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="fl-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                      <FloatingField label="Precio de costo">
                        <PriceInput value={variant.precio_costo} onChange={(e) => updateVariant(variantIdx, { precio_costo: normalizeMoneyInput(e.target.value) })} />
                      </FloatingField>
                      <FloatingField label="Precio de venta *">
                        <PriceInput value={variant.precio} onChange={(e) => updateVariant(variantIdx, { precio: normalizeMoneyInput(e.target.value) })} />
                      </FloatingField>
                      <FloatingField label="Precio promocional">
                        <PriceInput value={variant.precio_promo} onChange={(e) => updateVariant(variantIdx, { precio_promo: normalizeMoneyInput(e.target.value) })} />
                      </FloatingField>
                    </div>

                    {(variant.tipos_precio_extra || []).length > 0 ? (
                      <div className="fl-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                        {(variant.tipos_precio_extra || []).map((tipoItem, tipoIdx) => {
                          const precioProducto = (form.tipos_precio_extra || []).find(
                            (item) => String(item.id_tipo_precio_stock) === String(tipoItem.id_tipo_precio_stock)
                          )?.precio;

                          return (
                            <FloatingField
                              label={`Precio ${normalizeOptionLabel(tipoItem.tipo_nombre || `tipo ${tipoIdx + 1}`).toLowerCase()}`}
                              key={`variant-extra-${variantIdx}-${tipoItem.id_tipo_precio_stock}-${tipoIdx}`}
                            >
                              <PriceInput
                                name={`variant_extra_precio_${variantIdx}_${tipoIdx}`}
                                value={tipoItem.precio}
                                placeholder={productoConVariantes ? "Cargar en esta variante" : precioProducto ? `Hereda ${formatPriceDisplay(precioProducto)}` : "Opcional"}
                                onChange={(e) => {
                                  const value = normalizeMoneyInput(e.target.value);
                                  setForm((p) => ({
                                    ...p,
                                    variantes: (p.variantes || []).map((v, i) => {
                                      if (i !== variantIdx) return v;
                                      return {
                                        ...v,
                                        tipos_precio_extra: (v.tipos_precio_extra || []).map((item, j) =>
                                          j === tipoIdx ? { ...item, precio: value } : item
                                        ),
                                      };
                                    }),
                                  }));
                                }}
                              />
                            </FloatingField>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="cmi-v2-attrsWrap">
                      {(variant.atributos || []).map((attr, attrIdx) => (
                        <div className="fl-row" style={{ gridTemplateColumns: "1fr 1fr" }} key={`attr-${variantIdx}-${attrIdx}`}>
                          <FloatingField label="Atributo">
                            <input
                              className="cmi-input"
                              value={attr.atributo}
                              onChange={(e) => updateVariantAttr(variantIdx, attrIdx, { atributo: toCapitalizedText(e.target.value) })}
                              placeholder="TALLE / COLOR / MEDIDA"
                            />
                          </FloatingField>
                          <FloatingField label="Valor">
                            <input
                              className="cmi-input"
                              value={attr.valor}
                              onChange={(e) => updateVariantAttr(variantIdx, attrIdx, { valor: toCapitalizedText(e.target.value) })}
                              placeholder="M / NEGRO / 80X200"
                            />
                          </FloatingField>
                        </div>
                      ))}
                      <button type="button" className="mit-btn mit-btn--ghost" onClick={() => addVariantAttr(variantIdx)}>
                        <FontAwesomeIcon icon={faPlus} /> Agregar atributo
                      </button>
                    </div>
                  </div>
                ))}

                <button type="button" className="mit-btn mit-btn--ghost" onClick={addVariant}>
                  <FontAwesomeIcon icon={faPlus} /> Agregar variante
                </button>
              </div>
            ) : (
              <div className="cmi-v2-muted">Producto simple: se usa el stock inicial cargado arriba.</div>
            )}
          </div>

          <FloatingField label="Descripción" icon={faAlignLeft}>
            <textarea
              name="descripcion"
              value={form.descripcion}
              onChange={handleChange}
              onKeyDown={handleFieldEnter}
              className="cmi-input cmi-textarea"
              placeholder="Breve descripción del producto (opcional)"
              style={{ textTransform: "none" }}
            />
          </FloatingField>

          <div className="cmi-uploadBox">
            <div className="cmi-uploadBox__title">
              <FontAwesomeIcon icon={faPaperclip} />
              Imagen del producto
            </div>

            <input
              ref={inputImagenRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,image/*"
              hidden
              onChange={(e) => tomarImagen(e.target.files?.[0])}
            />

            {!imagenFile ? (
              <button
                type="button"
                className="mit-btn mit-btn--ghost"
                onClick={() => inputImagenRef.current?.click()}
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
                    <div className="cmi-fileResume__name">{imagenNombre}</div>
                    <TipoBadge tipo="imagen" />
                  </div>
                </div>

                <div className="cmi-fileActions">
                  <button
                    type="button"
                    className="mit-btn mit-btn--ghost"
                    onClick={() =>
                      abrirPreviewLocal({
                        file: imagenFile,
                        title: "Imagen del producto",
                      })
                    }
                    style={{ padding: "6px 10px", fontSize: 13 }}
                    title="Ver imagen"
                  >
                    <FontAwesomeIcon icon={faEye} />
                  </button>

                  <button
                    type="button"
                    className="mit-btn mit-btn--ghost"
                    onClick={limpiarImagen}
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
          </div>
        </div>
      </div>

      <div className="cmi-footer">
        <span className="mi-card__hint cmi-footer__hint">
          {barcodeProductoGuardado
            ? "Los códigos ya están disponibles. Finalizá cuando termines de imprimir o escanear."
            : cargaActiva === "codigo_barra"
              ? "Guardá primero para obtener los IDs definitivos y generar los códigos."
              : "Completá los datos del producto y guardá."}
        </span>

        <div className="cmi-footer__btns">
          {!barcodeProductoGuardado && (
            <button
              type="button"
              className="mit-btn mit-btn--ghost"
              onClick={() => !guardando && onRequestClose?.()}
              disabled={guardando}
            >
              Cancelar
            </button>
          )}

          <button
            type="button"
            className="mit-btn mit-btn--solid"
            onClick={barcodeProductoGuardado ? handleFinalizarCodigos : handleGuardar}
            disabled={guardando}
          >
            {!guardando && <FontAwesomeIcon icon={barcodeProductoGuardado ? faCheck : faFloppyDisk} style={{ fontSize: 13 }} />}
            {guardando
              ? "Guardando..."
              : barcodeProductoGuardado
                ? "Finalizar"
                : cargaActiva === "codigo_barra"
                  ? "Guardar y generar códigos"
                  : "Guardar producto"}
          </button>
        </div>
      </div>

      <ModalVerComprobante
        open={previewOpen}
        url={previewUrl}
        mime={previewMime}
        fileName={previewFileName}
        title={previewTitle}
        onClose={cerrarPreview}
      />

      <MiniCreateModal
        open={miniCategoriaOpen}
        title="Nueva categoría"
        value={miniCategoriaNombre}
        loading={guardandoMiniCategoria}
        onChange={setMiniCategoriaNombre}
        onCancel={() => {
          setMiniCategoriaOpen(false);
          setMiniCategoriaNombre("");
          setMiniCategoriaPadreId("");
        }}
        onSave={guardarNuevaCategoria}
      >
        <FloatingField label="Categoría padre">
          <select
            className="cmi-input cmi-select"
            value={miniCategoriaPadreId}
            onChange={(e) => setMiniCategoriaPadreId(e.target.value)}
          >
            <option value="">Sin padre / categoría principal</option>
            {categoriasPadre.map((cat) => (
              <option key={cat.id ?? cat.id_stock_categoria} value={cat.id ?? cat.id_stock_categoria}>
                {categoryOptionLabel(cat)}
              </option>
            ))}
          </select>
        </FloatingField>
      </MiniCreateModal>

      <MiniCreateModal
        open={miniTipoOpen}
        title="Nuevo tipo de precio"
        value={miniTipoNombre}
        loading={guardandoMiniTipo}
        onChange={setMiniTipoNombre}
        onCancel={() => {
          setMiniTipoOpen(false);
          setMiniTipoNombre("");
        }}
        onSave={guardarNuevoTipo}
      />
    </div>
  );
}

/* ── Helper visual: título de sección ── */
function SectionTitle({ label }) {
  return (
    <div className="cmi-priceBlock__title">
      <span
        style={{
          display: "inline-block",
          width: 20,
          height: 2.5,
          borderRadius: 999,
          background: "var(--nv-action, #0055BB)",
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  );
}
