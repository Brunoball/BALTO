export function clearMovimientosAfterDepositoCheque() {
  try {
    if (typeof window === "undefined") return;

    const storage = window.sessionStorage || null;
    const prefix = "balto_movimientos_perf_v2:";

    if (storage) {
      const scopesToClear = [
        ":otros_egresos:listar",
        ":movimientos:listar",
        ":flujo_caja",
        ":compras:listar",
        ":ventas:listar",
      ];
      const keys = [];

      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !key.startsWith(prefix)) continue;

        if (scopesToClear.some((scope) => key.includes(scope))) {
          keys.push(key);
        }
      }

      keys.forEach((key) => storage.removeItem(key));
    }

    window.dispatchEvent(
      new CustomEvent("balto:movimientos-mutados", {
        detail: {
          origen: "deposito_cheque_banco",
          modulos: ["otros_egresos", "movimientos", "flujo_caja"],
          ts: Date.now(),
        },
      })
    );
  } catch {
    // La limpieza de caché nunca debe bloquear el depósito.
  }
}

export function notifyReversionDeposito(tipo = "cheque") {
  try {
    if (typeof window === "undefined") return;

    const storage = window.sessionStorage || null;
    const prefix = "balto_movimientos_perf_v2:";
    if (storage) {
      const scopes = [":otros_egresos:listar", ":movimientos:listar", ":flujo_caja"];
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(prefix) && scopes.some((scope) => key.includes(scope))) {
          keys.push(key);
        }
      }
      keys.forEach((key) => storage.removeItem(key));
    }

    const esEcheq = String(tipo || "").toLowerCase() === "echeq";
    window.dispatchEvent(
      new CustomEvent("balto:movimientos-mutados", {
        detail: {
          origen: esEcheq
            ? "reversion_deposito_echeq_banco"
            : "reversion_deposito_cheque_banco",
          modulos: [
            "otros_egresos",
            "movimientos",
            "flujo_caja",
            esEcheq ? "echeqs" : "cheques",
          ],
          ts: Date.now(),
        },
      })
    );
  } catch {
    // La actualización visual nunca debe bloquear una reversión ya confirmada.
  }
}

export function usuarioActualEsAdmin() {
  try {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "null");
    const idRol = Number(
      usuario?.id_rol ??
        usuario?.idRol ??
        usuario?.idRolMaster ??
        usuario?.id_rol_master ??
        0
    );
    const rol = String(
      usuario?.tipo_rol ??
        usuario?.rol ??
        usuario?.nombre_rol ??
        usuario?.nombreRol ??
        ""
    )
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    return (
      idRol === 1 ||
      ["1", "admin", "administrator", "administrador", "superadmin", "super_admin"].includes(rol)
    );
  } catch {
    return false;
  }
}

