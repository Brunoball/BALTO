/* ================================================================
   Rentabilidad bruta de un producto (Stock).

   Módulo puro, sin imports de React ni del DOM: lo usan el alta individual
   y la edición de productos (ProductPricingPanel) y se prueba con `node`
   (tests/unit/stock-gross-profitability.unit.mjs).

   COSTO y PRECIO -> rentabilidad. Además, el comerciante puede editar a mano
   la ganancia, el margen o el recargo y se recalcula SÓLO el precio de ese
   bloque (venta o promoción). El costo nunca se modifica desde un indicador.
   No intervienen gastos operativos, coeficientes ni utilidades deseadas.

     Ganancia bruta            = PV − PC          ->  PV = PC + G
     Margen bruto s/venta (%)  = (PV − PC) / PV   ->  PV = PC / (1 − M/100)
     Recargo s/costo (%)       = (PV − PC) / PC   ->  PV = PC × (1 + R/100)

   Los cálculos usan los importes completos; sólo se redondea al presentar.
   El precio derivado de un indicador se redondea a centavos.
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

/* ── Edición inversa: indicador -> precio ───────────────────────────── */

/** Máximo de DECIMAL(12,2), igual que la validación del backend. */
export const MAX_PRICE_AMOUNT = 9999999999.99;

export const PROFIT_EDIT_ERRORS = {
  sinCosto: "Cargá el precio de costo para calcular el precio.",
  margenMaximo: "El margen sobre venta tiene que ser menor a 100%.",
  maximo: "El precio resultante supera el máximo permitido.",
  invalido: "Ingresá un número válido.",
};

function roundCents(value) {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

/**
 * Precio que corresponde a un indicador editado a mano.
 * @param {"profit"|"marginPct"|"markupPct"} kind
 * @returns {{ price: number|null, error: string|null }}
 *   price redondeado a centavos, o null con el motivo en `error`.
 */
export function priceFromProfitability(kind, cost, rawValue) {
  const c = parsePriceAmount(cost);
  const v = parseMoneyInput(rawValue);
  if (v === null || !Number.isFinite(v) || v < 0) return { price: null, error: PROFIT_EDIT_ERRORS.invalido };
  // La ganancia admite costo cero (PV = G); los porcentajes necesitan costo > 0.
  if (c === null || (kind !== "profit" && c <= 0)) return { price: null, error: PROFIT_EDIT_ERRORS.sinCosto };

  let price;
  if (kind === "profit") {
    price = c + v;
  } else if (kind === "marginPct") {
    if (v >= 100) return { price: null, error: PROFIT_EDIT_ERRORS.margenMaximo };
    price = c / (1 - v / 100);
  } else if (kind === "markupPct") {
    price = c * (1 + v / 100);
  } else {
    return { price: null, error: PROFIT_EDIT_ERRORS.invalido };
  }

  if (!Number.isFinite(price)) return { price: null, error: PROFIT_EDIT_ERRORS.invalido };
  const rounded = roundCents(price);
  if (rounded > MAX_PRICE_AMOUNT) return { price: null, error: PROFIT_EDIT_ERRORS.maximo };
  return { price: rounded, error: null };
}

/** 21250 -> "21250,00": formato de los inputs de precio de los modales. */
export function formatPriceForInput(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return Number(value).toFixed(2).replace(".", ",");
}

/** Valor de un indicador para editarlo: 60.3612 -> "60,36" (sin miles ni símbolo). */
export function formatIndicatorForEdit(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const rounded = roundCents(Number(value));
  return (rounded === 0 ? 0 : rounded).toFixed(2).replace(".", ",");
}
