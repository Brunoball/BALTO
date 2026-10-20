import React from "react";
import { normalizeStockInput } from "../utils/stockFormUtils";
import "./vencimientosAlta.css";

const emptyRow = () => ({ fecha_vencimiento: "", cantidad: "", referencia: "" });
const hasContent = (row) => Boolean(
  String(row?.fecha_vencimiento || "").trim() ||
  String(row?.cantidad ?? "").trim() ||
  String(row?.referencia || "").trim()
);

export const prepararVencimientosAlta = (rows = []) =>
  (Array.isArray(rows) ? rows : []).filter(hasContent).map((row) => ({
    fecha_vencimiento: String(row.fecha_vencimiento || "").trim(),
    cantidad: Number(String(row.cantidad ?? "").replace(",", ".")),
    referencia: String(row.referencia || "").trim(),
  }));

function esFechaReal(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

export function validarVencimientosAlta(rows = [], stock, permiteDecimales = true) {
  const seleccionadas = (Array.isArray(rows) ? rows : []).filter(hasContent);
  const stockNum = Number(String(stock ?? "").replace(",", "."));
  if (!seleccionadas.length) return "";
  if (!Number.isFinite(stockNum) || stockNum < 0) return "Ingresá un stock válido antes de cargar vencimientos.";
  let total = 0;
  for (const [index, row] of seleccionadas.entries()) {
    const label = `Partida #${index + 1}`;
    if (!esFechaReal(row.fecha_vencimiento)) return `${label}: ingresá una fecha de vencimiento válida.`;
    const raw = String(row.cantidad ?? "").trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,3})?$/.test(raw) || !(Number(raw) > 0)) {
      return `${label}: ingresá una cantidad mayor a cero (hasta tres decimales).`;
    }
    if (!permiteDecimales && !Number.isInteger(Number(raw))) {
      return `${label}: la unidad de stock no admite cantidades decimales.`;
    }
    if (String(row.referencia || "").length > 100) return `${label}: la referencia no puede superar los 100 caracteres.`;
    total += Number(raw);
  }
  if (total > stockNum + 0.000001) {
    return `Las cantidades con vencimiento (${Number(total.toFixed(3))}) superan el stock inicial (${stockNum}).`;
  }
  return "";
}

const cantidadTexto = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });

/** Campos de alta: un producto simple o cada variante puede contener N partidas. */
export default function VencimientosAltaFields({
  value = [], onChange, stock = 0, disabled = false, error = "", titulo = "Fechas de vencimiento",
}) {
  const rows = Array.isArray(value) ? value : [];
  const total = rows.reduce((sum, row) => sum + (Number(String(row?.cantidad ?? "").replace(",", ".")) || 0), 0);
  const stockNum = Number(String(stock ?? "").replace(",", ".")) || 0;
  const update = (index, patch) => onChange(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  return (
    <section className="cmi-vencAlta" aria-label={titulo}>
      <div className="cmi-vencAlta__head">
        <div>
          <strong>{titulo}</strong>
          <p>Opcional. Registrá la fecha y cantidad de cada partida. Podés agregar varias fechas para el mismo producto.</p>
        </div>
        <button type="button" className="cmi-vencAlta__add" disabled={disabled} onClick={() => onChange([...rows, emptyRow()])}>
          + Agregar vencimiento
        </button>
      </div>
      {rows.length > 0 ? (
        <div className="cmi-vencAlta__rows">
          {rows.map((row, i) => (
            <div className="cmi-vencAlta__row" key={i}>
              <label>Fecha de vencimiento
                <input aria-label={`Fecha de vencimiento #${i + 1}`} className="cmi-input" type="date" value={row.fecha_vencimiento || ""} disabled={disabled} onChange={(e) => update(i, { fecha_vencimiento: e.target.value })} />
              </label>
              <label>Cantidad
                <input aria-label={`Cantidad con vencimiento #${i + 1}`} className="cmi-input" inputMode="decimal" placeholder="Ej: 5" value={row.cantidad ?? ""} disabled={disabled} onChange={(e) => update(i, { cantidad: normalizeStockInput(e.target.value) })} />
              </label>
              <label>Referencia (opcional)
                <input aria-label={`Referencia vencimiento #${i + 1}`} className="cmi-input" maxLength={100} placeholder="Ej: partida de octubre" value={row.referencia || ""} disabled={disabled} onChange={(e) => update(i, { referencia: e.target.value })} />
              </label>
              <button type="button" className="cmi-vencAlta__remove" aria-label={`Quitar vencimiento #${i + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, index) => index !== i))}>Quitar</button>
            </div>
          ))}
        </div>
      ) : <p className="cmi-vencAlta__empty">Sin vencimientos cargados. Podés dejar el stock sin fecha asignada.</p>}
      <p className="cmi-vencAlta__summary">Stock con fecha: <b>{cantidadTexto(total)}</b> · Sin fecha asignada: <b>{cantidadTexto(Math.max(0, stockNum - total))}</b></p>
      {error ? <p className="cmi-vencAlta__error" role="alert">{error}</p> : null}
    </section>
  );
}
