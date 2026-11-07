import React, { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatQuantity, MAX_POR_LINEA, minFor, stepQuantity, validateQuantity } from '../carrito/utilidades/carrito';

const toText = (value, permiteDecimales) => (permiteDecimales ? String(Number(value)).replace('.', ',') : String(Math.trunc(Number(value) || 0)));

/**
 * Control de cantidad accesible. Respeta stock_unidades.permite_decimales:
 * enteros para productos por unidad; hasta 3 decimales para kg, l, m, etc.
 */
export default function SelectorCantidad({ value, onChange, permiteDecimales = false, max = MAX_POR_LINEA, unidad = 'u', label = 'Cantidad', compact = false, disabled = false, id }) {
  const autoId = useId();
  const inputId = id || `qty-${autoId}`;
  const errorId = `${inputId}-error`;
  const [text, setText] = useState(toText(value, permiteDecimales));
  const [error, setError] = useState(null);
  useEffect(() => { setText(toText(value, permiteDecimales)); }, [value, permiteDecimales]);

  const commit = () => {
    const r = validateQuantity(text, { permiteDecimales, max });
    if (r.ok) {
      setError(null);
      if (r.value !== Number(value)) onChange(r.value);
      setText(toText(r.value, permiteDecimales));
    } else if (r.value) { // supera el máximo: se ajusta y se avisa
      setError(r.error);
      onChange(r.value);
      setText(toText(r.value, permiteDecimales));
    } else {
      setError(r.error);
      setText(toText(value, permiteDecimales));
    }
  };
  const step = (dir) => {
    setError(null);
    onChange(stepQuantity(value, dir, { permiteDecimales, max }));
  };
  const atMin = Number(value) <= minFor(permiteDecimales) + 1e-9;
  const atMax = Number(value) >= Math.min(max ?? MAX_POR_LINEA, MAX_POR_LINEA) - 1e-9;
  const size = compact ? 14 : 16;
  return <div className="qty-wrap">
    <div className={compact ? 'cart-qty qty-control' : 'quantity-input qty-control'} role="group" aria-label={label}>
      <button type="button" disabled={disabled || atMin} aria-label="Disminuir cantidad" onClick={() => step(-1)}><Minus size={size}/></button>
      <input
        id={inputId}
        className="qty-field"
        value={text}
        disabled={disabled}
        inputMode={permiteDecimales ? 'decimal' : 'numeric'}
        aria-label={`${label} (${unidad})`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, '').slice(0, 10))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      />
      {permiteDecimales && <span className="qty-unit" aria-hidden="true">{unidad}</span>}
      <button type="button" disabled={disabled || atMax} aria-label="Aumentar cantidad" onClick={() => step(1)}><Plus size={size}/></button>
    </div>
    {error && <span id={errorId} className="qty-error" role="alert">{error}</span>}
    {!error && !compact && max < MAX_POR_LINEA && <span className="qty-hint">Disponible: {formatQuantity(max, permiteDecimales)} {unidad}</span>}
  </div>;
}
