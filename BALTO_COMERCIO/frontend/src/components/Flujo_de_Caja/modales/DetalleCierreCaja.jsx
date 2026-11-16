// BALTO Comercio · detalle simple de cierre con información contable ampliable.
// El cierre original nunca se altera; las acciones reales las valida la API.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft, faTriangleExclamation, faPrint, faFilePdf, faHandshake,
  faRotateRight, faCircleCheck, faLandmark, faWallet, faChevronDown,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

import { obtenerDetalleCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned } from "../utils/flujoCajaUtils";
import { ESTADOS_CIERRE, ESTADOS_DETALLE, fmtDateTimeES } from "../utils/cierresUtils";
import { descargarPdfCierre, imprimirComprobanteCierre } from "../utils/cierreComprobante";
import ModalConciliarDiferencia from "./ModalConciliarDiferencia.jsx";

const EVENTOS = {
  CIERRE_CONFIRMADO: "Cierre confirmado",
  AJUSTE_PROVISIONAL: "Ajuste provisional de saldo",
  AJUSTE_POSTERIOR: "Ajuste de saldo posterior",
  CONCILIACION: "Diferencia conciliada",
  COMPENSACION: "Compensación del ajuste provisional",
};

const isChanged = (n) => Math.abs(Number(n || 0)) >= 0.005;
const signClass = (n) => Number(n) > 0.004 ? "is-positive" : Number(n) < -0.004 ? "is-negative" : "is-neutral";

