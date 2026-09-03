import { jsPDF } from "jspdf";
import QRCode from "qrcode";

/* =========================================================
   Helpers
========================================================= */
function safeStr(v, fallback = "—") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function onlyDigits(v) {
  return String(v ?? "").replace(/\D+/g, "");
}

function formatMoney(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "—";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }

  if (/^\d{8}$/.test(s)) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }

  return s;
}

function cbteTipoLabel(cbteTipo) {
  const n = Number(cbteTipo || 0);
  if (n === 3) return "NOTA DE CRÉDITO A";
  if (n === 8) return "NOTA DE CRÉDITO B";
  if (n === 13) return "NOTA DE CRÉDITO C";
  return `NOTA DE CRÉDITO (${n || "S/T"})`;
}

function buildFileName(data) {
  const pto = String(data?.pto_vta ?? "0").padStart(4, "0");
  const nro = String(data?.cbte_nro ?? "0").padStart(8, "0");
  const tipo = String(data?.cbte_tipo ?? "NC").replace(/\s+/g, "_");
  return `nota_credito_${tipo}_${pto}_${nro}.pdf`;
}

function normalizeItems(items, totalFallback = 0) {
  if (Array.isArray(items) && items.length > 0) {
    return items.map((it, idx) => ({
      codigo: safeStr(it?.codigo ?? idx + 1, String(idx + 1)),
      descripcion: safeStr(it?.descripcion ?? it?.detalle ?? "Ítem"),
      cantidad: Number(it?.cantidad ?? 1) || 1,
      precio:
        Number(
          it?.precio_unitario ??
            it?.precio ??
            it?.ars ??
            it?.subtotal ??
            it?.total ??
            0
        ) || 0,
      subtotal: Number(it?.subtotal ?? it?.ars ?? it?.total ?? 0) || 0,
      iva_pct: Number(it?.iva_pct ?? 0) || 0,
      iva_monto: Number(it?.iva_monto ?? 0) || 0,
      total: Number(it?.total ?? it?.ars ?? it?.subtotal ?? 0) || 0,
    }));
  }

  return [
    {
      codigo: "1",
      descripcion: "Anulación del comprobante original",
      cantidad: 1,
      precio: Number(totalFallback || 0),
      subtotal: Number(totalFallback || 0),
      iva_pct: 0,
      iva_monto: 0,
      total: Number(totalFallback || 0),
    },
  ];
}

async function loadImageAsDataUrl(url) {
  const src = String(url || "").trim();
  if (!src) return null;

  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();

    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function buildQrImageDataUrl(qrUrl) {
  const value = String(qrUrl || "").trim();
  if (!value) return null;

  try {
    return await QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });
  } catch {
    return null;
  }
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================================================
   Main builder
