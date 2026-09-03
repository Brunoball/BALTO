import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "../Global_css/Global_Modals.css";
import "../Global_css/Global_responsive.css";
import "../Global_css/roots.css";
import "../Global_css/ModalDetalleMovimiento.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faInfoCircle,
  faXmark,
  faShoppingCart,
  faCreditCard,
  faBoxOpen,
  faFileInvoiceDollar,
  faArrowRightLong,
} from "@fortawesome/free-solid-svg-icons";

function moneyARS(value) {
  const n = Number(value || 0);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(value) {
  const s = String(value ?? "").trim();
  return s ? s : "—";
}

function formatFechaDMY(value) {
  const s = String(value ?? "").trim();
  if (!s) return "—";

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  }

  return s;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeCompareText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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
  const producto = String(productName ?? "").trim();
  const variante = String(variantName ?? "").trim();

  if (!producto && !variante) return "";
  if (!producto) return variante;
  if (!variante) return producto;

  if (variantAlreadyIncludedInProduct(producto, variante)) return producto;

  return `${producto} - ${variante}`;
}

function getItemVariantName(item) {
  return firstText(
    item?.stock_variante_nombre,
    item?.variante_nombre,
    item?.nombre_variante,
    item?.stock_variante_nombre_raw,
    item?.stock_variante,
    item?.variante,
    item?.stock_variante_valores,
    item?.stock_variante_detalle,
    item?.variant_name,
    item?.variantName,
    item?.atributos_variante,
    item?.atributos
  );
}

function getItemName(item) {
  const productoBase = firstText(
    item?.stock_producto_nombre,
    item?.producto_base_nombre,
    item?.producto_nombre,
    item?.producto
  );
  const variante = getItemVariantName(item);
  const nombreCompuesto = composeProductoVariante(productoBase, variante);

  const nombreExplicito = firstText(
    item?.nombre_completo,
    item?.producto_variante_nombre,
    item?.nombre,
    item?.descripcion,
    item?.detalle,
    item?.detalle_nombre,
    item?.concepto
  );

  if (variante) return safeText(nombreCompuesto || nombreExplicito);

  const productoNorm = normalizeCompareText(productoBase);
  const explicitoNorm = normalizeCompareText(nombreExplicito);
  if (nombreExplicito && productoNorm && explicitoNorm && explicitoNorm !== productoNorm) {
    return safeText(nombreExplicito);
  }

  return safeText(nombreCompuesto || nombreExplicito);
}

