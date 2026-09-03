// src/utils/FacturaPdfBuilder.js

import jsPDF from "jspdf";
import QRCode from "qrcode";
import BASE_URL from "../config/config";

const FIX = {
  emisor_nombre: "BALTO",
  emisor_domicilio: "",
  cuit_emisor: "",
  cond_iva_emisor: "",
  inicio_actividades: "01/01/2025",
  letra: "C",
  tipoTxt: "FACTURA",
  cod_afip: "011",
  pto_vta_fijo: "00002",
  cond_iva_receptor_default: "Consumidor Final",
  cond_venta_default: "Contado / Transferencia Bancaria",
};

const API_RELATIVE = "api.php";

function sanitizePdfText(input) {
  let t = input == null ? "" : String(input);
  t = t.replace(/\s+/g, " ").trim();
  t = t
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->");

  let out = "";
  for (let i = 0; i < t.length; i++) {
    out += t.charCodeAt(i) <= 255 ? t[i] : " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

function s(v) {
  return v == null ? "" : String(v);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function padLeft(v, len) {
  return s(v).padStart(len, "0");
}

function isYMD8(v) {
  const str = String(v || "");
  return str.length === 8 && /^\d{8}$/.test(str);
}

function isoToYmd(iso) {
  const str = String(iso || "").trim();
  if (!str) return "";
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}`;
}

function ymdToHuman(ymd) {
  if (!ymd) return "";
  const str = String(ymd);

  if (isYMD8(str)) {
    return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
  }

  if (str.length >= 10 && str.includes("-")) {
    const [y, m, d] = str.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  return str;
}

function plusDaysIso(baseIso, days = 20) {
  const base = String(baseIso || "").slice(0, 10);
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(base)
    ? new Date(`${base}T00:00:00`)
    : new Date();
  dt.setDate(dt.getDate() + Number(days || 0));
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function numEs(v, dec = 2) {
  const n = Number(v);
  const x = Number.isFinite(n) ? n : 0;
  return x.toLocaleString("es-AR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function moneyEs(v) {
  return numEs(v, 2);
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const t = String(v || "").toLowerCase().trim();
  return t === "1" || t === "true" || t === "yes" || t === "si";
}

function firstFinite(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
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

function set(doc, font = "helvetica", style = "normal", size = 10) {
  doc.setFont(font, style);
  doc.setFontSize(size);
}

function text(doc, str, x, y, opt) {
  doc.text(sanitizePdfText(str), x, y, opt);
}

function clampToWidth(doc, str, maxW) {
  const t = sanitizePdfText(str);
  if (!t) return "";
  if (doc.getTextWidth(t) <= maxW) return t;

  let out = t;
  while (out.length > 0 && doc.getTextWidth(out + "...") > maxW) {
    out = out.slice(0, -1);
  }
  return out.length ? `${out}...` : "";
}

function wrapByWidth(doc, str, maxW) {
  const t = sanitizePdfText(str);
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

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((it) => {
      if (typeof it === "string") return it;
      if (it && typeof it === "object") {
        const code = it.Code || it.code || "";
        const msg = it.Msg || it.msg || "";
        return `${code ? `[${code}] ` : ""}${msg}`.trim();
      }
      return "";
    })
    .filter(Boolean);
}

function computeItems(fact, data, totalArs) {
  const total = safeNumber(
    totalArs,
    safeNumber(
      fact?.imp_total ?? fact?.importe ?? data?.monto ?? data?.importe ?? 0,
      0
    )
  );

  const fromModal = Array.isArray(data?.items_facturacion)
    ? data.items_facturacion
    : [];

  const modalNorm = fromModal
    .map((it, idx) => {
      const descRaw =
        it?.descripcion ??
        it?.detalle ??
        it?.nombre ??
        it?.label ??
        it?.titulo ??
        it?.plan ??
        "";

      const descBase = sanitizePdfText(s(descRaw).trim());
      if (!descBase) return null;

      const ars = firstFinite(it?.ars, it?.ars_total, it?.subtotal_ars, it?.total);
      const fallbackArs = firstFinite(
        it?.subtotal,
        it?.precio_unitario,
        it?.precio,
        it?.importe,
        it?.monto
      );

      const valueArs = ars != null ? ars : fallbackArs != null ? fallbackArs : 0;

      return {
        codigo: String(idx + 1),
        descripcion: descBase,
        cantidad: safeNumber(it?.cantidad, 1),
        unidad: sanitizePdfText(it?.unidad || "serv."),
        precio: safeNumber(it?.precio_unitario ?? it?.precio, valueArs),
        bonifPct: safeNumber(it?.bonif_pct, 0),
        impBonif: safeNumber(it?.impBonif, 0),
        subtotal: safeNumber(it?.subtotal ?? it?.total, valueArs),
      };
    })
    .filter(Boolean);

  if (modalNorm.length) {
    const sum = modalNorm.reduce((acc, it) => acc + safeNumber(it.subtotal, 0), 0);
    const diff = total - sum;

    if (Number.isFinite(diff) && Math.abs(diff) >= 0.01) {
      const last = modalNorm[modalNorm.length - 1];
      const newSub = safeNumber(last.subtotal, 0) + diff;
      last.subtotal = newSub;
    }

    return modalNorm;
  }

  const desc = sanitizePdfText(
    s(data?.detalle || data?.labelSistema || data?.sistema || "Servicio")
  );

  return [
    {
      codigo: "1",
      descripcion: desc,
      cantidad: 1,
      unidad: "serv.",
      precio: total,
      bonifPct: 0,
      impBonif: 0,
      subtotal: total,
    },
  ];
}

function normalizeCbteTipoCode(...values) {
  for (const value of values) {
    const digits = String(value ?? "").replace(/\D/g, "");
    const n = Number(digits);

    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }

  return 11;
}

function getCbteVisualMeta(cbteTipo, data = {}, fact = {}) {
  const n = normalizeCbteTipoCode(
    cbteTipo,
    fact?.cbte_tipo,
    data?.cbte_tipo,
    fact?.codigo_comprobante,
    data?.codigo_comprobante
  );

  const byCode = {
    1: { letra: "A", tipoTxt: "FACTURA", cod: "001" },
    6: { letra: "B", tipoTxt: "FACTURA", cod: "006" },
    11: { letra: "C", tipoTxt: "FACTURA", cod: "011" },
    3: { letra: "A", tipoTxt: "NOTA DE CRÉDITO", cod: "003" },
    8: { letra: "B", tipoTxt: "NOTA DE CRÉDITO", cod: "008" },
    13: { letra: "C", tipoTxt: "NOTA DE CRÉDITO", cod: "013" },
    2: { letra: "A", tipoTxt: "NOTA DE DÉBITO", cod: "002" },
    7: { letra: "B", tipoTxt: "NOTA DE DÉBITO", cod: "007" },
    12: { letra: "C", tipoTxt: "NOTA DE DÉBITO", cod: "012" },
    4: { letra: "A", tipoTxt: "RECIBO", cod: "004" },
    9: { letra: "B", tipoTxt: "RECIBO", cod: "009" },
    15: { letra: "C", tipoTxt: "RECIBO", cod: "015" },
  };

  const mapped = byCode[n] || {
    letra: FIX.letra,
    tipoTxt: FIX.tipoTxt,
    cod: String(n || 11).padStart(3, "0"),
  };

  const tipoConfig = sanitizePdfText(
    data?.tipo_comprobante_default ||
      fact?.tipo_comprobante_default ||
      ""
  ).toUpperCase();

  const codigoConfig = String(
    data?.codigo_comprobante ||
      fact?.codigo_comprobante ||
      ""
  ).replace(/\D/g, "");

  return {
    letra: mapped.letra,
    tipoTxt: tipoConfig || mapped.tipoTxt,
    cod: codigoConfig ? codigoConfig.padStart(3, "0") : mapped.cod,
    cbteTipoNumero: n,
  };
}

function getMeta(fact, data = {}) {
  const ptoVta = padLeft(fact?.pto_vta ?? data?.pto_vta ?? 2, 5);
  const cbteNro = padLeft(fact?.cbte_nro ?? fact?.cbte_numero ?? data?.cbte_nro ?? "", 8);
  const visual = getCbteVisualMeta(
    fact?.cbte_tipo ?? data?.cbte_tipo ?? data?.codigo_comprobante ?? FIX.cod_afip,
    data,
    fact
  );
  const cbteTipo = padLeft(visual.cbteTipoNumero, 3);
  const fechaEmision = ymdToHuman(fact?.fecha_cbte || fact?.fecha_emision || data?.fecha_cbte || "");
  const remito = cbteNro ? `${ptoVta}-${cbteNro}` : "";

  const caeDigits = String(fact?.cae || "").replace(/\D/g, "");
  const cae = caeDigits ? caeDigits.padStart(14, "0").slice(0, 14) : "";

  return {
    letra: visual.letra,
    tipoTxt: visual.tipoTxt,
    cod: visual.cod,
    cbteTipo,
    ptoVta,
    cbteNro,
    fechaEmision,
    cae,
    caeVto: ymdToHuman(fact?.cae_vto || fact?.fecha_vto_cae || ""),
    qrUrl: s(fact?.qr_url || ""),
    resultado: s(fact?.resultado || ""),
    remito,
  };
}

function getEmisor(data, fact) {
  return {
    razon: data?.emisor_nombre || fact?.emisor_nombre || FIX.emisor_nombre,
    domComercial:
      data?.emisor_domicilio || fact?.emisor_domicilio || FIX.emisor_domicilio,
    cuit: data?.cuit_emisor || fact?.cuit_emisor || FIX.cuit_emisor,
    condIva: data?.cond_iva_emisor || fact?.cond_iva_emisor || FIX.cond_iva_emisor,
    iibb: data?.ingresos_brutos_emisor || fact?.ingresos_brutos_emisor || "",
    inicioAct:
      data?.fecha_inicio_actividades_emisor ||
      fact?.fecha_inicio_actividades_emisor ||
      data?.inicio_actividades ||
      FIX.inicio_actividades,
  };
}

function getReceptor(fact, data) {
  const cf = data?.cliente_facturacion || null;

  const docNro = s(
    fact?.doc_nro ?? cf?.doc_nro ?? data?.doc_nro ?? ""
  ).replace(/\D/g, "");

  const nroParaCaja = docNro || s(fact?.receptor_cuit || data?.receptor_cuit || "");

  return {
    cuit: sanitizePdfText(s(nroParaCaja || "")),
    razon: sanitizePdfText(
      s(
        cf?.razon_social ||
          fact?.receptor_nombre ||
          data?.receptor_nombre ||
          data?.labelCliente ||
          data?.cliente ||
          ""
      )
    ),
    dom: sanitizePdfText(
      s(cf?.domicilio || fact?.receptor_domicilio || data?.cliente_domicilio || "")
    ),
    condIva: sanitizePdfText(
      s(
        cf?.cond_iva ||
          cf?.condicion_iva ||
          fact?.cond_iva_receptor ||
          data?.cond_iva_receptor ||
          FIX.cond_iva_receptor_default
      )
    ),
    condVenta: sanitizePdfText(
      s(
        fact?.condicion_venta ||
          cf?.cond_venta ||
          data?.condicion_venta ||
          FIX.cond_venta_default
      )
    ),
  };
}

function getPeriodo(fact, data) {
  const pick = (...vals) => {
    for (const v of vals) {
      const t = s(v).trim();
      if (t) return t;
    }
    return "";
  };

  const fechaEmisionIso =
    pick(
      fact?.fecha_cbte,
      fact?.fecha_emision,
      data?.fecha_cbte_iso,
      data?.fecha_cbte
    ) || new Date().toISOString().slice(0, 10);

  const desdeRaw = pick(
    data?.periodo_desde,
    data?.periodo_desde_iso,
    fact?.periodo_desde,
    fact?.FchServDesde,
    fact?.fch_serv_desde,
    fechaEmisionIso
  );

  const hastaRaw = pick(
    data?.periodo_hasta,
    data?.periodo_hasta_iso,
    fact?.periodo_hasta,
    fact?.FchServHasta,
    fact?.fch_serv_hasta,
    plusDaysIso(fechaEmisionIso, 20)
  );

  const vtoRaw = pick(
    data?.vto_pago,
    data?.vto_pago_iso,
    fact?.vto_pago,
    fact?.FchVtoPago,
    fact?.fch_vto_pago,
    fact?.fecha_vto_pago,
    plusDaysIso(fechaEmisionIso, 20)
  );

  return {
    desde: ymdToHuman(desdeRaw),
    hasta: ymdToHuman(hastaRaw),
    vtoPago: ymdToHuman(vtoRaw),
  };
}

function buildFallbackQrUrlFromPayload(fact) {
  const payload = fact?.qr_payload;
  if (!payload || typeof payload !== "object") return "";

  try {
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `https://www.arca.gob.ar/fe/qr/?p=${encodeURIComponent(b64)}`;
  } catch {
    return "";
  }
}

function getQrText(fact) {
  const fromUrl = s(fact?.qr_url || "").trim();
  if (fromUrl) return fromUrl;

  const fallback = buildFallbackQrUrlFromPayload(fact);
  if (fallback) return fallback;

  return "";
}

async function buildQrDataUrl(fact) {
  const qrText = getQrText(fact);
  if (!qrText) return "";

  try {
    const dataUrl = await QRCode.toDataURL(qrText, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
    });
    return dataUrl || "";
  } catch {
    return "";
  }
}

