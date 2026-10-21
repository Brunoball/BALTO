import React from "react";
import "./VencimientosUI.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxesStacked, faCalendarCheck, faCalendarXmark, faClock, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

const formato = (value) => Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });

/** Indicadores compactos, inspirados en las tarjetas KPI del Dashboard de BALTO. */
export default function VencimientosResumen({ stock = 0, asignadas = 0, vencidas, proximas }) {
  const metrics = [
    { label: "Stock actual", value: stock, icon: faBoxesStacked, color: "blue" },
    { label: "Con vencimiento", value: asignadas, icon: faCalendarCheck, color: "green" },
    { label: "Sin fecha asignada", value: Math.max(0, stock - asignadas), icon: faCalendarXmark, color: "neutral" },
    ...(vencidas === undefined ? [] : [{ label: "Unidades vencidas", value: vencidas, icon: faTriangleExclamation, color: "red" }]),
    ...(proximas === undefined ? [] : [{ label: "Próximos 7 días", value: proximas, icon: faClock, color: "yellow" }]),
  ];
  return (
    <div className={`sv-kpis ${metrics.length > 3 ? "sv-kpis--extended" : ""}`} aria-label="Resumen de vencimientos">
      {metrics.map(({ label, value, icon, color }) => (
        <article key={label} className={`sv-kpi sv-kpi--${color}`}>
          <span className="sv-kpi__icon" aria-hidden="true"><FontAwesomeIcon icon={icon} /></span>
          <div className="sv-kpi__body"><span className="sv-kpi__label">{label}</span><strong className="sv-kpi__value">{formato(value)}</strong></div>
        </article>
      ))}
    </div>
  );
}
