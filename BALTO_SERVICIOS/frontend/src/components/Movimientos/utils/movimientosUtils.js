import { getDetalleMovimiento, getResumenItemsMovimiento } from "../../Mov_Subsection/_shared/detalleMovimiento.js";

export function formatDateISO(d) {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDateLabel(d) {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}/${d.getFullYear()}`;
}

/* =========================
   Helpers
========================= */
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
  return s ? s : "-";
}

export function clearMovimientosSessionCache() {
  try {
    if (typeof window === "undefined") return;
    const storage = window.sessionStorage || null;
    if (!storage) return;

    const prefix = "balto_movimientos_perf_v2:";
    const scopesToClear = [
      ":movimientos:listar",
      ":otros_egresos:listar",
      ":otros_ingresos:listar",
      ":flujo_caja",
    ];
    const keys = [];

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      if (scopesToClear.some((scope) => key.includes(scope))) keys.push(key);
    }

    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // La limpieza de caché nunca debe romper la vista de movimientos.
  }
}

export function normalizeComparableText(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}


export function normalizeFlag(v) {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "yes"].includes(s);
}

export function getDepositoChequeLabel(row) {
  if (!row || typeof row !== "object") return "";

  // No alcanza con que un egreso tenga cheque/eCheq como medio de pago.
  // Solo se considera depósito bancario cuando el backend lo marca explícitamente
  // con es_deposito_cheque, igual que en Otros Egresos.
  const esDepositoCheque =
    normalizeFlag(row?.es_deposito_cheque) || normalizeFlag(row?.esDepositoCheque);

  if (!esDepositoCheque) return "";

  const tipoCheque = String(
    row?.cheque_tipo ??
      row?.cheque?.tipo ??
      row?.medio_pago_nombre ??
      row?.medio_pago ??
      ""
  )
    .toUpperCase()
    .replace(/[-_]/g, " ")
    .trim();

  return tipoCheque.includes("ECHEQ") || tipoCheque.includes("E CHEQ")
    ? "ECHEQ DEPOSITADO"
    : "CHEQUE DEPOSITADO";
}

export function withDepositoChequeDetalle(row) {
  const label = getDepositoChequeLabel(row);
  if (!label) return row;

  const total =
    Number(
      row?.cheque_importe ??
        row?.cheque?.importe ??
        row?.monto_total ??
        row?.total ??
        row?.total_general ??
        0
    ) || 0;

  const tipoCheque = String(row?.cheque_tipo ?? row?.cheque?.tipo ?? row?.medio_pago_nombre ?? "CHEQUE")
    .toUpperCase()
    .trim();

  const itemCheque = {
    id_item: null,
    id_movimiento: row?.id_movimiento ?? null,
    id_detalle: null,
    id_stock_producto: null,
    producto_nombre: label,
    stock_producto_nombre: label,
    detalle_nombre: label,
    detalle: label,
    descripcion: label,
    cantidad: 1,
    precio: total,
    iva_pct: 0,
    subtotal: total,
    iva_monto: 0,
    total,
  };

  const chequeTipoValor = String(row?.cheque_tipo ?? row?.cheque?.tipo ?? tipoCheque ?? "cheque").toLowerCase();

  const medioCheque = {
    id_movimiento_medio_pago: 0,
    id_movimiento: row?.id_movimiento ?? null,
    id_medio_pago: row?.id_medio_pago ?? null,
    medio_pago_nombre: tipoCheque || "CHEQUE",
    medio_pago: tipoCheque || "CHEQUE",
    nombre: tipoCheque || "CHEQUE",
    monto: total,
    id_cheque: row?.cheque_id ?? row?.cheque?.id_cheque ?? null,
    cheque_tipo: chequeTipoValor,
    tipo_cheque: chequeTipoValor,
    numero_cheque: row?.cheque_numero ?? row?.cheque?.numero_cheque ?? "",
    emisor: row?.cheque_emisor ?? row?.cheque?.emisor ?? "",
    fecha_emision: row?.cheque_fecha_emision ?? row?.cheque?.fecha_emision ?? "",
    fecha_pago: row?.cheque_fecha_pago ?? row?.cheque?.fecha_pago ?? "",
    cheque_importe: total,
  };

  return {
    ...row,
    detalle: label,
    descripcion: label,
    concepto: label,
    cantidad_items: 1,
    items: [itemCheque],
    items_detalle: [itemCheque],
    cantidad_medios_pago: 1,
    medios_pago_detalle: [medioCheque],
  };
}

export function isOtrosMovimiento(row) {
  const idTipo = Number(row?.id_tipo_operacion ?? row?.id_tipo_movimiento ?? 0);
  if (idTipo === 3 || idTipo === 4) return true;

  const op = normalizeComparableText(row?.operacion ?? row?.tipo_operacion ?? "");
  return op.includes("OTROS INGRESOS") || op.includes("OTROS EGRESOS");
}

export function clienteProveedorLabel(row) {
  if (isOtrosMovimiento(row)) return "-";

  const cliente = safeText(pick(row, ["cliente", "nombre_cliente", "razon_social_cliente"], ""));
  if (cliente !== "-") return cliente;

  return safeText(pick(row, ["proveedor", "nombre_proveedor", "razon_social_proveedor"], ""));
}

export function cleanInfoText(v) {
  const s = String(v ?? "").trim();
  return s && s !== "-" && s !== "—" ? s : "";
}

export function isCuentaCorrienteMovimiento(row) {
  const idTipoVenta = Number(row?.id_tipo_venta ?? row?.idTipoVenta ?? 0);
  if (idTipoVenta === 2) return true;

  const tipoVenta = normalizeComparableText(
    row?.tipo_venta ??
      row?.pago_tipo_venta ??
      row?.tipo_venta_nombre ??
      row?.forma_pago ??
      ""
  );

  return tipoVenta.includes("CUENTA CORRIENTE");
}

export function getMovimientoTipoLabel(row) {
  const fromBackend =
    cleanInfoText(row?.tipo_movimiento_general) ||
    cleanInfoText(row?.tipo_general) ||
    cleanInfoText(row?.tipo_visual) ||
    cleanInfoText(row?.tipo_label);

  if (fromBackend) return fromBackend.toUpperCase();

  const idTipo = Number(row?.id_tipo_operacion ?? row?.id_tipo_movimiento ?? 0);
  if (idTipo === 1) return isCuentaCorrienteMovimiento(row) ? "RECIBO" : "VENTA";
  if (idTipo === 2) return isCuentaCorrienteMovimiento(row) ? "ORDEN DE PAGO" : "COMPRA";
  if (idTipo === 3) return "OTROS INGRESOS";
  if (idTipo === 4) return "OTROS EGRESOS";
  if (idTipo === 5) return "PRESUPUESTO";

  const raw =
    cleanInfoText(row?.operacion) ||
    cleanInfoText(row?.tipo_operacion) ||
    cleanInfoText(row?.tipo_operacion_nombre) ||
    cleanInfoText(row?.tipo_movimiento);

  return raw ? raw.toUpperCase() : "MOVIMIENTO";
}

export function getMovimientoOperacionLabel(row) {
  return getMovimientoTipoLabel(row);
}

export function getTerceroInfoValue(row) {
  return (
    cleanInfoText(row?.proveedor) ||
    cleanInfoText(row?.nombre_proveedor) ||
    cleanInfoText(row?.razon_social_proveedor) ||
    cleanInfoText(row?.cliente) ||
    cleanInfoText(row?.nombre_cliente) ||
    cleanInfoText(row?.razon_social_cliente) ||
    cleanInfoText(row?.tercero) ||
    cleanInfoText(row?.emisor) ||
    cleanInfoText(row?.cheque_emisor) ||
    cleanInfoText(row?.cheque?.emisor)
  );
}

export function normalizeRowForInfoModal(row) {
  if (!row) return row;

  const next = withDepositoChequeDetalle({ ...row });
  const operacion = getMovimientoOperacionLabel(next);
  const operacionNorm = normalizeComparableText(operacion);

  // El modal global usa estas claves para la caja "Tipo".
  // Si el movimiento no tiene tipo de venta (otros ingresos/egresos, presupuesto,
  // depósito de cheque, etc.), le pasamos la operación real para que no quede "—".
  next.tipo_operacion = cleanInfoText(next.tipo_operacion) || operacion;
  next.tipo_operacion_nombre = cleanInfoText(next.tipo_operacion_nombre) || operacion;
  next.tipo_movimiento = cleanInfoText(next.tipo_movimiento) || operacion;
  next.pago_tipo_venta = cleanInfoText(next.pago_tipo_venta) || cleanInfoText(next.tipo_venta) || operacion;

  const terceroActual = getTerceroInfoValue(next);
  if (!terceroActual) {
    if (operacionNorm.includes("PRESUPUESTO")) {
      next.cliente = "Sin cliente informado";
    } else if (operacionNorm.includes("VENTA") || operacionNorm.includes("RECIBO")) {
      next.cliente = "Consumidor final / sin cliente";
    } else if (operacionNorm.includes("COMPRA") || operacionNorm.includes("ORDEN DE PAGO")) {
      next.proveedor = "Proveedor no informado";
    } else if (operacionNorm.includes("OTROS INGRESOS") || operacionNorm.includes("OTROS EGRESOS")) {
      next.tercero = "No aplica";
    } else {
      next.tercero = "No informado";
    }
  } else if (!cleanInfoText(next.tercero) && !cleanInfoText(next.cliente) && !cleanInfoText(next.proveedor)) {
    next.tercero = terceroActual;
  }

  return next;
}

export function detallesLabel(row) {
  const depositoLabel = getDepositoChequeLabel(row);
  if (depositoLabel) return depositoLabel;
  return getResumenItemsMovimiento(row);
}

export function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function pick(obj, keys, fallback = "") {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") return v;
  }
  return fallback;
}

export function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";

  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) {
    return `${String(Number(m1[3])).padStart(2, "0")}/${String(Number(m1[2])).padStart(
      2,
      "0"
    )}/${m1[1]}`;
  }

  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    return `${String(Number(m2[1])).padStart(2, "0")}/${String(Number(m2[2])).padStart(
      2,
      "0"
    )}/${m2[3]}`;
  }

  return s;
}

export function dateOnlyScore(v) {
  const s = String(v ?? "").trim();
  if (!s) return 0;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function dateTimeScore(v) {
  const s = String(v ?? "").trim();
  if (!s) return 0;

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    return Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
  }

  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function sortMovimientosRecientes(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const fechaB = dateOnlyScore(pick(b, ["fecha", "fecha_movimiento", "created_at"], ""));
    const fechaA = dateOnlyScore(pick(a, ["fecha", "fecha_movimiento", "created_at"], ""));
    if (fechaB !== fechaA) return fechaB - fechaA;

    const createdB = dateTimeScore(pick(b, ["sort_updated", "fecha_accion", "orden_fecha", "updated_at", "created_at", "fecha_creacion", "createdAt"], ""));
    const createdA = dateTimeScore(pick(a, ["sort_updated", "fecha_accion", "orden_fecha", "updated_at", "created_at", "fecha_creacion", "createdAt"], ""));
    if (createdB !== createdA) return createdB - createdA;

    const idB = Number(b?.id_movimiento ?? b?.id ?? 0);
    const idA = Number(a?.id_movimiento ?? a?.id ?? 0);
    return idB - idA;
  });
}

/* =========================
   Export helpers
========================= */
export function slugifySheetName(name) {
  const s = String(name || "Movimientos")
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (s || "Movimientos").slice(0, 31);
}

export function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const total = pick(r, ["monto_total", "total", "importe_total", "monto", "importe"], 0);
    const pagado = pick(r, ["total_pagado", "pagado_total", "cobrado_total"], 0);
    const saldo = pick(r, ["saldo_pendiente", "saldo"], Math.max(0, numOrZero(total) - numOrZero(pagado)));
    const detalleCompleto = getDetalleMovimiento(r);
    return {
      ID: pick(r, ["id_movimiento", "id"], ""),
      FECHA: safeText(formatFechaDMY(pick(r, ["fecha", "fecha_movimiento", "created_at"], ""))),
      TIPO: getMovimientoTipoLabel(r),
      DETALLE: safeText(detalleCompleto),
      "CLIENTE/PROVEEDOR": clienteProveedorLabel(r),
      CATEGORIA: safeText(pick(r, ["clasificacion_nombre", "categoria"], "")),
      "TIPO DE PAGO": safeText(pick(r, ["tipo_venta", "pago_tipo_venta"], "")),
      TOTAL: numOrZero(total),
      PAGADO: numOrZero(pagado),
      SALDO: numOrZero(saldo),
      ESTADO: safeText(pick(r, ["estado_pago", "estado"], "")),
      "FACTURA ARCA": normalizeFlag(r?.factura_emitida_en_arca) ? "SI" : "NO",
      "NOTAS DE CREDITO": Number(r?.nota_credito_cantidad || 0),
    };
  });
}

function movementIdForExport(row) {
  return pick(row, ["id_movimiento", "id"], "");
}

function arrayFromRow(row, keys) {
  for (const key of keys) {
    if (Array.isArray(row?.[key])) return row[key];
  }
  return [];
}

export function buildExportItemRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const base = {
      MOVIMIENTO_ID: movementIdForExport(row),
      FECHA: safeText(formatFechaDMY(pick(row, ["fecha", "fecha_movimiento", "created_at"], ""))),
      TIPO_MOVIMIENTO: getMovimientoTipoLabel(row),
      "CLIENTE/PROVEEDOR": clienteProveedorLabel(row),
    };

    const items = arrayFromRow(row, ["items_detalle", "items", "productos"]);
    items.forEach((item, index) => {
      const tipoDb = safeText(pick(item, ["tipo_item_db", "tipo_item", "tipo"], "DETALLE"));
      if (String(tipoDb).toUpperCase() === "CONSUMO_ARTICULO") return;
      const nombre = pick(item, [
        "nombre", "descripcion", "detalle", "servicio_nombre", "articulo_nombre",
        "stock_producto_nombre", "producto_nombre", "detalle_nombre", "concepto"
      ], "Item");
      out.push({
        ...base,
        RENGLON: index + 1,
        TIPO_ITEM: tipoDb,
        ITEM: safeText(nombre),
        SKU: safeText(pick(item, ["sku", "codigo", "stock_variante_sku"], "")),
        CANTIDAD: numOrZero(item?.cantidad),
        PRECIO_UNITARIO: numOrZero(pick(item, ["precio", "precio_unitario"], 0)),
        SUBTOTAL: numOrZero(item?.subtotal),
        IVA_PCT: numOrZero(item?.iva_pct),
        IVA_MONTO: numOrZero(item?.iva_monto),
        TOTAL: numOrZero(item?.total),
      });
    });
  });
  return out;
}

export function buildExportPaymentRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const medios = arrayFromRow(row, ["medios_pago_detalle", "medios_pago"]);
    medios.forEach((medio, index) => {
      out.push({
        MOVIMIENTO_ID: movementIdForExport(row),
        FECHA: safeText(formatFechaDMY(pick(row, ["fecha", "fecha_movimiento", "created_at"], ""))),
        TIPO_MOVIMIENTO: getMovimientoTipoLabel(row),
        RENGLON: index + 1,
        MEDIO_PAGO: safeText(pick(medio, ["medio_pago_nombre", "medio_pago", "nombre"], "")),
        MONTO: numOrZero(pick(medio, ["monto_aplicado", "monto"], 0)),
        CHEQUE_TIPO: safeText(pick(medio, ["cheque_tipo", "tipo_cheque"], "")),
        CHEQUE_NUMERO: safeText(pick(medio, ["numero_cheque", "cheque_numero"], "")),
        CHEQUE_EMISOR: safeText(pick(medio, ["cheque_emisor", "emisor"], "")),
        CHEQUE_FECHA_EMISION: safeText(formatFechaDMY(pick(medio, ["cheque_fecha_emision", "fecha_emision"], ""))),
        CHEQUE_FECHA_PAGO: safeText(formatFechaDMY(pick(medio, ["cheque_fecha_pago", "fecha_pago"], ""))),
      });
    });
  });
  return out;
}

export function buildExportComprobanteRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const docs = arrayFromRow(row, ["comprobantes_detalle", "comprobantes"]);
    docs.forEach((doc, index) => {
      out.push({
        MOVIMIENTO_ID: movementIdForExport(row),
        FECHA: safeText(formatFechaDMY(pick(row, ["fecha", "created_at"], ""))),
        TIPO_MOVIMIENTO: getMovimientoTipoLabel(row),
        RENGLON: index + 1,
        COMPROBANTE: safeText(pick(doc, ["label", "tipo", "key"], "")),
        ARCHIVO_ID: pick(doc, ["id_archivo", "id_comprobante"], ""),
        EMITIDO_ARCA: normalizeFlag(doc?.emitido_en_arca) ? "SI" : "NO",
        CAE: safeText(doc?.cae),
        PUNTO_VENTA: safeText(pick(doc, ["pto_vta", "punto_venta"], "")),
        NUMERO: safeText(pick(doc, ["cbte_nro", "numero"], "")),
      });
    });
  });
  return out;
}

export function buildExportNotaCreditoRows(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const notas = arrayFromRow(row, ["notas_credito_detalle", "notas_credito"]);
    notas.forEach((nota, index) => {
      out.push({
        MOVIMIENTO_ID: movementIdForExport(row),
        FECHA_MOVIMIENTO: safeText(formatFechaDMY(pick(row, ["fecha", "created_at"], ""))),
        TIPO_MOVIMIENTO: getMovimientoTipoLabel(row),
        RENGLON: index + 1,
        NOTA_CREDITO_ID: pick(nota, ["id_nota_credito", "id_movimiento_nc"], ""),
        FECHA_NOTA: safeText(formatFechaDMY(pick(nota, ["fecha", "created_at"], ""))),
        MODALIDAD: safeText(nota?.modalidad),
        MOTIVO: safeText(nota?.motivo),
        OBSERVACIONES: safeText(nota?.observaciones),
        TOTAL: numOrZero(pick(nota, ["total_nota", "total"], 0)),
        EMITIDA_ARCA: normalizeFlag(nota?.emitida_arca) ? "SI" : "NO",
        CAE: safeText(pick(nota, ["comprobante_cae", "cae"], "")),
      });
    });
  });
  return out;
}

export function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
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


