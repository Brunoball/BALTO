import React from "react";
import {
  TIPO_MOVIMIENTO_STOCK_OPCIONES,
  normalizarTipoMovimientoStock,
} from "./tipoMovimientoStock.js";
import "./TipoMovimientoStock.css";

/**
 * Selector por renglón con el mismo marcado y espaciado que el selector de
 * tipo de ítem de BALTO Servicios (ModalNuevaVenta).
 */
export default function TipoMovimientoStockSelect({ value, onChange, disabled = false, rowNumber, testId }) {
  const tipo = normalizarTipoMovimientoStock(value);

  return (
    <select
      className="gm-cell-input gm-cell-input--select gm-tipo-mov__select"
      value={tipo}
      onChange={(e) => onChange?.(normalizarTipoMovimientoStock(e.target.value))}
      disabled={disabled}
      aria-label={rowNumber ? `Tipo de movimiento fila ${rowNumber}` : "Tipo de movimiento"}
      data-testid={testId || "tipo-movimiento-stock"}
      style={{ marginBottom: 6 }}
    >
      {TIPO_MOVIMIENTO_STOCK_OPCIONES.map((op) => (
        <option key={op.value} value={op.value}>{op.label}</option>
      ))}
    </select>
  );
}
