import "../../Mov_Subsection/Documentos_Comerciales/DocumentosComerciales.css";
// src/components/Flujo_de_Caja/modales/ModalHistorialAjustes.jsx
// Historial de tesorería (sólo lectura): ajustes de saldo y transferencias
// internas entre cajas, en un único punto de consulta. La única acción
// permitida es revertir: genera una operación compensatoria con fecha de hoy y
// ambos registros permanecen en el historial.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft,
  faRotateLeft,
  faTriangleExclamation,
  faCoins,
  faArrowRightLong,
  faChevronDown,
  faFilterCircleXmark,
} from "@fortawesome/free-solid-svg-icons";

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
import { Badge, FieldMsg, MetaList, ModalShell, Stat, toneOf } from "./FcModalParts.jsx";

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
  if (!m) return { fecha: fmtDateES(s.slice(0, 10)), hora: "" };
  return { fecha: `${m[3]}/${m[2]}/${m[1]}`, hora: `${m[4]}:${m[5]}` };
}

const numClase = (n) => `fc-md-num fc-md-num--${toneOf(n)}`;
const puedeRevertir = (v) => v === true || v === 1 || v === "1";

function EstadoTransferencia({ row }) {
  if (row.estado === "REVERTIDO") {
    return <Badge tone="reverted" title={`Revertida por la transferencia #${row.revertido_por}`}>REVERTIDO · #{row.revertido_por}</Badge>;
  }
  if (row.estado === "REVERSION") {
    return <Badge tone="reversal">REVERSIÓN DE #{row.id_transferencia_revertida}</Badge>;
  }
  return <Badge tone="active">VIGENTE</Badge>;
}

function EstadoBadge({ row }) {
  if (row.estado === "REVERTIDO") {
    return <Badge tone="reverted" title={`Revertido por el ajuste #${row.revertido_por}`}>REVERTIDO · #{row.revertido_por}</Badge>;
  }
  if (row.estado === "REVERSION") {
    return <Badge tone="reversal">REVERSIÓN DE #{row.id_ajuste_revertido}</Badge>;
  }
  return <Badge tone="active">VIGENTE</Badge>;
}

