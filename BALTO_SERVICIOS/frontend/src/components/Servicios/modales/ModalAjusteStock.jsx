import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxOpen, faCircleInfo, faFileLines } from "@fortawesome/free-solid-svg-icons";
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

  const formatStock = (value) => Number(value).toLocaleString("es-AR", { maximumFractionDigits: 6 });
  const pendiente = form.cantidad === "";
  const ayudaOperacion = {
    SUMAR: "La cantidad se agrega a la existencia actual.",
    RESTAR: "La cantidad se descuenta de la existencia actual.",
    ESTABLECER: "La cantidad reemplaza la existencia actual; no se suma ni se resta.",
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-v2 servicios-modal servicios-adjust-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="servicios-adjust-title">
        <header className="gm-modal-header">
          <div className="gm-modal-head-icon"><FontAwesomeIcon icon={faBoxOpen} /></div>
          <div className="gm-modal-head-left"><h2 id="servicios-adjust-title" className="gm-modal-title">Ajustar stock</h2><p className="gm-modal-subtitle">Revisá la existencia, elegí el ajuste y registrá su motivo.</p></div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>
        <div className="gm-modal-content servicios-modal__content servicios-service-content">
          <section className="gm-section servicios-form-section servicios-service-panel servicios-article-panel--material">
            <div className="gm-section-head servicios-service-sectionHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faBoxOpen} /></span>
              <span className="servicios-service-sectionCopy"><strong>{item.nombre}</strong><small>Artículo al que se aplicará el ajuste de existencias.</small></span>
            </div>
            <div className="gm-section-body servicios-history-summaryGrid">
              <div className="servicios-history-summaryCard servicios-history-summaryCard--blue">
                <span className="servicios-history-summaryCard__icon"><FontAwesomeIcon icon={faBoxOpen} /></span>
                <div className="servicios-history-summaryCard__body"><span className="servicios-history-summaryCard__label">Existencia actual</span><strong className="servicios-history-summaryCard__value">{formatStock(item.stock_actual || 0)}</strong><small className="servicios-history-summaryCard__detail">{item.unidad_simbolo || "Existencias registradas"}</small></div>
              </div>
              <div className="servicios-history-summaryCard servicios-history-summaryCard--yellow">
                <span className="servicios-history-summaryCard__icon"><FontAwesomeIcon icon={faCircleInfo} /></span>
                <div className="servicios-history-summaryCard__body"><span className="servicios-history-summaryCard__label">Costo unitario</span><strong className="servicios-history-summaryCard__value">{money(item.costo_unitario)}</strong><small className="servicios-history-summaryCard__detail">Valor de referencia</small></div>
              </div>
              <div className={`servicios-history-summaryCard servicios-history-summaryCard--green ${!pendiente && nuevoStock < 0 ? "servicios-adjust-invalid" : ""}`}>
                <span className="servicios-history-summaryCard__icon"><FontAwesomeIcon icon={faBoxOpen} /></span>
                <div className="servicios-history-summaryCard__body"><span className="servicios-history-summaryCard__label">Nueva existencia</span><strong className="servicios-history-summaryCard__value">{pendiente ? "—" : formatStock(nuevoStock)}</strong><small className="servicios-history-summaryCard__detail">{pendiente ? "Ingresá una cantidad" : item.unidad_simbolo || "Resultado del ajuste"}</small></div>
              </div>
            </div>
          </section>
          <div className="servicios-adjust-grid">
          <section className="gm-section servicios-form-section servicios-service-panel servicios-article-panel--values">
            <div className="gm-section-head servicios-service-sectionHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faCircleInfo} /></span>
              <span className="servicios-service-sectionCopy"><strong>Tipo y cantidad del ajuste</strong><small>Elegí cómo modificar la existencia.</small></span>
            </div>
            <div className="gm-section-body servicios-service-panelBody">
          <div className="servicios-form-grid">
            <label className="gm-field servicios-field--span-6"><select className="gm-input gm-select" value={form.operacion} onChange={(e) => setForm((p) => ({ ...p, operacion: e.target.value }))}><option value="SUMAR">INGRESAR / SUMAR</option><option value="RESTAR">EGRESAR / RESTAR</option><option value="ESTABLECER">FIJAR EXISTENCIA</option></select><span className="gm-label gm-label--up">Operación</span></label>
            <label className="gm-field servicios-field--span-6"><input className="gm-input" autoFocus inputMode="decimal" value={form.cantidad} onChange={(e) => setForm((p) => ({ ...p, cantidad: decimalText(e.target.value, 6) }))} placeholder=" " /><span className="gm-label">{form.operacion === "ESTABLECER" ? "Existencia final" : "Cantidad"}</span></label>
          </div>
              <div className="gm-info-box servicios-article-stockNotice"><FontAwesomeIcon icon={faCircleInfo} /><span>{ayudaOperacion[form.operacion]}</span></div>
              <div className={`gm-info-box ${!pendiente && nuevoStock < 0 ? "servicios-info-danger" : ""}`} role="status">
                {pendiente ? "Ingresá una cantidad para calcular la nueva existencia." : nuevoStock < 0 ? "El ajuste dejaría un stock negativo. Revisá la cantidad antes de continuar." : <>La existencia pasará de <strong>{formatStock(item.stock_actual || 0)}</strong> a <strong>{formatStock(nuevoStock)} {item.unidad_simbolo}</strong>.</>}
              </div>
            </div>
          </section>
          <section className="gm-section servicios-form-section servicios-service-panel servicios-article-panel--description">
            <div className="gm-section-head servicios-service-sectionHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faFileLines} /></span>
              <span className="servicios-service-sectionCopy"><strong>Motivo del ajuste</strong><small>Obligatorio para identificar el cambio en Auditoría.</small></span>
            </div>
            <div className="gm-section-body servicios-service-panelBody">
            <label className="gm-field servicios-adjust-reason"><textarea className="gm-input servicios-textarea" rows={3} maxLength={255} value={form.motivo} onChange={(e) => setForm((p) => ({ ...p, motivo: clampText(e.target.value, 255) }))} placeholder=" " /><span className="gm-label">Motivo del ajuste</span><small className="servicios-field__counter">{form.motivo.length}/255</small></label>
              <p className="servicios-adjust-help">Por ejemplo: ingreso de mercadería, consumo, rotura o corrección por recuento.</p>
            </div>
          </section>
          </div>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions"><button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving || nuevoStock < 0}>{saving ? "Guardando..." : "Confirmar ajuste"}</button></footer>
      </form>
    </div>,
    document.body
  );
}
