import React from "react";
import { createPortal } from "react-dom";
import { money } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

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

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <section className="gm-modal-container gm-modal-v2 servicios-modal servicios-history-modal" role="dialog" aria-modal="true">
        <header className="gm-modal-header"><div className="gm-modal-head-left"><h2 className="gm-modal-title">{title}</h2><p className="gm-modal-subtitle">{item?.nombre || "Registro"} · historial propio del módulo de Servicios.</p></div><button type="button" className="gm-modal-close" onClick={onClose}>✕</button></header>
        <div className="gm-modal-content servicios-modal__content">
          {loading ? <div className="servicios-history-empty">Cargando historial...</div> : rows.length === 0 ? <div className="servicios-history-empty">Todavía no hay cambios históricos registrados.</div> : (
            <div className="servicios-history-list">
              {rows.map((row, index) => {
                const rowId = row.id_historial || row.id_stock_movimiento || index + 1;
                const rowDate = row.fecha || row.created_at;
                return (
                  <article className="servicios-history-row" key={`${kind}-${rowId}-${index}`}>
                    <div className="servicios-history-row__date"><strong>{fecha(rowDate)}</strong><small>Registro #{rowId}</small></div>
                    {kind === "articulo" && <><div><span>Costo</span><strong>{money(row.costo_unitario)}</strong></div><div><span>Precio venta</span><strong>{row.precio_venta == null ? "—" : money(row.precio_venta)}</strong></div><div><span>IVA</span><strong>{Number(row.iva_pct || 0).toLocaleString("es-AR")} %</strong></div></>}
                    {kind === "servicio" && <><div><span>Precio venta</span><strong>{money(row.precio_venta)}</strong></div><div><span>IVA</span><strong>{Number(row.iva_pct || 0).toLocaleString("es-AR")} %</strong></div></>}
                    {kind === "trabajador" && <><div><span>Modalidad</span><strong>{modalidadLabel[row.modalidad_pago] || row.modalidad_pago || "—"}</strong></div><div><span>Tarifa</span><strong>{money(row.monto_periodo)}</strong><small>{numero(row.horas_periodo)} h equivalentes</small></div><div><span>Costo / hora</span><strong>{money(row.costo_hora)}</strong></div></>}
                    {kind === "stock" && <><div><span>Operación</span><strong>{row.operacion || "—"}</strong></div><div><span>Anterior</span><strong>{numero(row.cantidad_anterior)}</strong></div><div><span>Movimiento</span><strong>{numero(row.cantidad_movimiento)}</strong></div><div><span>Nuevo stock</span><strong>{numero(row.cantidad_nueva)}</strong></div><div><span>Motivo</span><strong>{row.motivo || "—"}</strong></div></>}
                  </article>
                );
              })}
            </div>
          )}
          <div className="gm-info-box">El usuario responsable de cada modificación se conserva en <strong>Auditoría</strong>; no se duplica en las tablas del módulo.</div>
        </div>
        <footer className="gm-modal-footer gm-view-footer-actions"><button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose}>Cerrar</button></footer>
      </section>
    </div>,
    document.body
  );
}
