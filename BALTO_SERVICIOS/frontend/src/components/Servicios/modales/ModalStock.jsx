import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  cleanCode,
  clampText,
  decimalText,
  integerText,
} from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

const initialForm = {
  codigo: "",
  nombre: "",
  id_categoria: "",
  id_unidad: "",
  descripcion: "",
  stock_actual: "0",
  costo_unitario: "0",
};

export default function ModalStock({
  open,
  item,
  categorias,
  unidades,
  saving,
  onClose,
  onSave,
  onToast,
  onOpenAgregarCategoria,
}) {
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setForm({
        codigo: item.codigo || "",
        nombre: item.nombre || "",
        id_categoria: item.id_categoria ? String(item.id_categoria) : "",
        id_unidad: item.id_unidad ? String(item.id_unidad) : "",
        descripcion: item.descripcion || "",
        stock_actual: String(Math.max(0, Math.trunc(Number(item.stock_actual || 0)))),
        costo_unitario: String(item.costo_unitario ?? "0"),
      });
      return;
    }

    const defaultUnit = unidades.find((u) => String(u.codigo || "").toUpperCase() === "UN") || unidades[0];
    setForm({ ...initialForm, id_unidad: defaultUnit ? String(defaultUnit.id_unidad) : "" });
  }, [open, item, unidades]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({
    open,
    busy: saving,
    onClose,
  });

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();

    if (!String(form.nombre || "").trim()) {
      onToast?.("error", "Completá el nombre del producto de Stock.", 4200);
      return;
    }
    if (!form.id_unidad) {
      onToast?.("error", "Seleccioná una unidad para el producto de Stock.", 4200);
      return;
    }
    if (form.stock_actual === "" || Number(form.stock_actual) < 0) {
      onToast?.("error", "Indicá una cantidad de Stock válida.", 4200);
      return;
    }

    await onSave({
      ...form,
      id_stock: item?.id_stock,
      id_categoria: form.id_categoria || null,
    });
  };

  const handleCategoria = (event) => {
    const value = event.target.value;
    if (value === "__ADD__") {
      onOpenAgregarCategoria?.((categoryId) => {
        set("id_categoria", String(categoryId || ""));
      });
      return;
    }
    set("id_categoria", value);
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="gm-modal-overlay"
      data-servicios-modal-overlay="true"
      onMouseDown={cerrarDesdeFondo}
    >
      <form
        className="gm-modal-container gm-modal-container--small gm-modal-v2 servicios-modal servicios-modal--catalog"
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="servicios-stock-modal-title"
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="servicios-stock-modal-title">{item ? "Editar producto" : "Agregar producto"}</h2>
            <p className="gm-modal-subtitle">Organizá el producto, su unidad, la cantidad disponible y su costo.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content">
          <section className="gm-section servicios-form-section">
            <div className="gm-section-head">
              <span className="gm-section-dot" />
              <span>Datos del producto</span>
            </div>
            <div className="gm-section-body">
              <div className="servicios-form-grid">
          <label className="gm-field servicios-field--span-4">
            <input
              className="gm-input"
              maxLength={60}
              value={form.codigo}
              onChange={(e) => set("codigo", cleanCode(e.target.value))}
              placeholder=" "
              aria-label="Código"
            />
            <span className="gm-label">Código</span>
          </label>

          <label className="gm-field servicios-field--span-8">
            <input
              className="gm-input"
              required
              autoFocus
              maxLength={150}
              value={form.nombre}
              onChange={(e) => set("nombre", clampText(e.target.value, 150))}
              placeholder=" "
              aria-label="Nombre"
            />
            <span className="gm-label">Nombre</span>
          </label>

          <label className="gm-field servicios-field--span-6">
            <select className="gm-input gm-select" value={form.id_categoria} onChange={handleCategoria} aria-label="Categoría">
              <option value="__ADD__">+ AGREGAR CATEGORÍA</option>
              <option value="">SIN CATEGORÍA</option>
              {categorias.filter((c) => Number(c.activo) === 1).map((c) => (
                <option key={c.id_stock_categoria} value={c.id_stock_categoria}>{c.nombre}</option>
              ))}
            </select>
            <span className="gm-label gm-label--up">Categoría</span>
          </label>

          <label className="gm-field servicios-field--span-6">
            <select className="gm-input gm-select" required value={form.id_unidad} onChange={(e) => set("id_unidad", e.target.value)} aria-label="Unidad">
              <option value="">SELECCIONAR</option>
              {unidades
                .filter((u) => Number(u.activo) === 1 && String(u.codigo || "").toUpperCase() !== "SERVICIO")
                .map((u) => (
                  <option key={u.id_unidad} value={u.id_unidad}>
                    {String(u.nombre || "").toUpperCase()} ({u.simbolo})
                  </option>
                ))}
            </select>
            <span className="gm-label gm-label--up">Unidad</span>
          </label>

          <label className="gm-field servicios-field--wide">
            <textarea
              className="gm-input servicios-textarea"
              rows={3}
              maxLength={1000}
              value={form.descripcion}
              onChange={(e) => set("descripcion", clampText(e.target.value, 1000))}
              placeholder=" "
              aria-label="Descripción"
            />
            <span className="gm-label">Descripción</span>
            <small className="servicios-field__counter">{form.descripcion.length}/1000</small>
          </label>

              </div>
            </div>
          </section>

          <section className="gm-section servicios-form-section">
            <div className="gm-section-head">
              <span className="gm-section-dot" />
              <span>Existencia y costo</span>
            </div>
            <div className="gm-section-body">
              <div className="servicios-form-grid">
                <label className="gm-field servicios-field--span-6">
                  <input
                    className="gm-input"
                    required
                    inputMode="numeric"
                    maxLength={10}
                    value={form.stock_actual}
                    onChange={(e) => set("stock_actual", integerText(e.target.value, 10))}
                    placeholder=" "
                    aria-label="Stock actual"
                  />
                  <span className="gm-label">Stock actual</span>
                  <small className="servicios-field__help">Se guarda como número entero.</small>
                </label>

                <label className="gm-field servicios-field--span-6">
                  <input
                    className="gm-input"
                    inputMode="decimal"
                    value={form.costo_unitario}
                    onChange={(e) => set("costo_unitario", decimalText(e.target.value, 2))}
                    placeholder=" "
                    aria-label="Costo unitario"
                  />
                  <span className="gm-label">Costo unitario</span>
                </label>
              </div>
            </div>
          </section>

          <div className="gm-info-box">
            Este registro pertenece únicamente a Stock. No se crea, modifica ni elimina ningún insumo al guardar cambios acá.
          </div>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving || form.stock_actual === ""}>
            {saving ? "Guardando..." : item ? "Guardar cambios" : "Agregar producto"}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