/* =========================================================
   LOGO DEL TENANT / NEGOCIO EMISOR
   ✅ CORRECCIÓN: usa tipo "principal" para la factura
========================================================= */

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
    return String(localStorage.getItem("session_key") || "").trim();
  } catch {
    return "";
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    } catch {
      resolve("");
    }
  });
}

// ✅ CORRECCIÓN: Versión corregida que pide directamente a la API
async function fetchTenantLogoDataUrl(data, fact) {
  try {
    const direct =
      s(data?.emisor_logo_data_url) ||
      s(fact?.emisor_logo_data_url) ||
      s(data?.logo_data_url) ||
      s(fact?.logo_data_url);

    if (direct) return direct;

    if (isLocalApiBase()) return "";

    const sessionKey = getSessionKey();
    if (!sessionKey) return "";

    const logoUrl = buildApiUrl({
      action: "tenant_logo_ver",
      tipo: "principal",
    });

    const res = await fetch(logoUrl, {
      method: "GET",
      headers: {
        "X-Session": sessionKey,
      },
      cache: "no-store",
    });

    if (res.status === 204 || res.status === 404 || res.status === 500) {
      return "";
    }

    if (!res.ok) return "";

    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return "";

    const blob = await res.blob();
    if (!blob || !blob.size) return "";

    return await blobToDataUrl(blob);
  } catch {
    return "";
  }
}

