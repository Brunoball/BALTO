// src/utils/VentaNoFacturadaPdfBuilder.js

import jsPDF from "jspdf";
import BASE_URL from "../config/config";

const API_RELATIVE = "api.php";

const FIX = {
  emisor_nombre: "BALTO",
  emisor_domicilio: "",
  tipoTxt: "COMPROBANTE INTERNO",
  subtipoTxt: "VENTA NO FACTURADA",
  condicion_venta_default: "Contado",
};

function sanitizePdfText(input) {
  let t = input == null ? "" : String(input);
  t = t.replace(/\s+/g, " ").trim();
  t = t
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/✓/g, "OK");

  let out = "";
  for (let i = 0; i < t.length; i += 1) {
    out += t.charCodeAt(i) <= 255 ? t[i] : " ";
  }

  return out.replace(/\s+/g, " ").trim();
}

function s(v) {
  return v == null ? "" : String(v);
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function numEs(v, dec = 2) {
  const n = safeNumber(v, 0);
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function moneyEs(v) {
  return numEs(v, 2);
}

function ymdToHuman(value) {
  const str = String(value || "").trim();
  if (!str) return "";

  if (/^\d{8}$/.test(str)) {
    return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  return str;
}

function nowStamp() {
  const d = new Date();

  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function safeFilePart(value, fallback = "VENTA") {
  const clean = sanitizePdfText(String(value || fallback))
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  return clean || fallback;
}

function set(doc, font = "helvetica", style = "normal", size = 10) {
  doc.setFont(font, style);
  doc.setFontSize(size);
}

function text(doc, value, x, y, opt) {
  doc.text(sanitizePdfText(value), x, y, opt);
}

function rect(doc, x, y, w, h, lw = 0.55) {
  doc.setLineWidth(lw);
  doc.rect(x, y, w, h);
}

function line(doc, x1, y1, x2, y2, lw = 0.45) {
  doc.setLineWidth(lw);
  doc.line(x1, y1, x2, y2);
}

function fillRect(doc, x, y, w, h, gray = 0.84) {
  const g = Math.max(0, Math.min(1, gray));
  doc.setFillColor(Math.round(g * 255));
  doc.rect(x, y, w, h, "F");
}

function clampToWidth(doc, value, maxW) {
  const t = sanitizePdfText(value);
  if (!t) return "";
  if (doc.getTextWidth(t) <= maxW) return t;

  let out = t;
  while (out.length > 0 && doc.getTextWidth(`${out}...`) > maxW) {
    out = out.slice(0, -1);
  }

  return out ? `${out}...` : "";
}

function wrapByWidth(doc, value, maxW) {
  const t = sanitizePdfText(value);
  if (!t) return [];

  const words = t.split(" ");
  const lines = [];
  let cur = "";

  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;

    if (doc.getTextWidth(test) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }

  if (cur) lines.push(cur);
  return lines;
}

function buildApiUrl(paramsObj) {
  const baseRaw = String(BASE_URL || "").trim();
  const base = baseRaw.replace(/\/+$/, "") + "/";
  const url = new URL(API_RELATIVE, base);

  const qs = new URLSearchParams();

  Object.entries(paramsObj || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    qs.set(k, String(v));
  });

  url.search = qs.toString();
  return url.toString();
}

function isLocalApiBase() {
  try {
    const base = String(BASE_URL || "").toLowerCase().trim();
    return base.includes("localhost") || base.includes("127.0.0.1");
  } catch {
    return false;
  }
}

function getSessionKey() {
  try {
    return String(
      localStorage.getItem("session_key") || localStorage.getItem("sessionKey") || ""
    ).trim();
  } catch {
    return "";
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    } catch {
      resolve("");
    }
  });
}

const LOGO_CACHE_PREFIX = "balto_venta_no_facturada_logo_pdf_v2";
const LOGO_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
let logoDataUrlCache = "";
let logoDataUrlPromise = null;

function getLogoCacheKey(sessionKey) {
  return `${LOGO_CACHE_PREFIX}_${sessionKey || "anon"}`;
}

function readCachedLogo(sessionKey) {
  if (logoDataUrlCache) return logoDataUrlCache;

  try {
    const raw = sessionStorage.getItem(getLogoCacheKey(sessionKey));
    if (!raw) return "";

    const cached = JSON.parse(raw);
    const ts = Number(cached?.ts || 0);
    const dataUrl = String(cached?.dataUrl || "");

    if (!dataUrl || !ts || Date.now() - ts > LOGO_CACHE_TTL_MS) {
      sessionStorage.removeItem(getLogoCacheKey(sessionKey));
      return "";
    }

    logoDataUrlCache = dataUrl;
    return dataUrl;
  } catch {
    return "";
  }
}

function writeCachedLogo(sessionKey, dataUrl) {
  const value = String(dataUrl || "");
  if (!value) return;

  logoDataUrlCache = value;

  try {
    sessionStorage.setItem(
      getLogoCacheKey(sessionKey),
      JSON.stringify({ ts: Date.now(), dataUrl: value })
    );
  } catch {
    // Si el storage está lleno, igual queda cacheado en memoria durante esta sesión.
  }
}

function optimizeLogoDataUrl(dataUrl) {
  const source = String(dataUrl || "");
  if (!source || typeof Image === "undefined" || typeof document === "undefined") {
    return Promise.resolve(source);
  }

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 520;
          const maxH = 180;
          const originalW = Number(img.naturalWidth || img.width || maxW);
          const originalH = Number(img.naturalHeight || img.height || maxH);

          if (!originalW || !originalH) {
            resolve(source);
            return;
          }

          const ratio = Math.min(1, maxW / originalW, maxH / originalH);
          const targetW = Math.max(1, Math.round(originalW * ratio));
          const targetH = Math.max(1, Math.round(originalH * ratio));

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(source);
            return;
          }

          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);

          const optimized = canvas.toDataURL("image/jpeg", 0.82);
          resolve(optimized || source);
        } catch {
          resolve(source);
        }
      };
      img.onerror = () => resolve(source);
      img.src = source;
    } catch {
      resolve(source);
    }
  });
}

