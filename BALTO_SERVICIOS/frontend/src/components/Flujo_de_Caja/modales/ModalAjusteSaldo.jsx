// src/components/Flujo_de_Caja/modales/ModalAjusteSaldo.jsx
// Ajuste manual de saldo de una caja / medio de pago monetario.
// Flujo: formulario con vista previa inmediata → confirmación con valores
// recalculados por el backend → registro. El modal se cierra sólo cuando el
// backend confirma la operación.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faScaleBalanced,
  faWallet,
  faSliders,
  faCalculator,
  faTriangleExclamation,
  faClockRotateLeft,
  faArrowLeft,
  faCreditCard,
  faCoins,
  faArrowRightArrowLeft,
  faFileLines,
  faCalendarDays,
  faCommentDots,
} from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Modals.css";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./ajustes_saldo.css";

import {
  AjusteApiError,
  crearAjuste,
  nuevaClaveSolicitud,
  obtenerMediosAjuste,
  previsualizarAjuste,
} from "../api/flujoCajaAjustesApi";
import {
  computeAjustePreview,
  fmtDateES,
  moneyARS,
  moneyARSSigned,
  parseMoneyInput,
  toApiAmount,
} from "../utils/flujoCajaUtils";

const TIPOS = [
  { codigo: "ESTABLECER", label: "Establecer saldo", hint: "Ingresá el dinero verificado físicamente o en la cuenta." },
  { codigo: "SUMAR", label: "Sumar importe", hint: "Ingresá el importe que falta registrar." },
  { codigo: "RESTAR", label: "Restar importe", hint: "Ingresá el importe a descontar." },
];

const MOTIVOS_FALLBACK = [
  { codigo: "DIFERENCIA_DE_ARQUEO", label: "DIFERENCIA DE ARQUEO" },
  { codigo: "CONCILIACION_BANCARIA", label: "CONCILIACIÓN BANCARIA" },
  { codigo: "REGULARIZACION_DE_SALDO", label: "REGULARIZACIÓN DE SALDO" },
  { codigo: "CORRECCION_ADMINISTRATIVA", label: "CORRECCIÓN ADMINISTRATIVA" },
  { codigo: "OTRO", label: "OTRO" },
];

const IMPORTE_LABEL = {
  ESTABLECER: "Saldo real verificado",
  SUMAR: "Importe a sumar",
  RESTAR: "Importe a restar",
};

function groupMedios(medios) {
  const groups = new Map();
  medios.forEach((m) => {
    const key = m.grupo_key || `medio_${m.id_medio_pago}`;
    if (!groups.has(key)) groups.set(key, { key, label: m.grupo_label || m.nombre, medios: [] });
    groups.get(key).medios.push(m);
  });
  return Array.from(groups.values());
}

function signClass(n) {
  if (n > 0.004) return "is-positive";
  if (n < -0.004) return "is-negative";
  return "is-neutral";
}

