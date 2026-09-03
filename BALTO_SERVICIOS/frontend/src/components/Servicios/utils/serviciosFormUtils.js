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
  }).format(Number(value || 0));

export const integer = (value) =>
  new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
  }).format(stockNumber(value));
