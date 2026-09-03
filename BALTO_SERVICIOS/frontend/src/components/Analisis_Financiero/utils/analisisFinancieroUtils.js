import {
  faArrowDown,
  faChartLine,
  faMoneyBillTrendUp,
} from "@fortawesome/free-solid-svg-icons";

export function moneyARS(v) {
  if (v == null || v === "") return "—";
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function safeText(v) {
  return String(v ?? "").trim();
}

export function toNumberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

export function sanitizeFilePart(s) {
  return String(s ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

export function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function getMetricIcon(row) {
  const tipo = safeText(row?.tipo).toLowerCase();
  const id = safeText(row?.id).toLowerCase();
  const concepto = safeText(row?.concepto).toLowerCase();

  if (tipo === "ingreso" || id.includes("venta") || concepto.includes("venta")) {
    return faMoneyBillTrendUp;
  }

  if (tipo === "egreso" || concepto.includes("costo") || concepto.includes("egreso")) {
    return faArrowDown;
  }

  return faChartLine;
}

export function getMetricTone(row) {
  const tipo = safeText(row?.tipo).toLowerCase();
  const concepto = safeText(row?.concepto).toLowerCase();

  if (tipo === "ingreso" || concepto.includes("venta")) return "ingreso";
  if (tipo === "egreso" || concepto.includes("costo") || concepto.includes("egreso")) return "egreso";
  return "neutral";
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

export function isDisponibilidadRow(row) {
  const tipo = safeText(row?.tipo).toLowerCase();
  const id = safeText(row?.id).toLowerCase();
  const concepto = safeText(row?.concepto ?? row?.nombre).toLowerCase();

  return (
    tipo === "disponibilidad" ||
    tipo === "caja" ||
    tipo === "banco" ||
    tipo === "saldo" ||
    id.includes("caja") ||
    id.includes("banco") ||
    concepto.includes("caja") ||
    concepto.includes("banco") ||
    concepto.includes("efectivo")
  );
}

export function normalizeRows(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((r, idx) => ({
        id: safeText(r?.id ?? `${idx}`),
        concepto: safeText(r?.concepto ?? r?.nombre ?? r?.label ?? ""),
        importe: r?.importe == null ? null : Number(r.importe || 0),
        tipo: safeText(r?.tipo ?? ""),
      }))
      .filter((x) => x.concepto);
  }

  if (raw && typeof raw === "object") {
    const ventas = toNumberOrZero(raw?.ventas);
    const costoVar = toNumberOrZero(raw?.costo_variable ?? raw?.costoVariable);
    const costoFijo = toNumberOrZero(raw?.costo_fijo ?? raw?.costoFijo);
    const otrosEgresos = toNumberOrZero(raw?.otros_egresos ?? raw?.otrosEgresos);
    const resultadoNeto = ventas - costoVar - costoFijo - otrosEgresos;

    return [
      { id: "ventas", concepto: "VENTAS", importe: ventas, tipo: "ingreso" },
      { id: "costo_variable", concepto: "COSTO VARIABLE", importe: costoVar, tipo: "egreso" },
      { id: "costo_fijo", concepto: "COSTO FIJO", importe: costoFijo, tipo: "egreso" },
      { id: "otros_egresos", concepto: "OTROS EGRESOS", importe: otrosEgresos, tipo: "egreso" },
      { id: "resultado_neto", concepto: "RESULTADO NETO", importe: resultadoNeto, tipo: "resultado" },
    ];
  }

  return [];
}

export function findImporte(rows, keys) {
  if (!Array.isArray(rows)) return 0;

  for (const k of keys) {
    if (k.id) {
      const byId = rows.find((r) => safeText(r.id).toLowerCase() === String(k.id).toLowerCase());
      if (byId && byId.importe != null) return toNumberOrZero(byId.importe);
    }

    if (k.includes && k.includes.length) {
      const byConcept = rows.find((r) => {
        const c = safeText(r.concepto).toLowerCase();
        return k.includes.some((needle) => c.includes(needle));
      });
      if (byConcept && byConcept.importe != null) return toNumberOrZero(byConcept.importe);
    }
  }

  return 0;
}

export function computeDerivedRows(rows) {
  const base = Array.isArray(rows) ? [...rows] : [];

  const ventas = findImporte(base, [{ id: "ventas" }, { includes: ["ventas", "ingresos", "venta"] }]);
  const costoVar = findImporte(base, [{ id: "costo_variable" }, { includes: ["costo variable", "variable"] }]);
  const costoFijo = findImporte(base, [{ id: "costo_fijo" }, { includes: ["costo fijo", "fijo"] }]);
  const otrosEgresos = findImporte(base, [{ id: "otros_egresos" }, { includes: ["otros egresos", "egresos"] }]);
  const resultadoNeto = ventas - costoVar - costoFijo - otrosEgresos;

  const filtered = base.filter((r) => safeText(r.id).toLowerCase() !== "gastos_personales");

  const idxRes = filtered.findIndex((r) => {
    const id = safeText(r.id).toLowerCase();
    const c = safeText(r.concepto).toLowerCase();
    return id === "resultado_neto" || c === "resultado neto" || (c.includes("resultado") && c.includes("neto"));
  });

  const rowResultado = {
    id: "resultado_neto",
    concepto: "RESULTADO NETO",
    importe: resultadoNeto,
    tipo: "resultado",
  };

  if (idxRes >= 0) filtered[idxRes] = { ...filtered[idxRes], ...rowResultado };
  else filtered.push(rowResultado);

  const idxVentas = filtered.findIndex((r) => safeText(r.id).toLowerCase() === "ventas");
  if (idxVentas >= 0) {
    filtered[idxVentas] = {
      ...filtered[idxVentas],
      concepto: "VENTAS",
      tipo: "ingreso",
      importe: ventas,
    };
  }

  const markTipo = (id, tipo) => {
    const i = filtered.findIndex((r) => safeText(r.id).toLowerCase() === id);
    if (i >= 0) filtered[i] = { ...filtered[i], tipo };
  };

  markTipo("costo_variable", "egreso");
  markTipo("costo_fijo", "egreso");
  markTipo("otros_egresos", "egreso");

  return filtered;
}

export function normalizeDisponibilidades(raw, fallbackRows = []) {
  const mapItem = (r, idx) => {
    const importe = toNumberOrZero(r?.importe ?? r?.saldo ?? r?.monto ?? r?.total);
    return {
      id: safeText(r?.id ?? r?.id_caja ?? r?.idCaja ?? `${idx}`),
      nombre: safeText(
        r?.nombre ??
          r?.caja ??
          r?.label ??
          r?.concepto ??
          r?.descripcion ??
          `Caja ${idx + 1}`
      ),
      importe,
      tipo: safeText(r?.tipo ?? "disponibilidad"),
    };
  };

  if (Array.isArray(raw)) {
    return raw.map(mapItem).filter((x) => x.nombre);
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw)
      .map(([key, value], idx) => {
        if (value && typeof value === "object") {
          return {
            id: safeText(value?.id ?? key),
            nombre: safeText(value?.nombre ?? value?.caja ?? key),
            importe: toNumberOrZero(value?.importe ?? value?.saldo ?? value?.monto ?? value?.total),
            tipo: safeText(value?.tipo ?? "disponibilidad"),
          };
        }

        return {
          id: safeText(key),
          nombre: safeText(key),
          importe: toNumberOrZero(value),
          tipo: "disponibilidad",
        };
      })
      .filter((x) => x.nombre);
  }

  if (Array.isArray(fallbackRows)) {
    return fallbackRows
      .filter((r) => isDisponibilidadRow(r))
      .map((r, idx) => ({
        id: safeText(r.id ?? `${idx}`),
        nombre: safeText(r.concepto ?? r.nombre ?? `Caja ${idx + 1}`),
        importe: toNumberOrZero(r.importe),
        tipo: safeText(r.tipo ?? "disponibilidad"),
      }));
  }

  return [];
}
