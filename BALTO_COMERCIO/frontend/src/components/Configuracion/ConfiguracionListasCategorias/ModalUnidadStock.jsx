import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ModalUnidadStock({ open, item, saving, onClose, onSave, onToast }) {
  const [nombre, setNombre] = useState("");
  const [abreviatura, setAbreviatura] = useState("");
  const [permiteDecimales, setPermiteDecimales] = useState(true);

  useEffect(() => {
    if (!open) return;
    setNombre(item?.nombre || "");
    setAbreviatura(item?.abreviatura || "");
    setPermiteDecimales(Number(item?.permite_decimales ?? 1) === 1);
  }, [open, item]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const n = nombre.trim();
    const a = abreviatura.trim();
    if (!n || !a) {
      onToast?.("error", "Completá nombre y abreviatura de la unidad.", 4200);
      return;
    }
    await onSave?.({
      id_stock_unidad: item?.id_stock_unidad,
      nombre: n,
      abreviatura: a,
      permite_decimales: permiteDecimales ? 1 : 0,
    });
  };

  return createPortal(
    <div className="gm-modal-overlay" data-modal-overlay="true">
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar unidad de stock" : "Agregar unidad de stock"}</h2>
            <p className="gm-modal-subtitle">Ejemplos: UNIDAD (u), GRAMO (g), KILOGRAMO (kg), MILILITRO (ml).</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </header>
        <div className="gm-modal-content" style={{ display: "grid", gap: 14 }}>
          <label className="gm-field">
            <input className="gm-input" autoFocus maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} placeholder=" " />
            <span className="gm-label">Nombre</span>
          </label>
          <label className="gm-field">
            <input className="gm-input" maxLength={20} value={abreviatura} onChange={(e) => setAbreviatura(e.target.value)} placeholder=" " />
            <span className="gm-label">Abreviatura</span>
          </label>
          <label style={{ display: "flex", gap: 9, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={permiteDecimales} onChange={(e) => setPermiteDecimales(e.target.checked)} />
            Permitir cantidades decimales (ej. 0,125 kg)
          </label>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : "Guardar unidad"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
