import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clampText, decimalText, money } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

export default function ModalAjusteStock({ open, item, saving, onClose, onSave, onToast }) {
  const [form, setForm] = useState({ operacion: "SUMAR", cantidad: "", motivo: "" });
  useEffect(() => { if (open) setForm({ operacion: "SUMAR", cantidad: "", motivo: "" }); }, [open, item]);
  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });
  const nuevoStock = useMemo(() => {
    const actual = Number(item?.stock_actual || 0);
    const cantidad = Number(form.cantidad || 0);
    if (form.operacion === "SUMAR") return actual + cantidad;
    if (form.operacion === "RESTAR") return actual - cantidad;
    return cantidad;
  }, [item, form]);
  if (!open || !item) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (form.cantidad === "" || Number(form.cantidad) < 0) return onToast?.("error", "Indicá una cantidad válida.", 4200);
    if (form.operacion !== "ESTABLECER" && Number(form.cantidad) <= 0) return onToast?.("error", "La cantidad debe ser mayor a cero.", 4200);
    if (nuevoStock < 0) return onToast?.("error", "El stock no puede quedar negativo.", 4200);
    if (!form.motivo.trim()) return onToast?.("error", "Indicá el motivo del ajuste.", 4200);
    await onSave({ id_articulo: item.id_articulo, operacion: form.operacion, cantidad: form.cantidad, motivo: form.motivo });
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header"><div className="gm-modal-head-left"><h2 className="gm-modal-title">Ajustar stock</h2><p className="gm-modal-subtitle">{item.nombre}</p></div><button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button></header>
        <div className="gm-modal-content servicios-modal__content">
          <div className="servicios-stock-summary"><span>Existencia actual</span><strong>{Number(item.stock_actual || 0).toLocaleString("es-AR", { maximumFractionDigits: 6 })} {item.unidad_simbolo}</strong><small>Costo unitario: {money(item.costo_unitario)}</small></div>
          <div className="servicios-form-grid">
            <label className="gm-field servicios-field--span-6"><select className="gm-input gm-select" value={form.operacion} onChange={(e) => setForm((p) => ({ ...p, operacion: e.target.value }))}><option value="SUMAR">INGRESAR / SUMAR</option><option value="RESTAR">EGRESAR / RESTAR</option><option value="ESTABLECER">FIJAR EXISTENCIA</option></select><span className="gm-label gm-label--up">Operación</span></label>
            <label className="gm-field servicios-field--span-6"><input className="gm-input" autoFocus inputMode="decimal" value={form.cantidad} onChange={(e) => setForm((p) => ({ ...p, cantidad: decimalText(e.target.value, 6) }))} placeholder=" " /><span className="gm-label">Cantidad</span></label>
            <label className="gm-field servicios-field--wide"><textarea className="gm-input servicios-textarea" rows={3} maxLength={255} value={form.motivo} onChange={(e) => setForm((p) => ({ ...p, motivo: clampText(e.target.value, 255) }))} placeholder=" " /><span className="gm-label">Motivo del ajuste</span></label>
          </div>
          <div className={`gm-info-box ${nuevoStock < 0 ? "servicios-info-danger" : ""}`}>Nueva existencia: <strong>{nuevoStock.toLocaleString("es-AR", { maximumFractionDigits: 6 })} {item.unidad_simbolo}</strong></div>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions"><button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving || nuevoStock < 0}>{saving ? "Guardando..." : "Confirmar ajuste"}</button></footer>
      </form>
    </div>,
    document.body
  );
}
