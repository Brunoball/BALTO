import BASE_URL from "../../../config/config";
import { getAuthInfo } from "../api/cuentasCorrientesApi";

export function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatDateISO(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateLabel(d) {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

export function safeText(v) {
  return String(v ?? "").trim();
}

export function normLower(s) {
  return safeText(s).toLowerCase();
}

export function formatDisplayDate(value) {
  const v = safeText(value);
  if (!v) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return v;
}

function getBaseOrigin() {
  try {
    return new URL(BASE_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export function resolveFileUrl(rawUrl) {
  const url = safeText(rawUrl);
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  const origin = getBaseOrigin();
  if (url.startsWith("/")) return `${origin}${url}`;
  return `${origin}/${url.replace(/^\.?\//, "")}`;
}

export function withSessionKey(url) {
  const base = safeText(url);
  if (!base) return "";

  try {
    const { sessionKey, token } = getAuthInfo();
    const u = new URL(base, window.location.origin);

    const isSignedObjectUrl =
      u.searchParams.has("X-Amz-Signature") ||
      u.searchParams.has("x-amz-signature") ||
      /r2\.cloudflarestorage\.com$/i.test(u.hostname);

    if (isSignedObjectUrl) return u.toString();

    if (sessionKey && !u.searchParams.has("session_key")) {
      u.searchParams.set("session_key", sessionKey);
    }

    if (token && !u.searchParams.has("token")) {
      u.searchParams.set("token", token);
    }

    return u.toString();
  } catch {
    return base;
  }
}

function ensureResourceHint(url, rel = "prefetch", as = "") {
  const href = safeText(url);
  if (!href) return;

  const finalAs = rel === "preload" ? safeText(as) : "";
  const key = `hint:${rel}:${finalAs}:${href}`;
  const selectorKey =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(key)
      : key.replace(/"/g, '\\"');

  if (document.head.querySelector(`link[data-key="${selectorKey}"]`)) return;

  const link = document.createElement("link");
  link.rel = rel;

  if (rel === "preload" && finalAs) link.as = finalAs;

  link.href = href;
  link.setAttribute("data-key", key);
  document.head.appendChild(link);
}

export function prewarmComprobanteUrl(url, mime = "") {
  const finalUrl = withSessionKey(url);
  if (!finalUrl) return;

  const mm = safeText(mime).toLowerCase();
  const ll = finalUrl.toLowerCase();

  const isPdf =
    mm.includes("pdf") ||
    ll.includes(".pdf") ||
    ll.includes("cc_comprobante_descargar");

  if (isPdf) {
    ensureResourceHint(finalUrl, "prefetch");
  } else {
    ensureResourceHint(finalUrl, "preload", "image");
    ensureResourceHint(finalUrl, "prefetch");
  }
}

function comprobanteLabelFromTipo(tipo = "", fallback = "Comprobante") {
  const t = safeText(tipo).toUpperCase();
  if (t === "VENTA_NO_FACTURADA") return "Venta no facturada";
  if (t === "FACTURA_INTERNA") return "Factura interna";
  if (["FACTURA", "FACTURA_FISCAL", "COMPROBANTE_FISCAL"].includes(t)) return "Factura";
  if (t === "REMITO") return "Remito";
  if (t === "RECIBO") return "Recibo";
  if (t === "ORDEN_PAGO") return "Orden de pago";
  if (["NOTA_CREDITO", "NOTA_CREDITO_INTERNA"].includes(t)) return "Nota de crédito";
  if (t === "NOTA_DEBITO") return "Nota de débito";
  return safeText(fallback) || "Comprobante";
}

function comprobanteRank(doc) {
  const t = safeText(doc?.tipo || doc?.tipo_relacion || "").toUpperCase();
  const k = safeText(doc?.key || "").toLowerCase();
  if (["VENTA_NO_FACTURADA", "FACTURA_INTERNA", "FACTURA", "FACTURA_FISCAL", "COMPROBANTE_FISCAL"].includes(t) || k.includes("factura") || k.includes("venta_no_facturada")) return 10;
  if (t === "REMITO" || k.includes("remito")) return 20;
  if (["NOTA_CREDITO", "NOTA_CREDITO_INTERNA"].includes(t) || k.includes("nota_credito")) return 30;
  if (t === "NOTA_DEBITO" || k.includes("nota_debito")) return 40;
  return 50;
}

export function normalizeCCComprobanteDocs(row) {
  const rawDocsBase = Array.isArray(row?.comprobantes_detalle) ? row.comprobantes_detalle : [];
  const pagosDocs = Array.isArray(row?.medios_pago_detalle)
    ? row.medios_pago_detalle
        .map((medio) => {
          const id = Number(medio?.id_comprobante ?? medio?.id_archivo ?? 0);
          const rawUrl = safeText(medio?.url || medio?.archivo_url || medio?.comprobante_url || "");
          if (!id && !rawUrl) return null;

          const tipo = safeText(
            medio?.tipo ||
              medio?.tipo_archivo ||
              medio?.archivo_tipo ||
              (row?.id_proveedor ? "ORDEN_PAGO" : "RECIBO")
          ).toUpperCase();
          const label = safeText(medio?.label || medio?.title || comprobanteLabelFromTipo(tipo, "Comprobante de pago"));

          return {
            ...medio,
            id_comprobante: Number.isFinite(id) && id > 0 ? id : null,
            id_archivo: Number.isFinite(id) && id > 0 ? id : null,
            tipo,
            tipo_relacion: safeText(medio?.tipo_relacion || tipo).toUpperCase(),
            key: safeText(medio?.key || `${tipo || "comprobante_pago"}_${id || rawUrl}`).toLowerCase(),
            label,
            title: label,
            mime: safeText(medio?.mime || medio?.archivo_mime || "application/pdf") || "application/pdf",
            fileName: safeText(medio?.fileName || medio?.filename || `${label.toLowerCase().replace(/\s+/g, "_")}.pdf`),
            rawUrl,
            cacheSalt: safeText(medio?.archivo_path || medio?.archivo_created_at || medio?.created_at || tipo || id || rawUrl),
          };
        })
        .filter(Boolean)
    : [];

  const rawDocs = [...rawDocsBase, ...pagosDocs];
  const seenDocs = new Set();
  const docs = rawDocs
    .map((doc, index) => {
      const id = Number(doc?.id_comprobante ?? doc?.id_archivo ?? doc?.id ?? 0);
      const rawUrl = safeText(doc?.url || doc?.archivo_url || doc?.comprobante_url || "");
      if (!id && !rawUrl) return null;

      const tipo = safeText(doc?.tipo || doc?.tipo_relacion || doc?.archivo_tipo || "").toUpperCase();
      const label = safeText(doc?.label || doc?.title || comprobanteLabelFromTipo(tipo, `Comprobante ${index + 1}`));

      return {
        ...doc,
        id_comprobante: Number.isFinite(id) && id > 0 ? id : null,
        id_archivo: Number.isFinite(id) && id > 0 ? id : null,
        tipo,
        key: safeText(doc?.key || `${tipo || "comprobante"}_${id || index + 1}`).toLowerCase(),
        label,
        title: safeText(doc?.title || label),
        mime: safeText(doc?.mime || doc?.archivo_mime || row?.comprobante_mime || "application/pdf") || "application/pdf",
        fileName: safeText(doc?.fileName || doc?.filename || `${label.toLowerCase().replace(/\s+/g, "_")}.pdf`),
        rawUrl,
        cacheSalt: safeText(doc?.archivo_path || doc?.created_at || tipo || id || rawUrl),
      };
    })
    .filter((doc) => {
      if (!doc) return false;
      const key = doc.id_comprobante ? `id:${doc.id_comprobante}` : `url:${safeText(doc.rawUrl)}`;
      if (seenDocs.has(key)) return false;
      seenDocs.add(key);
      return true;
    });

  if (!docs.length) {
    const id = Number(row?.id_comprobante || 0);
    const rawUrl = safeText(row?.comprobante_url || "");
    if (id > 0 || rawUrl) {
      const tipo = safeText(row?.tipo_relacion || row?.comprobante_tipo || "COMPROBANTE").toUpperCase();
      const label = safeText(row?.comprobante || comprobanteLabelFromTipo(tipo, "Comprobante"));
      docs.push({
        id_comprobante: id > 0 ? id : null,
        id_archivo: id > 0 ? id : null,
        tipo,
        key: `${tipo.toLowerCase()}_${id || 1}`,
        label,
        title: label,
        mime: safeText(row?.comprobante_mime || "application/pdf") || "application/pdf",
        fileName: `${label.toLowerCase().replace(/\s+/g, "_")}.pdf`,
        rawUrl,
        cacheSalt: safeText(row?.archivo_path || tipo || id || rawUrl),
      });
    }
  }

  return docs.sort((a, b) => {
    const ra = comprobanteRank(a);
    const rb = comprobanteRank(b);
    if (ra !== rb) return ra - rb;
    return Number(a?.id_comprobante || 0) - Number(b?.id_comprobante || 0);
  });
}

export function canPreviewComprobante(row) {
  return normalizeCCComprobanteDocs(row).length > 0;
}

export function canDeleteCobro(row) {
  return Number(row?.id_cobro || 0) > 0;
}

export function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadBlob(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: formatDisplayDate(r.fecha || r.fecha_raw || ""),
    COMPROBANTE: safeText(r.comprobante || ""),
    DETALLE: safeText(r.detalle || ""),
    "DÉBITO (DEBE)": Number(r.debito || 0),
    "CRÉDITO (HABER)": Number(r.credito || 0),
    SALDO: Number(r.saldo || 0),
  }));
}

export function buildHistorialExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: formatDisplayDate(r.fecha || r.fecha_raw || ""),
    MOVIMIENTO: safeText(r.comprobante || ""),
    DETALLE: safeText(r.detalle || ""),
    TIPO: safeText(r.tipo_venta_nombre || r.tipo_venta || ""),
    ESTADO: safeText(r.estado_pago || ""),
    TOTAL: Number(r.monto_total ?? r.debito ?? 0),
    PAGADO: Number(r.total_pagado ?? r.credito ?? 0),
    SALDO: Number(r.saldo_movimiento ?? r.saldo ?? 0),
  }));
}

export function buildClientesExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    CLIENTE: safeText(r.nombre || "-"),
    "SALDO ACTUAL": Number(r.saldo || 0),
  }));
}

export function buildProveedoresExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    PROVEEDOR: safeText(r.nombre || "-"),
    "SALDO ACTUAL": Number(r.saldo || 0),
  }));
}

export function makeComprobanteAccessUrl(row, apiUrl) {
  const idComprobante = Number(row?.id_comprobante || 0);
  if (idComprobante > 0) {
    return `${apiUrl}?action=cc_comprobante_descargar&id_comprobante=${idComprobante}`;
  }
  return resolveFileUrl(row?.comprobante_url);
}
