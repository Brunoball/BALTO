import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clampText, decimalText, money } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalculator, faCircleInfo, faDollarSign, faUser } from "@fortawesome/free-solid-svg-icons";

const HORAS_SUGERIDAS = {
  HORA: "1",
  JORNADA: "8",
  SEMANA: "48",
  QUINCENA: "96",
  MES: "192",
};

const EMPTY = {
  nombre: "",
  documento: "",
  rol: "",
  tipo_trabajador: "EMPLEADO",
  modalidad_pago: "HORA",
  monto_periodo: "0",
  horas_periodo: "1",
  notas: "",
};

export default function ModalTrabajador({ open, item, saving, onClose, onSave, onToast }) {
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;

    setForm({
      nombre: item?.nombre || "",
      documento: item?.documento || "",
      rol: item?.rol || "",
      tipo_trabajador: item?.tipo_trabajador || "EMPLEADO",
      modalidad_pago: item?.modalidad_pago || "HORA",
      monto_periodo: String(item?.monto_periodo ?? item?.costo_hora ?? "0"),
      horas_periodo: String(item?.horas_periodo ?? "1"),
      notas: item?.notas || "",
    });
  }, [open, item]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });

  const costoHora = useMemo(() => {
    const horas = Number(form.horas_periodo || 0);
    if (horas <= 0) return 0;
    return Number(form.monto_periodo || 0) / horas;
  }, [form.monto_periodo, form.horas_periodo]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const cambiarModalidad = (modalidad) => {
    setForm((prev) => ({
      ...prev,
      modalidad_pago: modalidad,
      horas_periodo: HORAS_SUGERIDAS[modalidad] || prev.horas_periodo,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!form.nombre.trim()) return onToast?.("error", "Completá el nombre del trabajador.", 4200);
    if (Number(form.monto_periodo || 0) < 0) return onToast?.("error", "El monto del período no puede ser negativo.", 4200);
    if (Number(form.horas_periodo || 0) <= 0) return onToast?.("error", "Las horas equivalentes deben ser mayores a cero.", 4200);

    await onSave({
      ...form,
      id_trabajador: item?.id_trabajador,
    });
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-v2 servicios-modal servicios-modal--catalog servicios-modal--worker" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-icon"><FontAwesomeIcon icon={faUser} /></div>
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar trabajador" : "Agregar trabajador"}</h2>
            <p className="gm-modal-subtitle">Organizá sus datos, función y modalidad de pago desde una sola ficha.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content servicios-service-content servicios-worker-content">
          <div className="servicios-worker-overview">
            <section className="gm-section servicios-form-section servicios-service-panel servicios-worker-panel--identity">
              <div className="gm-section-head servicios-service-sectionHead">
                <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faUser} /></span>
                <span className="servicios-service-sectionCopy"><strong>Información del trabajador</strong><small>Datos personales y función dentro del servicio.</small></span>
              </div>
              <div className="gm-section-body servicios-service-panelBody">
                <div className="servicios-form-grid">
                  <label className="gm-field servicios-field--span-8 servicios-worker-nameField">
                    <input className="gm-input" autoFocus maxLength={150} value={form.nombre} onChange={(e) => set("nombre", clampText(e.target.value, 150))} placeholder=" " />
                    <span className="gm-label">Nombre del trabajador</span>
                  </label>

                  <label className="gm-field servicios-field--span-4">
                    <input className="gm-input" maxLength={30} value={form.documento} onChange={(e) => set("documento", clampText(e.target.value, 30))} placeholder=" " />
                    <span className="gm-label">Documento (opcional)</span>
                  </label>

                  <label className="gm-field servicios-field--span-8">
                    <input className="gm-input" maxLength={100} value={form.rol} onChange={(e) => set("rol", clampText(e.target.value, 100))} placeholder=" " />
                    <span className="gm-label">Rol o especialidad</span>
                  </label>

                  <label className="gm-field servicios-field--span-4">
                    <select className="gm-input gm-select" value={form.tipo_trabajador} onChange={(e) => set("tipo_trabajador", e.target.value)}>
                      <option value="EMPLEADO">EMPLEADO</option>
                      <option value="DUENO">DUEÑO / SOCIO</option>
                      <option value="CONTRATADO">CONTRATADO</option>
                    </select>
                    <span className="gm-label gm-label--up">Tipo de trabajador</span>
                  </label>
                </div>
              </div>
            </section>

            <section className="gm-section servicios-form-section servicios-service-panel servicios-worker-panel--rate">
              <div className="gm-section-head servicios-service-sectionHead">
                <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faDollarSign} /></span>
                <span className="servicios-service-sectionCopy"><strong>Tarifa y equivalencia</strong><small>Configurá el período y su conversión a costo por hora.</small></span>
              </div>
              <div className="gm-section-body servicios-service-panelBody">
                <div className="servicios-form-grid servicios-worker-rateFields">
                  <label className="gm-field servicios-field--span-12">
                    <select className="gm-input gm-select" value={form.modalidad_pago} onChange={(e) => cambiarModalidad(e.target.value)}>
                      <option value="HORA">POR HORA</option>
                      <option value="JORNADA">POR JORNADA</option>
                      <option value="SEMANA">POR SEMANA</option>
                      <option value="QUINCENA">POR QUINCENA</option>
                      <option value="MES">POR MES</option>
                    </select>
                    <span className="gm-label gm-label--up">Modalidad de pago</span>
                  </label>

                  <label className="gm-field servicios-field--span-6">
                    <input className="gm-input" inputMode="decimal" value={form.monto_periodo} onChange={(e) => set("monto_periodo", decimalText(e.target.value, 2))} placeholder=" " />
                    <span className="gm-label">Monto del período</span>
                  </label>

                  <label className="gm-field servicios-field--span-6">
                    <input className="gm-input" inputMode="decimal" value={form.horas_periodo} onChange={(e) => set("horas_periodo", decimalText(e.target.value, 4))} placeholder=" " />
                    <span className="gm-label">Horas equivalentes</span>
                  </label>
                </div>

                <div className="servicios-worker-ratePreview">
                  <span className="servicios-worker-ratePreview__icon"><FontAwesomeIcon icon={faCalculator} /></span>
                  <div><span>Costo calculado por hora</span><small>Se utiliza para calcular el costo de los servicios.</small></div>
                  <strong>{money(costoHora)}<small>/ hora</small></strong>
                </div>
                <p className="servicios-worker-rateHelp">Las horas sugeridas cambian con la modalidad y podés ajustarlas a la jornada real del negocio.</p>
              </div>
            </section>
          </div>

          <section className="gm-section servicios-form-section servicios-service-panel servicios-worker-panel--notes">
            <div className="gm-section-head servicios-service-sectionHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faCircleInfo} /></span>
              <span className="servicios-service-sectionCopy"><strong>Notas y observaciones</strong><small>Información adicional útil para identificar su trabajo.</small></span>
            </div>
            <div className="gm-section-body servicios-service-panelBody">
              <label className="gm-field servicios-worker-notesField">
                <textarea className="gm-input servicios-textarea" rows={3} maxLength={1000} value={form.notas} onChange={(e) => set("notas", clampText(e.target.value, 1000))} placeholder=" " />
                <span className="gm-label">Notas</span>
                <small className="servicios-field__counter">{form.notas.length}/1000</small>
              </label>
            </div>
          </section>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : item ? "Guardar cambios" : "Crear trabajador"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