async function fetchTenantLogoDataUrl(data = {}) {
  try {
    const direct = s(data?.emisor_logo_data_url) || s(data?.logo_data_url);
    const sessionKey = getSessionKey();

    if (direct) {
      const optimizedDirect = await optimizeLogoDataUrl(direct);
      writeCachedLogo(sessionKey, optimizedDirect);
      return optimizedDirect;
    }

    if (isLocalApiBase()) return "";

    const cached = readCachedLogo(sessionKey);
    if (cached) return cached;

    if (!sessionKey) return "";

    if (logoDataUrlPromise) return await logoDataUrlPromise;

    logoDataUrlPromise = (async () => {
      const logoUrl = buildApiUrl({
        action: "tenant_logo_ver",
        tipo: "principal",
      });

      const res = await fetch(logoUrl, {
        method: "GET",
        headers: { "X-Session": sessionKey },
        cache: "force-cache",
      });

      if (!res.ok || res.status === 204) return "";

      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      if (!contentType.startsWith("image/")) return "";

      const blob = await res.blob();
      if (!blob || !blob.size) return "";

      const dataUrl = await blobToDataUrl(blob);
      const optimized = await optimizeLogoDataUrl(dataUrl);
      writeCachedLogo(sessionKey, optimized);
      return optimized;
    })();

    try {
      return await logoDataUrlPromise;
    } finally {
      logoDataUrlPromise = null;
    }
  } catch {
    return "";
  }
}

export async function preloadVentaNoFacturadaPdfAssets(data = {}) {
  try {
    await fetchTenantLogoDataUrl(data || {});
    return true;
  } catch {
    return false;
  }
}

function getImageFormatFromDataUrl(dataUrl) {
  const t = String(dataUrl || "").toLowerCase();

  if (t.startsWith("data:image/png")) return "PNG";
  if (t.startsWith("data:image/webp")) return "WEBP";
  if (t.startsWith("data:image/jpeg") || t.startsWith("data:image/jpg")) return "JPEG";

  return "PNG";
}

