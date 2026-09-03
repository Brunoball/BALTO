// src/utils/PresupuestoPdfBuilder.js

import jsPDF from "jspdf";
import BASE_URL from "../config/config";

const API_RELATIVE = "api.php";

const FIX = {
  tipoTxt: "PRESUPUESTO",
  letra: "X",
  codTxt: "COD. 000",
  emisor_nombre: "BALTO",
  condicion_venta_default: "Presupuesto",
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
  if (/^\d{8}$/.test(str)) return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const [y, m, d] = str.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return str;
}

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

function safeFilePart(value, fallback = "PRESUPUESTO") {
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

function fillRect(doc, x, y, w, h, gray = 0.88) {
  const g = Math.max(0, Math.min(1, gray));
  doc.setFillColor(Math.round(g * 255));
  doc.rect(x, y, w, h, "F");
}

function clampToWidth(doc, value, maxW) {
  const t = sanitizePdfText(value);
  if (!t) return "";
  if (doc.getTextWidth(t) <= maxW) return t;
  let out = t;
  while (out.length > 0 && doc.getTextWidth(`${out}...`) > maxW) out = out.slice(0, -1);
  return out ? `${out}...` : "";
}

function wrapByWidth(doc, value, maxW) {
  const t = sanitizePdfText(value);
  const limit = Math.max(1, Number(maxW) || 0);
  if (!t) return [];

  const safeTextWidth = (txt) => doc.getTextWidth(sanitizePdfText(txt));
  const fits = (txt) => safeTextWidth(txt) <= limit;
  const lines = [];

  // Primero separa por espacios, pero también deja cortes naturales después de comas,
  // guiones, barras y punto y coma. Esto evita casos pegados como "MACACHA,BOULEVARD".
  const normalized = t
    .replace(/([,;/-])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();

  const words = normalized.split(" ").filter(Boolean);
  let current = "";

  const pushBroken = (chunk) => {
    let rest = sanitizePdfText(chunk).trim();
    while (rest) {
      if (fits(rest)) {
        lines.push(rest);
        return;
      }

      let low = 1;
      let high = rest.length;
      let best = 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (fits(rest.slice(0, mid))) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      const part = rest.slice(0, best).trim();
      if (part) lines.push(part);
      rest = rest.slice(best).trim();
    }
  };

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (fits(next)) {
      current = next;
      return;
    }
    if (current) {
      lines.push(current.trim());
      current = "";
    }
    if (fits(word)) {
      current = word;
    } else {
      pushBroken(word);
    }
  });

  if (current) lines.push(current.trim());
  return lines.length ? lines : [t];
}

function wrapCompactByWidth(doc, value, maxW) {
  const t = sanitizePdfText(value);
  const limit = Math.max(1, Number(maxW) || 0);
  if (!t) return [];
  if (doc.getTextWidth(t) <= limit) return [t];

  const lines = [];
  let rest = t;

  while (rest) {
    let low = 1;
    let high = rest.length;
    let best = 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (doc.getTextWidth(rest.slice(0, mid)) <= limit) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    lines.push(rest.slice(0, best));
    rest = rest.slice(best);
  }

  return lines;
}

