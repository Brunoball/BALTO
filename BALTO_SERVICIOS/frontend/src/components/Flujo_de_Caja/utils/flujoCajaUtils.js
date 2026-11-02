export function moneyARS(v) {
  if (v == null || v === "") return "—";
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function moneyARSAbs(v) {
  if (v == null || v === "") return "—";
  const n = Math.abs(Number(v || 0));
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function fmtDateES(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

export function formatDateISO(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateUI(d) {
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function normalizePaymentCards(rawCards) {
  const cards = Array.isArray(rawCards) ? rawCards : [];

  return cards.map((card) => ({
    key: String(card?.key ?? card?.label ?? ""),
    label: String(card?.label ?? "MEDIO DE PAGO"),
    ingresos: Number(card?.ingresos || 0),
    egresos: Number(card?.egresos || 0),
    ajustes: Number(card?.ajustes || 0),
    saldo: Number(card?.saldo || 0),
    medios: Array.isArray(card?.medios)
      ? card.medios.map((m) => ({
          id_medio_pago: Number(m?.id_medio_pago || 0),
          nombre: String(m?.nombre ?? ""),
        }))
      : [],
  }));
}

export function normalizeRows(rawRows) {
  const rr = Array.isArray(rawRows) ? rawRows : [];
  return rr.map((r) => ({
    fecha: String(r?.fecha ?? ""),
    ingresos: r?.ingresos == null ? null : Number(r.ingresos || 0),
    egresos: r?.egresos == null ? null : Number(r.egresos || 0),
    saldo: r?.saldo == null ? null : Number(r.saldo || 0),
    saldo_inicial_aplicado: Number(r?.saldo_inicial_aplicado || 0),
    ajustes_internos: Number(r?.ajustes_internos || 0),
    ajustes_manuales: Number(r?.ajustes_manuales || 0),
    medios_pago: normalizePaymentCards(r?.medios_pago),
  }));
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
  // La descarga de un blob se inicia de forma asíncrona en Chromium.
  // Liberar la URL inmediatamente puede invalidarla antes de que el navegador
  // procese el clic, especialmente con archivos grandes o bajo carga E2E.
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}

export function paymentCardSubtitle(card) {
  const medios = Array.isArray(card?.medios) ? card.medios : [];
  const names = medios.map((m) => String(m?.nombre || "").trim()).filter(Boolean);

  if (!names.length) return "Sin medios vinculados";
  if (names.length === 1) return names[0];
  return names.join(" + ");
}

export function pickDefaultSelectedDate(items) {
  if (!items.length) return "";

  const todayIso = formatDateISO(new Date());
  const todayRow = items.find((r) => r.fecha === todayIso);
  if (todayRow) return todayRow.fecha;

  const latestNotFuture = items.find((r) => r.fecha && r.fecha <= todayIso);
  if (latestNotFuture) return latestNotFuture.fecha;

  return items[0]?.fecha || "";
}

/* =========================================================
   Ajustes de saldos
========================================================= */

/** Importe firmado: "+ $ 1.000,00" / "− $ 1.000,00" / "$ 0,00". */
export function moneyARSSigned(v) {
  if (v == null || v === "") return "—";
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.005) return moneyARSAbs(0);
  return `${n > 0 ? "+" : "−"} ${moneyARSAbs(n)}`;
}

/**
 * Interpreta lo que tipea el usuario en formato argentino ("145.000,50",
 * "145000,5", "145000.50"). Devuelve null si no es un importe válido.
 */
export function parseMoneyInput(value) {
  let s = String(value ?? "").trim().replace(/\$/g, "").replace(/\s+/g, "");
  if (!s) return null;
  if (!/^[0-9.,]+$/.test(s) || !/[0-9]/.test(s)) return null;

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  let normalized = s;

  if (commas > 1) return null;
  if (commas === 1) {
    const [intPart, decPart = ""] = s.split(",");
    if (decPart.length > 2 || !/^\d*$/.test(decPart)) return null;
    if (dots > 0 && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null;
    if (dots === 0 && !/^\d+$/.test(intPart)) return null;
    normalized = `${intPart.replace(/\./g, "") || "0"}${decPart ? `.${decPart}` : ""}`;
  } else if (dots > 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, "");
    else if (dots === 1 && /^\d+\.\d{1,2}$/.test(s)) normalized = s;
    else return null;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n) || n > 999999999999.99) return null;
  return Math.round(n * 100) / 100;
}

/** Texto exacto con 2 decimales para enviar al backend (sin floats ambiguos). */
export function toApiAmount(n) {
  return (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}

/**
 * Vista previa local inmediata. El backend vuelve a calcular todo antes de
 * confirmar; esto sólo da respuesta visual instantánea.
 */
export function computeAjustePreview(saldoActual, tipo, importe) {
  const saldoCents = Math.round(Number(saldoActual || 0) * 100);
  if (importe == null) return null;
  const importeCents = Math.round(Number(importe) * 100);
  let diferencia = 0;
  if (tipo === "ESTABLECER") diferencia = importeCents - saldoCents;
  else if (tipo === "SUMAR") diferencia = importeCents;
  else if (tipo === "RESTAR") diferencia = -importeCents;
  return {
    saldoActual: saldoCents / 100,
    diferencia: diferencia / 100,
    saldoNuevo: (saldoCents + diferencia) / 100,
  };
}
