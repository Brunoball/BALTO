import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoneyBillTrendUp, faTriangleExclamation, faArrowTrendDown } from "@fortawesome/free-solid-svg-icons";
import {
  calculateGrossProfitability,
  formatIndicatorForEdit,
  formatPriceForInput,
  formatProfitMoney,
  formatProfitPercent,
  parsePriceAmount,
  priceFromProfitability,
} from "../utils/grossProfitability";
import { normalizeMoneyInput } from "../utils/moneyInput";
import "./ProductPricingPanel.css";

/**
 * Pestaña "Precios principales" del alta individual y de la edición de productos.
 *
 * El comerciante define el precio de costo y el precio de venta, y el panel
 * muestra la rentabilidad bruta. La ganancia, el margen y el recargo también se
 * pueden EDITAR a mano: al escribir uno se recalcula sólo el precio de ese
 * bloque (venta o promoción) mediante `onPriceChange(campo, importe)`.
 * El costo nunca se modifica desde un indicador.
 *
 * - Mientras se escribe, el precio se actualiza en vivo si el valor es válido.
 * - Si al salir el valor quedó vacío o inválido (p. ej. margen >= 100%), o si se
 *   presiona Escape, se restaura el precio que había al entrar al indicador.
 * - Sin `onPriceChange` o con `editDisabled`, los indicadores son de lectura.
 *
 * Los inputs de precio llegan armados desde cada modal (costField / priceField /
 * promoField) para conservar su comportamiento de foco, escritura, Enter y blur.
 */
const SUBTITLE =
  "Ingresá el precio de costo y el precio de venta, o editá la ganancia, el margen o el recargo y el precio se calcula solo.";
const SUBTITLE_VARIANTES =
  "Este producto usa variantes: el precio general queda bloqueado para no pisar los precios de Tienda Nube. Cargá precio y stock en cada variante; el SKU es opcional.";

export const AVISO_VENTA_BAJO_COSTO =
  "Atención: el precio de venta es inferior al costo de adquisición del producto.";
export const AVISO_PROMO_BAJO_COSTO =
  "Atención: el precio promocional es inferior al costo de adquisición del producto.";

const FORMATTERS = {
  profit: formatProfitMoney,
  marginPct: formatProfitPercent,
  markupPct: formatProfitPercent,
};

/**
 * Indicador de rentabilidad. Fuera de foco muestra el valor formateado
 * ("$ 12.941,32", "60,36%"); al enfocarlo se edita el número plano ("60,36").
 */
