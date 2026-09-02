import { useMemo } from "react";
import {
  computeDerivedRows,
  findImporte,
  isDisponibilidadRow,
  normalizeDisponibilidades,
  normalizeRows,
  safeText,
  toNumberOrZero,
} from "../utils/analisisFinancieroUtils";

export default function useAnalisisFinancieroDatos(data) {
  const rawRows =
    data?.rows ??
    data?.data?.rows ??
    data?.valores ??
    data?.data?.valores ??
    data?.analisis ??
    data?.data?.analisis ??
    null;

  const normalized = useMemo(() => normalizeRows(rawRows), [rawRows]);
  const allRows = useMemo(() => computeDerivedRows(normalized), [normalized]);
  const mainRows = useMemo(
    () => allRows.filter((r) => !isDisponibilidadRow(r)),
    [allRows]
  );

  const disponibilidadesRaw =
    data?.disponibilidades ??
    data?.data?.disponibilidades ??
    data?.cajas ??
    data?.data?.cajas ??
    data?.disponibilidad ??
    data?.data?.disponibilidad ??
    null;

  const disponibilidades = useMemo(
    () => normalizeDisponibilidades(disponibilidadesRaw, normalized),
    [disponibilidadesRaw, normalized]
  );

  const ventas =
    mainRows.find((r) => safeText(r.id).toLowerCase() === "ventas")?.importe ?? 0;

  const costoVariable =
    mainRows.find((r) => safeText(r.id).toLowerCase() === "costo_variable")?.importe ??
    findImporte(mainRows, [{ includes: ["costo variable", "variable"] }]);

  const costoFijo =
    mainRows.find((r) => safeText(r.id).toLowerCase() === "costo_fijo")?.importe ??
    findImporte(mainRows, [{ includes: ["costo fijo", "fijo"] }]);

  const otrosEgresos =
    mainRows.find((r) => safeText(r.id).toLowerCase() === "otros_egresos")?.importe ??
    findImporte(mainRows, [{ includes: ["otros egresos", "egresos"] }]);

  const resultadoNeto =
    mainRows.find((r) => safeText(r.id).toLowerCase() === "resultado_neto")?.importe ??
    ventas - costoVariable - costoFijo - otrosEgresos;

  const totalDisponibilidades = useMemo(
    () => disponibilidades.reduce((acc, item) => acc + toNumberOrZero(item.importe), 0),
    [disponibilidades]
  );

  const resumenCards = useMemo(
    () => [
      {
        id: "ventas",
        label: "Ventas",
        value: ventas,
        sub: "Ingresos del período",
        variant: "ingreso",
      },
      {
        id: "costo_variable",
        label: "Costo variable",
        value: costoVariable,
        sub: "Costos variables del período",
        variant: "egreso",
      },
      {
        id: "costo_fijo",
        label: "Costo fijo",
        value: costoFijo,
        sub: "Costos fijos del período",
        variant: "egreso",
      },
      {
        id: "otros_egresos",
        label: "Otros egresos",
        value: otrosEgresos,
        sub: "Egresos no operativos",
        variant: "egreso",
      },
    ],
    [ventas, costoVariable, costoFijo, otrosEgresos]
  );

  return {
    costoFijo,
    costoVariable,
    disponibilidades,
    mainRows,
    otrosEgresos,
    resultadoIsNeg: Number(resultadoNeto) < 0,
    resultadoNeto,
    resumenCards,
    totalDisponibilidades,
    ventas,
  };
}
