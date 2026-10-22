import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faTriangleExclamation, faXmark, faArrowRight, faMoneyBillTrendUp, faCalendarXmark, faClock, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { listarAlertasVencimientoStock, obtenerRevisionPreciosPendienteStock } from "../api/stockApi";
import { isTopStockModal } from "../modales/modalStackUtils";
import "./alertasVencimientos.css";

const fechaLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
};
const mostrarFecha = (raw) => {
  const date = String(raw || "").slice(0, 10);
  return /^\d{4}-\d\d-\d\d$/.test(date) ? `${date.slice(8)}/${date.slice(5,7)}/${date.slice(0,4)}` : date;
};
const cantidad = (n) => Number(n || 0).toLocaleString("es-AR", {maximumFractionDigits:3});
const coeficiente = (n) => Number(n || 0).toLocaleString("es-AR", {minimumFractionDigits:4,maximumFractionDigits:4});
function sessionScope() {
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const t = u?.idTenant ?? u?.id_tenant ?? u?.tenant_id ?? u?.tenant?.idTenant ?? "comercio";
    const id = u?.idUsuarioMaster ?? u?.id_usuario_master ?? u?.idUsuario ?? "usuario";
    return `${t}:${id}`;
  } catch { return "actual"; }
}

export default function AlertasVencimientos() {
  const navigate = useNavigate();
  const location = useLocation();
  const [alertas, setAlertas] = useState([]);
  const [revision, setRevision] = useState(null);
  const [abierto, setAbierto] = useState(false);
  const [errores, setErrores] = useState({});
  const [consultado, setConsultado] = useState(false);
  const [vencimientoSeleccionadoId, setVencimientoSeleccionadoId] = useState(null);
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  const refresh = useCallback(async () => {
    const [venc, precios] = await Promise.allSettled([
      listarAlertasVencimientoStock(7), obtenerRevisionPreciosPendienteStock({ _: Date.now() }),
    ]);
    const nuevosErrores = {};
    let rows = [];
    let nuevaRevision = null;
    if (venc.status === "fulfilled") {
      rows = Array.isArray(venc.value?.alertas) ? venc.value.alertas : [];
      setAlertas(rows);
    } else nuevosErrores.vencimientos = "No se pudieron consultar los vencimientos.";
    if (precios.status === "fulfilled") {
      const respuesta = precios.value;
      nuevaRevision = respuesta?.revision ?? respuesta?.data?.revision ?? null;
      setRevision(nuevaRevision);
    } else nuevosErrores.precios = "No se pudo consultar la revisión de precios.";
    setErrores(nuevosErrores);
    setConsultado(true);

    // Mostrar una sola apertura por día para vencimientos, y por ID de revisión
    // para precios. Al retirar parcialmente stock no debe reaparecer encima del
    // usuario con cada cambio de cantidad; la campanita sí se actualiza.
    if (!rows.length && !nuevaRevision) return;
    const base = `balto:notificaciones:${sessionScope()}`;
    const vencKey = `${base}:vencimientos:${fechaLocal()}`;
    const revKey = nuevaRevision?.id_revision ? `${base}:revision:${nuevaRevision.id_revision}` : null;
    try {
      const verVenc = rows.length > 0 && venc.status === "fulfilled" && !sessionStorage.getItem(vencKey);
      const verRev = revKey && precios.status === "fulfilled" && !sessionStorage.getItem(revKey);
      if (verVenc || verRev) {
        if (verVenc) sessionStorage.setItem(vencKey, "1");
        if (verRev) sessionStorage.setItem(revKey, "1");
        setAbierto(true);
      }
    } catch { /* La campanita sigue disponible aun sin sessionStorage. */ }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 2 * 60 * 1000);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("balto:stock-vencimientos-cambio", refresh);
    window.addEventListener("balto:listas-updated", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("balto:stock-vencimientos-cambio", refresh);
      window.removeEventListener("balto:listas-updated", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    if (!abierto) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const handleKeys = (event) => {
      if (!isTopStockModal(overlayRef.current)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        setAbierto(false);
      } else if (event.key === "Tab" && dialogRef.current) {
        const elements = Array.from(dialogRef.current.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'));
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeys, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeys, true);
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, [abierto]);

  const total = alertas.length + (revision ? 1 : 0);
  const vencidos = useMemo(() => alertas.filter(v => Number(v.dias_restantes) < 0).length, [alertas]);
  // Si hay varias partidas, el botón del pie gestiona la seleccionada.
  // Con una sola partida funciona directamente, sin exigir interacción extra.
  const partidaSeleccionada = useMemo(() =>
    alertas.find(v => String(v.id_vencimiento) === String(vencimientoSeleccionadoId)) || alertas[0] || null,
    [alertas, vencimientoSeleccionadoId]
  );
  const verPartida = (partida) => {
    setAbierto(false);
    navigate("/panel/stock", {state:{baltoStockDestino:{productoId:Number(partida.id_stock_producto),varianteId:Number(partida.id_stock_variante || 0),tab:"vencimientos",ts:Date.now()}}});
  };
  const verPrecios = () => {
    setAbierto(false);
    // El aviso de reajuste de Stock conserva sus botones de Aplicar/No aplicar.
    if (location.pathname !== "/panel/stock") navigate("/panel/stock");
  };

  return <>
    <button type="button" className={`pp-themeBtn sv-bell ${total ? "sv-bell--active" : ""}`}
      aria-label={`Notificaciones de Stock${total ? `: ${total}` : ""}`}
      aria-haspopup="dialog" aria-expanded={abierto}
      title="Notificaciones: vencimientos y revisiones de precios"
      onClick={() => { setAbierto(true); refresh(); }}>
      <FontAwesomeIcon icon={faBell} />{total > 0 && <span className="sv-bell-count">{total > 99 ? "99+" : total}</span>}
    </button>
    {abierto && createPortal(
      <div ref={overlayRef} data-stock-modal-overlay="true" className="mi-modal__overlay sv-alert-backdrop"
        onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <section ref={dialogRef} className="mi-modal__container sv-alert-dialog" role="dialog" aria-modal="true" aria-labelledby="sv-alert-title" aria-describedby="sv-alert-subtitle">
          <header className="mi-modal__header sv-alert-header">
            <div className="mi-modal__head-icon" aria-hidden="true"><FontAwesomeIcon icon={faBell}/></div>
            <div className="mi-modal__head-left">
              <h2 id="sv-alert-title" className="mi-modal__title">Notificaciones de Stock</h2>
              <p id="sv-alert-subtitle" className="mi-modal__subtitle">Vencimientos y revisiones de precios pendientes.</p>
            </div>
            <button ref={closeRef} type="button" className="mi-modal__close" aria-label="Cerrar notificaciones" onClick={() => setAbierto(false)}><FontAwesomeIcon icon={faXmark}/></button>
          </header>
          <div className="sv-alert-body">
            <div className="sv-alert-summary" aria-label="Resumen de notificaciones">
              <div className="sv-alert-stat sv-alert-stat--expired">
                <span className="sv-alert-stat__icon" aria-hidden="true"><FontAwesomeIcon icon={faCalendarXmark}/></span>
                <div className="sv-alert-stat__body"><span className="sv-alert-stat__label">Vencidos</span><strong className="sv-alert-stat__value">{vencidos}</strong></div>
              </div>
              <div className="sv-alert-stat sv-alert-stat--soon">
                <span className="sv-alert-stat__icon" aria-hidden="true"><FontAwesomeIcon icon={faClock}/></span>
                <div className="sv-alert-stat__body"><span className="sv-alert-stat__label">Próximos a vencer</span><strong className="sv-alert-stat__value">{alertas.length - vencidos}</strong></div>
              </div>
              <div className="sv-alert-stat sv-alert-stat--pricing">
                <span className="sv-alert-stat__icon" aria-hidden="true"><FontAwesomeIcon icon={faMoneyBillTrendUp}/></span>
                <div className="sv-alert-stat__body"><span className="sv-alert-stat__label">Revisión de precios</span><strong className="sv-alert-stat__value">{revision ? 1 : 0}</strong></div>
              </div>
            </div>
            {alertas.length > 1 && <p className="sv-alert-selection-hint">Seleccioná una partida para gestionar su vencimiento.</p>}
            <div className="sv-alert-list">
              {!consultado && <div className="sv-alert-empty" role="status">Consultando notificaciones…</div>}
              {Object.values(errores).map((mensaje) => <div key={mensaje} className="sv-alert-error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation}/>{mensaje}</div>)}
              {revision && <article className="sv-alert-entry sv-alert-entry--pricing">
                <div className="sv-alert-pricing__identity">
                  <span className="sv-alert-pricing__icon" aria-hidden="true"><FontAwesomeIcon icon={faMoneyBillTrendUp}/></span>
                  <div className="sv-alert-pricing__heading">
                    <strong>Revisión de precios pendiente</strong>
                    <span>Cambió el coeficiente ponderado</span>
                  </div>
                </div>
                <span className="sv-alert-days sv-alert-days--pricing">Revisar</span>
                <div className="sv-alert-pricing__comparison" aria-label={`Coeficiente anterior: ${coeficiente(revision.coeficiente_base)}. Coeficiente actual: ${coeficiente(revision.coeficiente_actual)}`}>
                  <div className="sv-alert-pricing__coefficient">
                    <span>Coeficiente anterior</span>
                    <strong>{coeficiente(revision.coeficiente_base)}</strong>
                  </div>
                  <span className="sv-alert-pricing__arrow" aria-hidden="true"><FontAwesomeIcon icon={faArrowRight}/></span>
                  <div className="sv-alert-pricing__coefficient sv-alert-pricing__coefficient--current">
                    <span>Coeficiente actual</span>
                    <strong>{coeficiente(revision.coeficiente_actual)}</strong>
                  </div>
                </div>
                <button type="button" className="mit-btn sv-alert-go" onClick={verPrecios}>
                  Ir a Stock y revisar precios <FontAwesomeIcon icon={faArrowRight} aria-hidden="true"/>
                </button>
              </article>}
              {alertas.map((v) => {
                const days = Number(v.dias_restantes);
                const seleccionable = alertas.length > 1;
                const seleccionada = String(partidaSeleccionada?.id_vencimiento) === String(v.id_vencimiento);
                return <article key={v.id_vencimiento}
                  className={`sv-alert-entry sv-alert-entry--product ${days < 0 ? "sv-alert-entry--expired" : ""} ${seleccionable ? "sv-alert-entry--selectable" : ""} ${seleccionable && seleccionada ? "sv-alert-entry--selected" : ""}`}
                  role={seleccionable ? "button" : undefined}
                  tabIndex={seleccionable ? 0 : undefined}
                  aria-pressed={seleccionable ? seleccionada : undefined}
                  aria-label={seleccionable ? `Seleccionar vencimiento de ${v.producto_nombre}${v.variante_nombre ? `, ${v.variante_nombre}` : ""}, ${mostrarFecha(v.fecha_vencimiento)}` : undefined}
                  onClick={seleccionable ? () => setVencimientoSeleccionadoId(v.id_vencimiento) : undefined}
                  onKeyDown={seleccionable ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setVencimientoSeleccionadoId(v.id_vencimiento);
                    }
                  } : undefined}>
                  <div className="sv-alert-main sv-alert-product-info">
                    <strong><FontAwesomeIcon icon={faTriangleExclamation}/> {v.producto_nombre}{v.variante_nombre ? ` · ${v.variante_nombre}` : ""}</strong>
                    <div className="sv-alert-meta">Vence: {mostrarFecha(v.fecha_vencimiento)} · Cantidad: {cantidad(v.cantidad_disponible)}{v.referencia ? ` · ${v.referencia}` : ""}</div>
                  </div>
                  <span className={`sv-alert-days ${days < 0 ? "sv-alert-days--expired" : ""}`}>{days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : days === 0 ? "Vence hoy" : `Faltan ${days} día(s)`}</span>
                </article>;
              })}
              {consultado && !total && !Object.keys(errores).length && <div className="sv-alert-empty"><FontAwesomeIcon icon={faCircleCheck}/><strong>Todo al día</strong><span>No hay notificaciones pendientes.</span></div>}
            </div>
          </div>
          <footer className="sv-alert-footer">
            <button type="button" className="mit-btn mit-btn--solid" onClick={() => setAbierto(false)}>Cerrar</button>
            {partidaSeleccionada && <button type="button" className="mit-btn mit-btn--ghost sv-alert-footer__manage" onClick={() => verPartida(partidaSeleccionada)}>
              Ver producto y gestionar vencimiento <FontAwesomeIcon icon={faArrowRight}/>
            </button>}
          </footer>
        </section>
      </div>, document.body
    )}
  </>;
}
