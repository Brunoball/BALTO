import React, { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faBoxOpen } from "@fortawesome/free-solid-svg-icons";
import VencimientosResumen from "./VencimientosResumen";
import { toUpperCaseValue } from "../utils/stockFormUtils";
import ModalPartidaVencimiento from "./ModalPartidaVencimiento";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import VencimientosTabla, { fechaVencimientoTexto } from "./VencimientosTabla";
import "./vencimientosAlta.css";

const hasContent = (row) => Boolean(
  String(row?.fecha_vencimiento || "").trim() ||
  String(row?.cantidad ?? "").trim() ||
  String(row?.referencia || "").trim()
);

export const prepararVencimientosAlta = (rows = []) =>
  (Array.isArray(rows) ? rows : []).filter(hasContent).map((row) => ({
    fecha_vencimiento: String(row.fecha_vencimiento || "").trim(),
    cantidad: Number(String(row.cantidad ?? "").replace(",", ".")),
    referencia: toUpperCaseValue(row.referencia).trim(),
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
  if (total > stockNum + 0.000001) return `Las cantidades con vencimiento (${Number(total.toFixed(3))}) superan el stock inicial (${stockNum}).`;
  return "";
}

/** Alta: no guarda hasta que se confirma el producto; cada partida se edita en un modal. */
export default function VencimientosAltaFields({
  value = [], onChange, onToast, stock = 0, disabled = false, titulo = "Fechas de vencimiento", permiteDecimales = true,
}) {
  const rows = Array.isArray(value) ? value : [];
  const [editor, setEditor] = useState(null);
  const [indiceAQuitar, setIndiceAQuitar] = useState(null);
  const total = rows.reduce((sum, row) => sum + (Number(String(row?.cantidad ?? "").replace(",", ".")) || 0), 0);
  const stockNum = Number(String(stock ?? "").replace(",", ".")) || 0;
  const editando = editor !== null && editor >= 0;
  const disponibles = Math.max(0, stockNum - total + (editando ? Number(String(rows[editor]?.cantidad || 0).replace(",", ".")) || 0 : 0));
  // Evita reinicializar el modal cuando el toast provoca un re-render del alta.
  const partidaInicial = useMemo(() => editando ? { ...rows[editor], __editando: true } : null, [editando, editor, rows]);
  const guardar = (partida) => {
    const siguientes = editando ? rows.map((r, i) => i === editor ? { ...r, ...partida } : r) : [...rows, partida];
    const validacion = validarVencimientosAlta(siguientes, stock, permiteDecimales);
    if (validacion) throw new Error(validacion);
    onChange(siguientes);
    onToast?.(editando ? "Partida actualizada en la carga pendiente." : "Partida agregada a la carga pendiente.", "exito");
  };
  return (
    <section className="cmi-vencAlta" aria-label={titulo}>
      <div className="sv-section-head"><div><h3>{titulo}</h3><p>Asigná fechas a partidas del stock inicial. Se registrarán al guardar el producto.</p></div>
        <button type="button" className="sv-primaryBtn" onClick={() => setEditor(-1)} disabled={disabled}><FontAwesomeIcon icon={faPlus}/> Agregar vencimiento</button>
      </div>
      <VencimientosResumen stock={stockNum} asignadas={total}/>
      <div className="sv-list-head"><h4>Partidas cargadas <span className="sv-count">{rows.length}</span></h4></div>
      {rows.length
        ? <VencimientosTabla
            partidas={rows}
            esAlta
            disabled={disabled}
            onEditar={(_, index) => setEditor(index)}
            onQuitar={(_, index) => setIndiceAQuitar(index)}
          />
        : <div className="sv-empty"><FontAwesomeIcon icon={faBoxOpen}/><strong>Sin vencimientos cargados</strong><span>Podés agregarlos ahora o dejar el stock sin fecha asignada.</span></div>}
      <ModalEliminar
        open={indiceAQuitar !== null && !!rows[indiceAQuitar]}
        loading={disabled}
        onClose={() => setIndiceAQuitar(null)}
        onToast={(tipo, mensaje, duracion) => onToast?.(mensaje, tipo, duracion)}
        loadingMessage="Quitando partida de la carga..."
        successMessage="Partida quitada de la carga pendiente."
        errorMessage="No se pudo quitar la partida."
        onConfirm={() => {
          if (indiceAQuitar === null || !rows[indiceAQuitar]) return;
          onChange(rows.filter((_, index) => index !== indiceAQuitar));
          setIndiceAQuitar(null);
        }}
        title="Quitar vencimiento"
        message="¿Querés quitar esta partida del producto que estás creando?"
        warning="Solo se quitará de la carga pendiente. El stock inicial del producto no se modifica."
        confirmLabel="Quitar partida"
        details={indiceAQuitar !== null && rows[indiceAQuitar] ? [
          { label: "Vencimiento", value: fechaVencimientoTexto(rows[indiceAQuitar].fecha_vencimiento) },
          { label: "Cantidad", value: String(rows[indiceAQuitar].cantidad ?? "—") },
          { label: "Referencia", value: rows[indiceAQuitar].referencia || "—" },
        ] : []}
      />
      <ModalPartidaVencimiento
        open={editor !== null} initialValue={partidaInicial}
        onClose={() => setEditor(null)} onSave={guardar} stock={stockNum} maxCantidad={disponibles}
        permiteDecimales={permiteDecimales} subtitulo={titulo}
        onError={(mensaje) => onToast?.(mensaje, "error", 4200)}
      />
    </section>
  );
}
