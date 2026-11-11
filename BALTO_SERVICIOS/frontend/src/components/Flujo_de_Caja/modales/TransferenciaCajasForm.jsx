// src/components/Flujo_de_Caja/modales/TransferenciaCajasForm.jsx
// Pestaña "Transferir entre cajas" del modal Ajustar saldo.
// Registra que el dueño movió dinero entre dos de sus cajas/billeteras por
// fuera de BALTO. Flujo: formulario con vista previa local (informativa) →
// vista previa autoritativa del backend → confirmación → registro. El modal
// se cierra sólo cuando el backend confirma la operación.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRightLong,
  faCalendarDays,
  faClockRotateLeft,
  faCommentDots,
  faArrowRightArrowLeft,
  faScaleBalanced,
  faTriangleExclamation,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import {
  AjusteApiError,
  crearTransferencia,
  nuevaClaveTransferencia,
  obtenerMediosTransferencia,
  previsualizarTransferencia,
} from "../api/flujoCajaAjustesApi";
import {
  computeTransferenciaPreview,
  fmtDateES,
  formatMoneyInput,
  moneyARS,
  parseMoneyInput,
  toApiAmount,
} from "../utils/flujoCajaUtils";

function groupMedios(medios) {
  const groups = new Map();
  medios.forEach((m) => {
    const key = m.grupo_key || `medio_${m.id_medio_pago}`;
    if (!groups.has(key)) groups.set(key, { key, label: m.grupo_label || m.nombre, medios: [] });
    groups.get(key).medios.push(m);
  });
  return Array.from(groups.values());
}

function optionLabel(m) {
  return `${m.nombre} · ${moneyARS(m.saldo_actual)}${m.activo ? "" : " (INACTIVO)"}`;
}

/** Selector agrupado como el de ajustes, con el saldo actual de cada medio. */
function MedioSelect({ id, value, onChange, medios, disabled, invalid, disabledId, selectRef, describedBy }) {
  const grupos = useMemo(() => groupMedios(medios), [medios]);
  const renderOption = (m) => (
    <option key={m.id_medio_pago} value={m.id_medio_pago} disabled={String(m.id_medio_pago) === String(disabledId)}>
      {optionLabel(m)}
    </option>
  );
  return (
    <select id={id} ref={selectRef} className="fl-select fc-aj-select" value={value} onChange={onChange}
      disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy}>
      <option value="">{medios.length ? "Seleccionar…" : "Sin medios disponibles"}</option>
      {grupos.map((g) => (g.medios.length > 1
        ? <optgroup key={g.key} label={g.label}>{g.medios.map(renderOption)}</optgroup>
        : g.medios.map(renderOption)))}
    </select>
  );
}

function SideCard({ rol, medio, actual, delta, posterior, testPrefix }) {
  const esOrigen = rol === "origen";
  return (
    <div className={`fc-tr-side fc-tr-side--${rol}`} data-testid={`${testPrefix}-card`}>
      <div className="fc-tr-side__head">
        <span className="fc-tr-side__rol">{esOrigen ? "Origen" : "Destino"}</span>
        <strong className="fc-tr-side__name" title={medio?.nombre || ""}>{medio?.nombre || "—"}</strong>
      </div>
      <div className="fc-aj-preview__row">
        <span>Saldo actual</span>
        <b data-testid={`${testPrefix}-actual`}>{medio ? moneyARS(actual) : "—"}</b>
      </div>
      <div className="fc-aj-preview__row">
        <span>{esOrigen ? "Se descuenta" : "Se acredita"}</span>
        <b className={esOrigen ? "is-negative" : "is-positive"} data-testid={`${testPrefix}-delta`}>
          {delta == null ? "—" : `${esOrigen ? "−" : "+"} ${moneyARS(Math.abs(delta))}`}
        </b>
      </div>
      <div className="fc-aj-preview__row fc-aj-preview__row--total">
        <span>Saldo posterior</span>
        <b className={posterior != null && posterior < 0 ? "is-negative" : ""} data-testid={`${testPrefix}-posterior`}>
          {posterior == null ? "—" : moneyARS(posterior)}
        </b>
      </div>
    </div>
  );
}

