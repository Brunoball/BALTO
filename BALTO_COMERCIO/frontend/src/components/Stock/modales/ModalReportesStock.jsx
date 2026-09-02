import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faBoxesStacked,
  faChartColumn,
  faFileExcel,
  faFilePdf,
  faFilter,
  faLayerGroup,
  faMoneyBillTrendUp,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { isTopStockModal } from "./modalStackUtils";
import { generarReporteStock } from "../api/stockApi";
import "./ModalReportesStock.css";

const REPORT_TYPES = [
  { value: "inventario_general", label: "Inventario general", group: "Inventario" },
  { value: "stock_bajo", label: "Productos con stock bajo", group: "Inventario" },
  { value: "stock_alto", label: "Productos con mayor stock", group: "Inventario" },
  { value: "sin_stock", label: "Productos sin stock", group: "Inventario" },
  { value: "productos_por_categoria", label: "Productos por categoría", group: "Inventario" },
  { value: "productos_mas_vendidos", label: "Productos más vendidos", group: "Ventas" },
  { value: "productos_menos_vendidos", label: "Productos menos vendidos", group: "Ventas" },
  { value: "ventas_por_categoria", label: "Ventas por categoría", group: "Ventas" },
];

const SALES_TYPES = new Set([
  "productos_mas_vendidos",
  "productos_menos_vendidos",
  "ventas_por_categoria",
]);

