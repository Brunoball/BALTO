// src/components/Flujo_de_Caja/modales/ModalCierreCaja.jsx
// Cierre de caja (arqueo) por medio de pago monetario real.
// Pasos: Arqueo (importes verificados) → Confirmación → Resultado.
// El backend recalcula saldos esperados y diferencias, rechaza datos
// desactualizados (409) y guarda el cierre con sus ajustes de efectivo en una
// sola transacción. El resultado se muestra sólo cuando el backend confirma.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCashRegister, faTriangleExclamation, faArrowLeft, faCircleCheck, faPrint, 
  faWallet, faArrowTrendUp, faArrowTrendDown, faScaleBalanced, faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";

import "./cierres_caja.css";

import { CierreApiError, confirmarCierre, nuevaClaveCierre, previsualizarCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";
import { diferenciaCents, ESTADOS_CIERRE, fromCents, numeroCierre, tipoDiferencia, totalesCierre } from "../utils/cierresUtils";
import { imprimirComprobanteCierre } from "../utils/cierreComprobante";
import { Badge, FieldMsg, MetaList, ModalShell, Stat, Steps, etiquetaDiferencia, toneOf } from "./FcModalParts.jsx";

const PASOS = ["Arqueo", "Confirmación", "Resultado"];

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
  SOBRANTE: { label: "Sobrante", tone: "info" },
  FALTANTE: { label: "Faltante", tone: "neg" },
  SIN_DIFERENCIA: { label: "Coincide", tone: "ok" },
};
const numClaseDif = (n) => (toneOf(n) === "pos" ? "fc-md-num--sobrante" : toneOf(n) === "neg" ? "fc-md-num--faltante" : "fc-md-num--zero");
const toneNeto = (n) => (toneOf(n) === "zero" ? "ok" : "warn");

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
            // La capacidad de ajustar no equivale a una autorización del usuario.
            aplicar: p?.aplicar ?? false,
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
  const coinciden = filas.length - pendientes.length;

  const setInput = (id, patch) => {
    setInputs((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
    // El aviso de validación general se quita al corregir: la marca de cada
    // fila sigue indicando qué caja falta.
    if (notice?.tipo === "error" && patch.texto !== undefined) setNotice(null);
  };

  const irAResumen = () => {
    setIntentado(true);
    setNotice(null);
    if (!data?.puede_cerrar) return;
    if (hayErrores) { setNotice({ tipo: "error", texto: "Corregí los importes marcados." }); return; }
    if (sinVerificar.length) {
      const n = sinVerificar.length;
      setNotice({ tipo: "error", texto: `Faltan verificar ${n} ${n === 1 ? "caja" : "cajas"}. Ingresá 0 si no hay dinero.` });
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
  const puedeEditar = Boolean(data?.puede_cerrar) && !busy;
  const titulo = step === "done" ? "Cierre confirmado" : step === "confirm" ? "Confirmar cierre de caja" : "Cerrar caja";
  const pasoActual = step === "done" ? "Resultado" : step === "confirm" ? "Confirmación" : "Arqueo";
  const progreso = filas.length ? Math.round((verificados / filas.length) * 100) : 0;

  const rc = resultado?.cierre;
  const pendienteResultado = rc ? Number(rc.importe_pendiente ?? (resultado.detalles || []).reduce((s, d) => s + Number(d.importe_pendiente || 0), 0)) : 0;

  let footer;
  if (step === "form") {
    footer = (
      <>
        <div className="fc-md-footer__start">
          <Steps labels={PASOS} current={pasoActual} />
        </div>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={submitting}>Cancelar</button>
        <button type="button" className="mit-btn mit-btn--solid" onClick={irAResumen} disabled={busy || !data?.puede_cerrar} data-testid="fc-cc-revisar">
          Revisar cierre
        </button>
      </>
    );
  } else if (step === "confirm") {
    footer = (
      <>
        <div className="fc-md-footer__start"><Steps labels={PASOS} current={pasoActual} /></div>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => setStep("form")} disabled={submitting}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver
        </button>
        <button type="button" className="mit-btn mit-btn--solid" onClick={confirmar} disabled={submitting} data-testid="fc-cc-confirmar" autoFocus>
          <FontAwesomeIcon icon={faCircleCheck} /> {submitting ? "Confirmando…" : "Confirmar cierre"}
        </button>
      </>
    );
  } else {
    const hayPendiente = pendienteResultado > 0.004;
    footer = (
      <>
        <div className="fc-md-footer__start">
          <Steps labels={PASOS} current={pasoActual} />
          {rc && (
            <button type="button" className="mit-btn mit-btn--ghost" onClick={() => imprimirComprobanteCierre(resultado)}>
              <FontAwesomeIcon icon={faPrint} /> Imprimir comprobante
            </button>
          )}
        </div>
        {hayPendiente || !onOpenCierre ? (
          <>
            <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()}>Cerrar</button>
            {onOpenCierre && rc && (
              <button type="button" className="mit-btn mit-btn--solid" onClick={() => onOpenCierre(rc.id_cierre)} autoFocus>Ver detalle</button>
            )}
          </>
        ) : (
          <>
            {rc && <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onOpenCierre(rc.id_cierre)}>Ver detalle</button>}
            <button type="button" className="mit-btn mit-btn--solid" onClick={() => onClose?.()} autoFocus>Listo</button>
          </>
        )}
      </>
    );
  }

  return (
    <ModalShell
      open
      titleId="fc-cc-title"
      title={titulo}
      icon={faCashRegister}
      onClose={onClose}
      closeDisabled={submitting}
      size="xl"
      className="fc-md-modal--fixed fc-cc-modal"
      footer={footer}
    >
      {loadError && (
        <div className="fc-md-alert fc-md-alert--error" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{loadError}</span>
          <button type="button" className="fc-md-link" onClick={() => cargar(fecha)}>Reintentar</button>
        </div>
      )}
      {notice && (
        <div className={`fc-md-alert fc-md-alert--${notice.tipo === "error" ? "error" : "warning"}`} role={notice.tipo === "error" ? "alert" : "status"} data-testid="fc-cc-notice">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{notice.texto}</span>
          {notice.idCierre && onOpenCierre && (
            <button type="button" className="fc-md-link" onClick={() => onOpenCierre(notice.idCierre)}>Ver cierre</button>
          )}
        </div>
      )}

      {step === "form" && <>
        <div className="fc-cc-topbar">
          <div className="fl-field fc-md-fl">
            <input id="fc-cc-fecha" type="date" className="fl-input" placeholder=" " value={fecha}
              max={data?.fecha_negocio || undefined}
              onChange={(e) => { const v = e.target.value; setFecha(v); if (v) cargar(v, { conservar: false }); }}
              disabled={busy} />
            <label className="fl-label" htmlFor="fc-cc-fecha">Fecha del cierre</label>
          </div>
          <MetaList items={[
            { label: "Responsable", value: data?.responsable || "—", testId: "fc-cc-responsable" },
            { label: "Realizado", value: data?.ahora ? `${fmtDateES(data.ahora.slice(0, 10))} ${data.ahora.slice(11, 16)}` : "—", testId: "fc-cc-ahora" },
            historico && { label: "Tipo", value: "Histórico" },
          ]} />
          <span className={`fc-md-progress ${filas.length && !tot.sinVerificar ? "is-complete" : ""}`}>
            <span className="fc-md-progress__bar" aria-hidden="true"><i style={{ width: `${progreso}%` }} /></span>
            <span data-testid="fc-cc-progreso">{verificados} de {filas.length} verificadas</span>
          </span>
        </div>

        {(data?.avisos || []).map((a) => (
          <div key={a} className="fc-md-alert fc-md-alert--warning" role="status">
            <FontAwesomeIcon icon={faTriangleExclamation} /><span>{a}</span>
          </div>
        ))}

        {cierreExistente && (
          <div className="fc-md-alert fc-md-alert--warning" role="status" data-testid="fc-cc-existente">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>Ya existe el cierre {cierreExistente.numero} de esta fecha ({cierreExistente.usuario_nombre || "—"}). No se reemplaza.</span>
            {onOpenCierre && (
              <button type="button" className="fc-md-link" onClick={() => onOpenCierre(cierreExistente.id_cierre)}>Ver cierre</button>
            )}
          </div>
        )}

        <div className="fc-md-table fc-md-table--cards fc-cc-table" role="table" aria-label="Cajas a controlar" aria-busy={loading}>
          <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
            <div className="mov-gridCell--head" role="columnheader">Caja</div>
            <div className="mov-gridCell--head is-right" role="columnheader">Saldo esperado</div>
            <div className="mov-gridCell--head is-right" role="columnheader">Saldo verificado</div>
            <div className="mov-gridCell--head is-right" role="columnheader">Diferencia</div>
            <div className="mov-gridCell--head" role="columnheader">Observación</div>
          </div>
          <div className="fc-md-tbody" role="rowgroup">
            {loading && !medios.length && <div className="fc-md-empty"><span>Calculando saldos…</span></div>}
            {!loading && !medios.length && !loadError && <div className="fc-md-empty"><strong>No hay medios monetarios para controlar.</strong></div>}
            {filas.map((f) => {
              const est = f.tipo ? ESTADO_FILA[f.tipo] : null;
              const marcarFalta = intentado && f.verificado == null && !f.error;
              return (
                <div key={f.id_medio_pago} className={`mov-gridTable fc-md-row fc-md-tr ${marcarFalta ? "is-missing" : ""}`} role="row"
                  data-medio-id={f.id_medio_pago} data-testid={`fc-cc-row-${f.id_medio_pago}`}>
                  <div role="cell" className="mov-gridCell fc-md-cell--full">
                    <span className="fc-cc-cajaName">
                      <b>{f.nombre}</b>
                      <small>{f.clase_medio === "EFECTIVO" ? "Efectivo" : "Banco / billetera"}{!f.activo && " · Inactivo con saldo"}</small>
                    </span>
                  </div>
                  <div role="cell" data-label="Saldo esperado" className="mov-gridCell is-right">
                    <span className="fc-md-num" data-testid={`fc-cc-esperado-${f.id_medio_pago}`}>{moneyARS(f.saldo_esperado)}</span>
                  </div>
                  <div role="cell" data-label="Saldo verificado" className="mov-gridCell fc-cc-verif">
                    <div className="fc-cc-money">
                      <span aria-hidden="true">$</span>
                      <input
                        className="fc-cc-input"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0,00"
                        aria-label={`Saldo verificado de ${f.nombre}`}
                        aria-invalid={Boolean(f.error) || marcarFalta}
                        aria-describedby={`fc-cc-msg-${f.id_medio_pago}`}
                        data-testid={`fc-cc-input-${f.id_medio_pago}`}
                        value={f.texto}
                        onChange={(e) => setInput(f.id_medio_pago, { texto: e.target.value.replace(/[^0-9.,-]/g, "") })}
                        disabled={!puedeEditar}
                      />
                      <button type="button" className="fc-cc-eq" title="Coincide con el saldo esperado" aria-label={`Ya verifiqué que coincide el saldo de ${f.nombre}`}
                        onClick={() => setInput(f.id_medio_pago, { texto: String(f.saldo_esperado).replace(".", ",") })}
                        disabled={!puedeEditar}>
                        <FontAwesomeIcon icon={faCircleCheck} />
                      </button>
                    </div>
                    <FieldMsg id={`fc-cc-msg-${f.id_medio_pago}`} error={f.error} warn={marcarFalta ? "Falta verificar esta caja" : ""} />
                  </div>
                  <div role="cell" data-label="Diferencia" className="mov-gridCell fc-cc-diff">
                    <span className={`fc-md-num fc-cc-diff__amount ${f.diferencia == null ? "fc-md-num--zero" : numClaseDif(f.diferencia)}`} data-testid={`fc-cc-dif-${f.id_medio_pago}`}>
                      {f.diferencia == null ? "—" : moneyARSSigned(f.diferencia)}
                    </span>
                    {est
                      ? <Badge tone={est.tone} testId={`fc-cc-estado-${f.id_medio_pago}`}>{est.label}</Badge>
                      : <Badge tone="muted" testId={`fc-cc-estado-${f.id_medio_pago}`}>Sin verificar</Badge>}
                    {f.puedeAjustar && (
                      <label className="fc-cc-check" title="Corrige hoy el saldo de BALTO. La diferencia queda pendiente de conciliar.">
                        <input type="checkbox" checked={f.aplicar} onChange={(e) => setInput(f.id_medio_pago, { aplicar: e.target.checked })}
                          disabled={busy} data-testid={`fc-cc-aplicar-${f.id_medio_pago}`} />
                        <span>Ajustar saldo</span>
                      </label>
                    )}
                  </div>
                  <div className="mov-gridCell fc-md-cell--full" role="cell" data-label="Observación">
                    <input className="fc-cc-input fc-cc-input--obs" maxLength={500} placeholder="Opcional"
                      aria-label={`Observaciones de ${f.nombre}`}
                      value={f.obs} onChange={(e) => setInput(f.id_medio_pago, { obs: e.target.value.toUpperCase() })}
                      disabled={!puedeEditar} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="fc-md-stats fc-md-stats--5" aria-live="polite" aria-label="Totales del arqueo">
          <Stat icon={faCashRegister} label="Total esperado" value={moneyARS(tot.esperado)} />
          <Stat icon={faWallet} label={tot.sinVerificar ? "Verificado (parcial)" : "Total verificado"} value={verificados ? moneyARS(tot.verificado) : "—"} />
          <Stat icon={faArrowTrendUp} label="Sobrantes" value={moneyARS(tot.sobrantes)} tone={tot.sobrantes ? "info" : "neutral"} testId="fc-cc-sobrantes" />
          <Stat icon={faArrowTrendDown} label="Faltantes" value={moneyARS(tot.faltantes)} tone={tot.faltantes ? "neg" : "neutral"} testId="fc-cc-faltantes" />
          <Stat icon={faScaleBalanced} highlight testId="fc-cc-neto"
            label={tot.sinVerificar ? "Diferencia (parcial)" : "Diferencia neta"}
            value={verificados ? moneyARSSigned(tot.neto) : "—"}
            tone={!verificados ? "muted" : tot.diferencias ? toneNeto(tot.neto || 1) : "ok"}
            tag={!verificados ? "Sin verificar" : tot.diferencias ? `${tot.diferencias} ${tot.diferencias === 1 ? "caja con diferencia" : "cajas con diferencia"}` : "Sin diferencias"} />
        </div>
        {tot.diferencias > 1 && tot.neto === 0 && (
          <p className="fc-md-note fc-md-note--warn"><FontAwesomeIcon icon={faTriangleExclamation} /> Las diferencias se compensan en el total, pero se registran por separado en cada caja.</p>
        )}

        <div className="fl-field fc-md-fl">
          <textarea id="fc-cc-obs" className="fl-input" placeholder=" " maxLength={500} rows={2}
            value={obsGeneral} onChange={(e) => setObsGeneral(e.target.value.toUpperCase())} disabled={!puedeEditar} />
          <label className="fl-label" htmlFor="fc-cc-obs">Observaciones generales</label>
        </div>
      </>}

      {step === "confirm" && (
        <div className="fc-md-panel" data-testid="fc-cc-resumen">
          <MetaList items={[
            { label: "Fecha del cierre", value: `${fmtDateES(data?.fecha_operativa)}${historico ? " (histórico)" : ""}` },
            { label: "Responsable", value: data?.responsable || "—" },
            { label: "Cajas controladas", value: filas.length },
          ]} />

          <div className="fc-md-stats fc-md-stats--5" aria-label="Importes a confirmar">
            <Stat icon={faCashRegister} label="Total esperado" value={moneyARS(tot.esperado)} />
            <Stat icon={faWallet} label="Total verificado" value={moneyARS(tot.verificado)} />
            <Stat icon={faArrowTrendUp} label="Sobrantes" value={moneyARS(tot.sobrantes)} tone={tot.sobrantes ? "info" : "neutral"} />
            <Stat icon={faArrowTrendDown} label="Faltantes" value={moneyARS(tot.faltantes)} tone={tot.faltantes ? "neg" : "neutral"} />
            <Stat icon={faScaleBalanced} highlight label="Diferencia neta" value={moneyARSSigned(tot.neto)}
              tone={tot.diferencias ? toneNeto(tot.neto || 1) : "ok"}
              tag={tot.diferencias ? `${tot.diferencias} ${tot.diferencias === 1 ? "caja con diferencia" : "cajas con diferencia"}` : "Sin diferencias"} />
          </div>

          <div className={`fc-cc-confirmGrid ${ajustes.length ? "has-ajustes" : ""}`}>
            <section className="fc-md-section" aria-labelledby="fc-cc-pend-title">
              <h5 id="fc-cc-pend-title" className="fc-md-section__title">
                Diferencias que quedarán pendientes <span className={`fc-md-count ${pendientes.length ? "fc-md-count--warn" : ""}`}>{pendientes.length}</span>
              </h5>
              {pendientes.length ? (
                <ul className="fc-md-lines" data-testid="fc-cc-pendientes">
                  {pendientes.map((f) => (
                    <li key={f.id_medio_pago}>
                      <span className="fc-md-lines__name">{f.nombre}</span>
                      <Badge tone={f.diferencia > 0 ? "info" : "neg"}>{etiquetaDiferencia(f.diferencia)}</Badge>
                      <span className="fc-md-lines__end"><b className={`fc-md-num fc-md-num--strong ${numClaseDif(f.diferencia)}`}>{moneyARSSigned(f.diferencia)}</b></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="fc-md-note"><FontAwesomeIcon icon={faCircleCheck} className="fc-md-num--pos" /> Todas las cajas coinciden.</p>}
              {pendientes.length > 0 && coinciden > 0 && (
                <p className="fc-md-note">{coinciden} {coinciden === 1 ? "caja coincide" : "cajas coinciden"} con BALTO.</p>
              )}
            </section>

            {ajustes.length > 0 && (
              <section className="fc-md-section" aria-labelledby="fc-cc-aj-title">
                <h5 id="fc-cc-aj-title" className="fc-md-section__title">Ajustes de saldo que se aplicarán hoy</h5>
                <ul className="fc-md-lines" data-testid="fc-cc-ajustes">
                  {ajustes.map((f) => (
                    <li key={f.id_medio_pago}>
                      <span className="fc-md-lines__name">{f.nombre}</span>
                      <span className="fc-md-lines__end"><b className={`fc-md-num ${numClaseDif(f.diferencia)}`}>{moneyARSSigned(f.diferencia)}</b></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {obsGeneral.trim() && <MetaList items={[{ label: "Observaciones", value: obsGeneral.trim(), wide: true }]} />}

          <div className="fc-md-alert fc-md-alert--warning" role="note">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>
              El cierre no se edita ni se elimina después de confirmarlo.
              {ajustes.length > 0 && " Los ajustes corrigen el saldo de hoy; las diferencias quedan pendientes hasta conciliarlas."}
            </span>
          </div>
        </div>
      )}

      {step === "done" && rc && (
        <div className="fc-md-panel" data-testid="fc-cc-done">
          <div className="fc-md-result">
            <span className="fc-md-result__icon"><FontAwesomeIcon icon={faCircleCheck} /></span>
            <div className="fc-md-result__text">
              <strong>Cierre {rc.numero || numeroCierre(rc.id_cierre)} confirmado{resultado.duplicado ? " (ya estaba registrado)" : ""}</strong>
              <span>{fmtDateES(rc.fecha_operativa)} · {ESTADOS_CIERRE[rc.estado_conciliacion]?.label || rc.estado_conciliacion}</span>
            </div>
          </div>
          <div className="fc-md-stats fc-md-stats--3">
            <Stat icon={faArrowTrendUp} label="Sobrantes" value={moneyARS(rc.total_sobrantes)} tone={Number(rc.total_sobrantes) ? "info" : "neutral"} />
            <Stat icon={faArrowTrendDown} label="Faltantes" value={moneyARS(rc.total_faltantes)} tone={Number(rc.total_faltantes) ? "neg" : "neutral"} />
            <Stat icon={pendienteResultado > 0.004 ? faHourglassHalf : faCircleCheck} highlight label="Pendiente de resolver"
              value={moneyARS(pendienteResultado)} tone={pendienteResultado > 0.004 ? "warn" : "ok"}
              tag={pendienteResultado > 0.004 ? "Resolvelo desde el detalle" : "Sin diferencias"} />
          </div>
        </div>
      )}
    </ModalShell>
  );
}
