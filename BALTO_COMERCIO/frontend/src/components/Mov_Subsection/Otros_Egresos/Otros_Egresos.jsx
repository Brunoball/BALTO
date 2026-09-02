import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { otrosEgresosFetch, getOtrosEgresosAuthInfo } from "./api/otrosEgresosApi.js";
import useOtrosEgresosToast from "./hooks/useOtrosEgresosToast.js";
import { moneyARS, safeText, normalizeFlag, normalizeSearchText, formatFechaDMY, startOfDay, parseRowFecha, dateToAPI, formatDateUI } from "./utils/otrosEgresosUtils.js";
import BASE_URL from "../../../config/config.jsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";
import "../../Global/Global_css/Global_oscuro.css";

import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";


import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalNuevoEgreso from "./modales/ModalNuevoEgreso.jsx";
import ModalEditarEgreso from "./modales/ModalEditarEgreso.jsx";
import ModalPagarOtrosEgresos from "./modales/ModalPagarOtrosEgresos.jsx";
import { ModalDetalleMovimientoEgreso } from "../../Global/Modales/ModalDetalleMovimiento.jsx";
import ModalEliminar from "../../Global/Modales/ModalEliminar.jsx";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faMagnifyingGlass,
  faPlus,
  faFileExcel,
  faPenToSquare,
  faTrashCan,
  faChevronDown,
  faArrowRightLong,
  faTimes,
  faEye,
  faBoxOpen,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";

import * as XLSX from "xlsx";
import { useListas } from "../../../context/ListasContext.jsx";
import { useDateRange } from "../../../context/DateRangeContext.jsx";
import { readMovPerfCache, writeMovPerfCache, clearMovPerfCache } from "../_shared/performanceCache.js";

const MIN_LOADING_MS = 0;
const FORCE_SHOW_LOADER_DEV = false;
const PAGE_SIZE = 100;
const PROBE_LIMIT = PAGE_SIZE + 1;
const SKELETON_ROWS = 10;


function notifyMovimientosMutados(origen = "otros_egresos") {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("balto:movimientos-mutados", {
        detail: {
          origen,
          modulos: ["otros_egresos", "movimientos", "flujo_caja"],
          ts: Date.now(),
        },
      })
    );
  } catch {
    // No debe bloquear el guardado/eliminado.
  }
}




function getDepositoChequeLabel(row) {
  if (!row || typeof row !== "object") return "";

  // No alcanza con que el egreso tenga cheque_id: un egreso normal puede estar
  // pagado con cheque/eCheq. Solo mostramos "depositado" si el backend lo
  // marcó explícitamente como movimiento de depósito bancario.
  const esDepositoCheque =
    normalizeFlag(row?.es_deposito_cheque) || normalizeFlag(row?.esDepositoCheque);

  if (!esDepositoCheque) return "";

  const tipoCheque = String(
    row?.cheque_tipo ??
      row?.cheque?.tipo ??
      row?.medio_pago_nombre ??
      row?.medio_pago ??
      row?.comprobante_tipo ??
      ""
  )
    .toUpperCase()
    .replace(/[-_]/g, " ")
    .trim();

  return tipoCheque.includes("ECHEQ") || tipoCheque.includes("E CHEQ")
    ? "ECHEQ DEPOSITADO"
    : "CHEQUE DEPOSITADO";
}



function buildDepositoChequeMedioDetalle(row) {
  const label = getDepositoChequeLabel(row);
  if (!label) return null;

  const tipoRaw = String(
    row?.cheque_tipo ??
      row?.cheque?.tipo ??
      row?.cheque?.tipo_cheque ??
      row?.medio_pago_nombre ??
      row?.medio_pago ??
      row?.comprobante_tipo ??
      "CHEQUE"
  )
    .toUpperCase()
    .replace(/[-_]/g, " ")
    .trim();

  const tipoLower = tipoRaw.includes("ECHEQ") || tipoRaw.includes("E CHEQ") ? "echeq" : "cheque";
  const tipoNombre = tipoLower === "echeq" ? "ECHEQ" : "CHEQUE";

  const importe =
    Number(
      row?.cheque_importe ??
        row?.cheque?.importe ??
        row?.monto_total ??
        row?.total ??
        row?.total_general ??
        0
    ) || 0;

  const descripcionCheque = String(
    row?.cheque_descripcion ??
      row?.descripcion_cheque ??
      row?.observaciones_cheque ??
      row?.cheque?.descripcion ??
      row?.cheque?.observaciones ??
      row?.cheque?.cheque_descripcion ??
      ""
  ).trim();

  const mp = {
    id_movimiento_medio_pago: 0,
    id_movimiento: row?.id_movimiento ?? null,
    id_medio_pago: row?.id_medio_pago ?? null,
    medio_pago_nombre: tipoNombre,
    nombre_medio: tipoNombre,
    medio_pago: tipoNombre,
    monto: importe,
    id_cheque: row?.cheque_id ?? row?.id_cheque ?? row?.cheque?.id_cheque ?? null,
    cheque_tipo: tipoLower,
    tipo_cheque: tipoLower,
    numero_cheque: row?.cheque_numero ?? row?.numero_cheque ?? row?.cheque?.numero_cheque ?? "",
    emisor: row?.cheque_emisor ?? row?.emisor ?? row?.cheque?.emisor ?? "",
    fecha_emision:
      row?.cheque_fecha_emision ?? row?.fecha_emision ?? row?.cheque?.fecha_emision ?? "",
    fecha_pago: row?.cheque_fecha_pago ?? row?.fecha_pago ?? row?.cheque?.fecha_pago ?? "",
    cheque_importe: importe,
    cheque_descripcion: descripcionCheque,
    descripcion: descripcionCheque,
    observaciones: descripcionCheque,
    detalle_deposito: label,
    cheque: {
      id_cheque: row?.cheque_id ?? row?.id_cheque ?? row?.cheque?.id_cheque ?? null,
      tipo: tipoLower,
      tipo_cheque: tipoLower,
      cheque_tipo: tipoLower,
      numero_cheque: row?.cheque_numero ?? row?.numero_cheque ?? row?.cheque?.numero_cheque ?? "",
      emisor: row?.cheque_emisor ?? row?.emisor ?? row?.cheque?.emisor ?? "",
      fecha_emision:
        row?.cheque_fecha_emision ?? row?.fecha_emision ?? row?.cheque?.fecha_emision ?? "",
      fecha_pago: row?.cheque_fecha_pago ?? row?.fecha_pago ?? row?.cheque?.fecha_pago ?? "",
      importe,
      descripcion: descripcionCheque,
      observaciones: descripcionCheque,
      cheque_descripcion: descripcionCheque,
    },
  };

  return normalizeOtroEgresoMedioDetalle(mp);
}

