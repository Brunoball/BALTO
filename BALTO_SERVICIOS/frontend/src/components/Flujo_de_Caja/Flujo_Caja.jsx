// src/components/Flujo_de_Caja/Flujo_Caja.jsx

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./flujo_caja.css";
import "../Global/Global_css/Global_oscuro.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faFileExcel,
  faChevronDown,
  faChevronRight,
  faArrowRightLong,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../Global/Toast.jsx";
import Calendario from "../Global/Calendario/Calendario.jsx";
import "../../components/Global/Calendario/calendario.css";

import BotonExportar from "../Global/Boton_Exportar/BotonExportar.jsx";

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

import { useDateRange } from "../../context/DateRangeContext.jsx";
import useFlujoCajaResumen from "./hooks/useFlujoCajaResumen";
import {
  downloadBlob,
  escapeCSV,
  fmtDateES,
  formatDateISO,
  formatDateUI,
  moneyARSAbs,
  normalizeRows,
  paymentCardSubtitle,
  pickDefaultSelectedDate,
} from "./utils/flujoCajaUtils";

/* =========================
   Skeleton config
========================= */
const SKELETON_ROWS = 10;

export default function Flujo_Caja() {
  const { dateRange, setDateRange } = useDateRange();
  const [showCalendario, setShowCalendario] = useState(false);

  const [selectedDate, setSelectedDate] = useState("");

  const [toast, setToast] = useState(null);
  const showToast  = useCallback((tipo, mensaje, duracion = 2800) => setToast({ tipo, mensaje, duracion }), []);
  const closeToast = useCallback(() => setToast(null), []);

  const paymentCardsRef = useRef(null);
  const [activePaymentCardIndex, setActivePaymentCardIndex] = useState(0);

  const { data, error, loading, showSkeleton } = useFlujoCajaResumen(
    dateRange,
    showToast
  );

  const bloque  = data?.tiendas?.[0] || null;
  const rowsRaw = bloque?.rows || [];

  // Orden descendente por fecha (más reciente primero)
  const rows = useMemo(() => {
    const normalized = normalizeRows(rowsRaw);
    return [...normalized].sort((a, b) => {
      if (a.fecha < b.fecha) return 1;
      if (a.fecha > b.fecha) return -1;
      return 0;
    });
  }, [rowsRaw]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedDate("");
      return;
    }

    const exists = rows.some((r) => r.fecha === selectedDate);
    if (exists) return;

    setSelectedDate(pickDefaultSelectedDate(rows));
  }, [rows, selectedDate]);

  const selectedRow = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.fecha === selectedDate) || rows[0] || null;
  }, [rows, selectedDate]);

  const selectedPaymentCards = selectedRow?.medios_pago || [];
  const saldoBase = Number(bloque?.saldo_base ?? 0);
  const showing = rows.length;

  useEffect(() => {
    setActivePaymentCardIndex((current) => {
      if (!selectedPaymentCards.length) return 0;
      return Math.min(current, selectedPaymentCards.length - 1);
    });
  }, [selectedPaymentCards.length]);

  const goToNextPaymentCard = useCallback(() => {
    const total = selectedPaymentCards.length;
    if (total <= 1) return;

    setActivePaymentCardIndex((current) => {
      const next = (current + 1) % total;

      window.requestAnimationFrame(() => {
        const scroller = paymentCardsRef.current;
        const nextCard = scroller?.children?.[next];
        if (nextCard?.scrollIntoView) {
          nextCard.scrollIntoView({
            behavior: "smooth",
            inline: "start",
            block: "nearest",
          });
        }
      });

      return next;
    });
  }, [selectedPaymentCards.length]);

  /* =========================
     Label calendario
  ========================= */
  const dateRangeLabel = useMemo(() => {
    const { from, to } = dateRange;
    if (!from && !to) return "Seleccionar fechas";
    if (from && to) {
      if (
        from.getFullYear() === to.getFullYear() &&
        from.getMonth()    === to.getMonth()    &&
        from.getDate()     === to.getDate()
      ) return formatDateUI(from);
      return (
        <>
          <span>{formatDateUI(from)}</span>
          <span className="mov-rangeArrow"><FontAwesomeIcon icon={faArrowRightLong} /></span>
          <span>{formatDateUI(to)}</span>
        </>
      );
    }
    if (from) return `Desde ${formatDateUI(from)}`;
    return `Hasta ${formatDateUI(to)}`;
  }, [dateRange]);

  /* =========================
     Export base name
  ========================= */
  const exportBaseName = useMemo(() => {
    const { from, to } = dateRange;
    if (from && to) return `flujo_caja_${formatDateISO(from)}_${formatDateISO(to)}`;
    if (from) return `flujo_caja_desde_${formatDateISO(from)}`;
    return "flujo_caja";
  }, [dateRange]);

  /* =========================
     Export helpers
  ========================= */
  const buildExportRows = useCallback(() => {
    if (!rows.length) throw new Error("No hay datos para exportar.");
    return rows.map((r) => ({
      FECHA:    fmtDateES(r.fecha),
      INGRESOS: r.ingresos == null ? "" : Number(r.ingresos),
      EGRESOS:  r.egresos  == null ? "" : Number(r.egresos),
      SALDO:    r.saldo    == null ? "" : Number(r.saldo),
    }));
  }, [rows]);

  const exportToExcel = useCallback(() => {
    const data = buildExportRows();
    const ws   = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const numCols = ["INGRESOS", "EGRESOS", "SALDO"];
    const headers = Object.keys(data[0] || {});
    numCols.forEach((col) => {
      const ci = headers.findIndex((h) => h === col);
      if (ci < 0 || !ws["!ref"]) return;
      const colLetter = XLSX.utils.encode_col(ci);
      const range     = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[`${colLetter}${r + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    });
    const wb    = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FlujoCaja");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), `${exportBaseName}.xlsx`);
  }, [buildExportRows, exportBaseName]);

  const exportToCSV = useCallback(() => {
    const data    = buildExportRows();
    const headers = Object.keys(data[0] || {});
    const lines   = [
      headers.join(";"),
      ...data.map((row) => headers.map((h) => escapeCSV(row[h])).join(";")),
    ];
    downloadBlob("\uFEFF" + lines.join("\n"), `${exportBaseName}.csv`, "text/csv;charset=utf-8;");
  }, [buildExportRows, exportBaseName]);

  const exportToTXT = useCallback(() => {
    const data  = buildExportRows();
    const lines = data.map((row, i) => [
      `REGISTRO ${i + 1}`,
      `FECHA: ${row.FECHA}`,
      `INGRESOS: ${row.INGRESOS}`,
      `EGRESOS: ${row.EGRESOS}`,
      `SALDO: ${row.SALDO}`,
      "----------------------------------------",
    ].join("\n"));
    downloadBlob(lines.join("\n"), `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
  }, [buildExportRows, exportBaseName]);

  const handleExport = useCallback(
    async (type) => {
      try {
        if (type === "excel") { exportToExcel(); showToast("exito", "Excel exportado.", 2200); return; }
        if (type === "csv")   { exportToCSV();   showToast("exito", "CSV exportado.",   2200); return; }
        if (type === "txt")   { exportToTXT();   showToast("exito", "TXT exportado.",   2200); }
      } catch (e) {
        showToast("error", e?.message || "Error exportando archivo.", 3500);
      }
    },
    [exportToExcel, exportToCSV, exportToTXT, showToast]
  );

  const exportOptions = useMemo(() => [
    { key: "excel", label: "Exportar Excel (.xlsx)", icon: faFileExcel, onClick: () => handleExport("excel") },
    { key: "csv",   label: "Exportar CSV (.csv)",                        onClick: () => handleExport("csv")   },
    { key: "txt",   label: "Exportar TXT (.txt)",                        onClick: () => handleExport("txt")   },
  ], [handleExport]);

  /* =========================
     Skeleton row  (4 columnas)
  ========================= */
  const skelWidths = useMemo(() => ({
    fecha:    ["34%", "42%", "38%", "46%"],
    ingresos: ["48%", "40%", "52%", "36%"],
    egresos:  ["44%", "56%", "38%", "46%"],
    saldo:    ["52%", "46%", "38%", "56%"],
  }), []);

  const gridCols = "minmax(82px, 0.8fr) repeat(3, minmax(102px, 1fr))";

  const renderSkeletonRow = (idx) => {
    const w = (key) => {
      const list = skelWidths[key] || ["50%"];
      return list[idx % list.length];
    };
    return (
      <div
        key={`skel-${idx}`}
        className="mov-gridTable mov-gridTable--row mov-row--skeleton"
        style={{ gridTemplateColumns: gridCols }}
        role="row"
        aria-hidden="true"
      >
        {["fecha", "ingresos", "egresos", "saldo"].map((key) => (
          <div key={key} className="mov-gridCell is-center" role="cell">
            <span className="mov-skeletonBar" style={{ width: w(key) }} />
          </div>
        ))}
      </div>
    );
  };

  const isLoading = loading && showSkeleton;

  /* =========================
     RENDER
  ========================= */
  return (
    <div className="mov-page mov-page--flujoCaja">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}
      {error && <div className="mov-alert" role="alert">{error}</div>}

      <section className="mov-card mov-card--table">

        {/* ===== HEAD ===== */}
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Flujo de Caja</div>
              <div className="mov-card__hint">
                Mostrando <b>{showing}</b> registros
                {loading && !showSkeleton ? " (actualizando…)" : ""}
              </div>
            </div>

            {/* ===== FILTROS ===== */}
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
                  <span className="cc-calTrigger__iconRight">
                    <FontAwesomeIcon icon={faChevronDown} />
                  </span>
                </button>

                <span className="floatingLabel floatingLabel--active">
                  <FontAwesomeIcon icon={faCalendarDays} /> Período
                </span>

                {showCalendario && (
                  <div className="mov-calDropdown" id="calDropdown-Fl_cj">
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

          {/* ===== ACCIONES ===== */}
          <div className="mov-card__actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <BotonExportar
              disabled={loading || rows.length === 0}
              loading={false}
              label="Exportar"
              title={rows.length ? "Exportar archivo" : "No hay datos para exportar"}
              opciones={exportOptions}
              align="right"
            />
          </div>
        </div>

        {/* ===== SUBHEAD ===== */}
        <div className="fc-subhead">
          <div className="fc-subhead__name">
            Detalle por caja / medio de pago •
            Caja diaria
            <span className="fc-subhead__meta">
              &nbsp;•&nbsp;Saldo base: <b className={saldoBase < 0 ? "fc-saldo--neg" : "fc-saldo--pos"}>{moneyARSAbs(saldoBase)}</b>
            </span>
          </div>
        </div>

        {/* ===== TARJETAS DINÁMICAS POR MEDIO DE PAGO ===== */}
        <div className="fc-paymentSummary">

          {selectedPaymentCards.length > 1 && (
            <div className="fc-cardPager" aria-label="Navegación de tarjetas de medios de pago">
              <span className="fc-cardPager__counter">
                Tarjeta {Math.min(activePaymentCardIndex + 1, selectedPaymentCards.length)}/{selectedPaymentCards.length}
              </span>

              <button
                type="button"
                className="fc-cardPager__btn"
                onClick={goToNextPaymentCard}
                title="Ver siguiente tarjeta"
                aria-label="Ver siguiente tarjeta"
              >
                Siguiente
                <FontAwesomeIcon icon={faChevronRight} />
              </button>
            </div>
          )}

          {selectedPaymentCards.length ? (
            <div ref={paymentCardsRef} className="fc-paymentCards" aria-label="Detalle de medios de pago del día seleccionado">
              {selectedPaymentCards.map((card, index) => {
                const saldoNeg = Number(card.saldo) < 0;
                const tones = ["green", "blue", "pink", "yellow"];
                const tone = saldoNeg ? "red" : tones[index % tones.length];

                return (
                  <div key={card.key} className={`fc-payCard fc-payCard--${tone}`}>
                    <div className="fc-payCard__top">
                      <span className="fc-payCard__icon"><FontAwesomeIcon icon={faWallet} /></span>
                      <div className="fc-payCard__titleWrap">
                        <div className="fc-payCard__title">{card.label}</div>
                        <div className={`fc-payCard__amount ${saldoNeg ? "is-negative" : "is-positive"}`}>
                          {moneyARSAbs(card.saldo)}
                        </div>
                        <div className="fc-payCard__subtitle" title={`Saldo acumulado · ${paymentCardSubtitle(card)}`}>
                          Saldo acumulado · {paymentCardSubtitle(card)}
                        </div>
                      </div>
                    </div>

                    <div className="fc-payCard__rows">
                      <div className="fc-payCard__row">
                        <span>Ingresos</span>
                        <b className="fc-in">{moneyARSAbs(card.ingresos)}</b>
                      </div>
                      <div className="fc-payCard__row">
                        <span>Egresos</span>
                        <b className="fc-eg">{moneyARSAbs(card.egresos)}</b>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="fc-paymentEmpty">
              No hay medios de pago activos para mostrar. Las tarjetas se generan automáticamente desde la tabla medios_pago, excluyendo CHEQUE y ECHEQ.
            </div>
          )}
        </div>

        {/* ===== HEADER TABLA (4 cols) ===== */}
        <div
          className="mov-gridTable mov-gridTable--head"
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {["FECHA", "INGRESOS", "EGRESOS", "SALDO"].map((label) => (
            <div key={label} className="mov-gridCell mov-gridCell--head is-center" role="columnheader">
              {label}
            </div>
          ))}
        </div>

        {/* ===== BODY ===== */}
        <div className="mov-tableWrap" role="rowgroup" id="Flujo_Cj-tableWrap">
          <div className={["mov-gridBody mov-gridBody--relative", isLoading ? "mov-softLoading" : ""].join(" ")}>
            {isLoading ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
              </div>
            ) : (
              <>
                {rows.map((r) => {
                  const saldoNeg = Number(r.saldo) < 0;
                  const isSelected = selectedRow?.fecha === r.fecha;

                  return (
                    <div
                      key={r.fecha}
                      className={`mov-gridTable mov-gridTable--row fc-dayRow ${isSelected ? "fc-dayRow--selected" : ""}`}
                      style={{ gridTemplateColumns: gridCols }}
                      role="row"
                      tabIndex={0}
                      title="Ver detalle del día en las tarjetas superiores"
                      onClick={() => setSelectedDate(r.fecha)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setSelectedDate(r.fecha);
                        }
                      }}
                    >
                      {/* FECHA */}
                      <div className="mov-gridCell is-center" role="cell" data-label="FECHA">
                        <span className="mov-ellipsissss">{fmtDateES(r.fecha)}</span>
                      </div>

                      {/* INGRESOS */}
                      <div className="mov-gridCell is-center" role="cell" data-label="INGRESOS">
                        <span className="fc-num fc-in">{moneyARSAbs(r.ingresos)}</span>
                      </div>

                      {/* EGRESOS */}
                      <div className="mov-gridCell is-center" role="cell" data-label="EGRESOS">
                        <span className="fc-num fc-eg">{moneyARSAbs(r.egresos)}</span>
                      </div>

                      {/* SALDO */}
                      <div className="mov-gridCell is-center" role="cell" data-label="SALDO">
                        <span className={`fc-num fc-saldo ${saldoNeg ? "fc-saldo--neg" : "fc-saldo--pos"}`}>
                          {moneyARSAbs(r.saldo)}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {!rows.length && !loading && (
                  <div className="mov-emptyRow">
                    No hay datos para mostrar en el rango de fechas seleccionado.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Nota al pie */}
        <div className="fc-footnote">
          * Ingresos: ventas de contado + ventas en cuenta corriente ya cobradas.
          Egresos: compras de contado + compras en cuenta corriente ya pagadas.
        </div>

      </section>
    </div>
  );
}
