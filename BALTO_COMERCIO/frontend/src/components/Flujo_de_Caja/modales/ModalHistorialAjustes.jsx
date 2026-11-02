// src/components/Flujo_de_Caja/modales/ModalHistorialAjustes.jsx
// Historial de ajustes de saldo (sólo lectura). La única acción permitida es
// revertir: genera un asiento compensatorio con fecha de hoy y ambos registros
// permanecen en el historial.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faClockRotateLeft,
  faRotateLeft,
  faTriangleExclamation,
  faWallet,
  faCircleInfo,
  faCoins,
} from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_Modals.css";
import "./ajustes_saldo.css";

import {
  listarAjustes,
  nuevaClaveSolicitud,
  obtenerMediosAjuste,
  revertirAjuste,
} from "../api/flujoCajaAjustesApi";
import { fmtDateES, moneyARS, moneyARSSigned } from "../utils/flujoCajaUtils";

function fmtDateTime(value) {
  const s = String(value || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return fmtDateES(s.slice(0, 10));
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

function signClass(n) {
  if (n > 0.004) return "is-positive";
  if (n < -0.004) return "is-negative";
  return "is-neutral";
}

function EstadoBadge({ row }) {
  if (row.estado === "REVERTIDO") {
    return <span className="fc-aj-badge fc-aj-badge--reverted" title={`Revertido por el ajuste #${row.revertido_por}`}>REVERTIDO · #{row.revertido_por}</span>;
  }
  if (row.estado === "REVERSION") {
    return <span className="fc-aj-badge fc-aj-badge--reversal">REVERSIÓN DE #{row.id_ajuste_revertido}</span>;
  }
  return <span className="fc-aj-badge fc-aj-badge--active">VIGENTE</span>;
}

export default function ModalHistorialAjustes({ open, onClose, onChanged, showToast }) {
  const [rows, setRows] = useState([]);
  const [neto, setNeto] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [medios, setMedios] = useState([]);
  const [filtros, setFiltros] = useState({ fechaDesde: "", fechaHasta: "", idMedioPago: "" });

  const [revertTarget, setRevertTarget] = useState(null);
  const [revertMotivo, setRevertMotivo] = useState("");
  const [revertError, setRevertError] = useState("");
  const [reverting, setReverting] = useState(false);
  const [revertKey, setRevertKey] = useState("");

  const requestRef = useRef(0);

  const cargar = useCallback(async (f) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const json = await listarAjustes(f);
      if (request !== requestRef.current) return;
      setRows(Array.isArray(json?.rows) ? json.rows : []);
      setNeto(Number(json?.neto || 0));
    } catch (e) {
      if (request !== requestRef.current) return;
      setRows([]);
      setNeto(0);
      setError(e?.message || "No se pudo cargar el historial de ajustes.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const initial = { fechaDesde: "", fechaHasta: "", idMedioPago: "" };
    setFiltros(initial);
    setRevertTarget(null);
    cargar(initial);
    obtenerMediosAjuste()
      .then((json) => setMedios(Array.isArray(json?.medios) ? json.medios : []))
      .catch(() => setMedios([]));
  }, [open, cargar]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || reverting) return;
      if (revertTarget) setRevertTarget(null);
      else onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, reverting, revertTarget, onClose]);

  // Medios presentes en el historial aunque hoy ya no sean ajustables.
  const mediosFiltro = useMemo(() => {
    const map = new Map();
    medios.forEach((m) => map.set(String(m.id_medio_pago), m.nombre));
    rows.forEach((r) => { if (!map.has(String(r.id_medio_pago))) map.set(String(r.id_medio_pago), r.medio_nombre); });
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }));
  }, [medios, rows]);

  const actualizarFiltro = (campo, valor) => {
    const next = { ...filtros, [campo]: valor };
    if (next.fechaDesde && next.fechaHasta && next.fechaDesde > next.fechaHasta) {
      [next.fechaDesde, next.fechaHasta] = [next.fechaHasta, next.fechaDesde];
    }
    setFiltros(next);
    cargar(next);
  };

  const abrirReversion = (row) => {
    setRevertTarget(row);
    setRevertMotivo("");
    setRevertError("");
    setRevertKey(nuevaClaveSolicitud());
  };

  const confirmarReversion = async () => {
    if (!revertTarget || reverting) return;
    if (revertMotivo.trim().length < 5) {
      setRevertError("Indicá el motivo de la reversión (mínimo 5 caracteres).");
      return;
    }
    setReverting(true);
    try {
      const json = await revertirAjuste({
        id_ajuste: revertTarget.id_ajuste,
        observaciones: revertMotivo.trim(),
        clave_solicitud: revertKey,
      });
      showToast?.("exito", json?.mensaje || "Ajuste revertido correctamente.", 3200);
      setRevertTarget(null);
      await cargar(filtros);
      onChanged?.(json);
    } catch (e) {
      setRevertError(e?.message || "No se pudo revertir el ajuste.");
      showToast?.("error", e?.message || "No se pudo revertir el ajuste.", 5200);
    } finally {
      setReverting(false);
    }
  };

  if (!open) return null;

  return (<>
    {createPortal(
    <div className="mi-mini__overlay fc-aj-overlay" role="presentation">
      <div
        className="mi-mini__modal fc-aj-modal fc-aj-modal--wide fc-aj-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fc-aj-hist-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-mini__head">
          <h4 id="fc-aj-hist-title" className="mi-mini__title fc-aj-title">
            <FontAwesomeIcon icon={faClockRotateLeft} />
            <span>Historial de ajustes de saldo</span>
          </h4>
          <button type="button" className="mi-mini__close" onClick={() => !reverting && onClose?.()} disabled={reverting} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-mini__body fc-aj-body">
          <div className="fc-aj-filters" aria-label="Filtros del historial">
            <div className="fl-field">
              <input id="fc-aj-f-desde" type="date" className="fl-input" placeholder=" " value={filtros.fechaDesde}
                onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
                onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)} />
              <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-f-desde">Desde</label>
            </div>
            <div className="fl-field">
              <input id="fc-aj-f-hasta" type="date" className="fl-input" placeholder=" " value={filtros.fechaHasta}
                onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
                onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)} />
              <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-f-hasta">Hasta</label>
            </div>
            <div className="fl-field">
              <select id="fc-aj-f-medio" className="fl-select fc-aj-select" value={filtros.idMedioPago}
                onChange={(e) => actualizarFiltro("idMedioPago", e.target.value)}>
                <option value="">TODOS</option>
                {mediosFiltro.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-f-medio">Medio de pago</label>
            </div>
          </div>

          {error && (
            <div className="fc-aj-alert fc-aj-alert--error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span>
            </div>
          )}

          <div className="fc-aj-tableViewport" role="region" aria-label="Tabla de ajustes">
          <div className="fc-aj-table" role="table" aria-busy={loading} aria-label="Historial de ajustes de saldo">
            <div className="mov-gridTable mov-gridTable--head fc-aj-tr fc-aj-tr--head" role="row">
              {["Fecha y hora", "Medio", "Tipo", "Ajuste", "Saldo anterior", "Saldo posterior", "Motivo", "Usuario", "Estado", "Acciones"].map((h, i) => (
                <div key={i} className={`mov-gridCell--head fc-aj-th ${i >= 3 && i <= 5 ? "is-right" : i >= 8 ? "is-center" : ""}`} role="columnheader">{h}</div>
              ))}
            </div>
            <div className="fc-aj-tableBody" role="rowgroup">
            {loading && Array.from({ length: 24 }, (_, i) => (
              <div key={`loading-${i}`} className="mov-gridTable mov-gridTable--row fc-aj-tr" role="row" aria-hidden="true">
                {Array.from({ length: 10 }, (_, j) => <div key={j} className="mov-gridCell fc-aj-td" role="cell"><span className="fc-aj-skeleton" /></div>)}
              </div>
            ))}
            {!loading && rows.map((r) => (
              <div key={r.id_ajuste} className={`mov-gridTable mov-gridTable--row fc-aj-tr ${r.estado !== "VIGENTE" ? "is-muted" : ""}`} role="row" data-ajuste-id={r.id_ajuste}>
                <div className="mov-gridCell fc-aj-td" role="cell" data-label="Fecha y hora">{fmtDateTime(r.created_at)}</div>
                <div className="mov-gridCell fc-aj-td" role="cell" data-label="Medio">{r.medio_nombre}</div>
                <div className="mov-gridCell fc-aj-td" role="cell" data-label="Tipo">{r.tipo_label}</div>
                <div className={`mov-gridCell fc-aj-td fc-aj-num ${signClass(r.diferencia)}`} role="cell" data-label="Ajuste">{moneyARSSigned(r.diferencia)}</div>
                <div className="mov-gridCell fc-aj-td fc-aj-num" role="cell" data-label="Saldo anterior">{moneyARS(r.saldo_anterior)}</div>
                <div className="mov-gridCell fc-aj-td fc-aj-num" role="cell" data-label="Saldo posterior">{moneyARS(r.saldo_posterior)}</div>
                <div className="mov-gridCell fc-aj-td fc-aj-motivo" role="cell" data-label="Motivo">
                  <span>{r.motivo_label}</span>
                  {r.observaciones && <small title={r.observaciones}>{r.observaciones}</small>}
                </div>
                <div className="mov-gridCell fc-aj-td" role="cell" data-label="Usuario">{r.usuario_nombre || "—"}</div>
                <div className="mov-gridCell fc-aj-td" role="cell" data-label="Estado"><EstadoBadge row={r} /></div>
                <div className="mov-gridCell fc-aj-td fc-aj-td--action" role="cell" data-label="Acciones">
                  {r.puede_revertir === true || r.puede_revertir === 1 || r.puede_revertir === "1" ? (
                    <button type="button" className="mov-iconBtn fc-aj-revertBtn" onClick={() => abrirReversion(r)}
                      disabled={reverting} title="Revertir ajuste" aria-label={`Revertir ajuste #${r.id_ajuste}`}>
                      <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                    </button>
                  ) : <span className="fc-aj-noAction" title="Ajuste no reversible" aria-label="Sin acciones disponibles">—</span>}
                </div>
              </div>
            ))}
            {!loading && !rows.length && !error && (
              <div className="fc-aj-empty" role="row"><div role="cell" aria-colspan={10}><FontAwesomeIcon icon={faClockRotateLeft} /><strong>No hay registros</strong><span>No se encontraron ajustes para los filtros seleccionados.</span></div></div>
            )}
            </div>
          </div>
          </div>
        </div>
        <div className="fc-aj-historyFooter">
          <div className="fc-aj-histMeta" role="status">
            <span>{loading ? "Cargando historial…" : `${rows.length} registro${rows.length === 1 ? "" : "s"}`}</span>
            <span>Efecto neto <b className={signClass(neto)}>{loading || error ? "—" : moneyARSSigned(neto)}</b></span>
          </div>
          <button type="button" className="mit-btn mit-btn--solid" disabled={reverting} onClick={onClose}>Cerrar</button>
        </div>

      </div>
    </div>,
    document.body
  )}

  {revertTarget && createPortal(
          <div className="mi-mini__overlay fc-aj-revert" role="presentation">
            <div className="mi-mini__modal fc-aj-revert__card" role="alertdialog" onMouseDown={(e) => e.stopPropagation()} aria-modal="true"
              aria-labelledby="fc-aj-revert-title" aria-describedby="fc-aj-revert-description">
              <div className="mi-mini__head fc-aj-revert__head">
                <h4 id="fc-aj-revert-title" className="mi-mini__title fc-aj-title">
                  <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                  <span>Revertir ajuste #{revertTarget.id_ajuste}</span>
                </h4>
                <button type="button" className="mi-mini__close" aria-label="Cerrar"
                  onClick={() => setRevertTarget(null)} disabled={reverting}>
                  <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                </button>
              </div>

              <div className="mi-mini__body fc-aj-revert__body">
                <p id="fc-aj-revert-description" className="fc-aj-revert__intro">
                  Revisá el movimiento que se generará antes de confirmar la reversión.
                </p>
                <div className="fc-aj-revert__summary">
                  <div className="fc-aj-revert__detail">
                    <span className="fc-aj-revert__detailIcon" aria-hidden="true"><FontAwesomeIcon icon={faWallet} /></span>
                    <div className="fc-aj-revert__detailText">
                      <span>Medio de pago</span>
                      <strong>{revertTarget.medio_nombre}</strong>
                    </div>
                  </div>
                  <div className={`fc-aj-revert__detail fc-aj-revert__detail--amount ${signClass(-revertTarget.diferencia)}`}>
                    <span className="fc-aj-revert__detailIcon" aria-hidden="true"><FontAwesomeIcon icon={faCoins} /></span>
                    <div className="fc-aj-revert__detailText">
                      <span>Ajuste compensatorio</span>
                      <strong className={signClass(-revertTarget.diferencia)}>{moneyARSSigned(-revertTarget.diferencia)}</strong>
                    </div>
                  </div>
                </div>

                <div className="fl-field fc-aj-revert__field">
                  <textarea id="fc-aj-revert-motivo" className="fl-input fc-aj-textarea" placeholder=" " rows={3} maxLength={500}
                    value={revertMotivo} onChange={(e) => { setRevertMotivo(e.target.value.toUpperCase()); setRevertError(""); }}
                    disabled={reverting} aria-invalid={Boolean(revertError)} aria-describedby={revertError ? "fc-aj-revert-error" : undefined} autoFocus />
                  <label className="fl-label" htmlFor="fc-aj-revert-motivo">Motivo de la reversión</label>
                  <div className="fc-aj-revert__fieldBottom">
                    {revertError ? <small id="fc-aj-revert-error" className="fc-aj-error" role="alert">{revertError}</small> : <span />}
                    <span className="fc-aj-revert__counter">{revertMotivo.length}/500</span>
                  </div>
                </div>

                <div className="fc-aj-revert__info">
                  <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
                  <span>Se registrará con fecha de hoy. El ajuste original se conserva y ambos movimientos quedan en el historial.</span>
                </div>
              </div>

              <div className="fc-aj-revert__footer">
                <button type="button" className="mit-btn mit-btn--ghost" onClick={() => setRevertTarget(null)} disabled={reverting}>Cancelar</button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={confirmarReversion} disabled={reverting}>
                  <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                  {reverting ? "Revirtiendo…" : "Confirmar reversión"}
                </button>
              </div>
            </div>
          </div>
  , document.body)}
</>);
}