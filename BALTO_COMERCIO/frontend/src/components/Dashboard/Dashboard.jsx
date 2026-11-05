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

import Toast from "../Global/Toast.jsx";
import "./dashboard.css";
import "./dashboard.responsive.css";
import "./dashboard.mejoras.css";
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
  // En una pantalla contable los importes deben mostrarse exactos desde el
  // primer render. La animación hacía que la tarjeta "Caja actual" y los
  // indicadores mostraran cifras distintas del desglose durante ~850 ms.
  const valorVisible = formatter === formatMoney ? value : animatedValue;

  return <Tag className={className}>{formatter(valorVisible)}</Tag>;
}

function DashboardBarChart({ rows }) {
  const [fechaSeleccionada, setFechaSeleccionada] = useState(null);
  const safeRows = Array.isArray(rows) ? rows : [];
  // Solo fechas con cobros/pagos efectivos; los días vacíos no aportan información.
  const diasActivos = safeRows.filter((r) => Number(r.ingresos || 0) > 0 || Number(r.egresos || 0) > 0);
  const visibleRows = diasActivos.slice(-9);
  const diaSeleccionado = visibleRows.find((r) => r.fecha === fechaSeleccionada) || visibleRows[visibleRows.length - 1] || null;
  const totalIngresos = safeRows.reduce((n, r) => n + Number(r.ingresos || 0), 0);
  const totalEgresos = safeRows.reduce((n, r) => n + Number(r.egresos || 0), 0);
  const neto = totalIngresos - totalEgresos;
  const maxValue = Math.max(1, ...visibleRows.flatMap((r) => [Number(r.ingresos || 0), Number(r.egresos || 0)]));

  return (
    <div className="db-cash-movements">
      <div className="db-chart-summary" aria-label="Resumen de caja del mes">
        <div><span>Ingresos cobrados</span><strong className="is-positive">{formatMoney(totalIngresos)}</strong></div>
        <div><span>Egresos pagados</span><strong className="is-negative">{formatMoney(totalEgresos)}</strong></div>
        <div><span>Variación operativa</span><strong className={moneyClass(neto)}>{formatMoney(neto)}</strong></div>
      </div>
      {!visibleRows.length ? (
        <div className="db-chart-empty">Sin cobros ni pagos registrados en el período. No se contabilizan ventas pendientes ni cheques en cartera.</div>
      ) : (
        <>
          <div className="db-chart-intro">Últimos {visibleRows.length} {visibleRows.length === 1 ? 'día' : 'días'} con movimientos</div>
          <div className="db-chart" role="img" aria-label="Comparación de ingresos cobrados y egresos pagados por día">
            <div className="db-chart__plot" style={{ gridTemplateColumns: `repeat(${visibleRows.length}, minmax(46px, 1fr))` }}>
              {visibleRows.map((r) => {
                const ingreso = Math.max(0, Number(r.ingresos || 0));
                const egreso = Math.max(0, Number(r.egresos || 0));
                return (
                  <button type="button" key={r.fecha} className={`db-chart__item ${diaSeleccionado?.fecha === r.fecha ? "db-chart__item--active" : ""}`} onClick={() => setFechaSeleccionada(r.fecha)} aria-pressed={diaSeleccionado?.fecha === r.fecha} title={`${r.label || r.fecha} · Ingresos ${formatMoney(ingreso)} · Egresos ${formatMoney(egreso)}`}>
                    <div className="db-chart__bar-pair">
                      <span className="db-chart__bar db-chart__bar--ingreso" style={{height: `${ingreso > 0 ? Math.max(5,(ingreso/maxValue)*100) : 0}%`}} />
                      <span className="db-chart__bar db-chart__bar--egreso" style={{height: `${egreso > 0 ? Math.max(5,(egreso/maxValue)*100) : 0}%`}} />
                    </div>
                    <span className="db-chart__label">{r.label || '-'}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {diaSeleccionado && <div className="db-chart-detail" aria-live="polite">
            <strong>{diaSeleccionado.label || diaSeleccionado.fecha}</strong>
            <span>Ingresos: <b>{formatMoney(diaSeleccionado.ingresos)}</b></span>
            <span>Egresos: <b>{formatMoney(diaSeleccionado.egresos)}</b></span>
          </div>}
        </>
      )}
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
          <span className="db-ind-label">Flujo neto del mes</span>
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


function SkeletonBar({ className = "", style }) {
  return (
    <span
      className={`db-skeleton ${className}`.trim()}
      style={style}
      aria-hidden="true"
    />
  );
}

function TopCardsSkeleton() {
  return Array.from({ length: 4 }).map((_, index) => (
    <article className="db-kpi db-kpi--skeleton" key={`db-kpi-skeleton-${index}`}>
      <SkeletonBar className="db-skeleton--icon" />
      <div className="db-kpi__body">
        <SkeletonBar className="db-skeleton--label" />
        <SkeletonBar className="db-skeleton--value" />
        <SkeletonBar className="db-skeleton--detail" />
      </div>
    </article>
  ));
}

function ChartSkeleton() {
  return (
    <div className="db-chart-skeleton" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <div className="db-chart-skeleton__item" key={`db-chart-skeleton-${index}`}>
          <SkeletonBar
            className="db-chart-skeleton__bar"
            style={{ height: `${44 + ((index * 17) % 76)}%` }}
          />
          <SkeletonBar className="db-chart-skeleton__label" />
        </div>
      ))}
    </div>
  );
}

function SideIndicatorsSkeleton() {
  return (
    <div className="db-ind-wrapper db-ind-wrapper--skeleton" aria-hidden="true">
      <div className="db-ind-resultado db-ind-skeleton-card">
        <SkeletonBar className="db-skeleton--small-icon" />
        <div className="db-ind-resultado__body">
          <SkeletonBar className="db-skeleton--label" />
          <SkeletonBar className="db-skeleton--side-value" />
        </div>
      </div>

      {[0, 1].map((row) => (
        <div className="db-ind-row" key={`db-ind-skeleton-row-${row}`}>
          {[0, 1].map((col) => (
            <div className="db-ind-item db-ind-skeleton-card" key={`db-ind-skeleton-${row}-${col}`}>
              <SkeletonBar className="db-skeleton--small-icon" />
              <div className="db-ind-item__body">
                <SkeletonBar className="db-skeleton--label" />
                <SkeletonBar className="db-skeleton--side-value db-skeleton--side-value-short" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((tipo, mensaje, duracion = 3200) => {
    setToast({ tipo, mensaje, duracion });
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  const { loadingDashboard, dashboard } = useDashboardDatos({
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
        detail: "Medios monetarios + cheques y eCheqs en cartera",
        icon: faWallet,
        tone: "green",
        valueClass: moneyClass(kpis.saldo_caja_actual),
      },
      {
        key: "ingresos",
        label: "Ingresos cobrados mes",
        value: kpis.ingresos_periodo,
        formatter: formatMoney,
        detail: (
          <>
            <AnimatedValue value={kpis.movimientos_periodo} formatter={formatNumber} />
            {" movimientos cobrados/pagados"}
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
            <AnimatedValue value={kpis.productos_con_stock} formatter={formatNumber} />
            {" productos con stock"}
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
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      <div className="db" data-balto-dashboard-ready={loadingDashboard ? "false" : "true"}>
        <header className="db-header db-header--dashboard">
          <div className="db-header__left">
            <h1 className="db-title">Panel Contable</h1>
            <p className="db-subtitle">
              Vista general: saldos por medio de pago, cheques en cartera,
              movimientos del mes, stock y cuentas corrientes.
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
              {loadingDashboard ? (
                <SkeletonBar className="db-skeleton--period" />
              ) : (
                <strong>{mesActualLabel}</strong>
              )}
            </div>
          </div>
        </header>

        <section className="db-kpi-grid" aria-busy={loadingDashboard}>
          {loadingDashboard ? (
            <TopCardsSkeleton />
          ) : (
            topCards.map((card) => (
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
            ))
          )}
        </section>

        {!loadingDashboard && (
          <section className="db-caja-section" aria-label="Detalle de Caja actual">
            <div className="db-caja-section__header">
              <strong>Desglose de Caja actual</strong>
              <span>
                Dinero disponible: {formatMoney(kpis.saldo_caja_liquido)} · Cheques/eCheqs en cartera: {formatMoney(kpis.saldo_caja_documentos)}
              </span>
            </div>
            <div className="db-caja-breakdown" aria-label="Saldos actuales por medio de pago">
              {(Array.isArray(kpis.saldo_caja_medios) ? kpis.saldo_caja_medios : []).map((medio) => (
                <div
                  key={`${medio.tipo}-${medio.id_medio_pago || medio.nombre}`}
                  className={medio.tipo === "documento" ? "db-caja-breakdown__documento" : ""}
                  data-medio-id={medio.id_medio_pago}
                  data-medio-tipo={medio.tipo}
                >
                  <span>
                    {medio.nombre?.toUpperCase() === "EFECTIVO" ? "Caja (Efectivo)" : medio.nombre}
                    {medio.tipo === "documento" && <small>En cartera · {medio.cantidad ?? 0} doc.</small>}
                  </span>
                  <strong className={moneyClass(medio.saldo)}>{formatMoney(medio.saldo)}</strong>
                </div>
              ))}
            </div>
            <p className="db-caja-section__note">
              Los cheques y eCheqs se incluyen solo mientras están en cartera; no son dinero acreditado en banco.
            </p>
          </section>
        )}

        <section className="db-main-grid">
          <article className="db-panel db-panel--chart">
            <div className="db-panel__head">
              <div>
                <h2>Movimiento real de dinero del mes</h2>
                <p>Cobros y pagos efectivos por fecha. Las operaciones a crédito no pagadas no se suman.</p>
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

            {loadingDashboard ? (
              <ChartSkeleton />
            ) : (
              <DashboardBarChart rows={dashboard.series_diaria} />
            )}
          </article>

          <aside className="db-panel db-panel--side">
            <div className="db-panel__head">
              <div>
                <h2>Indicadores generales</h2>
                <p>Totales principales del sistema y del mes actual.</p>
              </div>
            </div>

            {loadingDashboard ? (
              <SideIndicatorsSkeleton />
            ) : (
              <SideIndicators kpis={kpis} />
            )}
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