function pickText(...values) {
  for (const value of values) {
    const txt = sanitizePdfText(value);
    if (txt) return txt;
  }
  return "";
}

function getDocCliente(cf = {}, data = {}) {
  const doc = pickText(cf?.doc_nro, cf?.cuit, cf?.dni, data?.cliente_cuit, data?.doc_nro);
  return doc;
}

function getEmisor(data = {}) {
  const em = data?.emisor || data?.config_facturacion || data?.facturacion || data?.config || {};

  return {
    razon: pickText(
      data?.emisor_nombre,
      em?.razon_social,
      em?.nombre_fantasia,
      em?.nombre,
      FIX.emisor_nombre
    ),
    domComercial: pickText(
      data?.emisor_domicilio,
      em?.domicilio_comercial,
      em?.domicilio,
      em?.domicilio_fiscal,
      FIX.emisor_domicilio
    ),
    cuit: pickText(data?.cuit_emisor, em?.cuit),
    iva: pickText(data?.cond_iva_emisor, em?.condicion_iva, em?.cond_iva),
    iibb: pickText(data?.ingresos_brutos_emisor, em?.ingresos_brutos),
    inicio: pickText(
      data?.fecha_inicio_actividades_emisor,
      em?.fecha_inicio_actividades,
      em?.inicio_actividades
    ),
  };
}

function getCliente(data = {}) {
  const cf = data?.cliente_facturacion || data?.cliente || {};

  return {
    razon: pickText(
      cf?.razon_social,
      cf?.nombre,
      data?.labelCliente,
      data?.cliente_nombre,
      data?.cliente,
      "Cliente"
    ),
    cuit: getDocCliente(cf, data),
    iva: pickText(cf?.condicion_iva, cf?.cond_iva, data?.cliente_condicion_iva),
    domicilio: pickText(cf?.domicilio, data?.cliente_domicilio),
    condVenta: pickText(
      data?.condicion_venta,
      data?.tipo_venta_nombre,
      FIX.condicion_venta_default
    ),
  };
}

function getMediosPagoTxt(data = {}) {
  const raw = Array.isArray(data?.medios_pago) ? data.medios_pago : [];

  const labels = raw
    .map((mp) =>
      sanitizePdfText(
        mp?.nombre ||
          mp?.Nombre ||
          mp?.medio_pago ||
          mp?.medioPago ||
          mp?.nombre_medio_pago ||
          mp?.descripcion ||
          mp?.detalle ||
          mp?.label ||
          ""
      )
    )
    .filter(Boolean);

  if (labels.length) return labels.join(" / ");

  return sanitizePdfText(data?.medio_pago_nombre || data?.medio_pago || data?.medioPago || "");
}

function getNumeroInterno(data = {}) {
  const ids = Array.isArray(data?.ids_movimiento) ? data.ids_movimiento : [];
  const cleanIds = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);

  if (cleanIds.length === 1) return `MOV-${String(cleanIds[0]).padStart(8, "0")}`;
  if (cleanIds.length > 1) return `LOTE-${cleanIds.map((x) => String(x)).join("-")}`;

  return `INT-${nowStamp()}`;
}

