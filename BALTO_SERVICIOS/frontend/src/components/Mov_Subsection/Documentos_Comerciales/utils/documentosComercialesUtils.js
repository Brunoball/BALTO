export function safeText(value, fallback = "—") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

export function moneyARS(value) {
  const n = Number(value || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatFecha(value) {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (!m) return s;

  const fecha = `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  if (!m[4] || !m[5]) return fecha;
  return `${fecha} ${String(Number(m[4])).padStart(2, "0")}:${String(Number(m[5])).padStart(2, "0")}`;
}

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isDocumentosNetworkError(err) {
  if (err?.isNetworkError === true) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    err?.name === "NetworkError" ||
    err?.name === "TimeoutError" ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("abort") ||
    msg.includes("sin conexión") ||
    msg.includes("sin conexion") ||
    msg.includes("no se pudo conectar") ||
    msg.includes("tardó demasiado") ||
    msg.includes("tardo demasiado")
  );
}
