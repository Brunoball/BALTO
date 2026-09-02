import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxOpen,
  faCalendarDays,
  faChevronDown,
  faFileExcel,
  faMagnifyingGlass,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_responsive.css";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";
import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import Toast from "../../Global/Toast.jsx";
import { useDateRange } from "../../../context/DateRangeContext";
import "../contabilidad.css";
import useIvaRegistros from "../hooks/useIvaRegistros";
import { formatCurrency } from "../utils/contabilidadUtils";

const columnas = [
  { key: "fecha", label: "Fecha" },
  { key: "cliente", label: "Cliente" },
  { key: "subtotal", label: "Subtotal", align: "right" },
  { key: "iva", label: "IVA", align: "right" },
  { key: "total", label: "Total", align: "right" },
];

const gridCols = "0.9fr minmax(190px, 1.8fr) 1fr 0.9fr 1fr";
const IVA_COMPRAS_ALIASES = ["iva_compras"];

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function startOfDay(date) {
  if (!date) return null;
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseRowFecha(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return startOfDay(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return startOfDay(new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function formatFechaDMY(value) {
  const d = parseRowFecha(value);
  if (!d) return String(value ?? "—").trim() || "—";

  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function dateToAPI(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateUI(date) {
  if (!date) return "—";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function rowInDateRange(row, from, to) {
  if (!from && !to) return true;

  const fecha = parseRowFecha(row?.fecha);
  if (!fecha) return true;

  if (from && fecha < startOfDay(from)) return false;

  if (to) {
    const toEnd = startOfDay(to);
    toEnd.setHours(23, 59, 59, 999);
    if (fecha > toEnd) return false;
  }

  return true;
}

function getCliente(row) {
  return String(row?.cliente || row?.proveedor || row?.entidad || row?.razon_social || "").trim() || "SIN CLIENTE";
}

function getIva(row) {
  return Number(row?.iva ?? row?.iva_monto ?? row?.monto_iva ?? 0) || 0;
}

function rowMatchesQuery(row, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;

  const subtotal = Number(row?.subtotal || 0) || 0;
  const iva = getIva(row);
  const total = Number(row?.total || 0) || 0;

  const searchable = [
    row?.fecha,
    formatFechaDMY(row?.fecha),
    getCliente(row),
    row?.cliente,
    row?.proveedor,
    row?.entidad,
    row?.razon_social,
    subtotal,
    iva,
    total,
    formatCurrency(subtotal),
    formatCurrency(iva),
    formatCurrency(total),
  ];

  return normalizeSearchText(searchable.join(" | ")).includes(q);
}

function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function useTableScrollWatcher() {
  const tableWrapRef = useRef(null);
  const [hasTableScroll, setHasTableScroll] = useState(false);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return undefined;

    let frameId = 0;

    const checkScroll = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const nextHasScroll = tableWrap.scrollHeight > tableWrap.clientHeight + 1;
        setHasTableScroll(nextHasScroll);
      });
    };

    checkScroll();

    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(tableWrap);

    if (tableWrap.firstElementChild) {
      resizeObserver.observe(tableWrap.firstElementChild);
    }

    window.addEventListener("resize", checkScroll);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", checkScroll);
    };
  }, []);

  return { tableWrapRef, hasTableScroll };
}

function slugifySheetName(name) {
  return String(name || "IVA Compras")
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || "IVA Compras";
}


const SKELETON_ROWS = 10;

function IvaTableSkeleton() {
  const widths = ["54%", "72%", "58%", "48%", "62%"];

  return (
    <div className="mov-skeletonWrap contabilidad-skeletonWrap" aria-label="Cargando registros">
      {Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
        <div
          key={`iva-skeleton-${rowIndex}`}
          className="mov-gridTable mov-gridTable--row mov-row--skeleton contabilidad-skeletonRow"
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {widths.map((width, colIndex) => (
            <div
              key={`iva-skeleton-${rowIndex}-${colIndex}`}
              className={[
                "mov-gridCell",
                colIndex >= 2 ? "is-right" : "",
              ].join(" ")}
              role="cell"
            >
              <span className="mov-skeletonBar" style={{ width }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    FECHA: formatFechaDMY(row?.fecha),
    CLIENTE: getCliente(row),
    SUBTOTAL: Number(row?.subtotal || 0) || 0,
    IVA: getIva(row),
    TOTAL: Number(row?.total || 0) || 0,
  }));
}

export default function IVACompras() {
  const { dateRange, setDateRange } = useDateRange();
  const { registros, loading, error } = useIvaRegistros({
    action: "contabilidad_iva_compras",
    aliases: IVA_COMPRAS_ALIASES,
    errorMessage: "Error cargando IVA compras.",
  });
  const [showCalendario, setShowCalendario] = useState(false);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState(null);

  const range = dateRange || { from: null, to: null };

  const filteredRegistros = useMemo(() => {
    return registros.filter((row) => rowInDateRange(row, range.from, range.to) && rowMatchesQuery(row, q));
  }, [registros, range.from, range.to, q]);

  const { tableWrapRef, hasTableScroll } = useTableScrollWatcher();

  const totales = useMemo(() => {
    return filteredRegistros.reduce(
      (acc, item) => ({
        subtotal: acc.subtotal + (Number(item.subtotal || 0) || 0),
        iva: acc.iva + getIva(item),
        total: acc.total + (Number(item.total || 0) || 0),
      }),
      { subtotal: 0, iva: 0, total: 0 }
    );
  }, [filteredRegistros]);

  const dateRangeLabel = useMemo(() => {
    if (range.from && range.to) return `${formatDateUI(range.from)} — ${formatDateUI(range.to)}`;
    if (range.from) return `Desde ${formatDateUI(range.from)}`;
    if (range.to) return `Hasta ${formatDateUI(range.to)}`;
    return "Todos los períodos";
  }, [range.from, range.to]);

  const exportBaseName = useMemo(() => {
    if (range.from && range.to) return `iva_compras_${dateToAPI(range.from)}_${dateToAPI(range.to)}`;
    if (range.from) return `iva_compras_desde_${dateToAPI(range.from)}`;
    if (range.to) return `iva_compras_hasta_${dateToAPI(range.to)}`;
    return "iva_compras_todos";
  }, [range.from, range.to]);

  const getExportData = () => {
    const dataToExport = buildExportRows(filteredRegistros);
    if (!dataToExport.length) throw new Error("No hay datos para exportar.");
    return dataToExport;
  };

  const exportToExcel = () => {
    const dataToExport = getExportData();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const headers = Object.keys(dataToExport[0] || {});

    ["SUBTOTAL", "IVA", "TOTAL"].forEach((header) => {
      const colIndex = headers.findIndex((h) => h === header);
      if (colIndex < 0 || !ws["!ref"]) return;

      const colLetter = XLSX.utils.encode_col(colIndex);
      const rangeWs = XLSX.utils.decode_range(ws["!ref"]);
      for (let row = rangeWs.s.r + 1; row <= rangeWs.e.r; row += 1) {
        const cell = ws[`${colLetter}${row + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    });

    XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("IVA_Compras"));
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
  };

  const exportToCSV = () => {
    const dataToExport = getExportData();
    const headers = Object.keys(dataToExport[0] || {});
    const lines = [
      headers.join(";"),
      ...dataToExport.map((row) => headers.map((header) => escapeCSV(row[header])).join(";")),
    ];
    downloadBlob(`\uFEFF${lines.join("\n")}`, `${exportBaseName}.csv`, "text/csv;charset=utf-8;");
  };

  const exportToTXT = () => {
    const dataToExport = getExportData();
    const lines = dataToExport.map((row, index) =>
      [
        `REGISTRO ${index + 1}`,
        `FECHA: ${row.FECHA}`,
        `CLIENTE: ${row.CLIENTE}`,
        `SUBTOTAL: ${formatCurrency(row.SUBTOTAL)}`,
        `IVA: ${formatCurrency(row.IVA)}`,
        `TOTAL: ${formatCurrency(row.TOTAL)}`,
        "----------------------------------------",
      ].join("\n")
    );
    downloadBlob(lines.join("\n"), `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
  };

  const handleExport = async (type) => {
    try {
      if (type === "excel") exportToExcel();
      if (type === "csv") exportToCSV();
      if (type === "txt") exportToTXT();
      setToast({ tipo: "exito", mensaje: "Archivo exportado correctamente.", duracion: 2200 });
    } catch (err) {
      setToast({ tipo: "error", mensaje: err?.message || "Error exportando archivo.", duracion: 3500 });
    }
  };

  const exportOptions = useMemo(
    () => [
      { key: "excel", label: "Exportar Excel (.xlsx)", icon: faFileExcel, onClick: () => handleExport("excel") },
      { key: "csv", label: "Exportar CSV (.csv)", onClick: () => handleExport("csv") },
      { key: "txt", label: "Exportar TXT (.txt)", onClick: () => handleExport("txt") },
    ],
    [filteredRegistros, exportBaseName]
  );

  const emptyText = loading
    ? "Cargando registros de IVA compras..."
    : error || (q.trim() ? `No se encontraron compras para "${q.trim()}".` : "No hay registros de IVA compras para mostrar en el rango seleccionado.");

  return (
    <div className="mov-page contabilidad-page">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <section
        className={[
          "mov-card mov-card--table contabilidad-cardTable",
          hasTableScroll ? "has-table-scroll" : "",
        ].join(" ")}
      >
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">IVA Compras</div>
              <div className="mov-card__hint">
                Mostrando <b>{filteredRegistros.length}</b> registros de IVA compras
                {registros.length !== filteredRegistros.length ? ` de ${registros.length}` : ""}
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="cc-filter cc-filter--cal">
                <div className={`cc-floatingField cc-floatingField--calendar is-active ${showCalendario ? "is-open" : ""}`}>
                  <button
                    type="button"
                    className={`cc-calTrigger ${showCalendario ? "is-open" : ""}`}
                    onClick={() => setShowCalendario((value) => !value)}
                    disabled={loading}
                    title="Seleccionar rango de fechas"
                  >
                    {dateRangeLabel}
                    <span className="cc-calTrigger__iconRight">
                      <FontAwesomeIcon icon={faChevronDown} />
                    </span>
                  </button>
                  <span className="cc-floatingLabel cc-floatingLabel--active">
                    <FontAwesomeIcon icon={faCalendarDays} /> Período
                  </span>
                  {showCalendario && (
                    <div className="cc-calDropdown">
                      <Calendario
                        value={range}
                        onChange={(newRange) => {
                          if (newRange.from && newRange.to) setShowCalendario(false);
                          setDateRange(newRange);
                        }}
                        onClose={() => setShowCalendario(false)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="cc-filter cc-filter--search contabilidad-searchFilter">
                <div className="cc-floatingField cc-floatingField--search is-active">
                  <div className="cc-searchInput">
                    <div className="cc-searchInput__fieldWrap">
                      <input
                        className="cc-input cc-input--floating"
                        id="iva-compras-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Buscar por cliente, fecha, subtotal, IVA o total..."
                        disabled={loading}
                      />
                      <span className="cc-floatingLabel">
                        <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                      </span>
                      {q.trim() !== "" && (
                        <button
                          type="button"
                          className="cc-clearSearch cc-clearSearch--inside"
                          title="Limpiar búsqueda"
                          onClick={() => setQ("")}
                        >
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mov-card__actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <BotonExportar
              disabled={loading || filteredRegistros.length === 0}
              loading={false}
              label="Exportar"
              title={filteredRegistros.length ? "Exportar archivo" : "No hay datos para exportar"}
              opciones={exportOptions}
              align="right"
            />
          </div>
        </div>

        <div
          className={[
            "mov-gridTable mov-gridTable--head contabilidad-gridHead",
            hasTableScroll ? "has-scrollbar-gutter" : "",
          ].join(" ")}
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {columnas.map((col) => (
            <div
              key={col.key}
              className={[
                "mov-gridCell",
                "mov-gridCell--head",
                col.align === "right" ? "is-right" : "",
              ].join(" ")}
              role="columnheader"
            >
              {col.label}
            </div>
          ))}
        </div>

        <div ref={tableWrapRef} className="mov-tableWrap contabilidad-tableWrap" role="rowgroup">
          <div className="mov-gridBody mov-gridBody--relative">
            {loading ? (
              <IvaTableSkeleton />
            ) : filteredRegistros.length === 0 ? (
              <div className="cc-emptyState contabilidad-emptyState">
                <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                <div className="cc-emptyText">{emptyText}</div>
              </div>
            ) : (
              filteredRegistros.map((item) => (
                <div
                  key={item.id || `${item.id_movimiento}-${item.id_item}-${item.fecha}`}
                  className="mov-gridTable mov-gridTable--row"
                  style={{ gridTemplateColumns: gridCols }}
                  role="row"
                >
                  <div className="mov-gridCell" role="cell">{formatFechaDMY(item.fecha)}</div>
                  <div className="mov-gridCell" role="cell">{getCliente(item)}</div>
                  <div className="mov-gridCell is-right" role="cell">{formatCurrency(item.subtotal)}</div>
                  <div className="mov-gridCell is-right" role="cell">{formatCurrency(getIva(item))}</div>
                  <div className="mov-gridCell is-right is-strong" role="cell">{formatCurrency(item.total)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {loading ? (
          <div
            className="mov-gridTable contabilidad-totalRow contabilidad-totalRow--skeleton"
            style={{ gridTemplateColumns: gridCols }}
            role="row"
            aria-hidden="true"
          >
            <div className="mov-gridCell is-strong" role="cell">
              <span className="mov-skeletonBar" style={{ width: "58%" }} />
            </div>
            <div className="mov-gridCell" role="cell" />
            <div className="mov-gridCell is-right is-strong" role="cell">
              <span className="mov-skeletonBar" style={{ width: "58%" }} />
            </div>
            <div className="mov-gridCell is-right is-strong" role="cell">
              <span className="mov-skeletonBar" style={{ width: "48%" }} />
            </div>
            <div className="mov-gridCell is-right is-strong" role="cell">
              <span className="mov-skeletonBar" style={{ width: "62%" }} />
            </div>
          </div>
        ) : filteredRegistros.length > 0 && (
          <div
            className="mov-gridTable contabilidad-totalRow"
            style={{ gridTemplateColumns: gridCols }}
            role="row"
          >
            <div className="mov-gridCell is-strong" role="cell">Totales</div>
            <div className="mov-gridCell" role="cell" />
            <div className="mov-gridCell is-right is-strong" role="cell">{formatCurrency(totales.subtotal)}</div>
            <div className="mov-gridCell is-right is-strong" role="cell">{formatCurrency(totales.iva)}</div>
            <div className="mov-gridCell is-right is-strong" role="cell">{formatCurrency(totales.total)}</div>
          </div>
        )}
      </section>
    </div>
  );
}
