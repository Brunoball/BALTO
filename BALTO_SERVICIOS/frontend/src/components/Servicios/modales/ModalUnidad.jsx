import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clampText } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

export default function ModalUnidad({ open, item, saving, onClose, onSave, onToast }) {
  const [form, setForm] = useState({ nombre: "", simbolo: "" });

  useEffect(() => {
    if (open) setForm({ nombre: item?.nombre || "", simbolo: item?.simbolo || "" });
  }, [open, item]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });
  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim() || !form.simbolo.trim()) return onToast?.("error", "Nombre y símbolo son obligatorios.", 4200);
    await onSave({ ...form, id_unidad: item?.id_unidad });
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header"><div className="gm-modal-head-left"><h2 className="gm-modal-title">{item ? "Editar unidad" : "Agregar unidad"}</h2><p className="gm-modal-subtitle">Las unidades se mantienen simples: nombre y símbolo.</p></div><button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button></header>
        <div className="gm-modal-content servicios-modal__content"><div className="servicios-form-grid">
          <label className="gm-field servicios-field--span-8"><input className="gm-input" autoFocus maxLength={80} value={form.nombre} onChange={(e) => setForm((p) => ({ ...p, nombre: clampText(e.target.value, 80) }))} placeholder=" " /><span className="gm-label">Nombre</span></label>
          <label className="gm-field servicios-field--span-4"><input className="gm-input" maxLength={20} value={form.simbolo} onChange={(e) => setForm((p) => ({ ...p, simbolo: clampText(e.target.value, 20) }))} placeholder=" " /><span className="gm-label">Símbolo</span></label>
        </div></div>
        <footer className="gm-modal-footer gm-view-footer-actions"><button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : "Guardar unidad"}</button></footer>
      </form>
    </div>,
    document.body
  );
}