function mergeDepositoChequeMedioDetalle(mp, depositoMp) {
  if (!depositoMp) return mp;

  const esCheque =
    Number(mp?.id_cheque ?? 0) > 0 ||
    String(mp?.cheque_tipo ?? mp?.tipo_cheque ?? mp?.medio_pago_nombre ?? mp?.nombre_medio ?? "")
      .toUpperCase()
      .includes("CHEQ");

  if (!esCheque) return mp;

  const descripcionCheque = String(
    mp?.cheque_descripcion ??
      mp?.descripcion ??
      mp?.observaciones ??
      mp?.cheque?.descripcion ??
      depositoMp?.cheque_descripcion ??
      depositoMp?.descripcion ??
      ""
  ).trim();

  const montoMp = Number(mp?.monto ?? 0) || 0;
  const importeMp = Number(mp?.cheque_importe ?? 0) || 0;

  return normalizeOtroEgresoMedioDetalle({
    ...depositoMp,
    ...mp,
    id_cheque: mp?.id_cheque ?? depositoMp?.id_cheque ?? null,
    cheque_tipo: mp?.cheque_tipo || depositoMp?.cheque_tipo || depositoMp?.tipo_cheque || "",
    tipo_cheque: mp?.tipo_cheque || depositoMp?.tipo_cheque || depositoMp?.cheque_tipo || "",
    numero_cheque: mp?.numero_cheque || depositoMp?.numero_cheque || "",
    emisor: mp?.emisor || depositoMp?.emisor || "",
    fecha_emision: mp?.fecha_emision || depositoMp?.fecha_emision || "",
    fecha_pago: mp?.fecha_pago || depositoMp?.fecha_pago || "",
    monto: montoMp > 0 ? montoMp : depositoMp?.monto,
    cheque_importe: importeMp > 0 ? importeMp : depositoMp?.cheque_importe,
    cheque_descripcion: descripcionCheque,
    descripcion: descripcionCheque,
    observaciones: descripcionCheque,
    cheque: {
      ...(depositoMp?.cheque || {}),
      ...(mp?.cheque || {}),
      id_cheque: mp?.id_cheque ?? mp?.cheque?.id_cheque ?? depositoMp?.id_cheque ?? depositoMp?.cheque?.id_cheque ?? null,
      tipo: mp?.cheque_tipo || mp?.tipo_cheque || mp?.cheque?.tipo || depositoMp?.cheque_tipo || depositoMp?.tipo_cheque || depositoMp?.cheque?.tipo || "",
      tipo_cheque: mp?.tipo_cheque || mp?.cheque_tipo || mp?.cheque?.tipo_cheque || depositoMp?.tipo_cheque || depositoMp?.cheque_tipo || "",
      cheque_tipo: mp?.cheque_tipo || mp?.tipo_cheque || mp?.cheque?.cheque_tipo || depositoMp?.cheque_tipo || depositoMp?.tipo_cheque || "",
      numero_cheque: mp?.numero_cheque || mp?.cheque?.numero_cheque || depositoMp?.numero_cheque || depositoMp?.cheque?.numero_cheque || "",
      emisor: mp?.emisor || mp?.cheque?.emisor || depositoMp?.emisor || depositoMp?.cheque?.emisor || "",
      fecha_emision: mp?.fecha_emision || mp?.cheque?.fecha_emision || depositoMp?.fecha_emision || depositoMp?.cheque?.fecha_emision || "",
      fecha_pago: mp?.fecha_pago || mp?.cheque?.fecha_pago || depositoMp?.fecha_pago || depositoMp?.cheque?.fecha_pago || "",
      importe: importeMp > 0 ? importeMp : depositoMp?.cheque_importe ?? depositoMp?.monto ?? 0,
      descripcion: descripcionCheque,
      observaciones: descripcionCheque,
      cheque_descripcion: descripcionCheque,
    },
  });
}

function isDepositoChequeEgreso(row) {
  if (!row || typeof row !== "object") return false;
  if (getDepositoChequeLabel(row)) return true;

  // Blindaje extra por si el backend todavía no manda es_deposito_cheque,
  // pero el movimiento ya viene identificado en la descripción/listado.
  const text = normalizeSearchText([
    row?.detalle,
    row?.descripcion,
    row?.concepto,
    row?.producto_nombre,
    row?.stock_producto_nombre,
    row?.detalle_nombre,
    row?.comprobante_tipo,
    row?.tipo_movimiento,
    row?.tipo,
  ].join(" "));

  const mencionaCheque =
    text.includes("cheque") ||
    text.includes("echeq") ||
    text.includes("e cheq") ||
    text.includes("e-cheq") ||
    text.includes("e cheque");

  return mencionaCheque && text.includes("depositad");
}

function withDepositoChequeDetalle(row) {
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

  const mediosPagoDetalle = getOtroEgresoMediosDetalle(row);

  return {
    ...row,
    detalle: label,
    descripcion: label,
    concepto: label,
    cantidad_items: 1,
    items: [itemCheque],
    items_detalle: [itemCheque],
    medios_pago_detalle: mediosPagoDetalle,
    cantidad_medios_pago: mediosPagoDetalle.length,
  };
}

function cantidadDetallesMovimiento(row) {
  const arrays = [row?.items_detalle, row?.itemsDetalle, row?.items, row?.detalles];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length > 0) return arr.length;
  }

  const n = Number(
    row?.cantidad_items ??
      row?.cantidadItems ??
      row?.detalles_count ??
      row?.detallesCount ??
      row?.cantidad_detalles ??
      row?.cantidadDetalles ??
      0
  );
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);

  return 1;
}

function productosLabel(row) {
  const depositoLabel = getDepositoChequeLabel(row);
  if (depositoLabel) return depositoLabel;

  const n = cantidadDetallesMovimiento(row);
  return n === 1 ? "1 DETALLE" : `${n} DETALLES`;
}








function getMovimientoId(r) {
  const cand =
    r?.id_movimiento ??
    r?.idMovimiento ??
    r?.id_mov ??
    r?.id ??
    r?.id_egreso ??
    r?.idEgreso ??
    r?.egreso_id ??
    r?.movimiento_id ??
    r?.id_movimiento_fk ??
    null;

  const n = Number(cand);
  if (Number.isFinite(n) && n > 0) return n;
  return null;
}

function getRowKey(r) {
  const id = getMovimientoId(r);
  if (id) return `id:${id}`;

  const f = String(r?.fecha ?? "").trim();
  const d = String(r?.detalle ?? r?.descripcion ?? r?.concepto ?? "").trim();
  const cat = String(r?.categoria ?? r?.categoria_nombre ?? "").trim();
  const m = String(Number(r?.monto_total ?? r?.total ?? r?.total_general ?? 0) || 0);

  return `fx:${f}|${d}|${cat}|${m}`;
}

function normalizeOtroEgresoMedioDetalle(mp) {
  if (!mp || typeof mp !== "object") return mp;

  const idCheque = Number(mp?.id_cheque ?? mp?.cheque_id ?? mp?.cheque?.id_cheque ?? 0) || null;
  const chequeTipo = String(
    mp?.cheque_tipo ?? mp?.tipo_cheque ?? mp?.cheque?.cheque_tipo ?? mp?.cheque?.tipo_cheque ?? mp?.cheque?.tipo ?? mp?.tipo ?? ""
  ).trim();
  const numeroCheque = String(mp?.numero_cheque ?? mp?.cheque_numero ?? mp?.cheque?.numero_cheque ?? "").trim();
  const emisor = String(mp?.emisor ?? mp?.cheque_emisor ?? mp?.cheque?.emisor ?? "").trim();
  const fechaEmision = String(mp?.fecha_emision ?? mp?.cheque_fecha_emision ?? mp?.cheque?.fecha_emision ?? "").trim();
  const fechaPago = String(mp?.fecha_pago ?? mp?.cheque_fecha_pago ?? mp?.cheque?.fecha_pago ?? "").trim();
  const chequeImporte = Number(mp?.cheque_importe ?? mp?.cheque?.importe ?? mp?.importe ?? mp?.monto ?? 0) || 0;
  const chequeDescripcion = String(
    mp?.cheque_descripcion ??
      mp?.descripcion_cheque ??
      mp?.observaciones_cheque ??
      mp?.descripcion ??
      mp?.observaciones ??
      mp?.cheque?.cheque_descripcion ??
      mp?.cheque?.descripcion ??
      mp?.cheque?.observaciones ??
      ""
  ).trim();

  if (!idCheque && !chequeTipo && !numeroCheque && !emisor) return mp;

  const tipoNormalizado = chequeTipo.toLowerCase();

  return {
    ...mp,
    id_cheque: idCheque,
    cheque_tipo: chequeTipo,
    tipo_cheque: chequeTipo,
    numero_cheque: numeroCheque,
    emisor,
    fecha_emision: fechaEmision,
    fecha_pago: fechaPago,
    cheque_importe: chequeImporte,
    cheque_descripcion: chequeDescripcion,
    descripcion: chequeDescripcion,
    observaciones: chequeDescripcion,
    cheque: {
      ...(mp?.cheque || {}),
      id_cheque: idCheque,
      tipo: tipoNormalizado,
      tipo_cheque: tipoNormalizado,
      cheque_tipo: tipoNormalizado,
      numero_cheque: numeroCheque,
      emisor,
      fecha_emision: fechaEmision,
      fecha_pago: fechaPago,
      importe: chequeImporte,
      descripcion: chequeDescripcion,
      observaciones: chequeDescripcion,
      cheque_descripcion: chequeDescripcion,
    },
  };
}

