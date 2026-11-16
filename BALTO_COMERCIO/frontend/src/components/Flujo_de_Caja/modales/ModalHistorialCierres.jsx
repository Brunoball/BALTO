// src/components/Flujo_de_Caja/modales/ModalHistorialCierres.jsx
// Historial de cierres de caja (sólo lectura) con filtros y acceso al detalle.
// Desde el detalle se concilian diferencias y se aplican ajustes posteriores.
// Un cierre confirmado no se edita ni se elimina.

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faClockRotateLeft, faTriangleExclamation, faChevronRight, faFilter } from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Modals.css";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./ajustes_saldo.css";
import "./cierres_caja.css";

import { listarCierres } from "../api/flujoCajaCierresApi";
import { obtenerMediosAjuste } from "../api/flujoCajaAjustesApi";
import { fmtDateES, moneyARS } from "../utils/flujoCajaUtils";
import { ESTADOS_CIERRE } from "../utils/cierresUtils";
import DetalleCierreCaja from "./DetalleCierreCaja.jsx";

const FILTROS_INICIALES = { fechaDesde: "", fechaHasta: "", idMedioPago: "", estado: "" };

export default function ModalHistorialCierres({ open, onClose, initialCierreId = null, onChanged, showToast }) {
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [medios, setMedios] = useState([]);
  const [idSel, setIdSel] = useState(null);
  const [childBusy, setChildBusy] = useState(false);

  const cargar = useCallback(async (f) => {
    setLoading(true);
    setError("");
    try {
      const json = await listarCierres(f);
      if (json.habilitado === false) setError("El cierre de caja todavía no está habilitado para este comercio.");
      setRows(json.rows || []);
    } catch (e) {
      setRows([]);
      setError(e?.message || "No se pudo cargar el historial.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFiltros(FILTROS_INICIALES);
    setIdSel(initialCierreId || null);
    cargar(FILTROS_INICIALES);
    obtenerMediosAjuste().then((j) => setMedios(j.medios || [])).catch(() => setMedios([]));
  }, [open, initialCierreId, cargar]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || childBusy) return;
      if (idSel) setIdSel(null); else onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, idSel, childBusy, onClose]);

  const actualizarFiltro = (k, v) => {
    const next = { ...filtros, [k]: v };
    setFiltros(next);
    cargar(next);
  };

  const handleChanged = useCallback(() => {
    cargar(filtros);
    onChanged?.();
  }, [cargar, filtros, onChanged]);

  if (!open) return null;

  return createPortal(
    <div className="mi-mini__overlay fc-aj-overlay" role="presentation">
      <div className="mi-mini__modal fc-aj-modal fc-aj-modal--wide fc-cc-modal" role="dialog" aria-modal="true" aria-labelledby="fc-hc-title"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi-mini__head">
          <h4 id="fc-hc-title" className="mi-mini__title fc-aj-title">
            <FontAwesomeIcon icon={faClockRotateLeft} />
            <span>{idSel ? "Detalle del cierre" : "Historial de cierres"}</span>
          </h4>
          <button type="button" className="mi-mini__close" onClick={() => !childBusy && onClose?.()} disabled={childBusy} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-mini__body fc-aj-body fc-cc-body">
          {idSel ? (
            <DetalleCierreCaja
              idCierre={idSel}
              onBack={() => setIdSel(null)}
              onChanged={handleChanged}
              onBusyChange={setChildBusy}
              showToast={showToast}
            />
          ) : (
            <>
              <div className="fc-cc-filters" role="search">
                <FontAwesomeIcon icon={faFilter} className="fc-cc-filters__icon" aria-hidden="true" />
                <div className="fl-field">
                  <input id="fc-hc-desde" type="date" className="fl-input" value={filtros.fechaDesde} onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)} />
                  <label className="fl-label fc-aj-floatLabel" htmlFor="fc-hc-desde">Desde</label>
                </div>
                <div className="fl-field">
                  <input id="fc-hc-hasta" type="date" className="fl-input" value={filtros.fechaHasta} onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)} />
                  <label className="fl-label fc-aj-floatLabel" htmlFor="fc-hc-hasta">Hasta</label>
                </div>
                <div className="fl-field">
                  <select id="fc-hc-medio" className="fl-select fc-aj-select" value={filtros.idMedioPago} onChange={(e) => actualizarFiltro("idMedioPago", e.target.value)}>
                    <option value="">Todos</option>
                    {medios.map((m) => <option key={m.id_medio_pago} value={m.id_medio_pago}>{m.nombre}</option>)}
                  </select>
                  <label className="fl-label fc-aj-floatLabel" htmlFor="fc-hc-medio">Medio de pago</label>
                </div>
                <div className="fl-field">
                  <select id="fc-hc-estado" className="fl-select fc-aj-select" value={filtros.estado} onChange={(e) => actualizarFiltro("estado", e.target.value)}>
                    <option value="">Todos</option>
                    <option value="CON_PENDIENTES">Con diferencias pendientes</option>
                    <option value="PENDIENTE">Pendiente</option>
                    <option value="PARCIALMENTE_CONCILIADO">Parcialmente conciliado</option>
                    <option value="CONCILIADO">Conciliado</option>
                    <option value="SIN_DIFERENCIAS">Sin diferencias</option>
                  </select>
                  <label className="fl-label fc-aj-floatLabel" htmlFor="fc-hc-estado">Estado</label>
                </div>
              </div>

              {error && (
                <div className="fc-aj-alert fc-aj-alert--error" role="alert">
                  <FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span>
                </div>
              )}

              <p className="fc-cc-history-help">Elegí un cierre para ver las cajas controladas y resolver las diferencias que queden pendientes.</p>
              <div className="fc-cc-table fc-cc-table--hist" role="table" aria-label="Cierres de caja" aria-busy={loading}>
                <div className="fc-cc-tr fc-cc-tr--head fc-cc-tr--hist-simple" role="row">
                  <div role="columnheader">Cierre y fecha</div>
                  <div role="columnheader">Responsable</div>
                  <div role="columnheader" className="is-num">Por resolver</div>
                  <div role="columnheader">Estado</div>
                  <div role="columnheader" aria-label="Ver detalle" />
                </div>
                {loading && !rows.length && <div className="fc-cc-empty">Cargando…</div>}
                {!loading && !rows.length && !error && <div className="fc-cc-empty">No hay cierres para los filtros elegidos.</div>}
                {rows.map((r) => {
                  const est = ESTADOS_CIERRE[r.estado_conciliacion] || { label: r.estado_conciliacion, tone: "muted" };
                  return (
                    <div key={r.id_cierre} className="fc-cc-tr fc-cc-tr--hist-simple fc-cc-tr--click" role="row" tabIndex={0}
                      data-cierre-id={r.id_cierre}
                      onClick={() => setIdSel(r.id_cierre)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setIdSel(r.id_cierre); } }}>
                      <div role="cell" data-label="Cierre y fecha" className="fc-cc-history-name"><b>{r.numero}</b><span>{fmtDateES(r.fecha_operativa)}{r.es_historico ? " · Histórico" : ""}</span></div>
                      <div role="cell" data-label="Responsable">{r.usuario_nombre || "—"}</div>
                      <div role="cell" data-label="Por resolver" className="is-num"><strong>{moneyARS(r.importe_pendiente)}</strong>{r.diferencias_pendientes ? <small> · {r.diferencias_pendientes} {r.diferencias_pendientes === 1 ? "diferencia" : "diferencias"}</small> : null}</div>
                      <div role="cell" data-label="Estado"><span className={`fc-cc-badge fc-cc-badge--${est.tone}`}>{est.label}</span></div>
                      <div role="cell" className="fc-cc-rowAction"><FontAwesomeIcon icon={faChevronRight} aria-label="Ver detalle" /></div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