function normalizeItems(data = {}) {
  const raw = Array.isArray(data?.items_facturacion) ? data.items_facturacion : [];

  const items = raw
    .map((it, idx) => {
      const descripcion = sanitizePdfText(
        it?.descripcion || it?.detalle || it?.nombre || it?.label || `Item ${idx + 1}`
      );

      if (!descripcion) return null;

      const cantidad = safeNumber(it?.cantidad, 1) || 1;
      const total = firstFinite(it?.total, it?.ars, it?.subtotal_ars, it?.importe, it?.monto);
      const precio = firstFinite(
        it?.precio_unitario,
        it?.precio,
        cantidad ? Number(total || 0) / cantidad : total
      );
      const subtotal = firstFinite(
        it?.subtotal,
        it?.ars,
        it?.total,
        cantidad * Number(precio || 0)
      );

      const bonifPct = safeNumber(it?.bonif_pct ?? it?.bonifPct, 0);
      const impBonif = safeNumber(it?.impBonif ?? it?.imp_bonif ?? it?.importe_bonificacion, 0);

      return {
        codigo: String(it?.codigo || idx + 1),
        descripcion,
        cantidad,
        unidad: sanitizePdfText(it?.unidad || "u"),
        precio: safeNumber(precio, 0),
        bonifPct,
        impBonif,
        subtotal: safeNumber(subtotal, 0),
      };
    })
    .filter((it) => it && safeNumber(it.subtotal, 0) > 0);

  if (items.length) return items;

  const total = safeNumber(data?.total_ars ?? data?.monto ?? data?.importe, 0);

  return [
    {
      codigo: "1",
      descripcion: sanitizePdfText(data?.labelSistema || "Venta"),
      cantidad: 1,
      unidad: "u",
      precio: total,
      bonifPct: 0,
      impBonif: 0,
      subtotal: total,
    },
  ];
}

function getTotales(items, data = {}) {
  const subtotalItems = items.reduce((acc, it) => acc + safeNumber(it.subtotal, 0), 0);
  const total = safeNumber(data?.total_ars ?? data?.monto ?? data?.importe, subtotalItems);

  return {
    subtotal: subtotalItems,
    otrosTributos: 0,
    total: Number.isFinite(total) && total > 0 ? total : subtotalItems,
  };
}

function drawLogoOrFallback(doc, logoDataUrl, em, boxX, boxY, boxW) {
  const logoBoxW = Math.min(190, boxW - 36);
  const logoBoxH = 58;
  const logoBoxX = boxX + 22;
  const logoBoxY = boxY + 12;

  if (logoDataUrl) {
    try {
      const fmt = getImageFormatFromDataUrl(logoDataUrl);
      doc.addImage(logoDataUrl, fmt, logoBoxX, logoBoxY, logoBoxW, logoBoxH);
      return;
    } catch {
      // fallback al texto
    }
  }

  set(doc, "helvetica", "bold", 20);
  text(doc, clampToWidth(doc, em?.razon || "BALTO", boxW - 44), logoBoxX, logoBoxY + 30);
}

function drawOuter(doc) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const B = 10;

  rect(doc, B, B, W - B * 2, H - B * 2, 0.75);
}

