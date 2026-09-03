import React, { useCallback, useMemo, useState } from "react";
import "./analisis_financiero.css";
import "../Global/Global_css/Global_oscuro.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRightLong,
  faCalendarDays,
  faChartLine,
  faChevronDown,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../Global/Toast.jsx";
import Calendario from "../Global/Calendario/Calendario.jsx";
import "../../components/Global/Calendario/calendario.css";
import BotonExportar from "../Global/Boton_Exportar/BotonExportar.jsx";

import { useDateRange } from "../../context/DateRangeContext.jsx";
import useAnalisisFinanciero from "./hooks/useAnalisisFinanciero";
import useAnalisisFinancieroDatos from "./hooks/useAnalisisFinancieroDatos";
import useAnalisisFinancieroExport from "./hooks/useAnalisisFinancieroExport";
import {
  formatDateUI,
  getMetricIcon,
  getMetricTone,
  moneyARS,
  safeText,
} from "./utils/analisisFinancieroUtils";

const SKELETON_ROWS = 5;

export default function Analisis_Financiero() {
  const { dateRange, setDateRange } = useDateRange();
  const [showCalendario, setShowCalendario] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => setToast({ tipo, mensaje, duracion }),
    []
  );
  const closeToast = useCallback(() => setToast(null), []);
  const handleLoadError = useCallback(
    (mensaje) => showToast("error", mensaje, 4200),
    [showToast]
  );

  const { data, error, hasFetched, loading, showSkeleton } = useAnalisisFinanciero({
    dateRange,
    onError: handleLoadError,
  });

  const {
    costoFijo,
    costoVariable,
    disponibilidades,
    mainRows,
    otrosEgresos,
    resultadoIsNeg,
    resultadoNeto,
    totalDisponibilidades,
    ventas,
  } = useAnalisisFinancieroDatos(data);

  const exportOptions = useAnalisisFinancieroExport({
    costoFijo,
    costoVariable,
    dateRange,
    disponibilidades,
    mainRows,
    otrosEgresos,
    resultadoNeto,
    showToast,
    totalDisponibilidades,
    ventas,
  });

  const dateRangeLabel = useMemo(() => {
    const { from, to } = dateRange;

    if (!from && !to) return "Seleccionar fechas";

    if (from && to) {
      if (
        from.getFullYear() === to.getFullYear() &&
        from.getMonth() === to.getMonth() &&
        from.getDate() === to.getDate()
      ) {
        return formatDateUI(from);
      }

      return (
        <>
          <span>{formatDateUI(from)}</span>
          <span className="mov-rangeArrow">
            <FontAwesomeIcon icon={faArrowRightLong} />
          </span>
          <span>{formatDateUI(to)}</span>
        </>
      );
    }

    if (from) return `Desde ${formatDateUI(from)}`;
    return `Hasta ${formatDateUI(to)}`;
  }, [dateRange]);

  const isLoading = loading && showSkeleton;

  return (
    <div className="mov-page mov-page--analisisFinanciero">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      {error && (
        <div className="mov-alert" role="alert">
          {error}
        </div>
      )}

      <section className="mov-card mov-card--table">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Análisis Financiero</div>
              <div className="mov-card__hint">
                Mostrando <b>{mainRows.length}</b> registros
                {loading && !showSkeleton ? " (actualizando…)" : ""}
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="mov-filter mov-filter--cal floatingField">
                <button
                  type="button"
                  className={`mov-calTrigger cc-calTrigger ${showCalendario ? "is-open" : ""}`}
                  onClick={() => setShowCalendario((v) => !v)}
                  disabled={loading}
                  title="Seleccionar rango de fechas"
                >
                  {dateRangeLabel}
                  <span className="mov-calTrigger__arrow">
                    <FontAwesomeIcon icon={faChevronDown} />
                  </span>
                </button>

                <span className="floatingLabel floatingLabel--active">
                  <FontAwesomeIcon icon={faCalendarDays} /> Período
                </span>

                {showCalendario && (
                  <div className="mov-calDropdown" id="clrRight">
                    <Calendario
                      value={dateRange}
                      onChange={(newRange) => {
                        setDateRange(newRange);
                        if (newRange?.from && newRange?.to) setShowCalendario(false);
                      }}
                      onClose={() => setShowCalendario(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            className="mov-card__actions"
            style={{ display: "flex", gap: 10, alignItems: "center" }}
          >
            <BotonExportar
              disabled={loading || (mainRows.length === 0 && disponibilidades.length === 0)}
              loading={false}
              label="Exportar"
              title={
                mainRows.length || disponibilidades.length
                  ? "Exportar archivo"
                  : "No hay datos para exportar"
              }
              opciones={exportOptions}
              align="right"
            />
          </div>
        </div>

        <div className="af-breakdownSection">
          <div className="af-sectionHead af-sectionHead--breakdown">
            <div>
              <div className="af-sectionTitle af-sectionTitle--light">
                Resumen del período
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="af-breakdownGrid af-breakdownGrid--skeleton">
              {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <div key={`af-card-skel-${i}`} className="af-breakCard af-breakCard--skeleton">
                  <span className="af-cardIconSkeleton" />
                  <span
                    className="mov-skeletonBar"
                    style={{ width: i % 2 === 0 ? "42%" : "58%", marginBottom: 10 }}
                  />
                  <span
                    className="mov-skeletonBar"
                    style={{ width: i % 2 === 0 ? "66%" : "54%", height: 18, marginBottom: 10 }}
                  />
                  <span
                    className="mov-skeletonBar"
                    style={{ width: i % 2 === 0 ? "48%" : "62%" }}
                  />
                </div>
              ))}
            </div>
          ) : data && mainRows.length > 0 ? (
            <div className="af-breakdownGrid">
              {mainRows
                .filter((r) => {
                  const conceptoLower = safeText(r.concepto).toLowerCase();
                  const isResultado =
                    conceptoLower === "resultado neto" ||
                    r.tipo === "resultado" ||
                    safeText(r.id).toLowerCase() === "resultado_neto";

                  return !isResultado;
                })
                .map((r) => {
                  const isEgreso = r.tipo === "egreso";
                  const isIngreso = r.tipo === "ingreso";
                  const tone = getMetricTone(r);

                  return (
                    <article
                      key={r.id}
                      className={["af-breakCard", `af-breakCard--${tone}`]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="af-breakCard__icon" aria-hidden="true">
                        <FontAwesomeIcon icon={getMetricIcon(r)} />
                      </div>

                      <div className="af-breakCard__body">
                        <span className="af-breakCard__label">{r.concepto}</span>

                        <strong
                          className={[
                            "af-breakCard__value",
                            isIngreso ? "af-breakCard__value--ingreso" : "",
                            isEgreso ? "af-breakCard__value--egreso" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {moneyARS(r.importe)}
                        </strong>

                        <span className="af-breakCard__sub">
                          {isIngreso
                            ? "Impacto positivo en el período"
                            : isEgreso
                            ? "Salida de dinero del período"
                            : "Valor calculado del período"}
                        </span>
                      </div>
                    </article>
                  );
                })}
            </div>
          ) : (
            !loading &&
            hasFetched && (
              <div className="mov-emptyRow af-emptyBlock">
                No hay movimientos para mostrar en el rango seleccionado.
              </div>
            )
          )}
        </div>

        {!loading && !isLoading && data && (
          <div className="af-footTotals">
            <article
              className={`af-totalCard ${
                resultadoIsNeg ? "af-totalCard--neg" : "af-totalCard--pos"
              }`}
            >
              <div className="af-totalCard__icon" aria-hidden="true">
                <FontAwesomeIcon icon={faChartLine} />
              </div>

              <div className="af-totalCard__body">
                <span className="af-totalLabel">Resultado Neto</span>

                <strong className="af-totalValue">
                  {resultadoNeto == null ? "—" : moneyARS(resultadoNeto)}
                </strong>

                <span className="af-totalSub">
                  {resultadoIsNeg ? "Pérdida" : "Ganancia"} del período · Ventas − costos − egresos
                </span>
              </div>
            </article>
          </div>
        )}

        {(isLoading || disponibilidades.length > 0) && (
          <div className="af-dispoSection">
            <div className="af-sectionHead">
              <div>
                <div className="af-sectionTitle">Disponibilidades</div>
              </div>

              <div className="af-dispoTotal">
                Total disponible: <strong>{moneyARS(totalDisponibilidades)}</strong>
              </div>
            </div>

            {isLoading ? (
              <div className="af-dispoGrid">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`dispo-skel-${i}`} className="af-dispoCard af-breakCard--skeleton">
                    <span className="af-cardIconSkeleton" />
                    <span
                      className="mov-skeletonBar"
                      style={{ width: i % 2 === 0 ? "40%" : "55%", marginBottom: 10 }}
                    />
                    <span
                      className="mov-skeletonBar"
                      style={{ width: i % 2 === 0 ? "62%" : "48%", height: 18, marginBottom: 10 }}
                    />
                    <span
                      className="mov-skeletonBar"
                      style={{ width: i % 2 === 0 ? "45%" : "58%" }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="af-dispoGrid">
                {disponibilidades.map((item) => (
                  <article key={item.id} className="af-dispoCard">
                    <div className="af-dispoCard__icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faWallet} />
                    </div>

                    <div className="af-dispoCard__body">
                      <span className="af-dispoCard__label">{item.nombre}</span>
                      <strong className="af-dispoCard__value">{moneyARS(item.importe)}</strong>
                      <span className="af-dispoCard__sub">Saldo disponible</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