function getOtroEgresoMediosDetalle(row) {
  let detalle = [];

  if (Array.isArray(row?.medios_pago_detalle)) {
    detalle = row.medios_pago_detalle;
  } else if (typeof row?.medios_pago_detalle === "string") {
    try {
      const parsed = JSON.parse(row.medios_pago_detalle);
      detalle = Array.isArray(parsed) ? parsed : [];
    } catch {
      detalle = [];
    }
  }

  const normalizados = detalle.map((mp) => normalizeOtroEgresoMedioDetalle(mp));

  if (!isDepositoChequeEgreso(row)) return normalizados;

  const depositoMp = buildDepositoChequeMedioDetalle(row);
  if (!depositoMp) return normalizados;

  if (!normalizados.length) return [depositoMp];

  let fusionoCheque = false;
  const fusionados = normalizados.map((mp, idx) => {
    const esCheque =
      Number(mp?.id_cheque ?? 0) > 0 ||
      String(mp?.cheque_tipo ?? mp?.tipo_cheque ?? mp?.medio_pago_nombre ?? mp?.nombre_medio ?? "")
        .toUpperCase()
        .includes("CHEQ");

    if (!fusionoCheque && (esCheque || idx === 0)) {
      fusionoCheque = true;
      return mergeDepositoChequeMedioDetalle(mp, depositoMp);
    }

    return mp;
  });

  return fusionoCheque ? fusionados : [depositoMp, ...normalizados];
}

function getOtroEgresoCantidadMedios(row) {
  const n = Number(row?.cantidad_medios_pago);
  if (Number.isFinite(n) && n > 0) return n;
  return getOtroEgresoMediosDetalle(row).length;
}

function hasOtroEgresoDetalleMedios(row) {
  return getOtroEgresoCantidadMedios(row) > 0;
}

