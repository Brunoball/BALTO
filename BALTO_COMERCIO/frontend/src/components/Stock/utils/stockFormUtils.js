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

export function normalizeStockInput(value, maxDecimals = 3) {
  let raw = String(value ?? "").replace(/\s+/g, "").replace(/,/g, ".");
  raw = raw.replace(/[^\d.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot >= 0) {
    raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
    const [whole, decimals = ""] = raw.split(".");
    raw = `${whole}.${decimals.slice(0, Math.max(0, maxDecimals))}`;
  }
  if (raw.startsWith(".")) raw = `0${raw}`;
  return raw;
}

export function stockToApi(value) {
  const raw = String(value ?? "").trim().replace(/,/g, ".");
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
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
      price: formatMoneyBlur(price),
      marginPct: "",
      marginValue: "",
    };
  }

  // Margen real sobre precio de venta, igual que en el modelo del contador:
  // margen % = (precio - costo) / precio.
  if (source === "price") {
    if (p === null) return { price: "", marginPct: "", marginValue: "" };
    const diff = p - c;
    return {
      price: formatFlexibleDecimal(p),
      marginPct: p !== 0 ? formatFlexibleDecimal((diff / p) * 100) : "",
      marginValue: formatFlexibleDecimal(diff),
    };
  }

  // Si el usuario escribe un margen sobre precio, despejamos el precio:
  // precio = costo / (1 - margen%). Un margen >= 100% no tiene solución válida.
  if (source === "marginPct") {
    if (pct === null || pct >= 100) {
      return {
        price: "",
        marginPct: pct === null ? "" : formatFlexibleDecimal(pct),
        marginValue: "",
      };
    }
    const denominator = 1 - pct / 100;
    const calculatedPrice = denominator !== 0 ? c / denominator : null;
    if (calculatedPrice === null || !Number.isFinite(calculatedPrice)) {
      return { price: "", marginPct: formatFlexibleDecimal(pct), marginValue: "" };
    }
    const diff = calculatedPrice - c;
    return {
      price: formatFlexibleDecimal(calculatedPrice),
      marginPct: formatFlexibleDecimal(pct),
      marginValue: formatFlexibleDecimal(diff),
    };
  }

  if (source === "marginValue") {
    if (val === null) return { price: "", marginPct: "", marginValue: "" };
    const calculatedPrice = c + val;
    return {
      price: formatFlexibleDecimal(calculatedPrice),
      marginPct: calculatedPrice !== 0
        ? formatFlexibleDecimal((val / calculatedPrice) * 100)
        : "",
      marginValue: formatFlexibleDecimal(val),
    };
  }

  return {
    price: formatMoneyBlur(price),
    marginPct: formatMoneyBlur(marginPct),
    marginValue: formatMoneyBlur(marginValue),
  };
}
