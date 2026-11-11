// src/components/Flujo_de_Caja/modales/ModalHistorialAjustes.jsx
// Historial de tesorería (sólo lectura): ajustes de saldo y transferencias
// internas entre cajas, en un único punto de consulta. La única acción
// permitida es revertir: genera una operación compensatoria con fecha de hoy y
// ambos registros permanecen en el historial.

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
  faArrowRightLong,
  faChevronDown,
} from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_Modals.css";
import "./ajustes_saldo.css";

import {
  listarAjustes,
  listarTransferencias,
  nuevaClaveSolicitud,
  nuevaClaveTransferencia,
  obtenerMediosAjuste,
  revertirAjuste,
  revertirTransferencia,
} from "../api/flujoCajaAjustesApi";
import { fmtDateES, moneyARS, moneyARSSigned } from "../utils/flujoCajaUtils";

const VISTAS = [
  { codigo: "TODOS", label: "Todos" },
  { codigo: "AJUSTES", label: "Ajustes" },
  { codigo: "TRANSFERENCIAS", label: "Transferencias" },
];

const FILTROS_INICIALES = { fechaDesde: "", fechaHasta: "", idMedioPago: "", estado: "" };

/** Orden de operación: fecha y hora descendente, desempate estable por tipo e ID. */
function compararMovimientos(a, b) {
  const ca = String(a.created_at || ""); const cb = String(b.created_at || "");
  if (ca !== cb) return ca < cb ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return Number(b.id) - Number(a.id);
}

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