export default function ModalAjusteSaldo({ open, onClose, onSaved, onOpenHistorial, showToast }) {
  const [loadingMedios, setLoadingMedios] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [medios, setMedios] = useState([]);
  const [motivos, setMotivos] = useState(MOTIVOS_FALLBACK);
  const [fechaNegocio, setFechaNegocio] = useState("");

  const [idMedio, setIdMedio] = useState("");
  const [tipo, setTipo] = useState("ESTABLECER");
  const [importeText, setImporteText] = useState("");
  const [motivo, setMotivo] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");

  const [step, setStep] = useState("form");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmData, setConfirmData] = useState(null);
  const claveRef = useRef("");
  const firstFieldRef = useRef(null);
  const busy = checking || submitting;

  const cargarMedios = useCallback(async ({ keepSelection = true } = {}) => {
    setLoadingMedios(true);
    setLoadError("");
    try {
      const json = await obtenerMediosAjuste();
      const list = Array.isArray(json?.medios) ? json.medios : [];
      setMedios(list);
      if (Array.isArray(json?.motivos) && json.motivos.length) setMotivos(json.motivos);
      setFechaNegocio(String(json?.fecha_negocio || ""));
      setIdMedio((current) => {
        const exists = keepSelection && list.some((m) => String(m.id_medio_pago) === String(current));
        if (exists) return current;
        return list.length ? String(list[0].id_medio_pago) : "";
      });
      return list;
    } catch (e) {
      setLoadError(e?.message || "No se pudieron cargar los medios de pago.");
      return [];
    } finally {
      setLoadingMedios(false);
    }
  }, []);

  // Al abrir: formulario limpio y saldos frescos desde el backend.
  useEffect(() => {
    if (!open) return;
    setTipo("ESTABLECER");
    setImporteText("");
    setMotivo("");
    setObservaciones("");
    setErrors({});
    setNotice("");
    setStep("form");
    setConfirmData(null);
    claveRef.current = "";
    cargarMedios({ keepSelection: false });
  }, [open, cargarMedios]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open && step === "form" && !loadingMedios) firstFieldRef.current?.focus?.();
  }, [open, step, loadingMedios]);

  // Cualquier cambio en el formulario invalida la clave de confirmación previa.
  useEffect(() => {
    claveRef.current = "";
  }, [idMedio, tipo, importeText, motivo, observaciones]);

  const clearError = (...keys) => setErrors((prev) => {
    if (!keys.some((k) => prev[k])) return prev;
    const next = { ...prev };
    keys.forEach((k) => delete next[k]);
    return next;
  });

  const medioSel = useMemo(
    () => medios.find((m) => String(m.id_medio_pago) === String(idMedio)) || null,
    [medios, idMedio]
  );
  const grupos = useMemo(() => groupMedios(medios), [medios]);
  const grupoSel = useMemo(
    () => (medioSel ? grupos.find((g) => g.key === medioSel.grupo_key) : null),
    [grupos, medioSel]
  );

  const importe = useMemo(() => parseMoneyInput(importeText), [importeText]);
  const preview = useMemo(
    () => (medioSel ? computeAjustePreview(medioSel.saldo_actual, tipo, importe) : null),
    [medioSel, tipo, importe]
  );

  const validate = () => {
    const next = {};
    if (!medioSel) next.medio = "Seleccioná la caja o medio de pago.";
    if (importeText.trim() === "" || importe == null) next.importe = "Ingresá un importe válido (hasta 2 decimales).";
    else if (tipo !== "ESTABLECER" && importe <= 0) next.importe = "El importe debe ser mayor a cero.";
    else if (preview && Math.abs(preview.diferencia) < 0.005) next.importe = "El saldo real coincide con el saldo actual: no hay diferencia para registrar.";
    if (!motivo) next.motivo = "Seleccioná el motivo del ajuste.";
    if (motivo === "OTRO" && observaciones.trim().length < 5) next.observaciones = "Explicá la diferencia (mínimo 5 caracteres).";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleRevisar = async () => {
    setNotice("");
    if (!validate()) return;
    setChecking(true);
    try {
      // Valores definitivos: los recalcula el backend con el saldo vigente.
      const json = await previsualizarAjuste({ idMedioPago: medioSel.id_medio_pago, tipo, importe: toApiAmount(importe) });
      const p = json?.preview;
      if (!p) throw new Error("No se pudo calcular la vista previa.");
      if (p.sin_diferencia) {
        setErrors({ importe: "El saldo real coincide con el saldo actual: no hay diferencia para registrar." });
        return;
      }
      if (Math.abs(Number(p.saldo_actual) - Number(medioSel.saldo_actual)) >= 0.005) {
        setMedios((list) => list.map((m) => (m.id_medio_pago === p.medio.id_medio_pago ? { ...m, saldo_actual: p.saldo_actual } : m)));
        setNotice("El saldo cambió desde que abriste el ajuste. Revisá los valores actualizados.");
      }
      if (!claveRef.current) claveRef.current = nuevaClaveSolicitud();
      setConfirmData(p);
      setStep("confirm");
    } catch (e) {
      showToast?.("error", e?.message || "No se pudo calcular la vista previa.", 4200);
    } finally {
      setChecking(false);
    }
  };

  const handleRegistrar = async () => {
    if (!confirmData || submitting) return;
    setSubmitting(true);
    try {
      const json = await crearAjuste({
        id_medio_pago: confirmData.medio.id_medio_pago,
        tipo_ajuste: tipo,
        importe: toApiAmount(importe),
        motivo,
        observaciones: observaciones.trim(),
        saldo_esperado: toApiAmount(confirmData.saldo_actual),
        clave_solicitud: claveRef.current,
      });
      showToast?.("exito", json?.mensaje || "Ajuste de saldo registrado correctamente.", 3200);
      onSaved?.(json);
      onClose?.();
    } catch (e) {
      if (e instanceof AjusteApiError && e.codigo === "SALDO_DESACTUALIZADO") {
        // Otro movimiento cambió el saldo: nunca se confirma con valores viejos.
        await cargarMedios();
        setStep("form");
        setConfirmData(null);
        claveRef.current = "";
        setNotice("El saldo cambió antes de confirmar. Se actualizaron los valores: revisá la vista previa y confirmá nuevamente.");
        showToast?.("advertencia", e.message, 5200);
      } else {
        showToast?.("error", e?.message || "No se pudo registrar el ajuste.", 5200);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const tipoInfo = TIPOS.find((t) => t.codigo === tipo) || TIPOS[0];
  const motivoLabel = motivos.find((m) => m.codigo === motivo)?.label || motivo;

  return createPortal(
    <div className="mi-mini__overlay fc-aj-overlay" role="presentation">
      <div
        className="mi-mini__modal fc-aj-modal fc-aj-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fc-aj-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-mini__head">
          <h4 id="fc-aj-title" className="mi-mini__title fc-aj-title">
            <FontAwesomeIcon icon={faScaleBalanced} />
            <span>{step === "confirm" ? "Confirmar ajuste de saldo" : "Ajustar saldo"}</span>
          </h4>
          <button type="button" className="mi-mini__close" onClick={() => !busy && onClose?.()} disabled={busy} aria-label="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-mini__body fc-aj-body">
          {loadError && (
            <div className="fc-aj-alert fc-aj-alert--error" role="alert">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{loadError}</span>
              <button type="button" className="fc-aj-link" onClick={() => cargarMedios()}>Reintentar</button>
            </div>
          )}
          {notice && (
            <div className="fc-aj-alert fc-aj-alert--warning" role="status">
              <FontAwesomeIcon icon={faTriangleExclamation} />
              <span>{notice}</span>
            </div>
          )}

          {step === "form" ? (
            <form
              className="fc-aj-form"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                handleRevisar();
              }}
            >
              <div className="gm-view-tabs fc-aj-typeTabs" role="tablist" aria-label="Tipo de ajuste">
                {TIPOS.map((t, index) => (
                  <button key={t.codigo} id={`fc-aj-tab-${t.codigo}`} type="button" role="tab"
                    aria-selected={tipo === t.codigo} aria-controls="fc-aj-type-panel"
                    tabIndex={tipo === t.codigo ? 0 : -1} disabled={busy}
                    className={`gm-view-tab ${tipo === t.codigo ? "is-active" : ""}`}
                    onClick={() => { setTipo(t.codigo); clearError("importe"); }}
                    onKeyDown={(event) => {
                      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
                      if (!keys.includes(event.key)) return;
                      event.preventDefault();
                      const next = event.key === "Home" ? 0 : event.key === "End" ? TIPOS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TIPOS.length) % TIPOS.length;
                      setTipo(TIPOS[next].codigo); clearError("importe");
                      document.getElementById(`fc-aj-tab-${TIPOS[next].codigo}`)?.focus();
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="fc-aj-editorGrid" id="fc-aj-type-panel" role="tabpanel" aria-labelledby={`fc-aj-tab-${tipo}`}>
                <div className="fc-aj-editorFields">
                  <h5 className="fc-aj-panelTitle"><span className="fc-aj-boxIcon" aria-hidden="true"><FontAwesomeIcon icon={faSliders} /></span><span>Datos del ajuste</span></h5>
              {/* A. Medio de pago */}
              <div className="fl-field">
                <select
                  id="fc-aj-medio"
                  ref={firstFieldRef}
                  className="fl-select fc-aj-select"
                  value={idMedio}
                  onChange={(e) => { setIdMedio(e.target.value); clearError("medio", "importe"); }}
                  disabled={loadingMedios || busy || !medios.length}
                  aria-invalid={Boolean(errors.medio)}
                >
                  {!medios.length && <option value="">{loadingMedios ? "Cargando…" : "Sin medios monetarios"}</option>}
                  {grupos.map((g) =>
                    g.medios.length > 1 ? (
                      <optgroup key={g.key} label={g.label}>
                        {g.medios.map((m) => (
                          <option key={m.id_medio_pago} value={m.id_medio_pago}>
                            {m.nombre}{m.activo ? "" : " (INACTIVO)"}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      g.medios.map((m) => (
                        <option key={m.id_medio_pago} value={m.id_medio_pago}>
                          {m.nombre}{m.activo ? "" : " (INACTIVO)"}
                        </option>
                      ))
                    )
                  )}
                </select>
                <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-medio">Caja / medio de pago</label>
                {errors.medio && <small className="fc-aj-error">{errors.medio}</small>}
              </div>
              {grupoSel && grupoSel.medios.length > 1 && (
                <p className="fc-aj-help">
                  La tarjeta {grupoSel.label} agrupa {grupoSel.medios.length} medios. El ajuste se aplica sólo a {medioSel?.nombre}.
                </p>
              )}

              {/* D. Importe */}
              <div className="fl-field">
                <div className="fc-aj-money">
                  <span aria-hidden="true">$</span>
                  <input
                    id="fc-aj-importe"
                    className="fl-input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder=" "
                    value={importeText}
                    onChange={(e) => { setImporteText(e.target.value.replace(/[^0-9.,]/g, "")); clearError("importe"); }}
                    disabled={busy}
                    aria-invalid={Boolean(errors.importe)}
                    aria-describedby="fc-aj-importe-hint"
                  />
                  <label className="fl-label" htmlFor="fc-aj-importe">{IMPORTE_LABEL[tipo]}</label>
                </div>
                <small id="fc-aj-importe-hint" className="fc-aj-hint">{tipoInfo.hint}</small>
                {errors.importe && <small className="fc-aj-error">{errors.importe}</small>}
              </div>

              {/* F. Motivo */}
              <div className="fl-field">
                <select
                  id="fc-aj-motivo"
                  className="fl-select fc-aj-select"
                  value={motivo}
                  onChange={(e) => { setMotivo(e.target.value); clearError("motivo", "observaciones"); }}
                  disabled={busy}
                  aria-invalid={Boolean(errors.motivo)}
                >
                  <option value="">Seleccionar…</option>
                  {motivos.map((m) => (
                    <option key={m.codigo} value={m.codigo}>{m.label}</option>
                  ))}
                </select>
                <label className="fl-label fc-aj-floatLabel" htmlFor="fc-aj-motivo">Motivo</label>
                {errors.motivo && <small className="fc-aj-error">{errors.motivo}</small>}
              </div>

              {/* G. Observaciones */}
              <div className="fl-field">
                <textarea
                  id="fc-aj-observaciones"
                  className="fl-input fc-aj-textarea"
                  placeholder=" "
                  maxLength={500}
                  rows={3}
                  value={observaciones}
                  onChange={(e) => { setObservaciones(e.target.value.toUpperCase()); clearError("observaciones"); }}
                  disabled={busy}
                  aria-invalid={Boolean(errors.observaciones)}
                />
                <label className="fl-label" htmlFor="fc-aj-observaciones">
                  Observaciones{motivo === "OTRO" ? " (obligatorio)" : ""}
                </label>
                {errors.observaciones && <small className="fc-aj-error">{errors.observaciones}</small>}
              </div>

                </div>
                <aside className="fc-aj-editorSummary" aria-label="Resumen del ajuste">
              {/* B. Saldo actual */}
              <div className="fc-aj-current" aria-live="polite">
                <span className="fc-aj-balanceHeading"><span className="fc-aj-boxIcon" aria-hidden="true"><FontAwesomeIcon icon={faWallet} /></span><span>Saldo actual{fechaNegocio ? ` al ${fmtDateES(fechaNegocio)}` : ""}</span></span>
                <strong className={signClass(Number(medioSel?.saldo_actual || 0)) === "is-negative" ? "is-negative" : ""}>
                  {loadingMedios ? "Calculando…" : medioSel ? moneyARS(medioSel.saldo_actual) : "—"}
                </strong>
              </div>

              {/* E. Vista previa automática */}
              <div className="fc-aj-preview" aria-live="polite" aria-label="Vista previa del ajuste">
                <h5 className="fc-aj-panelTitle"><span className="fc-aj-boxIcon" aria-hidden="true"><FontAwesomeIcon icon={faCalculator} /></span><span>Resumen del ajuste</span></h5>
                <div className="fc-aj-preview__row">
                  <span>Saldo actual</span>
                  <b>{medioSel ? moneyARS(medioSel.saldo_actual) : "—"}</b>
                </div>
                {tipo === "ESTABLECER" && (
                  <div className="fc-aj-preview__row">
                    <span>Saldo real ingresado</span>
                    <b>{importe == null ? "—" : moneyARS(importe)}</b>
                  </div>
                )}
                <div className="fc-aj-preview__row">
                  <span>Ajuste a registrar</span>
                  <b className={preview ? signClass(preview.diferencia) : ""} data-testid="fc-aj-diferencia">
                    {preview ? moneyARSSigned(preview.diferencia) : "—"}
                  </b>
                </div>
                <div className="fc-aj-preview__row fc-aj-preview__row--total">
                  <span>Nuevo saldo</span>
                  <b className={preview && preview.saldoNuevo < 0 ? "is-negative" : ""} data-testid="fc-aj-nuevo-saldo">
                    {preview ? moneyARS(preview.saldoNuevo) : "—"}
                  </b>
                </div>
                {preview && preview.saldoNuevo < 0 && (
                  <p className="fc-aj-previewWarn"><FontAwesomeIcon icon={faTriangleExclamation} /> El nuevo saldo quedará negativo.</p>
                )}
              </div>

                </aside>
              </div>
              <div className="mi-mini__actions fc-aj-actions">
                {onOpenHistorial && (
                  <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={onOpenHistorial} disabled={busy}>
                    <FontAwesomeIcon icon={faClockRotateLeft} /> Ver historial
                  </button>
                )}
                <button type="button" className="mit-btn mit-btn--ghost" onClick={() => !busy && onClose?.()} disabled={busy}>
                  Cancelar
                </button>
                <button type="submit" className="mit-btn mit-btn--solid" disabled={busy || loadingMedios || !medios.length}>
                  {checking ? "Verificando…" : "Confirmar ajuste"}
                </button>
              </div>
            </form>
          ) : (
            <div className="fc-aj-confirm">
              <p className="fc-aj-confirm__question">¿Registrar este ajuste de saldo?</p>
              <dl className="fc-aj-summary fc-aj-summary--cards">
                <div className="fc-aj-summary__card fc-aj-summary__card--medio">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCreditCard} /></span>
                  <div className="fc-aj-summary__content"><dt>Medio de pago</dt><dd>{confirmData?.medio?.nombre}</dd></div>
                </div>
                <div className="fc-aj-summary__card fc-aj-summary__card--tipo">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faSliders} /></span>
                  <div className="fc-aj-summary__content"><dt>Tipo</dt><dd>{tipoInfo.label.toUpperCase()}</dd></div>
                </div>
                <div className="fc-aj-summary__card fc-aj-summary__card--actual">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faWallet} /></span>
                  <div className="fc-aj-summary__content"><dt>Saldo actual</dt><dd className={signClass(Number(confirmData?.saldo_actual || 0))}>{moneyARS(confirmData?.saldo_actual)}</dd></div>
                </div>
                <div className={`fc-aj-summary__card fc-aj-summary__card--diferencia ${signClass(Number(confirmData?.diferencia || 0))}`}>
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faArrowRightArrowLeft} /></span>
                  <div className="fc-aj-summary__content">
                    <dt>Diferencia</dt>
                    <dd className={signClass(Number(confirmData?.diferencia || 0))} data-testid="fc-aj-confirm-diferencia">
                      {moneyARSSigned(confirmData?.diferencia)}
                    </dd>
                  </div>
                </div>
                <div className="fc-aj-summary__card fc-aj-summary__card--nuevo fc-aj-summary__total">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCoins} /></span>
                  <div className="fc-aj-summary__content"><dt>Nuevo saldo</dt><dd className={signClass(Number(confirmData?.saldo_nuevo || 0))} data-testid="fc-aj-confirm-nuevo">{moneyARS(confirmData?.saldo_nuevo)}</dd></div>
                </div>
                <div className="fc-aj-summary__card fc-aj-summary__card--motivo">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faFileLines} /></span>
                  <div className="fc-aj-summary__content"><dt>Motivo</dt><dd>{motivoLabel}</dd></div>
                </div>
                {observaciones.trim() && (
                  <div className="fc-aj-summary__card fc-aj-summary__card--observaciones fc-aj-summary__card--wide">
                    <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCommentDots} /></span>
                    <div className="fc-aj-summary__content"><dt>Observaciones</dt><dd>{observaciones.trim()}</dd></div>
                  </div>
                )}
                <div className="fc-aj-summary__card fc-aj-summary__card--fecha">
                  <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCalendarDays} /></span>
                  <div className="fc-aj-summary__content"><dt>Fecha</dt><dd>{fmtDateES(confirmData?.fecha_negocio || fechaNegocio)}</dd></div>
                </div>
              </dl>
              {(confirmData?.advertencias || []).map((a) => (
                <p key={a} className="fc-aj-previewWarn"><FontAwesomeIcon icon={faTriangleExclamation} /> {a}</p>
              ))}
              <div className="mi-mini__actions fc-aj-actions">
                <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={() => setStep("form")} disabled={submitting}>
                  <FontAwesomeIcon icon={faArrowLeft} /> Volver
                </button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={handleRegistrar} disabled={submitting} autoFocus>
                  {submitting ? "Registrando…" : "Registrar ajuste"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
