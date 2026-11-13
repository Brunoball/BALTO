import React, { useId } from "react";
import {
  TIPO_MOVIMIENTO_STOCK_OPCIONES,
  TIPO_MOV_NO_MUEVE_STOCK,
  normalizarTipoMovimientoStock,
} from "./tipoMovimientoStock.js";
import "./TipoMovimientoStock.css";

/**
 * Selector "TIPO DE MOVIMIENTO" de cada renglón (arriba del producto).
 * Únicamente dos opciones: "MUEVE STOCK" (predeterminada) y "NO MUEVE STOCK".
 */
export default function TipoMovimientoStockSelect({ value, onChange, disabled = false, rowNumber, testId }) {
  const id = useId();
  const tipo = normalizarTipoMovimientoStock(value);
  return (
    <div className={`gm-tipo-mov${tipo === TIPO_MOV_NO_MUEVE_STOCK ? " gm-tipo-mov--sin-stock" : ""}`}>
      <label className="gm-tipo-mov__label" htmlFor={id}>TIPO DE MOVIMIENTO</label>
      <select
        id={id}
        className="gm-tipo-mov__select"
        value={tipo}
        onChange={(e) => onChange?.(normalizarTipoMovimientoStock(e.target.value))}
        disabled={disabled}
        aria-label={rowNumber ? `Tipo de movimiento fila ${rowNumber}` : "Tipo de movimiento"}
        data-testid={testId || "tipo-movimiento-stock"}
      >
        {TIPO_MOVIMIENTO_STOCK_OPCIONES.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>
    </div>
  );
}
