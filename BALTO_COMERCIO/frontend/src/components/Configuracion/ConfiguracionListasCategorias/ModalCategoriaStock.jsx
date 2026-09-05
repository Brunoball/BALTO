import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

function buildBlockedIds(item, categorias) {
  const currentId = Number(item?.id_stock_categoria || 0);
  if (!currentId) return new Set();
  const childrenByParent = new Map();
  for (const cat of categorias || []) {
    const parent = Number(cat?.id_categoria_padre || 0);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(Number(cat?.id_stock_categoria || 0));
  }
  const blocked = new Set([currentId]);
  const walk = (id) => {
    for (const child of childrenByParent.get(id) || []) {
      if (!child || blocked.has(child)) continue;
      blocked.add(child);
      walk(child);
    }
  };
  walk(currentId);
  return blocked;
}

export default function ModalCategoriaStock({ open, item, categorias, saving, onClose, onSave, onToast }) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [idPadre, setIdPadre] = useState("");

  useEffect(() => {
    if (!open) return;
    setNombre(item?.nombre || "");
    setDescripcion(item?.descripcion || "");
    setIdPadre(item?.id_categoria_padre ? String(item.id_categoria_padre) : "");
  }, [open, item]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, saving, onClose]);

  const opciones = useMemo(() => {
    const blocked = buildBlockedIds(item, categorias);
    return (categorias || [])
      .filter((cat) => {
        const id = Number(cat?.id_stock_categoria || 0);
        const currentParent = Number(item?.id_categoria_padre || 0);
        return (Number(cat?.activo) === 1 || id === currentParent) && !blocked.has(id);
      })
      .sort((a, b) => String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es", { sensitivity: "base" }));
  }, [categorias, item]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const limpio = String(nombre || "").trim();
    if (!limpio) {
      onToast?.("error", "Completá el nombre de la categoría.", 4200);
      return;
    }
    await onSave?.({
      id_stock_categoria: item?.id_stock_categoria,
      nombre: limpio,
      descripcion: String(descripcion || "").trim(),
      id_categoria_padre: idPadre ? Number(idPadre) : null,
    });
  };

  return createPortal(
    <div className="gm-modal-overlay" data-modal-overlay="true">
      <form className="gm-modal-container gm-modal-container--small gm-modal-v2" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar categoría de stock" : "Agregar categoría de stock"}</h2>
            <p className="gm-modal-subtitle">El cambio se refleja en Stock y conserva la jerarquía de categorías.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </header>
        <div className="gm-modal-content">
          <label className="gm-field">
            <input className="gm-input" autoFocus maxLength={120} value={nombre} onChange={(event) => setNombre(event.target.value.toUpperCase())} placeholder=" " />
            <span className="gm-label">Nombre</span>
          </label>
          <label className="gm-field">
            <select className="gm-input gm-select" value={idPadre} onChange={(event) => setIdPadre(event.target.value)}>
              <option value="">Sin categoría padre</option>
              {opciones.map((cat) => (
                <option key={cat.id_stock_categoria} value={cat.id_stock_categoria}>{cat.nombre}</option>
              ))}
            </select>
            <span className="gm-label gm-label--up">Categoría padre</span>
          </label>
          <label className="gm-field">
            <textarea
              className="gm-input cfg-listas-textarea"
              rows={4}
              value={descripcion}
              onChange={(event) => setDescripcion(event.target.value)}
              placeholder=" "
            />
            <span className="gm-label gm-label--up">Descripción (opcional)</span>
          </label>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : "Guardar categoría"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