function getWidthUntil(x, maxX, gap = 8) {
  const from = Number(x);
  const to = Number(maxX);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 1;
  return Math.max(1, to - from - gap);
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
    return String(localStorage.getItem("session_key") || localStorage.getItem("sessionKey") || "").trim();
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

let logoDataUrlCache = "";
let logoDataUrlPromise = null;

async function fetchTenantLogoDataUrl() {
  if (logoDataUrlCache) return logoDataUrlCache;
  if (logoDataUrlPromise) return logoDataUrlPromise;
  if (isLocalApiBase()) return "";

  logoDataUrlPromise = (async () => {
    try {
      const sessionKey = getSessionKey();
      if (!sessionKey) return "";
      const res = await fetch(buildApiUrl({ action: "tenant_logo_ver", tipo: "principal" }), {
        method: "GET",
        headers: { "X-Session": sessionKey },
        cache: "no-store",
      });
      if (!res.ok) return "";
      const ct = String(res.headers.get("content-type") || "").toLowerCase();
      if (!ct.startsWith("image/")) return "";
      const blob = await res.blob();
      if (!blob || !blob.size) return "";
      const dataUrl = await blobToDataUrl(blob);
      logoDataUrlCache = dataUrl;
      return dataUrl;
    } catch {
      return "";
    } finally {
      logoDataUrlPromise = null;
    }
  })();

  return logoDataUrlPromise;
}

function pickText(...values) {
  for (const value of values) {
    const txt = sanitizePdfText(value);
    if (txt) return txt;
  }
  return "";
}

function getEmisor(data) {
  const em = data?.emisor || data?.config_facturacion || data?.facturacion || data?.config || {};
  return {
    razon: pickText(data?.emisor_nombre, em.razon_social, em.nombre_fantasia, em.nombre, FIX.emisor_nombre),
    fantasia: pickText(em.nombre_fantasia),
    cuit: pickText(data?.cuit_emisor, em.cuit),
    ib: pickText(data?.ingresos_brutos_emisor, em.ingresos_brutos),
    iva: pickText(data?.cond_iva_emisor, em.condicion_iva, em.cond_iva),
    dom: pickText(data?.emisor_domicilio, em.domicilio_comercial, em.domicilio, em.domicilio_fiscal),
    inicio: ymdToHuman(pickText(data?.fecha_inicio_actividades_emisor, em.fecha_inicio_actividades, em.inicio_actividades)),
    puntoVenta: pickText(em.punto_venta, data?.pto_vta, "00000"),
  };
}

function getCliente(data) {
  const cl = data?.cliente_facturacion || data?.cliente || {};
  return {
    razon: pickText(cl.razon_social, cl.nombre, data?.cliente_nombre, data?.labelCliente, "Consumidor Final"),
    cuit: pickText(cl.cuit, cl.doc_nro, cl.dni, data?.cliente_cuit, data?.doc_nro),
    iva: pickText(cl.condicion_iva, cl.cond_iva, data?.cliente_condicion_iva),
    dom: pickText(cl.domicilio, data?.cliente_domicilio),
  };
}

function normalizeItems(data) {
  const arr = Array.isArray(data?.items_facturacion)
    ? data.items_facturacion
    : Array.isArray(data?.items)
    ? data.items
    : [];

  return arr
    .map((it, idx) => {
      const cantidad = safeNumber(it?.cantidad ?? 1, 1);
      const precio = safeNumber(it?.precio_unitario ?? it?.precio ?? 0, 0);
      const ivaPct = safeNumber(it?.iva_pct ?? it?.ivaPct ?? 0, 0);
      const subtotal = safeNumber(it?.subtotal ?? cantidad * precio, cantidad * precio);
      const ivaMonto = safeNumber(it?.iva_monto ?? subtotal * ivaPct / 100, subtotal * ivaPct / 100);
      const total = safeNumber(it?.total ?? subtotal + ivaMonto, subtotal + ivaMonto);
      return {
        codigo: sanitizePdfText(it?.codigo || it?.sku || String(idx + 1)),
        descripcion: sanitizePdfText(it?.descripcion || it?.detalle || it?.nombre || "Producto / Servicio"),
        cantidad,
        unidad: sanitizePdfText(it?.unidad || "u"),
        precio,
        ivaPct,
        subtotal,
        ivaMonto,
        total,
      };
    })
    .filter((it) => it.descripcion && it.cantidad > 0);
}

function getTotales(items, data) {
  const subtotal = items.reduce((a, it) => a + safeNumber(it.subtotal, 0), 0);
  const iva = items.reduce((a, it) => a + safeNumber(it.ivaMonto, 0), 0);
  const total = items.reduce((a, it) => a + safeNumber(it.total, 0), 0);
  return {
    subtotal: safeNumber(data?.subtotal_ars ?? data?.subtotal, subtotal),
    iva: safeNumber(data?.iva_ars ?? data?.iva, iva),
    total: safeNumber(data?.total_ars ?? data?.importe ?? data?.monto_ars ?? data?.total, total),
  };
}

function getCondicionesPresupuesto(data) {
  const c = data?.condiciones_presupuesto && typeof data.condiciones_presupuesto === "object"
    ? data.condiciones_presupuesto
    : {};
  const validezDiasRaw = data?.validez_dias ?? data?.validezDias ?? c.validez_dias ?? c.validezDias;
  const validezDias = validezDiasRaw === null || validezDiasRaw === undefined || validezDiasRaw === ""
    ? null
    : safeNumber(validezDiasRaw, 0);
  const fechaValidez = ymdToHuman(pickText(data?.fecha_validez, data?.fechaValidez, c.fecha_validez, c.fechaValidez));
  const validezTxt = validezDias && validezDias > 0
    ? `${Math.round(validezDias)} días corridos${fechaValidez ? ` (hasta ${fechaValidez})` : ""}`
    : (fechaValidez ? `Hasta ${fechaValidez}` : "No informada");

  return {
    validez: validezTxt,
    plazoEntrega: pickText(data?.plazo_entrega, data?.plazoEntrega, c.plazo_entrega, c.plazoEntrega, "A convenir."),
    formaPago: pickText(data?.forma_pago, data?.formaPago, c.forma_pago, c.formaPago, "A convenir con el cliente."),
    condiciones: pickText(data?.condiciones_comerciales, data?.condicionesComerciales, c.condiciones_comerciales, c.condicionesComerciales),
    notas: pickText(data?.notas, c.notas, data?.observaciones),
    garantia: pickText(data?.garantia, c.garantia),
    lugarEntrega: pickText(data?.lugar_entrega, data?.lugarEntrega, c.lugar_entrega, c.lugarEntrega),
  };
}

function wrapTextBlock(doc, value, maxW, maxLines = 4) {
  const raw = String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\r\n|\r/g, "\n")
    .trim();
  if (!raw) return [];

  const parts = raw.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const lines = [];
  parts.forEach((part) => {
    if (lines.length >= maxLines) return;
    const wrapped = wrapByWidth(doc, part, maxW);
    wrapped.forEach((ln) => {
      if (lines.length < maxLines) lines.push(ln);
    });
  });
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}

