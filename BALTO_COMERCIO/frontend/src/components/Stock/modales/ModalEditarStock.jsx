import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "./ModalEditarStock.css";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante";
import StockBarcodePanel from "./StockBarcodePanel";
import { isTopStockModal } from "./modalStackUtils";
import {
  faBoxOpen,
  faTag,
  faDollarSign,
  faAlignLeft,
  faTrashCan,
  faRefresh,
  faXmark,
  faFloppyDisk,
  faPaperclip,
  faArrowUpFromBracket,
  faBarcode,
  faCubesStacked,
  faEye,
  faPercent,
  faMoneyBillTrendUp,
  faLayerGroup,
  faTriangleExclamation,
  faImage,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import {
  API_URL,
  actualizarProductoStock,
  crearCategoriaStock,
  crearTipoPrecioStock,
  getUsuarioAuditData,
  listarCategoriasStock,
  listarTiposPrecioStock,
  obtenerProductoStock,
  stockBarcodeGet,
  withSessionKey,
} from "../api/stockApi";

function getProductoImageUrlByArchivoId(archivoId) {
  const id = Number(archivoId || 0);
  if (!id) return "";

  const params = new URLSearchParams({
    action: "stock_producto_imagen_ver",
    id_archivo: String(id),
  });

  return withSessionKey(`${API_URL}?${params.toString()}`);
}

function inferImageMimeFromUrl(url = "") {
  const s = String(url || "").toLowerCase().split("?")[0].split("#")[0];

  if (s.endsWith(".png")) return "image/png";
  if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
  if (s.endsWith(".webp")) return "image/webp";
  if (s.endsWith(".gif")) return "image/gif";

  return "image/jpeg";
}

function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

function parseNumberFromInput(value) {
  if (value === null || value === undefined || value === "") return null;

  const normalized = String(value).replace(/\./g, "").replace(",", ".");
  const num = parseFloat(normalized);

  return Number.isNaN(num) ? null : num;
}

function hasMoneyValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isValidMoneyValue(value) {
  if (!hasMoneyValue(value)) return false;
  const parsed = parseNumberFromInput(value);
  return parsed !== null && parsed >= 0;
}

function formatNumberForDisplay(value) {
  if (value === null || value === undefined || value === "") return "";

  const num =
    typeof value === "number"
      ? value
      : parseFloat(String(value).replace(",", "."));

  if (Number.isNaN(num)) return "";
  if (Number.isInteger(num)) return num.toString();

  return num.toString().replace(".", ",");
}

function formatNumberWithCents(value) {
  if (value === null || value === undefined || value === "") return "";

  const num = parseNumberFromInput(value);
  if (num === null) return "";

  return num.toFixed(2).replace(".", ",");
}

function formatNumberForApi(value) {
  if (value === null || value === undefined || value === "") return null;

  const num = typeof value === "number" ? value : parseNumberFromInput(value);
  if (num === null) return null;

  return Number(num.toFixed(2));
}

function normalizeMoneyInput(raw = "") {
  let value = String(raw).replace(/\./g, ",").replace(/[^\d,]/g, "");
  const firstComma = value.indexOf(",");
  if (firstComma !== -1) {
    value = value.slice(0, firstComma + 1) + value.slice(firstComma + 1).replace(/,/g, "");
  }
  const parts = value.split(",");
  if (parts.length > 1) {
    parts[1] = parts[1].slice(0, 2);
    value = `${parts[0]},${parts[1]}`;
  }
  return value;
}

function formatPriceDisplay(value) {
  const num = parseNumberFromInput(value);
  if (num === null) return "";

  return `$ ${num.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPricingResult(result, withCents = false) {
  const formatter = withCents ? formatNumberWithCents : formatNumberForDisplay;

  return {
    price: formatter(result.price),
    marginPct: formatter(result.marginPct),
    marginValue: formatter(result.marginValue),
  };
}

function recalculatePricingGroup({
  cost,
  price,
  marginPct,
  marginValue,
  source,
}) {
  const c = cost !== null && cost !== "" ? parseNumberFromInput(cost) : null;
  let p = price !== null && price !== "" ? parseNumberFromInput(price) : null;
  let pct =
    marginPct !== null && marginPct !== ""
      ? parseNumberFromInput(marginPct)
      : null;
  let val =
    marginValue !== null && marginValue !== ""
      ? parseNumberFromInput(marginValue)
      : null;

  if (!source) {
    return {
      price: formatNumberForDisplay(price),
      marginPct: formatNumberForDisplay(marginPct),
      marginValue: formatNumberForDisplay(marginValue),
    };
  }

  if (source === "price") {
    if (p === null) {
      return {
        price: "",
        marginPct: formatNumberForDisplay(marginPct),
        marginValue: formatNumberForDisplay(marginValue),
      };
    }

    if (c !== null) {
      val = p - c;
      pct = c !== 0 ? (val / c) * 100 : 0;
    }

    return {
      price: formatNumberForDisplay(p),
      marginPct:
        c !== null ? formatNumberForDisplay(pct) : formatNumberForDisplay(marginPct),
      marginValue:
        c !== null ? formatNumberForDisplay(val) : formatNumberForDisplay(marginValue),
    };
  }

  if (source === "marginPct") {
    if (c === null || pct === null) {
      return {
        price: formatNumberForDisplay(price),
        marginPct: formatNumberForDisplay(marginPct),
        marginValue: formatNumberForDisplay(marginValue),
      };
    }

    val = (c * pct) / 100;
    p = c + val;

    return {
      price: formatNumberForDisplay(p),
      marginPct: formatNumberForDisplay(pct),
      marginValue: formatNumberForDisplay(val),
    };
  }

  if (source === "marginValue") {
    if (c === null || val === null) {
      return {
        price: formatNumberForDisplay(price),
        marginPct: formatNumberForDisplay(marginPct),
        marginValue: formatNumberForDisplay(marginValue),
      };
    }

    p = c + val;
    pct = c !== 0 ? (val / c) * 100 : 0;

    return {
      price: formatNumberForDisplay(p),
      marginPct: formatNumberForDisplay(pct),
      marginValue: formatNumberForDisplay(val),
    };
  }

  return {
    price: formatNumberForDisplay(price),
    marginPct: formatNumberForDisplay(marginPct),
    marginValue: formatNumberForDisplay(marginValue),
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function hydratePricingGroupValues({ cost, price, marginPct, marginValue }) {
  const hasPrice = hasValue(price);
  const hasPct = hasValue(marginPct);
  const hasVal = hasValue(marginValue);

  if (hasPrice && hasPct && hasVal) {
    return {
      price: formatNumberForDisplay(price),
      marginPct: formatNumberForDisplay(marginPct),
      marginValue: formatNumberForDisplay(marginValue),
    };
  }

  const source = hasPrice
    ? "price"
    : hasPct
      ? "marginPct"
      : hasVal
        ? "marginValue"
        : null;

  if (!source) {
    return { price: "", marginPct: "", marginValue: "" };
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
    precio_costo: formatNumberForDisplay(sourceForm.precio_costo),
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
  const next = { ...prev, [fieldName]: rawValue };

  if (fieldName === "precio_costo") {
    return hydratePricingFormValues(next);
  }

  if (
    ["precio", "margen_venta_porcentaje", "margen_venta_valor"].includes(
      fieldName
    )
  ) {
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

  if (
    ["precio_promo", "margen_promo_porcentaje", "margen_promo_valor"].includes(
      fieldName
    )
  ) {
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

function emptyExtraPriceRow(tipo = null) {
  return {
    id_tipo_precio_stock: String(tipo?.id_tipo_precio_stock ?? tipo?.id ?? ""),
    tipo_nombre: normalizeOptionLabel(tipo, ""),
    precio: "",
    margen_porcentaje: "",
    margen_valor: "",
  };
}

function findTipoPrecioByName(preciosPorTipo, names = []) {
  const wanted = names.map((n) => String(n || "").trim().toUpperCase());

  return (Array.isArray(preciosPorTipo) ? preciosPorTipo : []).find((item) =>
    wanted.includes(String(item?.tipo_nombre || "").trim().toUpperCase())
  );
}

function normalizarProducto(data) {
  const p = data?.producto || data?.data?.producto || data?.data || data || {};
  const variantesProducto = Array.isArray(p.variantes) ? p.variantes : [];
  const cantidadVariantesInformada = Number(
    p.cantidad_variantes_total ?? p.cantidad_variantes ?? 0
  );
  // El registro real de variantes manda sobre el flag legacy. Un webhook podía dejar
  // `tiene_variantes=0` aunque las filas siguieran existiendo; el editor entonces las
  // recibía pero las ocultaba y ofrecía guardar el producto como simple.
  const tieneVariantesReales =
    Number(p.tiene_variantes || 0) === 1 ||
    cantidadVariantesInformada > 0 ||
    variantesProducto.length > 0;
  const preciosPorTipo = Array.isArray(p.precios_por_tipo) && p.precios_por_tipo.length > 0
    ? p.precios_por_tipo
    : Array.isArray(p.precios)
      ? p.precios
      : [];

  const costoItem = findTipoPrecioByName(preciosPorTipo, ["PRECIO DE COSTO", "COSTO"]);
  const ventaItem = findTipoPrecioByName(preciosPorTipo, ["PRECIO DE VENTA", "VENTA"]);
  const promoItem = findTipoPrecioByName(preciosPorTipo, [
    "PRECIO PROMOCIONAL",
    "PRECIO PROMO",
    "PROMOCIONAL",
    "PROMO",
  ]);

  const tiposExtra = preciosPorTipo
    .filter((item) => {
      const nombre = String(item?.tipo_nombre || "").trim().toUpperCase();

      return ![
        "PRECIO DE COSTO",
        "COSTO",
        "PRECIO DE VENTA",
        "VENTA",
        "PRECIO PROMOCIONAL",
        "PRECIO PROMO",
        "PROMOCIONAL",
        "PROMO",
      ].includes(nombre);
    })
    .map((item) => ({
      id_tipo_precio_stock: String(item?.id_tipo_precio_stock ?? item?.id ?? ""),
      tipo_nombre: normalizeOptionLabel(item, item?.tipo_nombre ?? ""),
      precio: formatNumberForDisplay(item?.precio ?? item?.monto ?? ""),
      margen_porcentaje: formatNumberForDisplay(item?.margen_porcentaje ?? ""),
      margen_valor: formatNumberForDisplay(item?.margen_valor ?? ""),
    }));

  return {
    id: p.id ?? p.id_stock_producto ?? "",
    nombre: toUpperCaseValue(p.nombre ?? ""),
    sku: toUpperCaseValue(p.sku ?? ""),
    precio_costo: formatNumberForDisplay(
      costoItem?.precio ?? costoItem?.monto ?? p.precio_costo ?? ""
    ),
    precio: formatNumberForDisplay(
      ventaItem?.precio ?? ventaItem?.monto ?? p.precio ?? ""
    ),
    margen_venta_porcentaje: formatNumberForDisplay(
      ventaItem?.margen_porcentaje ?? ""
    ),
    margen_venta_valor: formatNumberForDisplay(ventaItem?.margen_valor ?? ""),
    precio_promo: formatNumberForDisplay(
      promoItem?.precio ?? promoItem?.monto ?? p.precio_promo ?? ""
    ),
    margen_promo_porcentaje: formatNumberForDisplay(
      promoItem?.margen_porcentaje ?? ""
    ),
    margen_promo_valor: formatNumberForDisplay(promoItem?.margen_valor ?? ""),
    stock:
      p.stock !== null && p.stock !== undefined && p.stock !== ""
        ? String(p.stock)
        : "",
    descripcion: toUpperCaseValue(p.descripcion ?? ""),
    imagen_url: p.imagen_url ?? p.imagen ?? "",
    imagen_archivo_id: p.imagen_archivo_id ? Number(p.imagen_archivo_id) : null,
    id_categoria_stock: normalizeCategoriaId(p.id_categoria_stock ?? p.id_stock_categoria ?? p.id_categoria),
    categorias_ids: Array.isArray(p.categorias)
      ? p.categorias
          .map((cat) => normalizeCategoriaId(cat.id_stock_categoria ?? cat.id ?? cat.id_categoria))
          .filter(Boolean)
      : [],
    tiene_variantes: tieneVariantesReales,
    variantes: variantesProducto.length > 0
      ? variantesProducto.map((variant) => {
          const preciosVariante = mapPreciosByTipo(variant.precios || []);
          return {
            id_stock_variante: Number(variant.id_stock_variante || 0),
            activo: Number(variant.activo ?? 1) === 1,
            nombre_variante: toUpperCaseValue(variant.nombre_variante || variant.nombre || ""),
            sku: toUpperCaseValue(variant.sku || ""),
            stock: variant.stock !== null && variant.stock !== undefined ? String(variant.stock) : "0",
            categorias_ids: Array.isArray(variant.categorias)
              ? variant.categorias
                  .map((cat) => normalizeCategoriaId(cat.id_stock_categoria ?? cat.id ?? cat.id_categoria))
                  .filter(Boolean)
              : [],
            precio_costo: formatNumberForDisplay(preciosVariante[1]?.precio ?? preciosVariante[1]?.monto ?? ""),
            precio: formatNumberForDisplay(preciosVariante[2]?.precio ?? preciosVariante[2]?.monto ?? ""),
            precio_promo: formatNumberForDisplay(preciosVariante[3]?.precio ?? preciosVariante[3]?.monto ?? ""),
            precio_costo_heredado: !!(variant.precio_costo_heredado || preciosVariante[1]?.heredado || preciosVariante[1]?.origen_precio === "producto"),
            precio_heredado: !!(variant.precio_heredado || preciosVariante[2]?.heredado || preciosVariante[2]?.origen_precio === "producto"),
            precio_promo_heredado: !!(variant.precio_promo_heredado || preciosVariante[3]?.heredado || preciosVariante[3]?.origen_precio === "producto"),
            tipos_precio_extra: tiposExtra.map((tipo) => {
              const idTipo = Number(tipo.id_tipo_precio_stock || 0);
              const precioVariante = preciosVariante[idTipo] || {};
              return normalizeVariantExtraPriceRow(tipo, {
                ...tipo,
                precio: formatNumberForDisplay(precioVariante?.precio ?? precioVariante?.monto ?? ""),
                margen_porcentaje: formatNumberForDisplay(precioVariante?.margen_porcentaje ?? ""),
                margen_valor: formatNumberForDisplay(precioVariante?.margen_valor ?? ""),
                precio_heredado: !!(precioVariante?.precio_heredado || precioVariante?.heredado || precioVariante?.origen_precio === "producto"),
                heredado: !!(precioVariante?.precio_heredado || precioVariante?.heredado || precioVariante?.origen_precio === "producto"),
                origen_precio: precioVariante?.origen_precio ?? "",
              });
            }),
            atributos: Array.isArray(variant.atributos) && variant.atributos.length > 0
              ? variant.atributos.map((attr) => ({
                  atributo: toUpperCaseValue(attr.atributo || attr.nombre || attr.nombre_atributo || ""),
                  valor: toUpperCaseValue(attr.valor || attr.nombre_valor || ""),
                }))
              : [emptyVariantAttr()],
          };
        })
      : [emptyVariantRow()],
    tipos_precio_extra:
      Array.isArray(p.tipos_precio_extra) && p.tipos_precio_extra.length > 0
        ? p.tipos_precio_extra.map((item) => ({
            id_tipo_precio_stock: String(
              item?.id_tipo_precio_stock ?? item?.id ?? ""
            ),
            tipo_nombre: normalizeOptionLabel(item, item?.tipo_nombre ?? ""),
            precio: formatNumberForDisplay(item?.precio ?? item?.monto ?? ""),
            margen_porcentaje: formatNumberForDisplay(
              item?.margen_porcentaje ?? ""
            ),
            margen_valor: formatNumberForDisplay(item?.margen_valor ?? ""),
          }))
        : tiposExtra,
  };
}

function FloatingField({ label, icon, error, children, style }) {
  return (
    <div
      className="cmi-floatingField cmi-floatingField--active"
      style={style}
      data-error={error ? "true" : undefined}
    >
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
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.(e);
      return;
    }

    onKeyDown?.(e);
  };

  return (
    <input
      name={name}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={handleKeyDown}
      className={className || "cmi-input"}
      placeholder={placeholder || "0,00"}
      disabled={disabled}
      inputMode="decimal"
    />
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

    if (!loading) {
      onSave?.();
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      data-stock-modal-overlay="true"
      className="cmi-miniOverlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onCancel?.();
        }
      }}
    >
      <div className="cmi-miniModal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmi-miniModal__head">{title}</div>

        <div className="cmi-miniModal__body">
          <FloatingField label="Nombre *">
            <input
              className="cmi-input"
              value={value}
              onChange={(e) => onChange(toUpperCaseValue(e.target.value))}
              onKeyDown={handleMiniEnter}
              placeholder="ESCRIBÍ EL NOMBRE"
              style={{ textTransform: "uppercase" }}
              autoFocus
            />
          </FloatingField>

          {children}

          <div className="cmi-miniModal__actions">
            <button
              type="button"
              className="mit-btn mit-btn--ghost"
              onClick={onCancel}
              disabled={loading}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={onSave}
              disabled={loading}
            >
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
    precio_heredado: !!(existing?.precio_heredado || existing?.heredado || existing?.origen_precio === "producto"),
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
    id_stock_variante: 0,
    activo: true,
    nombre_variante: "",
    sku: "",
    stock: "0",
    categorias_ids: [],
    precio_costo: "",
    precio: "",
    precio_promo: "",
    precio_costo_heredado: false,
    precio_heredado: false,
    precio_promo_heredado: false,
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

function mapPreciosByTipo(precios = []) {
  const map = {};
  (Array.isArray(precios) ? precios : []).forEach((precio) => {
    const id = Number(precio?.id_tipo_precio_stock || precio?.id || 0);
    if (id > 0) map[id] = precio;
  });
  return map;
}

function variantHasContent(variant = {}) {
  return (
    String(variant.nombre_variante || variant.sku || "").trim() ||
    (Array.isArray(variant.atributos) ? variant.atributos : []).some((attr) =>
      String(attr.atributo || attr.valor || "").trim()
    )
  );
}

function syncGenericVariantAttributeWithName(variant = {}, rawName = "") {
  const nombre = toUpperCaseValue(String(rawName || "").trim());
  const atributos = Array.isArray(variant.atributos) ? variant.atributos : [];

  // En Tienda Nube el "nombre" visible de una variante es en realidad el valor
  // de su combinación (por ejemplo VARIANTE = DDDD). Si Balto cambia solo el
  // nombre y deja ese valor viejo, TN conserva el nombre anterior y el webhook
  // puede interpretar la respuesta como otra variante. Para la variante genérica
  // mantenemos ambos campos siempre alineados.
  if (atributos.length === 0) {
    return nombre ? [{ atributo: "VARIANTE", valor: nombre }] : atributos;
  }

  if (atributos.length === 1) {
    const atributo = toUpperCaseValue(String(atributos[0]?.atributo || "").trim());
    if (atributo === "VARIANTE") {
      return [{ ...atributos[0], atributo: "VARIANTE", valor: nombre }];
    }
  }

  return atributos;
}

function buildVariantPricePayload(variant) {
  const precios = [];

  const pushBasePrice = (field, idTipo, nombre, inheritedFlag) => {
    if (variant?.[inheritedFlag]) return;
    if (variant?.[field] === "") return;
    precios.push({
      id_tipo_precio_stock: idTipo,
      nombre,
      tipo_nombre: nombre,
      precio: formatNumberForApi(variant[field]),
    });
  };

  pushBasePrice("precio_costo", 1, "COSTO", "precio_costo_heredado");
  pushBasePrice("precio", 2, "VENTA", "precio_heredado");
  pushBasePrice("precio_promo", 3, "PROMO", "precio_promo_heredado");

  (Array.isArray(variant.tipos_precio_extra) ? variant.tipos_precio_extra : []).forEach((item) => {
    const id = Number(item.id_tipo_precio_stock || 0);
    if (!id || isBaseTipoPrecioId(id) || item.precio_heredado) return;

    const precio = formatNumberForApi(item.precio);
    if (precio === "" || precio === null || precio === undefined) return;

    precios.push({
      id_tipo_precio_stock: id,
      nombre: toUpperCaseValue(item.tipo_nombre),
      tipo_nombre: toUpperCaseValue(item.tipo_nombre),
      precio,
      margen_porcentaje: formatNumberForApi(item.margen_porcentaje),
      margen_valor: formatNumberForApi(item.margen_valor),
    });
  });

  return precios.filter((precio) => precio.precio !== null && precio.precio !== undefined && precio.precio !== "");
}

function getPayloadPrice(precios = [], idTipo) {
  const item = (Array.isArray(precios) ? precios : []).find(
    (precio) => Number(precio?.id_tipo_precio_stock || 0) === Number(idTipo)
  );

  return item?.precio ?? item?.monto ?? null;
}

function buildOptimisticVariant(savedVariant = {}, variantPayload = {}) {
  const id = Number(
    savedVariant?.id ??
      savedVariant?.id_stock_variante ??
      variantPayload?.id_stock_variante ??
      0
  );

  return {
    ...savedVariant,
    ...variantPayload,
    ...(id > 0 ? { id, id_stock_variante: id } : {}),
    activo: Number(variantPayload?.activo ?? savedVariant?.activo ?? 1),
    // La respuesta local ya incluye el precio final (propio o heredado). Usarla
    // primero evita que una variante heredada quede en null hasta recargar la página.
    precio_costo:
      savedVariant?.precio_costo ?? getPayloadPrice(variantPayload?.precios, 1),
    precio: savedVariant?.precio ?? getPayloadPrice(variantPayload?.precios, 2),
    precio_promo:
      savedVariant?.precio_promo ?? getPayloadPrice(variantPayload?.precios, 3),
  };
}

function buildOptimisticProduct(savedProduct, sourceForm, variantesPayload = []) {
  if (!savedProduct || typeof savedProduct !== "object") return savedProduct;

  const id = Number(
    savedProduct?.id ?? savedProduct?.id_stock_producto ?? sourceForm?.id ?? 0
  );
  if (!id) return savedProduct;

  const usaVariantes = !!sourceForm?.tiene_variantes;
  const variantesGuardadas = Array.isArray(savedProduct?.variantes) ? savedProduct.variantes : [];
  const variantesPorId = new Map(
    variantesGuardadas.map((variant) => [
      Number(variant?.id ?? variant?.id_stock_variante ?? 0),
      variant,
    ])
  );

  const variantes = usaVariantes
    ? variantesPayload.map((variant, index) => {
        const idVariante = Number(variant?.id_stock_variante || 0);
        const guardada =
          (idVariante > 0 ? variantesPorId.get(idVariante) : null) ||
          variantesGuardadas[index] ||
          {};
        return buildOptimisticVariant(guardada, variant);
      })
    : [];
  const primeraVarianteActiva = variantes.find(
    (variant) => Number(variant?.activo ?? 1) === 1
  );

  return {
    ...savedProduct,
    id,
    id_stock_producto: id,
    nombre: toUpperCaseValue(String(sourceForm?.nombre || "").trim()),
    sku: toUpperCaseValue(String(sourceForm?.sku || "").trim()),
    descripcion: toUpperCaseValue(String(sourceForm?.descripcion || "").trim()),
    stock: usaVariantes
      ? variantes.reduce((total, variant) => total + Number(variant?.stock || 0), 0)
      : Number(sourceForm?.stock || 0),
    // La fila general usa el precio resumen de la primera variante activa. Antes se
    // forzaba a null y sólo reaparecía cuando una recarga/webhook reconstruía la fila.
    precio_costo: usaVariantes
      ? primeraVarianteActiva?.precio_costo ?? savedProduct?.precio_costo ?? null
      : formatNumberForApi(sourceForm?.precio_costo),
    precio: usaVariantes
      ? primeraVarianteActiva?.precio ?? savedProduct?.precio ?? null
      : formatNumberForApi(sourceForm?.precio),
    precio_promo: usaVariantes
      ? primeraVarianteActiva?.precio_promo ?? savedProduct?.precio_promo ?? null
      : formatNumberForApi(sourceForm?.precio_promo),
    id_stock_categoria:
      Number(normalizeIdValue(sourceForm?.id_categoria_stock)) || null,
    id_categoria_stock:
      Number(normalizeIdValue(sourceForm?.id_categoria_stock)) || null,
    tiene_variantes: usaVariantes,
    cantidad_variantes: variantes.filter((variant) => Number(variant?.activo ?? 1) === 1).length,
    cantidad_variantes_total: variantes.length,
    cantidad_variantes_activas: variantes.filter((variant) => Number(variant?.activo ?? 1) === 1).length,
    cantidad_variantes_inactivas: variantes.filter((variant) => Number(variant?.activo ?? 1) !== 1).length,
    variantes: usaVariantes ? variantes : [],
  };
}

function buildEmptyForm() {
  return {
    id: "",
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
    imagen_url: "",
    imagen_archivo_id: null,
    id_categoria_stock: "",
    categorias_ids: [],
    tiene_variantes: false,
    variantes: [emptyVariantRow()],
    tipos_precio_extra: [],
  };
}

export default function ModalEditarProducto({
  productoId,
  onClose,
  onGuardado,
  onGuardadoIntermedio,
  onToast,
}) {
  const closeBtnRef = useRef(null);
  const overlayRef = useRef(null);
  const categoriasPanelRef = useRef(null);
  const variantesPanelRef = useRef(null);
  const inputImagenRef = useRef(null);
  const variantesAntesDeDesactivarRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState({});
  const [dark, setDark] = useState(isTemaOscuro);

  const [form, setForm] = useState(buildEmptyForm());
  const [cargaActiva, setCargaActiva] = useState("producto");
  const [barcodeRefreshKey, setBarcodeRefreshKey] = useState(0);
  const [categorias, setCategorias] = useState([]);
  const [loadingCategorias, setLoadingCategorias] = useState(false);
  const [tiposPrecio, setTiposPrecio] = useState([]);
  const [loadingTiposPrecio, setLoadingTiposPrecio] = useState(false);

  const [nuevaImagenFile, setNuevaImagenFile] = useState(null);
  const [nuevaImagenPreview, setNuevaImagenPreview] = useState("");
  const [eliminarImagenActual, setEliminarImagenActual] = useState(false);
  const [variantesEliminadasIds, setVariantesEliminadasIds] = useState([]);

  const [miniCategoriaOpen, setMiniCategoriaOpen] = useState(false);
  const [miniCategoriaNombre, setMiniCategoriaNombre] = useState("");
  const [miniCategoriaPadreId, setMiniCategoriaPadreId] = useState("");
  const [guardandoMiniCategoria, setGuardandoMiniCategoria] = useState(false);
  const [subCategoriaNombre, setSubCategoriaNombre] = useState("");
  const [guardandoSubCategoria, setGuardandoSubCategoria] = useState(false);

  const [miniTipoOpen, setMiniTipoOpen] = useState(false);
  const [miniTipoNombre, setMiniTipoNombre] = useState("");
  const [guardandoMiniTipo, setGuardandoMiniTipo] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMime, setPreviewMime] = useState("");
  const [previewFileName, setPreviewFileName] = useState("");

  const mostrarToast = (mensaje, tipo = "error", duracion = 2500) => {
    onToast?.(tipo, errorToText(mensaje), duracion);
  };

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

  const nuevaImagenNombre = useMemo(
    () => nuevaImagenFile?.name || "",
    [nuevaImagenFile]
  );

  const imagenActualUrl = useMemo(() => {
    if (eliminarImagenActual) return "";
    if (nuevaImagenFile) return "";

    if (Number(form.imagen_archivo_id || 0) > 0) {
      return getProductoImageUrlByArchivoId(form.imagen_archivo_id);
    }

    return form.imagen_url ? String(form.imagen_url).trim() : "";
  }, [
    form.imagen_archivo_id,
    form.imagen_url,
    eliminarImagenActual,
    nuevaImagenFile,
  ]);

  const imagenActualMime = useMemo(
    () => inferImageMimeFromUrl(imagenActualUrl),
    [imagenActualUrl]
  );

  const isLoading = loading || guardando;
  const productoConVariantes = !!form.tiene_variantes;
  const preciosProductoBloqueados = productoConVariantes || guardando;
  const hasCostoProducto = !!form.precio_costo && !productoConVariantes;

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

  useEffect(() => {
    let cancelado = false;

    const fetchCatalogos = async () => {
      setLoadingCategorias(true);
      setLoadingTiposPrecio(true);

      try {
        const [resListas, resTipos] = await Promise.allSettled([
          listarCategoriasStock(),
          listarTiposPrecioStock(),
        ]);

        if (!cancelado) {
          if (resListas.status === "fulfilled") {
            try {
              const dataListas = resListas.value;
              const rawCategorias = Array.isArray(dataListas?.categorias)
                ? dataListas.categorias
                : Array.isArray(dataListas?.listas?.stock_categorias)
                  ? dataListas.listas.stock_categorias
                  : [];

              setCategorias(
                rawCategorias
                  .map((cat) => ({
                    id: String(cat.id_stock_categoria ?? cat.id ?? "").trim(),
                    id_stock_categoria: String(cat.id_stock_categoria ?? cat.id ?? "").trim(),
                    id_categoria_padre: cat.id_categoria_padre ?? null,
                    nivel: Number(cat.nivel || 0),
                    nombre_mostrar: String(cat.nombre_mostrar ?? "").trim(),
                    nombre: String(cat.nombre ?? cat.label ?? "")
                      .trim()
                      .toUpperCase(),
                    activo:
                      cat.activo === undefined || cat.activo === null
                        ? 1
                        : Number(cat.activo),
                  }))
                  .filter((c) => c.id !== "")
              );
            } catch {
              setCategorias([]);
            }
          } else {
            setCategorias([]);
          }

          if (resTipos.status === "fulfilled") {
            try {
              const dataTipos = resTipos.value;
              const rawTipos = Array.isArray(dataTipos?.tipos_precio)
                ? dataTipos.tipos_precio
                : [];

              setTiposPrecio(
                rawTipos
                  .map((tipo) => ({
                    id: String(tipo.id_tipo_precio_stock ?? tipo.id ?? "").trim(),
                    id_tipo_precio_stock: String(
                      tipo.id_tipo_precio_stock ?? tipo.id ?? ""
                    ).trim(),
                    nombre: String(tipo.nombre ?? tipo.label ?? "")
                      .trim()
                      .toUpperCase(),
                    activo:
                      tipo.activo === undefined || tipo.activo === null
                        ? 1
                        : Number(tipo.activo),
                  }))
                  .filter((t) => t.id !== "")
              );
            } catch {
              setTiposPrecio([]);
            }
          } else {
            setTiposPrecio([]);
          }
        }
      } finally {
        if (!cancelado) {
          setLoadingCategorias(false);
          setLoadingTiposPrecio(false);
        }
      }
    };

    fetchCatalogos();

    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (nuevaImagenPreview) {
        URL.revokeObjectURL(nuevaImagenPreview);
      }
    };
  }, [nuevaImagenPreview]);

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());

    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const o2 = new MutationObserver(update);

    if (document.body) {
      o2.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      o1.disconnect();
      o2.disconnect();
    };
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (
        e.key === "Escape" &&
        isTopStockModal(overlayRef.current) &&
        !guardando &&
        !previewOpen &&
        !miniCategoriaOpen &&
        !miniTipoOpen
      ) {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };

    document.addEventListener("keydown", h, true);

    return () => document.removeEventListener("keydown", h, true);
  }, [onClose, guardando, previewOpen, miniCategoriaOpen, miniTipoOpen]);

  useEffect(() => {
    setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    let mounted = true;

    const cargarProducto = async () => {
      if (!productoId) {
        mostrarToast("ID de producto inválido.", "error");
        setLoading(false);
        onClose?.();
        return;
      }

      setLoading(true);
      setCargaActiva("producto");
      setErrores({});
      setVariantesEliminadasIds([]);
      variantesAntesDeDesactivarRef.current = null;

      try {
        const data = await obtenerProductoStock(productoId);

        if (mounted) {
          setForm(hydratePricingFormValues(normalizarProducto(data)));
          setCargaActiva("producto");
        }
      } catch (err) {
        if (mounted) {
          mostrarToast(err, "error");
          onClose?.();
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    cargarProducto();

    return () => {
      mounted = false;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId]);

  const cerrarPreview = () => {
    setPreviewOpen(false);
    setPreviewUrl("");
    setPreviewMime("");
    setPreviewFileName("");
  };

  const abrirPreview = ({ src, mime = "", name = "" }) => {
    if (!src) return;

    setPreviewUrl(src);
    setPreviewMime(mime);
    setPreviewFileName(name);
    setPreviewOpen(true);
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
      setForm((prev) => recalculatePricingFormLive(prev, name, value));
    } else if (name === "stock") {
      setForm((prev) => ({
        ...prev,
        [name]: value.replace(/[^\d]/g, ""),
      }));
    } else if (["nombre", "sku", "descripcion"].includes(name)) {
      setForm((prev) => ({
        ...prev,
        [name]: toUpperCaseValue(value),
      }));
    } else if (name === "id_categoria_stock") {
      if (value === "__nueva_categoria__") {
        setMiniCategoriaOpen(true);
        return;
      }

      const idNormalizado = normalizeIdValue(value);
      setForm((prev) => ({
        ...prev,
        [name]: idNormalizado,
        categorias_ids: idNormalizado
          ? Array.from(new Set([...(prev.categorias_ids || []), idNormalizado]))
          : prev.categorias_ids || [],
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        [name]: value,
      }));
    }

    setErrores((prev) => ({
      ...prev,
      [name]: "",
    }));
  };

  const handleCostoChangeLive = (rawValue) => {
    recalcularTodoConCosto(rawValue, false);

    setErrores((prev) => ({
      ...prev,
      precio_costo: "",
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

    const result = formatPricingResult(resultRaw, withCents);

    setForm((prev) => ({
      ...prev,
      [prefix.price]: result.price,
      [prefix.marginPct]: result.marginPct,
      [prefix.marginVal]: result.marginValue,
    }));
  };

  const recalcularTodoConCosto = (nuevoCosto, withCents = false) => {
    setForm((prev) => {
      const ventaRaw = recalculatePricingGroup({
        cost: nuevoCosto,
        price: prev.precio,
        marginPct: prev.margen_venta_porcentaje,
        marginValue: prev.margen_venta_valor,
        source: prev.precio
          ? "price"
          : prev.margen_venta_porcentaje
            ? "marginPct"
            : prev.margen_venta_valor
              ? "marginValue"
              : null,
      });

      const promoRaw = recalculatePricingGroup({
        cost: nuevoCosto,
        price: prev.precio_promo,
        marginPct: prev.margen_promo_porcentaje,
        marginValue: prev.margen_promo_valor,
        source: prev.precio_promo
          ? "price"
          : prev.margen_promo_porcentaje
            ? "marginPct"
            : prev.margen_promo_valor
              ? "marginValue"
              : null,
      });

      const venta = formatPricingResult(ventaRaw, withCents);
      const promo = formatPricingResult(promoRaw, withCents);

      const extras = (prev.tipos_precio_extra || []).map((item) => {
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

        const result = formatPricingResult(resultRaw, withCents);

        return {
          ...item,
          precio: result.price,
          margen_porcentaje: result.marginPct,
          margen_valor: result.marginValue,
        };
      });

      return {
        ...prev,
        precio_costo: withCents
          ? formatNumberWithCents(nuevoCosto)
          : formatNumberForDisplay(nuevoCosto),
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
    setForm((prev) => {
      const next = {
        ...prev,
        tipos_precio_extra: prev.tipos_precio_extra.map((item, i) =>
          i === idx ? { ...item, [field]: value } : item
        ),
      };

      if (!["precio", "margen_porcentaje", "margen_valor"].includes(field)) {
        return next;
      }

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

    setErrores((prev) => ({
      ...prev,
      [`tipo_${idx}`]: "",
    }));
  };

  const handleExtraPriceBlur = (idx, source, withCents = true) => {
    setForm((prev) => ({
      ...prev,
      tipos_precio_extra: prev.tipos_precio_extra.map((item, i) => {
        if (i !== idx) return item;

        const resultRaw = recalculatePricingGroup({
          cost: prev.precio_costo,
          price: item.precio,
          marginPct: item.margen_porcentaje,
          marginValue: item.margen_valor,
          source,
        });

        const result = formatPricingResult(resultRaw, withCents);

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
      setMiniTipoNombre("");
      setMiniTipoOpen(true);
      return;
    }

    const yaExiste = form.tipos_precio_extra.some(
      (item) => String(item.id_tipo_precio_stock) === String(val)
    );

    if (yaExiste) return;

    const tipo = tiposPrecio.find(
      (t) => String(t.id ?? t.id_tipo_precio_stock) === String(val)
    );

    setForm((prev) => {
      const tipos_precio_extra = [...(prev.tipos_precio_extra || []), emptyExtraPriceRow(tipo)];
      return {
        ...prev,
        tipos_precio_extra,
        variantes: syncVariantsExtraPrices(prev.variantes, tipos_precio_extra),
      };
    });
  };

  const quitarTipoPrecio = (idx) => {
    setForm((prev) => {
      const tipos_precio_extra = (prev.tipos_precio_extra || []).filter((_, i) => i !== idx);
      return {
        ...prev,
        tipos_precio_extra,
        variantes: syncVariantsExtraPrices(prev.variantes, tipos_precio_extra),
      };
    });
  };

  const limpiarNuevaImagen = () => {
    if (nuevaImagenPreview) {
      URL.revokeObjectURL(nuevaImagenPreview);
    }

    setNuevaImagenFile(null);
    setNuevaImagenPreview("");

    if (inputImagenRef.current) {
      inputImagenRef.current.value = "";
    }
  };

  const tomarNuevaImagen = (file) => {
    if (!file) return;

    const tiposPermitidos = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
    ];

    if (!tiposPermitidos.includes(file.type)) {
      const msg = "La imagen debe ser JPG, PNG, WEBP o GIF";

      setErrores((prev) => ({
        ...prev,
        imagen: msg,
      }));

      mostrarToast(msg, "error");

      if (inputImagenRef.current) {
        inputImagenRef.current.value = "";
      }

      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      const msg = "La imagen no puede superar los 5 MB";

      setErrores((prev) => ({
        ...prev,
        imagen: msg,
      }));

      mostrarToast(msg, "error");

      if (inputImagenRef.current) {
        inputImagenRef.current.value = "";
      }

      return;
    }

    if (nuevaImagenPreview) {
      URL.revokeObjectURL(nuevaImagenPreview);
    }

    const blobUrl = URL.createObjectURL(file);

    setNuevaImagenFile(file);
    setNuevaImagenPreview(blobUrl);
    setEliminarImagenActual(false);

    setErrores((prev) => ({
      ...prev,
      imagen: "",
    }));
  };

  const handleImagenInput = (e) => {
    const file = e.target.files?.[0];

    if (file) {
      tomarNuevaImagen(file);
    }
  };

  const handleEliminarImagenActual = () => {
    setEliminarImagenActual(true);
    limpiarNuevaImagen();

    setErrores((prev) => ({
      ...prev,
      imagen: "",
    }));
  };

  const handleCancelarEliminarImagen = () => {
    setEliminarImagenActual(false);
  };

  const toggleCategoriaMultiple = (categoriaId) => {
    const id = normalizeIdValue(categoriaId);
    if (!id) return;
    setForm((prev) => {
      const actuales = Array.isArray(prev.categorias_ids) ? prev.categorias_ids : [];
      const existe = actuales.includes(id);
      const categorias_ids = existe ? actuales.filter((x) => x !== id) : [...actuales, id];
      return { ...prev, categorias_ids, id_categoria_stock: prev.id_categoria_stock || id };
    });
  };

  const toggleVariantCategoria = (variantIdx, categoriaId) => {
    const id = normalizeIdValue(categoriaId);
    if (!id) return;

    setForm((prev) => ({
      ...prev,
      variantes: (prev.variantes || []).map((variant, i) => {
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
    const patchFinal = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patchFinal, "precio_costo")) patchFinal.precio_costo_heredado = false;
    if (Object.prototype.hasOwnProperty.call(patchFinal, "precio")) patchFinal.precio_heredado = false;
    if (Object.prototype.hasOwnProperty.call(patchFinal, "precio_promo")) patchFinal.precio_promo_heredado = false;

    setForm((prev) => ({
      ...prev,
      variantes: (prev.variantes || []).map((variant, i) => {
        if (i !== idx) return variant;
        const next = { ...variant, ...patchFinal };
        if (Object.prototype.hasOwnProperty.call(patchFinal, "nombre_variante")) {
          next.atributos = syncGenericVariantAttributeWithName(variant, patchFinal.nombre_variante);
        }
        return next;
      }),
    }));
  };

  const updateVariantAttr = (variantIdx, attrIdx, patch) => {
    setForm((prev) => ({
      ...prev,
      variantes: (prev.variantes || []).map((variant, i) =>
        i === variantIdx
          ? { ...variant, atributos: (variant.atributos || []).map((attr, j) => j === attrIdx ? { ...attr, ...patch } : attr) }
          : variant
      ),
    }));
  };

  const addVariant = () => {
    setForm((prev) => ({ ...prev, variantes: [...(prev.variantes || []), emptyVariantRow(prev.tipos_precio_extra)] }));
  };

  const removeVariant = (idx) => {
    setForm((prev) => {
      const current = (prev.variantes || [])[idx] || null;
      const id = Number(current?.id_stock_variante || 0);
      if (id > 0) {
        setVariantesEliminadasIds((ids) => Array.from(new Set([...(ids || []), id])));
      }
      const next = (prev.variantes || []).filter((_, i) => i !== idx);
      return { ...prev, variantes: next.length ? next : [emptyVariantRow(prev.tipos_precio_extra)] };
    });
  };

  const addVariantAttr = (idx) => {
    setForm((prev) => ({
      ...prev,
      variantes: (prev.variantes || []).map((variant, i) =>
        i === idx ? { ...variant, atributos: [...(variant.atributos || []), emptyVariantAttr()] } : variant
      ),
    }));
  };

  const guardarNuevaCategoria = async () => {
    const nombreLimpio = String(miniCategoriaNombre || "")
      .trim()
      .toUpperCase();

    if (!nombreLimpio) {
      mostrarToast("El nombre de la categoría es obligatorio", "error");
      return;
    }

    setGuardandoMiniCategoria(true);

    try {
      const data = await crearCategoriaStock({
        nombre: nombreLimpio,
        id_categoria_padre: miniCategoriaPadreId || null,
      });

      const nueva =
        data.categoria ||
        data.nueva || {
          id: data.id_stock_categoria,
          id_stock_categoria: data.id_stock_categoria,
          nombre: nombreLimpio,
          id_categoria_padre: miniCategoriaPadreId || null,
        };

      const normalizada = {
        id: String(nueva.id ?? nueva.id_stock_categoria ?? "").trim(),
        id_stock_categoria: String(nueva.id_stock_categoria ?? nueva.id ?? "").trim(),
        id_categoria_padre: (nueva.id_categoria_padre ?? miniCategoriaPadreId) || null,
        nivel: Number(nueva.nivel || 0),
        nombre_mostrar: String(nueva.nombre_mostrar ?? "").trim(),
        nombre: String(nueva.nombre ?? nombreLimpio).trim().toUpperCase(),
        activo:
          nueva.activo === undefined || nueva.activo === null
            ? 1
            : Number(nueva.activo),
      };

      setCategorias((prev) => {
        const existe = prev.some((x) => String(x.id) === String(normalizada.id));

        if (existe) return prev;

        return [...prev, normalizada].sort((a, b) =>
          String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
        );
      });

      setForm((prev) => ({
        ...prev,
        id_categoria_stock: prev.id_categoria_stock || normalizada.id,
        categorias_ids: normalizada.id
          ? Array.from(new Set([...(prev.categorias_ids || []), normalizada.id]))
          : prev.categorias_ids || [],
      }));

      setMiniCategoriaNombre("");
      setMiniCategoriaPadreId("");
      setMiniCategoriaOpen(false);
    } catch (err) {
      mostrarToast(err, "error");
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
      const normalizada = normalizeCategoriaRegistro(data.categoria || data.nueva || {}, {
        id: data.id_stock_categoria,
        id_stock_categoria: data.id_stock_categoria,
        nombre: nombreLimpio,
        id_categoria_padre: idPadre,
        nivel: nivelPadre + 1,
        nombre_mostrar: `${"— ".repeat(nivelPadre + 1)}${nombreLimpio}`,
      });

      setCategorias((prev) => {
        const existe = prev.some((cat) => getCategoryIdValue(cat) === getCategoryIdValue(normalizada));
        const next = existe
          ? prev.map((cat) => (getCategoryIdValue(cat) === getCategoryIdValue(normalizada) ? normalizada : cat))
          : [...prev, normalizada];
        return next.sort((a, b) => String(a.nombre_mostrar || a.nombre || "").localeCompare(String(b.nombre_mostrar || b.nombre || ""), "es"));
      });

      const nuevaId = getCategoryIdValue(normalizada);
      setForm((prev) => ({
        ...prev,
        categorias_ids: nuevaId
          ? Array.from(new Set([...(prev.categorias_ids || []), String(idPadre), nuevaId]))
          : prev.categorias_ids || [],
      }));

      setSubCategoriaNombre("");
      try { window.dispatchEvent(new Event("balto:listas-updated")); } catch {}
      mostrarToast("Subcategoría creada y asignada.", "exito");
    } catch (err) {
      mostrarToast(errorToText(err, "No se pudo crear la subcategoría"), "error");
    } finally {
      setGuardandoSubCategoria(false);
    }
  };

  const guardarNuevoTipo = async () => {
    const nombreLimpio = String(miniTipoNombre || "").trim().toUpperCase();

    if (!nombreLimpio) {
      mostrarToast("El nombre del tipo de precio es obligatorio", "error");
      return;
    }

    setGuardandoMiniTipo(true);

    try {
      const data = await crearTipoPrecioStock({ nombre: nombreLimpio });

      const nuevo =
        data.tipo_precio || {
          id: data.id_tipo_precio_stock,
          id_tipo_precio_stock: data.id_tipo_precio_stock,
          nombre: nombreLimpio,
        };

      const normalizado = {
        id: String(nuevo.id ?? nuevo.id_tipo_precio_stock ?? "").trim(),
        id_tipo_precio_stock: String(
          nuevo.id_tipo_precio_stock ?? nuevo.id ?? ""
        ).trim(),
        nombre: String(nuevo.nombre ?? nombreLimpio).trim().toUpperCase(),
        activo:
          nuevo.activo === undefined || nuevo.activo === null
            ? 1
            : Number(nuevo.activo),
      };

      setTiposPrecio((prev) => {
        const existe = prev.some(
          (x) =>
            String(x.id ?? x.id_tipo_precio_stock) ===
            String(normalizado.id ?? normalizado.id_tipo_precio_stock)
        );

        if (existe) return prev;

        return [...prev, normalizado].sort((a, b) =>
          String(a.nombre || "").localeCompare(String(b.nombre || ""), "es")
        );
      });

      setForm((prev) => {
        const yaExiste = (prev.tipos_precio_extra || []).some(
          (item) =>
            String(item.id_tipo_precio_stock) ===
            String(normalizado.id ?? normalizado.id_tipo_precio_stock)
        );

        if (yaExiste) return prev;

        const tipos_precio_extra = [
          ...(prev.tipos_precio_extra || []),
          emptyExtraPriceRow(normalizado),
        ];

        return {
          ...prev,
          tipos_precio_extra,
          variantes: syncVariantsExtraPrices(prev.variantes, tipos_precio_extra),
        };
      });

      setMiniTipoNombre("");
      setMiniTipoOpen(false);
    } catch (err) {
      mostrarToast(err, "error");
    } finally {
      setGuardandoMiniTipo(false);
    }
  };

  const validar = (sourceForm = form) => {
    const errs = {};

    const precioVenta = parseNumberFromInput(sourceForm.precio);
    const precioCosto = parseNumberFromInput(sourceForm.precio_costo);
    const promo = parseNumberFromInput(sourceForm.precio_promo);

    if (!sourceForm.nombre.trim()) {
      errs.nombre = "El nombre es obligatorio";
    }

    if (!sourceForm.tiene_variantes) {
      if (precioCosto !== null && precioCosto < 0) {
        errs.precio_costo = "Ingresá un costo válido";
      }

      if (!sourceForm.precio || precioVenta === null || precioVenta < 0) {
        errs.precio = "Ingresá un precio de venta válido";
      }

      if (sourceForm.precio_promo && (promo === null || promo < 0)) {
        errs.precio_promo = "Precio promocional inválido";
      }

      if (
        sourceForm.stock !== "" &&
        (Number.isNaN(Number(sourceForm.stock)) || Number(sourceForm.stock) < 0)
      ) {
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
        if (variant.precio_heredado || !isValidMoneyValue(variant.precio)) {
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
        (parseNumberFromInput(item.precio) === null ||
          parseNumberFromInput(item.precio) < 0)
      ) {
        errs[`tipo_${idx}`] = "Precio extra inválido";
      }
    });

    if (nuevaImagenFile) {
      const tipos = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/gif",
      ];

      if (!tipos.includes(nuevaImagenFile.type)) {
        errs.imagen = "La imagen debe ser JPG, PNG, WEBP o GIF";
      }

      if (nuevaImagenFile.size > 5 * 1024 * 1024) {
        errs.imagen = "La imagen no puede superar los 5 MB";
      }
    }

    return errs;
  };

  const handleGuardar = async (options = {}) => {
    const mantenerAbierto = options?.mantenerAbierto === true;
    const formNormalizado = hydratePricingFormValues(form);
    const errs = validar(formNormalizado);

    if (Object.keys(errs).length > 0) {
      setErrores(errs);
      setForm((prev) => ({
        ...prev,
        ...formNormalizado,
      }));

      if (Object.keys(errs).some((key) => key === "variantes" || key.startsWith("variante_"))) {
        setCargaActiva("variantes");
      } else {
        setCargaActiva("producto");
      }

      mostrarToast(
        Object.values(errs)[0] || "Revisá los campos del formulario",
        "error"
      );

      return false;
    }

    setGuardando(true);
    setErrores({});
    // Mantiene informado al usuario durante toda la edición, incluida la espera
    // de imagen/variantes y el refresco final de la grilla.
    mostrarToast(mantenerAbierto ? "Guardando cambios del producto..." : "Editando producto...", "cargando", 90000);

    setForm((prev) => ({
      ...prev,
      ...formNormalizado,
    }));

    try {
      const categoriaId = normalizeCategoriaId(
        formNormalizado.id_categoria_stock
      );

      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();

      const fd = new FormData();

      fd.append("id", String(Number(formNormalizado.id || productoId)));
      fd.append("nombre", toUpperCaseValue(formNormalizado.nombre.trim()));
      fd.append("sku", toUpperCaseValue(formNormalizado.sku.trim()));

      const usaVariantes = !!formNormalizado.tiene_variantes;

      fd.append(
        "precio_costo",
        usaVariantes
          ? ""
          : formNormalizado.precio_costo !== ""
            ? String(formatNumberForApi(formNormalizado.precio_costo) ?? "")
            : ""
      );

      fd.append("precio", usaVariantes ? "" : String(formatNumberForApi(formNormalizado.precio) ?? ""));

      fd.append(
        "margen_venta_porcentaje",
        usaVariantes
          ? ""
          : formNormalizado.margen_venta_porcentaje !== ""
            ? String(formatNumberForApi(formNormalizado.margen_venta_porcentaje) ?? "")
            : ""
      );

      fd.append(
        "margen_venta_valor",
        usaVariantes
          ? ""
          : formNormalizado.margen_venta_valor !== ""
            ? String(formatNumberForApi(formNormalizado.margen_venta_valor) ?? "")
            : ""
      );

      fd.append(
        "precio_promo",
        usaVariantes
          ? ""
          : formNormalizado.precio_promo !== ""
            ? String(formatNumberForApi(formNormalizado.precio_promo) ?? "")
            : ""
      );

      fd.append(
        "margen_promo_porcentaje",
        usaVariantes
          ? ""
          : formNormalizado.margen_promo_porcentaje !== ""
            ? String(formatNumberForApi(formNormalizado.margen_promo_porcentaje) ?? "")
            : ""
      );

      fd.append(
        "margen_promo_valor",
        usaVariantes
          ? ""
          : formNormalizado.margen_promo_valor !== ""
            ? String(formatNumberForApi(formNormalizado.margen_promo_valor) ?? "")
            : ""
      );

      fd.append(
        "stock",
        formNormalizado.tiene_variantes ? "0" : formNormalizado.stock !== "" ? String(formNormalizado.stock) : ""
      );

      fd.append("descripcion", toUpperCaseValue(formNormalizado.descripcion.trim()));
      fd.append("tiene_variantes", formNormalizado.tiene_variantes ? "1" : "0");

      // Balto confirma primero el cambio local. Tienda Nube queda a cargo de la cola
      // durable/worker para que una demora externa nunca mantenga abierto este guardado.
      fd.append("diferir_sync", "1");
      fd.append("origen_sync", "edicion_individual");

      fd.append("id_categoria_stock", categoriaId !== "" ? categoriaId : "");

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
              id_stock_variante: Number(variant.id_stock_variante || 0),
              activo: variant.activo === false ? 0 : 1,
              nombre_variante: toUpperCaseValue(String(variant.nombre_variante || "").trim()),
              sku: toUpperCaseValue(String(variant.sku || "").trim()),
              stock: Number(variant.stock || 0),
              categorias_ids: Array.from(new Set((variant.categorias_ids || []).map((id) => Number(normalizeIdValue(id))).filter(Boolean))),
              atributos: (variant.atributos || [])
                .filter((attr) => String(attr.atributo || "").trim() && String(attr.valor || "").trim())
                .map((attr) => ({ atributo: toUpperCaseValue(attr.atributo), valor: toUpperCaseValue(attr.valor) })),
              precios: buildVariantPricePayload(variant),
            }))
        : [];
      const variantesEliminadasNormalizadas = Array.from(
        new Set((variantesEliminadasIds || []).map((id) => Number(id)).filter((id) => id > 0))
      );
      fd.append("variantes", JSON.stringify(variantesPayload));
      fd.append("variantes_eliminadas_ids", JSON.stringify(variantesEliminadasNormalizadas));
      if (variantesEliminadasNormalizadas.length > 0) {
        // La edición que elimina variantes es una decisión explícita del usuario.
        // Esto permite desvincular referencias históricas sin convertir el guardado
        // en un error ambiguo ni obligar a repetir la acción variante por variante.
        fd.append("confirmar_desvinculacion_variantes", "1");
      }

      if (idUsuarioMaster > 0) {
        fd.append("idUsuarioMaster", String(idUsuarioMaster));
      }

      if (idTenant) {
        fd.append("tenant_id", String(idTenant));
      }

      const tiposPrecioPayload = formNormalizado.tipos_precio_extra.map((item) => ({
        id_tipo_precio_stock: Number(item.id_tipo_precio_stock) || 0,
        tipo_nombre: String(item.tipo_nombre || "").trim(),
        nombre: String(item.tipo_nombre || "").trim(),
        precio: usaVariantes ? "" : formatNumberForApi(item.precio),
        margen_porcentaje: usaVariantes ? "" : formatNumberForApi(item.margen_porcentaje),
        margen_valor: usaVariantes ? "" : formatNumberForApi(item.margen_valor),
      }));

      fd.append("tipos_precio", JSON.stringify(tiposPrecioPayload));

      if (eliminarImagenActual && !nuevaImagenFile) {
        fd.append("eliminar_imagen", "1");
      }

      if (nuevaImagenFile) {
        fd.append("imagen", nuevaImagenFile);
      }

      const data = await actualizarProductoStock(fd);

      const productoGuardadoBase =
        data?.producto ?? data?.data?.producto ?? data?.data ?? null;
      const productoGuardado = buildOptimisticProduct(
        productoGuardadoBase,
        formNormalizado,
        variantesPayload
      );

      const opcionesGuardado = {
        productoId: Number(formNormalizado.id || productoId || 0),
        imagen_actualizada: !!nuevaImagenFile,
        imagen_eliminada: eliminarImagenActual && !nuevaImagenFile,
        imagen_file: nuevaImagenFile || null,
        variantes_desactivadas: !formNormalizado.tiene_variantes,
        variantes_eliminadas_ids: variantesEliminadasNormalizadas,
        producto_optimista: productoGuardado,
        response: data,
        tiendanube_sync: data?.tiendanube_sync ?? data?.data?.tiendanube_sync ?? null,
      };

      if (mantenerAbierto) {
        let productoParaRefresco = productoGuardado;
        let formRefrescado = null;

        try {
          const detalleData = await obtenerProductoStock(
            Number(formNormalizado.id || productoId || 0)
          );
          formRefrescado = hydratePricingFormValues(normalizarProducto(detalleData));
          productoParaRefresco =
            detalleData?.producto ?? detalleData?.data?.producto ?? detalleData?.data ?? productoGuardado;
        } catch (detalleError) {
          // Fallback seguro: si la recarga completa falla después del COMMIT, recuperamos
          // al menos los IDs definitivos desde el endpoint aislado de códigos. Así una
          // segunda pulsación nunca vuelve a insertar las variantes recién creadas.
          const barcodeData = await stockBarcodeGet({
            op: "obtener",
            id_stock_producto: Number(formNormalizado.id || productoId || 0),
          });
          const variantesDb = Array.isArray(barcodeData?.variantes) ? barcodeData.variantes : [];
          const porSku = new Map(
            variantesDb
              .map((variant) => [String(variant?.sku || "").trim().toUpperCase(), variant])
              .filter(([sku]) => sku)
          );

          formRefrescado = {
            ...formNormalizado,
            variantes: (formNormalizado.variantes || []).map((variant) => {
              const sku = String(variant?.sku || "").trim().toUpperCase();
              const guardada = porSku.get(sku);
              return guardada
                ? { ...variant, id_stock_variante: Number(guardada.id_stock_variante || 0) }
                : variant;
            }),
          };
          productoParaRefresco = {
            ...(productoGuardado || {}),
            variantes: variantesDb,
            tiene_variantes: variantesDb.length > 0 ? 1 : Number(formNormalizado.tiene_variantes ? 1 : 0),
          };
        }

        if (formRefrescado) {
          setForm(formRefrescado);
        }
        setVariantesEliminadasIds([]);
        variantesAntesDeDesactivarRef.current = null;
        setNuevaImagenFile(null);
        setNuevaImagenPreview("");
        setEliminarImagenActual(false);
        setBarcodeRefreshKey((value) => value + 1);

        await onGuardadoIntermedio?.(productoParaRefresco, {
          ...opcionesGuardado,
          guardado_intermedio: true,
          producto_optimista: productoParaRefresco || productoGuardado,
        });

        return true;
      }

      await onGuardado?.(productoGuardado, opcionesGuardado);
      if (typeof onGuardado !== "function") {
        mostrarToast("Producto actualizado correctamente", "exito");
        onClose?.();
      }
      return true;
    } catch (err) {
      mostrarToast(err.message || "Error al actualizar el producto", "error");
      return false;
    } finally {
      setGuardando(false);
    }
  };

  const irAPanel = (ref) => {
    ref?.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  const tieneImagenActual = !eliminarImagenActual && !nuevaImagenFile && !!imagenActualUrl;

  return createPortal(
    <>
      <div
        ref={overlayRef}
        data-stock-modal-overlay="true"
        className={["mi-modal__overlay", dark ? "mi-modal__overlay--dark" : ""]
          .join(" ")
          .trim()}
      >
        <div
          className={[
            "mi-modal__container",
            "cmi-container",
            "cmi-container--editar",
            dark ? "mi-modal--dark" : "",
          ]
            .join(" ")
            .trim()}
          role="dialog"
          aria-modal="true"
          style={{ minHeight: "auto", maxHeight: "92vh", width: "min(1180px, 96vw)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="mi-modal__header">
            <div className="mi-modal__head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faBoxOpen} />
            </div>

            <div className="mi-modal__head-left">
              <h2 className="mi-modal__title">Editar producto</h2>
              <p className="mi-modal__subtitle">
                {form.nombre
                  ? `Modificando: ${form.nombre}`
                  : "Actualizá los datos del producto"}
              </p>
            </div>

            <button
              ref={closeBtnRef}
              className="mi-modal__close"
              onClick={() => !guardando && onClose?.()}
              aria-label="Cerrar"
              disabled={guardando}
              type="button"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>

          <div className="mi-modal__content" style={{ overflowY: "auto", padding: 20 }}>
            {loading ? (
              <div className="cmi-uploadBox">
                <div className="cmi-uploadBox__title">
                  <FontAwesomeIcon icon={faRefresh} spin /> Cargando producto...
                </div>
              </div>
            ) : (
              <div
                className={`cmi-v2-formShell cmi-v2-formShell--${cargaActiva}`}
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div className="cmi-v2-mainTabs" role="tablist" aria-label="Edición de producto">
                  <button
                    type="button"
                    className={`cmi-v2-mainTab ${cargaActiva === "producto" ? "is-active" : ""}`}
                    onClick={() => setCargaActiva("producto")}
                    role="tab"
                    aria-selected={cargaActiva === "producto"}
                    disabled={isLoading}
                  >
                    <FontAwesomeIcon icon={faBoxOpen} /> Producto original
                  </button>
                  <button
                    type="button"
                    className={`cmi-v2-mainTab ${cargaActiva === "variantes" ? "is-active" : ""}`}
                    onClick={() => setCargaActiva("variantes")}
                    role="tab"
                    aria-selected={cargaActiva === "variantes"}
                    disabled={isLoading}
                  >
                    <FontAwesomeIcon icon={faCubesStacked} /> Variantes
                  </button>
                  <button
                    type="button"
                    className={`cmi-v2-mainTab ${cargaActiva === "codigo_barra" ? "is-active" : ""}`}
                    onClick={() => setCargaActiva("codigo_barra")}
                    role="tab"
                    aria-selected={cargaActiva === "codigo_barra"}
                    disabled={isLoading}
                  >
                    <FontAwesomeIcon icon={faBarcode} /> Código de barra
                  </button>
                </div>

                <StockBarcodePanel
                  productoId={productoId}
                  nombreProducto={form.nombre}
                  tieneVariantes={!!form.tiene_variantes}
                  variantes={form.variantes}
                  onToast={mostrarToast}
                  onSavePendingChanges={() => handleGuardar({ mantenerAbierto: true })}
                  productSaving={guardando}
                  refreshKey={barcodeRefreshKey}
                />
                <FloatingField
                  label="Nombre del producto *"
                  icon={faBoxOpen}
                  error={errores.nombre}
                >
                  <input
                    name="nombre"
                    value={form.nombre}
                    onChange={handleChange}
                    onKeyDown={handleFieldEnter}
                    className="cmi-input"
                    placeholder="Ej: AURICULARES BLUETOOTH"
                    disabled={guardando}
                    style={{ textTransform: "uppercase" }}
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
                      disabled={guardando}
                      style={{ textTransform: "uppercase" }}
                    />
                  </FloatingField>

                  <FloatingField label="Stock" icon={faCubesStacked} error={errores.stock}>
                    <input
                      name="stock"
                      value={form.stock}
                      onChange={handleChange}
                      onKeyDown={handleFieldEnter}
                      className="cmi-input"
                      placeholder="Ej: 25"
                      inputMode="numeric"
                      disabled={guardando || productoConVariantes}
                    />
                  </FloatingField>

                  <FloatingField label="Categoría" icon={faTag}>
                    <select
                      name="id_categoria_stock"
                      value={form.id_categoria_stock}
                      onChange={handleChange}
                      onKeyDown={handleFieldEnter}
                      className="cmi-input cmi-select"
                      disabled={guardando || loadingCategorias}
                    >
                      <option value="">
                        {loadingCategorias ? "Cargando categorías..." : "Sin categoría"}
                      </option>
                      <option value="__nueva_categoria__">+ Nueva categoría</option>

                      {categoriasPadre.map((cat) => (
                        <option key={cat.id ?? cat.id_stock_categoria} value={cat.id ?? cat.id_stock_categoria}>
                          {categoryOptionLabel(cat)}
                        </option>
                      ))}
                    </select>
                  </FloatingField>
                </div>

                <div className="cmi-v2-tabsInline">
                  <button type="button" className="cmi-v2-tabBtn" onClick={() => irAPanel(categoriasPanelRef)} disabled={guardando}>
                    Categorías
                  </button>
                  <button type="button" className="cmi-v2-tabBtn" onClick={() => setCargaActiva("variantes")} disabled={guardando}>
                    Variantes
                  </button>
                </div>

                <div ref={categoriasPanelRef} className="cmi-priceBlock cmi-v2-softBlock">
                  <div className="cmi-priceBlock__title">
                    <FontAwesomeIcon icon={faLayerGroup} /> Categorías múltiples
                  </div>
                  <div className="cmi-priceBlock__subtitle">
                    Podés asignar el producto a varias categorías o subcategorías. La seleccionada arriba queda como principal.
                  </div>
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
                              disabled={guardando}
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
                                    disabled={guardando}
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
                            disabled={guardando || guardandoSubCategoria}
                          />
                          <button
                            type="button"
                            className="mit-btn mit-btn--ghost"
                            onClick={guardarNuevaSubcategoriaInline}
                            disabled={guardando || guardandoSubCategoria}
                          >
                            <FontAwesomeIcon icon={faPlus} />
                            {guardandoSubCategoria ? "Creando..." : "Crear subcategoría"}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className={`cmi-priceBlock ${productoConVariantes ? "cmi-priceBlock--disabledByVariants" : ""}`}>
                  <div className="cmi-priceBlock__title">
                    <FontAwesomeIcon icon={faMoneyBillTrendUp} /> Precios principales
                  </div>

                  <div className="cmi-priceBlock__subtitle">
                    {productoConVariantes
                      ? "Este producto usa variantes: el precio general queda bloqueado para no pisar los precios de Tienda Nube. Cargá precio, stock y SKU en cada variante."
                      : "Con el costo cargado podés escribir el precio final o el margen en % / $ y se calcula solo."}
                  </div>

                  <FloatingField label="Precio de costo" error={errores.precio_costo}>
                    <PriceInput
                      name="precio_costo"
                      value={form.precio_costo}
                      onChange={(e) => handleCostoChangeLive(e.target.value)}
                      onBlur={(e) => recalcularTodoConCosto(e.target.value, true)}
                      onEnter={(e) =>
                        handlePriceEnter(e, () =>
                          recalcularTodoConCosto(e.currentTarget.value, true)
                        )
                      }
                      placeholder="0,00"
                      disabled={preciosProductoBloqueados}
                    />
                  </FloatingField>

                  <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                    <FloatingField label="Precio de venta *" error={errores.precio}>
                      <PriceInput
                        name="precio"
                        value={form.precio}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("price", "venta", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("price", "venta", true)
                          )
                        }
                        disabled={preciosProductoBloqueados}
                      />
                    </FloatingField>

                    <FloatingField label="Margen %" icon={faPercent}>
                      <PriceInput
                        name="margen_venta_porcentaje"
                        value={form.margen_venta_porcentaje}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("marginPct", "venta", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("marginPct", "venta", true)
                          )
                        }
                        disabled={preciosProductoBloqueados || !hasCostoProducto}
                      />
                    </FloatingField>

                    <FloatingField label="Margen $" icon={faDollarSign}>
                      <PriceInput
                        name="margen_venta_valor"
                        value={form.margen_venta_valor}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("marginValue", "venta", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("marginValue", "venta", true)
                          )
                        }
                        disabled={preciosProductoBloqueados || !hasCostoProducto}
                      />
                    </FloatingField>
                  </div>

                  <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                    <FloatingField label="Precio promocional" error={errores.precio_promo}>
                      <PriceInput
                        name="precio_promo"
                        value={form.precio_promo}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("price", "promo", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("price", "promo", true)
                          )
                        }
                        disabled={preciosProductoBloqueados}
                      />
                    </FloatingField>

                    <FloatingField label="Margen promo %" icon={faPercent}>
                      <PriceInput
                        name="margen_promo_porcentaje"
                        value={form.margen_promo_porcentaje}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("marginPct", "promo", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("marginPct", "promo", true)
                          )
                        }
                        disabled={preciosProductoBloqueados || !hasCostoProducto}
                      />
                    </FloatingField>

                    <FloatingField label="Margen promo $" icon={faDollarSign}>
                      <PriceInput
                        name="margen_promo_valor"
                        value={form.margen_promo_valor}
                        onChange={handleChange}
                        onBlur={() => handlePricingBlur("marginValue", "promo", true)}
                        onEnter={(e) =>
                          handlePriceEnter(e, () =>
                            handlePricingBlur("marginValue", "promo", true)
                          )
                        }
                        disabled={preciosProductoBloqueados || !hasCostoProducto}
                      />
                    </FloatingField>
                  </div>
                </div>

                <div className={`cmi-priceBlock ${productoConVariantes ? "cmi-priceBlock--typesForVariants" : ""}`}>
                  <div className="cmi-priceBlock__title">
                    <FontAwesomeIcon icon={faLayerGroup} /> {productoConVariantes ? "Tipos de precio para variantes" : "Tipos de precio adicionales"}
                  </div>

                  <div className="cmi-priceBlock__subtitle">
                    {productoConVariantes
                      ? "Agregá acá las listas de precio que necesitás. Los importes se cargan dentro de cada variante."
                      : "Agregá listas o precios alternativos del producto simple."}
                  </div>

                  <div className="cmi-addPriceRow">
                    <FloatingField label="Agregar tipo de precio" style={{ flex: 1 }}>
                      <select
                        className="cmi-input cmi-select"
                        value=""
                        onChange={(e) => handleTipoSelectChange(e.target.value)}
                        onKeyDown={handleFieldEnter}
                        disabled={loadingTiposPrecio || guardando}
                      >
                        <option value="">
                          {loadingTiposPrecio
                            ? "CARGANDO TIPOS..."
                            : "SELECCIONAR TIPO PARA AGREGAR..."}
                        </option>
                        <option value="__nuevo_tipo__">+ NUEVO TIPO DE PRECIO</option>

                        {tiposPrecio.map((tipo) => (
                          <option
                            key={tipo.id ?? tipo.id_tipo_precio_stock}
                            value={tipo.id ?? tipo.id_tipo_precio_stock}
                          >
                            {tipo.nombre}
                          </option>
                        ))}
                      </select>
                    </FloatingField>
                  </div>

                  {(form.tipos_precio_extra || []).map((tipoItem, idx) => (
                    <div
                      className="cmi-extraPriceCard"
                      key={`${tipoItem.id_tipo_precio_stock}-${idx}`}
                    >
                      <div className="cmi-extraPriceCard__head">
                        <div className="cmi-extraPriceCard__title">
                          {tipoItem.tipo_nombre || `Tipo ${idx + 1}`}
                        </div>

                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() => quitarTipoPrecio(idx)}
                          disabled={guardando}
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </div>

                      <div className="fl-row" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
                        <FloatingField label="Precio" error={errores[`tipo_${idx}`]}>
                          <PriceInput
                            name={`tipo_precio_${idx}`}
                            value={tipoItem.precio}
                            onChange={(e) =>
                              handleExtraPriceChange(idx, "precio", e.target.value)
                            }
                            onBlur={() => handleExtraPriceBlur(idx, "price", true)}
                            onEnter={(e) =>
                              handlePriceEnter(e, () =>
                                handleExtraPriceBlur(idx, "price", true)
                              )
                            }
                            disabled={preciosProductoBloqueados}
                          />
                        </FloatingField>

                        <FloatingField label="Margen %">
                          <PriceInput
                            name={`tipo_pct_${idx}`}
                            value={tipoItem.margen_porcentaje}
                            onChange={(e) =>
                              handleExtraPriceChange(
                                idx,
                                "margen_porcentaje",
                                e.target.value
                              )
                            }
                            onBlur={() => handleExtraPriceBlur(idx, "marginPct", true)}
                            onEnter={(e) =>
                              handlePriceEnter(e, () =>
                                handleExtraPriceBlur(idx, "marginPct", true)
                              )
                            }
                            disabled={preciosProductoBloqueados || !hasCostoProducto}
                          />
                        </FloatingField>

                        <FloatingField label="Margen $">
                          <PriceInput
                            name={`tipo_val_${idx}`}
                            value={tipoItem.margen_valor}
                            onChange={(e) =>
                              handleExtraPriceChange(idx, "margen_valor", e.target.value)
                            }
                            onBlur={() => handleExtraPriceBlur(idx, "marginValue", true)}
                            onEnter={(e) =>
                              handlePriceEnter(e, () =>
                                handleExtraPriceBlur(idx, "marginValue", true)
                              )
                            }
                            disabled={preciosProductoBloqueados || !hasCostoProducto}
                          />
                        </FloatingField>
                      </div>
                    </div>
                  ))}
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
                        disabled={isLoading}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((prev) => {
                            const variantesActuales = Array.isArray(prev.variantes) ? prev.variantes : [];
                            if (!checked) {
                              // Se conserva una copia sólo dentro del modal para que destildar y
                              // volver a tildar antes de guardar sea realmente reversible.
                              variantesAntesDeDesactivarRef.current = variantesActuales.map((variant) => ({
                                ...variant,
                                atributos: Array.isArray(variant?.atributos)
                                  ? variant.atributos.map((attr) => ({ ...attr }))
                                  : [],
                                categorias_ids: Array.isArray(variant?.categorias_ids)
                                  ? [...variant.categorias_ids]
                                  : [],
                                precios_extra: Array.isArray(variant?.precios_extra)
                                  ? variant.precios_extra.map((precio) => ({ ...precio }))
                                  : [],
                              }));

                              const idsExistentes = variantesActuales
                                .map((variant) => Number(variant?.id_stock_variante || 0))
                                .filter((id) => id > 0);
                              if (idsExistentes.length > 0) {
                                setVariantesEliminadasIds((ids) =>
                                  Array.from(new Set([...(ids || []), ...idsExistentes]))
                                );
                              }

                              return {
                                ...prev,
                                tiene_variantes: false,
                                // Al apagar variantes, el editor informa todos los IDs para que al
                                // guardar se eliminen definitivamente tanto en Balto como en Tienda Nube.
                                variantes: [emptyVariantRow(prev.tipos_precio_extra)],
                              };
                            }

                            const guardadas = Array.isArray(variantesAntesDeDesactivarRef.current)
                              ? variantesAntesDeDesactivarRef.current
                              : [];
                            const variantesRestauradas = guardadas.length > 0 ? guardadas : variantesActuales;
                            const idsRestaurados = new Set(
                              variantesRestauradas
                                .map((variant) => Number(variant?.id_stock_variante || 0))
                                .filter((id) => id > 0)
                            );
                            if (idsRestaurados.size > 0) {
                              setVariantesEliminadasIds((ids) =>
                                (ids || []).filter((id) => !idsRestaurados.has(Number(id)))
                              );
                            }
                            variantesAntesDeDesactivarRef.current = null;

                            return {
                              ...prev,
                              tiene_variantes: true,
                              variantes: syncVariantsExtraPrices(
                                variantesRestauradas.length
                                  ? variantesRestauradas
                                  : [emptyVariantRow(prev.tipos_precio_extra)],
                                prev.tipos_precio_extra
                              ),
                            };
                          });
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
                              disabled={isLoading}
                              style={{ padding: "5px 11px", fontSize: 12, color: "#ef4444", borderColor: "rgba(239,68,68,0.25)" }}
                            >
                              <FontAwesomeIcon icon={faTrashCan} style={{ fontSize: 11 }} /> Quitar
                            </button>
                          </div>

                          <div className="fl-row" style={{ gridTemplateColumns: "1.3fr 1fr .75fr" }}>
                            <FloatingField label="Nombre variante *">
                              <input className="cmi-input" value={variant.nombre_variante} onChange={(e) => updateVariant(variantIdx, { nombre_variante: toUpperCaseValue(e.target.value) })} disabled={isLoading} placeholder="Ej: TALLE M / NEGRO" />
                            </FloatingField>
                            <FloatingField label="SKU variante *">
                              <input className="cmi-input" value={variant.sku} onChange={(e) => updateVariant(variantIdx, { sku: toUpperCaseValue(e.target.value) })} disabled={isLoading} placeholder="SKU" style={{ textTransform: "uppercase" }} />
                            </FloatingField>
                            <FloatingField label="Stock *">
                              <input className="cmi-input" value={variant.stock} onChange={(e) => updateVariant(variantIdx, { stock: e.target.value.replace(/[^\d]/g, "") })} disabled={isLoading} inputMode="numeric" />
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
                                        disabled={isLoading}
                                      />
                                      <span>{categoryOptionLabel(cat)}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}

                          <div className="fl-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                            <FloatingField label="Precio de costo"><PriceInput value={variant.precio_costo} onChange={(e) => updateVariant(variantIdx, { precio_costo: e.target.value, precio_costo_heredado: false })} disabled={isLoading} /></FloatingField>
                            <FloatingField label="Precio de venta *"><PriceInput value={variant.precio} onChange={(e) => updateVariant(variantIdx, { precio: e.target.value, precio_heredado: false })} disabled={isLoading} /></FloatingField>
                            <FloatingField label="Precio promocional"><PriceInput value={variant.precio_promo} onChange={(e) => updateVariant(variantIdx, { precio_promo: e.target.value, precio_promo_heredado: false })} disabled={isLoading} /></FloatingField>
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
                                        setForm((prev) => ({
                                          ...prev,
                                          variantes: (prev.variantes || []).map((v, i) => {
                                            if (i !== variantIdx) return v;
                                            return {
                                              ...v,
                                              tipos_precio_extra: (v.tipos_precio_extra || []).map((item, j) =>
                                                j === tipoIdx ? { ...item, precio: value, precio_heredado: false } : item
                                              ),
                                            };
                                          }),
                                        }));
                                      }}
                                      disabled={isLoading}
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
                                  <input className="cmi-input" value={attr.atributo} onChange={(e) => updateVariantAttr(variantIdx, attrIdx, { atributo: toUpperCaseValue(e.target.value) })} disabled={isLoading} placeholder="TALLE / COLOR / MEDIDA" />
                                </FloatingField>
                                <FloatingField label="Valor">
                                  <input className="cmi-input" value={attr.valor} onChange={(e) => updateVariantAttr(variantIdx, attrIdx, { valor: toUpperCaseValue(e.target.value) })} disabled={isLoading} placeholder="M / NEGRO / 80X200" />
                                </FloatingField>
                              </div>
                            ))}
                            <button type="button" className="mit-btn mit-btn--ghost" onClick={() => addVariantAttr(variantIdx)} disabled={isLoading}>
                              <FontAwesomeIcon icon={faPlus} /> Agregar atributo
                            </button>
                          </div>
                        </div>
                      ))}
                      <button type="button" className="mit-btn mit-btn--ghost" onClick={addVariant} disabled={isLoading}>
                        <FontAwesomeIcon icon={faPlus} /> Agregar variante
                      </button>
                    </div>
                  ) : (
                    <div className="cmi-v2-muted">Producto simple: se usa el stock cargado arriba.</div>
                  )}
                </div>

                <FloatingField label="Descripción" icon={faAlignLeft}>
                  <textarea
                    name="descripcion"
                    value={form.descripcion}
                    onChange={handleChange}
                    onKeyDown={handleFieldEnter}
                    className="cmi-input cmi-textarea"
                    placeholder="BREVE DESCRIPCIÓN DEL PRODUCTO (OPCIONAL)"
                    rows={3}
                    disabled={guardando}
                    style={{ textTransform: "uppercase" }}
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
                    onChange={handleImagenInput}
                  />

                  {!tieneImagenActual && !nuevaImagenFile && !eliminarImagenActual && (
                    <button
                      type="button"
                      className="mit-btn mit-btn--ghost"
                      onClick={() => inputImagenRef.current?.click()}
                      disabled={guardando}
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
                  )}

                  {tieneImagenActual && (
                    <div className="cmi-fileResume">
                      <div className="cmi-fileResume__left">
                        <span className="cmi-fileResume__icon">
                          <FontAwesomeIcon icon={faImage} />
                        </span>

                        <div className="cmi-fileResume__meta">
                          <div className="cmi-fileResume__name">
                            {form.nombre ? `${form.nombre.slice(0, 28)}…` : "Imagen actual"}
                          </div>
                          <span className="cmi-badge cmi-badge--img">Imagen</span>
                        </div>
                      </div>

                      <div className="cmi-fileActions">
                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() =>
                            abrirPreview({
                              src: imagenActualUrl,
                              mime: imagenActualMime,
                              name: form.nombre || "imagen_actual",
                            })
                          }
                          disabled={guardando || !imagenActualUrl}
                          style={{ padding: "6px 10px", fontSize: 13 }}
                          title="Ver imagen"
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </button>

                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() => inputImagenRef.current?.click()}
                          disabled={guardando}
                          style={{ padding: "6px 10px", fontSize: 13 }}
                          title="Reemplazar imagen"
                        >
                          <FontAwesomeIcon icon={faArrowUpFromBracket} />
                        </button>

                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={handleEliminarImagenActual}
                          disabled={guardando}
                          style={{
                            padding: "6px 10px",
                            fontSize: 13,
                            color: "#ef4444",
                            borderColor: "rgba(239,68,68,0.25)",
                          }}
                          title="Eliminar imagen"
                        >
                          <FontAwesomeIcon icon={faTrashCan} />
                        </button>
                      </div>
                    </div>
                  )}

                  {eliminarImagenActual && !nuevaImagenFile && (
                    <div className="cmi-deleteWarn">
                      <div className="cmi-deleteWarn__left">
                        <div className="cmi-deleteWarn__icon" aria-hidden="true">
                          <FontAwesomeIcon icon={faTriangleExclamation} />
                        </div>

                        <div className="cmi-deleteWarn__body">
                          <div className="cmi-deleteWarn__title">
                            La imagen se eliminará al guardar
                          </div>

                          <div className="cmi-deleteWarn__desc">
                            Esta acción no se puede deshacer. Podés subir una nueva imagen antes de guardar.
                          </div>
                        </div>
                      </div>

                      <div className="cmi-deleteWarn__actions">
                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() => inputImagenRef.current?.click()}
                          disabled={guardando}
                          style={{ fontSize: 12, padding: "6px 12px" }}
                        >
                          <FontAwesomeIcon
                            icon={faArrowUpFromBracket}
                            style={{ marginRight: 6 }}
                          />
                          Reemplazar imagen
                        </button>

                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={handleCancelarEliminarImagen}
                          disabled={guardando}
                          style={{ fontSize: 12, padding: "6px 12px" }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {nuevaImagenFile && (
                    <div className="cmi-fileResume">
                      <div className="cmi-fileResume__left">
                        <span className="cmi-fileResume__icon">
                          <FontAwesomeIcon icon={faImage} />
                        </span>

                        <div className="cmi-fileResume__meta">
                          <div className="cmi-fileResume__name">{nuevaImagenNombre}</div>
                          <span className="cmi-badge cmi-badge--img">Imagen</span>
                        </div>
                      </div>

                      <div className="cmi-fileActions">
                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={() =>
                            abrirPreview({
                              src: nuevaImagenPreview,
                              mime: nuevaImagenFile?.type || "image/jpeg",
                              name: nuevaImagenNombre,
                            })
                          }
                          disabled={!nuevaImagenPreview}
                          style={{ padding: "6px 10px", fontSize: 13 }}
                          title="Ver imagen"
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </button>

                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost"
                          onClick={limpiarNuevaImagen}
                          disabled={guardando}
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
            )}
          </div>

          <div className="cmi-footer">
            <button
              type="button"
              className="mit-btn mit-btn--ghost"
              onClick={() => !guardando && onClose?.()}
              disabled={guardando}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={handleGuardar}
              disabled={isLoading}
            >
              <FontAwesomeIcon
                icon={guardando ? faRefresh : faFloppyDisk}
                spin={guardando}
                style={{ marginRight: 8 }}
              />
              {guardando ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </div>
      </div>

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
          <select className="cmi-input cmi-select" value={miniCategoriaPadreId} onChange={(e) => setMiniCategoriaPadreId(e.target.value)}>
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

      <ModalVerComprobante
        open={previewOpen}
        url={previewUrl}
        mime={previewMime}
        fileName={previewFileName}
        title="Imagen del producto"
        onClose={cerrarPreview}
      />
    </>,
    document.body
  );
}

/* ── Helpers ── */

function normalizeCategoriaId(value) {
  if (value === null || value === undefined) return "";

  const s = String(value).trim();

  if (s === "" || s === "0" || s.toLowerCase() === "null") {
    return "";
  }

  return s;
}

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
  if (value == null) return fallback;

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "object") {
    return String(value.nombre ?? value.label ?? value.descripcion ?? fallback);
  }

  return fallback;
}

function toUpperCaseValue(value = "") {
  return String(value || "").toUpperCase();
}

function errorToText(err, fallback = "Ocurrió un error inesperado") {
  const value = err?.message ?? err?.mensaje ?? err;

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  if (value && typeof value === "object") {
    if (typeof value.nombre === "string" && value.nombre.trim()) {
      return value.nombre;
    }

    if (typeof value.error === "string" && value.error.trim()) {
      return value.error;
    }

    if (typeof value.mensaje === "string" && value.mensaje.trim()) {
      return value.mensaje;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return fallback;
}