function getImageFormatFromDataUrl(dataUrl) {
  const t = String(dataUrl || "").toLowerCase();
  if (t.startsWith("data:image/png")) return "PNG";
  if (t.startsWith("data:image/webp")) return "WEBP";
  if (t.startsWith("data:image/jpeg") || t.startsWith("data:image/jpg")) return "JPEG";
  return "PNG";
}

function drawLogoOrFallback(doc, logoDataUrl, em, leftX, headerY, splitX) {
  const logoBoxX = leftX + 10;
  const logoBoxY = headerY + 10;
  const logoBoxW = 204;
  const logoBoxH = 60;

  const maxTextW = splitX - leftX - 18;

  if (logoDataUrl) {
    try {
      const fmt = getImageFormatFromDataUrl(logoDataUrl);
      doc.addImage(logoDataUrl, fmt, logoBoxX, logoBoxY, logoBoxW, logoBoxH);
      return;
    } catch {
      // fallback al texto
    }
  }

  set(doc, "helvetica", "bold", 22);
  text(doc, clampToWidth(doc, em?.razon || "BALTO", maxTextW), leftX, logoBoxY + 28);
}

async function drawBottomAnchored(doc, ctx, layout) {
  const { fact, data, forceTestAmount, testAmount } = ctx;
  const { W, H, B, innerW } = layout;

  const meta = getMeta(fact, data);
  const totalReal = safeNumber(
    fact?.imp_total ?? fact?.importe ?? data?.monto ?? data?.importe ?? 0,
    0
  );
  const totalTest = safeNumber(testAmount, 1000);
  const total = toBool(forceTestAmount) ? totalTest : totalReal;

  const footerH = 118;
  const gap = 18;
  const totH = 78;
  const footY = H - B - footerH;
  const totY = footY - gap - totH;

  rect(doc, B, totY, innerW, totH, 0.55);

  const padR = 14;
  const xVal = B + innerW - padR;
  const xLbl = xVal - 132;

  set(doc, "helvetica", "bold", 9);
  text(doc, "Subtotal: $", xLbl, totY + 24, { align: "right" });
  text(doc, moneyEs(total), xVal, totY + 24, { align: "right" });

  text(doc, "Importe Otros Tributos: $", xLbl, totY + 44, { align: "right" });
  text(doc, moneyEs(0), xVal, totY + 44, { align: "right" });

  text(doc, "Importe Total: $", xLbl, totY + 64, { align: "right" });
  text(doc, moneyEs(total), xVal, totY + 64, { align: "right" });

  const qrSize = 92;
  const qrX = B + 10;
  const qrY = footY + 12;

  rect(doc, qrX, qrY, qrSize, qrSize, 0.4);

  const qrDataUrl = await buildQrDataUrl(fact);

  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", qrX + 4, qrY + 4, qrSize - 8, qrSize - 8);
    } catch {
      set(doc, "helvetica", "bold", 7);
      text(doc, "QR", qrX + qrSize / 2, qrY + qrSize / 2, { align: "center" });
    }
  } else {
    set(doc, "helvetica", "bold", 7);
    text(doc, "QR", qrX + qrSize / 2, qrY + qrSize / 2, { align: "center" });
  }

  const arcaX = qrX + qrSize + 22;

  set(doc, "helvetica", "bold", 20);
  text(doc, "ARCA", arcaX, footY + 50);
  set(doc, "helvetica", "normal", 6);
  text(doc, "AGENCIA DE RECAUDACION", arcaX, footY + 58);
  text(doc, "Y CONTROL ADUANANERO", arcaX, footY + 65);

  set(doc, "helvetica", "bold", 10);
  text(doc, "Comprobante Autorizado", arcaX, footY + 86);

  set(doc, "helvetica", "italic", 6.7);
  text(
    doc,
    "Esta Agencia no se responsabiliza por los datos ingresados en el detalle de la operación",
    arcaX,
    footY + 102
  );

  set(doc, "helvetica", "bold", 9);
  text(doc, "Pag. 1/1", W / 2 - 40, footY + 50, { align: "center" });

  set(doc, "helvetica", "bold", 9);
  text(doc, "CAE N°:", W / 2 + 10, footY + 62, { align: "left" });
  set(doc, "helvetica", "normal", 9);
  text(doc, meta.cae, W / 2 + 55, footY + 62, { align: "left" });

  set(doc, "helvetica", "bold", 9);
  text(doc, "Fecha de Vto. de CAE:", W / 2 + 10, footY + 74, { align: "left" });
  set(doc, "helvetica", "normal", 9);
  text(doc, meta.caeVto, W / 2 + 135, footY + 74, { align: "left" });

  set(doc, "courier", "normal", 9);
  text(doc, meta.cae, W - B - 10, H - B - 6, { align: "right" });

  return { totY, footY, total };
}

