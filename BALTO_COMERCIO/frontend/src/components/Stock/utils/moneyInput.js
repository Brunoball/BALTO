/* ================================================================
   Entrada de importes de Stock (costo, precios y márgenes).

   Módulo puro, sin imports: lo usan el alta individual, la edición,
   la carga masiva y el panel del coeficiente ponderado, y se puede
   probar con `node` (tests/unit/stock-money-input.unit.mjs).

   Formato de entrada aceptado (es-AR):
   - coma decimal: "9870,50";
   - punto del teclado numérico como decimal: "9870.5" -> "9870,5";
   - valor ya formateado con separador de miles al volver a editarlo:
     "$ 9.870,50" -> "9870,50" (antes se interpretaba como "9,87").
   ================================================================ */

/**
 * Normaliza lo que el usuario está escribiendo en un importe SIN perder la
 * escritura parcial: conserva la coma final ("9870,") y los ceros decimales
 * ("9870,50"). Máximo dos decimales y una sola coma.
 */
export function normalizeMoneyInput(raw = "") {
  let text = String(raw ?? "").replace(/[$%\s]/g, "");

  // Un valor con coma decimal y puntos ANTES de la coma es un importe es-AR
  // ya formateado ("9.870,50", "1.234.567,8"): los puntos son miles.
  const commaIndex = text.indexOf(",");
  if (commaIndex > 0 && text.slice(0, commaIndex).includes(".")) {
    text = text.slice(0, commaIndex).replace(/\./g, "") + text.slice(commaIndex);
  }

  let value = text.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const firstComma = value.indexOf(",");
  if (firstComma !== -1) {
    value = value.slice(0, firstComma + 1) + value.slice(firstComma + 1).replace(/,/g, "");
  }
  const parts = value.split(",");
  if (parts.length > 1) {
    parts[1] = parts[1].slice(0, 2);
    value = `${parts[0]},${parts[1]}`;
  }
  return value;
}

/**
 * Igual que normalizeMoneyInput, pero permite un signo negativo inicial para
 * los márgenes (un precio por debajo del costo da margen negativo).
 */
export function normalizeTypedDecimal(raw = "", { allowNegative = false } = {}) {
  const text = String(raw ?? "").replace(/[$%\s]/g, "");
  const negative = allowNegative && text.startsWith("-");
  const value = normalizeMoneyInput(text);
  return negative ? `-${value}` : value;
}

/**
 * Convierte un importe de la interfaz o de la API a número.
 * - "9870,50" / "9.870,50" / "$ 9.870,50" -> 9870.5
 * - "5162.50" (formato API/MySQL) -> 5162.5
 * - "5.162" (miles sin decimales) -> 5162; "5162.500" -> 5162.5
 * Devuelve null si no hay un número válido.
 */
export function parseMoneyInput(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value).trim().replace(/[$%\s]/g, "");
  if (!raw || raw === "-" || raw === "," || raw === ".") return null;

  // Sin coma, sólo se leen como miles los puntos con grupos exactos de tres
  // cifras ("5.162", "1.234.567"); "5162.50" o "5162.500" siguen siendo decimales.
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(?:\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;

  const cleaned = normalized.replace(/[^\d.-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}
