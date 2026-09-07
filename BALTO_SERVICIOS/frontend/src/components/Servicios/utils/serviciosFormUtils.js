export const upper = (value) => String(value ?? "").toLocaleUpperCase("es-AR");

export const cleanCode = (value) =>
  upper(value)
    .replace(/[^A-Z0-9._/-]/g, "")
    .slice(0, 60);

export const integerText = (value, maxLength = 10) =>
  String(value ?? "")
    .replace(/\D+/g, "")
    .slice(0, maxLength);

export const decimalText = (value, maxDecimals = 2, maxIntegerDigits = 12) => {
  let raw = String(value ?? "").replace(",", ".").replace(/[^0-9.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot >= 0) {
    raw =
      raw.slice(0, firstDot + 1) +
      raw
        .slice(firstDot + 1)
        .replace(/\./g, "")
        .slice(0, maxDecimals);
  }

  const [intPart = "", decimalPart] = raw.split(".");
  const safeInt = intPart.slice(0, maxIntegerDigits);
  return decimalPart === undefined ? safeInt : `${safeInt}.${decimalPart}`;
};

export const clampText = (value, maxLength) => upper(value).slice(0, maxLength);

export const decimalNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

export const moneyInputValue = (value, { empty = "" } = {}) => {
  if (value == null || String(value).trim() === "") return empty;
  return decimalNumber(value).toFixed(2).replace(".", ",");
};

export const moneyDecimalText = (value, maxIntegerDigits = 12) =>
  decimalText(value, 2, maxIntegerDigits).replace(".", ",");

export const moneyApiValue = (value, fallback = "0") => {
  if (value == null || String(value).trim() === "") return fallback;
  return decimalNumber(value).toFixed(2);
};

export const stockInputValue = (value, { empty = "" } = {}) => {
  if (value == null || String(value).trim() === "") return empty;
  const number = decimalNumber(value);
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(".", ",");
};

export const stockDecimalText = (value, maxIntegerDigits = 12) =>
  decimalText(value, 2, maxIntegerDigits).replace(".", ",");

export const stockApiValue = (value, fallback = "0.00") => {
  if (value == null || String(value).trim() === "") return fallback;
  return decimalNumber(value).toFixed(2);
};

export const stock = (value) => {
  const number = decimalNumber(value);
  const hasDecimals = !Number.isInteger(number);
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(number);
};

export const stockNumber = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
};

export const money = (value) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(decimalNumber(value));

export const integer = (value) =>
  new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
  }).format(stockNumber(value));
