export function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

export function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "—";
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return `${String(Number(m1[3])).padStart(2, "0")}/${String(Number(m1[2])).padStart(2, "0")}/${m1[1]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${String(Number(m2[1])).padStart(2, "0")}/${String(Number(m2[2])).padStart(2, "0")}/${m2[3]}`;
  return s;
}

export function startOfDay(d) {
  if (!d) return null;
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export function parseRowFecha(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) return startOfDay(new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])));
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return startOfDay(new Date(Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : startOfDay(d);
}

export function dateToAPI(d) {
  if (!d) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateUI(d) {
  if (!d) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function slugifySheetName(name) {
  const s = String(name || "Compras")
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (s || "Compras").slice(0, 31);
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
