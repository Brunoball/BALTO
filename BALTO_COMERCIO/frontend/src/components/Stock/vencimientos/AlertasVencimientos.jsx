import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faTriangleExclamation, faXmark, faArrowRight, faCalendarXmark, faClock, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { listarAlertasVencimientoStock } from "../api/stockApi";
import { isTopStockModal } from "../modales/modalStackUtils";
import { acquireBodyScrollLock } from "../../../utils/bodyScrollLock";
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
// La carga de alertas es asíncrona: no abrir un modal encima de alguien que
// ya está escribiendo. La campana conserva las alertas y la apertura automática
// se puede intentar en la siguiente actualización, cuando no esté editando.
function usuarioEstaEscribiendo() {
  const activo = document.activeElement;
  if (!activo || activo === document.body) return false;
  if (activo.isContentEditable || activo.matches('[role="textbox"]')) return true;
  // Stock tiene un input técnico invisible que recibe códigos de barras.
  // No representa una edición manual y no debe bloquear las alertas.
  return activo.matches('textarea, select, input:not([type="hidden"]):not(.stock-barcodeCaptureInput)');
}

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
  const [alertas, setAlertas] = useState([]);
  const [abierto, setAbierto] = useState(false);
  const [errores, setErrores] = useState({});
  const [consultado, setConsultado] = useState(false);
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);

  const refresh = useCallback(async () => {
    const nuevosErrores = {};
    let rows = [];
    let consultaOk = false;
    try {
      const venc = await listarAlertasVencimientoStock(7);
      rows = Array.isArray(venc?.alertas) ? venc.alertas : [];
      setAlertas(rows);
      consultaOk = true;
    } catch {
      nuevosErrores.vencimientos = "No se pudieron consultar los vencimientos.";
    }
    setErrores(nuevosErrores);
    setConsultado(true);

    // Mostrar una sola apertura por día para vencimientos. Al retirar
    // parcialmente stock no debe reaparecer encima del usuario con cada cambio
    // de cantidad; la campanita sí se actualiza.
    if (!rows.length) return;
    const base = `balto:notificaciones:${sessionScope()}`;
    const vencKey = `${base}:vencimientos:${fechaLocal()}`;
    try {
      const verVenc = consultaOk && !sessionStorage.getItem(vencKey);
      // El backend puede responder después de que la persona empiece a buscar,
      // cargar un formulario o editar stock. No interrumpir ni robar pulsaciones.
      // No marcamos la notificación como vista al posponerla.
      if (verVenc && !usuarioEstaEscribiendo()) {
        sessionStorage.setItem(vencKey, "1");
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
    const previousFocus = document.activeElement;
    const releaseScroll = acquireBodyScrollLock();
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
      releaseScroll();
      document.removeEventListener("keydown", handleKeys, true);
      if (previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, [abierto]);

  const total = alertas.length;
  const vencidos = useMemo(() => alertas.filter(v => Number(v.dias_restantes) < 0).length, [alertas]);
  const verPartida = (partida) => {
    setAbierto(false);
    navigate("/panel/stock", {state:{baltoStockDestino:{productoId:Number(partida.id_stock_producto),varianteId:Number(partida.id_stock_variante || 0),tab:"vencimientos",ts:Date.now()}}});
  };
  return <>
    <button type="button" className={`pp-themeBtn sv-bell ${total ? "sv-bell--active" : ""}`}
      aria-label={`Notificaciones de Stock${total ? `: ${total}` : ""}`}
      aria-haspopup="dialog" aria-expanded={abierto}
      title="Notificaciones: vencimientos de productos"
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
              <p id="sv-alert-subtitle" className="mi-modal__subtitle">Productos vencidos y próximos a vencer.</p>
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
            </div>
            <div className="sv-alert-list">
              {!consultado && <div className="sv-alert-empty" role="status">Consultando notificaciones…</div>}
              {Object.values(errores).map((mensaje) => <div key={mensaje} className="sv-alert-error" role="alert"><FontAwesomeIcon icon={faTriangleExclamation}/>{mensaje}</div>)}
              {alertas.map((v) => {
                const days = Number(v.dias_restantes);
                const productoConVariante = `${v.producto_nombre}${v.variante_nombre ? `, ${v.variante_nombre}` : ""}`;
                return <article key={v.id_vencimiento}
                  className={`sv-alert-entry sv-alert-entry--product sv-alert-entry--clickable ${days < 0 ? "sv-alert-entry--expired" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver producto y gestionar vencimiento de ${productoConVariante}, ${mostrarFecha(v.fecha_vencimiento)}`}
                  onClick={() => verPartida(v)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      verPartida(v);
                    }
                  }}>
                  <div className="sv-alert-main sv-alert-product-info">
                    <strong><FontAwesomeIcon icon={faTriangleExclamation}/> {v.producto_nombre}{v.variante_nombre ? ` · ${v.variante_nombre}` : ""}</strong>
                    <div className="sv-alert-meta">Vence: {mostrarFecha(v.fecha_vencimiento)} · Cantidad: {cantidad(v.cantidad_disponible)}{v.referencia ? ` · ${v.referencia}` : ""}</div>
                  </div>
                  <div className="sv-alert-product-actions">
                    <span className={`sv-alert-days ${days < 0 ? "sv-alert-days--expired" : ""}`}>{days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : days === 0 ? "Vence hoy" : `Faltan ${days} día(s)`}</span>
                    <span className="sv-alert-entry__cta" aria-hidden="true">Ver producto <FontAwesomeIcon icon={faArrowRight}/></span>
                  </div>
                </article>;
              })}
              {consultado && !total && !Object.keys(errores).length && <div className="sv-alert-empty"><FontAwesomeIcon icon={faCircleCheck}/><strong>Todo al día</strong><span>No hay notificaciones pendientes.</span></div>}
            </div>
          </div>
          <footer className="sv-alert-footer">
            <button type="button" className="mit-btn mit-btn--solid" onClick={() => setAbierto(false)}>Cerrar</button>
          </footer>
        </section>
      </div>, document.body
    )}
  </>;
}