function CeldaFecha({ value }) {
  const d = fmtDateTime(value);
  return (
    <div className="mov-gridCell fc-md-cell--stack" role="cell" data-label="Fecha y hora">
      <span className="fc-md-num">{d.fecha}</span>
      {d.hora && <small>{d.hora} h</small>}
    </div>
  );
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


  const hayFiltros = Object.values(filtros).some(Boolean);
  const limpiarFiltros = () => { setFiltros(FILTROS_INICIALES); setExpandida(null); cargar(FILTROS_INICIALES, vista); };
  const cerrarReversion = useCallback(() => { if (!reverting) setRevertTarget(null); }, [reverting]);

  if (!open) return null;

  const renderAjuste = (r) => (
    <div key={`a-${r.id_ajuste}`} className={`mov-gridTable fc-md-row fc-md-tr ${r.estado !== "VIGENTE" ? "is-muted" : ""}`} role="row" data-ajuste-id={r.id_ajuste}>
      <CeldaFecha value={r.created_at} />
      <div className="mov-gridCell fc-md-cell--stack" role="cell" data-label="Medio">
        <span className="fc-md-ellipsis" title={r.medio_nombre}><b>{r.medio_nombre}</b></span>
        <small>{r.tipo_label}</small>
      </div>
      <div className="mov-gridCell is-right" role="cell" data-label="Ajuste"><span className={`${numClase(r.diferencia)} fc-md-num--strong`}>{moneyARSSigned(r.diferencia)}</span></div>
      <div className="mov-gridCell is-right" role="cell" data-label="Saldo anterior"><span className="fc-md-num">{moneyARS(r.saldo_anterior)}</span></div>
      <div className="mov-gridCell is-right" role="cell" data-label="Saldo posterior"><span className="fc-md-num">{moneyARS(r.saldo_posterior)}</span></div>
      <div className="mov-gridCell fc-md-cell--stack fc-md-cell--full" role="cell" data-label="Motivo">
        <span className="fc-md-clamp2">{r.motivo_label}</span>
        {r.observaciones && <small className="fc-md-clamp2" title={r.observaciones}>{r.observaciones}</small>}
      </div>
      <div className="mov-gridCell" role="cell" data-label="Estado"><EstadoBadge row={r} /></div>
      <div className="mov-gridCell is-center fc-md-cell--actions" role="cell" data-label="Acciones">
        <span className="fc-md-actions">
          {puedeRevertir(r.puede_revertir) ? (
            <button type="button" className="mov-iconBtn" onClick={() => abrirReversion(r, "ajuste")}
              disabled={reverting} title="Revertir ajuste" aria-label={`Revertir ajuste #${r.id_ajuste}`}>
              <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
            </button>
          ) : <span className="fc-md-num--zero" title="Ajuste no reversible" aria-label="Sin acciones disponibles">—</span>}
        </span>
      </div>
    </div>
  );

  const renderTransferencia = (t) => {
    const abierta = expandida === t.id_transferencia;
    const detalleId = `fc-tr-det-${t.id_transferencia}`;
    const efecto = t.efecto_medio;
    return (
      <React.Fragment key={`t-${t.id_transferencia}`}>
        <div className={`mov-gridTable fc-md-row fc-md-tr ${t.estado !== "VIGENTE" ? "is-muted" : ""}`} role="row" data-transferencia-id={t.id_transferencia}>
          <CeldaFecha value={t.created_at} />
          <div className="mov-gridCell fc-md-cell--stack" role="cell" data-label="Medios">
            <span className="fc-hx-route">
              <b title={t.medio_origen_nombre}>{t.medio_origen_nombre}</b>
              <FontAwesomeIcon icon={faArrowRightLong} aria-label="hacia" />
              <b title={t.medio_destino_nombre}>{t.medio_destino_nombre}</b>
            </span>
            <small>{t.tipo_label}</small>
          </div>
          <div className="mov-gridCell is-right" role="cell" data-label="Importe"
            title={efecto == null ? "Importe transferido (no cambia el total del negocio)" : "Efecto sobre el medio filtrado"}>
            <span className={`${efecto == null ? "fc-md-num" : numClase(efecto)} fc-md-num--strong`}>{efecto == null ? moneyARS(t.importe) : moneyARSSigned(efecto)}</span>
          </div>
          <div className="mov-gridCell fc-md-cell--stack is-right" role="cell" data-label="Saldo anterior">
            <small className="fc-hx-pair"><em>Orig.</em> <b>{moneyARS(t.saldo_origen_anterior)}</b></small>
            <small className="fc-hx-pair"><em>Dest.</em> <b>{moneyARS(t.saldo_destino_anterior)}</b></small>
          </div>
          <div className="mov-gridCell fc-md-cell--stack is-right" role="cell" data-label="Saldo posterior">
            <small className="fc-hx-pair"><em>Orig.</em> <b>{moneyARS(t.saldo_origen_posterior)}</b></small>
            <small className="fc-hx-pair"><em>Dest.</em> <b>{moneyARS(t.saldo_destino_posterior)}</b></small>
          </div>
          <div className="mov-gridCell fc-md-cell--stack fc-md-cell--full" role="cell" data-label="Motivo">
            <span className="fc-md-clamp2">{t.tipo === "REVERSION" ? "REVERSIÓN" : "TRANSFERENCIA INTERNA"}</span>
            {t.observaciones && <small className="fc-md-clamp2" title={t.observaciones}>{t.observaciones}</small>}
          </div>
          <div className="mov-gridCell" role="cell" data-label="Estado"><EstadoTransferencia row={t} /></div>
          <div className="mov-gridCell is-center fc-md-cell--actions" role="cell" data-label="Acciones">
            <span className="fc-md-actions">
              <button type="button" className={`mov-iconBtn fc-hx-detailBtn ${abierta ? "is-open" : ""}`} aria-expanded={abierta} aria-controls={detalleId}
                onClick={() => setExpandida(abierta ? null : t.id_transferencia)} title={abierta ? "Ocultar detalle" : "Ver detalle"} aria-label={`Detalle de la transferencia #${t.id_transferencia}`}>
                <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
              </button>
              {t.puede_revertir === true && (
                <button type="button" className="mov-iconBtn" onClick={() => abrirReversion(t, "transferencia")}
                  disabled={reverting} title="Revertir transferencia" aria-label={`Revertir transferencia #${t.id_transferencia}`}>
                  <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        </div>
        {abierta && (
          <div id={detalleId} className="fc-hx-detail" role="row" data-transferencia-detalle={t.id_transferencia}>
            <div role="cell">
              <MetaList items={[
                { label: "Importe transferido", value: moneyARS(t.importe) },
                { label: `Origen · ${t.medio_origen_nombre}${t.medio_origen_activo === false ? " (inactivo)" : ""}`, value: `${moneyARS(t.saldo_origen_anterior)} → ${moneyARS(t.saldo_origen_posterior)}` },
                { label: `Destino · ${t.medio_destino_nombre}${t.medio_destino_activo === false ? " (inactivo)" : ""}`, value: `${moneyARS(t.saldo_destino_anterior)} → ${moneyARS(t.saldo_destino_posterior)}` },
                t.id_transferencia_revertida && { label: "Revierte a", value: `Transferencia #${t.id_transferencia_revertida}` },
                t.revertido_por && { label: "Revertida por", value: `#${t.revertido_por}${t.fecha_reversion ? ` · ${fmtDateES(t.fecha_reversion)}` : ""}${t.revertido_por_usuario ? ` · ${t.revertido_por_usuario}` : ""}` },
                { label: "Observaciones", value: t.observaciones || "—", wide: true },
              ]} />
            </div>
          </div>
        )}
      </React.Fragment>
    );
  };

  const esTransferRevert = revertTarget?.kind === "transferencia";

  return (<>
    <ModalShell
      open
      titleId="fc-aj-hist-title"
      title="Historial de ajustes de saldo"
      icon={faClockRotateLeft}
      onClose={onClose}
      closeDisabled={reverting}
      size="xl"
      className="fc-md-modal--fixed fc-hx-modal"
      bodyClassName="fc-md-body--table"
      footer={(
        <>
          <div className="fc-md-footer__start fc-md-note" role="status">
            <span>{loading ? "Cargando…" : `${items.length} registro${items.length === 1 ? "" : "s"}`}</span>
            <span title={filtros.idMedioPago ? "Efecto sobre el medio seleccionado" : "Las transferencias internas no cambian el total del negocio"}>
              · Efecto neto <b className={numClase(netoVista)}>{loading || error ? "—" : moneyARSSigned(netoVista)}</b>
            </span>
          </div>
          <button type="button" className="mit-btn mit-btn--ghost" disabled={reverting} onClick={onClose}>Cerrar</button>
        </>
      )}
    >
      <div className="doccom-tabsRow">
        <div className="doccom-googleTabs" role="tablist" aria-label="Tipo de movimiento">
          {VISTAS.map((v) => (
            <button key={v.codigo} type="button" role="tab" id={`fc-hist-tab-${v.codigo}`} aria-selected={vista === v.codigo}
              className={`doccom-googleTab ${vista === v.codigo ? "is-active" : ""}`} onClick={() => cambiarVista(v.codigo)} disabled={reverting}>
              <span className="doccom-googleTab__label">{v.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fc-md-toolbar" aria-label="Filtros del historial">
        <div className="fl-field fc-md-fl">
          <input id="fc-aj-f-desde" type="date" className="fl-input" placeholder=" " value={filtros.fechaDesde}
            onChange={(e) => actualizarFiltro("fechaDesde", e.target.value)} />
          <label className="fl-label" htmlFor="fc-aj-f-desde">Desde</label>
        </div>
        <div className="fl-field fc-md-fl">
          <input id="fc-aj-f-hasta" type="date" className="fl-input" placeholder=" " value={filtros.fechaHasta}
            onChange={(e) => actualizarFiltro("fechaHasta", e.target.value)} />
          <label className="fl-label" htmlFor="fc-aj-f-hasta">Hasta</label>
        </div>
        <div className="fl-field fc-md-fl fc-md-fl--wide">
          <select id="fc-aj-f-medio" className="fl-select" value={filtros.idMedioPago}
            onChange={(e) => actualizarFiltro("idMedioPago", e.target.value)}>
            <option value="">TODOS</option>
            {mediosFiltro.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <label className="fl-label" htmlFor="fc-aj-f-medio">Medio de pago</label>
        </div>
        <div className="fl-field fc-md-fl">
          <select id="fc-aj-f-estado" className="fl-select" value={filtros.estado}
            onChange={(e) => actualizarFiltro("estado", e.target.value)}>
            <option value="">TODOS</option>
            <option value="VIGENTE">VIGENTE</option>
            <option value="REVERTIDO">REVERTIDO</option>
            <option value="REVERSION">REVERSIÓN</option>
          </select>
          <label className="fl-label" htmlFor="fc-aj-f-estado">Estado</label>
        </div>
        {hayFiltros && (
          <div className="fc-md-toolbar__end">
            <button type="button" className="mit-btn mit-btn--ghost fc-md-clear" onClick={limpiarFiltros} disabled={reverting}>
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
      {transferError && !error && (
        <div className="fc-md-alert fc-md-alert--warning" role="status">
          <FontAwesomeIcon icon={faTriangleExclamation} /><span>Transferencias: {transferError}</span>
        </div>
      )}

      <div className="fc-md-table fc-md-table--cards fc-hx-table" role="table" aria-busy={loading} aria-label="Historial de ajustes de saldo">
        <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
          <div className="mov-gridCell--head" role="columnheader">Fecha y hora</div>
          <div className="mov-gridCell--head" role="columnheader">{vista === "AJUSTES" ? "Medio" : "Medio(s)"}</div>
          <div className="mov-gridCell--head is-right" role="columnheader">{vista === "AJUSTES" ? "Ajuste" : "Importe"}</div>
          <div className="mov-gridCell--head is-right" role="columnheader">Saldo anterior</div>
          <div className="mov-gridCell--head is-right" role="columnheader">Saldo posterior</div>
          <div className="mov-gridCell--head" role="columnheader">Motivo</div>
          <div className="mov-gridCell--head" role="columnheader">Estado</div>
          <div className="mov-gridCell--head is-center" role="columnheader">Acciones</div>
        </div>
        <div className="fc-md-tbody" role="rowgroup">
          {loading && <div className="fc-md-empty" role="row"><span role="cell">Cargando historial…</span></div>}
          {!loading && items.map((it) => (it.kind === "ajuste" ? renderAjuste(it.row) : renderTransferencia(it.row)))}
          {!loading && !items.length && !error && (
            <div className="fc-md-empty" role="row">
              <div role="cell" className="fc-md-empty__cell">
                <FontAwesomeIcon icon={faClockRotateLeft} />
                <strong>No hay registros</strong>
                <span>{hayFiltros ? "Ningún movimiento coincide con los filtros elegidos." : "Todavía no hay ajustes ni transferencias."}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalShell>

    {revertTarget && (
      <ModalShell
        open
        role="alertdialog"
        titleId="fc-aj-revert-title"
        title={esTransferRevert ? `Revertir transferencia #${revertTarget.id_transferencia}` : `Revertir ajuste #${revertTarget.id_ajuste}`}
        icon={faRotateLeft}
        onClose={cerrarReversion}
        closeDisabled={reverting}
        size="sm"
        overlayClassName="fc-md-overlay--top"
        className="fc-hx-revert"
        footer={(
          <>
            <button type="button" className="mit-btn mit-btn--ghost" onClick={cerrarReversion} disabled={reverting}>Cancelar</button>
            <button type="button" className="mit-btn mit-btn--solid" onClick={confirmarReversion} disabled={reverting}>
              <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
              {reverting ? "Revirtiendo…" : "Confirmar reversión"}
            </button>
          </>
        )}
      >
        {esTransferRevert ? (
          <>
            <MetaList items={[
              { label: "Devuelve", value: `${revertTarget.medio_destino_nombre} → ${revertTarget.medio_origen_nombre}`, testId: "fc-tr-revert-route" },
            ]} />
            <div className="fc-md-stats">
              <Stat icon={faCoins} highlight label="Transferencia compensatoria" value={moneyARS(revertTarget.importe)} tone="info" testId="fc-tr-revert-importe" />
            </div>
          </>
        ) : (
          <>
            <MetaList items={[{ label: "Medio de pago", value: revertTarget.medio_nombre }]} />
            <div className="fc-md-stats">
              <Stat icon={faCoins} highlight label="Ajuste compensatorio" value={moneyARSSigned(-revertTarget.diferencia)}
                tone={toneOf(-revertTarget.diferencia) === "neg" ? "neg" : "ok"} tag={toneOf(-revertTarget.diferencia) === "neg" ? "Resta" : "Suma"} />
            </div>
          </>
        )}
        <div>
          <div className="fl-field fc-md-fl">
            <textarea id="fc-aj-revert-motivo" className="fl-input" placeholder=" " rows={3} maxLength={500}
              value={revertMotivo} onChange={(e) => { setRevertMotivo(e.target.value.toUpperCase()); setRevertError(""); }}
              disabled={reverting} aria-invalid={Boolean(revertError)} aria-describedby="fc-aj-revert-error" autoFocus />
            <label className="fl-label" htmlFor="fc-aj-revert-motivo">Motivo de la reversión</label>
          </div>
          <div className="fc-hx-fieldBottom">
            <FieldMsg id="fc-aj-revert-error" error={revertError} />
            <span className="fc-md-note">{revertMotivo.length}/500</span>
          </div>
        </div>
        <div className="fc-md-alert fc-md-alert--warning" role="note">
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          <span>{esTransferRevert
            ? "Se registra con fecha de hoy. La caja que devuelve el dinero debe tener saldo suficiente; la transferencia original se conserva."
            : "Se registra con fecha de hoy. El ajuste original se conserva y ambos quedan en el historial."}</span>
        </div>
      </ModalShell>
    )}
  </>);
}
