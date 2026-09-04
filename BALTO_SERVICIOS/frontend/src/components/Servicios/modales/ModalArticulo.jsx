import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clampText, decimalText } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

const EMPTY = {
  nombre: "",
  id_categoria: "",
  id_unidad: "",
  descripcion: "",
  stock_actual: "0",
  costo_unitario: "0",
  precio_venta: "",
  iva_pct: "0",
};

export default function ModalArticulo({ open, item, tipo = "INSUMO", entidad = "insumo", categorias = [], unidades = [], saving, onClose, onSave, onToast, onOpenAgregarCategoria, onOpenAgregarUnidad }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    setForm({
      nombre: item?.nombre || "",
      id_categoria: item?.id_categoria ? String(item.id_categoria) : "",
      id_unidad: item?.id_unidad ? String(item.id_unidad) : "",
      descripcion: item?.descripcion || "",
      stock_actual: String(item?.stock_actual ?? "0"),
      costo_unitario: String(item?.costo_unitario ?? "0"),
      precio_venta: item?.precio_venta == null ? "" : String(item.precio_venta),
      iva_pct: String(item?.iva_pct ?? "0"),
    });
  }, [open, item]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });
  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.nombre.trim()) return onToast?.("error", `Completá el nombre del ${entidad}.`, 4200);
    if (!form.id_unidad) return onToast?.("error", "Seleccioná una unidad de medida.", 4200);
    if (Number(form.costo_unitario || 0) < 0) return onToast?.("error", "El costo no puede ser negativo.", 4200);
    if (!item && Number(form.stock_actual || 0) < 0) return onToast?.("error", "El stock inicial no puede ser negativo.", 4200);
    await onSave({
      ...form,
      tipo,
      id_articulo: item?.id_articulo,
      id_categoria: form.id_categoria || null,
      precio_venta: form.precio_venta === "" ? null : form.precio_venta,
      stock_actual: item ? item.stock_actual : form.stock_actual,
    });
  };

  const categoria = (event) => {
    if (event.target.value === "__ADD__") onOpenAgregarCategoria?.((id) => set("id_categoria", String(id || "")));
    else set("id_categoria", event.target.value);
  };
  const unidad = (event) => {
    if (event.target.value === "__ADD__") onOpenAgregarUnidad?.((id) => set("id_unidad", String(id || "")));
    else set("id_unidad", event.target.value);
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-v2 servicios-modal servicios-modal--catalog" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? `Editar ${entidad}` : `Agregar ${entidad}`}</h2>
            <p className="gm-modal-subtitle">{tipo === "MATERIAL" ? "Material utilizado para realizar o complementar servicios." : "Insumo consumible utilizado durante la prestación de servicios."}</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content">
          <section className="gm-section servicios-form-section">
            <div className="gm-section-head"><span className="gm-section-dot" /><span>Datos del {entidad}</span></div>
            <div className="gm-section-body"><div className="servicios-form-grid">
              <label className="gm-field servicios-field--span-12"><input className="gm-input" autoFocus maxLength={150} value={form.nombre} onChange={(e) => set("nombre", clampText(e.target.value, 150))} placeholder=" " /><span className="gm-label">Nombre</span></label>
              <label className="gm-field servicios-field--span-6"><select className="gm-input gm-select" value={form.id_categoria} onChange={categoria}><option value="__ADD__">+ AGREGAR CATEGORÍA</option><option value="">SIN CATEGORÍA</option>{categorias.filter((c) => Number(c.activo) === 1).map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>)}</select><span className="gm-label gm-label--up">Categoría</span></label>
              <label className="gm-field servicios-field--span-6"><select className="gm-input gm-select" value={form.id_unidad} onChange={unidad}><option value="__ADD__">+ AGREGAR UNIDAD</option><option value="">SELECCIONAR UNIDAD</option>{unidades.filter((u) => Number(u.activo) === 1).map((u) => <option key={u.id_unidad} value={u.id_unidad}>{u.nombre} ({u.simbolo})</option>)}</select><span className="gm-label gm-label--up">Unidad</span></label>
              <label className="gm-field servicios-field--wide"><textarea className="gm-input servicios-textarea" rows={3} maxLength={1000} value={form.descripcion} onChange={(e) => set("descripcion", clampText(e.target.value, 1000))} placeholder=" " /><span className="gm-label">Descripción</span></label>
            </div></div>
          </section>

          <section className="gm-section servicios-form-section">
            <div className="gm-section-head"><span className="gm-section-dot" /><span>Stock y valores</span></div>
            <div className="gm-section-body"><div className="servicios-form-grid">
              <label className="gm-field servicios-field--span-3"><input className="gm-input" inputMode="decimal" disabled={Boolean(item)} value={form.stock_actual} onChange={(e) => set("stock_actual", decimalText(e.target.value, 6))} placeholder=" " /><span className="gm-label">{item ? "Stock actual" : "Stock inicial"}</span></label>
              <label className="gm-field servicios-field--span-3"><input className="gm-input" inputMode="decimal" value={form.costo_unitario} onChange={(e) => set("costo_unitario", decimalText(e.target.value, 6))} placeholder=" " /><span className="gm-label">Costo unitario</span></label>
              <label className="gm-field servicios-field--span-3"><input className="gm-input" inputMode="decimal" value={form.precio_venta} onChange={(e) => set("precio_venta", decimalText(e.target.value, 2))} placeholder=" " /><span className="gm-label">Precio de venta (opcional)</span></label>
              <label className="gm-field servicios-field--span-3"><select className="gm-input gm-select" value={form.iva_pct} onChange={(e) => set("iva_pct", e.target.value)}>{["0", "10.5", "21", "27"].map((v) => <option key={v} value={v}>{v} %</option>)}</select><span className="gm-label gm-label--up">IVA</span></label>
            </div>{item && <div className="gm-info-box">Para modificar existencias usá <strong>Ajustar stock</strong>. Así el cambio queda identificado en Auditoría.</div>}</div>
          </section>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : `Guardar ${entidad}`}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
