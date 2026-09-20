import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import useServiciosGlobalModal from "../../Servicios/modales/useServiciosGlobalModal";

export default function ModalMedioPago({ open, item, saving, onClose, onSave, onToast }) {
  const [nombre, setNombre] = useState("");

  useEffect(() => {
    if (open) setNombre(item?.nombre || "");
  }, [open, item]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });
  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const limpio = String(nombre || "").replace(/\s+/g, " ").trim().toUpperCase();
    if (!limpio) return onToast?.("error", "Completá el nombre del medio de pago.", 4200);
    await onSave({ id_medio_pago: item?.id_medio_pago, nombre: limpio });
  };

  const protegido = Number(item?.protegido_sistema || 0) === 1;

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label={item ? "Editar medio de pago" : "Agregar medio de pago"}>
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar medio de pago" : "Agregar medio de pago"}</h2>
            <p className="gm-modal-subtitle">
              {protegido
                ? "Este medio pertenece a la operatoria interna de cheques. Podés ajustar el nombre, pero debe conservar su identificación CHEQUE/eCheq."
                : "Quedará disponible en los desplegables de cobros, pagos y saldos iniciales."}
            </p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </header>
        <div className="gm-modal-content servicios-modal__content">
          <label className="gm-field">
            <input
              className="gm-input"
              autoFocus
              maxLength={150}
              value={nombre}
              onChange={(event) => setNombre(event.target.value.toUpperCase())}
              placeholder=" "
            />
            <span className="gm-label">Nombre del medio de pago</span>
          </label>
          {protegido && (
            <div className="gm-info-box" role="note">
              CHEQUE y ECHEQ no se pueden dar de baja ni eliminar porque son utilizados por la cartera y el flujo de cheques.
            </div>
          )}
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : "Guardar medio"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
