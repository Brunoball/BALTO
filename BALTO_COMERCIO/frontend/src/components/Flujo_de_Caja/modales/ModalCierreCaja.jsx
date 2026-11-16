// src/components/Flujo_de_Caja/modales/ModalCierreCaja.jsx
// Cierre de caja (arqueo) por medio de pago monetario real.
// Flujo: formulario (fecha, cajas, importes verificados) → resumen final →
// confirmación. El backend recalcula saldos esperados y diferencias, rechaza
// datos desactualizados (409) y guarda el cierre con sus ajustes de efectivo
// en una sola transacción. El modal se cierra sólo cuando el backend confirma.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faCashRegister,
  faTriangleExclamation,
  faArrowLeft,
  faCircleCheck,
  faClockRotateLeft,
  faPrint,
  faRotateRight,
} from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Modals.css";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./ajustes_saldo.css";
import "./cierres_caja.css";

import { CierreApiError, confirmarCierre, nuevaClaveCierre, previsualizarCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";
import { diferenciaCents, ESTADOS_CIERRE, fromCents, numeroCierre, tipoDiferencia, totalesCierre } from "../utils/cierresUtils";
import { imprimirComprobanteCierre } from "../utils/cierreComprobante";

function signClass(n) {
  if (n > 0.004) return "is-positive";
  if (n < -0.004) return "is-negative";
  return "is-neutral";
}

/** Acepta "-1.234,50" sólo para cuentas (banco/billetera en descubierto). */
function parseVerificado(texto, permiteNegativo) {
  const s = String(texto ?? "").trim();
  if (s === "") return { value: null, error: "" };
  const neg = s.startsWith("-");
  if (neg && !permiteNegativo) return { value: null, error: "El efectivo no puede ser negativo." };
  const n = parseMoneyInput(neg ? s.slice(1) : s);
  if (n == null) return { value: null, error: "Importe inválido (hasta 2 decimales)." };
  return { value: neg ? -n : n, error: "" };
}

const ESTADO_FILA = {
  SOBRANTE: { label: "Sobrante", tone: "positive" },
  FALTANTE: { label: "Faltante", tone: "negative" },
  SIN_DIFERENCIA: { label: "Coincide", tone: "ok" },
};

export default function ModalCierreCaja({ open, onClose, onSaved, onOpenCierre, showToast }) {
  const [fecha, setFecha] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [data, setData] = useState(null);
  const [inputs, setInputs] = useState({});
  const [obsGeneral, setObsGeneral] = useState("");
  const [step, setStep] = useState("form");
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [intentado, setIntentado] = useState(false);
  const claveRef = useRef("");
  const submittingRef = useRef(false);

  const cargar = useCallback(async (fechaOperativa, { conservar = true } = {}) => {
    setLoading(true);
    setLoadError("");
    try {
      const json = await previsualizarCierre({ fechaOperativa });
      setData(json);
      setFecha(json.fecha_operativa);
      setInputs((prev) => {
        const next = {};
        (json.medios || []).forEach((m) => {
          const p = conservar ? prev[m.id_medio_pago] : null;
          next[m.id_medio_pago] = {
            texto: p?.texto ?? "",
            aplicar: p?.aplicar ?? Boolean(m.admite_ajuste_al_confirmar),
            obs: p?.obs ?? "",
          };
        });
        return next;
      });
    } catch (e) {
      setData(null);
      setLoadError(e?.message || "No se pudo cargar el cierre.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setNotice(null);
    setResultado(null);
    setObsGeneral("");
    setIntentado(false);
    setInputs({});
    claveRef.current = "";
    cargar("", { conservar: false });
  }, [open, cargar]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  const medios = useMemo(() => data?.medios || [], [data]);
  const historico = Boolean(data?.es_historico);

  const filas = useMemo(() => medios.map((m) => {
    const inp = inputs[m.id_medio_pago] || { texto: "", aplicar: false, obs: "" };
    const parsed = parseVerificado(inp.texto, m.clase_medio !== "EFECTIVO");
    const dCents = diferenciaCents(m.saldo_esperado, parsed.value);
    const tipo = tipoDiferencia(m.saldo_esperado, parsed.value);
    const puedeAjustar = Boolean(m.admite_ajuste_al_confirmar) && dCents != null && dCents !== 0;
    return {
      ...m,
      texto: inp.texto,
      obs: inp.obs,
      verificado: parsed.value,
      error: parsed.error,
      diferencia: dCents == null ? null : fromCents(dCents),
      tipo,
      puedeAjustar,
      aplicar: puedeAjustar && inp.aplicar,
    };
  }), [medios, inputs]);

  const tot = useMemo(() => totalesCierre(filas), [filas]);
  const hayErrores = filas.some((f) => f.error);
  const verificados = filas.length - tot.sinVerificar;
  const sinVerificar = filas.filter((f) => f.verificado == null && !f.error);
  const ajustes = filas.filter((f) => f.aplicar);
  const pendientes = filas.filter((f) => f.diferencia != null && f.diferencia !== 0);

  const setInput = (id, patch) => setInputs((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const irAResumen = () => {
    setIntentado(true);
    setNotice(null);
    if (!data?.puede_cerrar) return;
    if (hayErrores) { setNotice({ tipo: "error", texto: "Corregí los importes marcados." }); return; }
    if (sinVerificar.length) {
      setNotice({ tipo: "error", texto: `Faltan verificar: ${sinVerificar.map((f) => f.nombre).join(", ")}. Ingresá 0 si no hay dinero.` });
      return;
    }
    claveRef.current = nuevaClaveCierre("cie");
    setStep("confirm");
  };

  const confirmar = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const json = await confirmarCierre({
        fecha_operativa: data.fecha_operativa,
        clave_solicitud: claveRef.current,
        observaciones: obsGeneral.trim() || null,
        medios: filas.map((f) => ({
          id_medio_pago: f.id_medio_pago,
          saldo_esperado: toApiAmount(f.saldo_esperado),
          saldo_verificado: toApiAmount(f.verificado),
          aplicar_ajuste: Boolean(f.aplicar),
          observaciones: f.obs.trim() || null,
        })),
      });
      setResultado(json);
      setStep("done");
      showToast?.("exito", json.mensaje || "Cierre de caja confirmado.", 3200);
      onSaved?.(json);
    } catch (e) {
      const codigo = e instanceof CierreApiError ? e.codigo : "";
      if (codigo === "SALDOS_DESACTUALIZADOS") {
        const lista = (e.payload?.medios || []).map((m) => `${m.nombre}: ${moneyARS(m.saldo_mostrado)} → ${moneyARS(m.saldo_actual)}`).join(" · ");
        setNotice({ tipo: "warning", texto: `${e.message}${lista ? ` (${lista})` : ""}` });
        setStep("form");
        await cargar(data.fecha_operativa, { conservar: true });
      } else if (codigo === "CIERRE_DUPLICADO") {
        setNotice({ tipo: "warning", texto: e.message, idCierre: e.payload?.id_cierre });
        setStep("form");
        await cargar(data.fecha_operativa, { conservar: true });
      } else {
        setNotice({ tipo: "error", texto: e?.message || "No se pudo confirmar el cierre." });
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const cierreExistente = data?.cierre_existente;
  const busy = loading || submitting;
  const titulo = step === "done" ? "Cierre confirmado" : step === "confirm" ? "Confirmar cierre de caja" : "Cerrar caja";

  return createPortal(
    <div className="mi-mini__overlay fc-aj-overlay" role="presentation">
      <div className="mi-mini__modal fc-aj-modal fc-aj-modal--wide fc-cc-modal" role="dialog" aria-modal="true" aria-labelledby="fc-cc-title"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi-mini__head">
          <h4 id="fc-cc-title" className="mi-mini__title fc-aj-title">
            <FontAwesomeIcon icon={faCashRegister} />
            <span>{titulo}</span>
          </h4>
          <button type="button" className="mi-mini__close" onClick={() => !submitting && onClose?.()} disabled={submitting} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-mini__body fc-aj-body fc-cc-body">
          {loadError && (
            <div className="fc-aj-alert fc-aj-alert--error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{loadError}</span>
              <button type="button" className="fc-aj-link" onClick={() => cargar(fecha)}>Reintentar</button>
            </div>
          )}
          {notice && (
            <div className={`fc-aj-alert fc-aj-alert--${notice.tipo === "error" ? "error" : "warning"}`} role={notice.tipo === "error" ? "alert" : "status"} data-testid="fc-cc-notice">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{notice.texto}</span>
              {notice.idCierre && onOpenCierre && (
                <button type="button" className="fc-aj-link" onClick={() => onOpenCierre(notice.idCierre)}>Ver cierre</button>
              )}
            </div>
          )}

          {step === "form" && (
            <div className="fc-cc-form">
              <div className="fc-cc-meta">
                <div className="fl-field fc-cc-meta__fecha">
                  <input
                    id="fc-cc-fecha"
                    type="date"
                    className="fl-input"
                    value={fecha}
                    max={data?.fecha_negocio || undefined}
                    onChange={(e) => { const v = e.target.value; setFecha(v); if (v) cargar(v, { conservar: false }); }}
                    disabled={busy}
                  />
                  <label className="fl-label fc-aj-floatLabel" htmlFor="fc-cc-fecha">Fecha operativa</label>
                </div>
                <div className="fc-cc-meta__item">
                  <span>Fecha y hora de realización</span>
                  <b data-testid="fc-cc-ahora">{data?.ahora ? `${fmtDateES(data.ahora.slice(0, 10))} ${data.ahora.slice(11, 16)}` : "—"}</b>
                </div>
                <div className="fc-cc-meta__item">
                  <span>Responsable</span>
                  <b data-testid="fc-cc-responsable">{data?.responsable || "—"}</b>
                </div>
              </div>

              {(data?.avisos || []).map((a) => (
                <div key={a} className="fc-aj-alert fc-aj-alert--warning" role="status">
                  <FontAwesomeIcon icon={faTriangleExclamation} /><span>{a}</span>
                </div>
              ))}

              {cierreExistente && (
                <div className="fc-aj-alert fc-aj-alert--warning" role="status" data-testid="fc-cc-existente">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>
                    Ya existe el cierre {cierreExistente.numero} del {fmtDateES(cierreExistente.fecha_operativa)} (realizado por {cierreExistente.usuario_nombre || "—"}). No se reemplaza: consultalo en el historial.
                  </span>
                  {onOpenCierre && (
                    <button type="button" className="fc-aj-link" onClick={() => onOpenCierre(cierreExistente.id_cierre)}>Ver cierre</button>
                  )}
                </div>
              )}

              <div className="fc-cc-guide" role="note">
                <div><strong>Controlá el dinero real de cada caja</strong><p>Contá el efectivo y consultá las cuentas. Ingresá cuánto encontraste; BALTO calculará cualquier diferencia.</p></div>
                <span className="fc-cc-guide__counter" data-testid="fc-cc-progreso">{verificados} de {filas.length} verificadas</span>
              </div>
              <div className="fc-cc-table" role="table" aria-label="Cajas a controlar">
                <div className="fc-cc-tr fc-cc-tr--head" role="row">
                  <div role="columnheader">Caja / medio</div>
                  <div role="columnheader" className="is-num">Saldo esperado</div>
                  <div role="columnheader" className="is-num">Saldo verificado</div>
                  <div role="columnheader" className="is-num">Diferencia</div>
                  <div role="columnheader">Estado</div>
                  <div role="columnheader">Observaciones</div>
                </div>
                {loading && !medios.length && <div className="fc-cc-empty">Calculando saldos…</div>}
                {!loading && !medios.length && !loadError && <div className="fc-cc-empty">No hay medios monetarios para controlar.</div>}
                {filas.map((f) => {
                  const est = f.tipo ? ESTADO_FILA[f.tipo] : null;
                  const marcarFalta = intentado && f.verificado == null && !f.error;
                  return (
                    <div key={f.id_medio_pago} className={`fc-cc-tr ${marcarFalta ? "is-missing" : ""}`} role="row" data-medio-id={f.id_medio_pago} data-testid={`fc-cc-row-${f.id_medio_pago}`}>
                      <div role="cell" data-label="Caja / medio" className="fc-cc-medio">
                        <b>{f.nombre}</b>
                        <small>
                          {f.clase_medio === "EFECTIVO" ? "Efectivo" : "Banco / billetera"}
                          {!f.activo && " · INACTIVO con saldo"}
                        </small>
                      </div>
                      <div role="cell" data-label="Saldo esperado" className="is-num" data-testid={`fc-cc-esperado-${f.id_medio_pago}`}>
                        {moneyARS(f.saldo_esperado)}
                      </div>
                      <div role="cell" data-label="Saldo verificado" className="is-num">
                        <div className="fc-cc-inputWrap">
                          <span aria-hidden="true">$</span>
                          <input
                            className="fc-cc-input"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="Ingresá saldo real"
                            aria-label={`Saldo verificado de ${f.nombre}`}
                            aria-invalid={Boolean(f.error) || marcarFalta}
                            data-testid={`fc-cc-input-${f.id_medio_pago}`}
                            value={f.texto}
                            onChange={(e) => setInput(f.id_medio_pago, { texto: e.target.value.replace(/[^0-9.,-]/g, "") })}
                            disabled={busy || !data?.puede_cerrar}
                          />
                          <button type="button" className="fc-cc-eq" title="Ya comprobé que coincide con BALTO" aria-label={`Ya verifiqué que coincide el saldo de ${f.nombre}`}
                            onClick={() => setInput(f.id_medio_pago, { texto: String(f.saldo_esperado).replace(".", ",") })}
                            disabled={busy || !data?.puede_cerrar}>
                            <FontAwesomeIcon icon={faCircleCheck} />
                          </button>
                        </div>
                        {f.error && <small className="fc-aj-error">{f.error}</small>}
                        {marcarFalta && <small className="fc-aj-error">Sin verificar</small>}
                      </div>
                      <div role="cell" data-label="Diferencia" className={`is-num ${f.diferencia == null ? "is-neutral" : signClass(f.diferencia)}`} data-testid={`fc-cc-dif-${f.id_medio_pago}`}>
                        {f.diferencia == null ? "—" : moneyARSSigned(f.diferencia)}
                      </div>
                      <div role="cell" data-label="Estado" className="fc-cc-estadoCell">
                        {est ? <span className={`fc-cc-badge fc-cc-badge--${est.tone}`} data-testid={`fc-cc-estado-${f.id_medio_pago}`}>{est.label}</span>
                          : <span className="fc-cc-badge fc-cc-badge--muted" data-testid={`fc-cc-estado-${f.id_medio_pago}`}>Sin verificar</span>}
                        {f.puedeAjustar && (
                          <label className="fc-cc-check">
                            <input type="checkbox" checked={f.aplicar} onChange={(e) => setInput(f.id_medio_pago, { aplicar: e.target.checked })}
                              disabled={busy} data-testid={`fc-cc-aplicar-${f.id_medio_pago}`} />
                            <span>Ajustar saldo</span>
                          </label>
                        )}
                        {f.diferencia ? (f.clase_medio !== "EFECTIVO" || historico) && (
                          <small className="fc-cc-hint">Queda pendiente, sin ajuste automático.</small>
                        ) : null}
                      </div>
                      <div role="cell" data-label="Observaciones">
                        <input className="fc-cc-input fc-cc-input--obs" maxLength={500} placeholder="Opcional"
                          aria-label={`Observaciones de ${f.nombre}`}
                          value={f.obs} onChange={(e) => setInput(f.id_medio_pago, { obs: e.target.value.toUpperCase() })}
                          disabled={busy || !data?.puede_cerrar} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="fc-cc-totals" aria-live="polite">
                <div><span>Total esperado</span><b>{moneyARS(tot.esperado)}</b></div>
                <div><span>{tot.sinVerificar ? "Verificado (parcial)" : "Total verificado"}</span><b>{verificados ? moneyARS(tot.verificado) : "—"}</b></div>
                <div><span>Sobrantes</span><b className="is-positive" data-testid="fc-cc-sobrantes">{moneyARS(tot.sobrantes)}</b></div>
                <div><span>Faltantes</span><b className="is-negative" data-testid="fc-cc-faltantes">{moneyARS(tot.faltantes)}</b></div>
                <div><span>{tot.sinVerificar ? "Diferencia (parcial)" : "Diferencia neta"}</span><b className={signClass(tot.neto)} data-testid="fc-cc-neto">{verificados ? moneyARSSigned(tot.neto) : "—"}</b></div>
              </div>
              {tot.sinVerificar > 0 && <p className="fc-cc-note">Los totales verificados y las diferencias son parciales hasta controlar todas las cajas. Usá el botón de confirmación de coincidencia solamente después de revisar el saldo real.</p>}
              {tot.diferencias > 1 && tot.neto === 0 && (
                <p className="fc-cc-note">Las diferencias se compensan en el total, pero se registran por separado en cada caja.</p>
              )}

              <div className="fl-field">
                <textarea id="fc-cc-obs" className="fl-input fc-aj-textarea" placeholder=" " maxLength={500} rows={2}
                  value={obsGeneral} onChange={(e) => setObsGeneral(e.target.value.toUpperCase())} disabled={busy || !data?.puede_cerrar} />
                <label className="fl-label" htmlFor="fc-cc-obs">Observaciones generales</label>
              </div>

              <div className="mi-mini__actions fc-aj-actions">
                {onOpenCierre && (
                  <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={() => onOpenCierre(null)} disabled={submitting}>
                    <FontAwesomeIcon icon={faClockRotateLeft} /> Historial de cierres
                  </button>
                )}
                <button type="button" className="mit-btn mit-btn--ghost" onClick={() => cargar(fecha, { conservar: true })} disabled={busy} title="Recalcular saldos esperados">
                  <FontAwesomeIcon icon={faRotateRight} /> Actualizar
                </button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={irAResumen} disabled={busy || !data?.puede_cerrar} data-testid="fc-cc-revisar">
                  Revisar cierre
                </button>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="fc-cc-confirm" data-testid="fc-cc-resumen">
              <p className="fc-aj-confirm__question">¿Confirmar el cierre de caja del {fmtDateES(data?.fecha_operativa)}?</p>
              <dl className="fc-cc-sumGrid">
                <div><dt>Fecha operativa</dt><dd>{fmtDateES(data?.fecha_operativa)}{historico ? " (histórico)" : ""}</dd></div>
                <div><dt>Responsable</dt><dd>{data?.responsable || "—"}</dd></div>
                <div><dt>Medios controlados</dt><dd>{filas.length}</dd></div>
                <div><dt>Total esperado</dt><dd>{moneyARS(tot.esperado)}</dd></div>
                <div><dt>Total verificado</dt><dd>{moneyARS(tot.verificado)}</dd></div>
                <div><dt>Sobrantes</dt><dd className="is-positive">{moneyARS(tot.sobrantes)}</dd></div>
                <div><dt>Faltantes</dt><dd className="is-negative">{moneyARS(tot.faltantes)}</dd></div>
              </dl>

              <div className="fc-cc-table fc-cc-table--compact" role="table" aria-label="Resumen por caja">
                <div className="fc-cc-tr fc-cc-tr--head fc-cc-tr--4" role="row">
                  <div role="columnheader">Caja</div>
                  <div role="columnheader" className="is-num">Esperado</div>
                  <div role="columnheader" className="is-num">Verificado</div>
                  <div role="columnheader" className="is-num">Diferencia</div>
                </div>
                {filas.map((f) => (
                  <div key={f.id_medio_pago} className="fc-cc-tr fc-cc-tr--4" role="row">
                    <div role="cell" data-label="Caja"><b>{f.nombre}</b></div>
                    <div role="cell" data-label="Esperado" className="is-num">{moneyARS(f.saldo_esperado)}</div>
                    <div role="cell" data-label="Verificado" className="is-num">{moneyARS(f.verificado)}</div>
                    <div role="cell" data-label="Diferencia" className={`is-num ${signClass(f.diferencia)}`}>{moneyARSSigned(f.diferencia)}</div>
                  </div>
                ))}
              </div>

              <div className="fc-cc-split">
                <section>
                  <h5 className="fc-aj-panelTitle">Ajustes de efectivo que se aplicarán</h5>
                  {ajustes.length ? (
                    <ul className="fc-cc-list" data-testid="fc-cc-ajustes">
                      {ajustes.map((f) => (
                        <li key={f.id_medio_pago}><span>{f.nombre}</span><b className={signClass(f.diferencia)}>{moneyARSSigned(f.diferencia)}</b></li>
                      ))}
                    </ul>
                  ) : <p className="fc-cc-muted">No se aplicará ningún ajuste de saldo.</p>}
                  {ajustes.length > 0 && <p className="fc-cc-note">El ajuste corrige el saldo de BALTO, pero la diferencia queda PENDIENTE hasta identificar su origen.</p>}
                </section>
                <section>
                  <h5 className="fc-aj-panelTitle">Diferencias que quedarán pendientes</h5>
                  {pendientes.length ? (
                    <ul className="fc-cc-list" data-testid="fc-cc-pendientes">
                      {pendientes.map((f) => (
                        <li key={f.id_medio_pago}>
                          <span>{f.nombre} · {f.tipo === "SOBRANTE" ? "sobrante" : "faltante"}{f.aplicar ? " (con ajuste)" : " (sin ajuste)"}</span>
                          <b className={signClass(f.diferencia)}>{moneyARSSigned(f.diferencia)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="fc-cc-muted">Todas las cajas coinciden.</p>}
                </section>
              </div>
              {obsGeneral.trim() && <p className="fc-cc-obsView"><b>Observaciones:</b> {obsGeneral.trim()}</p>}
              <p className="fc-cc-note"><FontAwesomeIcon icon={faTriangleExclamation} /> Asegurate de haber incluido las operaciones del día que querés controlar. Las operaciones posteriores no alterarán los importes originales de este cierre.</p>

              <div className="mi-mini__actions fc-aj-actions">
                <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={() => setStep("form")} disabled={submitting}>
                  <FontAwesomeIcon icon={faArrowLeft} /> Volver
                </button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={confirmar} disabled={submitting} data-testid="fc-cc-confirmar" autoFocus>
                  {submitting ? "Confirmando…" : "Confirmar cierre"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && resultado?.cierre && (
            <div className="fc-cc-done" data-testid="fc-cc-done">
              <p className="fc-cc-doneTitle">
                <FontAwesomeIcon icon={faCircleCheck} /> Cierre {resultado.cierre.numero || numeroCierre(resultado.cierre.id_cierre)} confirmado
                {resultado.duplicado ? " (ya estaba registrado)" : ""}.
              </p>
              <dl className="fc-cc-sumGrid">
                <div><dt>Fecha operativa</dt><dd>{fmtDateES(resultado.cierre.fecha_operativa)}</dd></div>
                <div><dt>Sobrantes</dt><dd className="is-positive">{moneyARS(resultado.cierre.total_sobrantes)}</dd></div>
                <div><dt>Faltantes</dt><dd className="is-negative">{moneyARS(resultado.cierre.total_faltantes)}</dd></div>
                <div><dt>Estado</dt><dd>{ESTADOS_CIERRE[resultado.cierre.estado_conciliacion]?.label || resultado.cierre.estado_conciliacion}</dd></div>
              </dl>
              <div className="mi-mini__actions fc-aj-actions">
                <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={() => imprimirComprobanteCierre(resultado)}>
                  <FontAwesomeIcon icon={faPrint} /> Imprimir comprobante
                </button>
                {onOpenCierre && (
                  <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onOpenCierre(resultado.cierre.id_cierre)}>Ver detalle</button>
                )}
                <button type="button" className="mit-btn mit-btn--solid" onClick={() => onClose?.()}>Listo</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
