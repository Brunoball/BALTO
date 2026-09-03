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
  window.URL.revokeObjectURL(url);
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
