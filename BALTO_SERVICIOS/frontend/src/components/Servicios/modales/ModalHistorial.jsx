import React from "react";
import { createPortal } from "react-dom";
import { money } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxOpen, faCalculator, faChartLine, faCircleInfo, faClockRotateLeft, faDollarSign, faPercent, faTag } from "@fortawesome/free-solid-svg-icons";

function fecha(value) {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function numero(value) {
  return Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 6 });
}

const modalidadLabel = {
  HORA: "Por hora",
  JORNADA: "Por jornada",
  SEMANA: "Semanal",
  QUINCENA: "Quincenal",
  MES: "Mensual",
};

export default function ModalHistorial({ open, kind, item, rows = [], loading, onClose }) {
  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: false, onClose });
  if (!open) return null;

  const recurso = item?.tipo === "MATERIAL" ? "material" : "insumo";
  const title = kind === "servicio"
    ? "Historial de precio del servicio"
    : kind === "articulo"
      ? `Historial de valores del ${recurso}`
      : kind === "stock"
        ? "Historial de stock"
        : "Historial de tarifa del trabajador";

  const summary = kind === "servicio"
    ? [
        { label: "Precio actual", value: money(item?.precio_venta), detail: "Valor vigente del servicio", icon: faDollarSign, tone: "green" },
        { label: "IVA actual", value: `${Number(item?.iva_pct || 0).toLocaleString("es-AR")} %`, detail: "Alícuota configurada", icon: faPercent, tone: "blue" },
        { label: "Cambios registrados", value: rows.length.toLocaleString("es-AR"), detail: "Registros históricos", icon: faClockRotateLeft, tone: "yellow" },
      ]
    : kind === "articulo"
      ? [
          { label: "Costo actual", value: money(item?.costo_unitario), detail: "Costo unitario vigente", icon: faCalculator, tone: "green" },
          { label: "Precio actual", value: item?.precio_venta == null ? "—" : money(item.precio_venta), detail: "Precio de venta vigente", icon: faDollarSign, tone: "blue" },
          { label: "Cambios registrados", value: rows.length.toLocaleString("es-AR"), detail: "Registros históricos", icon: faClockRotateLeft, tone: "yellow" },
        ]
      : kind === "stock"
        ? [
            { label: "Stock actual", value: `${numero(item?.stock_actual)} ${item?.unidad_simbolo || ""}`.trim(), detail: "Existencia disponible", icon: faBoxOpen, tone: "green" },
            { label: "Tipo", value: item?.tipo || "—", detail: "Clasificación del artículo", icon: faTag, tone: "blue" },
            { label: "Movimientos", value: rows.length.toLocaleString("es-AR"), detail: "Registros históricos", icon: faClockRotateLeft, tone: "yellow" },
          ]
        : [
            { label: "Tarifa actual", value: money(item?.monto_periodo), detail: "Monto del período vigente", icon: faDollarSign, tone: "green" },
            { label: "Costo por hora", value: money(item?.costo_hora), detail: "Equivalencia calculada", icon: faCalculator, tone: "blue" },
            { label: "Cambios registrados", value: rows.length.toLocaleString("es-AR"), detail: "Registros históricos", icon: faClockRotateLeft, tone: "yellow" },
          ];

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <section className="gm-modal-container gm-modal-v2 servicios-modal servicios-history-modal" role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-icon"><FontAwesomeIcon icon={faClockRotateLeft} /></div>
          <div className="gm-modal-head-left"><h2 className="gm-modal-title">{title}</h2><p className="gm-modal-subtitle">{item?.nombre || "Registro"} · consultá la evolución de sus valores.</p></div>
          <button type="button" className="gm-modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        <div className="gm-modal-content servicios-modal__content servicios-service-content servicios-history-content">
          <section className="gm-section servicios-service-panel servicios-history-panel servicios-history-panel--summary">
            <div className="gm-section-head servicios-service-sectionHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faChartLine} /></span>
              <span className="servicios-service-sectionCopy"><strong>Resumen actual</strong><small>Referencia rápida del registro seleccionado.</small></span>
            </div>
            <div className="gm-section-body servicios-history-summaryGrid">
              {summary.map((metric) => (
                <article className={`servicios-history-summaryCard servicios-history-summaryCard--${metric.tone}`} key={metric.label}>
                  <div className="servicios-history-summaryCard__icon" aria-hidden="true"><FontAwesomeIcon icon={metric.icon} /></div>
                  <div className="servicios-history-summaryCard__body">
                    <span className="servicios-history-summaryCard__label">{metric.label}</span>
                    <strong className="servicios-history-summaryCard__value">{metric.value}</strong>
                    <span className="servicios-history-summaryCard__detail">{metric.detail}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="gm-section servicios-service-panel servicios-history-panel servicios-history-panel--timeline">
            <div className="gm-section-head servicios-service-sectionHead servicios-history-timelineHead">
              <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faClockRotateLeft} /></span>
              <span className="servicios-service-sectionCopy"><strong>Cambios registrados</strong><small>Cada registro conserva su fecha y los valores aplicados.</small></span>
              <span className="servicios-history-count">{rows.length}</span>
            </div>
            <div className="gm-section-body servicios-history-panelBody">
              {loading ? (
                <div className="servicios-history-empty is-loading"><FontAwesomeIcon icon={faClockRotateLeft} /><strong>Cargando historial...</strong><small>Estamos consultando los cambios registrados.</small></div>
              ) : rows.length === 0 ? (
                <div className="servicios-history-empty"><FontAwesomeIcon icon={faBoxOpen} /><strong>Sin cambios históricos</strong><small>Todavía no hay modificaciones registradas para este elemento.</small></div>
              ) : (
                <div className="servicios-history-list">
                  {rows.map((row, index) => {
                    const rowId = row.id_historial || row.id_stock_movimiento || index + 1;
                    const rowDate = row.fecha || row.created_at;
                    return (
                      <article className={`servicios-history-row servicios-history-row--${kind}`} key={`${kind}-${rowId}-${index}`}>
                        <div className="servicios-history-row__date"><span className="servicios-history-index">{index + 1}</span><div><strong>{fecha(rowDate)}</strong><small>Registro #{rowId}</small></div></div>
                        <div className="servicios-history-row__values">
                          {kind === "articulo" && <><div><span>Costo</span><strong>{money(row.costo_unitario)}</strong></div><div><span>Precio de venta</span><strong>{row.precio_venta == null ? "—" : money(row.precio_venta)}</strong></div><div><span>IVA</span><strong>{Number(row.iva_pct || 0).toLocaleString("es-AR")} %</strong></div></>}
                          {kind === "servicio" && <><div><span>Precio de venta</span><strong>{money(row.precio_venta)}</strong></div><div><span>IVA</span><strong>{Number(row.iva_pct || 0).toLocaleString("es-AR")} %</strong></div></>}
                          {kind === "trabajador" && <><div><span>Modalidad</span><strong>{modalidadLabel[row.modalidad_pago] || row.modalidad_pago || "—"}</strong></div><div><span>Tarifa</span><strong>{money(row.monto_periodo)}</strong><small>{numero(row.horas_periodo)} h equivalentes</small></div><div><span>Costo por hora</span><strong>{money(row.costo_hora)}</strong></div></>}
                          {kind === "stock" && <><div><span>Operación</span><strong>{row.operacion || "—"}</strong></div><div><span>Anterior</span><strong>{numero(row.cantidad_anterior)}</strong></div><div><span>Movimiento</span><strong>{numero(row.cantidad_movimiento)}</strong></div><div><span>Nuevo stock</span><strong>{numero(row.cantidad_nueva)}</strong></div><div className="servicios-history-value--reason"><span>Motivo</span><strong>{row.motivo || "—"}</strong></div></>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <div className="gm-info-box servicios-history-audit"><FontAwesomeIcon icon={faCircleInfo} /><span>El usuario responsable de cada modificación se conserva en <strong>Auditoría</strong>.</span></div>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions"><button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose}>Cerrar</button></footer>
      </section>
    </div>,
    document.body
  );
}
