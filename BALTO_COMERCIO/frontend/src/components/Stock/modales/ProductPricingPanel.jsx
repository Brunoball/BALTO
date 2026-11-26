import React, { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMoneyBillTrendUp, faTriangleExclamation, faArrowTrendDown } from "@fortawesome/free-solid-svg-icons";
import {
  calculateGrossProfitability,
  formatProfitMoney,
  formatProfitPercent,
  parsePriceAmount,
} from "../utils/grossProfitability";
import "./ProductPricingPanel.css";

/**
 * Pestaña "Precios principales" del alta individual y de la edición de productos.
 *
 * El comerciante define manualmente el precio de costo y el precio de venta;
 * este panel sólo INFORMA la rentabilidad bruta (lectura). No sugiere precios,
 * no tiene botones de aplicar y no modifica ningún importe.
 *
 * Los inputs llegan armados desde cada modal (costField / priceField /
 * promoField) para conservar su comportamiento de foco, escritura, Enter y blur.
 */
const SUBTITLE =
  "Ingresá el precio de costo y el precio de venta. La rentabilidad bruta del producto se calculará automáticamente.";
const SUBTITLE_VARIANTES =
  "Este producto usa variantes: el precio general queda bloqueado para no pisar los precios de Tienda Nube. Cargá precio y stock en cada variante; el SKU es opcional.";

export const AVISO_VENTA_BAJO_COSTO =
  "Atención: el precio de venta es inferior al costo de adquisición del producto.";
export const AVISO_PROMO_BAJO_COSTO =
  "Atención: el precio promocional es inferior al costo de adquisición del producto.";

function Indicator({ label, hint, value, testId, highlight = false, negative = false }) {
  return (
    <div
      className={`ppp-kpi ${highlight ? "ppp-kpi--main" : "ppp-kpi--secondary"} ${negative ? "ppp-kpi--negative" : ""}`}
      title={hint}
    >
      <span className="ppp-kpi__label">{label}</span>
      <strong className="ppp-kpi__value" data-testid={testId} aria-live="polite">
        {value}
      </strong>
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
              highlight
              negative={ventaNegativa}
              label="Ganancia bruta por unidad"
              hint="Precio de venta menos precio de costo."
              value={formatProfitMoney(venta.profit)}
              testId="stock-rentabilidad-ganancia"
            />
            <Indicator
              highlight
              negative={ventaNegativa}
              label="Margen bruto sobre venta"
              hint="Qué parte del precio de venta es ganancia."
              value={formatProfitPercent(venta.marginPct)}
              testId="stock-rentabilidad-margen"
            />
          </div>
          <Indicator
            negative={ventaNegativa}
            label="Recargo sobre costo"
            hint="Cuánto se agrega sobre el precio de costo."
            value={formatProfitPercent(venta.markupPct)}
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
              negative={promoNegativa}
              label="Ganancia promocional"
              hint="Precio promocional menos precio de costo."
              value={formatProfitMoney(promocion.profit)}
              testId="stock-rentabilidad-promo-ganancia"
            />
            <Indicator
              negative={promoNegativa}
              label="Margen promocional"
              hint="Qué parte del precio promocional es ganancia."
              value={formatProfitPercent(promocion.marginPct)}
              testId="stock-rentabilidad-promo-margen"
            />
          </div>
        ) : null}
      </div>
      {!usesVariants && promocion?.belowCost ? (
        <LossWarning text={AVISO_PROMO_BAJO_COSTO} testId="stock-rentabilidad-promo-alerta" />
      ) : null}
    </div>
  );
}