export default function DetalleCierreCaja({ idCierre, onBack, onChanged, onBusyChange, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolver, setResolver] = useState(null);
  const [expandir, setExpandir] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setData(await obtenerDetalleCierre(idCierre)); }
    catch (e) { setError(e?.message || "No se pudo cargar el cierre."); }
    finally { setLoading(false); }
  }, [idCierre]);

  useEffect(() => { setData(null); setExpandir(false); cargar(); }, [cargar]);
  useEffect(() => { onBusyChange?.(Boolean(resolver)); }, [resolver, onBusyChange]);

  const despuesDeGuardar = useCallback((json) => {
    if (json?.cierre) setData(json); else cargar();
    onChanged?.();
  }, [cargar, onChanged]);

  const c = data?.cierre;
  const todos = useMemo(() => data?.detalles || [], [data]);
  const conDiferencia = todos.filter((d) => isChanged(d.diferencia));
  const sinDiferencia = todos.filter((d) => !isChanged(d.diferencia));
  const pendientes = conDiferencia.filter((d) => Number(d.importe_pendiente) > 0.004);
  const est = c ? (ESTADOS_CIERRE[c.estado_conciliacion] || { label: c.estado_conciliacion, tone: "muted" }) : null;

  return (
    <div className="fc-cc-detail fc-cc-detail--simple" data-testid="fc-cc-detalle">
      <div className="fc-cc-detail__bar">
        <button type="button" className="mit-btn mit-btn--ghost" onClick={onBack}><FontAwesomeIcon icon={faArrowLeft} /> Volver al historial</button>
        <div className="fc-cc-detail__actions">
          <button type="button" className="mit-btn mit-btn--ghost" onClick={cargar} disabled={loading} title="Actualizar datos" aria-label="Actualizar datos"><FontAwesomeIcon icon={faRotateRight} /></button>
          <button type="button" className="mit-btn mit-btn--ghost" onClick={() => data && imprimirComprobanteCierre(data)} disabled={!data} data-testid="fc-cc-imprimir"><FontAwesomeIcon icon={faPrint} /> Imprimir</button>
          <button type="button" className="mit-btn mit-btn--ghost" onClick={() => data && descargarPdfCierre(data)} disabled={!data} data-testid="fc-cc-pdf"><FontAwesomeIcon icon={faFilePdf} /> PDF</button>
        </div>
      </div>

      {error && <div className="fc-aj-alert fc-aj-alert--error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span></div>}
      {loading && !data && <div className="fc-cc-empty">Cargando cierre…</div>}

      {c && <>
        <div className="fc-cc-detail-hero">
          <div className="fc-cc-detail-hero__left">
            <span className="fc-cc-eyebrow">Cierre <strong data-testid="fc-cc-numero">{c.numero}</strong>{c.es_historico ? " · Histórico" : ""}</span>
            <h3>Resumen del {fmtDateES(c.fecha_operativa)}</h3>
            <p>Realizado por {c.usuario_nombre || "—"} · {fmtDateTimeES(c.created_at)}</p>
          </div>
          <span className={`fc-cc-badge fc-cc-badge--${est.tone}`} data-testid="fc-cc-estado-cierre">{est.label}</span>
        </div>

        <div className="fc-cc-overview" aria-label="Resumen del cierre">
          <div><span>Cajas revisadas</span><strong>{todos.length}</strong></div>
          <div><span>Sin diferencias</span><strong className="is-positive">{sinDiferencia.length}</strong></div>
          <div><span>Por resolver</span><strong className={pendientes.length ? "fc-cc-warnText" : "is-positive"}>{pendientes.length}</strong></div>
          {pendientes.length > 0 && <div className="fc-cc-overview__pending"><span>Importe pendiente</span><strong>{moneyARS(c.importe_pendiente)}</strong></div>}
        </div>

        {(data.avisos || []).map((a) => <div key={a} className="fc-aj-alert fc-aj-alert--warning" role="status" data-testid="fc-cc-aviso"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{a}</span></div>)}

        <section className="fc-cc-result-section" aria-labelledby="fc-cc-result-title">
          <h4 id="fc-cc-result-title">Cajas controladas</h4>
          {sinDiferencia.length > 0 && (
            <div className="fc-cc-matched-list">
              {sinDiferencia.map((d) => <div className="fc-cc-matched" key={d.id_cierre_detalle} data-testid={`fc-cc-detalle-${d.id_medio_pago}`}>
                <div className="fc-cc-matched__name"><FontAwesomeIcon icon={faCircleCheck} /><span>{d.medio_nombre}</span></div>
                <span>Coincide · {moneyARS(d.saldo_verificado)}</span>
              </div>)}
            </div>
          )}
          {conDiferencia.map((d) => {
            const e = ESTADOS_DETALLE[d.estado_conciliacion] || { label: d.estado_conciliacion, tone: "muted" };
            const sob = Number(d.diferencia) > 0;
            const pendiente = Number(d.importe_pendiente) > 0.004;
            return (
              <article key={d.id_cierre_detalle} className={`fc-cc-issue fc-cc-issue--${e.tone}`} data-detalle-id={d.id_cierre_detalle} data-testid={`fc-cc-detalle-${d.id_medio_pago}`}>
                <header className="fc-cc-issue__header">
                  <div className="fc-cc-issue__name"><FontAwesomeIcon icon={d.clase_medio === "EFECTIVO" ? faWallet : faLandmark} /><div><strong>{d.medio_nombre}</strong><small>{d.clase_medio === "EFECTIVO" ? "Efectivo" : "Banco / billetera"}</small></div></div>
                  <span className={`fc-cc-badge fc-cc-badge--${e.tone}`}>{e.label}</span>
                </header>
                <div className="fc-cc-issue__amounts">
                  <div><span>Según BALTO</span><strong>{moneyARS(d.saldo_esperado)}</strong></div>
                  <div><span>Dinero verificado</span><strong>{moneyARS(d.saldo_verificado)}</strong></div>
                </div>
                <div className="fc-cc-issue__difference">
                  <div><span>{sob ? "Sobrante" : "Faltante"} original</span><strong className={signClass(d.diferencia)} data-testid="fc-cc-dif-original">{moneyARSSigned(d.diferencia)}</strong></div>
                  <div><span>{pendiente ? "Queda por resolver" : "Ya conciliado"}</span><strong data-testid="fc-cc-pendiente">{moneyARS(d.importe_pendiente)}</strong></div>
                </div>
                {d.id_ajuste_saldo && <p className="fc-cc-issue__note"><FontAwesomeIcon icon={faCircleCheck} /> Se registró un ajuste de saldo. La diferencia se resuelve por separado.</p>}
                {d.observaciones && <p className="fc-cc-issue__note">Observación del cierre: {d.observaciones}</p>}
                {d.saldo_historico_cambio && <p className="fc-cc-issue__note">El saldo histórico fue recalculado: {moneyARS(d.saldo_historico_recalculado)} ({moneyARSSigned(d.saldo_historico_variacion)}). El cierre original se conserva.</p>}
                {pendiente && (d.puede_conciliar || d.puede_aplicar_ajuste) && <div className="fc-cc-issue__actions">
                  <button type="button" className="mit-btn mit-btn--solid" onClick={() => setResolver(d)} data-testid={`fc-cc-conciliar-${d.id_medio_pago}`}><FontAwesomeIcon icon={faHandshake} /> Resolver diferencia</button>
                </div>}
                {d.conciliaciones?.length > 0 && <details className="fc-cc-issue__history">
                  <summary><FontAwesomeIcon icon={faClockRotateLeft} /> Ver conciliaciones realizadas ({d.conciliaciones.length})</summary>
                  <ul className="fc-cc-concs">
                    {d.conciliaciones.map((k) => <li key={k.id_conciliacion}>
                      <div><b>{moneyARS(k.importe)}</b> · {k.tipo_label}</div>
                      <small>{fmtDateTimeES(k.created_at)} · {k.usuario_nombre || "—"}{k.compensacion ? ` · Compensación ${moneyARSSigned(k.compensacion)} (#${k.id_ajuste_compensacion})` : " · Sin compensación"}{k.movimientos?.length ? ` · ${k.movimientos.map((m) => `${m.tipo_operacion || "Operación"} #${m.id_movimiento} ${moneyARS(m.monto)}${m.estado_vinculo && m.estado_vinculo !== "VIGENTE" ? ` (${m.estado_vinculo})` : ""}`).join(", ")}` : ""}</small>
                      {k.observaciones && <small>{k.observaciones}</small>}
                    </li>)}
                  </ul>
                </details>}
              </article>
            );
          })}
          {!conDiferencia.length && <p className="fc-cc-issue__note"><FontAwesomeIcon icon={faCircleCheck} /> Todas las cajas coincidieron. No hay diferencias que resolver.</p>}
        </section>

        <section className="fc-cc-extra">
          <button type="button" className="fc-cc-extra__toggle" aria-expanded={expandir} onClick={() => setExpandir((v) => !v)}>
            <span>Ver información completa y trazabilidad</span><FontAwesomeIcon icon={faChevronDown} className={expandir ? "is-open" : ""} />
          </button>
          {expandir && <div className="fc-cc-extra__content">
            <dl className="fc-cc-sumGrid">
              <div><dt>Total esperado</dt><dd>{moneyARS(c.total_esperado)}</dd></div>
              <div><dt>Total verificado</dt><dd>{moneyARS(c.total_verificado)}</dd></div>
              <div><dt>Sobrantes</dt><dd className="is-positive">{moneyARS(c.total_sobrantes)}</dd></div>
              <div><dt>Faltantes</dt><dd className="is-negative">{moneyARS(c.total_faltantes)}</dd></div>
              <div><dt>Diferencia neta</dt><dd>{moneyARSSigned(c.diferencia_neta)}</dd></div>
            </dl>
            {c.observaciones && <p className="fc-cc-obsView"><b>Observaciones:</b> {c.observaciones}</p>}
            <h5 className="fc-aj-panelTitle">Ajustes de saldos</h5>
            <ul className="fc-cc-list">
              {todos.filter((d) => d.id_ajuste_saldo).map((d) => <li key={d.id_cierre_detalle}><span>{d.medio_nombre} · Ajuste #{d.id_ajuste_saldo}{d.ajuste_aplicado_en === "POSTERIOR" ? " (posterior)" : ""}</span><b>{moneyARSSigned(d.ajuste_provisional)}</b></li>)}
              {!todos.some((d) => d.id_ajuste_saldo) && <li>No se aplicaron ajustes de saldo.</li>}
            </ul>
            <h5 className="fc-aj-panelTitle fc-cc-timelineTitle">Registro de actividad</h5>
            <ol className="fc-cc-timeline" data-testid="fc-cc-eventos">
              {(data.eventos || []).map((ev) => {
                const det = todos.find((d) => d.id_cierre_detalle === ev.id_cierre_detalle);
                return <li key={ev.id_evento}><span className="fc-cc-timeline__date">{fmtDateTimeES(ev.created_at)}</span><span><b>{EVENTOS[ev.evento] || ev.evento}</b>{det ? ` · ${det.medio_nombre}` : ""}{ev.importe ? ` · ${moneyARSSigned(ev.importe)}` : ""}{ev.fecha_efectiva && ev.evento !== "CIERRE_CONFIRMADO" ? ` · efecto ${fmtDateES(ev.fecha_efectiva)}` : ""}{ev.usuario_nombre ? ` · ${ev.usuario_nombre}` : ""}</span></li>;
              })}
            </ol>
          </div>}
        </section>
      </>}

      <ModalConciliarDiferencia
        open={Boolean(resolver)}
        detalle={resolver}
        cierre={c}
        onClose={() => setResolver(null)}
        onSaved={(json) => { setResolver(null); despuesDeGuardar(json); }}
        showToast={showToast}
      />
    </div>
  );
}