function localDateParts() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return { today: `${year}-${month}-${day}`, monthStart: `${year}-${month}-01` };
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value) {
  const n = Number(value || 0);
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatCell(value, type) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return formatMoney(value);
  if (type === "number") return formatNumber(value);
  return String(value);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getColumnDescriptor(column = {}) {
  return normalizeText(`${column?.key || ""} ${column?.label || ""}`);
}

function isStatusColumn(column = {}) {
  return /estado|situacion/.test(getColumnDescriptor(column));
}

function isStockQuantityColumn(column = {}) {
  const descriptor = getColumnDescriptor(column);
  return (
    /stock/.test(descriptor) &&
    !/(valor|valuad|importe|monto|precio|costo)/.test(descriptor) &&
    column?.type !== "money"
  );
}

function getVisibleReportColumns(columns = []) {
  return (Array.isArray(columns) ? columns : []).filter((column) => !isStatusColumn(column));
}

function getReportGridTemplate(columns = []) {
  if (!Array.isArray(columns) || columns.length === 0) return "minmax(0, 1fr)";

  return columns
    .map((column) => {
      const descriptor = getColumnDescriptor(column);

      if (column?.type === "money" || column?.type === "number") {
        return "minmax(105px, .8fr)";
      }

      if (/(producto|nombre|descripcion|categor)/.test(descriptor)) {
        return "minmax(165px, 1.4fr)";
      }

      return "minmax(125px, 1fr)";
    })
    .join(" ");
}

function getRowIndicator(row = {}, columns = []) {
  const statusColumn = columns.find(isStatusColumn);
  const statusValue = statusColumn ? normalizeText(row?.[statusColumn.key]) : "";

  if (/(baja|inactiv|sin stock|agotad|cancel)/.test(statusValue)) {
    return { tone: "danger", label: "Crítico" };
  }
  if (/(bajo|pendiente|alerta)/.test(statusValue)) {
    return { tone: "warning", label: "Atención" };
  }
  if (/(activ|disponible|complet|vigente)/.test(statusValue)) {
    return { tone: "success", label: "Disponible" };
  }

  const stockColumn = columns.find(isStockQuantityColumn);
  if (stockColumn) {
    const stock = Number(row?.[stockColumn.key] || 0);
    if (stock <= 0) return { tone: "danger", label: "Sin stock" };
    if (stock <= 10) return { tone: "warning", label: "Stock bajo" };
    return { tone: "success", label: "Disponible" };
  }

  return { tone: "neutral", label: "Sin indicador" };
}

function getSummaryVisual(item = {}, index = 0) {
  const label = normalizeText(item?.label);

  if (/(venta|monto|importe|valor|total)/.test(label)) {
    return { icon: faMoneyBillTrendUp, tone: "green" };
  }
  if (/categor/.test(label)) {
    return { icon: faLayerGroup, tone: "pink" };
  }
  if (/(producto|item|unidad|stock)/.test(label)) {
    return { icon: faBoxesStacked, tone: "blue" };
  }

  const fallbackTones = ["yellow", "blue", "green", "pink"];
  return { icon: faChartColumn, tone: fallbackTones[index % fallbackTones.length] };
}

function getReportCellPresentation(column = {}, value) {
  if (value === null || value === undefined || value === "") return null;

  const descriptor = getColumnDescriptor(column);
  const formattedValue = formatCell(value, column?.type);

  if (/categor/.test(descriptor)) return null;

  if (/\bsku\b|codigo/.test(descriptor)) {
    return { label: formattedValue, tone: "code" };
  }

  if (/(posicion|ranking|puesto)/.test(descriptor)) {
    return { label: `#${formattedValue}`, tone: "rank" };
  }

  if (isStockQuantityColumn(column)) {
    const stock = Number(value || 0);
    if (stock <= 0) return { label: "Sin stock", tone: "danger" };
    if (stock <= 10) return { label: formattedValue, tone: "warning" };
    return { label: formattedValue, tone: "success" };
  }

  return null;
}

function renderReportCell(column, value) {
  const presentation = getReportCellPresentation(column, value);
  if (!presentation) return formatCell(value, column?.type);

  return (
    <span
      className={`rs-tableChip rs-tableChip--${presentation.tone}`}
      title={presentation.label}
    >
      {presentation.label}
    </span>
  );
}

function safeFilename(value) {
  return String(value || "reporte-stock")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "reporte-stock";
}

function normalizeCategory(cat = {}) {
  return {
    id: Number(cat?.id ?? cat?.id_stock_categoria ?? 0),
    parentId: Number(cat?.id_categoria_padre ?? cat?.parent_id ?? 0),
    name: String(cat?.nombre ?? cat?.name ?? "").trim(),
    active: Number(cat?.activo ?? 1) === 1,
  };
}

function flattenCategories(categories = []) {
  const normalized = (Array.isArray(categories) ? categories : [])
    .map(normalizeCategory)
    .filter((cat) => cat.id > 0 && cat.name && cat.active);
  const byParent = normalized.reduce((acc, cat) => {
    const key = cat.parentId || 0;
    if (!acc[key]) acc[key] = [];
    acc[key].push(cat);
    return acc;
  }, {});
  Object.values(byParent).forEach((items) => items.sort((a, b) => a.name.localeCompare(b.name, "es")));

  const out = [];
  const visited = new Set();
  const walk = (parentId, level) => {
    (byParent[parentId] || []).forEach((cat) => {
      if (visited.has(cat.id)) return;
      visited.add(cat.id);
      out.push({ ...cat, level });
      walk(cat.id, level + 1);
    });
  };
  walk(0, 0);
  normalized.forEach((cat) => {
    if (!visited.has(cat.id)) out.push({ ...cat, level: 0 });
  });
  return out;
}

async function fetchReport(params) {
  return generarReporteStock(params);
}

const ModalReportesStock = ({ open, onClose, onToast, categorias = [] }) => {
  const overlayRef = useRef(null);
  const requestRef = useRef(0);
  const dates = useMemo(localDateParts, []);
  const categoryOptions = useMemo(() => flattenCategories(categorias), [categorias]);

  const [tipo, setTipo] = useState("inventario_general");
  const [desde, setDesde] = useState(dates.monthStart);
  const [hasta, setHasta] = useState(dates.today);
  const [umbral, setUmbral] = useState("5");
  const [categoriaId, setCategoriaId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reporte, setReporte] = useState(null);

  const isSales = SALES_TYPES.has(tipo);
  const usesThreshold = tipo === "stock_bajo" || tipo === "stock_alto";

  const notify = useCallback((type, message) => {
    if (typeof onToast === "function") onToast(type, message);
  }, [onToast]);

  const generate = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const payload = {
        tipo,
        id_categoria: categoriaId || "0",
      };
      if (isSales) {
        payload.desde = desde;
        payload.hasta = hasta;
      }
      if (usesThreshold) payload.umbral = umbral || "0";

      const response = await fetchReport(payload);
      if (requestRef.current !== requestId) return;
      const data = response?.data && response.data?.tipo ? response.data : response;
      setReporte(data);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      const message = err?.message || "No se pudo generar el reporte.";
      setError(message);
      setReporte(null);
      notify("error", message);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [categoriaId, desde, hasta, isSales, notify, tipo, umbral, usesThreshold]);

  useEffect(() => {
    if (!open) return;
    generate();
    // La vista se genera al abrir y luego únicamente con el botón, para evitar
    // consultas mientras el usuario todavía está cambiando filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape" && isTopStockModal(overlayRef.current)) onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      requestRef.current += 1;
    };
  }, [onClose, open]);

  const downloadExcel = () => {
    const columns = getVisibleReportColumns(reporte?.columnas);
    const rows = Array.isArray(reporte?.filas) ? reporte.filas : [];
    const summaries = Array.isArray(reporte?.resumen) ? reporte.resumen : [];
    if (!columns.length) return;

    const title = reporte?.titulo || "Reporte de Stock";
    const generatedAt = reporte?.meta?.generado_en || "";
    const period = reporte?.meta?.desde || reporte?.meta?.hasta
      ? `${reporte?.meta?.desde || "—"} al ${reporte?.meta?.hasta || "—"}`
      : "";

    const sheetRows = [
      [title],
      [reporte?.descripcion || ""],
      generatedAt ? ["Generado", generatedAt] : [],
      period ? ["Período", period] : [],
      [],
    ].filter((row) => row.length > 0);

    if (summaries.length) {
      sheetRows.push(["RESUMEN"]);
      sheetRows.push(summaries.map((item) => item.label));
      sheetRows.push(summaries.map((item) => {
        if (item.type === "money" || item.type === "number") return Number(item.value || 0);
        return item.value ?? "";
      }));
      sheetRows.push([]);
    }

    const tableHeaderRow = sheetRows.length;
    sheetRows.push(columns.map((column) => column.label));
    rows.forEach((row) => {
      sheetRows.push(columns.map((column) => {
        const value = row?.[column.key];
        if (value === null || value === undefined) return "";
        if (column.type === "money" || column.type === "number") {
          const numeric = Number(value);
          return Number.isFinite(numeric) ? numeric : 0;
        }
        return String(value);
      }));
    });

    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const lastRow = sheetRows.length - 1;
    const lastColumn = Math.max(0, columns.length - 1);

    if (rows.length && columns.length) {
      worksheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: tableHeaderRow, c: 0 },
          e: { r: lastRow, c: lastColumn },
        }),
      };
    }

    columns.forEach((column, columnIndex) => {
      rows.forEach((_, rowIndex) => {
        const address = XLSX.utils.encode_cell({
          r: tableHeaderRow + 1 + rowIndex,
          c: columnIndex,
        });
        const cell = worksheet[address];
        if (!cell) return;
        if (column.type === "money") cell.z = '$ #,##0.00';
        if (column.type === "number") cell.z = '#,##0.00';
      });
    });

    if (summaries.length) {
      // El resumen siempre comienza luego de los metadatos y una fila vacía.
      const summaryHeaderIndex = sheetRows.findIndex((row) => row?.[0] === "RESUMEN");
      const summaryDataIndex = summaryHeaderIndex >= 0 ? summaryHeaderIndex + 2 : -1;
      if (summaryDataIndex >= 0) {
        summaries.forEach((item, index) => {
          const cell = worksheet[XLSX.utils.encode_cell({ r: summaryDataIndex, c: index })];
          if (!cell) return;
          if (item.type === "money") cell.z = '$ #,##0.00';
          if (item.type === "number") cell.z = '#,##0.00';
        });
      }
    }

    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const longest = rows.reduce((max, row) => {
        const value = formatCell(row?.[column.key], column.type);
        return Math.max(max, String(value).length);
      }, String(column.label).length);
      return { wch: Math.min(Math.max(longest + 2, 12), columnIndex === 0 ? 38 : 28) };
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte Stock");

    const suffix = reporte?.meta?.hasta || dates.today;
    XLSX.writeFile(workbook, `${safeFilename(title)}-${suffix}.xlsx`, { compression: true });
    notify("exito", "Reporte Excel descargado correctamente.");
  };

  const printReport = () => {
    if (!reporte) return;
    window.print();
  };

  if (!open || typeof document === "undefined") return null;

  const reportColumns = Array.isArray(reporte?.columnas) ? reporte.columnas : [];
  const columns = getVisibleReportColumns(reportColumns);
  const reportGridTemplate = getReportGridTemplate(columns);
  const rows = Array.isArray(reporte?.filas) ? reporte.filas : [];
  const summaries = Array.isArray(reporte?.resumen) ? reporte.resumen : [];
  const unlinkedItems = Number(reporte?.meta?.items_sin_producto || 0);

  return createPortal(
    <div
      ref={overlayRef}
      className="rs-modalOverlay"
      data-stock-modal-overlay="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && isTopStockModal(overlayRef.current)) onClose?.();
      }}
    >
      <div className="rs-modal" role="dialog" aria-modal="true" aria-labelledby="rs-modal-title">
        <header className="rs-modal__head">
          <div className="rs-modal__titleIcon"><FontAwesomeIcon icon={faChartColumn} /></div>
          <div>
            <h2 id="rs-modal-title">Reportes de Stock</h2>
            <p>Inventario, rotación, ventas y categorías con descarga para Excel o PDF.</p>
          </div>
          <button type="button" className="rs-modal__close" onClick={onClose} title="Cerrar">
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="rs-modal__body">
          <section className="rs-controls" aria-label="Filtros del reporte">
            <div className="rs-controls__title"><FontAwesomeIcon icon={faFilter} /> Configuración</div>
            <div className="rs-controls__grid">
              <label className="rs-field rs-field--wide">
                <span>Tipo de reporte</span>
                <select value={tipo} onChange={(event) => setTipo(event.target.value)} disabled={loading}>
                  {["Inventario", "Ventas"].map((group) => (
                    <optgroup label={group} key={group}>
                      {REPORT_TYPES.filter((item) => item.group === group).map((item) => (
                        <option value={item.value} key={item.value}>{item.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="rs-field">
                <span>Categoría</span>
                <select value={categoriaId} onChange={(event) => setCategoriaId(event.target.value)} disabled={loading}>
                  <option value="">Todas las categorías</option>
                  {categoryOptions.map((cat) => (
                    <option value={cat.id} key={cat.id}>
                      {`${"— ".repeat(Math.min(cat.level, 3))}${cat.name}`}
                    </option>
                  ))}
                </select>
              </label>

              {isSales ? (
                <>
                  <label className="rs-field">
                    <span>Desde</span>
                    <input type="date" value={desde} max={hasta || undefined} onChange={(event) => setDesde(event.target.value)} disabled={loading} />
                  </label>
                  <label className="rs-field">
                    <span>Hasta</span>
                    <input type="date" value={hasta} min={desde || undefined} onChange={(event) => setHasta(event.target.value)} disabled={loading} />
                  </label>
                </>
              ) : null}

              {usesThreshold ? (
                <label className="rs-field">
                  <span>{tipo === "stock_alto" ? "Stock mínimo" : "Stock máximo"}</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={umbral}
                    onChange={(event) => setUmbral(event.target.value.replace(/[^0-9]/g, ""))}
                    disabled={loading}
                  />
                </label>
              ) : null}

              <button type="button" className="mov-btn mov-btn--primary rs-generate" onClick={generate} disabled={loading}>
                <FontAwesomeIcon icon={faArrowsRotate} spin={loading} /> {loading ? "Generando..." : "Generar reporte"}
              </button>
            </div>
          </section>

          <section className="rs-printArea" id="stock-report-print-area">
            <div className="rs-reportHead">
              <div>
                <span className="rs-reportHead__eyebrow">BALTO · STOCK</span>
                <h3>{reporte?.titulo || "Reporte"}</h3>
                <p>{reporte?.descripcion || "Seleccioná los filtros y generá el reporte."}</p>
              </div>
              {reporte?.meta?.generado_en ? (
                <div className="rs-reportHead__meta">
                  <span>Generado</span>
                  <strong>{reporte.meta.generado_en}</strong>
                  {reporte?.meta?.desde ? <small>{reporte.meta.desde} al {reporte.meta.hasta}</small> : null}
                </div>
              ) : null}
            </div>

            {error ? <div className="rs-error">{error}</div> : null}

            {loading && !reporte ? (
              <div className="rs-empty">Generando reporte con los datos actuales...</div>
            ) : reporte ? (
              <>
                <div className="rs-summaryGrid">
                  {summaries.map((item, index) => {
                    const visual = getSummaryVisual(item, index);
                    return (
                      <article
                        className={`rs-summaryCard rs-summaryCard--${visual.tone}`}
                        key={`${item.label}-${index}`}
                      >
                        <div className="rs-summaryCard__icon" aria-hidden="true">
                          <FontAwesomeIcon icon={visual.icon} />
                        </div>
                        <div className="rs-summaryCard__body">
                          <span>{item.label}</span>
                          <strong title={formatCell(item.value, item.type)}>
                            {formatCell(item.value, item.type)}
                          </strong>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {unlinkedItems > 0 ? (
                  <div className="rs-warning">
                    <FontAwesomeIcon icon={faTriangleExclamation} />
                    <div>
                      <strong>Hay {formatNumber(unlinkedItems)} ítems de venta sin producto de Stock vinculado.</strong>
                      <span>No se incluyen en rankings por producto porque no existe una relación confiable para asignarlos.</span>
                    </div>
                  </div>
                ) : null}

                <div className="rs-tableMeta">
                  <span>Detalle del reporte</span>
                  <div className="rs-tableLegend" aria-label="Indicadores de estado">
                    <span><i className="rs-statusDot rs-statusDot--success" /> Disponible</span>
                    <span><i className="rs-statusDot rs-statusDot--warning" /> Atención</span>
                    <span><i className="rs-statusDot rs-statusDot--danger" /> Crítico</span>
                  </div>
                </div>

                <div className="rs-tableWrap">
                  <div
                    className="rs-table"
                    role="table"
                    aria-label="Detalle del reporte de stock"
                    aria-colcount={columns.length}
                    aria-rowcount={rows.length + 1}
                    style={{
                      "--rs-grid-template": reportGridTemplate,
                      "--rs-column-count": Math.max(columns.length, 1),
                    }}
                  >
                    <div className="rs-table__head" role="rowgroup">
                      <div className="rs-table__row rs-table__row--head" role="row">
                        {columns.map((column) => (
                          <div
                            role="columnheader"
                            key={column.key}
                            className={`rs-table__cell${column.type === "money" || column.type === "number" ? " is-number" : ""}`}
                          >
                            {column.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rs-table__body" role="rowgroup">
                      {rows.length === 0 ? (
                        <div className="rs-table__empty" role="row">
                          <div role="cell">No hay datos que cumplan los filtros seleccionados.</div>
                        </div>
                      ) : rows.map((row, rowIndex) => {
                        const indicator = getRowIndicator(row, reportColumns);
                        return (
                          <div
                            role="row"
                            className={`rs-table__row rs-tableRow rs-tableRow--${indicator.tone}`}
                            key={`${row?.id_stock_producto || "row"}-${row?.id_stock_variante || 0}-${rowIndex}`}
                            title={`Indicador: ${indicator.label}`}
                          >
                            {columns.map((column) => (
                              <div
                                role="cell"
                                key={column.key}
                                className={`rs-table__cell${column.type === "money" || column.type === "number" ? " is-number" : ""}`}
                              >
                                {renderReportCell(column, row?.[column.key])}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="rs-reportFooter">Total de filas: {formatNumber(reporte?.meta?.total_filas || rows.length)}</div>
              </>
            ) : (
              <div className="rs-empty">Todavía no se generó ningún reporte.</div>
            )}
          </section>
        </div>

        <footer className="rs-modal__footer">
          <span>Los reportes de ventas consideran únicamente ítems vinculados a productos del módulo Stock.</span>
          <div>
            <button type="button" className="mov-btn mov-btn--ghost" onClick={onClose}>Cerrar</button>
            <button type="button" className="mov-btn mov-btn--ghost" onClick={printReport} disabled={!reporte || loading}>
              <FontAwesomeIcon icon={faFilePdf} /> Imprimir / PDF
            </button>
            <button type="button" className="mov-btn mov-btn--primary" onClick={downloadExcel} disabled={!reporte || loading}>
              <FontAwesomeIcon icon={faFileExcel} /> Exportar Excel
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
};

export default ModalReportesStock;
