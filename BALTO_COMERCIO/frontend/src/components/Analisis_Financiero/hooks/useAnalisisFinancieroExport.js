import { useCallback, useMemo } from "react";
import { faFileExcel } from "@fortawesome/free-solid-svg-icons";
import * as XLSX from "xlsx";
import { downloadBlob, escapeCSV, formatDateISO, sanitizeFilePart, toNumberOrZero } from "../utils/analisisFinancieroUtils";

// Exportar el MISMO corte y las MISMAS cifras mostradas por el backend.
// Saldos iniciales y valores patrimoniales nunca se cuentan como ingresos operativos.
export default function useAnalisisFinancieroExport({
  dateRange, ventas, otrosIngresos = 0, costoVariable, costoFijo, otrosEgresos,
  gastosPersonales = 0, deudasPorCobrar = 0, deudasPorPagar = 0,
  resultadoNeto, tesoreria, showToast,
}) {
  const fileName = useMemo(() => `Analisis_Financiero_${sanitizeFilePart(`${formatDateISO(dateRange.from)}_${formatDateISO(dateRange.to || dateRange.from)}`)}`, [dateRange]);

  const getData = useCallback(() => {
    if (!tesoreria) throw new Error("No se cargaron los datos para exportar.");
    const n = (value) => toNumberOrZero(value);
    const summary = [
      ["Desde", formatDateISO(dateRange.from)], ["Hasta", formatDateISO(dateRange.to || dateRange.from)],
      ["Corte efectivo", tesoreria.fecha_corte],
      ["Saldo de arranque", n(tesoreria.saldo_inicio)],
      ["Aperturas del período", n(tesoreria.saldo_inicial_aplicado)],
      ["Cobros período", n(tesoreria.ingresos)],
      ["Pagos período", n(tesoreria.egresos)],
      ["Depósitos/reversiones de cheques", n(tesoreria.ajustes_internos)],
      ["Saldo de cierre", n(tesoreria.saldo_final)],
      ["Variación neta de tesorería", n(tesoreria.variacion)],
      ["Ventas cobradas (fecha movimiento)", n(ventas)],
      ["Otros ingresos (fecha movimiento)", n(otrosIngresos)],
      ["Costo variable", n(costoVariable)],
      ["Costo fijo", n(costoFijo)],
      ["Otros egresos", n(otrosEgresos)],
      ["Resultado operativo", n(resultadoNeto)],
      ["Retiros / gastos personales", n(gastosPersonales)],
      ["Pendiente por cobrar", n(deudasPorCobrar)],
      ["Pendiente por pagar", n(deudasPorPagar)],
    ].map(([concepto, importe]) => ({ CONCEPTO: concepto, IMPORTE: importe }));
    const media = (tesoreria.medios || []).map((m) => ({
      MEDIO: m.nombre, ACTIVO: m.activo ? "Sí" : "No",
      SALDO_ARRANQUE: n(m.saldo_inicio), APERTURAS_PERIODO: n(m.saldo_inicial_aplicado),
      COBROS: n(m.ingresos), PAGOS: n(m.egresos), AJUSTES_INTERNOS: n(m.ajustes_internos),
      SALDO_CIERRE: n(m.saldo_final), SALDO_INICIAL_CONFIGURADO: n(m.saldo_inicial_configurado),
    }));
    const opening = (tesoreria.medios || []).flatMap((m) => (m.saldos_iniciales || []).map((s) => ({
      TIPO: "Tesorería", NOMBRE: m.nombre, FECHA: s.fecha, SALDO: n(s.importe), NOTA: "No integra ventas ni resultados",
    })));
    const p = tesoreria.patrimonio_inicial || {};
    const patrimonio = [
      ["Clientes nos debían", p.clientes_deben],
      ["A favor de clientes", p.clientes_a_favor],
      ["Debíamos a proveedores", p.proveedores_debemos],
      ["A favor con proveedores", p.proveedores_a_favor],
      ["Cheques iniciales", p.cheques_iniciales],
      ["eCheqs iniciales", p.echeqs_iniciales],
    ].map(([name, value]) => ({ TIPO: "Patrimonio inicial", NOMBRE: name, FECHA: "", SALDO: n(value), NOTA: "No es efectivo disponible" }));
    return { summary, media, opening: [...opening, ...patrimonio], evolution: (tesoreria.evolucion || []).map((p) => ({ FECHA: p.fecha, SALDO: n(p.saldo) })) };
  }, [dateRange, tesoreria, ventas, otrosIngresos, costoVariable, costoFijo, otrosEgresos, resultadoNeto, gastosPersonales, deudasPorCobrar, deudasPorPagar]);

  const exportExcel = useCallback(() => {
    const d = getData(); const book = XLSX.utils.book_new();
    const sheets = [
      ["Resumen", d.summary], ["Tesoreria", d.media], ["Saldos iniciales", d.opening], ["Evolucion", d.evolution],
    ];
    for (const [name, rows] of sheets) {
      const sheet = XLSX.utils.json_to_sheet(rows);
      sheet["!cols"] = (Object.keys(rows[0] || {})).map((key) => ({ wch: Math.min(42, Math.max(16, key.length + 3)) }));
      const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
      if (range) for (let y = 1; y <= range.e.r; y++) for (let x = 0; x <= range.e.c; x++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: y, c: x })];
        if (cell?.t === "n") cell.z = '"$" #,##0.00;[Red]("$" #,##0.00)';
      }
      XLSX.utils.book_append_sheet(book, sheet, name);
    }
    XLSX.writeFile(book, `${fileName}.xlsx`);
  }, [getData, fileName]);

  const exportText = useCallback((type) => {
    const d = getData(); const sections = [
      ["RESUMEN", d.summary], ["TESORERÍA POR MEDIO", d.media], ["SALDOS INICIALES", d.opening], ["EVOLUCIÓN", d.evolution],
    ];
    const delim = type === "csv" ? ";" : " | ";
    const text = sections.map(([name, rows]) => {
      const heads = Object.keys(rows[0] || {});
      return [name, heads.map(escapeCSV).join(delim), ...rows.map((row) => heads.map((h) => escapeCSV(row[h])).join(delim))].join("\n");
    }).join("\n\n");
    downloadBlob(`\uFEFF${text}`, `${fileName}.${type}`, type === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8");
  }, [getData, fileName]);

  const handle = useCallback((type) => {
    try {
      if (type === "excel") exportExcel();
      else exportText(type);
      showToast("exito", `Análisis exportado en ${type === "excel" ? "Excel" : type.toUpperCase()}.`, 2500);
    } catch (e) {
      showToast("error", e?.message || "No se pudo exportar.", 3500);
    }
  }, [exportExcel, exportText, showToast]);

  return useMemo(() => [
    { key: "excel", label: "Exportar Excel (.xlsx)", icon: faFileExcel, onClick: () => handle("excel") },
    { key: "csv", label: "Exportar CSV (.csv)", onClick: () => handle("csv") },
    { key: "txt", label: "Exportar TXT (.txt)", onClick: () => handle("txt") },
  ], [handle]);
}