function drawLabelValue(doc, label, value, x, y, w, maxLines = 3) {
  const labelTxt = sanitizePdfText(label);
  const valueLines = wrapTextBlock(doc, value || "-", w, maxLines);
  set(doc, "helvetica", "bold", 8.1);
  text(doc, labelTxt, x, y);
  set(doc, "helvetica", "normal", 8);
  const startY = y + 10;
  valueLines.forEach((ln, idx) => text(doc, ln, x + 10, startY + idx * 9));
  return startY + Math.max(1, valueLines.length) * 9 + 5;
}

function presupuestoFooterRequiredHeight() {
  return 92 + 8 + 158 + 42 + 10;
}

function drawOuter(doc) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  rect(doc, 10, 10, W - 20, H - 20, 0.55);
}

function drawLogoOrFallback(doc, logoDataUrl, em, x, y, w) {
  const maxW = Math.min(200, w - 36);
  const maxH = 48;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, undefined, x + 18, y + 18, maxW, maxH, undefined, "FAST");
      return;
    } catch {}
  }
  set(doc, "helvetica", "bold", 15);
  text(doc, clampToWidth(doc, em.fantasia || em.razon || FIX.emisor_nombre, maxW), x + 18, y + 44);
}

function drawHeader(doc, data, logoDataUrl) {
  const W = doc.internal.pageSize.getWidth();
  const B = 10;
  const innerW = W - B * 2;
  const rightPageX = B + innerW;
  const em = getEmisor(data);
  const cl = getCliente(data);
  const headerY = B + 28;
  const splitX = B + innerW * 0.52;
  const letterBoxW = 50;
  const letterBoxH = 50;
  const letterX = splitX - letterBoxW / 2;

  const leftLabelX = B + 18;
  const leftValueX = B + 112;
  const leftValueMaxX = splitX - 14;
  const leftValueW = getWidthUntil(leftValueX, leftValueMaxX, 0);
  const leftInfoY = headerY + 80;
  const emDomLineH = 11;

  set(doc, "helvetica", "normal", 8.6);
  const emDomicilioLines = wrapByWidth(doc, em.dom || "-", leftValueW).slice(0, 3);
  const emDomicilioExtraH = Math.max(0, emDomicilioLines.length - 1) * emDomLineH;
  const headerH = 132 + emDomicilioExtraH;

  set(doc, "helvetica", "bold", 14);
  text(doc, "ORIGINAL", W / 2, B + 18, { align: "center" });
  line(doc, B, B + 28, W - B, B + 28, 0.55);

  rect(doc, B, headerY, innerW, headerH, 0.55);
  const gap = 1.2;
  line(doc, splitX, headerY, splitX, headerY - gap, 0.55);
  line(doc, splitX, headerY + letterBoxH + gap, splitX, headerY + headerH, 0.55);

  rect(doc, letterX, headerY, letterBoxW, letterBoxH, 0.55);
  set(doc, "helvetica", "bold", 30);
  text(doc, FIX.letra, letterX + letterBoxW / 2, headerY + 26, { align: "center" });
  set(doc, "helvetica", "bold", 9);
  text(doc, FIX.codTxt, letterX + letterBoxW / 2, headerY + 34, { align: "center" });

  drawLogoOrFallback(doc, logoDataUrl, em, B, headerY, splitX - B);

  const emDomY = leftInfoY + 16;
  const emIvaY = emDomY + 16 + emDomicilioExtraH;

  set(doc, "helvetica", "bold", 8.6);
  text(doc, "Razón Social:", leftLabelX, leftInfoY);
  text(doc, "Domicilio:", leftLabelX, emDomY);
  text(doc, "Condición IVA:", leftLabelX, emIvaY);
  set(doc, "helvetica", "normal", 8.6);
  text(doc, clampToWidth(doc, em.razon || "-", leftValueW), leftValueX, leftInfoY);
  emDomicilioLines.forEach((lineTxt, lineIdx) => {
    text(doc, lineTxt, leftValueX, emDomY + lineIdx * emDomLineH);
  });
  text(doc, clampToWidth(doc, em.iva || "-", leftValueW), leftValueX, emIvaY);

  const rightX = splitX + 22;
  const rightW = W - B - rightX - 18;
  set(doc, "helvetica", "bold", 20);
  text(doc, FIX.tipoTxt, rightX + 15, headerY + 48);
  set(doc, "helvetica", "bold", 9);
  text(doc, "DOCUMENTO NO FISCAL", rightX + 18, headerY + 65);

  const fecha = ymdToHuman(data?.fecha_cbte_iso || data?.fecha || new Date().toISOString().slice(0, 10));
  const nro = sanitizePdfText(data?.numero_presupuesto || data?.nro_presupuesto || data?.numero_interno || data?.id_movimiento || "Pendiente");
  const labels = [
    ["Fecha:", fecha],
    ["Presupuesto N°:", nro],

    ["Ingresos Brutos:", em.ib || "-"],
    ["Inicio Actividades:", em.inicio || "-"],
  ];
  let y = headerY + 80;
  labels.forEach(([lab, val]) => {
    set(doc, "helvetica", "bold", 8.4);
    text(doc, lab, rightX, y);
    set(doc, "helvetica", "normal", 8.4);
    text(doc, clampToWidth(doc, val, rightW - 86), rightX + 88, y);
    y += 10;
  });

  const clientY = headerY + headerH;
  const recLx = B + 18;
  const domLabelX = splitX - 20;
  const domValueX = domLabelX + 46;
  const ivaValueX = splitX + 84;
  const rightLimit = rightPageX - 10;
  const domValueMaxW = Math.max(80, rightLimit - domValueX - 6);
  const ivaValueMaxW = Math.max(80, rightLimit - ivaValueX - 6);
  const domLineH = 11;

  set(doc, "helvetica", "normal", 9);
  const domicilioLines = wrapByWidth(doc, cl.dom || "-", domValueMaxW);
  const domicilioExtraH = Math.max(0, domicilioLines.length - 1) * domLineH;
  const clientH = 54 + domicilioExtraH;

  rect(doc, B, clientY, innerW, clientH, 0.55);
  set(doc, "helvetica", "bold", 9);
  text(doc, "Cliente:", recLx, clientY + 20);
  text(doc, "CUIT/DNI:", recLx, clientY + 38);
  text(doc, "Cond. IVA:", domLabelX, clientY + 20);
  text(doc, "Domicilio:", domLabelX, clientY + 38);

  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, cl.razon || "Consumidor Final", splitX - B - 82), B + 72, clientY + 20);
  text(doc, clampToWidth(doc, cl.cuit || "-", splitX - B - 82), B + 72, clientY + 38);
  text(doc, clampToWidth(doc, cl.iva || "Consumidor Final", ivaValueMaxW), ivaValueX, clientY + 20);
  domicilioLines.forEach((lineTxt, lineIdx) => {
    text(doc, lineTxt, domValueX, clientY + 38 + lineIdx * domLineH);
  });

  return clientY + clientH;
}