async function drawPage(doc, pageName, ctx) {
  const { fact, data, forceTestAmount, testAmount, logoDataUrl } = ctx;

  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const B = 10;
  const innerW = W - 2 * B;

  rect(doc, B, B, innerW, H - 2 * B, 0.75);

  const bandH = 28;
  set(doc, "helvetica", "bold", 14);

  // centrado horizontal y vertical real dentro de la banda
  const bandCenterX = B + innerW / 2;
  const bandCenterY = B + bandH / 2;
  text(doc, pageName.toUpperCase(), bandCenterX + 10, bandCenterY + 5, {
    align: "center",
  });
  line(doc, B, B + bandH, W - B, B + bandH, 0.55);

  const meta = getMeta(fact, data);
  const em = getEmisor(data, fact);
  const rc = getReceptor(fact, data);
  const per = getPeriodo(fact, data);

  const headerY = B + bandH;
  const headerH = 132;
  rect(doc, B, headerY, innerW, headerH, 0.55);

  const splitX = B + innerW * 0.52;

  const boxW = 50;
  const boxH = 50;
  const boxX = splitX - boxW / 2;
  const boxY = headerY + 0;

  const gap = 1.2;
  line(doc, splitX, headerY, splitX, boxY - gap, 0.55);
  line(doc, splitX, boxY + boxH + gap, splitX, headerY + headerH, 0.55);
  rect(doc, boxX, boxY, boxW, boxH, 0.55);

  set(doc, "helvetica", "bold", 30);
  text(doc, meta.letra, boxX + boxW / 2, boxY + 26, { align: "center" });
  set(doc, "helvetica", "bold", 9);
  text(doc, `COD. ${meta.cod}`, boxX + boxW / 2, boxY + 34, { align: "center" });

  const leftX = B + 12;
  const ly = headerY + 72;

  drawLogoOrFallback(doc, logoDataUrl, em, leftX, headerY, splitX);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Razón Social:", leftX, ly + 18);
  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, em.razon, splitX - leftX - 12), leftX + 78, ly + 18);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Domicilio Comercial:", leftX, ly + 38);
  set(doc, "helvetica", "normal", 9);
  text(
    doc,
    clampToWidth(doc, em.domComercial, splitX - leftX - 12),
    leftX + 100,
    ly + 38
  );

  set(doc, "helvetica", "bold", 9);
  text(doc, "Condición frente al IVA:", leftX, ly + 58);
  set(doc, "helvetica", "normal", 9);
  text(
    doc,
    clampToWidth(doc, em.condIva, splitX - leftX - 12),
    leftX + 130,
    ly + 58
  );

  const rx = splitX + 1;
  set(doc, "helvetica", "bold", 20);
  text(doc, meta.tipoTxt || "FACTURA", rx + 30, headerY + 48);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Punto de Venta:", rx + 40, headerY + 65);
  text(doc, "Comp. Nro:", rx + 168, headerY + 65);

  set(doc, "helvetica", "bold", 9);
  text(doc, meta.ptoVta, rx + 110, headerY + 65, { align: "left" });
  text(doc, meta.cbteNro, rx + 220, headerY + 65, { align: "left" });

  set(doc, "helvetica", "bold", 9);
  text(doc, "Fecha de Emisión:", rx + 40, headerY + 80);
  set(doc, "helvetica", "normal", 9);
  text(doc, meta.fechaEmision, rx + 135, headerY + 80);

  set(doc, "helvetica", "bold", 9);
  text(doc, "CUIT:", rx + 40, headerY + 102);
  set(doc, "helvetica", "normal", 9);
  text(doc, em.cuit, rx + 75, headerY + 102);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Ingresos Brutos:", rx + 40, headerY + 115);
  set(doc, "helvetica", "normal", 9);
  text(doc, em.iibb, rx + 125, headerY + 115);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Fecha de Inicio de Actividades:", rx + 40, headerY + 128);
  set(doc, "helvetica", "normal", 9);
  text(doc, s(em.inicioAct), W - B - 48, headerY + 128, { align: "right" });

  const periodY = headerY + headerH;
  const periodH = 30;
  rect(doc, B, periodY, innerW, periodH, 0.55);

  set(doc, "helvetica", "bold", 10);
  text(doc, "Período Facturado Desde:", B + 10, periodY + 20);
  set(doc, "helvetica", "normal", 10);
  text(doc, per.desde, B + 145, periodY + 20);

  set(doc, "helvetica", "bold", 10);
  text(doc, "Hasta:", B + 240, periodY + 20);
  set(doc, "helvetica", "normal", 10);
  text(doc, per.hasta, B + 275, periodY + 20);

  set(doc, "helvetica", "bold", 10);
  text(doc, "Fecha de Vto. para el pago:", B + 355, periodY + 20);
  set(doc, "helvetica", "normal", 10);
  text(doc, per.vtoPago, B + 545, periodY + 20, { align: "right" });

  const recY = periodY + periodH;
  const recH = 78;
  rect(doc, B, recY, innerW, recH, 0.55);

  const recLx = B + 10;
  set(doc, "helvetica", "bold", 9);
  text(doc, "CUIT / DOC:", recLx, recY + 18);
  set(doc, "helvetica", "normal", 9);
  text(doc, rc.cuit, recLx + 58, recY + 18);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Condición frente al IVA:", recLx, recY + 46);
  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, rc.condIva, 190), recLx + 110, recY + 46);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Condición de venta:", recLx, recY + 62);
  set(doc, "helvetica", "normal", 9);
  text(doc, clampToWidth(doc, rc.condVenta, 220), recLx + 90, recY + 62);

  const recRx = B + innerW * 0.46;
  set(doc, "helvetica", "bold", 9);
  text(doc, "Apellido y Nombre / Razón Social:", 150, recY + 18);

  set(doc, "helvetica", "normal", 9);
  const razonLines = wrapByWidth(doc, rc.razon, innerW - (recRx - B) - 12);
  text(doc, razonLines[0] || "", recRx + 30, recY + 18);
  if (razonLines[1]) text(doc, razonLines[1], recRx + 185, recY + 30);

  set(doc, "helvetica", "bold", 9);
  text(doc, "Domicilio:", recRx + 0, recY + 46);
  set(doc, "helvetica", "normal", 9);
  text(
    doc,
    clampToWidth(doc, rc.dom, innerW - (recRx - B) - 12),
    recRx + 45,
    recY + 46
  );

  set(doc, "helvetica", "bold", 9);
  text(doc, "Remito:", recRx + 0, recY + 62);
  set(doc, "helvetica", "normal", 9);
  text(doc, meta.remito, recRx + 45, recY + 62);

  const layout = { W, H, B, innerW };
  const bottom = await drawBottomAnchored(
    doc,
    { fact, data, forceTestAmount, testAmount },
    layout
  );

  const tblY = recY + recH + 14;
  const tblBottomLimit = bottom.totY - 18;
  const tblH = Math.max(170, tblBottomLimit - tblY);

  const headerRowH = 22;
  fillRect(doc, B, tblY, innerW, headerRowH, 0.84);
  rect(doc, B, tblY, innerW, headerRowH, 0.55);

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

  const padL = 8;
  const padR = 8;

  set(doc, "helvetica", "bold", 8.6);
  text(doc, "Código", x0 + padL, tblY + 15);
  text(doc, "Producto / Servicio", x1 + padL, tblY + 15);
  text(doc, "Cantidad", x3 - padR, tblY + 15, { align: "right" });
  text(doc, "U. Medida", x4 - padR, tblY + 15, { align: "right" });
  text(doc, "Precio Unit.", x5 - padR, tblY + 15, { align: "right" });
  text(doc, "% Bonif", x6 - padR, tblY + 15, { align: "right" });
  text(doc, "Imp. Bonif.", x7 - padR, tblY + 15, { align: "right" });
  text(doc, "Subtotal", x8 - padR, tblY + 15, { align: "right" });

  const totalReal = safeNumber(
    fact?.imp_total ?? fact?.importe ?? data?.monto ?? data?.importe ?? 0,
    0
  );
  const totalTest = safeNumber(testAmount, 1000);
  const total = toBool(forceTestAmount) ? totalTest : totalReal;

  const items = computeItems({ ...fact, importe: total }, data, total);

  set(doc, "helvetica", "normal", 9);
  let y = tblY + headerRowH + 16;
  const maxBodyY = tblY + tblH - 8;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const descMaxW = (x2 - padR) - (x1 + padL);
    const descLines = wrapByWidth(doc, it.descripcion, Math.max(20, descMaxW));

    const lh = 11;
    const blockH = Math.max(14, descLines.length * lh);

    if (y + blockH > maxBodyY) break;

    text(doc, s(it.codigo || String(i + 1)), x0 + padL, y);

    for (let li = 0; li < descLines.length; li++) {
      text(doc, descLines[li], x1 + padL, y + li * lh);
    }

    text(doc, numEs(it.cantidad ?? 1, 2), x3 - padR, y, { align: "right" });
    text(doc, s(it.unidad || "serv."), x4 - padR, y, { align: "right" });
    text(doc, moneyEs(it.precio || 0), x5 - padR, y, { align: "right" });
    text(doc, numEs(it.bonifPct || 0, 2), x6 - padR, y, { align: "right" });
    text(doc, moneyEs(it.impBonif || 0), x7 - padR, y, { align: "right" });
    text(doc, moneyEs(it.subtotal || 0), x8 - padR, y, { align: "right" });

    y += blockH + 4;
  }
}

