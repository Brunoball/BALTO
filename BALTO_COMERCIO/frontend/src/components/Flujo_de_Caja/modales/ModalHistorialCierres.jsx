// src/components/Flujo_de_Caja/modales/ModalHistorialCierres.jsx
// Historial de cierres de caja (sólo lectura) con filtros y acceso al detalle.
// Desde el detalle se concilian diferencias y se aplican ajustes posteriores.
// Un cierre confirmado no se edita ni se elimina.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft, faTriangleExclamation, faChevronRight, faArrowLeft, faReceipt, faFilterCircleXmark,
} from "@fortawesome/free-solid-svg-icons";

import "./cierres_caja.css";

import { listarCierres } from "../api/flujoCajaCierresApi";
import { obtenerMediosAjuste } from "../api/flujoCajaAjustesApi";
import { fmtDateES, moneyARS } from "../utils/flujoCajaUtils";
import { ESTADOS_CIERRE } from "../utils/cierresUtils";
import DetalleCierreCaja from "./DetalleCierreCaja.jsx";
import { Badge, ModalShell } from "./FcModalParts.jsx";

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

  const actualizarFiltro = (k, v) => {
    const next = { ...filtros, [k]: v };
    if (next.fechaDesde && next.fechaHasta && next.fechaDesde > next.fechaHasta) {
      [next.fechaDesde, next.fechaHasta] = [next.fechaHasta, next.fechaDesde];
    }
    setFiltros(next);
    cargar(next);
  };
  const hayFiltros = Object.values(filtros).some(Boolean);
  const limpiarFiltros = () => { setFiltros(FILTROS_INICIALES); cargar(FILTROS_INICIALES); };

  const handleChanged = useCallback(() => {
    cargar(filtros);
    onChanged?.();
  }, [cargar, filtros, onChanged]);

  const volverAlHistorial = useCallback(() => setIdSel(null), []);
  const pendienteTotal = useMemo(() => rows.reduce((s, r) => s + Number(r.importe_pendiente || 0), 0), [rows]);

  if (!open) return null;

  const enDetalle = Boolean(idSel);
  const footer = enDetalle ? (
    <>
      <div className="fc-md-footer__start">
        <button type="button" className="mit-btn mit-btn--ghost" onClick={volverAlHistorial} disabled={childBusy}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver al historial
        </button>
      </div>
      <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={childBusy}>Cerrar</button>
    </>
  ) : (
    <>
      <div className="fc-md-footer__start fc-md-note" role="status">
        <span>{loading ? "Cargando…" : `${rows.length} cierre${rows.length === 1 ? "" : "s"}`}</span>
        {!loading && pendienteTotal > 0.004 && (
          <span>· Pendiente total <b className="fc-md-num fc-md-num--warn">{moneyARS(pendienteTotal)}</b></span>
        )}
      </div>
      <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()}>Cerrar</button>
    </>
  );

  return (
    <ModalShell
      open
      titleId="fc-hc-title"
      title={enDetalle ? "Detalle del cierre" : "Historial de cierres"}
      icon={enDetalle ? faReceipt : faClockRotateLeft}
      onClose={onClose}
      onEscape={enDetalle ? volverAlHistorial : onClose}
      closeDisabled={childBusy}
      size="xl"
      className="fc-md-modal--fixed fc-cc-modal fc-hc-modal"
      bodyClassName={enDetalle ? "" : "fc-md-body--table"}
      footer={footer}
    >
      {enDetalle ? (
        <DetalleCierreCaja
          idCierre={idSel}
          onChanged={handleChanged}
          onBusyChange={setChildBusy}
          showToast={showToast}
        />
      ) : (
        <>
          <div className="fc-md-toolbar" role="search" aria-label="Filtros del historial de cierres">
            <div className="fl-field fc-md-fl">
              <input id="fc-hc-desde" type="date" className="fl-input" placeholder=" " value={filtros.fechaDesde} onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)} />
              <label className="fl-label" htmlFor="fc-hc-desde">Desde</label>
            </div>
            <div className="fl-field fc-md-fl">
              <input id="fc-hc-hasta" type="date" className="fl-input" placeholder=" " value={filtros.fechaHasta} onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)} />
              <label className="fl-label" htmlFor="fc-hc-hasta">Hasta</label>
            </div>
            <div className="fl-field fc-md-fl fc-md-fl--wide">
              <select id="fc-hc-medio" className="fl-select" value={filtros.idMedioPago} onChange={(e) => actualizarFiltro("idMedioPago", e.target.value)}>
                <option value="">Todos</option>
                {medios.map((m) => <option key={m.id_medio_pago} value={m.id_medio_pago}>{m.nombre}</option>)}
              </select>
              <label className="fl-label" htmlFor="fc-hc-medio">Medio de pago</label>
            </div>
            <div className="fl-field fc-md-fl fc-md-fl--wide">
              <select id="fc-hc-estado" className="fl-select" value={filtros.estado} onChange={(e) => actualizarFiltro("estado", e.target.value)}>
                <option value="">Todos</option>
                <option value="CON_PENDIENTES">Con diferencias pendientes</option>
                <option value="PENDIENTE">Pendiente</option>
                <option value="PARCIALMENTE_CONCILIADO">Parcialmente conciliado</option>
                <option value="CONCILIADO">Conciliado</option>
                <option value="SIN_DIFERENCIAS">Sin diferencias</option>
              </select>
              <label className="fl-label" htmlFor="fc-hc-estado">Estado</label>
            </div>
            {hayFiltros && (
              <div className="fc-md-toolbar__end">
                <button type="button" className="mit-btn mit-btn--ghost fc-md-clear" onClick={limpiarFiltros}>
                  <FontAwesomeIcon icon={faFilterCircleXmark} /> Limpiar
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="fc-md-alert fc-md-alert--error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span>
            </div>
          )}

          <div className="fc-md-table fc-md-table--cards fc-hc-table" role="table" aria-label="Cierres de caja" aria-busy={loading}>
            <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
              <div className="mov-gridCell--head" role="columnheader">Fecha</div>
              <div className="mov-gridCell--head" role="columnheader">Cierre</div>
              <div className="mov-gridCell--head" role="columnheader">Responsable</div>
              <div className="mov-gridCell--head is-right" role="columnheader">Pendiente</div>
              <div className="mov-gridCell--head" role="columnheader">Estado</div>
              <div className="mov-gridCell--head is-center" role="columnheader">Detalle</div>
            </div>
            <div className="fc-md-tbody" role="rowgroup">
              {loading && !rows.length && <div className="fc-md-empty" role="row"><span role="cell">Cargando historial…</span></div>}
              {!loading && !rows.length && !error && (
                <div className="fc-md-empty" role="row">
                  <div role="cell" className="fc-md-empty__cell">
                    <FontAwesomeIcon icon={faClockRotateLeft} />
                    <strong>No hay cierres</strong>
                    <span>{hayFiltros ? "Ningún cierre coincide con los filtros elegidos." : "Todavía no se registró ningún cierre de caja."}</span>
                  </div>
                </div>
              )}
              {rows.map((r) => {
                const est = ESTADOS_CIERRE[r.estado_conciliacion] || { label: r.estado_conciliacion, tone: "muted" };
                const pend = Number(r.importe_pendiente || 0);
                const abrir = () => setIdSel(r.id_cierre);
                return (
                  <div key={r.id_cierre} className="mov-gridTable fc-md-row fc-md-tr fc-md-tr--click" role="row" tabIndex={0}
                    data-cierre-id={r.id_cierre}
                    aria-label={`Ver cierre ${r.numero} del ${fmtDateES(r.fecha_operativa)}`}
                    onClick={abrir}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } }}>
                    <div className="mov-gridCell fc-md-cell--stack" role="cell" data-label="Fecha">
                      <span className="fc-md-num">{fmtDateES(r.fecha_operativa)}</span>
                      {r.es_historico ? <small>Histórico</small> : null}
                    </div>
                    <div className="mov-gridCell" role="cell" data-label="Cierre"><b className="fc-md-ellipsis">{r.numero}</b></div>
                    <div className="mov-gridCell" role="cell" data-label="Responsable"><span className="fc-md-ellipsis">{r.usuario_nombre || "—"}</span></div>
                    <div className="mov-gridCell fc-md-cell--stack is-right" role="cell" data-label="Pendiente">
                      {pend > 0.004 ? (
                        <>
                          <span className="fc-md-num fc-md-num--warn fc-md-num--strong">{moneyARS(pend)}</span>
                          {r.diferencias_pendientes ? <small>{r.diferencias_pendientes} {r.diferencias_pendientes === 1 ? "diferencia" : "diferencias"}</small> : null}
                        </>
                      ) : <span className="fc-md-num fc-md-num--zero">{moneyARS(0)}</span>}
                    </div>
                    <div className="mov-gridCell" role="cell" data-label="Estado"><Badge tone={est.tone}>{est.label}</Badge></div>
                    <div className="mov-gridCell is-center fc-md-cell--actions" role="cell">
                      <span className="mov-iconBtn" aria-hidden="true"><FontAwesomeIcon icon={faChevronRight} /></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}