function Indicator({
  label,
  hint,
  kind,
  value,
  testId,
  highlight = false,
  negative = false,
  editable = false,
  cost,
  field,
  currentPrice,
  onPriceChange,
}) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const precioAlEntrar = useRef(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const inputRef = useRef(null);
  const seleccionarAlRender = useRef(false);

  // Al enfocar, el valor pasa de "60,36%" a "60,36": se selecciona recién
  // después de ese render (sincrónico) para que escribir reemplace el número
  // sin carreras con la escritura (mismo cuidado que PriceInput).
  useLayoutEffect(() => {
    if (!seleccionarAlRender.current) return;
    seleccionarAlRender.current = false;
    const input = inputRef.current;
    if (input && document.activeElement === input) {
      try { input.select(); } catch { /* sin selección posible */ }
    }
  }, [draft]);

  const display = draft !== null ? draft : FORMATTERS[kind](value);

  const restaurar = () => {
    if (precioAlEntrar.current !== null && onPriceChange) {
      onPriceChange(field, precioAlEntrar.current);
    }
  };

  const terminar = () => {
    precioAlEntrar.current = null;
    setDraft(null);
    setError("");
  };

  const handleFocus = () => {
    if (!editable) return;
    precioAlEntrar.current = currentPrice ?? "";
    // Un indicador negativo (venta bajo costo) no se edita como negativo:
    // se arranca vacío y el comerciante escribe el valor que quiere.
    seleccionarAlRender.current = true;
    setDraft(value !== null && value >= 0 ? formatIndicatorForEdit(value) : "");
  };

  const handleChange = (e) => {
    if (!editable) return;
    const next = normalizeMoneyInput(e.target.value);
    setDraft(next);
    if (next === "") {
      setError("");
      return;
    }
    const result = priceFromProfitability(kind, cost, next);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError("");
    onPriceChange(field, formatPriceForInput(result.price));
  };

  const handleBlur = () => {
    if (draft === null) return;
    const invalido = draft === "" || !!error;
    if (editable && invalido) restaurar();
    terminar();
  };

  const handleKeyDown = (e) => {
    if (!editable) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      // Escape descarta lo escrito sin cerrar el modal.
      e.preventDefault();
      e.stopPropagation();
      restaurar();
      terminar();
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className={[
        "ppp-kpi",
        highlight ? "ppp-kpi--main" : "ppp-kpi--secondary",
        negative ? "ppp-kpi--negative" : "",
        editable ? "ppp-kpi--editable" : "",
        display !== "" && display != null ? "ppp-kpi--filled" : "",
        error ? "ppp-kpi--error" : "",
      ].filter(Boolean).join(" ")}
      title={editable ? `${hint} Podés editarlo y el precio se recalcula.` : hint}
    >
      <label className="ppp-kpi__label" htmlFor={inputId}>{label}</label>
      <input
        ref={inputRef}
        id={inputId}
        className="ppp-kpi__value ppp-kpi__input"
        data-testid={testId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        aria-invalid={error ? "true" : "false"}
        aria-describedby={error ? errorId : undefined}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {error ? (
        <small className="ppp-kpi__error" id={errorId} role="alert" data-testid={`${testId}-error`}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

function LossWarning({ text, testId }) {
  return (
    <div className="ppp-warning" role="status" data-testid={testId}>
      <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export default function ProductPricingPanel({
  costField,
  priceField,
  promoField,
  cost,
  price,
  promo,
  usesVariants = false,
  onPriceChange,
  editDisabled = false,
  onToast,
}) {
  const venta = useMemo(() => calculateGrossProfitability(cost, price), [cost, price]);
  const promoValida = parsePriceAmount(promo) !== null;
  const promocion = useMemo(
    () => (promoValida ? calculateGrossProfitability(cost, promo) : null),
    [cost, promo, promoValida]
  );

  const sinCosto = venta.cost === null;
  const ventaNegativa = venta.profit !== null && venta.profit < 0;
  const promoNegativa = !!promocion && promocion.profit !== null && promocion.profit < 0;

  // Avisar una sola vez por episodio de promoción bajo costo, evitando
  // notificaciones por valores transitorios mientras se escribe.
  const promoAvisada = useRef(false);
  const toastRef = useRef(onToast);
  useLayoutEffect(() => { toastRef.current = onToast; }, [onToast]);
  const promoBajoCosto = !usesVariants && !!promocion?.belowCost;
  useEffect(() => {
    if (!promoBajoCosto) {
      promoAvisada.current = false;
      return;
    }
    if (promoAvisada.current) return;
    const timer = setTimeout(() => {
      if (toastRef.current) {
        toastRef.current(AVISO_PROMO_BAJO_COSTO, "advertencia", 5000);
        promoAvisada.current = true;
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [promoBajoCosto, promo, cost]);

  // Editable: hay callback, el modal no bloquea precios y hay costo cargado.
  // Los porcentajes además necesitan costo > 0 (con costo 0 no definen un precio).
  const puedeEditar = typeof onPriceChange === "function" && !editDisabled && !usesVariants;
  const editableGanancia = puedeEditar && venta.cost !== null;
  const editablePct = puedeEditar && venta.cost !== null && venta.cost > 0;

  const comunesVenta = { cost, field: "precio", currentPrice: price, onPriceChange };
  const comunesPromo = { cost, field: "precio_promo", currentPrice: promo, onPriceChange };

  return (
    <div className="ppp" data-testid="stock-pricing-panel">
      <div className="cmi-mainPricing__head">
        <div className="cmi-mainPricing__heading">
          <span className="cmi-mainPricing__icon" aria-hidden="true">
            <FontAwesomeIcon icon={faMoneyBillTrendUp} />
          </span>
          <div>
            <div className="cmi-priceBlock__title">Precios principales</div>
            <p className="cmi-priceBlock__subtitle">{usesVariants ? SUBTITLE_VARIANTES : SUBTITLE}</p>
          </div>
        </div>
      </div>

      <div className="ppp__row">
        {costField}
        {priceField}
      </div>

      {!usesVariants ? (
        <section
          className={`ppp-profit ${ventaNegativa ? "ppp-profit--loss" : ""}`}
          aria-label="Rentabilidad bruta del producto"
          data-testid="stock-rentabilidad"
        >
          <div className="ppp-profit__head">
            <span>Rentabilidad bruta del producto</span>
            {ventaNegativa ? (
              <span className="ppp-badge ppp-badge--loss" data-testid="stock-rentabilidad-perdida">
                <FontAwesomeIcon icon={faArrowTrendDown} aria-hidden="true" /> Pérdida
              </span>
            ) : null}
          </div>
          <div className="ppp-profit__main">
            <Indicator
              {...comunesVenta}
              highlight
              kind="profit"
              editable={editableGanancia}
              negative={ventaNegativa}
              label="Ganancia bruta por unidad"
              hint="Precio de venta menos precio de costo."
              value={venta.profit}
              testId="stock-rentabilidad-ganancia"
            />
            <Indicator
              {...comunesVenta}
              highlight
              kind="marginPct"
              editable={editablePct}
              negative={ventaNegativa}
              label="Margen bruto sobre venta"
              hint="Qué parte del precio de venta es ganancia."
              value={venta.marginPct}
              testId="stock-rentabilidad-margen"
            />
          </div>
          <Indicator
            {...comunesVenta}
            kind="markupPct"
            editable={editablePct}
            negative={ventaNegativa}
            label="Recargo sobre costo"
            hint="Cuánto se agrega sobre el precio de costo."
            value={venta.markupPct}
            testId="stock-rentabilidad-recargo"
          />
          {sinCosto && venta.price !== null ? (
            <small className="ppp-profit__hint">Cargá el precio de costo para ver la rentabilidad.</small>
          ) : null}
          {venta.belowCost ? <LossWarning text={AVISO_VENTA_BAJO_COSTO} testId="stock-rentabilidad-alerta" /> : null}
        </section>
      ) : null}

      <div className="ppp-promo">
        <div className="ppp-promo__field">{promoField}</div>
        {!usesVariants && promocion ? (
          <div
            className={`ppp-promo__result ${promoNegativa ? "ppp-promo__result--loss" : ""}`}
            aria-label="Rentabilidad del precio promocional"
            data-testid="stock-rentabilidad-promo"
          >
            <Indicator
              {...comunesPromo}
              kind="profit"
              editable={editableGanancia}
              negative={promoNegativa}
              label="Ganancia promocional"
              hint="Precio promocional menos precio de costo."
              value={promocion.profit}
              testId="stock-rentabilidad-promo-ganancia"
            />
            <Indicator
              {...comunesPromo}
              kind="marginPct"
              editable={editablePct}
              negative={promoNegativa}
              label="Margen promocional"
              hint="Qué parte del precio promocional es ganancia."
              value={promocion.marginPct}
              testId="stock-rentabilidad-promo-margen"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