export function formatFecha(fecha) {
  const s = String(fecha || "").trim();
  if (!s) return "—";

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function moneyARS(valor) {
  const n = Number(valor || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function formatMoneyARS(valor) {
  const n = Number(valor || 0);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function safeText(value) {
  const s = String(value ?? "").trim();
  return s !== "" ? s : "—";
}

export function normalizeCheque(row) {
  return {
    ...row,
    id_cheque: Number(row?.id_cheque ?? row?.idCheque ?? row?.id ?? 0),
    fecha_emision: row?.fecha_emision ?? row?.fechaEmision ?? "",
    emisor: row?.emisor ?? row?.librador ?? "",
    numero_cheque: row?.numero_cheque ?? row?.numeroCheque ?? row?.numero ?? "",
    importe: row?.importe ?? 0,
    fecha_pago: row?.fecha_pago ?? row?.fechaPago ?? "",
    archivo_mime: row?.archivo_mime ?? row?.mime ?? "application/pdf",
    tiene_comprobante:
      row?.tiene_comprobante ?? row?.tieneComprobante ?? !!row?.archivo_path,
  };
}

export const normalizeEcheq = normalizeCheque;

export function toISODate(fecha) {
  const s = String(fecha || "").trim();
  if (!s) return "";

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${String(iso[1]).padStart(4, "0")}-${String(iso[2]).padStart(2, "0")}-${String(iso[3]).padStart(2, "0")}`;
  }

  const visual = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (visual) {
    return `${String(visual[3]).padStart(4, "0")}-${String(visual[2]).padStart(2, "0")}-${String(visual[1]).padStart(2, "0")}`;
  }

  return "";
}

export function todayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidISODate(fecha) {
  const s = String(fecha || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function boolish(value, fallback = false) {
  if (value === null || typeof value === "undefined") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const s = String(value).trim().toLowerCase();
  if (["1", "true", "sí", "si", "yes"].includes(s)) return true;
  if (["0", "false", "no", ""].includes(s)) return false;
  return fallback;
}

export function inferMime(path) {
  const p = String(path || "").trim().toLowerCase();
  if (!p) return "";

  if (p.includes(".png")) return "image/png";
  if (p.includes(".jpg") || p.includes(".jpeg")) return "image/jpeg";
  if (p.includes(".webp")) return "image/webp";
  if (p.includes(".gif")) return "image/gif";
  if (p.includes(".bmp")) return "image/bmp";
  if (p.includes(".svg")) return "image/svg+xml";
  if (p.includes(".pdf")) return "application/pdf";
  return "";
}

export function getArchivoRef(row) {
  return (
    row?.archivo_path ??
    row?.archivoPath ??
    row?.archivo_url ??
    row?.archivoUrl ??
    row?.comprobante_url ??
    row?.comprobanteUrl ??
    row?.url ??
    ""
  );
}

export const EVENTO_CANONICO = {
  INGRESO_CARTERA: "INGRESO_CARTERA",
  DEPOSITADO_BANCO: "DEPOSITADO_BANCO",
  EGRESO_CARTERA: "EGRESO_CARTERA",
};

const EVENTO_ALIAS = {
  INGRESO_CARTERA: EVENTO_CANONICO.INGRESO_CARTERA,
  INGRESO: EVENTO_CANONICO.INGRESO_CARTERA,
  NUEVO: EVENTO_CANONICO.INGRESO_CARTERA,
  ALTA: EVENTO_CANONICO.INGRESO_CARTERA,
  DEPOSITADO_BANCO: EVENTO_CANONICO.DEPOSITADO_BANCO,
  DEPOSITO_BANCO: EVENTO_CANONICO.DEPOSITADO_BANCO,
  DEPOSITO: EVENTO_CANONICO.DEPOSITADO_BANCO,
  DEPOSITADO: EVENTO_CANONICO.DEPOSITADO_BANCO,
  EGRESO_CARTERA: EVENTO_CANONICO.EGRESO_CARTERA,
  EGRESO: EVENTO_CANONICO.EGRESO_CARTERA,
  BAJA: EVENTO_CANONICO.EGRESO_CARTERA,
  PAGO: EVENTO_CANONICO.EGRESO_CARTERA,
  USADO_COMO_PAGO: EVENTO_CANONICO.EGRESO_CARTERA,
  ANULACION: EVENTO_CANONICO.EGRESO_CARTERA,
};

export function normalizarEvento(evento) {
  const key = String(evento || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  return EVENTO_ALIAS[key] || key;
}

export function humanizarEventoDesconocido(evento) {
  const texto = safeText(evento).replace(/_/g, " ").toLowerCase();
  return texto.replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function normalizeFlujoBase(row, defaultTipoCheque = "") {
  const idCheque = Number(row?.id_cheque ?? row?.idCheque ?? 0);
  const rawTieneComp =
    row?.tiene_comprobante ??
    row?.tieneComprobante ??
    row?.has_comprobante ??
    row?.hasComprobante ??
    row?.id_comprobante ??
    row?.idComprobante;
  const archivoRef = getArchivoRef(row);
  const archivoMime =
    inferMime(archivoRef) ||
    String(row?.archivo_mime ?? row?.mime ?? "").trim() ||
    "application/pdf";

  return {
    ...row,
    id_flujo: Number(row?.id_flujo ?? row?.idFlujo ?? row?.id ?? 0),
    id_cheque: idCheque,
    tipo_cheque: String(row?.tipo_cheque ?? row?.tipoCheque ?? defaultTipoCheque)
      .trim()
      .toLowerCase(),
    numero_cheque: row?.numero_cheque ?? row?.numeroCheque ?? "",
    emisor: row?.emisor ?? "",
    importe: row?.importe ?? 0,
    evento: normalizarEvento(row?.evento ?? ""),
    descripcion: row?.descripcion ?? "",
    fecha_evento: row?.fecha_evento ?? row?.fechaEvento ?? "",
    fecha_emision: row?.fecha_emision ?? row?.fechaEmision ?? "",
    fecha_pago: row?.fecha_pago ?? row?.fechaPago ?? "",
    id_comprobante: Number(row?.id_comprobante ?? row?.idComprobante ?? 0),
    archivo_path: row?.archivo_path ?? row?.archivoPath ?? "",
    archivo_url: row?.archivo_url ?? row?.archivoUrl ?? "",
    archivo_mime: archivoMime,
    tiene_comprobante: boolish(rawTieneComp, idCheque > 0),
  };
}

export function normalizeFlujo(row) {
  return normalizeFlujoBase(row, "");
}

export function normalizeFlujoEcheq(row) {
  return normalizeFlujoBase(row, "echeq");
}
