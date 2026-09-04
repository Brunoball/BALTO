import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import useServiciosGlobalModal from "../../Servicios/modales/useServiciosGlobalModal";

export default function ModalDetalleLista({ open, item, saving, onClose, onSave, onToast }) {
  const [nombre, setNombre] = useState("");
  useEffect(() => {
    if (open) setNombre(item?.nombre || "");
  }, [open, item]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });
  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const limpio = String(nombre || "").trim();
    if (!limpio) return onToast?.("error", "Completá el nombre del detalle.", 4200);
    await onSave({ id_detalle: item?.id_detalle, nombre: limpio });
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar detalle" : "Agregar detalle"}</h2>
            <p className="gm-modal-subtitle">Estará disponible en los desplegables de otros ingresos y egresos.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </header>
        <div className="gm-modal-content servicios-modal__content">
          <label className="gm-field">
            <input className="gm-input" autoFocus maxLength={150} value={nombre} onChange={(event) => setNombre(event.target.value.toUpperCase())} placeholder=" " />
            <span className="gm-label">Nombre del detalle</span>
          </label>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : "Guardar detalle"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
