// src/components/Dashboard/Dashboard.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  faChevronLeft,
  faChevronRight,
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
  // Más días útiles en pantalla grande sin cambiar importes ni la fuente de datos.
  const visibleRows = diasActivos.slice(-12);
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
          <div className="db-chart" role="group" aria-label="Comparación de ingresos cobrados y egresos pagados por día">
            {/* Todas las columnas se adaptan al ancho real; no generan scroll horizontal. */}
            <div className="db-chart__plot" style={{ gridTemplateColumns: `repeat(${visibleRows.length}, minmax(0, 1fr))` }}>
              {visibleRows.map((r) => {
                const ingreso = Math.max(0, Number(r.ingresos || 0));
                const egreso = Math.max(0, Number(r.egresos || 0));
                return (
                  <button type="button" key={r.fecha} className={`db-chart__item ${diaSeleccionado?.fecha === r.fecha ? "db-chart__item--active" : ""}`} onClick={() => setFechaSeleccionada(r.fecha)} aria-pressed={diaSeleccionado?.fecha === r.fecha} title={`${r.label || r.fecha} · Ingresos ${formatMoney(ingreso)} · Egresos ${formatMoney(egreso)}`}>
                    <div className="db-chart__bar-pair">
                      <span className="db-chart__bar db-chart__bar--ingreso" style={{height: `${ingreso > 0 ? Math.max(5,(ingreso/maxValue)*100) : 0}%`}} />
                      <span className="db-chart__bar db-chart__bar--egreso" style={{height: `${egreso > 0 ? Math.max(5,(egreso/maxValue)*100) : 0}%`}} />
                    </div>
                    <span className="db-chart__label db-chart__label--full">{r.label || '-'}</span>
                    <span className="db-chart__label db-chart__label--short" aria-hidden="true">{String(r.fecha || r.label || '-').slice(-2)}</span>
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


// Un solo carrusel para los KPI principales y los saldos por medio de pago.
// Los cuatro indicadores generales se muestran primero; el usuario puede avanzar
// una tarjeta por vez para consultar el desglose, sin agregar una segunda fila.
function DashboardCardsCarousel({ tarjetas, medios }) {
  const scrollerRef = useRef(null);
  const [navigation, setNavigation] = useState({
    overflow: false,
    canPrevious: false,
    canNext: false,
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const updateNavigation = () => {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const next = {
        overflow: maxScroll > 2,
        canPrevious: scroller.scrollLeft > 2,
        canNext: scroller.scrollLeft < maxScroll - 2,
      };
      setNavigation((current) =>
        Object.keys(next).every((key) => next[key] === current[key]) ? current : next
      );
    };

    scroller.scrollLeft = 0;
    updateNavigation();
    scroller.addEventListener("scroll", updateNavigation, { passive: true });
    window.addEventListener("resize", updateNavigation);

    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateNavigation)
      : null;
    observer?.observe(scroller);
    Array.from(scroller.children).forEach((card) => observer?.observe(card));

    return () => {
      scroller.removeEventListener("scroll", updateNavigation);
      window.removeEventListener("resize", updateNavigation);
      observer?.disconnect();
    };
  }, [tarjetas.length, medios.length]);

  const moveCards = useCallback((direction) => {
    const scroller = scrollerRef.current;
    const firstCard = scroller?.firstElementChild;
    if (!scroller || !firstCard) return;

    const gap = parseFloat(window.getComputedStyle(scroller).columnGap) || 0;
    const step = firstCard.getBoundingClientRect().width + gap;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    scroller.scrollBy({ left: direction * step, behavior: reducedMotion ? "auto" : "smooth" });
  }, []);

  return (
    <div className={`db-kpi-slider${tarjetas.length + medios.length > 1 ? " db-kpi-slider--multiple" : ""}`}>
      {navigation.overflow && (
        <>
          <button
            type="button"
            className="db-kpi-carousel-arrow db-kpi-carousel-arrow--previous"
            disabled={!navigation.canPrevious}
            onClick={() => moveCards(-1)}
            aria-label="Ver tarjeta anterior"
            aria-controls="db-kpi-cards"
            title="Tarjeta anterior"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <button
            type="button"
            className="db-kpi-carousel-arrow db-kpi-carousel-arrow--next"
            disabled={!navigation.canNext}
            onClick={() => moveCards(1)}
            aria-label="Ver tarjeta siguiente"
            aria-controls="db-kpi-cards"
            title="Tarjeta siguiente"
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </>
      )}
      <div
        id="db-kpi-cards"
        ref={scrollerRef}
        className="db-kpi-carousel-track"
        tabIndex={0}
        aria-label="Indicadores principales y saldos por medio de pago. Usá las flechas o deslizá para navegar."
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            moveCards(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {tarjetas.map((card) => (
          <article
            className={`db-kpi db-kpi--${card.tone} db-kpi-carousel-card db-kpi-carousel-card--principal`}
            key={card.key}
          >
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
        {medios.map((medio, index) => {
          const isDocument = medio.tipo === "documento";
          const titulo = medio.nombre?.toUpperCase() === "EFECTIVO" ? "Caja (Efectivo)" : medio.nombre;
          const tone = Number(medio.saldo) < 0
            ? "red"
            : isDocument ? "yellow" : ["green", "blue", "pink", "yellow"][index % 4];
          return (
            <article
              key={`medio-${medio.tipo}-${medio.id_medio_pago || medio.nombre}`}
              className={`db-kpi db-kpi--${tone} db-kpi-carousel-card db-kpi-carousel-card--medio`}
              data-medio-id={medio.id_medio_pago}
              data-medio-tipo={medio.tipo}
            >
              <div className="db-kpi__icon" aria-hidden="true">
                <FontAwesomeIcon icon={isDocument ? faCreditCard : faWallet} />
              </div>
              <div className="db-kpi__body">
                <span className="db-kpi__label" title={titulo}>{titulo}</span>
                <strong className={`db-kpi__value ${moneyClass(medio.saldo)}`} title={formatMoney(medio.saldo)}>
                  {formatMoney(medio.saldo)}
                </strong>
                <span className="db-kpi__detail">
                  {isDocument ? `En cartera · ${medio.cantidad ?? 0} doc.` : "Medio de pago"}
                </span>
              </div>
            </article>
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
    <div className="db-ind-wrapper" role="region" aria-label="Indicadores generales: flujo neto destacado y cuatro indicadores en cuadrícula de dos columnas" tabIndex={0}>
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

        {/* Una sola fila de tarjetas: 4 KPI y luego todos los medios de pago. */}
        <section className="db-kpi-carousel-section" aria-label="Indicadores y desglose de Caja actual" aria-busy={loadingDashboard}>
          {loadingDashboard ? (
            <div className="db-kpi-carousel-track db-kpi-carousel-track--loading">
              <TopCardsSkeleton />
            </div>
          ) : (
            <>
              <DashboardCardsCarousel
                tarjetas={topCards}
                medios={Array.isArray(kpis.saldo_caja_medios) ? kpis.saldo_caja_medios : []}
              />
            </>
          )}
        </section>

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