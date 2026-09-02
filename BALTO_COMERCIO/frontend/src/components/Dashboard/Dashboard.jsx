// src/components/Dashboard/Dashboard.jsx
import React, { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faArrowUpRightFromSquare,
  faBoxesStacked,
  faChartLine,
  faMoneyBillTrendUp,
  faTruck,
  faCreditCard,
  faUsers,
  faWallet,
  faArrowTrendUp,
} from "@fortawesome/free-solid-svg-icons";

import GifCarga from "../Global/Gif_Carga";
import Toast from "../Global/Toast.jsx";
import "./dashboard.css";
import "../Global/Global_css/Global_responsive.css";
import { useListas } from "../../context/ListasContext";
import useCountUp from "./hooks/useCountUp";
import useDashboardDatos from "./hooks/useDashboardDatos";
import {
  formatDateES,
  formatMoney,
  formatMonthLabel,
  formatNumber,
  moneyClass,
} from "./utils/dashboardUtils";

function AnimatedValue({
  value,
  formatter = formatNumber,
  className = "",
  as: Tag = "span",
  duration = 850,
}) {
  const animatedValue = useCountUp(value, { duration });

  return <Tag className={className}>{formatter(animatedValue)}</Tag>;
}

function DashboardBarChart({ rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const visibleRows = safeRows.length > 12 ? safeRows.slice(-12) : safeRows;

  const maxValue = Math.max(
    1,
    ...visibleRows.map((r) => Number(r.ingresos || 0) + Number(r.egresos || 0))
  );

  if (visibleRows.length === 0) {
    return (
      <div className="db-empty">
        Todavía no hay movimientos del mes actual para graficar.
      </div>
    );
  }

  const gridTemplateColumns = `repeat(${visibleRows.length}, minmax(30px, 1fr))`;
  const minWidth = Math.max(420, visibleRows.length * 38);

  return (
    <div className="db-chart" role="img" aria-label="Ingresos y egresos del mes actual">
      <div className="db-chart__plot" style={{ gridTemplateColumns, minWidth }}>
        {visibleRows.map((row) => {
          const ingresos = Math.max(0, Number(row.ingresos || 0));
          const egresos = Math.max(0, Number(row.egresos || 0));
          const total = ingresos + egresos;
          const totalHeight = Math.max(5, Math.round((total / maxValue) * 126));
          const ingPct = total > 0 ? (ingresos / total) * 100 : 0;
          const egrPct = total > 0 ? (egresos / total) * 100 : 0;

          return (
            <div
              className="db-chart__item"
              key={row.fecha}
              title={`${row.label || row.fecha}\nIngresos: ${formatMoney(
                ingresos
              )}\nEgresos: ${formatMoney(egresos)}\nMovimientos: ${formatNumber(
                row.movimientos || 0
              )}`}
            >
              <div className="db-chart__bar" style={{ height: `${totalHeight}px` }}>
                {egresos > 0 && (
                  <span
                    className="db-chart__seg db-chart__seg--egresos"
                    style={{ height: `${egrPct}%` }}
                  />
                )}

                {ingresos > 0 && (
                  <span
                    className="db-chart__seg db-chart__seg--ingresos"
                    style={{ height: `${ingPct}%` }}
                  />
                )}
              </div>

              <span className="db-chart__label">{row.label || "-"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndItem({
  icon,
  label,
  value,
  formatter = formatNumber,
  valueClass = "",
  iconClass = "",
}) {
  return (
    <div className="db-ind-item">
      <div className={`db-ind-icon db-ind-icon--${iconClass}`}>
        <FontAwesomeIcon icon={icon} />
      </div>

      <div className="db-ind-item__body">
        <span className="db-ind-label">{label}</span>
        <AnimatedValue
          as="strong"
          className={`db-ind-value ${valueClass}`}
          value={value}
          formatter={formatter}
        />
      </div>
    </div>
  );
}

function SideIndicators({ kpis }) {
  const saldoClass = moneyClass(kpis.saldo_periodo);

  return (
    <div className="db-ind-wrapper">
      <div
        className={`db-ind-resultado ${
          saldoClass === "is-positive"
            ? "db-ind-resultado--pos"
            : saldoClass === "is-negative"
            ? "db-ind-resultado--neg"
            : ""
        }`}
      >
        <div
          className={`db-ind-icon db-ind-icon--${
            Number(kpis.saldo_periodo) >= 0 ? "green" : "red"
          }`}
        >
          <FontAwesomeIcon icon={faArrowTrendUp} />
        </div>

        <div className="db-ind-resultado__body">
          <span className="db-ind-label">Resultado del mes</span>
          <AnimatedValue
            as="strong"
            className={`db-ind-value ${saldoClass}`}
            value={kpis.saldo_periodo}
            formatter={formatMoney}
          />
        </div>
      </div>


      <div className="db-ind-row">
        <IndItem
          icon={faArrowUpRightFromSquare}
          label="Ingresos mes"
          value={kpis.ingresos_periodo}
          formatter={formatMoney}
          valueClass="is-positive"
          iconClass="green"
        />

        <IndItem
          icon={faArrowDown}
          label="Egresos mes"
          value={kpis.egresos_periodo}
          formatter={formatMoney}
          valueClass="is-negative"
          iconClass="red"
        />
      </div>


      <div className="db-ind-row">
        <IndItem
          icon={faTruck}
          label="Proveedores activos"
          value={kpis.proveedores_activos}
          formatter={formatNumber}
          iconClass="amber"
        />

        <IndItem
          icon={faCreditCard}
          label="Saldo proveedores"
          value={kpis.saldo_proveedores_cc}
          formatter={formatMoney}
          iconClass="teal"
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { ensureListsLoaded } = useListas();

  const [toast, setToast] = useState(null);

  const showToast = useCallback((tipo, mensaje, duracion = 3200) => {
    setToast({ tipo, mensaje, duracion });
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  const { loadingInicial, loadingDashboard, dashboard } = useDashboardDatos({
    ensureListsLoaded,
    showToast,
  });

  const kpis = dashboard.kpis || {};

  const rangoDesde = dashboard.rango?.desde ? formatDateES(dashboard.rango.desde) : "";
  const rangoHasta = dashboard.rango?.hasta ? formatDateES(dashboard.rango.hasta) : "";
  const mesActualLabel = formatMonthLabel(dashboard.rango?.desde);

  const topCards = useMemo(
    () => [
      {
        key: "caja",
        label: "Caja actual",
        value: kpis.saldo_caja_actual,
        formatter: formatMoney,
        detail: "Saldo real acumulado",
        icon: faWallet,
        tone: "green",
        valueClass: moneyClass(kpis.saldo_caja_actual),
      },
      {
        key: "ingresos",
        label: "Ingresos mes actual",
        value: kpis.ingresos_periodo,
        formatter: formatMoney,
        detail: (
          <>
            <AnimatedValue value={kpis.movimientos_periodo} formatter={formatNumber} />
            {" movimientos del mes"}
          </>
        ),
        icon: faMoneyBillTrendUp,
        tone: "blue",
        valueClass: "is-positive",
      },
      {
        key: "stock",
        label: "Stock valorizado",
        value: kpis.stock_valorizado,
        formatter: formatMoney,
        detail: (
          <>
            <AnimatedValue value={kpis.productos_activos} formatter={formatNumber} />
            {" productos activos"}
          </>
        ),
        icon: faBoxesStacked,
        tone: "pink",
        valueClass: "",
      },
      {
        key: "cc",
        label: "Saldo clientes",
        value: kpis.saldo_clientes_cc,
        formatter: formatMoney,
        detail: (
          <>
            <AnimatedValue value={kpis.clientes_activos} formatter={formatNumber} />
            {" clientes activos"}
          </>
        ),
        icon: faUsers,
        tone: "yellow",
        valueClass: "",
      },
    ],
    [kpis]
  );

  return (
    <>
      {(loadingInicial || (loadingDashboard && !dashboard.series_diaria.length)) && (
        <GifCarga />
      )}

      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      <div className="db">
        <header className="db-header db-header--dashboard">
          <div className="db-header__left">
            <h1 className="db-title">Panel Contable</h1>
            <p className="db-subtitle">
              Vista general del sistema: caja, movimientos del mes, stock,
              clientes y proveedores.
            </p>
          </div>

          <div className="db-header__right db-actions">
            <div
              className="db-period-chip db-period-chip--header"
              title={
                rangoDesde && rangoHasta
                  ? `${rangoDesde} / ${rangoHasta}`
                  : mesActualLabel
              }
            >
              <FontAwesomeIcon icon={faChartLine} />
              <span>Mes actual</span>
              <strong>{mesActualLabel}</strong>
            </div>
          </div>
        </header>

        <section className="db-kpi-grid">
          {topCards.map((card) => (
            <article className={`db-kpi db-kpi--${card.tone}`} key={card.key}>
              <div className="db-kpi__icon" aria-hidden="true">
                <FontAwesomeIcon icon={card.icon} />
              </div>

              <div className="db-kpi__body">
                <span className="db-kpi__label">{card.label}</span>

                <AnimatedValue
                  as="strong"
                  className={`db-kpi__value ${card.valueClass}`}
                  value={card.value}
                  formatter={card.formatter}
                />

                <span className="db-kpi__detail">{card.detail}</span>
              </div>
            </article>
          ))}
        </section>

        <section className="db-main-grid">
          <article className="db-panel db-panel--chart">
            <div className="db-panel__head">
              <div>
                <h2>Ingresos y egresos del mes actual</h2>
                <p>
                  Datos calculados desde ventas, compras, otros ingresos, otros
                  egresos y cobros.
                </p>
              </div>

              <div className="db-legend">
                <span>
                  <i className="db-dot db-dot--ingresos" />
                  Ingresos
                </span>

                <span>
                  <i className="db-dot db-dot--egresos" />
                  Egresos
                </span>
              </div>
            </div>

            <DashboardBarChart rows={dashboard.series_diaria} />
          </article>

          <aside className="db-panel db-panel--side">
            <div className="db-panel__head">
              <div>
                <h2>Indicadores generales</h2>
                <p>Totales principales del sistema y del mes actual.</p>
              </div>
            </div>

            <SideIndicators kpis={kpis} />
          </aside>
        </section>

        <footer className="db-footer">
          Desarrollado por{" "}
          <a href="https://3devsnet.com" target="_blank" rel="noopener noreferrer">
            3devs.solutions
          </a>
        </footer>
      </div>
    </>
  );
}