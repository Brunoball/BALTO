// Ajuste autorizado de una diferencia que todavía NO fue aplicada al saldo.
// Se verifica contra el saldo VIGENTE; el cierre histórico no se modifica.
// Puede renderizarse como panel dentro del resolver o como modal independiente.
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faScaleBalanced, faTriangleExclamation, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { aplicarAjusteCierre, nuevaClaveCierre, previsualizarAjusteCierre } from "../api/flujoCajaCierresApi";
import { fmtDateES, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";

export default function ModalAplicarAjusteCierre({ open, detalle, onClose, onSaved, showToast, onBusyChange, embedded = false }) {
  const [preview, setPreview] = useState(null);
  const [verificado, setVerificado] = useState("");
  const [obs, setObs] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const claveRef = useRef("");
  const submittingRef = useRef(false);
  useEffect(() => { onBusyChange?.(submitting); return () => onBusyChange?.(false); }, [submitting, onBusyChange]);

  useEffect(() => {
    if (!open || !detalle) return;
    let cancelled = false;
    setPreview(null);
    setVerificado("");
    setObs("");
    setError("");
    claveRef.current = nuevaClaveCierre("caj");
    setLoading(true);
    previsualizarAjusteCierre(detalle.id_cierre_detalle)
      .then((j) => { if (!cancelled) setPreview(j.preview); })
      .catch((e) => { if (!cancelled) setError(e?.message || "No se pudo calcular el ajuste."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, detalle]);

  const aplicar = async (e) => {
    e?.preventDefault();
    if (submittingRef.current || !preview) return;
    const v = parseMoneyInput(verificado);
    if (v == null) { setError("Ingresá el saldo real que verificaste hoy."); return; }
    if (obs.trim().length < 5) { setError("Explicá por qué es necesario el ajuste (mínimo 5 caracteres)."); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const j = await aplicarAjusteCierre({
        id_cierre_detalle: detalle.id_cierre_detalle,
        saldo_actual_esperado: toApiAmount(preview.saldo_actual),
        saldo_verificado_actual: toApiAmount(v),
        observaciones: obs.trim(),
        clave_solicitud: claveRef.current,
      });
      showToast?.("exito", j.mensaje || "Ajuste aplicado.", 3000);
      onSaved?.(j);
    } catch (err) { setError(err?.message || "No se pudo aplicar el ajuste."); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  if (!open || !detalle) return null;

  const contenido = (
    <section className="fc-cc-resolution-form fc-cc-resolution-form--adjust" data-testid="fc-caj-panel">
      <div className="fc-cc-resolution-form__intro">
        <strong>Aplicar ajuste autorizado</strong>
        <p>Usalo solo si no hay un movimiento real que explique la diferencia y necesitás corregir el saldo. <b>La diferencia seguirá pendiente hasta que se justifique su origen.</b></p>
      </div>
      {error && <div className="fc-aj-alert fc-aj-alert--error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span></div>}
      {loading && <div className="fc-cc-empty">Consultando saldo actual…</div>}
      {preview && <form onSubmit={aplicar} className="fc-cc-adjust-form">
        <div className="fc-cc-adjust-summary">
          <div><span>Saldo actual según BALTO</span><strong>{moneyARS(preview.saldo_actual)}</strong></div>
          <div><span>Ajuste que se aplicará</span><strong>{moneyARSSigned(preview.ajuste)}</strong></div>
          <div><span>Saldo después del ajuste</span><strong>{moneyARS(preview.saldo_resultante)}</strong></div>
        </div>
        <p className="fc-cc-adjust-hint"><FontAwesomeIcon icon={faTriangleExclamation} /> {preview.aviso} Efecto desde el {fmtDateES(preview.fecha_efectiva)}; no se modifica el cierre original.</p>
        <div className="fc-cc-adjust-form__fields">
          <label className="fc-cc-plainField">
            <span>Saldo real verificado hoy ($)</span>
            <input id="fc-caj-ver" inputMode="decimal" autoComplete="off" placeholder="Ej.: 324234,00" value={verificado}
              onChange={(e) => setVerificado(e.target.value.replace(/[^0-9.,-]/g, ""))} disabled={submitting} required />
            <small>Consultá el dinero real ahora; debe coincidir con el saldo resultante.</small>
          </label>
          <label className="fc-cc-plainField">
            <span>Motivo del ajuste</span>
            <textarea id="fc-caj-obs" maxLength={500} rows={2} placeholder="Explicá la corrección (obligatorio)" value={obs} onChange={(e) => setObs(e.target.value)} disabled={submitting} required />
          </label>
        </div>
        <div className="fc-cc-resolution-form__footer">
          {!embedded && <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={submitting}>Cancelar</button>}
          <button type="submit" className="mit-btn mit-btn--solid" disabled={submitting || loading} data-testid="fc-caj-aplicar">
            <FontAwesomeIcon icon={faCircleCheck} /> {submitting ? "Aplicando…" : "Confirmar ajuste de saldo"}
          </button>
        </div>
      </form>}
    </section>
  );

  if (embedded) return contenido;
  return createPortal(<div className="mi-mini__overlay fc-aj-overlay fc-cc-overlay--top" role="presentation">
    <div className="mi-mini__modal fc-aj-modal fc-cc-modal fc-cc-modal--mid" role="dialog" aria-modal="true" aria-labelledby="fc-caj-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mi-mini__head"><h4 id="fc-caj-title" className="mi-mini__title fc-aj-title"><FontAwesomeIcon icon={faScaleBalanced} /> Aplicar ajuste · {detalle.medio_nombre}</h4>
        <button type="button" className="mi-mini__close" onClick={() => !submitting && onClose?.()} disabled={submitting} aria-label="Cerrar"><FontAwesomeIcon icon={faXmark} /></button>
      </div><div className="mi-mini__body fc-aj-body fc-cc-body">{contenido}</div>
    </div>
  </div>, document.body);
}
