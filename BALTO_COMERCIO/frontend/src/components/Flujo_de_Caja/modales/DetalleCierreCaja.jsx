// BALTO Comercio · detalle de un cierre de caja.
// Orden de lectura: número, fecha y estado → importes → diferencias que
// requieren atención (con su acción) → cajas que coinciden (plegable) →
// trazabilidad (plegable). El cierre original nunca se altera; las acciones
// reales las valida la API.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTriangleExclamation, faPrint, faFilePdf, faHandshake,  faCircleCheck,
  faChevronDown, faScaleBalanced, faWallet, faCashRegister, faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";

import { obtenerDetalleCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned } from "../utils/flujoCajaUtils";
import { ESTADOS_CIERRE, ESTADOS_DETALLE, fmtDateTimeES } from "../utils/cierresUtils";
import { descargarPdfCierre, imprimirComprobanteCierre } from "../utils/cierreComprobante";
import ModalConciliarDiferencia from "./ModalConciliarDiferencia.jsx";
import { Badge, MetaList, Stat, etiquetaDiferencia, toneOf } from "./FcModalParts.jsx";

const EVENTOS = {
  CIERRE_CONFIRMADO: "Cierre confirmado",
  AJUSTE_PROVISIONAL: "Ajuste provisional de saldo",
  AJUSTE_POSTERIOR: "Ajuste de saldo posterior",
  CONCILIACION: "Diferencia conciliada",
  COMPENSACION: "Compensación del ajuste provisional",
};

const cents = (n) => Math.round(Number(n || 0) * 100);
const isChanged = (n) => cents(n) !== 0;
const claseLabel = (d) => (d.clase_medio === "EFECTIVO" ? "Efectivo" : "Banco / billetera");
const numClaseDif = (n) => (toneOf(n) === "pos" ? "fc-md-num--sobrante" : toneOf(n) === "neg" ? "fc-md-num--faltante" : "fc-md-num--zero");

