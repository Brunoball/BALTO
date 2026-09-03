import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clampText } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

const EMPTY_FORM = { nombre: "", descripcion: "" };

export default function ModalAgregarCategoria({
  open,
  titulo = "Agregar categoría",
  subtitulo = "Creá una categoría sin salir del formulario actual.",
  initialValues = null,
  submitLabel = "Agregar categoría",
  saving = false,
  onClose,
  onSave,
  onToast,
}) {
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!open) return;
    setForm({
      nombre: initialValues?.nombre || "",
      descripcion: initialValues?.descripcion || "",
    });
  }, [open, initialValues, titulo]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({
    open,
    busy: saving,
    onClose,
  });

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();

    const nombre = String(form.nombre || "").trim();
    if (!nombre) {
      onToast?.("error", "Completá el nombre de la categoría.", 4200);
      return;
    }

    try {
      await onSave?.({
        nombre,
        descripcion: String(form.descripcion || "").trim(),
      });
    } catch {
      // El contenedor informa el error mediante el Toast global.
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="gm-modal-overlay servicios-modal-backdrop--above"
      data-servicios-modal-overlay="true"
      onMouseDown={cerrarDesdeFondo}
    >
      <form
        className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal servicios-quick-category-modal"
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="servicios-quick-category-title"
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="servicios-quick-category-title">{titulo}</h2>
            <p className="gm-modal-subtitle">{subtitulo}</p>
          </div>
          <button
            type="button"
            className="gm-modal-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        <div className="gm-modal-content servicios-modal__content servicios-quick-category-modal__content">
          <label className="gm-field">
            <input
              className="gm-input"
              required
              autoFocus
              maxLength={100}
              value={form.nombre}
              onChange={(event) => setForm((prev) => ({
                ...prev,
                nombre: clampText(event.target.value, 100),
              }))}
              placeholder=" "
              aria-label="Nombre de la categoría"
            />
            <span className="gm-label">Nombre</span>
          </label>

          <label className="gm-field">
            <textarea
              className="gm-input servicios-quick-category-modal__textarea"
              maxLength={255}
              value={form.descripcion}
              onChange={(event) => setForm((prev) => ({
                ...prev,
                descripcion: clampText(event.target.value, 255),
              }))}
              placeholder=" "
              aria-label="Descripción opcional"
            />
            <span className="gm-label">Descripción (opcional)</span>
            <small className="servicios-field__counter">{form.descripcion.length}/255</small>
          </label>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button
            type="button"
            className="gm-action-btn gm-action-btn--cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>
            {saving ? "Guardando..." : submitLabel}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