function drawHeader(doc, data, logoDataUrl) {
  const W = doc.internal.pageSize.getWidth();
  const B = 10;
  const innerW = W - B * 2;
  const em = getEmisor(data);
  const cl = getCliente(data);

  const bandH = 28;
  const headerY = B + bandH;
  const headerH = 132;
  const splitX = B + innerW * 0.52;

  const boxW = 50;
  const boxH = 50;
  const boxX = splitX - boxW / 2;
  const boxY = headerY;
  const gap = 1.2;

  set(doc, "helvetica", "bold", 14);
  text(doc, "ORIGINAL", B + innerW / 2 + 10, B + bandH / 2 + 5, { align: "center" });
  line(doc, B, B + bandH, W - B, B + bandH, 0.55);

  rect(doc, B, headerY, innerW, headerH, 0.55);
  line(doc, splitX, headerY, splitX, boxY - gap, 0.55);
  line(doc, splitX, boxY + boxH + gap, splitX, headerY + headerH, 0.55);
  rect(doc, boxX, boxY, boxW, boxH, 0.55);

  set(doc, "helvetica", "bold", 30);
  text(doc, "X", boxX + boxW / 2, boxY + 26, { align: "center" });
  set(doc, "helvetica", "bold", 9);
  text(doc, "COD. 000", boxX + boxW / 2, boxY + 34, { align: "center" });

  const leftX = B + 12;
  const ly = headerY + 72;
  drawLogoOrFallback(doc, logoDataUrl, em, B, headerY, splitX - B);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Razón Social:", leftX, ly + 18);
  text(doc, "Domicilio Comercial:", leftX, ly + 38);
  text(doc, "Condición frente al IVA:", leftX, ly + 58);

  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, em.razon || "-", splitX - leftX - 12), leftX + 78, ly + 18);
  text(doc, clampToWidth(doc, em.domComercial || "-", splitX - leftX - 12), leftX + 90, ly + 38);
  text(doc, clampToWidth(doc, em.iva || "-", splitX - leftX - 12), leftX + 130, ly + 58);

  const rx = splitX + 1;
  set(doc, "helvetica", "bold", 14);
  text(doc, FIX.tipoTxt, rx + 40, headerY + 48);

  set(doc, "helvetica", "bold", 9);
  text(doc, FIX.subtipoTxt, rx + 40, headerY + 65);

  const fecha = ymdToHuman(data?.fecha_cbte_iso || data?.fecha || new Date().toISOString().slice(0, 10));
  const numeroInterno = getNumeroInterno(data);
  const medioPago = getMediosPagoTxt(data) || "-";

  set(doc, "helvetica", "bold", 9);
  text(doc, "Fecha de Emisión:", rx + 40, headerY + 80);
  text(doc, "N° interno:", rx + 40, headerY + 102);
  text(doc, "Medio de pago:", rx + 40, headerY + 115);
  text(doc, "Validez:", rx + 40, headerY + 128);

  set(doc, "helvetica", "normal", 9);
  text(doc, fecha, rx + 135, headerY + 80);
  text(doc, clampToWidth(doc, numeroInterno, 150), rx + 100, headerY + 102);
  text(doc, clampToWidth(doc, medioPago, 150), rx + 115, headerY + 115);
  text(doc, "Sin validez fiscal", rx + 82, headerY + 128);

  const recY = headerY + headerH;
  const clienteNombre = cl.razon || data?.labelCliente || "Cliente";
  const recLx = B + 10;
  const recRx = B + innerW * 0.46;
  const rightLimit = B + innerW - 10;

  const domLabelX = recRx - 12;
  const domValueX = domLabelX + 46;
  const domValueMaxW = Math.max(90, rightLimit - domValueX);
  const domLineH = 11;
  const domicilioLines = wrapByWidth(doc, cl.domicilio || "-", domValueMaxW);
  const domicilioExtraH = Math.max(0, domicilioLines.length - 1) * domLineH;
  const bottomRowY = recY + 62 + domicilioExtraH;
  const recH = 78 + domicilioExtraH;

  rect(doc, B, recY, innerW, recH, 0.55);

  set(doc, "helvetica", "bold", 9);
  text(doc, "CUIT / DOC:", recLx, recY + 18);
  text(doc, "Condición de venta:", recLx, recY + 46);
  text(doc, "Documento:", recLx, bottomRowY);
  text(doc, "Apellido y Nombre / Razón Social:", 150, recY + 18);
  text(doc, "Domicilio:", domLabelX, recY + 46);
  text(doc, "Comprobante:", domLabelX, bottomRowY);

  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, cl.cuit || "-", 165), recLx + 58, recY + 18);
  text(doc, clampToWidth(doc, cl.condVenta || FIX.condicion_venta_default, 190), recLx + 96, recY + 46);
  text(doc, "Interno", recLx + 58, bottomRowY);
  const razonLines = wrapByWidth(doc, clienteNombre, innerW - (recRx - B) - 12);
  text(doc, razonLines[0] || "", recRx + 30, recY + 18);
  if (razonLines[1]) text(doc, razonLines[1], recRx + 185, recY + 30);
  domicilioLines.forEach((lineTxt, lineIdx) => {
    text(doc, lineTxt, domValueX, recY + 46 + lineIdx * domLineH);
  });
  text(doc, "Venta no facturada", domLabelX + 65, bottomRowY);

  return recY + recH;
}
function getFacturaTableColumns(doc) {
  const W = doc.internal.pageSize.getWidth();
  const B = 10;
  const innerW = W - B * 2;
  const left = B;
  const right = B + innerW;

  const wCodigo = 50;
  const wCant = 70;
  const wUM = 50;
  const wPU = 60;
  const wBonif = 40;
  const wImpBon = 80;
  const wSubt = 52;
  const wProd = Math.max(
    10,
    innerW - (wCodigo + wCant + wUM + wPU + wBonif + wImpBon + wSubt)
  );

  const x0 = left;
  const x1 = x0 + wCodigo;
  const x2 = x1 + wProd;
  const x3 = x2 + wCant;
  const x4 = x3 + wUM;
  const x5 = x4 + wPU;
  const x6 = x5 + wBonif;
  const x7 = x6 + wImpBon;
  const x8 = right;

  return {
    x0,
    x1,
    x2,
    x3,
    x4,
    x5,
    x6,
    x7,
    x8,
    padL: 8,
    padR: 8,
  };
}