export default function DetalleCierreCaja({ idCierre, onChanged, onBusyChange, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resolver, setResolver] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setData(await obtenerDetalleCierre(idCierre)); }
    catch (e) { setError(e?.message || "No se pudo cargar el cierre."); }
    finally { setLoading(false); }
  }, [idCierre]);

  useEffect(() => { setData(null); cargar(); }, [cargar]);
  useEffect(() => { onBusyChange?.(Boolean(resolver)); }, [resolver, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // La resolución informa el resultado sin cerrarse: el detalle se actualiza
  // detrás y el modal de resolución muestra su paso de resultado.
  const actualizarDesde = useCallback((json) => {
    if (json?.cierre) setData(json); else cargar();
    onChanged?.();
  }, [cargar, onChanged]);

  const c = data?.cierre;
  const todos = useMemo(() => data?.detalles || [], [data]);
  const conDiferencia = useMemo(() => todos
    .filter((d) => isChanged(d.diferencia))
    .sort((a, b) => Number(b.importe_pendiente || 0) - Number(a.importe_pendiente || 0)), [todos]);
  const sinDiferencia = useMemo(() => todos.filter((d) => !isChanged(d.diferencia)), [todos]);
  const pendientes = conDiferencia.filter((d) => Number(d.importe_pendiente) > 0.004);
  const est = c ? (ESTADOS_CIERRE[c.estado_conciliacion] || { label: c.estado_conciliacion, tone: "muted" }) : null;
  const importePendiente = c ? Number(c.importe_pendiente ?? pendientes.reduce((s, d) => s + Number(d.importe_pendiente || 0), 0)) : 0;

  return (
    <div className="fc-md-panel" data-testid="fc-cc-detalle">
      {error && (
        <div className="fc-md-alert fc-md-alert--error" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span>
          <button type="button" className="fc-md-link" onClick={cargar}>Reintentar</button>
        </div>
      )}
      {loading && !data && <div className="fc-md-empty"><span>Cargando cierre…</span></div>}

      {c && <>
        <header className="fc-md-record">
          <div className="fc-md-record__main">
            <div className="fc-md-record__title">
              <strong data-testid="fc-cc-numero">{c.numero}</strong>
              <span className="fc-md-record__date">{fmtDateES(c.fecha_operativa)}</span>
              <Badge tone={est.tone} testId="fc-cc-estado-cierre">{est.label}</Badge>
            </div>
            <MetaList items={[
              { label: "Responsable", value: c.usuario_nombre || "—" },
              { label: "Registrado", value: fmtDateTimeES(c.created_at) },
              c.es_historico && { label: "Tipo", value: "Cierre histórico" },
            ]} />
          </div>
          <div className="fc-md-record__actions">
            <button type="button" className="mit-btn mit-btn--ghost" onClick={() => imprimirComprobanteCierre(data)} data-testid="fc-cc-imprimir"><FontAwesomeIcon icon={faPrint} /> Imprimir</button>
            <button type="button" className="mit-btn mit-btn--ghost" onClick={() => descargarPdfCierre(data)} data-testid="fc-cc-pdf"><FontAwesomeIcon icon={faFilePdf} /> PDF</button>
          </div>
        </header>

        <div className="fc-md-stats fc-md-stats--4" aria-label="Importes del cierre">
          <Stat icon={faCashRegister} label="Total esperado" value={moneyARS(c.total_esperado)} />
          <Stat icon={faWallet} label="Total verificado" value={moneyARS(c.total_verificado)} />
          <Stat icon={faScaleBalanced} label="Diferencia neta" value={moneyARSSigned(c.diferencia_neta)}
            tone={toneOf(c.diferencia_neta) === "pos" ? "info" : toneOf(c.diferencia_neta) === "neg" ? "neg" : conDiferencia.length ? "warn" : "ok"}
            tag={toneOf(c.diferencia_neta) !== "zero" ? etiquetaDiferencia(c.diferencia_neta) : conDiferencia.length ? "Se compensan entre cajas" : "Sin diferencia"} />
          <Stat icon={pendientes.length ? faHourglassHalf : faCircleCheck} label="Pendiente de resolver" value={moneyARS(importePendiente)}
            tone={pendientes.length ? "warn" : "ok"} highlight
            tag={pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? "diferencia" : "diferencias"}` : "Todo resuelto"} />
        </div>

        {(data.avisos || []).map((a) => (
          <div key={a} className="fc-md-alert fc-md-alert--warning" role="status" data-testid="fc-cc-aviso">
            <FontAwesomeIcon icon={faTriangleExclamation} /><span>{a}</span>
          </div>
        ))}

        <section className="fc-md-section" aria-labelledby="fc-cc-dif-title">
          <h5 id="fc-cc-dif-title" className="fc-md-section__title">
            Diferencias <span className={`fc-md-count ${pendientes.length ? "fc-md-count--warn" : ""}`}>{conDiferencia.length}</span>
          </h5>
          {conDiferencia.length ? (
            <div className="fc-md-table fc-md-table--static fc-md-table--cards fc-cc-issues" role="table" aria-label="Cajas con diferencias">
              <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
                <div className="mov-gridCell--head" role="columnheader">Caja</div>
                <div className="mov-gridCell--head is-right" role="columnheader">Esperado</div>
                <div className="mov-gridCell--head is-right" role="columnheader">Verificado</div>
                <div className="mov-gridCell--head is-right" role="columnheader">Diferencia</div>
                <div className="mov-gridCell--head is-right" role="columnheader">Pendiente</div>
                <div className="mov-gridCell--head" role="columnheader">Estado</div>
                <div className="mov-gridCell--head is-center" role="columnheader">Acción</div>
              </div>
              <div className="fc-md-tbody" role="rowgroup">
                {conDiferencia.map((d) => {
                  const e = ESTADOS_DETALLE[d.estado_conciliacion] || { label: d.estado_conciliacion, tone: "muted" };
                  const pendiente = Number(d.importe_pendiente) > 0.004;
                  const puedeResolver = pendiente && (d.puede_conciliar || d.puede_aplicar_ajuste);
                  const notas = d.id_ajuste_saldo || d.observaciones || d.saldo_historico_cambio || d.conciliaciones?.length;
                  return (
                    <div key={d.id_cierre_detalle} className={`fc-cc-issueWrap ${pendiente ? "is-pending" : ""}`}
                      data-detalle-id={d.id_cierre_detalle} data-testid={`fc-cc-detalle-${d.id_medio_pago}`}>
                      <div className="mov-gridTable fc-md-row fc-md-tr" role="row">
                        <div className="mov-gridCell fc-md-cell--stack fc-md-cell--full" role="cell" data-label="Caja">
                          <b className="fc-md-ellipsis">{d.medio_nombre}</b><small>{claseLabel(d)}</small>
                        </div>
                        <div className="mov-gridCell is-right" role="cell" data-label="Esperado"><span className="fc-md-num">{moneyARS(d.saldo_esperado)}</span></div>
                        <div className="mov-gridCell is-right" role="cell" data-label="Verificado"><span className="fc-md-num">{moneyARS(d.saldo_verificado)}</span></div>
                        <div className="mov-gridCell fc-md-cell--stack is-right" role="cell" data-label="Diferencia">
                          <span className={`fc-md-num ${numClaseDif(d.diferencia)}`} data-testid="fc-cc-dif-original">{moneyARSSigned(d.diferencia)}</span>
                          <small>{etiquetaDiferencia(d.diferencia)}</small>
                        </div>
                        <div className="mov-gridCell is-right" role="cell" data-label="Pendiente">
                          <span className={`fc-md-num fc-md-num--strong ${pendiente ? "fc-md-num--warn" : "fc-md-num--zero"}`} data-testid="fc-cc-pendiente">{moneyARS(d.importe_pendiente)}</span>
                        </div>
                        <div className="mov-gridCell" role="cell" data-label="Estado"><Badge tone={e.tone}>{e.label}</Badge></div>
                        <div className="mov-gridCell is-center fc-md-cell--actions fc-cc-issueAction" role="cell">
                          {puedeResolver ? (
                            <button type="button" className="mit-btn mit-btn--ghost fc-cc-resolveBtn" onClick={() => setResolver(d)}
                              data-testid={`fc-cc-conciliar-${d.id_medio_pago}`} aria-label="Resolver diferencia"
                              title={`Resolver la diferencia de ${d.medio_nombre}`}>
                              <FontAwesomeIcon icon={faHandshake} /> Resolver diferencia
                            </button>
                          ) : <FontAwesomeIcon icon={faCircleCheck} className="fc-md-num--pos" aria-label="Resuelta" />}
                        </div>
                      </div>
                      {notas ? (
                        <div className="fc-cc-issueNotes">
                          {d.id_ajuste_saldo && (
                            <p className="fc-md-note"><FontAwesomeIcon icon={faCircleCheck} /> Se registró un ajuste de saldo (#{d.id_ajuste_saldo}{d.ajuste_aplicado_en === "POSTERIOR" ? ", posterior" : ""}). La diferencia se concilia por separado.</p>
                          )}
                          {d.observaciones && <p className="fc-md-note">Observación: {d.observaciones}</p>}
                          {d.saldo_historico_cambio && (
                            <p className="fc-md-note fc-md-note--warn"><FontAwesomeIcon icon={faTriangleExclamation} /> Saldo histórico recalculado: {moneyARS(d.saldo_historico_recalculado)} ({moneyARSSigned(d.saldo_historico_variacion)}). El cierre original se conserva.</p>
                          )}
                          {d.conciliaciones?.length > 0 && (
                            <details className="fc-cc-concs">
                              <summary>Conciliaciones realizadas ({d.conciliaciones.length})</summary>
                              <ul>
                                {d.conciliaciones.map((k) => (
                                  <li key={k.id_conciliacion}>
                                    <span><b className="fc-md-num">{moneyARS(k.importe)}</b> · {k.tipo_label}</span>
                                    <small>
                                      {fmtDateTimeES(k.created_at)} · {k.usuario_nombre || "—"}
                                      {k.compensacion ? ` · Compensación ${moneyARSSigned(k.compensacion)} (#${k.id_ajuste_compensacion})` : ""}
                                      {k.movimientos?.length ? ` · ${k.movimientos.map((m) => `${m.tipo_operacion || "Operación"} #${m.id_movimiento} ${moneyARS(m.monto)}${m.estado_vinculo && m.estado_vinculo !== "VIGENTE" ? ` (${m.estado_vinculo})` : ""}`).join(", ")}` : ""}
                                    </small>
                                    {k.observaciones && <small>{k.observaciones}</small>}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="fc-md-note"><FontAwesomeIcon icon={faCircleCheck} className="fc-md-num--pos" /> Todas las cajas coincidieron.</p>
          )}
        </section>

        {sinDiferencia.length > 0 && (
          <details className="fc-md-collapse" data-testid="fc-cc-coinciden">
            <summary>
              <FontAwesomeIcon icon={faCircleCheck} className="fc-md-collapse__ok" />
              Cajas que coinciden <span className="fc-md-count">{sinDiferencia.length}</span>
              <FontAwesomeIcon icon={faChevronDown} className="fc-md-collapse__chev" />
            </summary>
            <div className="fc-md-collapse__content fc-md-collapse__content--flush">
              <div className="fc-md-table fc-md-table--static fc-md-table--cards fc-cc-matched" role="table" aria-label="Cajas que coinciden">
                <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
                  <div className="mov-gridCell--head" role="columnheader">Caja</div>
                  <div className="mov-gridCell--head is-right" role="columnheader">Esperado</div>
                  <div className="mov-gridCell--head is-right" role="columnheader">Verificado</div>
                  <div className="mov-gridCell--head" role="columnheader">Estado</div>
                </div>
                <div className="fc-md-tbody" role="rowgroup">
                  {sinDiferencia.map((d) => (
                    <div key={d.id_cierre_detalle} className="mov-gridTable fc-md-row fc-md-tr" role="row" data-testid={`fc-cc-detalle-${d.id_medio_pago}`}>
                      <div className="mov-gridCell fc-md-cell--stack fc-md-cell--full" role="cell" data-label="Caja"><b className="fc-md-ellipsis">{d.medio_nombre}</b><small>{claseLabel(d)}</small></div>
                      <div className="mov-gridCell is-right" role="cell" data-label="Esperado"><span className="fc-md-num">{moneyARS(d.saldo_esperado)}</span></div>
                      <div className="mov-gridCell is-right" role="cell" data-label="Verificado"><span className="fc-md-num">{moneyARS(d.saldo_verificado)}</span></div>
                      <div className="mov-gridCell" role="cell" data-label="Estado"><Badge tone="ok">Coincide</Badge></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        )}

        <details className="fc-md-collapse">
          <summary>
            Ver información completa y trazabilidad
            <FontAwesomeIcon icon={faChevronDown} className="fc-md-collapse__chev" />
          </summary>
          <div className="fc-md-collapse__content">
            <MetaList items={[
              { label: "Sobrantes", value: <span className="fc-md-num fc-md-num--sobrante">{moneyARS(c.total_sobrantes)}</span> },
              { label: "Faltantes", value: <span className="fc-md-num fc-md-num--faltante">{moneyARS(c.total_faltantes)}</span> },
              { label: "Cajas revisadas", value: todos.length },
              c.observaciones && { label: "Observaciones", value: c.observaciones, wide: true },
            ]} />
            <section className="fc-md-section">
              <h5 className="fc-md-section__title">Ajustes de saldo</h5>
              {todos.some((d) => d.id_ajuste_saldo) ? (
                <ul className="fc-md-lines">
                  {todos.filter((d) => d.id_ajuste_saldo).map((d) => (
                    <li key={d.id_cierre_detalle}>
                      <span className="fc-md-lines__name">{d.medio_nombre}</span>
                      <small className="fc-md-note">#{d.id_ajuste_saldo}{d.ajuste_aplicado_en === "POSTERIOR" ? " · posterior" : ""}</small>
                      <span className="fc-md-lines__end"><b className={`fc-md-num ${numClaseDif(d.ajuste_provisional)}`}>{moneyARSSigned(d.ajuste_provisional)}</b></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="fc-md-note">No se aplicaron ajustes de saldo.</p>}
            </section>
            <section className="fc-md-section">
              <h5 className="fc-md-section__title">Registro de actividad</h5>
              <ol className="fc-md-timeline" data-testid="fc-cc-eventos">
                {(data.eventos || []).map((ev) => {
                  const det = todos.find((d) => d.id_cierre_detalle === ev.id_cierre_detalle);
                  return (
                    <li key={ev.id_evento}>
                      <time>{fmtDateTimeES(ev.created_at)}</time>
                      <span>
                        <b>{EVENTOS[ev.evento] || ev.evento}</b>
                        {det ? ` · ${det.medio_nombre}` : ""}
                        {ev.importe ? ` · ${moneyARSSigned(ev.importe)}` : ""}
                        {ev.fecha_efectiva && ev.evento !== "CIERRE_CONFIRMADO" ? ` · efecto ${fmtDateES(ev.fecha_efectiva)}` : ""}
                        {ev.usuario_nombre ? ` · ${ev.usuario_nombre}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </details>
      </>}

      <ModalConciliarDiferencia
        open={Boolean(resolver)}
        detalle={resolver}
        cierre={c}
        onClose={() => setResolver(null)}
        onSaved={actualizarDesde}
        showToast={showToast}
      />
    </div>
  );
}
