import React, { useCallback, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown, faArrowRightLong, faArrowTrendUp, faArrowUp,
  faBuildingColumns, faCalendarDays, faChevronDown,
  faCircleInfo, faCoins, faRotateRight, faScaleBalanced,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import "./analisis_financiero.css";
import "../Global/Global_css/Global_oscuro.css";
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
const formatISODate = (iso) => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const compactMoney = (n) => {
  const v = Math.abs(toNumberOrZero(n));
  if (v >= 1000000) return `$ ${(toNumberOrZero(n) / 1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (v >= 1000) return `$ ${(toNumberOrZero(n) / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} mil`;
  return money(n);
};

function Metric({ icon, label, value, note, tone = "neutral", main = false }) {
  return (
    <article className={`af-metric af-metric--${tone} ${main ? "af-metric--main" : ""}`}>
      <div className="af-metric__top"><span className="af-metric__label">{label}</span><span className="af-metric__icon"><FontAwesomeIcon icon={icon} /></span></div>
      <strong className="af-metric__amount" title={money(value)}>{money(value)}</strong>
      <span className="af-metric__note">{note}</span>
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
          <defs><linearGradient id="afTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2d9ba0" stopOpacity=".24"/><stop offset="100%" stopColor="#2d9ba0" stopOpacity="0"/></linearGradient></defs>
          <path d={`M0 ${10 + high / span * (h - 20)} H${w}`} stroke="currentColor" strokeWidth="1" opacity=".16" strokeDasharray="5 6" fill="none" />
          <path d={fill} fill="url(#afTrendFill)"/>
          <path d={line} stroke="#23959b" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          <circle cx={last.x} cy={last.y} r="5" fill="#23959b" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
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

function MediumRow({ item, expanded, toggle }) {
  const isNeg = toNumberOrZero(item.saldo_final) < 0;
  return (
    <React.Fragment>
      <tr className={expanded ? "is-expanded" : ""}>
        <td><div className="af-methodName"><span className="af-methodIcon"><FontAwesomeIcon icon={/banco|bancaria/i.test(item.nombre) ? faBuildingColumns : faWallet}/></span><span><strong>{item.nombre}</strong>{!item.activo && <small>Medio inactivo</small>}</span></div></td>
        <td className="af-num">{money(item.saldo_inicio)}</td>
        <td className="af-num">{money(item.saldo_inicial_aplicado)}</td>
        <td className="af-num af-positive">{money(item.ingresos)}</td>
        <td className="af-num af-negative">{money(item.egresos)}</td>
        <td className={`af-num af-bold ${isNeg ? "af-negative" : ""}`}>{money(item.saldo_final)}</td>
        <td className="af-actionCell"><button type="button" className="af-detailsBtn" aria-expanded={expanded} aria-label={`Detalle de ${item.nombre}`} onClick={toggle}><FontAwesomeIcon icon={faChevronDown}/></button></td>
      </tr>
      {expanded && <tr className="af-tableDetail"><td colSpan={7}>
        <div className="af-detailGrid">
          <div><span>Apertura registrada hasta el cierre</span><strong>{money(item.saldo_inicial_configurado)}</strong></div>
          <div><span>Ajustes internos del período</span><strong>{money(item.ajustes_internos)}</strong></div>
          <div><span>Variación total del período</span><strong className={item.variacion < 0 ? "af-negative" : "af-positive"}>{money(item.variacion)}</strong></div>
          <div><span>Fecha(s) de apertura</span><strong>{(item.saldos_iniciales || []).map((s) => formatISODate(s.fecha)).join(" · ") || "No configurada"}</strong></div>
        </div>
      </td></tr>}
    </React.Fragment>
  );
}

export default function Analisis_Financiero() {
  const { dateRange, setDateRange } = useDateRange();
  const [showCalendario, setShowCalendario] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((tipo, mensaje, duracion = 2800) => setToast({ tipo, mensaje, duracion }), []);
  const handleLoadError = useCallback((mensaje) => showToast("error", mensaje, 4200), [showToast]);
  const { data, error, loading, hasFetched, refetch } = useAnalisisFinanciero({ dateRange, onError: handleLoadError });
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
  const hasNegative = medios.some((m) => toNumberOrZero(m.saldo_final) < 0);
  const contrib = [
    { label: "Ventas cobradas", value: ventas, tone: "positive", icon: faArrowUp },
    { label: "Otros ingresos", value: otrosIngresos, tone: "positive", icon: faArrowUp },
    { label: "Costos variables", value: costoVariable, tone: "negative", icon: faArrowDown },
    { label: "Costos fijos", value: costoFijo, tone: "negative", icon: faArrowDown },
    { label: "Otros egresos", value: otrosEgresos, tone: "negative", icon: faArrowDown },
  ];
  const maxContribution = Math.max(1, ...contrib.map((c) => Math.abs(c.value)));

  return (
    <div className="mov-page mov-page--analisisFinanciero">
      {toast && <Toast tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={() => setToast(null)} />}
      <header className="af-toolbar">
        <div><div className="af-eyebrow">BALTO · Reportes</div><h1>Análisis financiero</h1><p>Rentabilidad, dinero disponible y detalle por medio de pago.</p></div>
        <div className="af-toolbar__actions">
          <div className="af-dateField">
            <span><FontAwesomeIcon icon={faCalendarDays}/> Período</span>
            <button type="button" className="af-dateTrigger" aria-expanded={showCalendario} onClick={() => setShowCalendario((v) => !v)}>{periodLabel}<FontAwesomeIcon icon={faChevronDown}/></button>
            {showCalendario && <div className="af-calendarDropdown" id="clrRight"><Calendario value={dateRange} onChange={(next) => { setDateRange(next); if (next?.from && next?.to) setShowCalendario(false); }} onClose={() => setShowCalendario(false)}/></div>}
          </div>
          <button className="af-iconAction" title="Actualizar datos" aria-label="Actualizar análisis" type="button" onClick={refetch} disabled={loading}><FontAwesomeIcon icon={faRotateRight}/></button>
          <BotonExportar disabled={!canExport} loading={false} label="Exportar" title="Exportar análisis y saldos" opciones={exportOptions} align="right" entityLabel="registros financieros" currentCount={medios.length + 5} scopeEnabled={false}/>
        </div>
      </header>
      {error && <div className="af-warning" role="alert">{error}</div>}
      {loading && <div className="af-loading" role="status"><span className="af-loading__bar"/>Actualizando datos financieros…</div>}
      {!loading && !data && hasFetched && <div className="af-panel af-empty">No se pudo obtener la información financiera. Probá actualizar la página.</div>}
      {data && <>
        <section className="af-hero" aria-label="Resumen financiero">
          <div className="af-hero__main"><span className="af-hero__eyebrow"><FontAwesomeIcon icon={faCoins}/> SITUACIÓN DE TESORERÍA</span><span className="af-hero__label">Dinero disponible al cierre</span><strong className="af-hero__total" title={money(fin.saldo_final)}>{money(fin.saldo_final)}</strong><span className="af-hero__foot">Al {formatISODate(fin.fecha_corte)} · Saldo estimado según movimientos registrados</span></div>
          <div className="af-hero__right"><span className="af-hero__miniLabel">Variación en el período</span><strong className={toNumberOrZero(fin.variacion) < 0 ? "af-hero__negative" : "af-hero__positive"}>{toNumberOrZero(fin.variacion) >= 0 ? "+ " : "− "}{money(Math.abs(fin.variacion || 0))}</strong><div className="af-hero__divider"/><span className="af-hero__miniLabel">Saldo al comenzar</span><strong>{money(fin.saldo_inicio)}</strong></div>
        </section>

        {(fin.advertencia || hasNegative || dateRange?.to && dateRange.to > new Date()) && <div className="af-notice"><FontAwesomeIcon icon={faCircleInfo}/><span>{fin.advertencia || (hasNegative ? "Hay medios con saldo negativo. Revisá los movimientos y saldos iniciales en Configuración." : "El rango llega a fechas futuras: se muestran únicamente operaciones hasta hoy.")}</span></div>}

        <section className="af-section" aria-labelledby="af-cashTitle">
          <div className="af-section__heading"><div><span className="af-section__kicker">01 · DISPONIBILIDAD</span><h2 id="af-cashTitle">Cómo se formó tu saldo</h2><p>Cobros, pagos y evolución del dinero durante el período.</p></div></div>
          <div className="af-metrics af-metrics--summary">
            <Metric label="Cobros recibidos" value={fin.ingresos} note="Ventas y otros ingresos efectivamente cobrados" icon={faArrowTrendUp} tone="positive"/>
            <Metric label="Pagos realizados" value={fin.egresos} note="Compras, gastos y otros egresos pagados" icon={faArrowDown} tone="negative"/>
          </div>
          <div className="af-insightGrid">
            <article className="af-panel af-chartPanel">
              <div className="af-panel__top">
                <div><h3>Evolución del saldo</h3><p>Saldo acumulado según fecha real de cobro o pago</p></div>
                <span className="af-chip">{(tesoreria?.evolucion || []).length} puntos</span>
              </div>
              <TrendChart points={tesoreria?.evolucion}/>
            </article>
            <article className="af-panel af-reconcile">
              <div className="af-panel__top"><div><h3>Conciliación</h3><p>De dónde sale el saldo final</p></div><FontAwesomeIcon icon={faScaleBalanced}/></div>
              <FlowRow label="Saldo al comienzo" value={fin.saldo_inicio}/>
              <FlowRow label="Aperturas del período" value={fin.saldo_inicial_aplicado} tone="info"/>
              <FlowRow label="Ingresos cobrados" value={fin.ingresos} tone="positive"/>
              <FlowRow label="Egresos pagados" value={fin.egresos} tone="negative"/>
              <FlowRow label="Depósitos / reversiones de cheques" value={fin.ajustes_internos} tone="info"/>
              <FlowRow label="Saldo al cierre" value={fin.saldo_final} strong/>
            </article>
          </div>
        </section>

        <section className="af-section" aria-labelledby="af-profitTitle"><div className="af-section__heading"><div><span className="af-section__kicker">02 · RESULTADOS</span><h2 id="af-profitTitle">Rendimiento del negocio</h2><p>Resultado operativo del período. No incluye saldos iniciales ni retiros personales.</p></div></div>
          <div className="af-profitGrid"><article className="af-panel"><div className="af-panel__top"><div><h3>Ingresos y costos</h3><p>Importes aplicados a los movimientos del período</p></div></div>
            <div className="af-bars">{contrib.map((c) => <div className="af-bar" key={c.label}><div className="af-bar__title"><span><FontAwesomeIcon icon={c.icon}/> {c.label}</span><strong>{money(c.value)}</strong></div><div className="af-bar__track"><span className={c.tone === "negative" ? "is-negative" : "is-positive"} style={{ width: `${Math.min(100, Math.abs(c.value) / maxContribution * 100)}%` }}/></div></div>)}</div>
          </article><article className="af-panel af-resultPanel"><span className="af-resultPanel__eyebrow">RESULTADO OPERATIVO</span><strong className={`af-resultPanel__amount ${resultadoNeto < 0 ? "af-negative" : ""}`}>{money(resultadoNeto)}</strong><p>Ventas cobradas + otros ingresos − costos variables − costos fijos − otros egresos.</p><div className="af-resultPanel__separator"/><div className="af-resultPanel__line"><span>Retiros / gastos personales</span><strong>{money(gastosPersonales)}</strong></div><small>Se muestran por separado porque no son un costo operativo.</small><div className="af-resultPanel__line"><span>Pendiente de cobrar</span><strong>{money(deudasPorCobrar)}</strong></div><div className="af-resultPanel__line"><span>Pendiente de pagar</span><strong>{money(deudasPorPagar)}</strong></div><small>Los pendientes no se suman al efectivo disponible.</small></article></div>
        </section>

        <section className="af-section" aria-labelledby="af-methodsTitle"><div className="af-section__heading"><div><span className="af-section__kicker">03 · TESORERÍA POR CUENTA</span><h2 id="af-methodsTitle">¿Dónde está el dinero?</h2><p>Efectivo, banco y billeteras; expandí una fila para ver cómo se calculó.</p></div><span className="af-chip">{medios.length} medios</span></div>
          <div className="af-panel af-methodPanel">
            <div className="af-tableScroll"><table className="af-mediumTable"><thead><tr><th>Medio de pago</th><th className="af-num">Arranque</th><th className="af-num">Aperturas</th><th className="af-num">Cobros</th><th className="af-num">Pagos</th><th className="af-num">Cierre</th><th/></tr></thead><tbody>{medios.map((m) => <MediumRow key={m.id} item={m} expanded={expandedId === m.id} toggle={() => setExpandedId((v) => v === m.id ? null : m.id)}/>)}</tbody><tfoot><tr><th>Total</th><th className="af-num">{money(fin.saldo_inicio)}</th><th className="af-num">{money(fin.saldo_inicial_aplicado)}</th><th className="af-num">{money(fin.ingresos)}</th><th className="af-num">{money(fin.egresos)}</th><th className="af-num">{money(fin.saldo_final)}</th><th/></tr></tfoot></table></div>
          </div>
        </section>

        <p className="af-disclaimer"><FontAwesomeIcon icon={faCircleInfo}/> Los saldos se calculan con los movimientos registrados en BALTO. Para conciliar el banco, comparalos con el extracto de cada cuenta. La rentabilidad usa la fecha del movimiento; la tesorería, la fecha de cobro o pago.</p>
      </>}
    </div>
  );
}
