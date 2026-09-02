export {
  API_URL,
  buildHeadersGET,
  buildHeadersJSON,
  buildHeadersMultipart,
  getUsuarioAuditData,
  parseJsonOrThrow,
} from "../api/stockApi";

export function normalizeMoneyInput(raw = "") {
  let value = String(raw).replace(/\./g, ",").replace(/[^\d,]/g, "");
  const firstComma = value.indexOf(",");
  if (firstComma !== -1) {
    value =
      value.slice(0, firstComma + 1) +
      value.slice(firstComma + 1).replace(/,/g, "");
  }
  const parts = value.split(",");
  if (parts.length > 1) {
    parts[1] = parts[1].slice(0, 2);
    value = `${parts[0]},${parts[1]}`;
  }
  return value;
}

function parseDecimal(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const normalized = String(raw)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatFlexibleDecimal(num) {
  if (num === null || num === undefined || Number.isNaN(Number(num))) return "";
  const fixed = Number(num).toFixed(2);
  const trimmed = fixed.replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  return trimmed.replace(".", ",");
}

export function formatMoneyBlur(raw = "") {
  const num = parseDecimal(raw);
  if (num === null || num < 0) return "";
  return formatFlexibleDecimal(num);
}

export function formatMoneyFocus(raw = "") {
  return raw ? String(raw) : "";
}

export function moneyToApi(raw = "") {
  const num = parseDecimal(raw);
  if (num === null) return "";
  return Number(num).toFixed(2);
}

export function moneyToInput(raw = "") {
  const num = parseDecimal(raw);
  if (num === null) return "";
  return formatFlexibleDecimal(num);
}

export function onlyNumbers(v) {
  return String(v ?? "").replace(/[^\d]/g, "");
}

export function toUpperCaseValue(value, fieldType = "text") {
  if (fieldType === "money" || fieldType === "number") return value;
  return String(value ?? "").toUpperCase();
}

export function emptyExtraPriceRow(tipo = null) {
  return {
    id_tipo_precio_stock: String(tipo?.id ?? tipo?.id_tipo_precio_stock ?? ""),
    tipo_nombre: tipo?.nombre || "",
    precio: "",
    margen_porcentaje: "",
    margen_valor: "",
  };
}


export function recalculatePricingGroup({
  cost,
  price,
  marginPct,
  marginValue,
  source,
}) {
  const c = parseDecimal(cost);
  const p = parseDecimal(price);
  const pct = parseDecimal(marginPct);
  const val = parseDecimal(marginValue);

  if (c === null) {
    return {
      price: source === "price" ? formatMoneyBlur(price) : formatMoneyBlur(price),
      marginPct: "",
      marginValue: "",
    };
  }

  if (source === "price") {
    if (p === null) return { price: "", marginPct: "", marginValue: "" };
    const diff = p - c;
    return {
      price: formatFlexibleDecimal(p),
      marginPct: c > 0 ? formatFlexibleDecimal((diff / c) * 100) : "",
      marginValue: formatFlexibleDecimal(diff),
    };
  }

  if (source === "marginPct") {
    if (pct === null) return { price: "", marginPct: "", marginValue: "" };
    const diff = c * (pct / 100);
    return {
      price: formatFlexibleDecimal(c + diff),
      marginPct: formatFlexibleDecimal(pct),
      marginValue: formatFlexibleDecimal(diff),
    };
  }

  if (source === "marginValue") {
    if (val === null) return { price: "", marginPct: "", marginValue: "" };
    return {
      price: formatFlexibleDecimal(c + val),
      marginPct: c > 0 ? formatFlexibleDecimal((val / c) * 100) : "",
      marginValue: formatFlexibleDecimal(val),
    };
  }

  return {
    price: formatMoneyBlur(price),
    marginPct: formatMoneyBlur(marginPct),
    marginValue: formatMoneyBlur(marginValue),
  };
}