function getColumns(doc) {
  const W = doc.internal.pageSize.getWidth();
  const B = 10;
  const innerW = W - B * 2;
  const wCodigo = 76;
  const wCant = 56;
  const wUM = 44;
  const wPU = 72;
  const wIva = 46;
  const wSub = 72;
  const wDesc = Math.max(80, innerW - (wCodigo + wCant + wUM + wPU + wIva + wSub));
  const x0 = B;
  const x1 = x0 + wCodigo;
  const x2 = x1 + wDesc;
  const x3 = x2 + wCant;
  const x4 = x3 + wUM;
  const x5 = x4 + wPU;
  const x6 = x5 + wIva;
  const x7 = B + innerW;
  return { x0, x1, x2, x3, x4, x5, x6, x7, padL: 7, padR: 7 };
}

function drawTableHeader(doc, y) {
  const B = 10;
  const W = doc.internal.pageSize.getWidth();
  const innerW = W - B * 2;
  const rowH = 22;
  const c = getColumns(doc);
  fillRect(doc, B, y, innerW, rowH, 0.86);
  rect(doc, B, y, innerW, rowH, 0.55);
  set(doc, "helvetica", "bold", 8.2);
  text(doc, "Código", c.x0 + c.padL, y + 15);
  text(doc, "Producto / Servicio", c.x1 + c.padL, y + 15);
  text(doc, "Cant.", c.x3 - c.padR, y + 15, { align: "right" });
  text(doc, "U.M.", c.x4 - c.padR, y + 15, { align: "right" });
  text(doc, "Precio Unit.", c.x5 - c.padR, y + 15, { align: "right" });
  text(doc, "IVA %", c.x6 - c.padR, y + 15, { align: "right" });
  text(doc, "Subtotal", c.x7 - c.padR, y + 15, { align: "right" });
  return { nextY: y + rowH + 15, cols: c };
}