function getOtroEgresoTotal(row) {
  const n = Number(row?.monto_total ?? row?.total ?? row?.total_general ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getOtroEgresoPagado(row) {
  const explicit = Number(
    row?.pagado_total ?? row?.monto_pagado ?? row?.total_pagado ?? row?.cobrado_total ?? NaN
  );
  if (Number.isFinite(explicit)) return Math.max(0, explicit);

  return getOtroEgresoMediosDetalle(row).reduce((acc, mp) => {
    const n = Number(mp?.monto ?? mp?.importe ?? 0);
    return acc + (Number.isFinite(n) ? Math.max(0, n) : 0);
  }, 0);
}

function getOtroEgresoSaldo(row) {
  for (const key of ["saldo_pendiente", "saldo_restante", "monto_pendiente", "pendiente", "saldo"]) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  }
  return Math.max(0, getOtroEgresoTotal(row) - getOtroEgresoPagado(row));
}

function getOtroEgresoEstadoPago(row) {
  const estado = String(row?.estado_pago ?? row?.estadoPago ?? "").trim().toLowerCase();
  if (estado) return estado;
  const total = getOtroEgresoTotal(row);
  const pagado = getOtroEgresoPagado(row);
  const saldo = getOtroEgresoSaldo(row);
  if (total <= 0.009 || saldo <= 0.009) return "pagado";
  if (pagado > 0.009) return "pendiente_parcial";
  return "pendiente";
}

function getOtroEgresoEstadoLabel(row) {
  const estado = getOtroEgresoEstadoPago(row);
  if (estado === "pagado" || estado === "cobrado") return "PAGADO";
  if (estado === "pendiente_parcial" || estado === "parcial") return "PENDIENTE PARCIAL";
  return "PENDIENTE";
}

function getOtroEgresoEstadoChipClass(row) {
  const estado = getOtroEgresoEstadoPago(row);
  if (estado === "pagado" || estado === "cobrado") return "mov-chip mov-chip--ok";
  if (estado === "pendiente_parcial" || estado === "parcial") return "mov-chip mov-chip--warn mov-chip--partial";
  return "mov-chip mov-chip--warn";
}

function isOtroEgresoPagado(row) {
  return getOtroEgresoSaldo(row) <= 0.009;
}

function getEgresoIdComprobante(row) {
  const n = Number(row?.id_comprobante ?? row?.comprobante_id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeOtroEgresoRow(r) {
  const categoria = r?.categoria ?? r?.categoria_nombre ?? r?.nombre_categoria ?? "";
  const medioPagoNombre = r?.medio_pago_nombre ?? r?.medio_pago ?? r?.pago_medio_pago ?? "";
  const idMov = getMovimientoId(r);

  const comprobanteUrl = String(r?.comprobante_url ?? "").trim();
  const idComprobante = Number(r?.id_comprobante ?? 0) || 0;
  const archivoMime = String(r?.archivo_mime ?? "").trim();
  const comprobanteTipo = String(r?.comprobante_tipo ?? "").trim();

  const mediosPagoDetalle = getOtroEgresoMediosDetalle(r);
  const cantidadMediosPago = (() => {
    if (isDepositoChequeEgreso(r)) return mediosPagoDetalle.length;
    const n = Number(r?.cantidad_medios_pago);
    if (Number.isFinite(n) && n >= 0) return n;
    return mediosPagoDetalle.length;
  })();

  return {
    ...r,
    id_movimiento: idMov ?? r?.id_movimiento ?? null,
    fecha: r?.fecha,
    categoria: String(categoria ?? "").trim() || "",
    medio_pago_nombre: String(medioPagoNombre ?? "").trim() || "",
    id_comprobante: idComprobante,
    comprobante_url: comprobanteUrl,
    archivo_mime: archivoMime,
    comprobante_tipo: comprobanteTipo,
    tiene_comprobante: idComprobante > 0 || comprobanteUrl !== "",
    medios_pago_detalle: mediosPagoDetalle,
    cantidad_medios_pago: cantidadMediosPago,
    pagado_total: getOtroEgresoPagado(r),
    saldo_pendiente: getOtroEgresoSaldo(r),
    estado_pago: getOtroEgresoEstadoPago(r),
    pagado: isOtroEgresoPagado(r),
  };
}

function rowMatchesQuery(row, query) {
  const qq = normalizeSearchText(query);
  if (!qq) return true;

  const montoNum = Number(row?.monto_total || row?.total || row?.total_general || 0);
  const parts = [];

  if (row && typeof row === "object") {
    for (const k of Object.keys(row)) {
      const val = row[k];
      if (val && typeof val === "object") continue;
      parts.push(String(val ?? ""));
    }
  }

  parts.push(formatFechaDMY(row?.fecha));
  parts.push(productosLabel(row));
  parts.push(String(montoNum), String(Math.trunc(montoNum)), moneyARS(montoNum));

  const hay = normalizeSearchText(parts.join(" | "));
  return hay.includes(qq);
}

function rowInDateRange(row, from, to) {
  if (!from && !to) return true;

  const fecha = parseRowFecha(row?.fecha);
  if (!fecha) return true;

  if (from && fecha < startOfDay(from)) return false;

  if (to) {
    const toEnd = startOfDay(to);
    toEnd.setHours(23, 59, 59, 999);
    if (fecha > toEnd) return false;
  }

  return true;
}

function slugifySheetName(name) {
  const s = String(name || "OtrosEgresos")
    .replace(/[\[\]\*\/\\\?\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (s || "OtrosEgresos").slice(0, 31);
}

function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: safeText(formatFechaDMY(r?.fecha)),
    DESCRIPCION: productosLabel(r),
    TOTAL: Number(r?.monto_total ?? r?.total ?? r?.total_general ?? 0) || 0,
  }));
}

function escapeCSV(value) {
  const s = String(value ?? "");
  if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(content, fileName, mimeType) {
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

export default function OtrosEgresos() {
  const API = `${BASE_URL}/api.php`;
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();

  const {
    lists: listasCtx,
    loadingLists: loadingListsCtx,
    errorLists: errorListsCtx,
    ensureListsLoaded,
    refreshLists,
  } = useListas();

  const { dateRange, setDateRange } = useDateRange();

  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  useEffect(() => {
    rowsRef.current = Array.isArray(rows) ? rows : [];
  }, [rows]);

  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingEditDataId, setLoadingEditDataId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");

  const [showCalendario, setShowCalendario] = useState(false);
  const [q, setQ] = useState("");

  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);

  const [openAdd, setOpenAdd] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [openPagar, setOpenPagar] = useState(false);
  const [openMediosPago, setOpenMediosPago] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedMediosRow, setSelectedMediosRow] = useState(null);

  const [openDelete, setOpenDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState(null);

  const [openViewComprobante, setOpenViewComprobante] = useState(false);
  const [comprobanteView, setComprobanteView] = useState({
    url: "",
    mime: "",
    title: "Comprobante",
  });

  const { toast, showToast, closeToast } = useOtrosEgresosToast();

  useEffect(() => {
    if (errorListsCtx) {
      showToast("error", errorListsCtx, 4200);
    }
  }, [errorListsCtx, showToast]);

  useEffect(() => {
    if (error) {
      showToast("error", error, 4200);
    }
  }, [error, showToast]);

  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);
  const rowsReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const skipSearchRef = useRef(false);

  // Caches para signed URLs
  const signedUrlCacheRef = useRef(new Map());
  const signedUrlInFlightRef = useRef(new Set());

  const showSkeleton = loadingRows;

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const buildHeadersGET = useCallback(() => {
    const { token, sessionKey } = getOtrosEgresosAuthInfo();
    const h = {};
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const buildHeadersPOST = useCallback(() => {
    const { token, sessionKey } = getOtrosEgresosAuthInfo();
    const h = { "Content-Type": "application/json" };
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const parseJsonOrThrow = useCallback(async (res) => {
    const text = await res.text();
    if (!text) throw new Error("Respuesta vacía del servidor.");

    try {
      return JSON.parse(text);
    } catch {
      const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
      throw new Error(`Respuesta inválida (no es JSON). HTTP ${res.status}\n${preview}`);
    }
  }, []);

  const apiGet = useCallback(
    async (url) => {
      const res = await otrosEgresosFetch(url, { method: "GET", headers: buildHeadersGET() });
      return await parseJsonOrThrow(res);
    },
    [buildHeadersGET, parseJsonOrThrow]
  );

  const apiPostJson = useCallback(
    async (url, payload) => {
      const res = await otrosEgresosFetch(url, {
        method: "POST",
        headers: buildHeadersPOST(),
        body: JSON.stringify(payload ?? {}),
      });
      return await parseJsonOrThrow(res);
    },
    [buildHeadersPOST, parseJsonOrThrow]
  );

  const refreshPeriodos = useCallback(async () => {
    try {
      await refreshLists();
    } catch {}
  }, [refreshLists]);

  const loadRows = useCallback(
    async (opts = {}) => {
      const fromDate = opts.from !== undefined ? opts.from : dateRange.from;
      const toDate = opts.to !== undefined ? opts.to : dateRange.to;
      const qLocal = typeof opts.q === "string" ? opts.q : q;
      const append = !!opts.append;
      const offset = Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : 0;

      const fromAPI = dateToAPI(fromDate);
      const toAPI = dateToAPI(toDate);
      const qKey = (qLocal || "").trim();
      const cacheKey = `${fromAPI}|${toAPI}|${qKey}`;

      if (!append && offset === 0 && !cacheRef.current.has(cacheKey)) {
        const persisted = readMovPerfCache("otros_egresos:listar:v3", cacheKey);
        if (persisted?.rows) cacheRef.current.set(cacheKey, persisted);
      }

      const myReqId = ++reqIdRef.current;
      const start = Date.now();

      if (!append) {
        rowsReqIdRef.current = myReqId;
        setLoadingRows(true);
      } else {
        moreReqIdRef.current = myReqId;
        setLoadingMore(true);
      }

      setError("");

      try {
        if (!append && offset === 0 && cacheRef.current.has(cacheKey) && !FORCE_SHOW_LOADER_DEV) {
          if (rowsReqIdRef.current !== myReqId) return null;

          const cached = cacheRef.current.get(cacheKey);
          const cachedRows = Array.isArray(cached?.rows) ? cached.rows : [];

          rowsRef.current = cachedRows;
          setRows(cachedRows);
          setHasMore(!!cached?.hasMore);
          setNextOffset(cached?.nextOffset ?? null);

          if (rowsReqIdRef.current === myReqId) setLoadingRows(false);

          return {
            hasMore: !!cached?.hasMore,
            nextOffset: cached?.nextOffset ?? null,
            received: cachedRows.length,
          };
        }

        const sp = new URLSearchParams();
        sp.set("action", "otros_egresos_listar");
        if (fromAPI) sp.set("fecha_desde", fromAPI);
        if (toAPI) sp.set("fecha_hasta", toAPI);
        if (qKey) sp.set("q", qKey);
        sp.set("limit", String(PROBE_LIMIT));
        sp.set("offset", String(offset));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar otros egresos.");

        if (myReqId !== reqIdRef.current) return null;

        const listKey = Array.isArray(data.otros_egresos)
          ? "otros_egresos"
          : Array.isArray(data.egresos)
          ? "egresos"
          : Array.isArray(data.movimientos)
          ? "movimientos"
          : "otros_egresos";

        const rawArr = Array.isArray(data[listKey]) ? data[listKey] : [];
        const normAll = rawArr.map(normalizeOtroEgresoRow);

        let newHasMore = data.has_more !== undefined ? !!data.has_more : normAll.length > PAGE_SIZE;
        let newNextOffset =
          data.next_offset !== undefined && data.next_offset !== null
            ? Number(data.next_offset)
            : newHasMore
            ? offset + PAGE_SIZE
            : null;

        const page = newHasMore ? normAll.slice(0, PAGE_SIZE) : normAll;
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

        return await new Promise((resolve) => {
          const apply = () => {
            if (myReqId !== reqIdRef.current) return resolve(null);

            if (append) {
              const base = Array.isArray(rowsRef.current) ? rowsRef.current : [];
              const seen = new Set(base.map((x) => getRowKey(x)));
              const add = page.filter((x) => {
                const k = getRowKey(x);
                return k && !seen.has(k);
              });

              const merged = [...base, ...add];
              rowsRef.current = merged;
              setRows(merged);

              if (add.length === 0) {
                newHasMore = false;
                newNextOffset = null;
              }

              setHasMore(newHasMore);
              setNextOffset(newNextOffset);

              if (moreReqIdRef.current === myReqId) setLoadingMore(false);
            } else {
              rowsRef.current = page;
              setRows(page);
              setHasMore(newHasMore);
              setNextOffset(newNextOffset);

              if (offset === 0) {
                const cachePayload = {
                  rows: page,
                  hasMore: newHasMore,
                  nextOffset: newNextOffset,
                };
                cacheRef.current.set(cacheKey, cachePayload);
                writeMovPerfCache("otros_egresos:listar:v3", cacheKey, cachePayload);
              }

              if (rowsReqIdRef.current === myReqId) setLoadingRows(false);
            }

            resolve({
              hasMore: newHasMore,
              nextOffset: newNextOffset,
              received: page.length,
            });
          };

          if (remaining > 0) setTimeout(apply, remaining);
          else apply();
        });
      } catch (e) {
        const elapsed = Date.now() - start;
        const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
        const msg = e?.message || "Error cargando otros egresos.";

        return await new Promise((resolve) => {
          setTimeout(() => {
            if (myReqId !== reqIdRef.current) return resolve(null);

            setError(msg);

            if (append) {
              if (moreReqIdRef.current === myReqId) setLoadingMore(false);
            } else {
              if (rowsReqIdRef.current === myReqId) setLoadingRows(false);
            }

            resolve(null);
          }, remaining);
        });
      }
    },
    [API, apiGet, dateRange, q]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        await ensureListsLoaded({ force: false, background: true });
      } catch {}

      if (!alive) return;

      await loadRows({
        from: dateRange.from,
        to: dateRange.to,
        q: "",
        offset: 0,
        append: false,
      });
    })();

    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(() => {
      loadRows({ from: dateRange.from, to: dateRange.to, q, offset: 0, append: false });
    }, 250);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [q, dateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDateRangeChange = useCallback(
    async (newRange) => {
      if (!newRange.from && !newRange.to) return;

      setDateRange(newRange);
      cacheRef.current.clear();
      clearMovPerfCache("otros_egresos:listar:v3");
      skipSearchRef.current = true;

      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

      await loadRows({
        from: newRange.from,
        to: newRange.to,
        q,
        offset: 0,
        append: false,
      });
    },
    [setDateRange, loadRows, q]
  );

  const filteredRows = useMemo(() => {
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => rowInDateRange(r, dateRange.from, dateRange.to))
      .filter((r) => rowMatchesQuery(r, q));
  }, [rows, dateRange, q]);

  const columns = useMemo(() => {
    return [
      {
        key: "fecha",
        label: "FECHA",
        align: "center",
        fr: 0.9,
        render: (r) => safeText(formatFechaDMY(r.fecha)),
      },
      {
        key: "detalle",
        label: "DESCRIPCIÓN",
        fr: 3.2,
        strong: true,
        align: "left",
        render: (r) => productosLabel(r),
      },
      {
        key: "total",
        label: "TOTAL",
        fr: 1.05,
        align: "right",
        render: (r) => (
          <span className="fc-num">
            {moneyARS(r.monto_total ?? r.total ?? r.total_general ?? 0)}
          </span>
        ),
      },
      { key: "acciones", label: "ACCIONES", fr: 1.5, align: "center", render: () => null },
    ];
  }, []);

  const gridCols = useMemo(() => {
    const fallback = `repeat(${columns.length}, minmax(0, 1fr))`;
    if (!Array.isArray(columns) || !columns.length) return fallback;

    return columns
      .map((c) => {
        const n = Number(c.fr);
        return Number.isFinite(n) && n > 0 ? `${n}fr` : "1fr";
      })
      .join(" ");
  }, [columns]);

  const dateRangeLabel = useMemo(() => {
    const { from, to } = dateRange;

    if (!from && !to) return "Seleccionar fechas";

    if (from && to) {
      if (
        from.getFullYear() === to.getFullYear() &&
        from.getMonth() === to.getMonth() &&
        from.getDate() === to.getDate()
      ) {
        return formatDateUI(from);
      }

      return (
        <>
          <span>{formatDateUI(from)}</span>
          <span className="mov-rangeArrow">
            <FontAwesomeIcon icon={faArrowRightLong} />
          </span>
          <span>{formatDateUI(to)}</span>
        </>
      );
    }

    if (from) return `Desde ${formatDateUI(from)}`;
    return `Hasta ${formatDateUI(to)}`;
  }, [dateRange]);

  const exportBaseName = useMemo(() => {
    const { from, to } = dateRange;
    if (from && to) return `otros_egresos_${dateToAPI(from)}_${dateToAPI(to)}`;
    if (from) return `otros_egresos_desde_${dateToAPI(from)}`;
    return "otros_egresos_todos";
  }, [dateRange]);

  const getExportData = useCallback(() => {
    const dataToExport = buildExportRows(filteredRows);
    if (!dataToExport.length) throw new Error("No hay datos para exportar.");
    return dataToExport;
  }, [filteredRows]);

  const exportToExcel = useCallback(() => {
    const dataToExport = getExportData();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataToExport);

    const headers = Object.keys(dataToExport[0] || {});
    const totalColIndex = headers.findIndex((h) => h === "TOTAL");

    if (totalColIndex >= 0 && ws["!ref"]) {
      const colLetter = XLSX.utils.encode_col(totalColIndex);
      const range = XLSX.utils.decode_range(ws["!ref"]);

      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[`${colLetter}${r + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("OtrosEgresos_Vista"));
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
  }, [getExportData, exportBaseName]);

  const exportToCSV = useCallback(() => {
    const dataToExport = getExportData();
    const headers = Object.keys(dataToExport[0] || {});
    const lines = [
      headers.join(";"),
      ...dataToExport.map((row) => headers.map((h) => escapeCSV(row[h])).join(";")),
    ];
    const csvContent = "\uFEFF" + lines.join("\n");
    downloadBlob(csvContent, `${exportBaseName}.csv`, "text/csv;charset=utf-8;");
  }, [getExportData, exportBaseName]);

  const exportToTXT = useCallback(() => {
    const dataToExport = getExportData();
    const lines = dataToExport.map((row, index) => {
      return [
        `REGISTRO ${index + 1}`,
        `FECHA: ${row.FECHA ?? ""}`,
        `DESCRIPCION: ${row.DESCRIPCION ?? ""}`,
        `TOTAL: ${row.TOTAL ?? ""}`,
        "----------------------------------------",
      ].join("\n");
    });

    const txtContent = lines.join("\n");
    downloadBlob(txtContent, `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
  }, [getExportData, exportBaseName]);

  const handleExport = useCallback(
    async (type) => {
      try {
        if (hasMore) {
          showToast("error", 'Faltan registros sin cargar. Tocá "Cargar todos" primero.', 5200);
          return;
        }

        if (type === "excel") {
          exportToExcel();
          showToast("exito", "Excel exportado.", 2200);
          return;
        }

        if (type === "csv") {
          exportToCSV();
          showToast("exito", "CSV exportado.", 2200);
          return;
        }

        if (type === "txt") {
          exportToTXT();
          showToast("exito", "TXT exportado.", 2200);
        }
      } catch (e) {
        showToast("error", e?.message || "Error exportando archivo.", 3500);
      }
    },
    [hasMore, exportToExcel, exportToCSV, exportToTXT, showToast]
  );

  const exportOptions = useMemo(
    () => [
      {
        key: "excel",
        label: "Exportar Excel (.xlsx)",
        icon: faFileExcel,
        onClick: () => handleExport("excel"),
      },
      {
        key: "csv",
        label: "Exportar CSV (.csv)",
        onClick: () => handleExport("csv"),
      },
      {
        key: "txt",
        label: "Exportar TXT (.txt)",
        onClick: () => handleExport("txt"),
      },
    ],
    [handleExport]
  );

  const apiPostSave = useCallback(
    async (payload, isEdit) => {
      setError("");
      const { idUsuario } = getOtrosEgresosAuthInfo();
      const action = isEdit ? "otros_egresos_actualizar" : "otros_egresos_crear";

      try {
        const data = await apiPostJson(`${API}?action=${action}`, {
          ...(payload || {}),
          idUsuario,
        });

        if (!data?.exito) throw new Error(data?.mensaje || "No se pudo guardar.");
        notifyMovimientosMutados(isEdit ? "otros_egresos_actualizar" : "otros_egresos_crear");
        return data;
      } catch (e) {
        const msg = e?.message || "No se pudo guardar.";
        setError(msg);
        throw e;
      }
    },
    [API, apiPostJson]
  );

  const reloadVista = useCallback(async () => {
    try {
      cacheRef.current.clear();
      clearMovPerfCache("otros_egresos:listar:v3");
      signedUrlCacheRef.current.clear();
      signedUrlInFlightRef.current.clear();
      await loadRows({
        from: dateRange.from,
        to: dateRange.to,
        q,
        offset: 0,
        append: false,
      });
    } catch (e) {
      const msg = e?.message || "Error recargando la vista.";
      setError(msg);
      showToast("error", msg, 4200);
    }
  }, [dateRange.from, dateRange.to, loadRows, q, showToast]);

  useEffect(() => {
    const handleMovimientosMutados = (event) => {
      const detail = event?.detail || {};
      const modulos = Array.isArray(detail?.modulos) ? detail.modulos : [];
      const afectaOtrosEgresos =
        detail?.origen === "deposito_cheque_banco" ||
        modulos.includes("otros_egresos") ||
        modulos.includes("movimientos");

      if (!afectaOtrosEgresos) return;

      cacheRef.current.clear();
      clearMovPerfCache("otros_egresos:listar:v3");
      signedUrlCacheRef.current.clear();
      signedUrlInFlightRef.current.clear();

      loadRows({
        from: dateRange.from,
        to: dateRange.to,
        q,
        offset: 0,
        append: false,
      });
    };

    window.addEventListener("balto:movimientos-mutados", handleMovimientosMutados);
    return () => {
      window.removeEventListener("balto:movimientos-mutados", handleMovimientosMutados);
    };
  }, [dateRange.from, dateRange.to, loadRows, q]);

  const getComprobanteSignedUrl = useCallback(
    async (idComprobante, idMovimiento = null) => {
      const id = Number(idComprobante || 0);
      const mov = Number(idMovimiento || 0);

      if (!id && !mov) return "";

      const cacheKey = id > 0 ? `id:${id}` : `mov:${mov}`;

      if (signedUrlCacheRef.current.has(cacheKey)) {
        return signedUrlCacheRef.current.get(cacheKey) || "";
      }

      if (signedUrlInFlightRef.current.has(cacheKey)) {
        return await new Promise((resolve, reject) => {
          const poll = setInterval(() => {
            if (signedUrlCacheRef.current.has(cacheKey)) {
              clearInterval(poll);
              resolve(signedUrlCacheRef.current.get(cacheKey) || "");
            } else if (!signedUrlInFlightRef.current.has(cacheKey)) {
              clearInterval(poll);
              reject(new Error("No se pudo obtener el comprobante."));
            }
          }, 40);

          setTimeout(() => {
            clearInterval(poll);
            reject(new Error("Timeout esperando URL firmada."));
          }, 8000);
        });
      }

      signedUrlInFlightRef.current.add(cacheKey);

      try {
        const sp = new URLSearchParams();
        sp.set("action", "otros_egresos_comprobantes_descargar");

        if (id > 0) sp.set("id_comprobante", String(id));
        else sp.set("id_movimiento", String(mov));

        const data = await apiGet(`${API}?${sp.toString()}`);

        if (!data?.exito) {
          throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
        }

        const finalUrl = String(data?.url || "").trim();
        if (!finalUrl) {
          throw new Error("El backend no devolvió la URL del comprobante.");
        }

        signedUrlCacheRef.current.set(cacheKey, finalUrl);
        return finalUrl;
      } finally {
        signedUrlInFlightRef.current.delete(cacheKey);
      }
    },
    [API, apiGet]
  );

  const handleOpenDeleteModal = useCallback((row) => {
    if (!row?.id_movimiento) return;
    setRowToDelete(row);
    setOpenDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!rowToDelete?.id_movimiento) {
      throw new Error("No se encontró el movimiento a eliminar.");
    }

    const id = rowToDelete.id_movimiento;
    setDeletingId(id);
    setError("");

    try {
      const { idUsuario } = getOtrosEgresosAuthInfo();
      const sp = new URLSearchParams();
      sp.set("action", "otros_egresos_eliminar");
      sp.set("id_movimiento", String(id));

      const data = await apiPostJson(`${API}?${sp.toString()}`, { idUsuario });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar.");

      notifyMovimientosMutados("otros_egresos_eliminar");

      if (selectedRow?.id_movimiento === id) {
        setSelectedRow(null);
      }

      setOpenDelete(false);
      setRowToDelete(null);

      await reloadVista();
      await refreshPeriodos();
      return data;
    } catch (e) {
      const msg = e?.message || "Error eliminando egreso.";
      setError(msg);
      throw e;
    } finally {
      setDeletingId(null);
    }
  }, [API, apiPostJson, reloadVista, refreshPeriodos, rowToDelete, selectedRow]);

  const handleCloseDeleteModal = useCallback(() => {
    if (deletingId) return;
    setOpenDelete(false);
    setRowToDelete(null);
  }, [deletingId]);

  const handleLoadAll = useCallback(async () => {
    if (!hasMore || loadingMore || loadingRows || loadingListsCtx || loadingAll) return;
    if (nextOffset === null) return;

    setLoadingAll(true);
    showToast("cargando", "Cargando todos los egresos…", 12000);

    let offset = nextOffset;
    let guard = 0;

    try {
      while (offset !== null && guard < 3000) {
        const beforeLen = rowsRef.current.length;

        const res = await loadRows({
          from: dateRange.from,
          to: dateRange.to,
          q: (q || "").trim(),
          offset,
          append: true,
        });

        if (!res) break;

        guard += 1;
        offset = res.nextOffset;

        const afterLen = rowsRef.current.length;
        if (afterLen === beforeLen) break;
        if (!res.hasMore || offset === null) break;
      }

      setRows([...rowsRef.current]);
      showToast("exito", `Listo: se cargaron ${rowsRef.current.length} egresos.`, 2600);
    } catch (e) {
      showToast("error", e?.message || "Error cargando todos.", 4200);
    } finally {
      setLoadingAll(false);
    }
  }, [
    hasMore,
    loadingMore,
    loadingRows,
    loadingListsCtx,
    loadingAll,
    nextOffset,
    dateRange,
    q,
    loadRows,
    showToast,
  ]);

  const handleOpenEdit = useCallback(
    async (row) => {
      if (isDepositoChequeEgreso(row)) {
        showToast(
          "error",
          "Los egresos generados por depósito de cheque/eCheq no se pueden editar.",
          3600
        );
        return;
      }

      const id = Number(row?.id_movimiento ?? 0);
      if (!id) return;

      setLoadingEditDataId(id);
      setError("");

      try {
        const sp = new URLSearchParams();
        sp.set("action", "otros_egresos_obtener");
        sp.set("id_movimiento", String(id));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) {
          throw new Error(data?.mensaje || "No se pudo obtener el egreso para editar.");
        }

        const egreso = data?.egreso ?? data?.otro_egreso ?? data?.movimiento ?? null;
        if (!egreso) {
          throw new Error("No se encontró la información del egreso.");
        }

        setSelectedRow(normalizeOtroEgresoRow(egreso));
        setOpenEdit(true);
      } catch (e) {
        showToast("error", e?.message || "No se pudo abrir el editor.", 4200);
      } finally {
        setLoadingEditDataId(null);
      }
    },
    [API, apiGet, showToast]
  );

  const handleOpenMediosPago = useCallback((row) => {
    setSelectedMediosRow(withDepositoChequeDetalle(row));
    setOpenMediosPago(true);
  }, []);

  const handleCloseMediosPago = useCallback(() => {
    setOpenMediosPago(false);
    setSelectedMediosRow(null);
  }, []);

  const handleOpenPagar = useCallback((row) => {
    const normalized = normalizeOtroEgresoRow(row || {});
    const id = getMovimientoId(normalized);

    if (!id) {
      showToast("error", "No se encontró el ID del egreso para pagar.", 3200);
      return;
    }

    if (isDepositoChequeEgreso(normalized)) {
      showToast("advertencia", "Los egresos generados por depósito de cheque/eCheq no se pagan desde este modal.", 3600);
      return;
    }

    if (isOtroEgresoPagado(normalized)) {
      showToast("advertencia", "Este egreso ya está pagado completamente.", 2800);
      return;
    }

    setSelectedRow({ ...normalized, id_movimiento: id });
    setOpenPagar(true);
  }, [showToast]);

  const handleClosePagar = useCallback(() => {
    setOpenPagar(false);
    setSelectedRow(null);
  }, []);

  const handlePrewarmComprobante = useCallback(
    async (row) => {
      const idComprobante = getEgresoIdComprobante(row);
      const idMovimiento = Number(row?.id_movimiento ?? 0);
      if (!idComprobante && !idMovimiento) return;
      getComprobanteSignedUrl(idComprobante, idMovimiento).catch(() => {});
    },
    [getComprobanteSignedUrl]
  );

  const handleOpenComprobante = useCallback(
    async (row) => {
      const idComprobante = getEgresoIdComprobante(row);
      const idMovimiento = Number(row?.id_movimiento ?? 0);

      const tieneComprobante =
        (idComprobante && idComprobante > 0) ||
        String(row?.comprobante_url ?? "").trim() !== "";

      if (!tieneComprobante) return;

      try {
        const signedUrl = await getComprobanteSignedUrl(idComprobante, idMovimiento);
        if (!signedUrl) {
          showToast("error", "No se pudo obtener el comprobante.", 3000);
          return;
        }

        const detalle = String(row?.detalle ?? row?.descripcion ?? row?.concepto ?? "").trim();
        const fecha = formatFechaDMY(row?.fecha);

        const esComprobanteCheque = ["CHEQUE", "ECHEQ", "ECHEQUE"].includes(
          String(row?.comprobante_tipo ?? "").trim().toUpperCase()
        );

        setComprobanteView({
          url: signedUrl,
          mime: String(row?.archivo_mime ?? "").trim() || "application/octet-stream",
          title: esComprobanteCheque
            ? detalle
              ? `Comprobante de cheque - ${detalle} - ${fecha}`
              : `Comprobante de cheque - ${fecha}`
            : detalle
            ? `Comprobante de egreso - ${detalle} - ${fecha}`
            : `Comprobante de egreso - ${fecha}`,
        });

        setOpenViewComprobante(true);
      } catch (e) {
        showToast("error", e?.message || "No se pudo abrir el comprobante.", 3200);
      }
    },
    [getComprobanteSignedUrl, showToast]
  );

  const closeComprobanteModal = useCallback(() => {
    setOpenViewComprobante(false);
    setComprobanteView({
      url: "",
      mime: "",
      title: "Comprobante",
    });
  }, []);

  const isAnyLoading = loadingRows || loadingMore || loadingAll || !!loadingEditDataId;

  const skelWidths = useMemo(
    () => ({
      fecha: ["44%", "38%", "40%", "36%"],
      detalle: ["72%", "58%", "66%", "48%"],
      total: ["38%", "30%", "34%", "28%"],
    }),
    []
  );

  const renderSkeletonRow = (idx) => (
    <div
      key={`skel-${idx}`}
      className="mov-gridTable mov-gridTable--row mov-row--skeleton"
      style={{ gridTemplateColumns: gridCols }}
      role="row"
      aria-hidden="true"
    >
      {columns.map((c) => {
        if (c.key === "acciones") {
          return (
            <div
              key={c.key}
              className="mov-gridCell mov-gridCell--actions is-center"
              role="cell"
              data-label={c.label}
            >
              <div className="mov-skelActions">
                <span className="mov-skelIcon" />
                <span className="mov-skelIcon" />
                <span className="mov-skelIcon" />
                <span className="mov-skelIcon" />
              </div>
            </div>
          );
        }

        const list = skelWidths[c.key] || ["60%"];
        const w = list[idx % list.length];

        return (
          <div
            key={c.key}
            className={[
              "mov-gridCell",
              c.align === "right" ? "is-right" : "",
              c.align === "center" ? "is-center" : "",
            ].join(" ")}
            role="cell"
            data-label={c.label}
          >
            <span className="mov-skeletonBar" style={{ width: w }} />
          </div>
        );
      })}
    </div>
  );

  const listsBase = listasCtx || {
    periodos: [],
    clientes: [],
    medios_pago: [],
    tipos_venta: [],
    clasificaciones: [],
    cuentas_corrientes: [],
    detalles: [],
    proveedores: [],
    tipos_movimiento: [],
    categorias_egreso: [],
    categorias_ingreso: [],
    detalles_egresos: [],
    detalles_egreso: [],
    detalles_ingresos: [],
    detalles_ingreso: [],
  };

  const lists = useMemo(() => {
    const buscarDetallesModulo = () => {
      // `detalles` global viene de stock_productos. Para otros egresos se debe
      // usar exclusivamente la tabla `detalles`, expuesta por claves específicas.
      // Aunque venga vacía, no hacemos fallback a productos de stock.
      for (const key of [
        "detalles_egresos",
        "detallesEgresos",
        "detalles_egreso",
        "detallesEgreso",
        "detalles_ingresos",
        "detallesIngresos",
        "detalles_ingreso",
        "detallesIngreso",
      ]) {
        if (Array.isArray(listsBase?.[key])) return listsBase[key];
      }
      return [];
    };

    const detallesCompartidos = buscarDetallesModulo();

    return {
      ...listsBase,
      detalles_egresos: detallesCompartidos,
      detallesEgresos: detallesCompartidos,
      detalles_egreso: detallesCompartidos,
      detallesEgreso: detallesCompartidos,
    };
  }, [listsBase]);

  return (
    <div className="mov-page">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      <section className="mov-card mov-card--table">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Movs · Otros Egresos</div>
              <div className="mov-card__hint">
                Mostrando <b>{filteredRows.length}</b> egresos
                {loadingAll ? " (cargando…)" : hasMore && filteredRows.length > 0 ? " (hay más)" : ""}
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="cc-filter cc-filter--cal">
                <div
                  className={`cc-floatingField cc-floatingField--calendar is-active ${
                    showCalendario ? "is-open" : ""
                  }`}
                >
                  <button
                    type="button"
                    className={`cc-calTrigger ${showCalendario ? "is-open" : ""}`}
                    onClick={() => setShowCalendario((v) => !v)}
                    disabled={isAnyLoading || loadingListsCtx}
                    title="Seleccionar rango de fechas"
                  >
                    {dateRangeLabel}
                    <span className="cc-calTrigger__iconRight">
                      <FontAwesomeIcon icon={faChevronDown} />
                    </span>
                  </button>

                  <span className="cc-floatingLabel cc-floatingLabel--active">
                    <FontAwesomeIcon icon={faCalendarDays} /> Período
                  </span>

                  {showCalendario && (
                    <div className="cc-calDropdown">
                      <Calendario
                        value={dateRange}
                        onChange={async (newRange) => {
                          if (newRange.from && newRange.to) setShowCalendario(false);
                          await handleDateRangeChange(newRange);
                        }}
                        onClose={() => setShowCalendario(false)}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="cc-filter">
                <div className="cc-floatingField cc-floatingField--search is-active">
                  <div className="cc-searchInput">
                    <div className="cc-searchInput__fieldWrap">
                      <input
                        className="cc-input cc-input--floating"
                        id="vents-comppr-wit"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                            skipSearchRef.current = true;
                            await loadRows({
                              from: dateRange.from,
                              to: dateRange.to,
                              q: e.currentTarget.value,
                              offset: 0,
                              append: false,
                            });
                          }
                        }}
                        placeholder="Buscar por descripción..."
                        disabled={loadingListsCtx || loadingAll}
                      />

                      <span className="cc-floatingLabel">
                        <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                      </span>

                      {q.trim() !== "" && (
                        <button
                          type="button"
                          className="cc-clearSearch cc-clearSearch--inside"
                          title="Limpiar búsqueda"
                          onClick={async () => {
                            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                            setQ("");
                            skipSearchRef.current = true;
                            await loadRows({
                              from: dateRange.from,
                              to: dateRange.to,
                              q: "",
                              offset: 0,
                              append: false,
                            });
                          }}
                          disabled={loadingAll}
                        >
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="mov-card__actions"
            style={{ display: "flex", gap: 10, alignItems: "center" }}
          >
            <BotonExportar
              disabled={loadingRows || filteredRows.length === 0}
              loading={loadingAll}
              label="Exportar"
              title={filteredRows.length ? "Exportar archivo" : "No hay datos para exportar"}
              opciones={exportOptions}
              align="right"
            />

            <button
              type="button"
              className="mov-btn mov-btn--primary"
              onClick={() => {
                setSelectedRow(null);
                setOpenAdd(true);
              }}
              title="Crear nuevo egreso"
            >
              <FontAwesomeIcon icon={faPlus} /> Nuevo Egreso
            </button>
          </div>
        </div>

        <div
          className={`mov-gridTable mov-gridTable--head ${
            hasTableScroll ? "has-y-scroll" : ""
          }`}
          style={{ gridTemplateColumns: gridCols }}
          role="row"
        >
          {columns.map((c) => (
            <div
              key={c.key}
              className={[
                "mov-gridCell",
                "mov-gridCell--head",
                c.align === "right" ? "is-right" : "",
                c.align === "center" ? "is-center" : "",
              ].join(" ")}
              role="columnheader"
            >
              {c.label}
            </div>
          ))}
        </div>

        <div className="mov-tableWrap" role="rowgroup" ref={tableWrapRef}>
          <div
            className={[
              "mov-gridBody",
              "mov-gridBody--relative",
              showSkeleton ? "mov-softLoading" : "",
            ].join(" ")}
          >
            {showSkeleton ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
              </div>
            ) : (
              <>
                {filteredRows.map((r) => {
                  const key = getRowKey(r);
                  const isLoadingThisEdit = loadingEditDataId === r.id_movimiento;
                  const esDepositoChequeEgreso = isDepositoChequeEgreso(r);
                  const idComprobante = getEgresoIdComprobante(r);
                  const tieneComprobante =
                    (idComprobante && idComprobante > 0) ||
                    String(r?.comprobante_url ?? "").trim() !== "";
                  return (
                    <div
                      key={key}
                      className="mov-gridTable mov-gridTable--row"
                      style={{ gridTemplateColumns: gridCols }}
                      role="row"
                    >
                      {columns.map((c) => {
                        if (c.key === "acciones") {
                          return (
                            <div
                              key={c.key}
                              className={["mov-gridCell", "mov-gridCell--actions", "is-center"].join(" ")}
                              role="cell"
                              data-label={c.label}
                            >
                              <div className="mov-actionsInline">
                                <button
                                  type="button"
                                  className={`mov-iconBtn ${tieneComprobante ? "" : "is-disabled"}`}
                                  title={
                                    tieneComprobante
                                      ? "Ver comprobante"
                                      : "Este egreso no tiene comprobante"
                                  }
                                  onClick={() => handleOpenComprobante(r)}
                                  onMouseEnter={() => {
                                    if (tieneComprobante) handlePrewarmComprobante(r);
                                  }}
                                  onPointerEnter={() => {
                                    if (tieneComprobante) handlePrewarmComprobante(r);
                                  }}
                                  onFocus={() => {
                                    if (tieneComprobante) handlePrewarmComprobante(r);
                                  }}
                                  disabled={!tieneComprobante || isAnyLoading || loadingListsCtx}
                                >
                                  <FontAwesomeIcon icon={faEye} />
                                </button>

                                <button
                                  type="button"
                                  className="mov-iconBtn"
                                  title="Ver información completa del movimiento"
                                  onClick={() => handleOpenMediosPago(r)}
                                  disabled={isAnyLoading || loadingListsCtx}
                                >
                                  <FontAwesomeIcon icon={faInfoCircle} />
                                </button>


                                {!esDepositoChequeEgreso && (
                                  <button
                                    type="button"
                                    className="mov-iconBtn"
                                    title="Editar"
                                    onClick={() => handleOpenEdit(r)}
                                    disabled={isAnyLoading || loadingListsCtx || isLoadingThisEdit}
                                  >
                                    {isLoadingThisEdit ? "..." : <FontAwesomeIcon icon={faPenToSquare} />}
                                  </button>
                                )}

                                {!esDepositoChequeEgreso && (
                                  <button
                                    type="button"
                                    className="mov-iconBtn mov-iconBtn--danger"
                                    title="Eliminar"
                                    disabled={isAnyLoading || loadingListsCtx || deletingId === r.id_movimiento}
                                    onClick={() => handleOpenDeleteModal(r)}
                                  >
                                    {deletingId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={faTrashCan} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        const val = c.render ? c.render(r) : safeText(r[c.key]);

                        return (
                          <div
                            key={c.key}
                            className={[
                              "mov-gridCell",
                              c.align === "right" ? "is-right" : "",
                              c.align === "center" ? "is-center" : "",
                              c.strong ? "is-strong" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            role="cell"
                            data-label={c.label}
                            title={typeof val === "string" ? val : undefined}
                          >
                            <span className="mov-ellipsissss">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {!isAnyLoading && filteredRows.length === 0 && (
                  <div className="cc-emptyState">
                    <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                    <div className="cc-emptyText">
                      {q.trim()
                        ? `No se encontraron egresos para "${q.trim()}".`
                        : "No hay egresos para mostrar en el rango de fechas seleccionado."}
                    </div>
                  </div>
                )}

                {!loadingRows && hasMore && filteredRows.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                    <button
                      type="button"
                      className="mov-btn mov-btn--loadAll"
                      onClick={handleLoadAll}
                      disabled={loadingMore || loadingAll || loadingListsCtx}
                      title="Cargar todos los egresos restantes"
                    >
                      {loadingAll ? "Cargando todos…" : "Cargar todos"}
                    </button>
                  </div>
                )}

                {(loadingMore || loadingAll) && (
                  <div
                    className="mov-skeletonMore"
                    aria-busy="true"
                    aria-label="Cargando más registros"
                  >
                    {Array.from({ length: 6 }).map((_, i) => renderSkeletonRow(i))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <ModalNuevoEgreso
        open={openAdd}
        mode="create"
        initialData={null}
        lists={lists}
        onClose={() => {
          setOpenAdd(false);
          setSelectedRow(null);
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
        }}
        onToast={showToast}
        onSubmit={apiPostSave}
        onSaved={async () => {
          setOpenAdd(false);
          setSelectedRow(null);
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
          await reloadVista();
          await refreshPeriodos();
          showToast("exito", "Egreso guardado correctamente.", 2600);
        }}
      />

      <ModalEditarEgreso
        open={openEdit}
        initialData={selectedRow}
        lists={lists}
        onClose={() => {
          setOpenEdit(false);
          setSelectedRow(null);
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
        }}
        onToast={showToast}
        onSubmit={apiPostSave}
        onSaved={async () => {
          setOpenEdit(false);
          setSelectedRow(null);
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
          await reloadVista();
          await refreshPeriodos();
          showToast("exito", "Egreso actualizado correctamente.", 2600);
        }}
      />

      <ModalPagarOtrosEgresos
        open={openPagar}
        row={selectedRow}
        lists={lists}
        onClose={handleClosePagar}
        onToast={showToast}
        onOpenDetalle={handleOpenMediosPago}
        detalleEgresoOpen={openMediosPago}
        onSaved={async () => {
          setOpenPagar(false);
          setSelectedRow(null);
          await reloadVista();
          await refreshPeriodos();
        }}
      />

      <ModalDetalleMovimientoEgreso
        open={openMediosPago}
        row={selectedMediosRow}
        onClose={handleCloseMediosPago}
      />

      <ModalEliminar
        open={openDelete}
        row={rowToDelete}
        onClose={handleCloseDeleteModal}
        onConfirm={handleConfirmDelete}
        onToast={showToast}
        title="Eliminar egreso"
        message="¿Seguro que querés eliminar este egreso definitivamente?"
        warning="Esta acción no se puede deshacer."
        loading={!!deletingId}
        loadingMessage="Eliminando egreso…"
        successMessage="Egreso eliminado."
        errorMessage="No se pudo eliminar el egreso."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        details={[
          {
            label: "ID Movimiento",
            value: rowToDelete?.id_movimiento ? `#${rowToDelete.id_movimiento}` : "—",
          },
          {
            label: "Tipo",
            value:
              rowToDelete?.tipo_movimiento ||
              rowToDelete?.tipo ||
              rowToDelete?.categoria ||
              "EGRESO",
          },
          {
            label: "Concepto",
            value:
              getDepositoChequeLabel(rowToDelete) ||
              rowToDelete?.detalle ||
              rowToDelete?.descripcion ||
              rowToDelete?.concepto ||
              "—",
          },
          {
            label: "Monto",
            value: moneyARS(
              rowToDelete?.monto_total ??
                rowToDelete?.total ??
                rowToDelete?.total_general ??
                0
            ),
          },
        ]}
      />

      <ModalVerComprobante
        open={openViewComprobante}
        url={comprobanteView.url}
        mime={comprobanteView.mime}
        title={comprobanteView.title}
        onClose={closeComprobanteModal}
      />
    </div>
  );
}
