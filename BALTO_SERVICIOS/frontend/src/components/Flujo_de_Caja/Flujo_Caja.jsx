// src/components/Flujo_de_Caja/Flujo_Caja.jsx

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import "./flujo_caja.css";
import "./flujo_caja.responsive.css";
import "../Global/Global_css/Global_oscuro.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faFileExcel,
  faChevronDown,
  faChevronRight,
  faChevronLeft,
  faArrowRightLong,
  faWallet,
  faScaleBalanced,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../Global/Toast.jsx";
import Calendario from "../Global/Calendario/Calendario.jsx";
import "../../components/Global/Calendario/calendario.css";

import BotonExportar from "../Global/Boton_Exportar/BotonExportar.jsx";
import ModalAjusteSaldo from "./modales/ModalAjusteSaldo.jsx";
import ModalHistorialAjustes from "./modales/ModalHistorialAjustes.jsx";
import "./modales/ajustes_saldo.css";

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
  moneyARS,
  moneyARSSigned,
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
  const [paymentNavigation, setPaymentNavigation] = useState({
    overflow: false, canPrevious: false, canNext: false,
  });

  const { data, error, loading, showSkeleton, fetchResumen } = useFlujoCajaResumen(
    dateRange,
    showToast
  );

  // Ajustes de saldo: el backend informa si la función está habilitada y si
  // el usuario puede gestionarla (y lo vuelve a validar en cada endpoint).
  const [showAjuste, setShowAjuste] = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const puedeAjustar = Boolean(data?.ajustes_saldo?.habilitado && data?.ajustes_saldo?.puede_gestionar);
  const handleAjustesChanged = useCallback(() => { fetchResumen(); }, [fetchResumen]);

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
  const saldoHoy = data?.saldo_actual;
  const fechaSaldoHoy = data?.fecha_saldo_actual;
  const showing = rows.length;

  useEffect(() => {
    const scroller = paymentCardsRef.current;
    if (!scroller) {
      setPaymentNavigation({ overflow: false, canPrevious: false, canNext: false });
      return undefined;
    }

    const updateNavigation = () => {
      const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const next = {
        overflow: maxScroll > 2,
        canPrevious: scroller.scrollLeft > 2,
        canNext: scroller.scrollLeft < maxScroll - 2,
      };
      setPaymentNavigation((current) => Object.keys(next).every((key) => next[key] === current[key]) ? current : next);
    };

    scroller.scrollTo({ left: 0, behavior: "instant" });
    updateNavigation();
    scroller.addEventListener("scroll", updateNavigation, { passive: true });
    window.addEventListener("resize", updateNavigation);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateNavigation) : null;
    observer?.observe(scroller);
    Array.from(scroller.children).forEach((card) => observer?.observe(card));
    return () => {
      scroller.removeEventListener("scroll", updateNavigation);
      window.removeEventListener("resize", updateNavigation);
      observer?.disconnect();
    };
  }, [selectedRow?.fecha, selectedPaymentCards.length]);

  const movePaymentCards = useCallback((direction) => {
    const scroller = paymentCardsRef.current;
    const card = scroller?.firstElementChild;
    if (!scroller || !card) return;
    const gap = parseFloat(window.getComputedStyle(scroller).columnGap) || 0;
    const step = card.getBoundingClientRect().width + gap;
    scroller.scrollBy({
      left: direction * step,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, []);

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
      APERTURAS: Number(r.saldo_inicial_aplicado || 0),
      DEPOSITOS_NETOS: Number(r.ajustes_internos || 0),
      AJUSTES_MANUALES: Number(r.ajustes_manuales || 0),
      SALDO:    r.saldo    == null ? "" : Number(r.saldo),
    }));
  }, [rows]);

  const exportToExcel = useCallback(() => {
    const data = buildExportRows();
    const ws   = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 16 }];
    const numCols = ["INGRESOS", "EGRESOS", "APERTURAS", "DEPOSITOS_NETOS", "AJUSTES_MANUALES", "SALDO"];
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
    // Hoja explicativa: cómo se obtiene el saldo a partir de cada columna.
    const notes = XLSX.utils.aoa_to_sheet([
      ["CÓMO SE CALCULA EL SALDO"],
      ["SALDO = saldo del día anterior + APERTURAS + INGRESOS − EGRESOS + DEPOSITOS_NETOS + AJUSTES_MANUALES"],
      ["AJUSTES_MANUALES: correcciones de saldo registradas desde Flujo de Caja (no son ventas, compras, cobros ni pagos)."],
      ["DEPOSITOS_NETOS: depósitos y reversiones de cheques/eCheqs hacia el banco."],
      ["Las transferencias internas entre cajas mueven dinero entre medios de pago: no cambian el SALDO total ni son ingresos o egresos."],
      ["Saldo base al inicio del período", Number(bloque?.saldo_base ?? 0)],
    ]);
    notes["!cols"] = [{ wch: 110 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, notes, "Referencias");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([wbout], { type: "application/octet-stream" }), `${exportBaseName}.xlsx`);
  }, [buildExportRows, exportBaseName, bloque]);

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
      `APERTURAS: ${row.APERTURAS}`,
      `DEPÓSITOS NETOS: ${row.DEPOSITOS_NETOS}`,
      `AJUSTES MANUALES: ${row.AJUSTES_MANUALES}`,
      `SALDO: ${row.SALDO}`,
      "----------------------------------------",
    ].join("\n"));
    const header = [
      "FLUJO DE CAJA",
      "SALDO = saldo anterior + APERTURAS + INGRESOS - EGRESOS + DEPÓSITOS NETOS + AJUSTES MANUALES",
      "AJUSTES MANUALES: correcciones de saldo; no son ventas, compras, cobros ni pagos.",
      "TRANSFERENCIAS INTERNAS entre cajas: mueven dinero entre medios de pago y no cambian el SALDO total.",
      "========================================",
    ].join("\n");
    downloadBlob(`${header}\n${lines.join("\n")}`, `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
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
    ajustes:  ["30%", "42%", "36%", "28%"],
    saldo:    ["52%", "46%", "38%", "56%"],
  }), []);

  const gridCols = "minmax(82px, 0.8fr) repeat(4, minmax(96px, 1fr))";

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
        {["fecha", "ingresos", "egresos", "ajustes", "saldo"].map((key) => (
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

      <ModalAjusteSaldo
        open={showAjuste}
        onClose={() => setShowAjuste(false)}
        onSaved={handleAjustesChanged}
        onOpenHistorial={() => { setShowAjuste(false); setShowHistorial(true); }}
        showToast={showToast}
      />
      <ModalHistorialAjustes
        open={showHistorial}
        onClose={() => setShowHistorial(false)}
        onChanged={handleAjustesChanged}
        showToast={showToast}
      />

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
            {puedeAjustar && (
              <div className="fc-aj-headActions">
                <button
                  type="button"
                  className="mov-btn mov-btn--ghost fc-aj-headBtn fc-aj-headBtn--icon"
                  onClick={() => setShowHistorial(true)}
                  title="Historial de ajustes de saldo"
                  aria-label="Historial de ajustes de saldo"
                >
                  <FontAwesomeIcon icon={faClockRotateLeft} />
                  <span className="fc-aj-headBtn__text">Historial</span>
                </button>
                <button
                  type="button"
                  className="mov-btn mov-btn--primary fc-aj-headBtn"
                  onClick={() => setShowAjuste(true)}
                  disabled={loading && !data}
                  title="Corregir el saldo de una caja o medio de pago"
                  aria-label="Ajustar saldo"
                >
                  <FontAwesomeIcon icon={faScaleBalanced} />
                  <span className="fc-aj-headBtn__text">Ajustar saldo</span>
                </button>
              </div>
            )}
            <BotonExportar
              disabled={loading || rows.length === 0}
              loading={false}
              label="Exportar"
              title={rows.length ? "Exportar archivo" : "No hay datos para exportar"}
              opciones={exportOptions}
              align="right"
              entityLabel="registros de flujo"
              currentCount={rows.length}
              scopeEnabled={false}
            />
          </div>
        </div>

        {/* ===== SUBHEAD ===== */}
        <div className="fc-subhead">
          <div className="fc-subhead__name">
            Detalle por caja / medio de pago •
            Caja diaria
            <span className="fc-subhead__meta">
              &nbsp;•&nbsp;Saldo base al inicio del período: <b className={saldoBase < 0 ? "fc-saldo--neg" : "fc-saldo--pos"}>{moneyARSAbs(saldoBase)}</b>
              {saldoHoy != null && <>&nbsp;•&nbsp;Saldo disponible hoy ({fmtDateES(fechaSaldoHoy)}): <b className={Number(saldoHoy) < 0 ? "fc-saldo--neg" : "fc-saldo--pos"}>{moneyARS(saldoHoy)}</b></>}
            </span>
          </div>
        </div>

        {/* ===== TARJETAS DINÁMICAS POR MEDIO DE PAGO ===== */}
        <div className="fc-paymentSummary">

          {selectedPaymentCards.length ? (
            <div className={`fc-paymentSlider${selectedPaymentCards.length > 1 ? " fc-paymentSlider--multiple" : ""}`}>
              {paymentNavigation.overflow && (
                <>
                  <button type="button" className="fc-sliderArrow fc-sliderArrow--previous" onClick={() => movePaymentCards(-1)} disabled={!paymentNavigation.canPrevious} title="Ver tarjeta anterior" aria-label="Ver tarjeta anterior" aria-controls="fc-paymentCards">
                    <FontAwesomeIcon icon={faChevronLeft} />
                  </button>
                  <button type="button" className="fc-sliderArrow fc-sliderArrow--next" onClick={() => movePaymentCards(1)} disabled={!paymentNavigation.canNext} title="Ver siguiente tarjeta" aria-label="Ver siguiente tarjeta" aria-controls="fc-paymentCards">
                    <FontAwesomeIcon icon={faChevronRight} />
                  </button>
                </>
              )}
            <div id="fc-paymentCards" ref={paymentCardsRef} className="fc-paymentCards" tabIndex={0} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); movePaymentCards(event.key === "ArrowLeft" ? -1 : 1); } }} aria-label="Detalle de medios de pago del día seleccionado">
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
                      {Math.abs(Number(card.ajustes || 0)) >= 0.005 && (
                        <div className="fc-payCard__row fc-payCard__row--ajustes">
                          <span>Ajustes de saldo</span>
                          <b className={Number(card.ajustes) > 0 ? "is-positive" : "is-negative"}>{moneyARSSigned(card.ajustes)}</b>
                        </div>
                      )}
                      {/* Transferencias internas: neto firmado de la tarjeta; nunca son ingresos ni egresos. */}
                      {Math.abs(Number(card.transferencias || 0)) >= 0.005 && (
                        <div className="fc-payCard__row fc-payCard__row--transferencias" data-testid={`fc-card-transferencias-${card.key}`}>
                          <span>Transferencias internas</span>
                          <b className={Number(card.transferencias) > 0 ? "is-positive" : "is-negative"}>{moneyARSSigned(card.transferencias)}</b>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          ) : (
            <div className="fc-paymentEmpty">
              No hay medios monetarios configurados. Los cheques y eCheqs se muestran en cartera, no como disponibilidad.
            </div>
          )}
        </div>

        {/* ===== HEADER TABLA (4 cols) ===== */}
        <div
          className="mov-gridTable mov-gridTable--head"
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {["FECHA", "INGRESOS", "EGRESOS", "AJUSTES", "SALDO"].map((label) => (
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
                      title={`Ver detalle del día en las tarjetas superiores. Aperturas: ${moneyARSAbs(r.saldo_inicial_aplicado)}. Depósitos/reversiones de cheques: ${moneyARSAbs(r.ajustes_internos)}. Ajustes manuales de saldo: ${moneyARSSigned(r.ajustes_manuales)}${r.transferencias_cantidad ? `. Transferencias internas entre cajas: ${r.transferencias_cantidad} (no cambian el saldo total)` : ""}`}
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
                        <span className="mov-ellipsissss" title={String((fmtDateES(r.fecha)) ?? "")}>{fmtDateES(r.fecha)}</span>
                      </div>

                      {/* INGRESOS */}
                      <div className="mov-gridCell is-center" role="cell" data-label="INGRESOS">
                        <span className="fc-num fc-in" title={String((moneyARSAbs(r.ingresos)) ?? "")}>{moneyARSAbs(r.ingresos)}</span>
                      </div>

                      {/* EGRESOS */}
                      <div className="mov-gridCell is-center" role="cell" data-label="EGRESOS">
                        <span className="fc-num fc-eg" title={String((moneyARSAbs(r.egresos)) ?? "")}>{moneyARSAbs(r.egresos)}</span>
                      </div>

                      {/* AJUSTES manuales de saldo: columna propia, no es ingreso ni egreso */}
                      <div className="mov-gridCell is-center" role="cell" data-label="AJUSTES">
                        {(() => {
                          const aj = Number(r.ajustes_manuales || 0);
                          const tone = Math.abs(aj) < 0.005 ? "is-neutral" : aj > 0 ? "is-positive" : "is-negative";
                          const text = r.ingresos == null ? "—" : moneyARSSigned(aj);
                          return <span className={`fc-num fc-aj-cell ${tone}`} title={text}>{text}</span>;
                        })()}
                      </div>

                      {/* SALDO */}
                      <div className="mov-gridCell is-center" role="cell" data-label="SALDO">
                        <span className={`fc-num fc-saldo ${saldoNeg ? "fc-saldo--neg" : "fc-saldo--pos"}`} title={String((moneyARSAbs(r.saldo)) ?? "")}>
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



      </section>
    </div>
  );
}
