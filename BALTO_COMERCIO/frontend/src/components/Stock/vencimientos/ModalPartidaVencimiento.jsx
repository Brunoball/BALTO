import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays, faFloppyDisk, faXmark, faBoxesStacked } from "@fortawesome/free-solid-svg-icons";
import { normalizeStockInput, toUpperCaseValue } from "../utils/stockFormUtils";
import { isTopStockModal } from "../modales/modalStackUtils";
import "./ModalPartidaVencimiento.css";

const EMPTY = { fecha_vencimiento: "", cantidad: "", referencia: "", observaciones: "" };
const formato = (value) => Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });

function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() + 1 === m && parsed.getUTCDate() === d;
}

/** Modal compartido entre alta (partida temporal) y edición (persistencia vía API). */
export default function ModalPartidaVencimiento({
  open, initialValue, onClose, onSave, busy = false, maxCantidad, stock,
  permiteDecimales = true, permitirObservaciones = false, subtitulo = "", onError,
}) {
  const overlayRef = useRef(null);
  const fechaRef = useRef(null);
  const [form, setForm] = useState(EMPTY);
  const [enviando, setEnviando] = useState(false);
  const bloqueo = busy || enviando;
  const editando = Number(initialValue?.id_vencimiento || 0) > 0 || Boolean(initialValue?.__editando);

  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY,
      ...(initialValue || {}),
      referencia: toUpperCaseValue(initialValue?.referencia),
      observaciones: toUpperCaseValue(initialValue?.observaciones),
    });
    const t = setTimeout(() => fechaRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || !isTopStockModal(overlayRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (!bloqueo) onClose?.();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, bloqueo, onClose]);

  if (!open) return null;

  const mostrarError = (mensaje) => {
    onError?.(mensaje);
  };

  const guardar = async (event) => {
    event.preventDefault();
    if (bloqueo) return;
    if (!fechaValida(form.fecha_vencimiento)) return mostrarError("Ingresá una fecha de vencimiento válida.");
    const raw = String(form.cantidad ?? "").replace(",", ".");
    if (!/^\d+(?:\.\d{1,3})?$/.test(raw) || Number(raw) <= 0) return mostrarError("Ingresá una cantidad mayor a cero (hasta 3 decimales).");
    const cantidad = Number(raw);
    if (!permiteDecimales && !Number.isInteger(cantidad)) return mostrarError("La unidad elegida no permite cantidades decimales.");
    if (Number.isFinite(Number(maxCantidad)) && maxCantidad !== undefined && cantidad > Number(maxCantidad) + 0.000001) {
      return mostrarError(`La cantidad supera el stock disponible para asignar (${formato(maxCantidad)}).`);
    }
    setEnviando(true);
    try {
      await onSave?.({
        ...form,
        cantidad: String(form.cantidad).trim(),
        referencia: toUpperCaseValue(form.referencia).trim(),
        observaciones: toUpperCaseValue(form.observaciones).trim(),
      });
      onClose?.();
    } catch (err) { mostrarError(err?.message || "No se pudo guardar la partida."); }
    finally { setEnviando(false); }
  };

  return createPortal(
    <div ref={overlayRef} data-stock-modal-overlay="true" className="mi-modal__overlay sv-partida-overlay">
      <section className="mi-modal__container sv-partida-modal" role="dialog" aria-modal="true" aria-labelledby="sv-partida-titulo" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi-modal__header sv-partida-header">
          <div className="mi-modal__head-icon" aria-hidden="true"><FontAwesomeIcon icon={faCalendarDays} /></div>
          <div className="mi-modal__head-left"><h2 className="mi-modal__title" id="sv-partida-titulo">{editando ? "Editar vencimiento" : "Agregar vencimiento"}</h2><p className="mi-modal__subtitle">{subtitulo || "Asigná una fecha y cantidad a la partida"}</p></div>
          <button type="button" className="mi-modal__close" aria-label="Cerrar modal de vencimiento" disabled={bloqueo} onClick={onClose}><FontAwesomeIcon icon={faXmark}/></button>
        </div>
        <form onSubmit={guardar} noValidate className="sv-partida-form">
          <div className="sv-partida-content">
            {stock !== undefined && <div className="sv-partida-stock"><FontAwesomeIcon icon={faBoxesStacked}/><span>Stock actual <strong>{formato(stock)}</strong></span>{maxCantidad !== undefined && <span>Disponible para asignar <strong>{formato(Math.max(0, maxCantidad))}</strong></span>}</div>}
            <div className="sv-partida-fields">
              <div className="cmi-floatingField"><label className="cmi-floatingLabel" htmlFor="sv-partida-fecha">Fecha de vencimiento *</label><input ref={fechaRef} id="sv-partida-fecha" className="cmi-input" type="date" onPointerDown={(event) => {
                  // Abrir el selector nativo desde cualquier punto sin modificar su icono.
                  if (event.button !== 0 || bloqueo) return;
                  const input = event.currentTarget;
                  if (typeof input.showPicker !== "function") return;
                  event.preventDefault();
                  input.focus();
                  try { input.showPicker(); } catch { /* El icono nativo sigue disponible. */ }
                }} required value={form.fecha_vencimiento || ""} onChange={(e) => { setForm(p => ({ ...p, fecha_vencimiento: e.target.value })) }} disabled={bloqueo}/></div>
              <div className="cmi-floatingField"><label className="cmi-floatingLabel" htmlFor="sv-partida-cantidad">Cantidad *</label><input id="sv-partida-cantidad" className="cmi-input" inputMode="decimal" placeholder="Ej: 5" required value={form.cantidad ?? ""} onChange={(e) => { setForm(p => ({ ...p, cantidad: normalizeStockInput(e.target.value) })) }} disabled={bloqueo}/></div>
              <div className="cmi-floatingField sv-partida-full"><label className="cmi-floatingLabel" htmlFor="sv-partida-referencia">Referencia (opcional)</label><input id="sv-partida-referencia" className="cmi-input" maxLength={100} placeholder="Ej: Lote octubre" value={form.referencia || ""} onChange={(e) => { setForm(p => ({ ...p, referencia: toUpperCaseValue(e.target.value) })) }} disabled={bloqueo}/></div>
              {permitirObservaciones && <div className="cmi-floatingField sv-partida-full"><label className="cmi-floatingLabel" htmlFor="sv-partida-observaciones">Observación (opcional)</label><textarea id="sv-partida-observaciones" className="cmi-input cmi-textarea" rows={2} maxLength={255} placeholder="Ej: proveedor" value={form.observaciones || ""} onChange={(e) => { setForm(p => ({ ...p, observaciones: toUpperCaseValue(e.target.value) })) }} disabled={bloqueo}/></div>}
            </div>
          </div>
          <footer className="sv-partida-footer"><button type="button" className="mit-btn mit-btn--ghost" disabled={bloqueo} onClick={onClose}>Cancelar</button><button type="submit" className="mit-btn mit-btn--solid" disabled={bloqueo}><FontAwesomeIcon icon={faFloppyDisk}/> {bloqueo ? "Guardando..." : editando ? "Guardar cambios" : "Agregar vencimiento"}</button></footer>
        </form>
      </section>
    </div>, document.body
  );
}
