// BALTO Comercio · resolver diferencias del cierre.
// Dos operaciones distintas: conciliar (con el origen real de la diferencia)
// o aplicar un ajuste autorizado (corrige el saldo, NO concilia la diferencia).
// Los movimientos nunca se crean aquí: se eligen de los candidatos validados
// por la API y se previsualiza el efecto financiero antes de confirmar.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark, faHandshake, faTriangleExclamation, faArrowLeft, faRotateRight,
  faArrowUpRightFromSquare, faMagnifyingGlass, faScaleBalanced, faCircleCheck,
  faLandmark, faWallet, faCircleInfo,
} from "@fortawesome/free-solid-svg-icons";
import { APP_BASENAME } from "../../../config/config";
import {
  CierreApiError, conciliarDiferencia, nuevaClaveCierre, obtenerCandidatosConciliacion, previsualizarConciliacion,
} from "../api/flujoCajaCierresApi";
import { fmtDateES, formatMoneyInput, moneyARS, moneyARSSigned, parseMoneyInput, toApiAmount } from "../utils/flujoCajaUtils";
import { ESTADOS_DETALLE, TIPOS_RESOLUCION, previewConciliacionLocal, toCents } from "../utils/cierresUtils";
import ModalAplicarAjusteCierre from "./ModalAplicarAjusteCierre.jsx";

