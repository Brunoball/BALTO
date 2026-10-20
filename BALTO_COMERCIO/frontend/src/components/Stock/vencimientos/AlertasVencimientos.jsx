import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faTriangleExclamation, faXmark, faArrowRight, faMoneyBillTrendUp } from "@fortawesome/free-solid-svg-icons";
import { listarAlertasVencimientoStock, obtenerRevisionPreciosPendienteStock } from "../api/stockApi";
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
    if (!abierto) return;
    const escape = (e) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [abierto]);

  const total = alertas.length + (revision ? 1 : 0);
  const vencidos = useMemo(() => alertas.filter(v => Number(v.dias_restantes) < 0).length, [alertas]);
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
    <button type="button" className={`sv-bell ${total ? "sv-bell--active" : ""}`}
      aria-label={`Notificaciones de Stock${total ? `: ${total}` : ""}`}
      title="Notificaciones: vencimientos y revisiones de precios"
      onClick={() => { setAbierto(true); refresh(); }}>
      <FontAwesomeIcon icon={faBell} />{total > 0 && <span className="sv-bell-count">{total > 99 ? "99+" : total}</span>}
    </button>
    {abierto && <div className="sv-alert-backdrop" role="presentation" onMouseDown={() => setAbierto(false)}>
      <section className="sv-alert-dialog" role="dialog" aria-modal="true" aria-label="Notificaciones de Stock" onMouseDown={e => e.stopPropagation()}>
        <div className="sv-alert-header"><div><h2><FontAwesomeIcon icon={faBell} /> Notificaciones de Stock</h2><p>Vencimientos y cambios del coeficiente ponderado pendientes de revisar.</p></div>
          <button type="button" aria-label="Cerrar notificaciones" onClick={()=>setAbierto(false)}><FontAwesomeIcon icon={faXmark}/></button>
        </div>
        <div className="sv-alert-summary"><span>{vencidos} vencidos</span><span>{alertas.length - vencidos} próximos a vencer</span><span>{revision ? "1 revisión de precios" : "Sin revisiones de precios"}</span></div>
        <div className="sv-alert-body">
          {!consultado && <p>Consultando notificaciones…</p>}
          {Object.values(errores).map((mensaje) => <div key={mensaje} className="sv-alert-error" role="alert">{mensaje}</div>)}
          {revision && <article className="sv-alert-entry sv-alert-entry--pricing">
            <div className="sv-alert-main"><strong><FontAwesomeIcon icon={faMoneyBillTrendUp} /> Revisión de precios pendiente</strong>
              <div className="sv-alert-meta">Cambió el coeficiente ponderado: {coeficiente(revision.coeficiente_base)} → {coeficiente(revision.coeficiente_actual)}. Los precios no se modifican hasta que lo confirmes en Stock.</div>
              <button type="button" className="sv-alert-go" onClick={verPrecios}>Ir a Stock y revisar precios <FontAwesomeIcon icon={faArrowRight}/></button>
            </div><span className="sv-alert-days">Revisar</span>
          </article>}
          {alertas.map((v) => {const days=Number(v.dias_restantes);return <article key={v.id_vencimiento} className={`sv-alert-entry ${days < 0 ? "sv-alert-entry--expired" : ""}`}>
            <div className="sv-alert-main"><strong><FontAwesomeIcon icon={faTriangleExclamation} /> {v.producto_nombre}{v.variante_nombre ? ` · ${v.variante_nombre}` : ""}</strong>
              <div className="sv-alert-meta">Vence: {mostrarFecha(v.fecha_vencimiento)} · Cantidad: {cantidad(v.cantidad_disponible)}{v.referencia ? ` · ${v.referencia}` : ""}</div>
              <button type="button" className="sv-alert-go" onClick={() => verPartida(v)}>Ver producto y gestionar vencimiento <FontAwesomeIcon icon={faArrowRight}/></button>
            </div><span className="sv-alert-days">{days < 0 ? `Vencido hace ${Math.abs(days)} día(s)` : days === 0 ? "Vence hoy" : `Faltan ${days} día(s)`}</span>
          </article>;})}
          {consultado && !total && !Object.keys(errores).length && <p>No hay notificaciones pendientes. Todo al día.</p>}
        </div>
        <div className="sv-alert-footer"><button type="button" className="sv-alert-secondary" onClick={()=>setAbierto(false)}>Cerrar</button></div>
      </section>
    </div>}
  </>;
}
