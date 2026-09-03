import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  cleanCode,
  clampText,
  decimalText,
} from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";


const IVA_OPTIONS = [
  { value: "0", label: "0 %" },
  { value: "10.5", label: "10,5 %" },
  { value: "21", label: "21 %" },
  { value: "27", label: "27 %" },
];

const isStandardIva = (value) => IVA_OPTIONS.some((option) => Number(option.value) === Number(value));

const initialForm = {
  codigo: "",
  nombre: "",
  id_categoria: "",
  id_unidad: "",
  descripcion: "",
  costo_unitario: "0",
  precio_venta: "",
  iva_pct: "0",
};

export default function ModalInsumo({
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
        costo_unitario: String(item.costo_unitario ?? "0"),
        precio_venta: item.precio_venta == null ? "" : String(item.precio_venta),
        iva_pct: String(item.iva_pct ?? "0"),
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
      onToast?.("error", "Completá el nombre del insumo.", 4200);
      return;
    }
    if (!form.id_unidad) {
      onToast?.("error", "Seleccioná una unidad para el insumo.", 4200);
      return;
    }

    await onSave({
      ...form,
      id_insumo: item?.id_insumo || item?.id_articulo,
      id_categoria: form.id_categoria || null,
      precio_venta: form.precio_venta === "" ? null : form.precio_venta,
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
        aria-labelledby="servicios-insumo-modal-title"
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="servicios-insumo-modal-title">{item ? "Editar insumo" : "Agregar insumo"}</h2>
            <p className="gm-modal-subtitle">Completá los datos generales, la unidad y los valores comerciales.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content">
          <section className="gm-section servicios-form-section">
            <div className="gm-section-head">
              <span className="gm-section-dot" />
              <span>Datos del insumo</span>
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
                      <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
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
              <span>Valores comerciales</span>
            </div>
            <div className="gm-section-body">
              <div className="servicios-form-grid">
                <label className="gm-field servicios-field--span-4">
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

                <label className="gm-field servicios-field--span-4">
                  <input
                    className="gm-input"
                    inputMode="decimal"
                    value={form.precio_venta}
                    onChange={(e) => set("precio_venta", decimalText(e.target.value, 2))}
                    placeholder=" "
                    aria-label="Precio de venta opcional"
                  />
                  <span className="gm-label">Precio de venta (opcional)</span>
                </label>

                <label className="gm-field servicios-field--span-4">
                  <select className="gm-input gm-select" value={form.iva_pct} onChange={(e) => set("iva_pct", e.target.value)} aria-label="IVA">
                    {!isStandardIva(form.iva_pct) && form.iva_pct !== "" && (
                      <option value={form.iva_pct}>{String(form.iva_pct).replace(".", ",")} % (ACTUAL)</option>
                    )}
                    {IVA_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="gm-label gm-label--up">IVA %</span>
                </label>
              </div>
            </div>
          </section>

          <div className="gm-info-box">
            Los insumos pertenecen al catálogo de Servicios. El Stock se administra por separado y no cambia al crear, editar o eliminar un insumo.
          </div>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>
            {saving ? "Guardando..." : item ? "Guardar cambios" : "Agregar insumo"}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