function drawTableRow(doc, item, idx, cols, y, maxBodyY) {
  set(doc, "helvetica", "normal", 8.7);
  const codeMaxW = cols.x1 - cols.padR - (cols.x0 + cols.padL);
  const descMaxW = cols.x2 - cols.padR - (cols.x1 + cols.padL);
  const codeLines = wrapCompactByWidth(
    doc,
    item.codigo || String(idx + 1),
    Math.max(20, codeMaxW)
  );
  const descLines = wrapByWidth(doc, item.descripcion, Math.max(20, descMaxW));
  const lh = 11;
  const blockH = Math.max(14, Math.max(codeLines.length, descLines.length) * lh);
  if (y + blockH > maxBodyY) return { y, drawn: false };

  codeLines.forEach((ln, li) => text(doc, ln, cols.x0 + cols.padL, y + li * lh));
  descLines.forEach((ln, li) => text(doc, ln, cols.x1 + cols.padL, y + li * lh));
  text(doc, numEs(item.cantidad, 2), cols.x3 - cols.padR, y, { align: "right" });
  text(doc, s(item.unidad || "u"), cols.x4 - cols.padR, y, { align: "right" });
  text(doc, moneyEs(item.precio), cols.x5 - cols.padR, y, { align: "right" });
  text(doc, numEs(item.ivaPct, 2), cols.x6 - cols.padR, y, { align: "right" });
  text(doc, moneyEs(item.subtotal), cols.x7 - cols.padR, y, { align: "right" });
  return { y: y + blockH + 5, drawn: true };
}

