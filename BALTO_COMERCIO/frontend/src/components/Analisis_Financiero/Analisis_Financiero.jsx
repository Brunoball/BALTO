import React, { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown, faArrowRightLong, faArrowTrendUp, faArrowUp,
  faBuildingColumns, faCalendarDays, faChevronDown,
  faScaleBalanced,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import "./analisis_financiero.css";
import "../Global/Global_css/Global_oscuro.css";
import "../Global/Global_css/Global_Section.css";
import Toast from "../Global/Toast.jsx";
import Calendario from "../Global/Calendario/Calendario.jsx";
import "../../components/Global/Calendario/calendario.css";
import BotonExportar from "../Global/Boton_Exportar/BotonExportar.jsx";
import { useDateRange } from "../../context/DateRangeContext.jsx";
import useAnalisisFinanciero from "./hooks/useAnalisisFinanciero";
import useAnalisisFinancieroDatos from "./hooks/useAnalisisFinancieroDatos";
import useAnalisisFinancieroExport from "./hooks/useAnalisisFinancieroExport";
import { formatDateUI, moneyARS, toNumberOrZero } from "./utils/analisisFinancieroUtils";

const money = (v) => moneyARS(toNumberOrZero(v));

const FINANCIAL_TABS = [
  { id: "disponibilidad", label: "Disponibilidad", title: "Movimientos de dinero" },
  { id: "resultados", label: "Resultados", title: "Rendimiento del negocio" },
  { id: "medios", label: "Medios de pago", title: "Saldos por medio de pago" },
];
const formatISODate = (iso) => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const compactMoney = (n) => {
  const v = Math.abs(toNumberOrZero(n));
  if (v >= 1000000) return `$ ${(toNumberOrZero(n) / 1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (v >= 1000) return `$ ${(toNumberOrZero(n) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} mil`;
  return money(n);
};

function Metric({ icon, label, value, tone = "neutral" }) {
  return (
    <article className={`af-metric af-metric--${tone}`}>
      <div className="af-metric__top"><span className="af-metric__label">{label}</span><span className="af-metric__icon"><FontAwesomeIcon icon={icon} /></span></div>
      <strong className="af-metric__amount" title={money(value)}>{money(value)}</strong>
    </article>
  );
}

function TrendChart({ points = [] }) {
  const valid = points.filter((p) => Number.isFinite(Number(p?.saldo)));
  if (!valid.length) return <p className="af-muted">Sin datos de evolución para este período.</p>;
  const w = 680; const h = 182;
  const values = valid.map((p) => Number(p.saldo));
  const low = Math.min(0, ...values); const high = Math.max(0, ...values);
  const span = Math.max(1, high - low);
  const coords = valid.map((p, i) => ({
    x: valid.length === 1 ? w / 2 : (i / (valid.length - 1)) * w,
    y: 10 + ((high - Number(p.saldo)) / span) * (h - 20),
  }));
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const fill = `${line} L${coords.at(-1).x.toFixed(1)} ${h} L${coords[0].x.toFixed(1)} ${h} Z`;
  const last = coords.at(-1);
  return (
    <div className="af-trend" role="img" aria-label={`Evolución del saldo: de ${money(values[0])} a ${money(values.at(-1))}`}>
      <div className="af-trend__y"><span>{compactMoney(high)}</span><span>{compactMoney(low)}</span></div>
      <div className="af-trend__plot">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="afTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--af-primary)" stopOpacity=".24"/><stop offset="100%" stopColor="var(--af-primary)" stopOpacity="0"/></linearGradient></defs>
          <path d={`M0 ${10 + high / span * (h - 20)} H${w}`} stroke="currentColor" strokeWidth="1" opacity=".16" strokeDasharray="5 6" fill="none" />
          <path d={fill} fill="url(#afTrendFill)"/>
          <path d={line} stroke="var(--af-primary)" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          <circle cx={last.x} cy={last.y} r="5" fill="var(--af-primary)" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="af-trend__dates"><span>{formatISODate(valid[0].fecha)}</span><span>{formatISODate(valid.at(-1).fecha)}</span></div>
      </div>
    </div>
  );
}

function FlowRow({ label, value, tone, strong }) {
  return <div className={`af-flowRow ${strong ? "af-flowRow--total" : ""}`}>
    <span className="af-flowRow__label"><span className={`af-flowDot af-flowDot--${tone || "neutral"}`} />{label}</span>
    <strong className={tone === "negative" ? "af-negative" : ""}>{tone === "negative" ? `− ${money(Math.abs(value))}` : money(value)}</strong>
  </div>;
}

const METHOD_COLUMNS = [
  { key: "nombre", label: "Medio de pago", className: "af-col--method" },
  { key: "saldo_inicio", label: "Arranque", className: "af-col--starting", numeric: true },
  { key: "saldo_inicial_aplicado", label: "Aperturas", className: "af-col--opening", numeric: true },
  { key: "ingresos", label: "Cobros", className: "af-col--collections", numeric: true },
  { key: "egresos", label: "Pagos", className: "af-col--payments", numeric: true },
  { key: "saldo_final", label: "Cierre", className: "af-col--closing", numeric: true },
  { key: "acciones", label: "Acciones", className: "af-col--actions" },
];

function MediumRow({ item, expanded, toggle }) {
  const isNeg = toNumberOrZero(item.saldo_final) < 0;
  return (
    <React.Fragment>
      <div className={`mov-gridTable mov-gridTable--row af-mediumRow ${expanded ? "is-expanded" : ""}`} role="row">
        <div className="mov-gridCell af-col--method" role="cell" title={item.nombre}>
          <div className="af-methodName">
            <span className="af-methodIcon"><FontAwesomeIcon icon={/banco|bancaria/i.test(item.nombre) ? faBuildingColumns : faWallet}/></span>
            <span className="af-methodText"><strong>{item.nombre}</strong>{!item.activo && <small>Medio inactivo</small>}</span>
          </div>
        </div>
        <div className="mov-gridCell is-right af-col--starting" role="cell" data-label="Arranque" title={money(item.saldo_inicio)}>{money(item.saldo_inicio)}</div>
        <div className="mov-gridCell is-right af-col--opening" role="cell" data-label="Aperturas" title={money(item.saldo_inicial_aplicado)}>{money(item.saldo_inicial_aplicado)}</div>
        <div className="mov-gridCell is-right af-col--collections af-positive" role="cell" data-label="Cobros" title={money(item.ingresos)}>{money(item.ingresos)}</div>
        <div className="mov-gridCell is-right af-col--payments af-negative" role="cell" data-label="Pagos" title={money(item.egresos)}>{money(item.egresos)}</div>
        <div className={`mov-gridCell is-right is-strong af-col--closing ${isNeg ? "af-negative" : ""}`} role="cell" data-label="Cierre" title={money(item.saldo_final)}>{money(item.saldo_final)}</div>
        <div className="mov-gridCell mov-gridCell--actions is-center af-col--actions" role="cell">
          <button type="button" className="mov-iconBtn af-detailsBtn" aria-expanded={expanded} aria-label={`Detalle de ${item.nombre}`} onClick={toggle}><FontAwesomeIcon icon={faChevronDown}/></button>
        </div>
      </div>
      <div className={`af-mediumDetailRow ${expanded ? "is-open" : ""}`} role="row" aria-hidden={!expanded}>
        <div className="af-mediumDetailCell" role="cell" aria-colspan={7}>
          <div className="af-detailGrid">
            <div className="af-mobileDetail"><span>Arranque</span><strong>{money(item.saldo_inicio)}</strong></div>
            <div className="af-mobileDetail"><span>Aperturas</span><strong>{money(item.saldo_inicial_aplicado)}</strong></div>
            <div className="af-mobileDetail"><span>Cobros</span><strong className="af-positive">{money(item.ingresos)}</strong></div>
            <div className="af-mobileDetail"><span>Pagos</span><strong className="af-negative">{money(item.egresos)}</strong></div>
            <div><span>Apertura registrada hasta el cierre</span><strong>{money(item.saldo_inicial_configurado)}</strong></div>
            <div><span>Ajustes internos del período</span><strong>{money(item.ajustes_internos)}</strong></div>
            <div><span>Variación total del período</span><strong className={item.variacion < 0 ? "af-negative" : "af-positive"}>{money(item.variacion)}</strong></div>
            <div><span>Fecha(s) de apertura</span><strong>{(item.saldos_iniciales || []).map((s) => formatISODate(s.fecha)).join(" · ") || "No configurada"}</strong></div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}

export default function Analisis_Financiero() {
  const { dateRange, setDateRange } = useDateRange();
  const [showCalendario, setShowCalendario] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [activeTab, setActiveTab] = useState("disponibilidad");
  const [toast, setToast] = useState(null);
  const showToast = useCallback((tipo, mensaje, duracion = 2800) => setToast({ tipo, mensaje, duracion }), []);
  const handleLoadError = useCallback((mensaje) => showToast("error", mensaje, 4200), [showToast]);
  const { data, error, loading, hasFetched } = useAnalisisFinanciero({ dateRange, onError: handleLoadError });
  const { ventas, costoVariable, costoFijo, otrosEgresos, resultadoNeto, gastosPersonales, otrosIngresos, deudasPorCobrar, deudasPorPagar } = useAnalisisFinancieroDatos(data);
  const tesoreria = data?.tesoreria || null;
  const medios = Array.isArray(tesoreria?.medios) ? tesoreria.medios : [];
  const fin = tesoreria || {};
  const canExport = !!data && !loading;
  const exportOptions = useAnalisisFinancieroExport({
    dateRange, ventas, costoVariable, costoFijo, otrosEgresos, otrosIngresos,
    gastosPersonales, resultadoNeto, deudasPorCobrar, deudasPorPagar,
    tesoreria, disponibilidades: medios.map((m) => ({ id: m.id, nombre: m.nombre, importe: m.saldo_final })),
    mainRows: [], totalDisponibilidades: fin.saldo_final || 0, showToast,
  });
  const periodLabel = useMemo(() => {
    if (!dateRange?.from) return "Seleccionar período";
    if (!dateRange.to || +dateRange.to === +dateRange.from) return formatDateUI(dateRange.from);
    return <><span>{formatDateUI(dateRange.from)}</span><FontAwesomeIcon icon={faArrowRightLong}/><span>{formatDateUI(dateRange.to)}</span></>;
  }, [dateRange]);
  const contrib = [
    { label: "Ventas cobradas", value: ventas, tone: "positive", icon: faArrowUp },
    { label: "Otros ingresos", value: otrosIngresos, tone: "positive", icon: faArrowUp },
    { label: "Costos variables", value: costoVariable, tone: "negative", icon: faArrowDown },
    { label: "Costos fijos", value: costoFijo, tone: "negative", icon: faArrowDown },
    { label: "Otros egresos", value: otrosEgresos, tone: "negative", icon: faArrowDown },
  ];
  const maxContribution = Math.max(1, ...contrib.map((c) => Math.abs(c.value)));

  const handleTabsKeyDown = (event) => {
    const index = FINANCIAL_TABS.findIndex((tab) => tab.id === activeTab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % FINANCIAL_TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + FINANCIAL_TABS.length) % FINANCIAL_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FINANCIAL_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = FINANCIAL_TABS[next];
    setActiveTab(nextTab.id);
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };

  return (
    <div className="mov-page mov-page--analisisFinanciero">
      {toast && <Toast tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={() => setToast(null)} />}

      <header className="af-toolbar" aria-label="Navegación y filtros de análisis financiero">
        <h2 className="af-toolbar__title">{FINANCIAL_TABS.find((tab) => tab.id === activeTab)?.title}</h2>
        <div className="af-toolbar__bottom">
        <nav className="af-tabs" role="tablist" aria-label="Secciones del análisis financiero" onKeyDown={handleTabsKeyDown}>
          {FINANCIAL_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              id={`af-tab-${tab.id}`}
              className={`af-tab ${activeTab === tab.id ? "is-active" : ""}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`af-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="af-tab__label">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="af-toolbar__actions">
          <div className="af-dateField">
            <span><FontAwesomeIcon icon={faCalendarDays}/> Período</span>
            <button type="button" className="af-dateTrigger" aria-label="Seleccionar período" aria-expanded={showCalendario} onClick={() => setShowCalendario((v) => !v)}>
              {periodLabel}<FontAwesomeIcon icon={faChevronDown}/>
            </button>
            {showCalendario && (
              <div className="af-calendarDropdown" id="clrRight">
                <Calendario value={dateRange} onChange={(next) => { setDateRange(next); if (next?.from && next?.to) setShowCalendario(false); }} onClose={() => setShowCalendario(false)}/>
              </div>
            )}
          </div>
          <BotonExportar disabled={!canExport} loading={false} label="Exportar" title="Exportar análisis y saldos" opciones={exportOptions} align="right" entityLabel="registros financieros" currentCount={medios.length + 5} scopeEnabled={false}/>
        </div>
        </div>
      </header>

      {error && <div className="af-warning" role="alert">{error}</div>}
      {loading && <div className="af-loading" role="status"><span className="af-loading__bar"/>Actualizando datos financieros…</div>}
      {!loading && !data && hasFetched && <div className="af-panel af-empty">No se pudo obtener la información financiera. Revisá la conexión o seleccioná otro período.</div>}
      {data && <>
        <div className="af-tabPanel" id="af-panel-disponibilidad" role="tabpanel" aria-labelledby="af-tab-disponibilidad" hidden={activeTab !== "disponibilidad"}>
            <section className="af-hero" aria-label="Resumen de tesorería">
              <div className="af-hero__main">
                <span className="af-hero__label">Dinero disponible al cierre</span>
                <strong className="af-hero__total" title={money(fin.saldo_final)}>{money(fin.saldo_final)}</strong>
                <span className="af-hero__foot">Al {formatISODate(fin.fecha_corte)}</span>
              </div>
              <div className="af-hero__right">
                <span className="af-hero__miniLabel">Variación en el período</span>
                <strong className={toNumberOrZero(fin.variacion) < 0 ? "af-hero__negative" : "af-hero__positive"}>{toNumberOrZero(fin.variacion) >= 0 ? "+ " : "− "}{money(Math.abs(fin.variacion || 0))}</strong>
                <div className="af-hero__divider"/>
                <span className="af-hero__miniLabel">Saldo al comenzar</span>
                <strong>{money(fin.saldo_inicio)}</strong>
              </div>
            </section>
            <section className="af-section">
              <div className="af-metrics af-metrics--summary">
                <Metric label="Cobros recibidos" value={fin.ingresos} icon={faArrowTrendUp} tone="positive"/>
                <Metric label="Pagos realizados" value={fin.egresos} icon={faArrowDown} tone="negative"/>
              </div>
              <div className="af-insightGrid">
                <article className="af-panel af-chartPanel">
                  <div className="af-panel__top"><h3>Evolución del saldo</h3><span className="af-chip">{(tesoreria?.evolucion || []).length} puntos</span></div>
                  <TrendChart points={tesoreria?.evolucion}/>
                </article>
                <article className="af-panel af-reconcile">
                  <div className="af-panel__top"><h3>Conciliación</h3><FontAwesomeIcon icon={faScaleBalanced}/></div>
                  <FlowRow label="Saldo al comienzo" value={fin.saldo_inicio}/>
                  <FlowRow label="Aperturas del período" value={fin.saldo_inicial_aplicado} tone="info"/>
                  <FlowRow label="Ingresos cobrados" value={fin.ingresos} tone="positive"/>
                  <FlowRow label="Egresos pagados" value={fin.egresos} tone="negative"/>
                  <FlowRow label="Depósitos / reversiones de cheques" value={fin.ajustes_internos} tone="info"/>
                  <FlowRow label="Saldo al cierre" value={fin.saldo_final} strong/>
                </article>
              </div>
            </section>
        </div>

        <section className="af-section af-tabPanel" id="af-panel-resultados" role="tabpanel" aria-labelledby="af-tab-resultados" hidden={activeTab !== "resultados"}>
            <div className="af-profitGrid">
              <article className="af-panel af-contributionPanel">
                <div className="af-panel__top"><h3>Ingresos y costos</h3></div>
                <div className="af-bars">
                  {contrib.map((c) => (
                    <div className={`af-bar af-bar--${c.tone}`} key={c.label}>
                      <div className="af-bar__title">
                        <span className="af-bar__label"><span className="af-bar__icon"><FontAwesomeIcon icon={c.icon}/></span>{c.label}</span>
                        <strong title={money(c.value)}>{money(c.value)}</strong>
                      </div>
                      <div className="af-bar__track"><span className={c.tone === "negative" ? "is-negative" : "is-positive"} style={{ width: `${Math.min(100, Math.abs(c.value) / maxContribution * 100)}%` }}/></div>
                    </div>
                  ))}
                </div>
              </article>
              <article className="af-panel af-resultPanel">
                <div className="af-resultPanel__summary">
                  <div className="af-resultPanel__heading">
                    <span className="af-resultPanel__title"><span className="af-resultPanel__badge"><FontAwesomeIcon icon={faScaleBalanced}/></span>Resultado operativo</span>
                    <span className={`af-resultPanel__state ${resultadoNeto < 0 ? "is-negative" : "is-positive"}`}>{resultadoNeto < 0 ? "Negativo" : "Positivo"}</span>
                  </div>
                  <strong className={`af-resultPanel__amount ${resultadoNeto < 0 ? "af-negative" : "af-positive"}`} title="Ventas cobradas + otros ingresos − costos variables − costos fijos − otros egresos; no incluye saldos iniciales ni retiros personales">{money(resultadoNeto)}</strong>
                </div>
                <div className="af-resultPanel__breakdown">
                  <div className="af-resultPanel__line"><span title="Se muestran por separado porque no son un costo operativo">Retiros / gastos personales</span><strong>{money(gastosPersonales)}</strong></div>
                  <div className="af-resultPanel__line"><span>Pendiente de cobrar</span><strong>{money(deudasPorCobrar)}</strong></div>
                  <div className="af-resultPanel__line" title="Los importes pendientes no se suman al efectivo disponible"><span>Pendiente de pagar</span><strong>{money(deudasPorPagar)}</strong></div>
                </div>
              </article>
            </div>
        </section>

        <section className="af-section af-tabPanel" id="af-panel-medios" role="tabpanel" aria-labelledby="af-tab-medios" hidden={activeTab !== "medios"}>
            <div className="af-mediumTable" role="table" aria-label="Saldos por medio de pago">
              <div className="mov-gridTable mov-gridTable--head af-mediumHead" role="rowgroup">
                <div className="af-mediumHead__row" role="row">
                  {METHOD_COLUMNS.map((column) => (
                    <div key={column.key} role="columnheader" className={`mov-gridCell mov-gridCell--head ${column.className} ${column.numeric ? "is-right" : ""} ${column.key === "acciones" ? "is-center" : ""}`}>{column.label}</div>
                  ))}
                </div>
              </div>
              <div className="mov-tableWrap af-tableScroll" role="rowgroup">
                <div className="mov-gridBody af-mediumBody" role="presentation">
                  {medios.length ? medios.map((m) => <MediumRow key={m.id} item={m} expanded={expandedId === m.id} toggle={() => setExpandedId((v) => v === m.id ? null : m.id)}/>) : (
                    <div className="af-mediumEmpty" role="row"><div role="cell" aria-colspan={7}><FontAwesomeIcon icon={faWallet}/><span>No hay medios de pago registrados para este período.</span></div></div>
                  )}
                </div>
              </div>
              <div className="af-mediumFoot" role="rowgroup">
                <div className="mov-gridTable af-mediumFoot__row" role="row">
                  <div className="mov-gridCell af-col--method is-strong" role="cell">Total</div>
                  <div className="mov-gridCell is-right af-col--starting" role="cell">{money(fin.saldo_inicio)}</div>
                  <div className="mov-gridCell is-right af-col--opening" role="cell">{money(fin.saldo_inicial_aplicado)}</div>
                  <div className="mov-gridCell is-right af-col--collections" role="cell">{money(fin.ingresos)}</div>
                  <div className="mov-gridCell is-right af-col--payments" role="cell">{money(fin.egresos)}</div>
                  <div className="mov-gridCell is-right is-strong af-col--closing" role="cell">{money(fin.saldo_final)}</div>
                  <div className="mov-gridCell af-col--actions" role="cell" />
                </div>
              </div>
            </div>
        </section>
      </>}
    </div>
  );
}
