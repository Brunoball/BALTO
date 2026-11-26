/* ================================================================
   Rentabilidad bruta de un producto (Stock).

   Módulo puro, sin imports de React ni del DOM: lo usan el alta individual
   y la edición de productos (ProductPricingPanel) y se prueba con `node`
   (tests/unit/stock-gross-profitability.unit.mjs).

   Regla unidireccional: COSTO y PRECIO -> rentabilidad. Nunca al revés.
   No intervienen gastos operativos, coeficientes ni utilidades deseadas.

     Ganancia bruta            = PV − PC
     Margen bruto s/venta (%)  = (PV − PC) / PV × 100
     Recargo s/costo (%)       = (PV − PC) / PC × 100

   Los cálculos usan los importes completos; sólo se redondea al presentar.
   ================================================================ */

import { parseMoneyInput } from "./moneyInput";

/**
 * Convierte un importe de la interfaz o de la API a número.
 * - Campo vacío / no numérico -> null (un vacío NO es un cero).
 * - Importe negativo -> null (los precios no pueden ser negativos).
 */
export function parsePriceAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = parseMoneyInput(value);
  if (number === null || !Number.isFinite(number) || number < 0) return null;
  return number;
}

function safeRatio(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const result = (numerator / denominator) * 100;
  return Number.isFinite(result) ? result : null;
}

/**
 * Rentabilidad bruta a partir del costo y de un precio (venta o promoción).
 * Devuelve números sin redondear o null cuando un indicador no se puede
 * calcular (dato faltante o división por cero). Nunca NaN ni Infinity.
 *
 * @returns {{
 *   cost: number|null,
 *   price: number|null,
 *   profit: number|null,
 *   marginPct: number|null,
 *   markupPct: number|null,
 *   belowCost: boolean,
 * }}
 */
export function calculateGrossProfitability(cost, price) {
  const c = parsePriceAmount(cost);
  const p = parsePriceAmount(price);
  const profitRaw = c !== null && p !== null ? p - c : null;
  const profit = profitRaw !== null && Number.isFinite(profitRaw) ? profitRaw : null;

  return {
    cost: c,
    price: p,
    profit,
    marginPct: safeRatio(profit, p),
    markupPct: safeRatio(profit, c),
    belowCost: c !== null && p !== null && p < c,
  };
}

function groupThousands(integerDigits) {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "6627.269999" -> "6.627,27" (es-AR, dos decimales, sin "-0,00"). */
export function formatDecimalEsAr(value, decimals = 2) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** decimals;
  let rounded = Math.round((Math.abs(number) + Number.EPSILON) * factor) / factor;
  if (rounded === 0) rounded = 0;
  const negative = number < 0 && rounded !== 0;
  const [integerPart, decimalPart = ""] = rounded.toFixed(decimals).split(".");
  const text = decimals > 0
    ? `${groupThousands(integerPart)},${decimalPart}`
    : groupThousands(integerPart);
  return negative ? `-${text}` : text;
}

/** Importe en pesos: "$ 6.627,27", "-$ 2.000,00" o "—". */
export function formatProfitMoney(value) {
  const text = formatDecimalEsAr(value, 2);
  if (text === null) return "—";
  return text.startsWith("-") ? `-$ ${text.slice(1)}` : `$ ${text}`;
}

/** Porcentaje con dos decimales: "47,34%" o "—". */
export function formatProfitPercent(value) {
  const text = formatDecimalEsAr(value, 2);
  return text === null ? "—" : `${text}%`;
}

/**
 * Márgenes persistibles (columnas margen_porcentaje / margen_valor) derivados
 * del costo y del precio vigentes. Strings con dos decimales o "" si no aplica.
 * El backend vuelve a calcularlos y no confía en estos valores.
 */
export function profitabilityToApi(cost, price) {
  const result = calculateGrossProfitability(cost, price);
  return {
    margen_porcentaje: result.marginPct === null ? "" : result.marginPct.toFixed(2),
    margen_valor: result.profit === null ? "" : result.profit.toFixed(2),
  };
}
