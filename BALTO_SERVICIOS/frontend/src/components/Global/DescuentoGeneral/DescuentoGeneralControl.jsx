import React, { useId } from "react";
import "./DescuentoGeneralControl.css";
import {
  DESCUENTO_MONTO,
  DESCUENTO_PORCENTAJE,
  formatPorcentaje,
} from "../../../utils/descuentoGeneral.js";

function defaultMoney(v) {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Descuento general de una venta o presupuesto (ajuste comercial sobre el
 * total; NO es un renglón ni modifica los precios cargados).
 *
 * Controlado: el padre guarda `tipo` y `valor` y calcula `resumen` con
 * src/utils/descuentoGeneral.js. Las etiquetas accesibles ("Tipo de descuento",
 * "Valor del descuento", "Quitar descuento") son estables para Playwright.
 */
export default function DescuentoGeneralControl({
  tipo = DESCUENTO_PORCENTAJE,
  valor = "",
  resumen,
  onTipoChange,
  onValorChange,
  onQuitar,
  disabled = false,
  money = defaultMoney,
  contexto = "la operación",
  className = "",
}) {
  const uid = useId();
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  const descuento = Number(resumen?.descuento || 0);
  const totalBruto = Number(resumen?.totalBruto || 0);
  const totalFinal = Number(resumen?.total || 0);
  const error = String(resumen?.descuentoError || "");
  const activo = descuento > 0;
  const hayValor = String(valor ?? "").trim() !== "";

  return (
    <div
      className={["dg-box", activo ? "is-active" : "", error ? "has-error" : "", className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Descuento general"
      data-testid="descuento-general"
    >
      <div className="dg-box__head">
        <div>
          <strong>Descuento general</strong>
          <span id={hintId}>Se aplica sobre el total de {contexto}. No modifica los precios cargados.</span>
        </div>
        {hayValor ? (
          <button
            type="button"
            className="dg-box__clear"
            onClick={() => onQuitar?.()}
            disabled={disabled}
            aria-label="Quitar descuento"
            title="Quitar descuento"
          >
            Quitar
          </button>
        ) : null}
      </div>

      <div className="dg-box__controls">
        <select
          className="gm-input gm-select dg-box__type"
          value={tipo}
          onChange={(e) => onTipoChange?.(e.target.value === DESCUENTO_MONTO ? DESCUENTO_MONTO : DESCUENTO_PORCENTAJE)}
          disabled={disabled}
          aria-label="Tipo de descuento"
        >
          <option value={DESCUENTO_PORCENTAJE}>Porcentaje (%)</option>
          <option value={DESCUENTO_MONTO}>Monto fijo ($)</option>
        </select>
        <div className="dg-box__input-wrap">
          <span aria-hidden="true">{tipo === DESCUENTO_PORCENTAJE ? "%" : "$"}</span>
          <input
            className="gm-input dg-box__input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(e) => onValorChange?.(e.target.value)}
            placeholder="0"
            disabled={disabled}
            aria-label="Valor del descuento"
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          />
        </div>
      </div>

      {error ? (
        <div className="dg-box__error" id={errorId} role="alert" data-testid="dg-error">
          {error}
        </div>
      ) : null}

      <dl className="dg-box__summary" aria-live="polite">
        <div>
          <dt>Total original</dt>
          <dd data-testid="dg-total-original">{money(totalBruto)}</dd>
        </div>
        {activo ? (
          <>
            <div className="is-discount">
              <dt>
                Descuento
                {resumen?.descuentoTipo === DESCUENTO_PORCENTAJE
                  ? ` (${formatPorcentaje(resumen?.descuentoValor)} %)`
                  : ""}
              </dt>
              <dd data-testid="dg-descuento-monto">- {money(descuento)}</dd>
            </div>
            {resumen?.descuentoTipo === DESCUENTO_MONTO ? (
              <div className="is-equivalent">
                <dt>Equivale a</dt>
                <dd data-testid="dg-porcentaje-equivalente">{formatPorcentaje(resumen?.descuentoPorcentajeEfectivo)} %</dd>
              </div>
            ) : null}
            <div className="is-final">
              <dt>Total final</dt>
              <dd data-testid="dg-total-final">{money(totalFinal)}</dd>
            </div>
          </>
        ) : (
          <div className="is-none">
            <dt>Descuento</dt>
            <dd>Sin descuento aplicado</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