function drawTotalsAndFooter(doc, items, data, y) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const B = 10;
  const innerW = W - B * 2;
  const totals = getTotales(items, data);
  const condiciones = getCondicionesPresupuesto(data || {});

  const totH = 92;
  const gap = 8;
  const termsH = 158;
  const footerH = 42;
  const footerTopY = H - B - footerH;
  const minTotY = footerTopY - termsH - gap - totH;
  const totY = Math.max(y, minTotY);
  const termsY = totY + totH + gap;

  rect(doc, B, totY, innerW, totH, 0.55);
  const sepX = B + innerW * 0.58;
  line(doc, sepX, totY, sepX, totY + totH, 0.45);

  const obsX = B + 12;
  const obsW = sepX - obsX - 14;
  set(doc, "helvetica", "bold", 8.5);
  text(doc, "Resumen / observaciones:", obsX, totY + 19);
  set(doc, "helvetica", "normal", 8);
  const obs = condiciones.notas || data?.observaciones || "Presupuesto sin validez fiscal. No reemplaza factura ni comprobante fiscal.";
  wrapTextBlock(doc, obs, obsW, 4).forEach((ln, i) => text(doc, ln, obsX, totY + 36 + i * 10));

  const labelX = sepX + 24;
  const valueX = B + innerW - 14;
  set(doc, "helvetica", "bold", 8.8);
  text(doc, "Subtotal: $", labelX, totY + 28);
  text(doc, moneyEs(totals.subtotal), valueX, totY + 28, { align: "right" });
  text(doc, "IVA: $", labelX, totY + 50);
  text(doc, moneyEs(totals.iva), valueX, totY + 50, { align: "right" });
  set(doc, "helvetica", "bold", 10);
  text(doc, "Importe Total: $", labelX, totY + 75);
  text(doc, moneyEs(totals.total), valueX, totY + 75, { align: "right" });

  rect(doc, B, termsY, innerW, termsH, 0.55);
  fillRect(doc, B, termsY, innerW, 22, 0.90);
  set(doc, "helvetica", "bold", 9);
  text(doc, "Condiciones comerciales del presupuesto", B + 12, termsY + 15);

  const colGap = 16;
  const colW = (innerW - 24 - colGap) / 2;
  const leftX = B + 12;
  const rightX = leftX + colW + colGap;
  let leftY = termsY + 38;
  let rightY = termsY + 38;

  leftY = drawLabelValue(doc, "Validez del presupuesto:", condiciones.validez, leftX, leftY, colW, 2);
  leftY = drawLabelValue(doc, "Plazo de entrega:", condiciones.plazoEntrega, leftX, leftY, colW, 3);
  if (condiciones.lugarEntrega) {
    leftY = drawLabelValue(doc, "Lugar de entrega:", condiciones.lugarEntrega, leftX, leftY, colW, 2);
  }

  rightY = drawLabelValue(doc, "Forma de pago:", condiciones.formaPago, rightX, rightY, colW, 4);
  const aclaraciones = [condiciones.condiciones, condiciones.garantia ? `Garantía: ${condiciones.garantia}` : ""]
    .filter(Boolean)
    .join(". ");
  if (aclaraciones) {
    rightY = drawLabelValue(doc, "Aclaraciones:", aclaraciones, rightX, rightY, colW, 4);
  }

  line(doc, B, footerTopY, W - B, footerTopY, 0.45);
  set(doc, "helvetica", "bold", 8.8);
  text(doc, "Presupuesto generado desde Balto", B + 12, footerTopY + 23);
  set(doc, "helvetica", "italic", 7.3);
  text(doc, "Documento no fiscal. Sin CAE, sin QR fiscal y sin intervención de ARCA.", B + 12, footerTopY + 36);
}

function addPageNumbering(doc) {
  const total = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    set(doc, "helvetica", "normal", 8);
    text(doc, `Pág. ${i}/${total}`, W - 24, H - 18, { align: "right" });
  }
}

export async function buildPresupuestoPdf({ data } = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const logoDataUrl = await fetchTenantLogoDataUrl();
  const items = normalizeItems(data || {});
  const H = doc.internal.pageSize.getHeight();
  const B = 10;
  const bottomLimit = H - B - presupuestoFooterRequiredHeight();
  let y;
  let cols;

  const startPage = () => {
    drawOuter(doc);
    y = drawHeader(doc, data || {}, logoDataUrl) + 14;
    const header = drawTableHeader(doc, y);
    y = header.nextY;
    cols = header.cols;
  };

  startPage();
  items.forEach((it, idx) => {
    const res = drawTableRow(doc, it, idx, cols, y, bottomLimit);
    if (!res.drawn) {
      doc.addPage();
      startPage();
      const next = drawTableRow(doc, it, idx, cols, y, bottomLimit);
      y = next.y;
    } else {
      y = res.y;
    }
  });

  if (y + presupuestoFooterRequiredHeight() > H - B) {
    doc.addPage();
    startPage();
  }
  drawTotalsAndFooter(doc, items, data || {}, y + 10);
  addPageNumbering(doc);
  return doc;
}

export async function savePresupuestoPdf({ data, download = false, filename: filenameIn } = {}) {
  const doc = await buildPresupuestoPdf({ data });
  const blob = doc.output("blob");
  const cliente = safeFilePart(data?.cliente_facturacion?.razon_social || data?.cliente_nombre || data?.labelCliente || "CLIENTE", "CLIENTE");
  const fecha = safeFilePart(data?.fecha_cbte_iso || data?.fecha || nowStamp(), nowStamp());
  const filename = filenameIn || `PRESUPUESTO_${fecha}_${cliente}.pdf`;

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

  return { blob, filename };
}