function EstadoTransferencia({ row }) {
  if (row.estado === "REVERTIDO") {
    return <span className="fc-aj-badge fc-aj-badge--reverted" title={`Revertida por la transferencia #${row.revertido_por}`}>REVERTIDO · #{row.revertido_por}</span>;
  }
  if (row.estado === "REVERSION") {
    return <span className="fc-aj-badge fc-aj-badge--reversal">REVERSIÓN DE #{row.id_transferencia_revertida}</span>;
  }
  return <span className="fc-aj-badge fc-aj-badge--active">VIGENTE</span>;
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
  const [transferencias, setTransferencias] = useState([]);
  const [neto, setNeto] = useState(0);
  const [netoTransfer, setNetoTransfer] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transferError, setTransferError] = useState("");
  const [medios, setMedios] = useState([]);
  const [vista, setVista] = useState("TODOS");
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [expandida, setExpandida] = useState(null);

  const [revertTarget, setRevertTarget] = useState(null);
  const [revertMotivo, setRevertMotivo] = useState("");
  const [revertError, setRevertError] = useState("");
  const [reverting, setReverting] = useState(false);
  const [revertKey, setRevertKey] = useState("");

  const requestRef = useRef(0);

  // Ajustes y transferencias se consultan en paralelo. Un fallo de una fuente
  // no oculta la otra (ej.: transferencias aún no habilitadas en el comercio).
  const cargar = useCallback(async (f, v = "TODOS") => {
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    setTransferError("");
    const quiereAjustes = v !== "TRANSFERENCIAS";
    const quiereTransfer = v !== "AJUSTES";
    const estadoTransfer = f.estado || "";
    const [aj, tr] = await Promise.allSettled([
      quiereAjustes ? listarAjustes(f) : Promise.resolve({ rows: [], neto: 0 }),
      quiereTransfer ? listarTransferencias({ ...f, estado: estadoTransfer }) : Promise.resolve({ rows: [], neto: 0 }),
    ]);
    if (request !== requestRef.current) return;
    if (aj.status === "fulfilled") {
      const list = Array.isArray(aj.value?.rows) ? aj.value.rows : [];
      // El endpoint de ajustes no filtra por estado: se aplica aquí.
      const filtradas = f.estado ? list.filter((r) => r.estado === f.estado) : list;
      setRows(filtradas);
      setNeto(f.estado ? filtradas.reduce((s, r) => s + Number(r.diferencia || 0), 0) : Number(aj.value?.neto || 0));
    } else {
      setRows([]);
      setNeto(0);
      setError(aj.reason?.message || "No se pudo cargar el historial de ajustes.");
    }
    if (tr.status === "fulfilled") {
      setTransferencias(Array.isArray(tr.value?.rows) ? tr.value.rows : []);
      setNetoTransfer(Number(tr.value?.neto || 0));
    } else {
      setTransferencias([]);
      setNetoTransfer(0);
      const msg = tr.reason?.message || "No se pudo cargar el historial de transferencias.";
      if (v === "TRANSFERENCIAS") setError(msg); else setTransferError(msg);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setFiltros(FILTROS_INICIALES);
    setVista("TODOS");
    setExpandida(null);
    setRevertTarget(null);
    cargar(FILTROS_INICIALES, "TODOS");
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
    transferencias.forEach((t) => {
      if (!map.has(String(t.id_medio_origen))) map.set(String(t.id_medio_origen), t.medio_origen_nombre);
      if (!map.has(String(t.id_medio_destino))) map.set(String(t.id_medio_destino), t.medio_destino_nombre);
    });
    return Array.from(map.entries()).map(([id, nombre]) => ({ id, nombre }));
  }, [medios, rows, transferencias]);

  const items = useMemo(() => {
    const out = [];
    if (vista !== "TRANSFERENCIAS") rows.forEach((r) => out.push({ kind: "ajuste", id: r.id_ajuste, created_at: r.created_at, row: r }));
    if (vista !== "AJUSTES") transferencias.forEach((t) => out.push({ kind: "transferencia", id: t.id_transferencia, created_at: t.created_at, row: t }));
    return out.sort(compararMovimientos);
  }, [rows, transferencias, vista]);

  const netoVista = (vista !== "TRANSFERENCIAS" ? neto : 0) + (vista !== "AJUSTES" ? netoTransfer : 0);
  const columnas = vista === "AJUSTES"
    ? ["Fecha y hora", "Medio", "Tipo", "Ajuste", "Saldo anterior", "Saldo posterior", "Motivo", "Estado", "Acciones"]
    : ["Fecha y hora", "Medio(s)", "Tipo", "Importe", "Saldo anterior", "Saldo posterior", "Motivo / Obs.", "Estado", "Acciones"];

  const actualizarFiltro = (campo, valor) => {
    const next = { ...filtros, [campo]: valor };
    if (next.fechaDesde && next.fechaHasta && next.fechaDesde > next.fechaHasta) {
      [next.fechaDesde, next.fechaHasta] = [next.fechaHasta, next.fechaDesde];
    }
    setFiltros(next);
    cargar(next, vista);
  };

  const cambiarVista = (v) => {
    setVista(v);
    setExpandida(null);
    cargar(filtros, v);
  };

  const abrirReversion = (row, kind = "ajuste") => {
    setRevertTarget({ ...row, kind });
    setRevertMotivo("");
    setRevertError("");
    setRevertKey(kind === "transferencia" ? nuevaClaveTransferencia() : nuevaClaveSolicitud());
  };

  const confirmarReversion = async () => {
    if (!revertTarget || reverting) return;
    if (revertMotivo.trim().length < 5) {
      setRevertError("Indicá el motivo de la reversión (mínimo 5 caracteres).");
      return;
    }
    setReverting(true);
    const esTransfer = revertTarget.kind === "transferencia";
    try {
      const json = esTransfer
        ? await revertirTransferencia({
          id_transferencia: revertTarget.id_transferencia,
          observaciones: revertMotivo.trim(),
          clave_solicitud: revertKey,
        })
        : await revertirAjuste({
          id_ajuste: revertTarget.id_ajuste,
          observaciones: revertMotivo.trim(),
          clave_solicitud: revertKey,
        });
      showToast?.("exito", json?.mensaje || (esTransfer ? "Transferencia revertida correctamente." : "Ajuste revertido correctamente."), 3200);
      setRevertTarget(null);
      await cargar(filtros, vista);
      onChanged?.(json);
    } catch (e) {
      const fallback = esTransfer ? "No se pudo revertir la transferencia." : "No se pudo revertir el ajuste.";
      setRevertError(e?.message || fallback);
      showToast?.("error", e?.message || fallback, 5200);
    } finally {
      setReverting(false);
    }
  };

  if (!open) return null;

  const renderAjuste = (r) => (
    <div key={`a-${r.id_ajuste}`} className={`mov-gridTable mov-gridTable--row fc-aj-tr ${r.estado !== "VIGENTE" ? "is-muted" : ""}`} role="row" data-ajuste-id={r.id_ajuste}>
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
      <div className="mov-gridCell fc-aj-td" role="cell" data-label="Estado"><EstadoBadge row={r} /></div>
      <div className="mov-gridCell fc-aj-td fc-aj-td--action" role="cell" data-label="Acciones">
        {r.puede_revertir === true || r.puede_revertir === 1 || r.puede_revertir === "1" ? (
          <button type="button" className="mov-iconBtn fc-aj-revertBtn" onClick={() => abrirReversion(r, "ajuste")}
            disabled={reverting} title="Revertir ajuste" aria-label={`Revertir ajuste #${r.id_ajuste}`}>
            <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
          </button>
        ) : <span className="fc-aj-noAction" title="Ajuste no reversible" aria-label="Sin acciones disponibles">—</span>}
      </div>
    </div>
  );

  const renderTransferencia = (t) => {
    const abierta = expandida === t.id_transferencia;
    const detalleId = `fc-tr-det-${t.id_transferencia}`;
    const efecto = t.efecto_medio;
    return (
      <React.Fragment key={`t-${t.id_transferencia}`}>
        <div className={`mov-gridTable mov-gridTable--row fc-aj-tr fc-tr-row ${t.estado !== "VIGENTE" ? "is-muted" : ""}`} role="row" data-transferencia-id={t.id_transferencia}>
          <div className="mov-gridCell fc-aj-td" role="cell" data-label="Fecha y hora">{fmtDateTime(t.created_at)}</div>
          <div className="mov-gridCell fc-aj-td fc-tr-routeCell" role="cell" data-label="Medios">
            <span title={t.medio_origen_nombre}>{t.medio_origen_nombre}</span>
            <FontAwesomeIcon icon={faArrowRightLong} aria-label="hacia" />
            <span title={t.medio_destino_nombre}>{t.medio_destino_nombre}</span>
          </div>
          <div className="mov-gridCell fc-aj-td fc-tr-tipo" role="cell" data-label="Tipo">{t.tipo_label}</div>
          <div className={`mov-gridCell fc-aj-td fc-aj-num ${efecto == null ? "is-neutral" : signClass(efecto)}`} role="cell" data-label="Importe"
            title={efecto == null ? "Importe transferido (no cambia el total del negocio)" : "Efecto sobre el medio filtrado"}>
            {efecto == null ? moneyARS(t.importe) : moneyARSSigned(efecto)}
          </div>
          <div className="mov-gridCell fc-aj-td fc-aj-num fc-tr-stack" role="cell" data-label="Saldo anterior">
            <small><em>Orig.</em> <b>{moneyARS(t.saldo_origen_anterior)}</b></small><small><em>Dest.</em> <b>{moneyARS(t.saldo_destino_anterior)}</b></small>
          </div>
          <div className="mov-gridCell fc-aj-td fc-aj-num fc-tr-stack" role="cell" data-label="Saldo posterior">
            <small><em>Orig.</em> <b>{moneyARS(t.saldo_origen_posterior)}</b></small><small><em>Dest.</em> <b>{moneyARS(t.saldo_destino_posterior)}</b></small>
          </div>
          <div className="mov-gridCell fc-aj-td fc-aj-motivo" role="cell" data-label="Observaciones">
            <span>{t.tipo === "REVERSION" ? "REVERSIÓN" : "TRANSFERENCIA INTERNA"}</span>
            {t.observaciones && <small title={t.observaciones}>{t.observaciones}</small>}
          </div>
          <div className="mov-gridCell fc-aj-td" role="cell" data-label="Estado"><EstadoTransferencia row={t} /></div>
          <div className="mov-gridCell fc-aj-td fc-aj-td--action fc-tr-actions" role="cell" data-label="Acciones">
            <button type="button" className={`mov-iconBtn fc-tr-detailBtn ${abierta ? "is-open" : ""}`} aria-expanded={abierta} aria-controls={detalleId}
              onClick={() => setExpandida(abierta ? null : t.id_transferencia)} title={abierta ? "Ocultar detalle" : "Ver detalle"} aria-label={`Detalle de la transferencia #${t.id_transferencia}`}>
              <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
            </button>
            {t.puede_revertir === true && (
              <button type="button" className="mov-iconBtn fc-aj-revertBtn" onClick={() => abrirReversion(t, "transferencia")}
                disabled={reverting} title="Revertir transferencia" aria-label={`Revertir transferencia #${t.id_transferencia}`}>
                <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {abierta && (
          <div className="fc-tr-detail" id={detalleId} role="row" data-transferencia-detalle={t.id_transferencia}>
            <dl role="cell" aria-colspan={9}>
              <div><dt>ID</dt><dd>#{t.id_transferencia}</dd></div>
              <div><dt>Fecha y hora</dt><dd>{fmtDateTime(t.created_at)}</dd></div>
              <div><dt>Importe transferido</dt><dd>{moneyARS(t.importe)}</dd></div>
              <div><dt>Origen · {t.medio_origen_nombre}{t.medio_origen_activo === false ? " (inactivo)" : ""}</dt>
                <dd>{moneyARS(t.saldo_origen_anterior)} → {moneyARS(t.saldo_origen_posterior)}</dd></div>
              <div><dt>Destino · {t.medio_destino_nombre}{t.medio_destino_activo === false ? " (inactivo)" : ""}</dt>
                <dd>{moneyARS(t.saldo_destino_anterior)} → {moneyARS(t.saldo_destino_posterior)}</dd></div>
              <div><dt>Usuario</dt><dd>{t.usuario_nombre || "—"}</dd></div>
              <div><dt>Estado</dt><dd><EstadoTransferencia row={t} /></dd></div>
              {t.id_transferencia_revertida && <div><dt>Revierte a</dt><dd>Transferencia #{t.id_transferencia_revertida}</dd></div>}
              {t.revertido_por && <div><dt>Revertida por</dt><dd>#{t.revertido_por}{t.fecha_reversion ? ` · ${fmtDateES(t.fecha_reversion)}` : ""}{t.revertido_por_usuario ? ` · ${t.revertido_por_usuario}` : ""}</dd></div>}
              <div className="fc-tr-detail__wide"><dt>Observaciones</dt><dd>{t.observaciones || "—"}</dd></div>
            </dl>
          </div>
        )}
      </React.Fragment>
    );
  };

  return (<>
    {createPortal(
    <div className="mi-mini__overlay fc-aj-overlay" role="presentation">
      <div
        className="mi-mini__modal fc-aj-modal fc-aj-modal--wide fc-aj-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fc-aj-hist-title"
        aria-describedby="fc-aj-hist-subtitle"
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
          <p id="fc-aj-hist-subtitle" className="fc-aj-help fc-tr-histSubtitle">Movimientos de tesorería: ajustes de saldo y transferencias internas entre cajas.</p>
          <div className="gm-view-tabs fc-aj-typeTabs fc-tr-viewTabs" role="tablist" aria-label="Tipo de movimiento">
            {VISTAS.map((v) => (
              <button key={v.codigo} type="button" role="tab" id={`fc-hist-tab-${v.codigo}`} aria-selected={vista === v.codigo}
                className={`gm-view-tab ${vista === v.codigo ? "is-active" : ""}`} onClick={() => cambiarVista(v.codigo)} disabled={reverting}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="fc-aj-filters fc-tr-filters" aria-label="Filtros del historial">
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
            <div className="fl-field">
              <select id="fc-aj-f-estado" className="fl-select fc-aj-select" value={filtros.estado}
                onChange={(e) => actualizarFiltro("estado", e.target.value)}>
                <option value="">TODOS</option>
                <option value="VIGENTE">VIGENTE</option>
                <option value="REVERTIDO">REVERTIDO</option>
                <option value="REVERSION">REVERSIÓN</option>
              </select>
              <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-f-estado">Estado</label>
            </div>
          </div>

          {error && (
            <div className="fc-aj-alert fc-aj-alert--error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span>
            </div>
          )}
          {transferError && !error && (
            <div className="fc-aj-alert fc-aj-alert--warning" role="status">
              <FontAwesomeIcon icon={faTriangleExclamation} /><span>Transferencias: {transferError}</span>
            </div>
          )}

          <div className="fc-aj-tableViewport" role="region" aria-label="Tabla de movimientos de tesorería">
          <div className="fc-aj-table" role="table" aria-busy={loading} aria-label="Historial de ajustes de saldo">
            <div className="mov-gridTable mov-gridTable--head fc-aj-tr fc-aj-tr--head" role="row">
              {columnas.map((h, i) => (
                <div key={i} className={`mov-gridCell--head fc-aj-th ${i >= 3 && i <= 5 ? "is-right" : i >= 7 ? "is-center" : ""}`} role="columnheader">{h}</div>
              ))}
            </div>
            <div className="fc-aj-tableBody" role="rowgroup">
            {loading && Array.from({ length: 24 }, (_, i) => (
              <div key={`loading-${i}`} className="mov-gridTable mov-gridTable--row fc-aj-tr" role="row" aria-hidden="true">
                {Array.from({ length: 9 }, (_, j) => <div key={j} className="mov-gridCell fc-aj-td" role="cell"><span className="fc-aj-skeleton" /></div>)}
              </div>
            ))}
            {!loading && items.map((it) => (it.kind === "ajuste" ? renderAjuste(it.row) : renderTransferencia(it.row)))}
            {!loading && !items.length && !error && (
              <div className="fc-aj-empty" role="row"><div role="cell" aria-colspan={9}><FontAwesomeIcon icon={faClockRotateLeft} /><strong>No hay registros</strong><span>No se encontraron movimientos para los filtros seleccionados.</span></div></div>
            )}
            </div>
          </div>
          </div>
        </div>
        <div className="fc-aj-historyFooter">
          <div className="fc-aj-histMeta" role="status">
            <span>{loading ? "Cargando historial…" : `${items.length} registro${items.length === 1 ? "" : "s"}`}</span>
            <span title={filtros.idMedioPago ? "Efecto sobre el medio seleccionado" : "Las transferencias internas no cambian el total del negocio"}>
              Efecto neto <b className={signClass(netoVista)}>{loading || error ? "—" : moneyARSSigned(netoVista)}</b>
            </span>
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
                  <span>{revertTarget.kind === "transferencia" ? `Revertir transferencia #${revertTarget.id_transferencia}` : `Revertir ajuste #${revertTarget.id_ajuste}`}</span>
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
                {revertTarget.kind === "transferencia" ? (
                  <div className="fc-aj-revert__summary">
                    <div className="fc-aj-revert__detail">
                      <span className="fc-aj-revert__detailIcon" aria-hidden="true"><FontAwesomeIcon icon={faWallet} /></span>
                      <div className="fc-aj-revert__detailText">
                        <span>Devuelve desde → hacia</span>
                        <strong data-testid="fc-tr-revert-route">{revertTarget.medio_destino_nombre} → {revertTarget.medio_origen_nombre}</strong>
                      </div>
                    </div>
                    <div className="fc-aj-revert__detail fc-aj-revert__detail--amount is-neutral">
                      <span className="fc-aj-revert__detailIcon" aria-hidden="true"><FontAwesomeIcon icon={faCoins} /></span>
                      <div className="fc-aj-revert__detailText">
                        <span>Transferencia compensatoria</span>
                        <strong data-testid="fc-tr-revert-importe">{moneyARS(revertTarget.importe)}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
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
                )}
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
                  <span>{revertTarget.kind === "transferencia"
                    ? "Se registrará con fecha de hoy. La caja que devuelve el dinero debe tener saldo suficiente. La transferencia original se conserva y ambas quedan en el historial; el total del negocio no cambia."
                    : "Se registrará con fecha de hoy. El ajuste original se conserva y ambos movimientos quedan en el historial."}</span>
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