export async function buildBaltoInvoicePdf({
  fact,
  data,
  forceTestAmount = false,
  testAmount = 1000,
} = {}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const logoDataUrl = await fetchTenantLogoDataUrl(data, fact);

  await drawPage(doc, "ORIGINAL", {
    fact,
    data,
    forceTestAmount,
    testAmount,
    logoDataUrl,
  });

  doc.addPage();

  await drawPage(doc, "DUPLICADO", {
    fact,
    data,
    forceTestAmount,
    testAmount,
    logoDataUrl,
  });

  doc.addPage();

  await drawPage(doc, "TRIPLICADO", {
    fact,
    data,
    forceTestAmount,
    testAmount,
    logoDataUrl,
  });

  return doc;
}

export async function saveBaltoInvoicePdf({
  fact,
  data,
  forceTestAmount = false,
  testAmount = 1000,
  download = true,
  filename: filenameIn,
} = {}) {
  const doc = await buildBaltoInvoicePdf({
    fact,
    data,
    forceTestAmount,
    testAmount,
  });

  const blob = doc.output("blob");

  const safe = (x) =>
    sanitizePdfText(String(x || ""))
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 60);

  const pv = String(fact?.pto_vta ?? FIX.pto_vta_fijo).padStart(5, "0");
  const nro = String(fact?.cbte_nro ?? "0").padStart(8, "0");
  const cli = safe(
    data?.cliente_facturacion?.razon_social ||
      data?.labelCliente ||
      data?.cliente ||
      "CLIENTE"
  );
  const sys = safe(data?.labelSistema || data?.sistema || "SISTEMA");

  const filename = filenameIn || `FACTURA_${pv}-${nro}_${cli}_${sys}.pdf`;

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