function getItemsDescription(items) {
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return "";

  return arr
    .map((item) => {
      const name = getItemName(item);
      if (!name || name === "—") return "";

      const cantidad = Number(item?.cantidad ?? 0);
      const cantidadTexto = Number.isFinite(cantidad) && cantidad > 0
        ? `${formatNumber(cantidad)} x `
        : "";

      return `${cantidadTexto}${name}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";

  return n.toLocaleString("es-AR", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function firstText(...values) {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function toFiniteNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function humanizeCreditValue(value, fallback = "Nota de crédito") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  return raw
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCreditNoteAmount(note) {
  return firstFiniteNumber(note?.total_nota, note?.total, note?.monto, note?.importe);
}

function buildCreditDocumentNumber(note) {
  const puntoVenta = Number(note?.comprobante_punto_venta ?? 0);
  const numero = Number(note?.comprobante_numero ?? 0);
  if (!Number.isFinite(puntoVenta) || puntoVenta <= 0 || !Number.isFinite(numero) || numero <= 0) {
    return "";
  }

  return `${String(Math.trunc(puntoVenta)).padStart(5, "0")}-${String(Math.trunc(numero)).padStart(8, "0")}`;
}

function getChequeNumero(medio) {
  return firstText(
    medio?.cheque_numero,
    medio?.numero_cheque,
    medio?.cheque?.numero_cheque,
    medio?.cheque?.numero,
    medio?.id_cheque
  );
}

function getChequeEmisor(medio) {
  return firstText(medio?.cheque_emisor, medio?.emisor, medio?.cheque?.emisor);
}

function getChequeFechaEmision(medio) {
  return firstText(medio?.cheque_fecha_emision, medio?.fecha_emision, medio?.cheque?.fecha_emision);
}

function getChequeFechaPago(medio) {
  return firstText(
    medio?.cheque_fecha_pago,
    medio?.cheque_fecha_vencimiento,
    medio?.cheque?.fecha_pago,
    medio?.cheque?.fecha_vencimiento,
    medio?.fecha_vencimiento,
    medio?.fecha_pago
  );
}

function getChequeImporteReal(medio) {
  const candidates = [
    medio?.cheque_importe,
    medio?.importe_cheque,
    medio?.cheque?.importe,
    medio?.cheque_monto,
  ];

  for (const value of candidates) {
    const n = toFiniteNumber(value);
    if (n > 0) return n;
  }

  return toFiniteNumber(medio?.monto);
}

function getMedioMontoAplicado(medio) {
  const n = toFiniteNumber(medio?.monto_aplicado ?? medio?.monto);
  return n > 0 ? n : 0;
}

function getMedioMontoVisible(medio) {
  return medio?.id_cheque ? getChequeImporteReal(medio) : getMedioMontoAplicado(medio);
}

function shouldShowMontoAplicado(medio) {
  if (!medio?.id_cheque) return false;
  const aplicado = getMedioMontoAplicado(medio);
  const real = getChequeImporteReal(medio);
  return aplicado > 0 && real > 0 && Math.abs(real - aplicado) > 0.009;
}

function InfoPill({ label, value, strong = false }) {
  return (
    <div className="mdm-info-pill">
      <span className="mdm-info-pill__label">{label}</span>
      <span className={["mdm-info-pill__value", strong ? "is-strong" : ""].join(" ")}>
        {safeText(value)}
      </span>
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }) {
  return (
    <div className="mdm-section-title">
      <div className="mdm-section-title__icon">
        <FontAwesomeIcon icon={icon} />
      </div>
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}

function getTercero(row) {
  const proveedor = String(row?.proveedor || row?.nombre_proveedor || row?.razon_social_proveedor || "").trim();
  if (proveedor) return { label: "Proveedor", value: proveedor };

  const cliente = String(row?.cliente || row?.nombre_cliente || row?.razon_social_cliente || "").trim();
  if (cliente) return { label: "Cliente", value: cliente };

  const tercero = String(row?.tercero || row?.emisor || row?.cheque_emisor || "").trim();
  if (tercero) return { label: "Tercero", value: tercero };

  return { label: "Cliente / proveedor", value: "—" };
}

function getEstado(row) {
  if (row?.pagado === true) return "Pagado";
  if (row?.pagado === false) return "Pendiente";
  if (row?.estado) return row.estado;
  return "";
}

export default function ModalDetalleMovimiento({
  open,
  row,
  onClose,
  title = "Detalle del movimiento",
  hideTerceroYTipo = false,
  hideMediosPago = false,
  showCreditTrace = false,
  unifiedItemsScroll = false,
  creditTraceEntity = "venta",
}) {
  const [creditTraceExpanded, setCreditTraceExpanded] = useState(false);

  const currentItems = useMemo(() => {
    const arr = toArray(row?.items_detalle || row?.items);
    if (arr.length) return arr;
    if (!row) return [];

    const tieneItemLegacy =
      row?.detalle ||
      row?.descripcion ||
      row?.concepto ||
      row?.cantidad != null ||
      row?.precio != null ||
      row?.total != null;

    if (!tieneItemLegacy) return [];

    return [
      {
        id_item: row?.id_item,
        producto_nombre:
          row?.stock_producto_nombre ||
          row?.producto_nombre ||
          row?.detalle ||
          row?.descripcion ||
          row?.concepto,
        stock_producto_nombre: row?.stock_producto_nombre,
        stock_variante_nombre: row?.stock_variante_nombre || row?.variante_nombre || row?.nombre_variante,
        variante_nombre: row?.variante_nombre || row?.stock_variante_nombre || row?.nombre_variante,
        nombre: row?.nombre,
        descripcion: row?.descripcion,
        detalle: row?.detalle,
        cantidad: row?.cantidad ?? 1,
        precio: row?.precio ?? row?.monto_total ?? row?.total ?? 0,
        iva_pct: row?.iva_pct ?? 0,
        subtotal: row?.subtotal ?? row?.monto_total ?? row?.total ?? 0,
        iva_monto: row?.iva_monto ?? 0,
        total: row?.total ?? row?.monto_total ?? 0,
      },
    ];
  }, [row]);

  const originalItems = useMemo(
    () => toArray(row?.items_detalle_original || row?.items_originales),
    [row]
  );

  const creditNotes = useMemo(
    () => toArray(row?.notas_credito_detalle || row?.notas_credito),
    [row]
  );

  const originalTotal = firstFiniteNumber(
    row?.monto_total_original,
    row?.total_movimiento_original,
    row?.total_original,
    originalItems.reduce((acc, item) => acc + toFiniteNumber(item?.total), 0)
  );

  const descuentoMonto = Math.max(0, firstFiniteNumber(row?.descuento_monto, row?.monto_descuento));
  const descuentoTipo = String(row?.descuento_tipo || "").trim().toUpperCase();
  const descuentoValor = Math.max(0, firstFiniteNumber(row?.descuento_valor));
  const totalBrutoComercial = firstFiniteNumber(
    row?.total_bruto,
    row?.monto_total_bruto,
    row?.total_sin_descuento,
    originalTotal + descuentoMonto
  );
  const hasCommercialDiscount = descuentoMonto > 0.004 && totalBrutoComercial > 0;
  const descuentoLabel = descuentoTipo === "PORCENTAJE"
    ? `${formatNumber(descuentoValor)}% · ${moneyARS(descuentoMonto)}`
    : moneyARS(descuentoMonto);

  const currentTotal = firstFiniteNumber(
    row?.monto_total_actual,
    row?.monto_total_vigente,
    row?.total_actual,
    row?.total_vigente,
    row?.monto_total_movimiento,
    row?.monto_total,
    row?.total,
    row?.total_general,
    currentItems.reduce((acc, item) => acc + toFiniteNumber(item?.total), 0)
  );

  const creditedTotal = Math.max(
    0,
    toFiniteNumber(row?.monto_acreditado),
    toFiniteNumber(row?.monto_nota_credito),
    toFiniteNumber(row?.diferencia_nota_credito),
    creditNotes.reduce((acc, note) => acc + getCreditNoteAmount(note), 0),
    originalTotal - currentTotal
  );

  const hasCreditTrace = Boolean(
    showCreditTrace &&
      (
        Number(row?.tiene_nota_credito || 0) === 1 ||
        Number(row?.factura_tiene_nota_credito || 0) === 1 ||
        Number(row?.nota_credito_cantidad || 0) > 0 ||
        creditNotes.length > 0 ||
        creditedTotal > 0.004 ||
        (originalTotal > 0 && currentTotal >= 0 && originalTotal - currentTotal > 0.004)
      )
  );

  // En ventas con nota de crédito se conserva visible el detalle original.
  // El valor vigente se informa por separado para no mezclar el comprobante
  // histórico con el saldo económico actual.
  const items = hasCreditTrace && originalItems.length ? originalItems : currentItems;

  const medios = useMemo(() => {
    const arr = toArray(row?.medios_pago_detalle);
    if (arr.length) return arr;

    const nombre = String(row?.medio_pago_nombre || row?.medio_pago || "").trim();
    const esCuentaCorriente = nombre.toUpperCase() === "CUENTA CORRIENTE";
    if (!nombre || nombre === "—" || nombre === "-" || esCuentaCorriente) return [];

    return [
      {
        id_medio_pago: row?.id_medio_pago,
        medio_pago_nombre: nombre,
        monto: row?.monto_total ?? row?.total ?? 0,
      },
    ];
  }, [row]);

  const resumenItems = useMemo(
    () =>
      items.reduce(
        (acc, item) => ({
          subtotal: acc.subtotal + Number(item?.subtotal || 0),
          iva: acc.iva + Number(item?.iva_monto || 0),
          total: acc.total + Number(item?.total || 0),
        }),
        { subtotal: 0, iva: 0, total: 0 }
      ),
    [items]
  );

  const totalItems = resumenItems.total;

  const totalMedios = useMemo(
    () => medios.reduce((acc, item) => acc + getMedioMontoAplicado(item), 0),
    [medios]
  );

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setCreditTraceExpanded(false);
  }, [open, row?.id_movimiento]);

  if (!open) return null;

  const totalMovimiento = hasCreditTrace
    ? currentTotal
    : Number(
        row?.monto_total_movimiento ?? row?.monto_total ?? row?.total ?? row?.total_general ?? totalItems ?? 0
      );

  const creditNotesForDisplay = creditNotes.length
    ? creditNotes
    : hasCreditTrace
      ? [
          {
            id_nota_credito: null,
            motivo: row?.nota_credito_ultimo_motivo || "NOTA_CREDITO",
            modalidad: Number(row?.tiene_nota_credito_fiscal || 0) === 1 ? "ARCA" : "INTERNA",
            fecha: row?.nota_credito_ultima_fecha || row?.fecha,
            total: creditedTotal,
            observaciones: "",
          },
        ]
      : [];

  const descripcionItems = getItemsDescription(items);

  const descripcion =
    descripcionItems ||
    row?.detalle_original ||
    row?.descripcion_original ||
    row?.concepto_original ||
    row?.detalle ||
    row?.descripcion ||
    row?.concepto ||
    "Detalle de productos y medios de pago";

  const tercero = getTercero(row);
  const estado = getEstado(row);
  const creditTraceEntityLabel = String(creditTraceEntity || "venta").trim().toLowerCase();
  const creditTraceEntityTitle = `${creditTraceEntityLabel.charAt(0).toUpperCase()}${creditTraceEntityLabel.slice(1)}`;
  const creditTraceEntityIsMasculine = ["ingreso", "egreso", "movimiento"].includes(creditTraceEntityLabel);
  const creditTraceAdjustedLabel = creditTraceEntityIsMasculine ? "ajustado" : "ajustada";
  const creditTraceCurrentEntityLabel = creditTraceEntityIsMasculine
    ? `del ${creditTraceEntityLabel}`
    : `de la ${creditTraceEntityLabel}`;

  return createPortal(
    <div className="mi-modal__overlay" role="presentation">
      <div
        className="mi-modal__container mi-modal__container--mov mdm-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header mdm-header">
          <div className="mi-modal__head-icon mdm-header__icon" aria-hidden="true">
            <FontAwesomeIcon icon={faInfoCircle} />
          </div>

          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">{title}</h2>
            <div className="mi-modal__subtitle mdm-subtitle">{safeText(descripcion)}</div>
          </div>

          <button type="button" className="mi-modal__close" onClick={onClose} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-modal__content mdm-content">
          <aside className="mdm-summary-card">
            <InfoPill label="Fecha" value={formatFechaDMY(row?.fecha)} />

            {!hideTerceroYTipo ? (
              <InfoPill label={tercero.label} value={tercero.value} strong />
            ) : null}

            {!hideTerceroYTipo ? (
              <InfoPill
                label="Tipo"
                value={
                  row?.tipo_venta ||
                  row?.pago_tipo_venta ||
                  row?.tipo_operacion ||
                  row?.tipo_operacion_nombre
                }
              />
            ) : null}

            {estado ? <InfoPill label="Estado" value={estado} /> : null}

            {hasCommercialDiscount ? (
              <InfoPill label="Descuento comercial" value={descuentoLabel} strong />
            ) : null}

            {hasCreditTrace ? (
              <InfoPill label="Estado documental" value="Ajustada por nota de crédito" strong />
            ) : null}
          </aside>

          <section
            className={[
              "mdm-section",
              "mdm-section--items",
              unifiedItemsScroll ? "is-unified-scroll" : "",
            ].filter(Boolean).join(" ")}
          >
            <SectionTitle
              icon={faShoppingCart}
              title={hasCreditTrace ? "Productos / detalle original" : "Productos / detalle"}
              subtitle={hasCreditTrace ? "La operación original se conserva; abajo se informa el valor vigente." : ""}
            />

            <div className={unifiedItemsScroll ? "mdm-items-scroll" : "mdm-items-content"}>
              {hasCommercialDiscount ? (
                <div className="mdm-commercial-discount" role="note" aria-label="Detalle del descuento comercial">
                  <div className="mdm-commercial-discount__heading">
                    <div className="mdm-commercial-discount__title">
                      <FontAwesomeIcon icon={faFileInvoiceDollar} aria-hidden="true" />
                      <div>
                        <strong>Descuento comercial aplicado a la venta</strong>
                        <span>El precio de lista del producto no fue modificado.</span>
                      </div>
                    </div>
                    <div className="mdm-commercial-discount__chips" aria-label="Resumen del descuento comercial">
                      <div className="mi-cr-totalLine mdm-total-chip--gross">
                        <span>Total sin descuento</span>
                        <b>{moneyARS(totalBrutoComercial)}</b>
                      </div>
                      <div className="mi-cr-totalLine mdm-total-chip--discount">
                        <span>Descuento comercial</span>
                        <b>- {moneyARS(descuentoMonto)}</b>
                      </div>
                    </div>
                  </div>
                  <div className="mdm-commercial-discount__totals">
                    <span>Total sin descuento <b>{moneyARS(totalBrutoComercial)}</b></span>
                    <span className="is-discount">Descuento {descuentoTipo === "PORCENTAJE" ? `(${formatNumber(descuentoValor)}%)` : ""} <b>- {moneyARS(descuentoMonto)}</b></span>
                    <span className="is-final">Total vendido <b>{moneyARS(Math.max(0, totalBrutoComercial - descuentoMonto))}</b></span>
                  </div>
                </div>
              ) : null}

              {hasCreditTrace ? (
              <div
                className={[
                  "mdm-credit-trace",
                  creditTraceExpanded ? "is-expanded" : "is-collapsed",
                ].join(" ")}
                role="note"
                aria-label="Trazabilidad de notas de crédito"
              >
                <button
                  type="button"
                  className="mdm-credit-trace__toggle"
                  onClick={() => setCreditTraceExpanded((expanded) => !expanded)}
                  aria-expanded={creditTraceExpanded}
                  aria-controls="mdm-credit-trace-details"
                  title={creditTraceExpanded ? "Ocultar detalle de la nota de crédito" : "Ver detalle de la nota de crédito"}
                >
                  <FontAwesomeIcon icon={faFileInvoiceDollar} aria-hidden="true" />
                </button>

                <div className="mdm-credit-trace__body">
                  <div className="mdm-credit-trace__heading">
                    <div>
                      <strong>{creditTraceEntityTitle} {creditTraceAdjustedLabel} por nota de crédito</strong>
                      {creditTraceExpanded ? (
                        <span>
                          Se mantiene el importe y detalle original para trazabilidad. El valor actual {creditTraceCurrentEntityLabel} es el neto luego de las notas aplicadas.
                        </span>
                      ) : null}
                    </div>
                    <div className="mdm-credit-trace__heading-actions">
                      {!creditTraceExpanded ? (
                        <div className="mi-cr-totals mdm-credit-trace__collapsed-totals">
                          <div className="mi-cr-totalLine mdm-total-chip--original">
                            <span>Total original</span>
                            <b>{moneyARS(originalTotal || totalItems)}</b>
                          </div>
                          <div className="mi-cr-totalLine mdm-total-chip--credit">
                            <span>Nota de crédito</span>
                            <b>- {moneyARS(creditedTotal)}</b>
                          </div>
                        </div>
                      ) : null}
                      <span className="mdm-credit-trace__count">
                        {creditNotesForDisplay.length} {creditNotesForDisplay.length === 1 ? "nota" : "notas"}
                      </span>
                    </div>
                  </div>

                  {creditTraceExpanded ? (
                    <div className="mdm-credit-trace__details" id="mdm-credit-trace-details">
                      <div className="mdm-credit-trace__totals">
                    <div className="mdm-credit-amount mdm-credit-amount--original">
                      <span className="mdm-credit-amount__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faShoppingCart} />
                      </span>
                      <span className="mdm-credit-amount__body">
                        <span className="mdm-credit-amount__label">Importe original</span>
                        <b className="mdm-credit-amount__value">
                          {moneyARS(originalTotal || totalItems)}
                        </b>
                        <span className="mdm-credit-amount__detail">Total antes del ajuste</span>
                      </span>
                    </div>
                    <FontAwesomeIcon className="mdm-credit-trace__arrow" icon={faArrowRightLong} />
                    <div className="mdm-credit-amount mdm-credit-amount--credit">
                      <span className="mdm-credit-amount__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faFileInvoiceDollar} />
                      </span>
                      <span className="mdm-credit-amount__body">
                        <span className="mdm-credit-amount__label">Notas de crédito</span>
                        <b className="mdm-credit-amount__value">- {moneyARS(creditedTotal)}</b>
                        <span className="mdm-credit-amount__detail">Total acreditado</span>
                      </span>
                    </div>
                    <FontAwesomeIcon className="mdm-credit-trace__arrow" icon={faArrowRightLong} />
                    <div className="mdm-credit-amount mdm-credit-amount--current">
                      <span className="mdm-credit-amount__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faCreditCard} />
                      </span>
                      <span className="mdm-credit-amount__body">
                        <span className="mdm-credit-amount__label">Valor vigente</span>
                        <b className="mdm-credit-amount__value">{moneyARS(currentTotal)}</b>
                        <span className="mdm-credit-amount__detail">Total luego del ajuste</span>
                      </span>
                    </div>
                  </div>

                  <div className="mdm-credit-notes">
                    {creditNotesForDisplay.map((note, index) => {
                      const noteAmount = getCreditNoteAmount(note) || creditedTotal;
                      const documentNumber = buildCreditDocumentNumber(note);
                      const noteId = Number(note?.id_nota_credito || 0);
                      const modalidad = humanizeCreditValue(note?.modalidad, "Interna");
                      const motivo = humanizeCreditValue(note?.motivo, "Nota de crédito");
                      const observaciones = String(note?.observaciones || "").trim();
                      const noteItems = toArray(note?.items_detalle || note?.items || note?.productos);

                      return (
                        <div className="mdm-credit-note" key={noteId > 0 ? noteId : `credit-${index}`}>
                          <div className="mdm-credit-note__main">
                            <span className="mdm-credit-note__title">
                              {noteId > 0 ? `Nota de crédito #${noteId}` : "Nota de crédito aplicada"}
                            </span>
                            <span className="mdm-credit-note__meta">
                              {formatFechaDMY(note?.fecha || note?.created_at)} · {motivo} · {modalidad}
                              {documentNumber ? ` · ${documentNumber}` : ""}
                            </span>
                            {observaciones ? (
                              <span className="mdm-credit-note__observation">{observaciones}</span>
                            ) : null}
                            {noteItems.length ? (
                              <div className="mdm-credit-note__items" aria-label="Productos acreditados">
                                {noteItems.map((item, itemIndex) => (
                                  <div
                                    className="mdm-credit-note__item"
                                    key={item?.id_item || `${getItemName(item)}-${itemIndex}`}
                                  >
                                    <span className="mdm-credit-note__item-name" title={getItemName(item)}>
                                      {getItemName(item)}
                                    </span>
                                    <span className="mdm-credit-note__item-data">
                                      <span>Cant. {formatNumber(item?.cantidad_acreditada ?? item?.cantidad)}</span>
                                      <span aria-hidden="true">·</span>
                                      <span>{moneyARS(item?.precio)} c/u</span>
                                      <span aria-hidden="true">·</span>
                                      <strong className="mdm-credit-note__item-total">{moneyARS(item?.total)}</strong>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <strong className="mdm-credit-note__amount">- {moneyARS(noteAmount)}</strong>
                        </div>
                      );
                    })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              ) : null}

              {items.length === 0 ? (
                <div className="mdm-empty">
                  <FontAwesomeIcon icon={faBoxOpen} />
                  <span>Este movimiento no tiene productos o detalles cargados.</span>
                </div>
              ) : (
                <div className="mdm-table-wrap">
                  <div className="mdm-table mdm-table--items">
                    <div className="mdm-table__row mdm-table__row--head">
                      <span>Producto / detalle</span>
                      <span>Cant.</span>
                      <span>Precio</span>
                      <span>IVA %</span>
                      <span>IVA</span>
                      <span>Total</span>
                    </div>

                    {items.map((item, index) => (
                      <div
                        className="mdm-table__row"
                        key={item?.id_item || `${getItemName(item)}-${index}`}
                      >
                        <span className="mdm-product-cell" title={getItemName(item)}>
                          <span className="mdm-product-name">{getItemName(item)}</span>
                        </span>
                        <span>{formatNumber(item?.cantidad)}</span>
                        <span>{moneyARS(item?.precio)}</span>
                        <span>{formatNumber(item?.iva_pct)}%</span>
                        <span>{moneyARS(item?.iva_monto)}</span>
                        <span className="is-strong">{moneyARS(item?.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {items.length > 0 ? (
              <div
                className={[
                  "mi-cr-table__foot",
                  "mdm-table__foot",
                  hasCreditTrace ? "is-credit-summary" : "",
                ].filter(Boolean).join(" ")}
              >
                <div className="mi-cr-foot-actions mdm-foot-actions" />
                <div className="mi-cr-totals mdm-foot-totals">
                  <div className="mi-cr-totalLine mi-cr-totalLine--sub">
                    <span>{hasCommercialDiscount ? "Subtotal con descuento" : hasCreditTrace ? "Subtotal original" : "Subtotal"}</span>
                    <b>{moneyARS(resumenItems.subtotal)}</b>
                  </div>
                  <div className="mi-cr-totalLine mi-cr-totalLine--iva">
                    <span>{hasCommercialDiscount ? "IVA con descuento" : hasCreditTrace ? "IVA original" : "IVA"}</span>
                    <b>{moneyARS(resumenItems.iva)}</b>
                  </div>
                  {hasCreditTrace ? (
                    <div className="mi-cr-totalLine mi-cr-totalLine--total mdm-total-chip--current">
                      <span>Total vigente</span>
                      <b>{moneyARS(totalMovimiento)}</b>
                    </div>
                  ) : (
                    <div className="mi-cr-totalLine mi-cr-totalLine--total">
                      <span>Total</span>
                      <b>{moneyARS(totalItems || totalMovimiento)}</b>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          {!hideMediosPago ? (
            <section className="mdm-section mdm-section--medios">
              <SectionTitle icon={faCreditCard} title="Medios de pago" />

              {medios.length === 0 ? (
                <div className="mdm-empty">
                  <FontAwesomeIcon icon={faCreditCard} />
                  <span>No hay medios de pago cargados para este movimiento.</span>
                </div>
              ) : (
                <div className="mdm-medios-grid">
                  {medios.map((medio, index) => (
                    <div
                      className="mdm-medio-card"
                      key={
                        medio?.id_movimiento_medio_pago ||
                        medio?.id_compra_medio_pago ||
                        `${medio?.id_medio_pago}-${index}`
                      }
                    >
                      <div className="mdm-medio-card__main">
                        <span className="mdm-medio-card__name">
                          {safeText(medio?.medio_pago_nombre || medio?.medio_pago || medio?.nombre)}
                        </span>

                        <span className="mdm-medio-card__meta">
                          <span className="mdm-medio-card__sub">
                            {medio?.id_cheque
                              ? `${safeText(medio?.cheque_tipo)} · cheque #${safeText(
                                  getChequeNumero(medio)
                                )}`
                              : "Pago registrado"}
                          </span>
                          <span className="mdm-medio-card__amount">{moneyARS(getMedioMontoVisible(medio))}</span>
                        </span>
                      </div>

                      {medio?.id_cheque ? (
                        <div className="mdm-cheque-extra">
                          <span>Emisor: {safeText(getChequeEmisor(medio))}</span>
                          <span>F. emisión: {formatFechaDMY(getChequeFechaEmision(medio))}</span>
                          <span>F. pago: {formatFechaDMY(getChequeFechaPago(medio))}</span>
                          {shouldShowMontoAplicado(medio) ? (
                            <span>Aplicado al movimiento: {moneyARS(getMedioMontoAplicado(medio))}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {medios.length > 0 ? (
                <div className="mdm-total-line mdm-total-line--chip">
                  <div className="mi-cr-totals mdm-total-paid-totals">
                    <div className="mi-cr-totalLine mi-cr-totalLine--total mdm-total-paid-chip">
                      <span>Total pagado</span>
                      <b>{moneyARS(totalMedios || totalMovimiento)}</b>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ModalDetalleMovimientoVenta(props) {
  return (
    <ModalDetalleMovimiento
      {...props}
      showCreditTrace
      unifiedItemsScroll
      title={props.title || "Detalle de venta"}
    />
  );
}

export function ModalDetalleMovimientoCompra(props) {
  return (
    <ModalDetalleMovimiento
      {...props}
      showCreditTrace
      unifiedItemsScroll
      creditTraceEntity="compra"
      title={props.title || "Detalle de compra"}
    />
  );
}

export function ModalDetalleMovimientoIngreso(props) {
  return (
    <ModalDetalleMovimiento
      {...props}
      hideTerceroYTipo
      showCreditTrace
      unifiedItemsScroll
      creditTraceEntity="ingreso"
      title={props.title || "Detalle de ingreso"}
    />
  );
}

export function ModalDetalleMovimientoEgreso(props) {
  return (
    <ModalDetalleMovimiento
      {...props}
      hideTerceroYTipo
      title={props.title || "Detalle de egreso"}
    />
  );
}
