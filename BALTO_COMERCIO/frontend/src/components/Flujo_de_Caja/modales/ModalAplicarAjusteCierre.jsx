// Ajuste autorizado de una diferencia del cierre que todavía NO fue aplicada
// al saldo. Pasos: Datos → Confirmación (Saldo actual, Ajuste, Saldo
// resultante) → Resultado. Se verifica contra el saldo VIGENTE; el cierre
// histórico no se modifica y la diferencia sigue pendiente de conciliar.
// Puede renderizarse dentro de "Resolver diferencia" (embedded, con su pie
// enviado al pie del modal contenedor) o como modal independiente.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faScaleBalanced, faTriangleExclamation, faCircleCheck, faArrowLeft, faWallet, faHourglassHalf,
} from "@fortawesome/free-solid-svg-icons";
import { aplicarAjusteCierre, nuevaClaveCierre, previsualizarAjusteCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";
import { ESTADOS_DETALLE, toCents } from "../utils/cierresUtils";
import { FieldMsg, MetaList, ModalShell, Stat, Steps, toneOf } from "./FcModalParts.jsx";

const PASOS = ["Datos", "Confirmación", "Resultado"];
const PASO = { form: "Datos", confirm: "Confirmación", done: "Resultado" };

/** Admite saldo negativo (cuentas en descubierto): "-1.234,50". */
function parseSaldo(texto) {
  const s = String(texto ?? "").trim();
  if (!s) return null;
  const neg = s.startsWith("-");
  const n = parseMoneyInput(neg ? s.slice(1) : s);
  if (n == null) return null;
  return neg ? -n : n;
}

export default function ModalAplicarAjusteCierre({
  open, detalle, onClose, onSaved, onDone, showToast, onBusyChange, onStepChange,
  embedded = false, footerTarget = null,
}) {
  const [preview, setPreview] = useState(null);
  const [verificado, setVerificado] = useState("");
  const [obs, setObs] = useState("");
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState("form");
  const [resultado, setResultado] = useState(null);
  const claveRef = useRef("");
  const submittingRef = useRef(false);

  useEffect(() => { onBusyChange?.(submitting); }, [submitting, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => { onStepChange?.(step); }, [step, onStepChange]);

  useEffect(() => {
    if (!open || !detalle) return undefined;
    let cancelled = false;
    setPreview(null);
    setVerificado("");
    setObs("");
    setErrors({});
    setApiError("");
    setStep("form");
    setResultado(null);
    claveRef.current = nuevaClaveCierre("caj");
    setLoading(true);
    previsualizarAjusteCierre(detalle.id_cierre_detalle)
      .then((j) => { if (!cancelled) setPreview(j.preview); })
      .catch((e) => { if (!cancelled) setApiError(e?.message || "No se pudo calcular el ajuste."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, detalle]);

  const revisar = (e) => {
    e?.preventDefault();
    if (!preview) return;
    const v = parseSaldo(verificado);
    const next = {};
    if (v == null) next.ver = "Ingresá el saldo real que verificaste hoy.";
    else if (toCents(v) !== toCents(preview.saldo_resultante)) next.ver = `No coincide con el saldo resultante (${moneyARS(preview.saldo_resultante)}). Revisá el dinero real.`;
    if (obs.trim().length < 5) next.obs = "Explicá por qué es necesario el ajuste (mínimo 5 caracteres).";
    setErrors(next);
    setApiError("");
    if (Object.keys(next).length) return;
    setStep("confirm");
  };

  const aplicar = async () => {
    if (submittingRef.current || !preview) return;
    submittingRef.current = true;
    setSubmitting(true);
    setApiError("");
    try {
      const j = await aplicarAjusteCierre({
        id_cierre_detalle: detalle.id_cierre_detalle,
        saldo_actual_esperado: toApiAmount(preview.saldo_actual),
        saldo_verificado_actual: toApiAmount(parseSaldo(verificado)),
        observaciones: obs.trim(),
        clave_solicitud: claveRef.current,
      });
      setResultado(j);
      setStep("done");
      showToast?.("exito", j.mensaje || "Ajuste aplicado.", 3000);
      onSaved?.(j);
    } catch (err) {
      setApiError(err?.message || "No se pudo aplicar el ajuste.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!open || !detalle) return null;

  const terminar = () => (onDone || onClose)?.();
  const det = resultado?.detalles?.find((d) => d.id_cierre_detalle === detalle.id_cierre_detalle);
  const pendienteFinal = Number(det?.importe_pendiente ?? detalle.importe_pendiente ?? 0);
  const estadoFinal = det ? (ESTADOS_DETALLE[det.estado_conciliacion]?.label || det.estado_conciliacion) : null;

  const footer = (
    <>
      <div className="fc-md-footer__start"><Steps labels={PASOS} current={PASO[step]} /></div>
      {step === "form" && <>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={submitting}>Cancelar</button>
        <button type="submit" form="fc-caj-form" className="mit-btn mit-btn--solid" disabled={loading || !preview} data-testid="fc-caj-revisar">
          Revisar ajuste
        </button>
      </>}
      {step === "confirm" && <>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => { setStep("form"); setApiError(""); }} disabled={submitting}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver
        </button>
        <button type="button" className="mit-btn mit-btn--solid" onClick={aplicar} disabled={submitting} data-testid="fc-caj-aplicar" autoFocus>
          <FontAwesomeIcon icon={faCircleCheck} /> {submitting ? "Aplicando…" : "Aplicar ajuste"}
        </button>
      </>}
      {step === "done" && (
        <button type="button" className="mit-btn mit-btn--solid" onClick={terminar} autoFocus>Listo</button>
      )}
    </>
  );

  const contenido = (
    <section className="fc-md-panel" data-testid="fc-caj-panel">
      {apiError && <div className="fc-md-alert fc-md-alert--error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{apiError}</span></div>}
      {loading && <div className="fc-md-empty"><span>Consultando saldo actual…</span></div>}

      {step === "form" && preview && (
        <form id="fc-caj-form" className="fc-md-panel" noValidate onSubmit={revisar}>
          <div className="fc-md-grid2">
            <div>
              <div className="fl-field fc-md-fl fc-md-fl--money">
                <input id="fc-caj-ver" className="fl-input" inputMode="decimal" autoComplete="off" placeholder=" " value={verificado}
                  aria-invalid={Boolean(errors.ver)} aria-describedby="fc-caj-ver-msg"
                  onChange={(e) => { setVerificado(e.target.value.replace(/[^0-9.,-]/g, "")); setErrors((x) => ({ ...x, ver: "" })); }}
                  disabled={submitting} />
                <label className="fl-label" htmlFor="fc-caj-ver">Saldo real verificado hoy</label>
              </div>
              <FieldMsg id="fc-caj-ver-msg" error={errors.ver} hint={`Debe coincidir con el saldo resultante: ${moneyARS(preview.saldo_resultante)}`} />
            </div>
            <div>
              <div className="fl-field fc-md-fl">
                <textarea id="fc-caj-obs" className="fl-input" maxLength={500} rows={2} placeholder=" " value={obs}
                  aria-invalid={Boolean(errors.obs)} aria-describedby="fc-caj-obs-msg"
                  onChange={(e) => { setObs(e.target.value); setErrors((x) => ({ ...x, obs: "" })); }}
                  disabled={submitting} />
                <label className="fl-label" htmlFor="fc-caj-obs">Motivo del ajuste</label>
              </div>
              <FieldMsg id="fc-caj-obs-msg" error={errors.obs} />
            </div>
          </div>
          <p className="fc-md-note fc-md-note--warn">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>Corrige el saldo vigente. La diferencia seguirá pendiente hasta conciliar su origen.</span>
          </p>
        </form>
      )}

      {step === "confirm" && preview && (
        <div className="fc-md-panel" data-testid="fc-caj-confirm">
          <div className="fc-md-stats fc-md-stats--3" aria-label="Efecto del ajuste">
            <Stat icon={faWallet} label="Saldo actual" value={moneyARS(preview.saldo_actual)} />
            <Stat icon={faScaleBalanced} label="Ajuste" value={moneyARSSigned(preview.ajuste)}
              tone={toneOf(preview.ajuste) === "neg" ? "neg" : "info"} tag={toneOf(preview.ajuste) === "neg" ? "Resta" : "Suma"} />
            <Stat icon={faCircleCheck} highlight label="Saldo resultante" value={moneyARS(preview.saldo_resultante)} tone="info" testId="fc-caj-resultante" />
          </div>
          <MetaList items={[
            { label: "Medio", value: detalle.medio_nombre },
            { label: "Verificado hoy", value: moneyARS(parseSaldo(verificado)) },
            { label: "Efecto desde", value: fmtDateES(preview.fecha_efectiva) },
            { label: "Motivo", value: obs.trim(), wide: true },
          ]} />
          <div className="fc-md-alert fc-md-alert--warning" role="note">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            <span>{preview.aviso || "El ajuste afecta el saldo actual y no modifica el cierre original."} La diferencia seguirá pendiente hasta conciliarla.</span>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="fc-md-panel" data-testid="fc-caj-done">
          <div className="fc-md-result">
            <span className="fc-md-result__icon"><FontAwesomeIcon icon={faCircleCheck} /></span>
            <div className="fc-md-result__text">
              <strong>Ajuste aplicado</strong>
              <span>{detalle.medio_nombre}{estadoFinal ? ` · ${estadoFinal}` : ""}</span>
            </div>
          </div>
          <div className="fc-md-stats fc-md-stats--3">
            <Stat icon={faScaleBalanced} label="Ajuste registrado" value={moneyARSSigned(preview?.ajuste)} tone={toneOf(preview?.ajuste) === "neg" ? "neg" : "info"} />
            <Stat icon={faWallet} label="Saldo actual" value={moneyARS(preview?.saldo_resultante)} />
            <Stat icon={pendienteFinal > 0.004 ? faHourglassHalf : faCircleCheck} highlight label="Diferencia por conciliar"
              value={moneyARS(pendienteFinal)} tone={pendienteFinal > 0.004 ? "warn" : "ok"}
              tag={pendienteFinal > 0.004 ? "Conciliá su origen" : "Resuelta"} />
          </div>
        </div>
      )}
    </section>
  );

  if (embedded) {
    return (
      <>
        {contenido}
        {footerTarget ? createPortal(footer, footerTarget) : null}
      </>
    );
  }

  return (
    <ModalShell
      open
      titleId="fc-caj-title"
      title={`Aplicar ajuste · ${detalle.medio_nombre}`}
      icon={faScaleBalanced}
      onClose={onClose}
      closeDisabled={submitting}
      size="md"
      overlayClassName="fc-md-overlay--top"
      className="fc-md-modal--fixedMd fc-cc-modal"
      footer={footer}
    >
      {contenido}
    </ModalShell>
  );
}