export default function TransferenciaCajasForm({ onBusyChange, onStepChange, onSaved, onClose, onOpenHistorial, showToast, tabs }) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [habilitado, setHabilitado] = useState(true);
  const [medios, setMedios] = useState([]);
  const [totalNegocio, setTotalNegocio] = useState(null);
  const [fechaNegocio, setFechaNegocio] = useState("");

  const [idOrigen, setIdOrigen] = useState("");
  const [idDestino, setIdDestino] = useState("");
  const [importeText, setImporteText] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [backendError, setBackendError] = useState("");

  const [step, setStep] = useState("form");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmData, setConfirmData] = useState(null);
  const claveRef = useRef("");
  const sendingRef = useRef(false);
  const firstFieldRef = useRef(null);
  const busy = checking || submitting;

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => { onStepChange?.(step); }, [step, onStepChange]);
  useEffect(() => () => { onBusyChange?.(false); onStepChange?.("form"); }, [onBusyChange, onStepChange]);

  const cargarMedios = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const json = await obtenerMediosTransferencia();
      const list = Array.isArray(json?.medios) ? json.medios : [];
      setMedios(list);
      setHabilitado(json?.habilitado !== false);
      setTotalNegocio(json?.total_negocio ?? null);
      setFechaNegocio(String(json?.fecha_negocio || ""));
      // Una selección que dejó de ser válida se limpia (nunca se reemplaza en silencio).
      setIdOrigen((cur) => (list.some((m) => String(m.id_medio_pago) === String(cur) && m.puede_origen) ? cur : ""));
      setIdDestino((cur) => (list.some((m) => String(m.id_medio_pago) === String(cur) && m.puede_destino) ? cur : ""));
      return list;
    } catch (e) {
      setLoadError(e?.message || "No se pudieron cargar las cajas.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarMedios(); }, [cargarMedios]);
  useEffect(() => { if (step === "form" && !loading) firstFieldRef.current?.focus?.(); }, [step, loading]);
  // Cualquier cambio en los datos invalida la clave de confirmación previa.
  useEffect(() => { claveRef.current = ""; }, [idOrigen, idDestino, importeText, observaciones]);

  const mediosOrigen = useMemo(() => medios.filter((m) => m.puede_origen), [medios]);
  const mediosDestino = useMemo(() => medios.filter((m) => m.puede_destino), [medios]);
  const origen = useMemo(() => medios.find((m) => String(m.id_medio_pago) === String(idOrigen)) || null, [medios, idOrigen]);
  const destino = useMemo(() => medios.find((m) => String(m.id_medio_pago) === String(idDestino)) || null, [medios, idDestino]);
  const importe = useMemo(() => parseMoneyInput(importeText), [importeText]);
  const preview = useMemo(
    () => (origen && destino && importe != null && importe > 0 ? computeTransferenciaPreview(origen.saldo_actual, destino.saldo_actual, importe) : null),
    [origen, destino, importe]
  );
  const mismoGrupo = Boolean(origen && destino && origen.grupo_key === destino.grupo_key);

  const clearError = (...keys) => {
    setBackendError("");
    setErrors((prev) => {
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      keys.forEach((k) => delete next[k]);
      return next;
    });
  };

  const validate = () => {
    const next = {};
    if (!origen) next.origen = "Seleccioná la caja de origen.";
    if (!destino) next.destino = "Seleccioná la caja de destino.";
    else if (origen && String(origen.id_medio_pago) === String(destino.id_medio_pago)) next.destino = "La caja de destino debe ser distinta de la caja de origen.";
    if (importeText.trim() === "" || importe == null) next.importe = "Ingresá un importe válido (hasta 2 decimales).";
    else if (importe <= 0) next.importe = "El importe debe ser mayor a cero.";
    else if (origen && Math.round(importe * 100) > Math.round(Number(origen.saldo_actual) * 100)) {
      next.importe = `El importe supera el saldo disponible en ${origen.nombre} (${moneyARS(origen.saldo_actual)}).`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /** Ubica el error del backend en el campo correspondiente (o como alerta general). */
  const mostrarErrorBackend = (e, fallback) => {
    const codigo = e instanceof AjusteApiError ? e.codigo : "";
    const msg = e?.message || fallback;
    const rol = e?.payload?.rol;
    if (codigo === "SALDO_INSUFICIENTE" || codigo === "IMPORTE_INVALIDO" || codigo === "IMPORTE_FUERA_DE_RANGO") setErrors({ importe: msg });
    else if (codigo === "MISMO_MEDIO" || codigo === "DESTINO_REQUERIDO" || rol === "destino") setErrors({ destino: msg });
    else if (codigo === "ORIGEN_REQUERIDO" || rol === "origen") setErrors({ origen: msg });
    else setBackendError(msg);
    showToast?.("error", msg, 5200);
  };

  const handleRevisar = async () => {
    setNotice("");
    setBackendError("");
    if (!validate()) return;
    setChecking(true);
    try {
      // Valores definitivos: los recalcula el backend con los saldos vigentes.
      const json = await previsualizarTransferencia({
        idMedioOrigen: origen.id_medio_pago,
        idMedioDestino: destino.id_medio_pago,
        importe: toApiAmount(importe),
      });
      const p = json?.preview;
      if (!p) throw new Error("No se pudo calcular la vista previa.");
      const cambio = [p.origen, p.destino].filter((srv) => {
        const local = medios.find((m) => m.id_medio_pago === srv.id_medio_pago);
        return local && Math.abs(Number(local.saldo_actual) - Number(srv.saldo_actual)) >= 0.005;
      });
      if (cambio.length) {
        setMedios((list) => list.map((m) => {
          const srv = cambio.find((c) => c.id_medio_pago === m.id_medio_pago);
          return srv ? { ...m, saldo_actual: srv.saldo_actual } : m;
        }));
        setNotice(`El saldo de ${cambio.map((c) => c.nombre).join(" y ")} cambió desde que abriste la transferencia. Revisá los valores actualizados.`);
      }
      if (!claveRef.current) claveRef.current = nuevaClaveTransferencia();
      setConfirmData(p);
      setStep("confirm");
    } catch (e) {
      if (e instanceof AjusteApiError && e.codigo === "TRANSFERENCIAS_NO_HABILITADAS") setHabilitado(false);
      mostrarErrorBackend(e, "No se pudo calcular la vista previa.");
    } finally {
      setChecking(false);
    }
  };

  const handleRegistrar = async () => {
    // Guardia síncrona: un doble clic nunca envía dos solicitudes.
    if (!confirmData || sendingRef.current) return;
    sendingRef.current = true;
    setSubmitting(true);
    setBackendError("");
    try {
      const json = await crearTransferencia({
        id_medio_origen: confirmData.origen.id_medio_pago,
        id_medio_destino: confirmData.destino.id_medio_pago,
        importe: toApiAmount(confirmData.importe),
        observaciones: observaciones.trim(),
        saldo_origen_esperado: toApiAmount(confirmData.origen.saldo_actual),
        saldo_destino_esperado: toApiAmount(confirmData.destino.saldo_actual),
        clave_solicitud: claveRef.current,
      });
      showToast?.("exito", json?.mensaje || "Transferencia registrada correctamente.", 3200);
      onSaved?.(json);
      onClose?.();
    } catch (e) {
      if (e instanceof AjusteApiError && e.codigo === "SALDO_DESACTUALIZADO") {
        // Otro movimiento cambió algún saldo: nunca se confirma con valores viejos.
        const nombres = (e.payload?.medios_cambiados || []).map((m) => m.nombre).filter(Boolean);
        await cargarMedios();
        setStep("form");
        setConfirmData(null);
        claveRef.current = "";
        setNotice(`El saldo de ${nombres.length ? nombres.join(" y ") : "una de las cajas"} cambió antes de confirmar. Se actualizaron los valores: revisá la vista previa y confirmá nuevamente.`);
        showToast?.("advertencia", e.message, 5200);
      } else {
        setBackendError(e?.message || "No se pudo registrar la transferencia.");
        showToast?.("error", e?.message || "No se pudo registrar la transferencia.", 5200);
      }
    } finally {
      sendingRef.current = false;
      setSubmitting(false);
    }
  };

  const alerts = (
    <>
      {loadError && (
        <div className="fc-aj-alert fc-aj-alert--error" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{loadError}</span>
          <button type="button" className="fc-aj-link" onClick={() => cargarMedios()}>Reintentar</button>
        </div>
      )}
      {!habilitado && (
        <div className="fc-aj-alert fc-aj-alert--warning" role="status">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>Las transferencias entre cajas todavía no están habilitadas para este comercio. Contactá al administrador del sistema.</span>
        </div>
      )}
      {notice && (
        <div className="fc-aj-alert fc-aj-alert--warning" role="status">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{notice}</span>
        </div>
      )}
      {backendError && (
        <div className="fc-aj-alert fc-aj-alert--error" role="alert" data-testid="fc-tr-backend-error">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{backendError}</span>
        </div>
      )}
    </>
  );

  if (step === "confirm" && confirmData) {
    const c = confirmData;
    return (
      <div className="fc-aj-confirm fc-tr-confirm">
        {alerts}
        <p className="fc-aj-confirm__question">¿Registrar esta transferencia entre cajas?</p>
        <div className="fc-tr-route" aria-label="Recorrido del dinero">
          <span data-testid="fc-tr-confirm-origen">{c.origen.nombre}</span>
          <FontAwesomeIcon icon={faArrowRightLong} aria-hidden="true" />
          <span data-testid="fc-tr-confirm-destino">{c.destino.nombre}</span>
          <strong data-testid="fc-tr-confirm-importe">{moneyARS(c.importe)}</strong>
        </div>
        <div className="fc-tr-sides">
          <SideCard rol="origen" medio={c.origen} actual={c.origen.saldo_actual} delta={-c.importe} posterior={c.origen.saldo_posterior} testPrefix="fc-tr-confirm-origen" />
          <SideCard rol="destino" medio={c.destino} actual={c.destino.saldo_actual} delta={c.importe} posterior={c.destino.saldo_posterior} testPrefix="fc-tr-confirm-destino" />
        </div>
        <dl className="fc-aj-summary fc-aj-summary--cards">
          <div className="fc-aj-summary__card fc-aj-summary__card--nuevo fc-aj-summary__total">
            <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faScaleBalanced} /></span>
            <div className="fc-aj-summary__content">
              <dt>Total del negocio</dt>
              <dd data-testid="fc-tr-confirm-total">Sin cambios · {moneyARS(c.total_negocio_actual)}</dd>
            </div>
          </div>
          <div className="fc-aj-summary__card fc-aj-summary__card--fecha">
            <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCalendarDays} /></span>
            <div className="fc-aj-summary__content"><dt>Fecha</dt><dd>{fmtDateES(c.fecha_negocio || fechaNegocio)}</dd></div>
          </div>
          {observaciones.trim() && (
            <div className="fc-aj-summary__card fc-aj-summary__card--observaciones fc-aj-summary__card--wide">
              <span className="fc-aj-summary__icon" aria-hidden="true"><FontAwesomeIcon icon={faCommentDots} /></span>
              <div className="fc-aj-summary__content"><dt>Observaciones</dt><dd>{observaciones.trim()}</dd></div>
            </div>
          )}
        </dl>
        {(c.advertencias || []).map((a) => (
          <p key={a} className="fc-aj-previewWarn"><FontAwesomeIcon icon={faTriangleExclamation} /> {a}</p>
        ))}
        <p className="fc-aj-help">No es un ingreso, egreso, venta ni compra: sólo se registra el dinero que ya moviste entre tus cajas.</p>
        <div className="mi-mini__actions fc-aj-actions">
          <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={() => { setStep("form"); setBackendError(""); }} disabled={submitting}>
            <FontAwesomeIcon icon={faArrowLeft} /> Volver
          </button>
          <button type="button" className="mit-btn mit-btn--solid" onClick={handleRegistrar} disabled={submitting} autoFocus>
            {submitting ? "Registrando…" : "Registrar transferencia"}
          </button>
        </div>
      </div>
    );
  }

  const disabledForm = busy || loading || !habilitado;

  return (
    <form className="fc-aj-form fc-tr-form" noValidate onSubmit={(e) => { e.preventDefault(); handleRevisar(); }}>
      {tabs}
      {alerts}
      <div className="fc-aj-editorGrid" id="fc-aj-type-panel" role="tabpanel" aria-labelledby="fc-aj-tab-TRANSFERIR">
        <div className="fc-aj-editorFields">
          <h5 className="fc-aj-panelTitle">
            <span className="fc-aj-boxIcon" aria-hidden="true"><FontAwesomeIcon icon={faArrowRightArrowLeft} /></span>
            <span>Datos de la transferencia</span>
          </h5>

          <div className="fl-field">
            <MedioSelect id="fc-tr-origen" selectRef={firstFieldRef} value={idOrigen} medios={mediosOrigen}
              disabledId={idDestino} disabled={disabledForm || !mediosOrigen.length} invalid={Boolean(errors.origen)}
              describedBy={errors.origen ? "fc-tr-origen-error" : undefined}
              onChange={(e) => {
                const v = e.target.value;
                setIdOrigen(v);
                // Nunca el mismo medio en ambos lados.
                if (v && v === idDestino) setIdDestino("");
                clearError("origen", "destino", "importe");
              }} />
            <label className="fl-label fc-aj-floatLabel" htmlFor="fc-tr-origen">Caja de origen</label>
            {errors.origen && <small id="fc-tr-origen-error" className="fc-aj-error">{errors.origen}</small>}
          </div>

          <div className="fl-field">
            <MedioSelect id="fc-tr-destino" value={idDestino} medios={mediosDestino}
              disabledId={idOrigen} disabled={disabledForm || !mediosDestino.length} invalid={Boolean(errors.destino)}
              describedBy={errors.destino ? "fc-tr-destino-error" : undefined}
              onChange={(e) => { setIdDestino(e.target.value); clearError("destino"); }} />
            <label className="fl-label fc-aj-floatLabel" htmlFor="fc-tr-destino">Caja de destino</label>
            {errors.destino && <small id="fc-tr-destino-error" className="fc-aj-error">{errors.destino}</small>}
          </div>
          {mismoGrupo && (
            <p className="fc-aj-help" data-testid="fc-tr-mismo-grupo">
              Ambas cajas se muestran en la tarjeta {origen.grupo_label}: el saldo de esa tarjeta no cambia, pero {origen.nombre} y {destino.nombre} se actualizan por separado.
            </p>
          )}

          <div className="fl-field">
            <div className="fc-aj-money">
              <span aria-hidden="true">$</span>
              <input id="fc-tr-importe" className="fl-input" inputMode="decimal" autoComplete="off" placeholder=" "
                value={importeText} disabled={disabledForm} aria-invalid={Boolean(errors.importe)}
                aria-describedby={errors.importe ? "fc-tr-importe-error fc-tr-importe-hint" : "fc-tr-importe-hint"}
                onChange={(e) => { setImporteText(e.target.value.replace(/[^0-9.,]/g, "")); clearError("importe"); }}
                onBlur={() => { if (importe != null && importe > 0) setImporteText(formatMoneyInput(importe)); }} />
              <label className="fl-label" htmlFor="fc-tr-importe">Importe a transferir</label>
            </div>
            <small id="fc-tr-importe-hint" className="fc-aj-hint">Formato argentino, hasta 2 decimales (ej.: 10.000,50).</small>
            {errors.importe && <small id="fc-tr-importe-error" className="fc-aj-error">{errors.importe}</small>}
          </div>

          <div className="fl-field">
            <textarea id="fc-tr-observaciones" className="fl-input fc-aj-textarea" placeholder=" " maxLength={500} rows={3}
              value={observaciones} disabled={disabledForm}
              onChange={(e) => { setObservaciones(e.target.value.toUpperCase()); clearError(); }} />
            <label className="fl-label" htmlFor="fc-tr-observaciones">Observaciones (opcional)</label>
          </div>
        </div>

        <aside className="fc-aj-editorSummary fc-tr-summary" aria-label="Vista previa de la transferencia" aria-live="polite">
          <h5 className="fc-aj-panelTitle">
            <span className="fc-aj-boxIcon" aria-hidden="true"><FontAwesomeIcon icon={faWallet} /></span>
            <span>Vista previa{fechaNegocio ? ` al ${fmtDateES(fechaNegocio)}` : ""}</span>
          </h5>
          <SideCard rol="origen" medio={origen} actual={origen?.saldo_actual} delta={preview ? -preview.importe : null}
            posterior={preview ? preview.origenPosterior : null} testPrefix="fc-tr-origen" />
          <SideCard rol="destino" medio={destino} actual={destino?.saldo_actual} delta={preview ? preview.importe : null}
            posterior={preview ? preview.destinoPosterior : null} testPrefix="fc-tr-destino" />
          <div className="fc-tr-total">
            <span>Total del negocio</span>
            <b data-testid="fc-tr-total">Sin cambios{totalNegocio != null ? ` · ${moneyARS(totalNegocio)}` : ""}</b>
          </div>
          {preview && !preview.suficiente && (
            <p className="fc-aj-previewWarn"><FontAwesomeIcon icon={faTriangleExclamation} /> El importe supera el saldo disponible del origen.</p>
          )}
          <p className="fc-aj-hint">Vista previa informativa: BALTO recalcula los saldos antes de registrar.</p>
        </aside>
      </div>

      <div className="mi-mini__actions fc-aj-actions">
        {onOpenHistorial && (
          <button type="button" className="mit-btn mit-btn--ghost fc-aj-actions__left" onClick={onOpenHistorial} disabled={busy}>
            <FontAwesomeIcon icon={faClockRotateLeft} /> Ver historial
          </button>
        )}
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => !busy && onClose?.()} disabled={busy}>Cancelar</button>
        <button type="submit" className="mit-btn mit-btn--solid" disabled={disabledForm || !medios.length}>
          {checking ? "Verificando…" : "Confirmar transferencia"}
        </button>
      </div>
    </form>
  );
}