function drawTableHeader(doc, y) {
  const W = doc.internal.pageSize.getWidth();
  const B = 10;
  const innerW = W - B * 2;
  const headerRowH = 22;
  const c = getFacturaTableColumns(doc);

  fillRect(doc, B, y, innerW, headerRowH, 0.84);
  rect(doc, B, y, innerW, headerRowH, 0.55);

  set(doc, "helvetica", "bold", 8.3);
  text(doc, "Código", c.x0 + c.padL, y + 15);
  text(doc, "Producto / Servicio", c.x1 + c.padL, y + 15);
  text(doc, "Cantidad", c.x3 - c.padR, y + 15, { align: "right" });
  text(doc, "U. Medida", c.x4 - c.padR, y + 15, { align: "right" });
  text(doc, "Precio Unit.", c.x5 - c.padR, y + 15, { align: "right" });
  text(doc, "% Bonif", c.x6 - c.padR, y + 15, { align: "right" });
  text(doc, "Imp. Bonif.", c.x7 - c.padR, y + 15, { align: "right" });
  text(doc, "Subtotal", c.x8 - c.padR, y + 15, { align: "right" });

  return {
    nextY: y + headerRowH + 16,
    cols: c,
  };
}

function drawTableRow(doc, item, idx, cols, y, maxBodyY) {
  const descMaxW = cols.x2 - cols.padR - (cols.x1 + cols.padL);
  const descLines = wrapByWidth(doc, item.descripcion, Math.max(20, descMaxW));
  const lh = 11;
  const blockH = Math.max(14, descLines.length * lh);

  if (y + blockH > maxBodyY) {
    return {
      y,
      drawn: false,
    };
  }

  text(doc, s(item.codigo || String(idx + 1)), cols.x0 + cols.padL, y);

  descLines.forEach((ln, li) => {
    text(doc, ln, cols.x1 + cols.padL, y + li * lh);
  });

  text(doc, numEs(item.cantidad ?? 1, 2), cols.x3 - cols.padR, y, {
    align: "right",
  });
  text(doc, s(item.unidad || "u"), cols.x4 - cols.padR, y, {
    align: "right",
  });
  text(doc, moneyEs(item.precio || 0), cols.x5 - cols.padR, y, {
    align: "right",
  });
  text(doc, numEs(item.bonifPct || 0, 2), cols.x6 - cols.padR, y, {
    align: "right",
  });
  text(doc, moneyEs(item.impBonif || 0), cols.x7 - cols.padR, y, {
    align: "right",
  });
  text(doc, moneyEs(item.subtotal || 0), cols.x8 - cols.padR, y, {
    align: "right",
  });

  return {
    y: y + blockH + 4,
    drawn: true,
  };
}