function signClass(n) { return Number(n) > 0.004 ? "is-positive" : Number(n) < -0.004 ? "is-negative" : "is-neutral"; }
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
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
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
    setError("");
    try {
      const j = await obtenerCandidatosConciliacion(detalle.id_cierre_detalle);
      setCandidatos(j.rows || []);
    } catch (e) { setCandidatos([]); setError(e?.message || "No se pudieron cargar las operaciones."); }
    finally { setCargandoCand(false); }
  }, [detalle]);

  useEffect(() => {
    if (!open || !detalle) return;
    setModo("conciliar");
    setTipo("MOVIMIENTO_REGISTRADO");
    setImporteText(formatMoneyInput(detalle.importe_pendiente));
    setObs(""); setSeleccion([]); setStep("form"); setPreview(null); setError("");
    setBusqueda(""); setFechaFiltro(""); setCandidatos([]);
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

  const toggle = (id) => {
    const next = seleccion.includes(id) ? seleccion.filter((x) => x !== id) : [...seleccion, id];
    const suma = candidatos.filter((c) => next.includes(c.id_movimiento_medio_pago)).reduce((s, c) => s + toCents(c.monto), 0);
    setSeleccion(next);
    setImporteText(next.length ? formatMoneyInput(Math.min(suma, toCents(importePendiente)) / 100) : "");
  };

  const cambiarTipo = (nuevo) => { setTipo(nuevo); setSeleccion([]); setError(""); setPreview(null); setImporteText(formatMoneyInput(importePendiente)); };

  const validar = () => {
    if (!tipoInfo) return "Seleccioná cómo se explica la diferencia.";
    if (importe == null || importe <= 0) return "Ingresá cuánto querés conciliar.";
    if (toCents(importe) > toCents(importePendiente)) return "El importe supera lo pendiente.";
    if (tipoInfo.requiereMovimientos && !seleccion.length) return "Seleccioná al menos un movimiento real que explique la diferencia.";
    if (tipoInfo.requiereMovimientos && toCents(totalSel) < toCents(importe)) return "Los movimientos seleccionados suman menos que el importe.";
    if (tipoInfo.obsMin && obs.trim().length < tipoInfo.obsMin) return `Explicá lo ocurrido (mínimo ${tipoInfo.obsMin} caracteres).`;
    if (local?.error) return local.error;
    return "";
  };

  const revisar = async (e) => {
    e?.preventDefault();
    const msg = validar(); setError(msg);
    if (msg) return;
    setChecking(true);
    try {
      const j = await previsualizarConciliacion({
        idDetalle: detalle.id_cierre_detalle, tipo, importe: toApiAmount(importe), observaciones: obs.trim(),
        ids: tipoInfo.requiereMovimientos ? seleccion : [],
      });
      setPreview(j.preview);
      claveRef.current = nuevaClaveCierre("cnc");
      setStep("confirm");
    } catch (err) { setError(err?.message || "No se pudo previsualizar la conciliación."); }
    finally { setChecking(false); }
  };

  const confirmar = async () => {
    if (submittingRef.current || !preview) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    try {
      const j = await conciliarDiferencia({
        id_cierre_detalle: detalle.id_cierre_detalle,
        tipo_resolucion: tipo,
        importe: toApiAmount(importe), observaciones: obs.trim() || null,
        ids_movimiento_medio_pago: tipoInfo.requiereMovimientos ? seleccion : [],
        pendiente_esperado: toApiAmount(preview.pendiente_anterior), clave_solicitud: claveRef.current,
      });
      showToast?.("exito", j.mensaje || "Conciliación registrada.", 3000);
      onSaved?.(j);
    } catch (err) {
      const codigo = err instanceof CierreApiError ? err.codigo : "";
      setError(err?.message || "No se pudo registrar la conciliación.");
      if (["CONCILIACION_DESACTUALIZADA", "MOVIMIENTO_YA_VINCULADO", "DIFERENCIA_YA_CONCILIADA"].includes(codigo)) {
        showToast?.("error", err.message, 4500); onSaved?.(null);
      }
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  if (!open || !detalle) return null;
  const busy = checking || submitting || adjusting;
  const accesos = sobrante
    ? [{ label: "Registrar venta", path: "/panel/ventas" }, { label: "Registrar otro ingreso", path: "/panel/Otrosingresos" }]
    : [{ label: "Registrar gasto", path: "/panel/Otrosegresos" }, { label: "Registrar compra", path: "/panel/compras" }];
  const estado = ESTADOS_DETALLE[detalle.estado_conciliacion] || { label: detalle.estado_conciliacion, tone: "pending" };

  return createPortal(
    <div className="mi-mini__overlay fc-aj-overlay fc-cc-overlay--top" role="presentation">
      <div className="mi-mini__modal fc-aj-modal fc-cc-modal fc-cc-modal--resolution" role="dialog" aria-modal="true" aria-labelledby="fc-cn-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi-mini__head">
          <h4 id="fc-cn-title" className="mi-mini__title fc-aj-title">
            <FontAwesomeIcon icon={detalle.clase_medio === "EFECTIVO" ? faWallet : faLandmark} />
            <span>Resolver diferencia · {medio}<small className="fc-cc-modal__subtitle">Cierre {cierre?.numero} · {fmtDateES(cierre?.fecha_operativa)}</small></span>
          </h4>
          <button type="button" className="mi-mini__close" onClick={() => !busy && onClose?.()} disabled={busy} aria-label="Cerrar"><FontAwesomeIcon icon={faXmark} /></button>
        </div>
        <div className="mi-mini__body fc-aj-body fc-cc-body fc-cc-resolution-body">
          <div className="fc-cc-resolution-stats">
            <div><span>Según BALTO</span><strong>{moneyARS(detalle.saldo_esperado)}</strong></div>
            <div><span>Verificado</span><strong>{moneyARS(detalle.saldo_verificado)}</strong></div>
            <div><span>Diferencia pendiente</span><strong className={signClass(detalle.diferencia)} data-testid="fc-cn-pendiente">{sobrante ? "+ " : "− "}{moneyARS(importePendiente)}</strong></div>
            <div><span>Estado</span><b className={`fc-cc-badge fc-cc-badge--${estado.tone}`}>{estado.label}</b></div>
          </div>

          {step === "form" && <>
            <div className="fc-cc-resolution-options" role="group" aria-label="¿Cómo querés resolver la diferencia?">
              <button type="button" className={`fc-cc-resolution-option ${modo === "conciliar" ? "is-active" : ""}`} onClick={() => { setModo("conciliar"); setError(""); }} disabled={busy} aria-pressed={modo === "conciliar"}>
                <span className="fc-cc-resolution-option__icon"><FontAwesomeIcon icon={faHandshake} /></span>
                <span><strong>Conciliar diferencia</strong><small>Encontraste la operación o el motivo. Registrá cómo se explica.</small></span>
                {modo === "conciliar" && <FontAwesomeIcon icon={faCircleCheck} className="fc-cc-resolution-option__check" />}
              </button>
              <button type="button" className={`fc-cc-resolution-option ${modo === "ajustar" ? "is-active" : ""}`} onClick={() => { setModo("ajustar"); setError(""); }} disabled={busy || !permiteAjuste} aria-pressed={modo === "ajustar"} title={!permiteAjuste ? "Esta diferencia ya tiene ajuste o no admite otro ajuste" : undefined}>
                <span className="fc-cc-resolution-option__icon"><FontAwesomeIcon icon={faScaleBalanced} /></span>
                <span><strong>Aplicar ajuste autorizado</strong><small>Corregí el saldo vigente. No significa que la diferencia esté conciliada.</small></span>
              </button>
            </div>
            {!permiteAjuste && <p className="fc-cc-resolution-tip">No se puede aplicar otro ajuste provisional a esta diferencia. Podés conciliar su origen desde la primera opción.</p>}
            {modo === "ajustar" && permiteAjuste ? (
              <ModalAplicarAjusteCierre embedded open detalle={detalle} cierre={cierre} onClose={() => setModo("conciliar")} onSaved={onSaved} onBusyChange={setAdjusting} showToast={showToast} />
            ) : modo === "conciliar" && (
              <form className="fc-cc-resolution-form" noValidate onSubmit={revisar}>
                <div className="fc-cc-resolution-form__intro">
                  <strong>Conciliar movimientos</strong>
                  <p>Buscá el {sobrante ? "cobro" : "pago"} que explica la diferencia. Si todavía no está registrado, cargalo primero en Movimientos.</p>
                </div>
                <label className="fc-cc-plainField fc-cc-resolution-reason">
                  <span>¿Cómo identificaste la diferencia?</span>
                  <select id="fc-cn-tipo" value={tipo} onChange={(e) => cambiarTipo(e.target.value)} disabled={busy}>
                    {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.label}</option>)}
                  </select>
                  {tipoInfo && !isMovement(tipo) && <small>{tipoInfo.ayuda}</small>}
                </label>

                {tipoInfo?.requiereMovimientos && <>
                  <div className="fc-cc-resolution-search">
                    <label><FontAwesomeIcon icon={faMagnifyingGlass} /><input aria-label="Buscar movimientos" placeholder="Buscar movimiento o contraparte…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} disabled={busy} /></label>
                    <label className="fc-cc-resolution-search__date"><span>Fecha</span><input type="date" aria-label="Filtrar movimientos por fecha" value={fechaFiltro} onChange={(e) => setFechaFiltro(e.target.value)} disabled={busy} /></label>
                    <button type="button" className="mit-btn mit-btn--ghost" onClick={cargarCandidatos} disabled={cargandoCand || busy} title="Actualizar movimientos" aria-label="Actualizar movimientos"><FontAwesomeIcon icon={faRotateRight} /></button>
                  </div>
                  <div className="fc-cc-resolution-main">
                    <div className="fc-cc-resolution-candidates" data-testid="fc-cn-candidatos">
                      <div className="fc-cc-resolution-candidate-head"><span>Movimiento real</span><span>Fecha</span><span>Importe</span></div>
                      {cargandoCand && <div className="fc-cc-empty">Buscando operaciones disponibles…</div>}
                      {!cargandoCand && !candidatosVisibles.length && <div className="fc-cc-empty">{candidatos.length ? "No hay movimientos con esos filtros." : "No encontramos movimientos que puedas vincular todavía."}</div>}
                      {candidatosVisibles.map((m) => <label key={m.id_movimiento_medio_pago} className="fc-cc-resolution-candidate">
                        <span className="fc-cc-resolution-candidate__name"><input type="checkbox" checked={seleccion.includes(m.id_movimiento_medio_pago)} onChange={() => toggle(m.id_movimiento_medio_pago)} disabled={busy} /><span><strong>{m.tipo_operacion || "Operación"} #{m.id_movimiento}</strong>{m.contraparte && <small>{m.contraparte}</small>}</span></span>
                        <span>{fmtDateES(m.fecha_pago)}</span><strong>{sobrante ? "+ " : "− "}{moneyARS(m.monto)}</strong>
                      </label>)}
                    </div>
                    <aside className="fc-cc-resolution-progress" aria-live="polite">
                      <span>Movimientos seleccionados</span><strong>{moneyARS(totalSel)}</strong>
                      <span>Pendiente después</span><strong>{local && !local.error ? moneyARS(local.pendientePosterior) : "—"}</strong>
                      <div><span>Estado resultante</span><b className={`fc-cc-badge fc-cc-badge--${local && !local.error && local.pendientePosterior === 0 ? "done" : "pending"}`}>{local && !local.error ? ESTADOS_DETALLE[local.estado]?.label : "Por revisar"}</b></div>
                    </aside>
                  </div>
                  <p className="fc-cc-resolution-tip"><FontAwesomeIcon icon={faCircleInfo} /> ¿Falta registrar una operación? {accesos.map((a, i) => <React.Fragment key={a.path}>{i > 0 && " · "}<a href={rutaPanel(a.path)} target="_blank" rel="noopener noreferrer">{a.label} <FontAwesomeIcon icon={faArrowUpRightFromSquare} /></a></React.Fragment>)}. Después actualizá la lista.</p>
                </>}
                <div className="fc-cc-resolution-fields">
                  <label className="fc-cc-plainField"><span>Importe a conciliar ($)</span><input id="fc-cn-importe" data-testid="fc-cn-importe" inputMode="decimal" autoComplete="off" value={importeText} onChange={(e) => setImporteText(e.target.value.replace(/[^0-9.,]/g, ""))} onBlur={() => { const n = parseMoneyInput(importeText); if (n != null) setImporteText(formatMoneyInput(n)); }} disabled={busy} /><small>Podés resolver solo una parte. El resto queda pendiente.</small></label>
                  <label className="fc-cc-plainField"><span>Observación {tipoInfo?.obsMin ? "(obligatoria)" : "(opcional)"}</span><textarea id="fc-cn-obs" maxLength={500} rows={2} value={obs} placeholder="¿Qué pasó con la diferencia?" onChange={(e) => setObs(e.target.value)} disabled={busy} /></label>
                </div>
                {local && !local.error && Boolean(local.compensacion) && <p className="fc-cc-resolution-tip">Se compensará {moneyARSSigned(local.compensacion)} del ajuste provisional para evitar duplicar el dinero.</p>}
                {isMovement(tipo) && toCents(totalSel) > toCents(importe || 0) && seleccion.length > 0 && <p className="fc-cc-resolution-tip fc-cc-resolution-tip--warn">Los movimientos seleccionados suman más que el importe conciliado: se vincularán completos y no podrán usarse en otra conciliación.</p>}
                {error && <div className="fc-aj-alert fc-aj-alert--error" role="alert" data-testid="fc-cn-error"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span></div>}
                <div className="fc-cc-resolution-footer">
                  <button type="button" className="mit-btn mit-btn--ghost" onClick={() => onClose?.()} disabled={busy}>Dejar pendiente</button>
                  <button type="submit" className="mit-btn mit-btn--solid" disabled={busy} data-testid="fc-cn-revisar">{checking ? "Calculando…" : "Revisar conciliación"}</button>
                </div>
              </form>
            )}
          </>}

          {step === "confirm" && preview && <section className="fc-cc-resolution-form" data-testid="fc-cn-preview">
            <div className="fc-cc-resolution-form__intro"><strong>Confirmar conciliación</strong><p>Revisá el efecto financiero antes de guardar. El cierre original siempre se conserva.</p></div>
            <dl className="fc-cc-resolution-stats fc-cc-resolution-stats--confirm">
              <div><dt>Motivo</dt><dd>{preview.tipo_label}</dd></div>
              <div><dt>Importe conciliado</dt><dd>{moneyARS(preview.importe)}</dd></div>
              <div><dt>Quedará pendiente</dt><dd>{moneyARS(preview.pendiente_posterior)}</dd></div>
              <div><dt>Estado final</dt><dd>{ESTADOS_DETALLE[preview.estado_resultante]?.label}</dd></div>
              <div><dt>Compensación del ajuste</dt><dd data-testid="fc-cn-compensacion">{preview.compensacion ? moneyARSSigned(preview.compensacion) : "No corresponde"}</dd></div>
              {preview.saldo_actual != null && <div><dt>Saldo actual → resultante</dt><dd>{moneyARS(preview.saldo_actual)} → {moneyARS(preview.saldo_resultante)}</dd></div>}
            </dl>
            <ul className="fc-cc-efecto">{(preview.efecto || []).map((t) => <li key={t}>{t}</li>)}</ul>
            {(preview.advertencias || []).map((a) => <p key={a} className="fc-cc-resolution-tip fc-cc-resolution-tip--warn"><FontAwesomeIcon icon={faTriangleExclamation} /> {a}</p>)}
            {error && <div className="fc-aj-alert fc-aj-alert--error" role="alert" data-testid="fc-cn-error"><FontAwesomeIcon icon={faTriangleExclamation} /><span>{error}</span></div>}
            <div className="fc-cc-resolution-footer">
              <button type="button" className="mit-btn mit-btn--ghost" onClick={() => { setStep("form"); setError(""); }} disabled={submitting}><FontAwesomeIcon icon={faArrowLeft} /> Volver</button>
              <button type="button" className="mit-btn mit-btn--solid" onClick={confirmar} disabled={submitting} data-testid="fc-cn-confirmar" autoFocus><FontAwesomeIcon icon={faCircleCheck} /> {submitting ? "Registrando…" : "Confirmar conciliación"}</button>
            </div>
          </section>}
        </div>
      </div>
    </div>, document.body
  );
}