========================================================= */
export async function buildNotaCreditoPdf(data = {}) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const margin = 8;
  const contentW = pageW - margin * 2;

  const primary = [152, 27, 62];
  const accent = [255, 245, 247];
  const dark = [45, 45, 45];
  const muted = [110, 110, 110];
  const border = [220, 220, 220];

  const emisor = {
    nombre: safeStr(data?.emisor_nombre, "EMISOR"),
    domicilio: safeStr(data?.emisor_domicilio, "—"),
    cuit: safeStr(data?.cuit_emisor, "—"),
    iva: safeStr(data?.cond_iva_emisor, "—"),
    iibb: safeStr(data?.ingresos_brutos_emisor, "—"),
    inicioAct: formatDate(data?.fecha_inicio_actividades_emisor),
    logoUrl: String(data?.logo_url || "").trim(),
  };

  const cliente = data?.cliente_facturacion || {};
  const receptor = {
    razonSocial: safeStr(cliente?.razon_social, data?.labelCliente || "CLIENTE"),
    docTipo: safeStr(cliente?.doc_tipo, "—"),
    docNro: safeStr(cliente?.doc_nro ?? cliente?.cuit, "—"),
    cuit: safeStr(cliente?.cuit ?? cliente?.doc_nro, "—"),
    iva: safeStr(cliente?.condicion_iva ?? cliente?.cond_iva, "—"),
    domicilio: safeStr(cliente?.domicilio, "—"),
  };

  const original = data?.factura_original || {};
  const items = normalizeItems(
    data?.items_facturacion,
    data?.total_ars ?? data?.monto ?? 0
  );

  const total =
    Number(data?.total_ars ?? data?.monto ?? data?.importe ?? 0) || 0;
  const subtotal = items.reduce(
    (acc, it) => acc + (Number(it.subtotal) || 0),
    0
  );
  const ivaTotal = items.reduce(
    (acc, it) => acc + (Number(it.iva_monto) || 0),
    0
  );

  const fileName = buildFileName(data);
  const esInterna = String(data?.modalidad || "").toUpperCase() === "INTERNA";
  const tipoLabel = esInterna ? "NOTA DE CRÉDITO INTERNA" : cbteTipoLabel(data?.cbte_tipo);

  const qrUrl = String(data?.qr_url || "").trim();
  const qrImageDataUrl = await buildQrImageDataUrl(qrUrl);
  const logoDataUrl = await loadImageAsDataUrl(emisor.logoUrl);

  let y = 0;

  /* =========================
     HEADER COMPACTO
  ========================= */
  doc.setFillColor(...primary);
  doc.rect(0, 0, pageW, 18, "F");

  doc.setFillColor(...accent);
  doc.roundedRect(margin, 6, contentW, 20, 2, 2, "F");

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", margin + 2, 8, 12, 12);
    } catch {}
  }

  doc.setTextColor(...primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(esInterna ? "NOTA DE CRÉDITO INTERNA" : "NOTA DE CRÉDITO ELECTRÓNICA", margin + 18, 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text(tipoLabel, margin + 18, 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...primary);
  doc.text("NC", pageW - 20, 12, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(...dark);
  doc.text(`Pto. Vta: ${safeStr(data?.pto_vta, "—")}`, pageW - 20, 17, {
    align: "center",
  });
  doc.text(`N°: ${safeStr(data?.cbte_nro, "—")}`, pageW - 20, 21, {
    align: "center",
  });

  y = 30;

  /* =========================
     EMISOR + DATOS FISCALES
  ========================= */
  const boxH1 = 26;
  doc.setDrawColor(...border);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, 116, boxH1, 2, 2, "FD");
  doc.roundedRect(margin + 118, y, contentW - 118, boxH1, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primary);
  doc.text("EMISOR", margin + 3, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);
  doc.setFontSize(7.5);
  doc.text(emisor.nombre, margin + 3, y + 9);
  doc.text(`CUIT: ${emisor.cuit}`, margin + 3, y + 13);
  doc.text(`IVA: ${emisor.iva}`, margin + 3, y + 17);
  doc.text(`IIBB: ${emisor.iibb}`, margin + 3, y + 21);
  doc.text(`Inicio act.: ${emisor.inicioAct}`, margin + 3, y + 25);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primary);
  doc.text("DATOS FISCALES", margin + 121, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);
  doc.text(
    `Fecha: ${formatDate(data?.fecha_cbte_iso ?? data?.fecha_cbte)}`,
    margin + 121,
    y + 9
  );
  doc.text(`CAE: ${safeStr(data?.cae, "—")}`, margin + 121, y + 13);
  doc.text(`Vto. CAE: ${formatDate(data?.cae_vto)}`, margin + 121, y + 17);
  doc.text(
    `Resultado: ${safeStr(data?.resultado, "—")}`,
    margin + 121,
    y + 21
  );
  doc.text("Moneda: PES", margin + 121, y + 25);

  y += boxH1 + 4;

  /* =========================
     RECEPTOR
  ========================= */
  const receptorPaddingX = 3;
  const receptorColGap = 6;
  const receptorAvailableW =
    contentW - receptorPaddingX * 2 - receptorColGap;
  const receptorLeftW = receptorAvailableW * 0.58;
  const receptorRightW = receptorAvailableW - receptorLeftW;
  const receptorLeftX = margin + receptorPaddingX;
  const receptorRightX = receptorLeftX + receptorLeftW + receptorColGap;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  const receptorLineH = doc.getLineHeight() / doc.internal.scaleFactor;
  const razonSocialLines = doc.splitTextToSize(
    `Razón social: ${receptor.razonSocial}`,
    receptorLeftW
  );
  const domicilioLines = doc.splitTextToSize(
    `Domicilio: ${safeStr(receptor.domicilio)}`,
    receptorRightW
  );

  const receptorTextY = y + 9;
  const receptorMetaY =
    receptorTextY + razonSocialLines.length * receptorLineH + 0.6;
  const receptorDomicilioY = receptorTextY + 4;
  const receptorLeftBottom = receptorMetaY + 4 + 3;
  const receptorRightBottom =
    receptorDomicilioY +
    Math.max(0, domicilioLines.length - 1) * receptorLineH +
    3;
  const receptorH = Math.max(
    22,
    receptorLeftBottom - y,
    receptorRightBottom - y
  );

  doc.setFillColor(...accent);
  doc.roundedRect(margin, y, contentW, receptorH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primary);
  doc.text("RECEPTOR", receptorLeftX, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);
  doc.setFontSize(7.5);
  doc.text(razonSocialLines, receptorLeftX, receptorTextY);
  doc.text(
    `Doc: ${receptor.docTipo} / ${receptor.docNro}`,
    receptorLeftX,
    receptorMetaY
  );
  doc.text(`CUIT: ${receptor.cuit}`, receptorLeftX, receptorMetaY + 4);
  doc.text(`IVA: ${receptor.iva}`, receptorRightX, receptorTextY);
  doc.text(domicilioLines, receptorRightX, receptorDomicilioY);

  y += receptorH + 4;

  /* =========================
     COMPROBANTE ORIGINAL
  ========================= */
  const asocH = 16;
  doc.setDrawColor(...border);
  doc.roundedRect(margin, y, contentW, asocH, 2, 2, "D");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primary);
  doc.text("COMPROBANTE ORIGINAL", margin + 3, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...dark);
  doc.text(`Tipo: ${safeStr(original?.cbte_tipo, "—")}`, margin + 3, y + 10);
  doc.text(`Pto. Vta: ${safeStr(original?.pto_vta, "—")}`, margin + 35, y + 10);
  doc.text(`Número: ${safeStr(original?.cbte_nro, "—")}`, margin + 62, y + 10);
  doc.text(`CAE: ${safeStr(original?.cae, "—")}`, margin + 110, y + 10);
  doc.text(`Fecha: ${formatDate(original?.fecha_cbte)}`, margin + 3, y + 14);

  y += asocH + 4;

  /* =========================
     MOTIVO
  ========================= */
  const motivoTxt = safeStr(
    data?.observaciones,
    "Anulación del comprobante original"
  );
  const motivoLines = doc.splitTextToSize(motivoTxt, contentW - 8).slice(0, 2);
  const motivoH = 14;

  doc.setFillColor(250, 250, 250);
  doc.roundedRect(margin, y, contentW, motivoH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primary);
  doc.setFontSize(8.5);
  doc.text("MOTIVO", margin + 3, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);
  doc.setFontSize(7.5);
  doc.text(motivoLines, margin + 3, y + 9);

  y += motivoH + 4;

  /* =========================
     TABLA ITEMS COMPACTA
  ========================= */
  const cols = {
    codigo: margin,
    descripcion: margin + 14,
    cantidad: margin + 112,
    precio: margin + 129,
    total: margin + 162,
  };

  doc.setFillColor(...primary);
  doc.rect(margin, y, contentW, 6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("CÓD.", cols.codigo + 2, y + 4.2);
  doc.text("DESCRIPCIÓN", cols.descripcion + 2, y + 4.2);
  doc.text("CANT.", cols.cantidad + 2, y + 4.2);
  doc.text("P. UNIT.", cols.precio + 2, y + 4.2);
  doc.text("TOTAL", cols.total + 2, y + 4.2);

  y += 6;

  doc.setTextColor(...dark);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);

  const visibleItems = items.slice(0, 6);

  visibleItems.forEach((it, idx) => {
    const rowH = 7;

    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y, contentW, rowH, "F");
    }

    doc.setDrawColor(...border);
    doc.rect(margin, y, contentW, rowH, "D");

    const desc = safeStr(it.descripcion, "").slice(0, 70);

    doc.text(safeStr(it.codigo, ""), cols.codigo + 2, y + 4.5);
    doc.text(desc, cols.descripcion + 2, y + 4.5);
    doc.text(String(it.cantidad), cols.cantidad + 2, y + 4.5);
    doc.text(formatMoney(it.precio), cols.precio + 2, y + 4.5);
    doc.text(formatMoney(it.total), cols.total + 2, y + 4.5);

    y += rowH;
  });

  y += 4;

  /* =========================
     TOTALES
  ========================= */
  const totalBoxW = 66;
  const totalBoxH = 19;
  const totalBoxX = pageW - margin - totalBoxW;

  doc.setDrawColor(...border);
  doc.roundedRect(totalBoxX, y, totalBoxW, totalBoxH, 2, 2, "D");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...dark);
  doc.text("Subtotal:", totalBoxX + 3, y + 5.5);
  doc.text(formatMoney(subtotal), totalBoxX + totalBoxW - 3, y + 5.5, {
    align: "right",
  });

  doc.text("IVA:", totalBoxX + 3, y + 10.5);
  doc.text(formatMoney(ivaTotal), totalBoxX + totalBoxW - 3, y + 10.5, {
    align: "right",
  });

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...primary);
  doc.text("TOTAL NC:", totalBoxX + 3, y + 15.8);
  doc.text(formatMoney(total), totalBoxX + totalBoxW - 3, y + 15.8, {
    align: "right",
  });

  y += totalBoxH + 4;

  /* =========================
     BLOQUE QR COMPACTO
  ========================= */
  const qrBlockH = 28;

  doc.setDrawColor(...border);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, contentW, qrBlockH, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...primary);
  doc.text("VALIDACIÓN QR ARCA", margin + 3, y + 5);

  if (qrImageDataUrl) {
    try {
      doc.addImage(qrImageDataUrl, "PNG", margin + 3, y + 7, 18, 18);
    } catch {}
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.3);
    doc.setTextColor(...muted);
    doc.text("No se pudo generar QR.", margin + 1, y + 14);
  }

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...dark);
  doc.setFontSize(7.3);
  doc.text(
    "Escaneá este código para validar el comprobante en ARCA.",
    margin + 35,
    y + 10
  );
  doc.text(`CAE: ${safeStr(data?.cae, "—")}`, margin + 35, y + 14);
  doc.text(
    `Comp.: ${safeStr(data?.pto_vta, "—")}-${safeStr(data?.cbte_nro, "—")}`,
    margin + 35,
    y + 18
  );
  doc.text(
    `Fecha: ${formatDate(data?.fecha_cbte_iso ?? data?.fecha_cbte)}`,
    margin + 35,
    y + 22
  );

  /* =========================
     FOOTER
  ========================= */
  doc.setDrawColor(...border);
  doc.line(margin, pageH - 14, pageW - margin, pageH - 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.setTextColor(...primary);
  doc.text(
    "Comprobante emitido electrónicamente por ARCA",
    margin,
    pageH - 9
  );

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...muted);
  doc.setFontSize(7);
  doc.text(
    `CAE: ${safeStr(data?.cae, "—")} | Vto: ${formatDate(
      data?.cae_vto
    )} | Resultado: ${safeStr(data?.resultado, "—")}`,
    margin,
    pageH - 5
  );

  const blob = doc.output("blob");

  return {
    doc,
    blob,
    fileName,
  };
}

export async function saveNotaCreditoPdf(data = {}, options = {}) {
  const { autoDownload = true } = options;
  const built = await buildNotaCreditoPdf(data);

  if (autoDownload) {
    triggerBlobDownload(built.blob, built.fileName);
  }

  return {
    pdfBlob: built.blob,
    pdfFilename: built.fileName,
  };
}