function drawTotalsAndFooter(doc, items, data, y) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const B = 10;
  const innerW = W - B * 2;
  const totals = getTotales(items, data);

  const totH = 88;
  const footerH = 62;
  const footerTopY = H - B - footerH;
  const minTotY = footerTopY - totH;
  const totY = Math.max(y, minTotY);

  rect(doc, B, totY, innerW, totH, 0.55);

  const sepX = B + innerW * 0.62;
  line(doc, sepX, totY, sepX, totY + totH, 0.45);

  const obsX = B + 12;
  const obsW = sepX - obsX - 14;

  set(doc, "helvetica", "bold", 8.5);
  text(doc, "Observaciones:", obsX, totY + 20);

  set(doc, "helvetica", "normal", 8);
  const obs =
    data?.observaciones ||
    "Comprobante interno generado automáticamente al guardar una venta no facturada. Sin CAE, sin QR fiscal y sin validez fiscal.";

  wrapByWidth(doc, obs, obsW)
    .slice(0, 4)
    .forEach((ln, i) => {
      text(doc, ln, obsX, totY + 38 + i * 10);
    });

  const labelX = sepX + 24;
  const valueX = B + innerW - 14;

  set(doc, "helvetica", "bold", 8.8);
  text(doc, "Subtotal: $", labelX, totY + 26);
  text(doc, moneyEs(totals.subtotal), valueX, totY + 26, { align: "right" });

  text(doc, "Importe Otros Tributos: $", labelX, totY + 48);
  text(doc, moneyEs(totals.otrosTributos), valueX, totY + 48, { align: "right" });

  set(doc, "helvetica", "bold", 9.8);
  text(doc, "Importe Total: $", labelX, totY + 72);
  text(doc, moneyEs(totals.total), valueX, totY + 72, { align: "right" });

  line(doc, B, footerTopY, W - B, footerTopY, 0.45);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Comprobante interno de gestión", B + 12, footerTopY + 34);

  set(doc, "helvetica", "italic", 7.5);
  text(
    doc,
    "Sin validez fiscal. Sin CAE, sin QR fiscal y sin intervención de ARCA.",
    B + 12,
    footerTopY + 48
  );

  return totY + totH;
}

function addPageNumbering(doc) {
  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const B = 10;
  const footerH = 62;
  const footerTopY = H - B - footerH;

  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    set(doc, "helvetica", "normal", 8);
    text(doc, `Pág. ${i}/${total}`, W / 2, footerTopY + 18, {
      align: "center",
    });
  }
}

export async function buildVentaNoFacturadaPdf({ data } = {}) {
  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
    compress: true,
  });

  const logoDataUrl = await fetchTenantLogoDataUrl(data || {});
  const items = normalizeItems(data || {});

  const H = doc.internal.pageSize.getHeight();
  const footerH = 62;
  const totalsH = 88;
  const B = 10;
  const bottomLimit = H - B - footerH - totalsH - 20;

  let y;
  let cols;

  const startPage = () => {
    drawOuter(doc);

    y = drawHeader(doc, data || {}, logoDataUrl);
    y += 14;

    const header = drawTableHeader(doc, y);
    y = header.nextY;
    cols = header.cols;
  };

  startPage();

  set(doc, "helvetica", "normal", 9);

  items.forEach((it, idx) => {
    const res = drawTableRow(doc, it, idx, cols, y, bottomLimit);

    if (!res.drawn) {
      doc.addPage();
      startPage();

      set(doc, "helvetica", "normal", 9);

      const next = drawTableRow(doc, it, idx, cols, y, bottomLimit);
      y = next.y;
    } else {
      y = res.y;
    }
  });

  if (y + 110 > bottomLimit) {
    doc.addPage();
    startPage();
  }

  drawTotalsAndFooter(doc, items, data || {}, y + 10);
  addPageNumbering(doc);

  return doc;
}

export async function saveVentaNoFacturadaPdf({
  data,
  download = false,
  filename: filenameIn,
} = {}) {
  const doc = await buildVentaNoFacturadaPdf({ data });
  const blob = doc.output("blob");

  const cliente = safeFilePart(
    data?.cliente_facturacion?.razon_social ||
      data?.labelCliente ||
      data?.cliente_nombre ||
      "CLIENTE",
    "CLIENTE"
  );

  const fecha = safeFilePart(data?.fecha_cbte_iso || data?.fecha || nowStamp(), nowStamp());
  const filename = filenameIn || `VENTA_NO_FACTURADA_${fecha}_${cliente}.pdf`;

  if (download) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return {
    blob,
    filename,
  };
}