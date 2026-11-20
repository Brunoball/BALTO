// BALTO Comercio · resolver una diferencia del cierre.
// Dos opciones: conciliar (con el origen real de la diferencia) o aplicar un
// ajuste autorizado (corrige el saldo, NO concilia la diferencia).
// Pasos de cada opción: Datos → Confirmación → Resultado.
// Los movimientos nunca se crean aquí: se eligen de los candidatos validados
// por la API y se previsualiza el efecto financiero antes de confirmar.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHandshake, faTriangleExclamation, faArrowLeft,  faArrowUpRightFromSquare,
  faMagnifyingGlass, faScaleBalanced, faCircleCheck, faLandmark, faWallet, faCashRegister,
  faHourglassHalf, faListCheck,
} from "@fortawesome/free-solid-svg-icons";
import "./cierres_caja.css";
import { APP_BASENAME } from "../../../config/config";
import {
  CierreApiError, conciliarDiferencia, nuevaClaveCierre, obtenerCandidatosConciliacion, previsualizarConciliacion,
} from "../api/flujoCajaCierresApi";
import { fmtDateES, formatMoneyInput, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";
import { ESTADOS_DETALLE, TIPOS_RESOLUCION, previewConciliacionLocal, toCents } from "../utils/cierresUtils";
import ModalAplicarAjusteCierre from "./ModalAplicarAjusteCierre.jsx";
import { Badge, FieldMsg, MetaList, ModalShell, Stat, Steps, etiquetaDiferencia, toneOf } from "./FcModalParts.jsx";

const PASOS = ["Datos", "Confirmación", "Resultado"];
const PASO = { form: "Datos", confirm: "Confirmación", done: "Resultado" };

function rutaPanel(path) { return `${String(APP_BASENAME || "").replace(/\/+$/, "")}${path}`; }
const isMovement = (tipo) => tipo === "MOVIMIENTO_REGISTRADO";

export default function ModalConciliarDiferencia({ open, detalle, cierre, onClose, onSaved, showToast }) {
  const [modo, setModo] = useState("conciliar");
  const [tipo, setTipo] = useState("MOVIMIENTO_REGISTRADO");
  const [importeText, setImporteText] = useState("");
  const [obs, setObs] = useState("");
  const [candidatos, setCandidatos] = useState([]);
  const [cargandoCand, setCargandoCand] = useState(false);
  const [seleccion, setSeleccion] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [fechaFiltro, setFechaFiltro] = useState("");
  const [step, setStep] = useState("form");
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [ajusteStep, setAjusteStep] = useState("form");
  const [resultado, setResultado] = useState(null);
  const [footerSlot, setFooterSlot] = useState(null);
  const claveRef = useRef("");
  const submittingRef = useRef(false);

  const tipos = useMemo(() => TIPOS_RESOLUCION.filter((t) => !detalle || t.clases.includes(detalle.clase_medio)), [detalle]);
  const tipoInfo = tipos.find((t) => t.codigo === tipo);
  const sobrante = Number(detalle?.diferencia || 0) > 0;
  const importePendiente = Number(detalle?.importe_pendiente || 0);
  const permiteAjuste = Boolean(detalle?.puede_aplicar_ajuste);
  const medio = detalle?.medio_nombre || "la caja";

  const cargarCandidatos = useCallback(async () => {
    if (!detalle) return;
    setCargandoCand(true);
    setApiError("");
    try {
      const j = await obtenerCandidatosConciliacion(detalle.id_cierre_detalle);
      setCandidatos(j.rows || []);
    } catch (e) { setCandidatos([]); setApiError(e?.message || "No se pudieron cargar las operaciones."); }
    finally { setCargandoCand(false); }
  }, [detalle]);

  useEffect(() => {
    if (!open || !detalle) return;
    setModo("conciliar");
    setTipo("MOVIMIENTO_REGISTRADO");
    setImporteText(formatMoneyInput(detalle.importe_pendiente));
    setObs(""); setSeleccion([]); setStep("form"); setPreview(null); setErrors({}); setApiError("");
    setBusqueda(""); setFechaFiltro(""); setCandidatos([]); setResultado(null); setAjusteStep("form");
  }, [open, detalle]);

  useEffect(() => { if (open && modo === "conciliar" && isMovement(tipo)) cargarCandidatos(); }, [open, modo, tipo, cargarCandidatos]);

  const importe = parseMoneyInput(importeText);
  const totalSel = useMemo(() => candidatos.filter((c) => seleccion.includes(c.id_movimiento_medio_pago))
    .reduce((sum, c) => sum + toCents(c.monto), 0) / 100, [candidatos, seleccion]);
  const candidatosVisibles = useMemo(() => candidatos.filter((c) => {
    if (fechaFiltro && String(c.fecha_pago || "").slice(0, 10) !== fechaFiltro) return false;
    const q = busqueda.toLocaleLowerCase("es-AR").trim();
    if (!q) return true;
    return [c.tipo_operacion, c.id_movimiento, c.contraparte, c.monto, c.fecha_pago]
      .some((v) => String(v ?? "").toLocaleLowerCase("es-AR").includes(q));
  }), [candidatos, busqueda, fechaFiltro]);
  const local = useMemo(() => detalle && tipo && importe != null ? previewConciliacionLocal({
    diferencia: detalle.diferencia, conciliado: detalle.importe_conciliado,
    cubierto: Boolean(detalle.id_ajuste_saldo), tipo, importe,
  }) : null, [detalle, tipo, importe]);

  const limpiarError = (k) => setErrors((x) => (x[k] ? { ...x, [k]: "" } : x));

  const toggle = (id) => {
    const next = seleccion.includes(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id];
    const suma = candidatos.filter((c) => next.includes(c.id_movimiento_medio_pago)).reduce((s, c) => s + toCents(c.monto), 0);
    setSeleccion(next);
    setImporteText(next.length ? formatMoneyInput(Math.min(suma, toCents(importePendiente)) / 100) : "");
    limpiarError("movimientos");
    limpiarError("importe");
  };

  const cambiarTipo = (nuevo) => {
    setTipo(nuevo); setSeleccion([]); setErrors({}); setApiError(""); setPreview(null);
    setImporteText(formatMoneyInput(importePendiente));
  };

  const cambiarModo = (m) => { setModo(m); setErrors({}); setApiError(""); setAjusteStep("form"); };

  const validar = () => {
    const e = {};
    if (!tipoInfo) e.tipo = "Seleccioná cómo se explica la diferencia.";
    if (importe == null || importe <= 0) e.importe = "Ingresá cuánto querés conciliar.";
    else if (toCents(importe) > toCents(importePendiente)) e.importe = `Supera lo pendiente (${moneyARS(importePendiente)}).`;
    if (tipoInfo?.requiereMovimientos && !seleccion.length) e.movimientos = "Seleccioná al menos un movimiento que explique la diferencia.";
    else if (tipoInfo?.requiereMovimientos && importe != null && toCents(totalSel) < toCents(importe)) e.movimientos = "Los movimientos seleccionados suman menos que el importe.";
    if (tipoInfo?.obsMin && obs.trim().length < tipoInfo.obsMin) e.obs = `Explicá lo ocurrido (mínimo ${tipoInfo.obsMin} caracteres).`;
    if (!e.importe && !e.tipo && local?.error) {
      if (tipo === "DIFERENCIA_ACEPTADA") e.tipo = local.error; else e.importe = local.error;
    }
    return e;
  };

  const revisar = async (ev) => {
    ev?.preventDefault();
    const e = validar();
    setErrors(e);
    setApiError("");
    if (Object.values(e).some(Boolean)) return;
    setChecking(true);
    try {
      const j = await previsualizarConciliacion({
        idDetalle: detalle.id_cierre_detalle, tipo, importe: toApiAmount(importe), observaciones: obs.trim(),
        ids: tipoInfo.requiereMovimientos ? seleccion : [],
      });
      setPreview(j.preview);
      claveRef.current = nuevaClaveCierre("cnc");
      setStep("confirm");
    } catch (err) { setApiError(err?.message || "No se pudo previsualizar la conciliación."); }
    finally { setChecking(false); }
  };

  const confirmar = async () => {
    if (submittingRef.current || !preview) return;
    submittingRef.current = true; setSubmitting(true); setApiError("");
    try {
      const j = await conciliarDiferencia({
        id_cierre_detalle: detalle.id_cierre_detalle,
        tipo_resolucion: tipo,
        importe: toApiAmount(importe), observaciones: obs.trim() || null,
        ids_movimiento_medio_pago: tipoInfo.requiereMovimientos ? seleccion : [],
        pendiente_esperado: toApiAmount(preview.pendiente_anterior), clave_solicitud: claveRef.current,
      });
      setResultado(j);
      setStep("done");
      showToast?.("exito", j.mensaje || "Conciliación registrada.", 3000);
      onSaved?.(j);
    } catch (err) {
      const codigo = err instanceof CierreApiError ? err.codigo : "";
      setApiError(err?.message || "No se pudo registrar la conciliación.");
      if (["CONCILIACION_DESACTUALIZADA", "MOVIMIENTO_YA_VINCULADO", "DIFERENCIA_YA_CONCILIADA"].includes(codigo)) {
        // Los datos cambiaron: se recarga el detalle y se cierra para empezar de nuevo.
        showToast?.("error", err.message, 4500);
        onSaved?.(null);
        onClose?.();
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  if (!open || !detalle) return null;

  const busy = checking || submitting || adjusting;
  const accesos = sobrante
    ? [{ label: "Registrar venta", path: "/panel/ventas" }, { label: "Registrar otro ingreso", path: "/panel/Otrosingresos" }]
    : [{ label: "Registrar gasto", path: "/panel/Otrosegresos" }, { label: "Registrar compra", path: "/panel/compras" }];
  const estado = ESTADOS_DETALLE[detalle.estado_conciliacion] || { label: detalle.estado_conciliacion, tone: "pending" };
  const enFormulario = (modo === "conciliar" && step === "form") || (modo === "ajustar" && ajusteStep === "form");

  const detRes = resultado?.detalles?.find((d) => d.id_cierre_detalle === detalle.id_cierre_detalle);
  const pendRes = Number(detRes?.importe_pendiente ?? preview?.pendiente_posterior ?? 0);
  const estadoRes = ESTADOS_DETALLE[detRes?.estado_conciliacion || preview?.estado_resultante] || { label: "—", tone: "muted" };

  let footer;
  if (modo === "ajustar") {
    footer = <div className="fc-md-footerSlot" ref={setFooterSlot} />;
  } else if (step === "form") {
    footer = (
      <>
        <div className="fc-md-footer__start"><Steps labels={PASOS} current={PASO.form} /></div>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={busy}>Cancelar</button>
        <button type="submit" form="fc-cn-form" className="mit-btn mit-btn--solid" disabled={busy} data-testid="fc-cn-revisar">
          {checking ? "Calculando…" : "Revisar conciliación"}
        </button>
      </>
    );
  } else if (step === "confirm") {
    footer = (
      <>
        <div className="fc-md-footer__start"><Steps labels={PASOS} current={PASO.confirm} /></div>
        <button type="button" className="mit-btn mit-btn--ghost" onClick={() => { setStep("form"); setApiError(""); }} disabled={submitting}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver
        </button>
        <button type="button" className="mit-btn mit-btn--solid" onClick={confirmar} disabled={submitting} data-testid="fc-cn-confirmar" autoFocus>
          <FontAwesomeIcon icon={faCircleCheck} /> {submitting ? "Registrando…" : "Confirmar conciliación"}
        </button>
      </>
    );
  } else {
    footer = (
      <>
        <div className="fc-md-footer__start"><Steps labels={PASOS} current={PASO.done} /></div>
        <button type="button" className="mit-btn mit-btn--solid" onClick={() => onClose?.()} autoFocus>Listo</button>
      </>
    );
  }

  return (
    <ModalShell
      open
      titleId="fc-cn-title"
      title={`Resolver diferencia · ${medio}`}
      icon={detalle.clase_medio === "EFECTIVO" ? faWallet : faLandmark}
      onClose={onClose}
      closeDisabled={busy}
      size="lg"
      overlayClassName="fc-md-overlay--top"
      className="fc-md-modal--fixed fc-cc-modal fc-cn-modal"
      footer={footer}
    >
      <MetaList items={[
        { label: "Cierre", value: cierre?.numero || "—" },
        { label: "Fecha", value: fmtDateES(cierre?.fecha_operativa) },
        { label: "Caja", value: detalle.clase_medio === "EFECTIVO" ? "Efectivo" : "Banco / billetera" },
        { label: "Estado", value: <Badge tone={estado.tone}>{estado.label}</Badge> },
      ]} />

      {enFormulario && <>
        <div className="fc-md-stats fc-md-stats--3" aria-label="Diferencia a resolver">
          <Stat icon={faCashRegister} label="Según BALTO" value={moneyARS(detalle.saldo_esperado)} />
          <Stat icon={faWallet} label="Verificado" value={moneyARS(detalle.saldo_verificado)} />
          <Stat icon={faScaleBalanced} highlight label="Diferencia pendiente" testId="fc-cn-pendiente"
            value={`${sobrante ? "+ " : "− "}${moneyARS(importePendiente)}`}
            tone={sobrante ? "info" : "neg"} tag={etiquetaDiferencia(detalle.diferencia)} />
        </div>

        <div className="fc-md-options" role="group" aria-label="Cómo resolver la diferencia">
          <button type="button" className={`fc-md-option ${modo === "conciliar" ? "is-active" : ""}`} onClick={() => cambiarModo("conciliar")} disabled={busy} aria-pressed={modo === "conciliar"}>
            <span className="fc-md-option__icon"><FontAwesomeIcon icon={faHandshake} /></span>
            <span className="fc-md-option__text"><strong>Conciliar movimiento</strong><small>Registrá el origen de la diferencia</small></span>
            {modo === "conciliar" && <FontAwesomeIcon icon={faCircleCheck} className="fc-md-option__check" />}
          </button>
          <button type="button" className={`fc-md-option ${modo === "ajustar" ? "is-active" : ""}`} onClick={() => cambiarModo("ajustar")} disabled={busy || !permiteAjuste} aria-pressed={modo === "ajustar"}>
            <span className="fc-md-option__icon"><FontAwesomeIcon icon={faScaleBalanced} /></span>
            <span className="fc-md-option__text"><strong>Aplicar ajuste</strong><small>Corregí el saldo sin conciliar</small></span>
            {modo === "ajustar" && <FontAwesomeIcon icon={faCircleCheck} className="fc-md-option__check" />}
          </button>
        </div>
        {!permiteAjuste && <p className="fc-md-note">No se puede aplicar otro ajuste provisional a esta diferencia.</p>}
      </>}

      {modo === "ajustar" && permiteAjuste && (
        <ModalAplicarAjusteCierre
          embedded open detalle={detalle} cierre={cierre}
          footerTarget={footerSlot}
          onClose={() => onClose?.()}
          onDone={() => onClose?.()}
          onSaved={onSaved}
          onBusyChange={setAdjusting}
          onStepChange={setAjusteStep}
          showToast={showToast}
        />
      )}

      {modo === "conciliar" && step === "form" && (
        <form id="fc-cn-form" className="fc-md-panel" noValidate onSubmit={revisar}>
          <div className="fc-md-grid2">
            <div>
              <div className="fl-field fc-md-fl">
                <select id="fc-cn-tipo" className="fl-select" value={tipo} onChange={(e) => cambiarTipo(e.target.value)} disabled={busy}
                  aria-invalid={Boolean(errors.tipo)} aria-describedby="fc-cn-tipo-msg">
                  {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.label}</option>)}
                </select>
                <label className="fl-label" htmlFor="fc-cn-tipo">Cómo se explica</label>
              </div>
              <FieldMsg id="fc-cn-tipo-msg" error={errors.tipo} hint={tipoInfo && !isMovement(tipo) ? tipoInfo.ayuda : ""} />
            </div>
          </div>

          {tipoInfo?.requiereMovimientos && (
            <div className="fc-md-section">
              <div className="fc-cn-search">
                <div className="fl-field fc-md-fl fc-md-fl--search">
                  <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                  <input id="fc-cn-buscar" className="fl-input" placeholder=" " value={busqueda} onChange={(e) => setBusqueda(e.target.value)} disabled={busy} />
                  <label className="fl-label" htmlFor="fc-cn-buscar">Buscar movimiento o contraparte</label>
                </div>
                <div className="fl-field fc-md-fl">
                  <input id="fc-cn-fecha" type="date" className="fl-input" placeholder=" " value={fechaFiltro} onChange={(e) => setFechaFiltro(e.target.value)} disabled={busy} />
                  <label className="fl-label" htmlFor="fc-cn-fecha">Fecha</label>
                </div>
              </div>
              <div className="fc-cn-main">
                <div className="fc-md-table fc-md-table--static fc-cn-candidates" role="table" aria-label="Movimientos disponibles" data-testid="fc-cn-candidatos">
                  <div className="mov-gridTable fc-md-tableHead fc-md-tr" role="row">
                    <div className="mov-gridCell--head" role="columnheader">Movimiento</div>
                    <div className="mov-gridCell--head" role="columnheader">Fecha</div>
                    <div className="mov-gridCell--head is-right" role="columnheader">Importe</div>
                  </div>
                  <div className="fc-md-tbody" role="rowgroup">
                    {cargandoCand && <div className="fc-md-empty"><span>Buscando operaciones…</span></div>}
                    {!cargandoCand && !candidatosVisibles.length && (
                      <div className="fc-md-empty"><span>{candidatos.length ? "No hay movimientos con esos filtros." : "No hay movimientos para vincular todavía."}</span></div>
                    )}
                    {!cargandoCand && candidatosVisibles.map((m) => {
                      const sel = seleccion.includes(m.id_movimiento_medio_pago);
                      return (
                        <label key={m.id_movimiento_medio_pago} className={`mov-gridTable fc-md-row fc-md-tr fc-cn-candidate ${sel ? "is-selected" : ""}`} role="row">
                          <span className="mov-gridCell fc-cn-candidate__name" role="cell">
                            <input type="checkbox" checked={sel} onChange={() => toggle(m.id_movimiento_medio_pago)} disabled={busy} />
                            <span className="fc-md-cell--stack" style={{ display: "flex", minWidth: 0 }}>
                              <b className="fc-md-ellipsis">{m.tipo_operacion || "Operación"} #{m.id_movimiento}</b>
                              {m.contraparte && <small className="fc-md-ellipsis">{m.contraparte}</small>}
                            </span>
                          </span>
                          <span className="mov-gridCell fc-cn-candidate__date" role="cell"><span className="fc-md-num">{fmtDateES(m.fecha_pago)}</span></span>
                          <span className="mov-gridCell is-right" role="cell">
                            <span className={`fc-md-num ${sobrante ? "fc-md-num--sobrante" : "fc-md-num--faltante"}`}>{sobrante ? "+ " : "− "}{moneyARS(m.monto)}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="fc-md-stats" aria-live="polite">
                  <Stat icon={faListCheck} label="Movimientos seleccionados" value={moneyARS(totalSel)} />
                  <Stat icon={faHourglassHalf} label="Pendiente después" value={local && !local.error ? moneyARS(local.pendientePosterior) : "—"}
                    tone={local && !local.error ? (local.pendientePosterior === 0 ? "ok" : "warn") : "muted"}
                    tag={local && !local.error ? ESTADOS_DETALLE[local.estado]?.label : undefined} />
                </div>
              </div>
              <FieldMsg error={errors.movimientos} />
              <p className="fc-md-note">
                <span>¿No está registrado?</span>
                {accesos.map((a) => (
                  <a key={a.path} href={rutaPanel(a.path)} target="_blank" rel="noopener noreferrer">
                    {a.label} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                  </a>
                ))}
              </p>
            </div>
          )}

          <div className="fc-md-grid2">
            <div>
              <div className="fl-field fc-md-fl fc-md-fl--money">
                <input id="fc-cn-importe" data-testid="fc-cn-importe" className="fl-input" inputMode="decimal" autoComplete="off" placeholder=" "
                  value={importeText} aria-invalid={Boolean(errors.importe)} aria-describedby="fc-cn-importe-msg"
                  onChange={(e) => { setImporteText(e.target.value.replace(/[^0-9.,]/g, "")); limpiarError("importe"); }}
                  onBlur={() => { const n = parseMoneyInput(importeText); if (n != null) setImporteText(formatMoneyInput(n)); }}
                  disabled={busy} />
                <label className="fl-label" htmlFor="fc-cn-importe">Importe a conciliar</label>
              </div>
              <FieldMsg id="fc-cn-importe-msg" error={errors.importe} hint="Podés conciliar una parte; el resto queda pendiente." />
            </div>
            <div>
              <div className="fl-field fc-md-fl">
                <textarea id="fc-cn-obs" className="fl-input" maxLength={500} rows={2} placeholder=" " value={obs}
                  aria-invalid={Boolean(errors.obs)} aria-describedby="fc-cn-obs-msg"
                  onChange={(e) => { setObs(e.target.value); limpiarError("obs"); }} disabled={busy} />
                <label className="fl-label" htmlFor="fc-cn-obs">Observación {tipoInfo?.obsMin ? "(obligatoria)" : "(opcional)"}</label>
              </div>
              <FieldMsg id="fc-cn-obs-msg" error={errors.obs} />
            </div>
          </div>

          {local && !local.error && Boolean(local.compensacion) && (
            <p className="fc-md-note fc-md-note--warn"><FontAwesomeIcon icon={faTriangleExclamation} /><span>Se compensará {moneyARSSigned(local.compensacion)} del ajuste provisional para no duplicar el dinero.</span></p>
          )}
          {isMovement(tipo) && seleccion.length > 0 && toCents(totalSel) > toCents(importe || 0) && (
            <p className="fc-md-note fc-md-note--warn"><FontAwesomeIcon icon={faTriangleExclamation} /><span>Los movimientos suman más que el importe: se vinculan completos y no podrán usarse en otra conciliación.</span></p>
          )}
          {apiError && <div className="fc-md-alert fc-md-alert--error" role="alert" data-testid="fc-cn-error"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{apiError}</span></div>}
        </form>
      )}

      {modo === "conciliar" && step === "confirm" && preview && (
        <section className="fc-md-panel" data-testid="fc-cn-preview">
          <div className="fc-md-stats fc-md-stats--3" aria-label="Conciliación">
            <Stat icon={faScaleBalanced} label="Pendiente actual" value={moneyARS(preview.pendiente_anterior)} />
            <Stat icon={faHandshake} label="A conciliar" value={moneyARS(preview.importe)} tone="info" />
            <Stat icon={Number(preview.pendiente_posterior) > 0.004 ? faHourglassHalf : faCircleCheck} highlight label="Quedará pendiente"
              value={moneyARS(preview.pendiente_posterior)} tone={Number(preview.pendiente_posterior) > 0.004 ? "warn" : "ok"}
              tag={ESTADOS_DETALLE[preview.estado_resultante]?.label} />
          </div>
          {preview.saldo_actual != null ? (
            <section className="fc-md-section" aria-label={`Efecto en el saldo de ${medio}`}>
              <h5 className="fc-md-section__title">Efecto en el saldo de {medio}</h5>
              <div className="fc-md-stats fc-md-stats--3">
                <Stat icon={faWallet} label="Saldo actual" value={moneyARS(preview.saldo_actual)} />
                <Stat icon={faScaleBalanced} label="Compensación del ajuste" testId="fc-cn-compensacion"
                  value={preview.compensacion ? moneyARSSigned(preview.compensacion) : "No corresponde"}
                  tone={preview.compensacion ? (toneOf(preview.compensacion) === "neg" ? "neg" : "info") : "muted"} />
                <Stat icon={faCircleCheck} label="Saldo resultante" value={moneyARS(preview.saldo_resultante)} />
              </div>
            </section>
          ) : (
            <MetaList items={[{ label: "Compensación del ajuste", value: preview.compensacion ? moneyARSSigned(preview.compensacion) : "No corresponde", testId: "fc-cn-compensacion" }]} />
          )}
          <MetaList items={[
            { label: "Motivo", value: preview.tipo_label },
            seleccion.length > 0 && isMovement(tipo) && { label: "Movimientos", value: seleccion.length },
            obs.trim() && { label: "Observación", value: obs.trim(), wide: true },
          ]} />
          {(preview.efecto || []).length > 0 && (
            <ul className="fc-md-lines" aria-label="Efecto contable">
              {preview.efecto.map((t) => <li key={t}><span>{t}</span></li>)}
            </ul>
          )}
          {(preview.advertencias || []).map((a) => (
            <div key={a} className="fc-md-alert fc-md-alert--warning" role="status"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{a}</span></div>
          ))}
          {apiError && <div className="fc-md-alert fc-md-alert--error" role="alert" data-testid="fc-cn-error"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{apiError}</span></div>}
        </section>
      )}

      {modo === "conciliar" && step === "done" && (
        <section className="fc-md-panel" data-testid="fc-cn-done">
          <div className="fc-md-result">
            <span className="fc-md-result__icon"><FontAwesomeIcon icon={faCircleCheck} /></span>
            <div className="fc-md-result__text">
              <strong>Conciliación registrada</strong>
              <span>{medio} · {estadoRes.label}</span>
            </div>
          </div>
          <div className="fc-md-stats fc-md-stats--3">
            <Stat icon={faHandshake} label="Conciliado" value={moneyARS(preview?.importe)} tone="info" />
            <Stat icon={faScaleBalanced} label="Compensación del ajuste" value={preview?.compensacion ? moneyARSSigned(preview.compensacion) : "No corresponde"} tone="muted" />
            <Stat icon={pendRes > 0.004 ? faHourglassHalf : faCircleCheck} highlight label="Pendiente restante" value={moneyARS(pendRes)}
              tone={pendRes > 0.004 ? "warn" : "ok"} tag={estadoRes.label} />
          </div>
        </section>
      )}
    </ModalShell>
  );
}
