import { useCallback, useMemo } from "react";
import { faFileExcel } from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import {
  downloadBlob,
  escapeCSV,
  formatDateISO,
  numOrNull,
  safeText,
  sanitizeFilePart,
} from "../utils/analisisFinancieroUtils";

export default function useAnalisisFinancieroExport({
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
}) {
  const exportBaseName = useMemo(() => {
    const { from, to } = dateRange;
    const rangeStamp = `${formatDateISO(from)}_${formatDateISO(to || from)}`;
    return `Analisis_Financiero_${sanitizeFilePart(rangeStamp)}`;
  }, [dateRange]);

  const buildExportData = useCallback(() => {
    if (!mainRows.length && !disponibilidades.length) {
      throw new Error("No hay datos para exportar.");
    }

    return {
      analisis: mainRows.map((r) => ({
        CONCEPTO: safeText(r.concepto),
        IMPORTE: numOrNull(r.importe),
      })),
      disponibilidades: disponibilidades.map((d) => ({
        CAJA: safeText(d.nombre),
        IMPORTE: numOrNull(d.importe),
      })),
    };
  }, [mainRows, disponibilidades]);

  const exportToExcel = useCallback(() => {
    const exportData = buildExportData();
    const wb = XLSX.utils.book_new();

    const wsTabla = XLSX.utils.json_to_sheet(exportData.analisis, {
      header: ["CONCEPTO", "IMPORTE"],
    });
    wsTabla["!cols"] = [{ wch: 40 }, { wch: 18 }];

    if (wsTabla["!ref"]) {
      const range = XLSX.utils.decode_range(wsTabla["!ref"]);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = wsTabla[`B${r + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    }

    XLSX.utils.book_append_sheet(wb, wsTabla, "Analisis");

    if (exportData.disponibilidades.length) {
      const wsDisp = XLSX.utils.json_to_sheet(exportData.disponibilidades, {
        header: ["CAJA", "IMPORTE"],
      });
      wsDisp["!cols"] = [{ wch: 34 }, { wch: 18 }];

      if (wsDisp["!ref"]) {
        const range = XLSX.utils.decode_range(wsDisp["!ref"]);
        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const cell = wsDisp[`B${r + 1}`];
          if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
        }
      }

      XLSX.utils.book_append_sheet(wb, wsDisp, "Disponibilidades");
    }

    const resumenData = [
      { CAMPO: "DESDE", VALOR: formatDateISO(dateRange.from) },
      { CAMPO: "HASTA", VALOR: formatDateISO(dateRange.to || dateRange.from) },
      { CAMPO: "VENTAS", VALOR: numOrNull(ventas) },
      { CAMPO: "COSTO_VARIABLE", VALOR: numOrNull(costoVariable) },
      { CAMPO: "COSTO_FIJO", VALOR: numOrNull(costoFijo) },
      { CAMPO: "OTROS_EGRESOS", VALOR: numOrNull(otrosEgresos) },
      { CAMPO: "RESULTADO_NETO", VALOR: numOrNull(resultadoNeto) },
      { CAMPO: "TOTAL_DISPONIBILIDADES", VALOR: numOrNull(totalDisponibilidades) },
    ];

    const wsResumen = XLSX.utils.json_to_sheet(resumenData, {
      header: ["CAMPO", "VALOR"],
    });
    wsResumen["!cols"] = [{ wch: 24 }, { wch: 24 }];

    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
  }, [
    buildExportData,
    exportBaseName,
    dateRange,
    ventas,
    costoVariable,
    costoFijo,
    otrosEgresos,
    resultadoNeto,
    totalDisponibilidades,
  ]);

  const exportToCSV = useCallback(() => {
    const exportData = buildExportData();
    const blocks = [];

    blocks.push("ANALISIS FINANCIERO");
    blocks.push("CONCEPTO;IMPORTE");
    exportData.analisis.forEach((row) => {
      blocks.push(`${escapeCSV(row.CONCEPTO)};${escapeCSV(row.IMPORTE)}`);
    });

    if (exportData.disponibilidades.length) {
      blocks.push("");
      blocks.push("DISPONIBILIDADES");
      blocks.push("CAJA;IMPORTE");
      exportData.disponibilidades.forEach((row) => {
        blocks.push(`${escapeCSV(row.CAJA)};${escapeCSV(row.IMPORTE)}`);
      });
    }

    downloadBlob(
      "\uFEFF" + blocks.join("\n"),
      `${exportBaseName}.csv`,
      "text/csv;charset=utf-8;"
    );
  }, [buildExportData, exportBaseName]);

  const exportToTXT = useCallback(() => {
    const exportData = buildExportData();
    const lines = [];

    lines.push("ANALISIS FINANCIERO");
    lines.push("----------------------------------------");

    exportData.analisis.forEach((row, i) => {
      lines.push(`REGISTRO ${i + 1}`);
      lines.push(`CONCEPTO: ${row.CONCEPTO}`);
      lines.push(`IMPORTE: ${row.IMPORTE ?? ""}`);
      lines.push("----------------------------------------");
    });

    if (exportData.disponibilidades.length) {
      lines.push("");
      lines.push("DISPONIBILIDADES");
      lines.push("----------------------------------------");

      exportData.disponibilidades.forEach((row, i) => {
        lines.push(`CAJA ${i + 1}`);
        lines.push(`NOMBRE: ${row.CAJA}`);
        lines.push(`IMPORTE: ${row.IMPORTE ?? ""}`);
        lines.push("----------------------------------------");
      });
    }

    downloadBlob(
      lines.join("\n"),
      `${exportBaseName}.txt`,
      "text/plain;charset=utf-8;"
    );
  }, [buildExportData, exportBaseName]);

  const handleExport = useCallback(
    async (type) => {
      try {
        if (type === "excel") {
          exportToExcel();
          showToast("exito", "Excel exportado.", 2200);
          return;
        }
        if (type === "csv") {
          exportToCSV();
          showToast("exito", "CSV exportado.", 2200);
          return;
        }
        if (type === "txt") {
          exportToTXT();
          showToast("exito", "TXT exportado.", 2200);
        }
      } catch (e) {
        showToast("error", e?.message || "Error exportando archivo.", 3500);
      }
    },
    [exportToExcel, exportToCSV, exportToTXT, showToast]
  );

  return useMemo(
    () => [
      {
        key: "excel",
        label: "Exportar Excel (.xlsx)",
        icon: faFileExcel,
        onClick: () => handleExport("excel"),
      },
      {
        key: "csv",
        label: "Exportar CSV (.csv)",
        onClick: () => handleExport("csv"),
      },
      {
        key: "txt",
        label: "Exportar TXT (.txt)",
        onClick: () => handleExport("txt"),
      },
    ],
    [handleExport]
  );
}
