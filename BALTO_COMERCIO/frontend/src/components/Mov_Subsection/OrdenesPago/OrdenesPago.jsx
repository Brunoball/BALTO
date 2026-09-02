import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BASE_URL from "../../../config/config.jsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";

import ModalPagarOrdenesPago from "./modales/ModalPagarOrdenesPago.jsx";
import ModalEditarOrdenPago from "./modales/ModalEditarOrdenPago.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalDetalleMovimiento from "../../Global/Modales/ModalDetalleMovimiento.jsx";

import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";


import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";

import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faMagnifyingGlass,
  faFileExcel,
  faPenToSquare,
  faMoneyBill1Wave,
  faChevronDown,
  faArrowRightLong,
  faBoxOpen,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";

import * as XLSX from "xlsx";
import { useListas } from "../../../context/ListasContext.jsx";
import { useDateRange } from "../../../context/DateRangeContext.jsx";
import { getResumenProductosMovimiento } from "../_shared/detalleMovimiento.js";
import { apiGet, apiPostJson, getAuthInfo, buildHeadersGET, ordenesPagoFetch } from "./api/ordenesPagoApi.js";
import useOrdenesPagoToast from "./hooks/useOrdenesPagoToast.js";
import { moneyARS, safeText, normalizeSearchText, formatFechaDMY, startOfDay, parseRowFecha, dateToAPI, todayISO, formatDateUI, rowInDateRange, slugifySheetName, escapeCSV, downloadBlob } from "./utils/ordenesPagoUtils.js";


/* =========================
   PERF
========================= */
const PAGE_SIZE = 100;
const SKELETON_ROWS = 10;
const FORCE_SHOW_LOADER_DEV = false;
function productosLabel(row) {
  return getResumenProductosMovimiento(row);
}

function getMontoTotalRow(row) {
  const n = Number(row?.monto_total ?? row?.total ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getCobradoTotalRow(row) {
  const n = Number(
    row?.cobrado_total ??
      row?.monto_cobrado ??
      row?.total_cobrado ??
      row?.pagado_total ??
      0
  );
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getSaldoPendienteRow(row) {
  const explicitKeys = [
    "saldo_pendiente",
    "saldo_restante",
    "monto_pendiente",
    "pendiente",
    "saldo",
  ];

  for (const key of explicitKeys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  }

  const total = getMontoTotalRow(row);
  const cobrado = getCobradoTotalRow(row);
  if (total > 0 || cobrado > 0) return Math.max(0, total - cobrado);
  if (row?.pagado === true || Number(row?.pagado ?? 0) === 1) return 0;
  return total;
}

function isPagadoRow(row) {
  return getSaldoPendienteRow(row) <= 0.009;
}

function isParcialRow(row) {
  return !isPagadoRow(row) && getCobradoTotalRow(row) > 0.009;
}

function getEstadoOrdenPagoLabel(row) {
  if (isPagadoRow(row)) return "PAGADO";
  if (isParcialRow(row)) return "PENDIENTE PARCIAL";
  return "PENDIENTE";
}

function getEstadoOrdenPagoChipClass(row) {
  if (isPagadoRow(row)) return "mov-chip mov-chip--ok";
  if (isParcialRow(row)) return "mov-chip mov-chip--warn mov-chip--partial";
  return "mov-chip mov-chip--warn";
}

/* =========================
   ORDENES PAGO = COMPRAS CC
========================= */
const ID_TIPO_OPERACION_COMPRA = 2;
const ID_TIPO_VENTA_CUENTA_CORRIENTE = 2;

function isCompraCuentaCorriente(row) {
  const op = Number(row?.id_tipo_operacion ?? row?.idTipoOperacion ?? 0);
  const tv = Number(row?.id_tipo_venta ?? row?.idTipoVenta ?? 0);
  return op === ID_TIPO_OPERACION_COMPRA && tv === ID_TIPO_VENTA_CUENTA_CORRIENTE;
}

function isPagado(row) {
  return isPagadoRow(row);
}

/* =========================
   Full-text match
========================= */
function rowMatchesQuery(row, query) {
  const qq = normalizeSearchText(query);
  if (!qq) return true;

  const montoNum = Number(row?.monto_total || row?.total || 0);

  const parts = [];
  if (row && typeof row === "object") {
    for (const k of Object.keys(row)) {
      const val = row[k];
      if (val && typeof val === "object") continue;
      parts.push(String(val ?? ""));
    }
  }

  parts.push(formatFechaDMY(row?.fecha));
  parts.push(String(montoNum), String(Math.trunc(montoNum)), moneyARS(montoNum));

  const hay = normalizeSearchText(parts.join(" | "));
  return hay.includes(qq);
}

function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: safeText(formatFechaDMY(r?.fecha)),
    DESCRIPCION: productosLabel(r),
    PROVEEDOR: safeText(r?.proveedor),
    ESTADO: getEstadoOrdenPagoLabel(r),
    MONTO: getSaldoPendienteRow(r),
  }));
}

export default function OrdenesPago() {
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
  const [showCalendario, setShowCalendario] = useState(false);

  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  const searchInputRef = useRef(null);

  useEffect(() => {
    rowsRef.current = Array.isArray(rows) ? rows : [];
  }, [rows]);

  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");

  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(null);

  const { toast, showToast, closeToast } = useOrdenesPagoToast();

  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);
  const rowsReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const skipSearchRef = useRef(false);
  const didInitRef = useRef(false);

  const showSkeleton = loadingRows;

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  /* =========================
     GET COMPROBANTE SIGNED URL
  ========================= */
  const getOrdenPagoSignedUrl = useCallback(async (idComprobante) => {
    const id = Number(idComprobante || 0);
    if (!id) return "";

    const sp = new URLSearchParams();
    sp.set("action", "ordenes_pago_comprobante_descargar");
    sp.set("id_comprobante", String(id));

    const res = await ordenesPagoFetch(`${BASE_URL}/api.php?${sp.toString()}`, {
      method: "GET",
      headers: buildHeadersGET(),
    });

    const text = await res.text();
    if (!text) throw new Error("Respuesta vacía del servidor.");

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Respuesta inválida al obtener comprobante.");
    }

    if (!res.ok || !data?.exito) {
      throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
    }

    return String(data?.url || "").trim();
  }, [buildHeadersGET]);

  /* =========================
     LOAD ROWS
  ========================= */
  const loadRows = useCallback(
    async (opts = {}) => {
      const fromDate = opts.from !== undefined ? opts.from : dateRange?.from;
      const toDate = opts.to !== undefined ? opts.to : dateRange?.to;
      const qLocal = typeof opts.q === "string" ? opts.q : q;
      const append = !!opts.append;
      const offset = Number.isFinite(Number(opts.offset)) ? Number(opts.offset) : 0;

      const fromAPI = dateToAPI(fromDate);
      const toAPI = dateToAPI(toDate);
      const qKey = (qLocal || "").trim();
      const cacheKey = `${fromAPI}|${toAPI}|${qKey}`;

      const PROBE_LIMIT = PAGE_SIZE + 1;
      const myReqId = ++reqIdRef.current;

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
        sp.set("action", "ordenes_pago_listar");
        if (fromAPI) sp.set("fecha_desde", fromAPI);
        if (toAPI) sp.set("fecha_hasta", toAPI);
        if (qKey) sp.set("q", qKey);
        sp.set("limit", String(PROBE_LIMIT));
        sp.set("offset", String(offset));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar órdenes de pago.");

        if (myReqId !== reqIdRef.current) return null;

        const listKey = Array.isArray(data.movimientos)
          ? "movimientos"
          : Array.isArray(data.ordenes)
          ? "ordenes"
          : "movimientos";

        const rawArr = Array.isArray(data[listKey]) ? data[listKey] : [];

        const norm = rawArr.map((r) => ({
          ...r,
          pagado: isPagadoRow(r) ? 1 : 0,
          saldo_pendiente: getSaldoPendienteRow(r),
        }));

        let newHasMore = data.has_more !== undefined ? !!data.has_more : norm.length > PAGE_SIZE;
        let newNextOffset =
          data.next_offset !== undefined && data.next_offset !== null
            ? Number(data.next_offset)
            : newHasMore
            ? offset + PAGE_SIZE
            : null;

        const page = newHasMore ? norm.slice(0, PAGE_SIZE) : norm;

        if (myReqId !== reqIdRef.current) return null;

        if (append) {
          const base = Array.isArray(rowsRef.current) ? rowsRef.current : [];
          const seen = new Set(base.map((x) => String(x?.id_movimiento ?? "")));
          const add = page.filter((x) => {
            const k = String(x?.id_movimiento ?? "");
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
            cacheRef.current.set(cacheKey, {
              rows: page,
              hasMore: newHasMore,
              nextOffset: newNextOffset,
            });
          }

          if (rowsReqIdRef.current === myReqId) setLoadingRows(false);
        }

        return {
          hasMore: newHasMore,
          nextOffset: newNextOffset,
          received: page.length,
        };
      } catch (e) {
        if (myReqId !== reqIdRef.current) return null;

        setError(e.message || "Error cargando órdenes de pago.");

        if (append) {
          if (moreReqIdRef.current === myReqId) setLoadingMore(false);
        } else {
          if (rowsReqIdRef.current === myReqId) setLoadingRows(false);
        }

        return null;
      }
    },
    [API, apiGet, dateRange, q]
  );

  /* =========================
     INIT
  ========================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureListsLoaded({ force: false, background: true });
      } catch {}
      if (!alive) return;
      await loadRows({ from: dateRange?.from, to: dateRange?.to, q: "", offset: 0, append: false });
      didInitRef.current = true;
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* =========================
     Refresco cuando cambia rango global
  ========================= */
  useEffect(() => {
    if (!didInitRef.current) return;

    cacheRef.current.clear();
    skipSearchRef.current = true;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    loadRows({ from: dateRange?.from, to: dateRange?.to, q, offset: 0, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange?.from?.getTime?.(), dateRange?.to?.getTime?.()]);

  /* =========================
     Debounce búsqueda
  ========================= */
  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(() => {
      loadRows({ from: dateRange?.from, to: dateRange?.to, q, offset: 0, append: false });
    }, 250);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  /* =========================
     Handler cambio de rango
  ========================= */
  const handleDateRangeChange = useCallback(
    async (newRange) => {
      if (!newRange?.from && !newRange?.to) return;

      setDateRange(newRange);
      cacheRef.current.clear();
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
    [loadRows, q, setDateRange]
  );

  /* =========================
     Filtrado client-side
  ========================= */
  const filteredRows = useMemo(() => {
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => isCompraCuentaCorriente(r))
      .filter((r) => !isPagado(r))
      .filter((r) => rowInDateRange(r, dateRange?.from, dateRange?.to))
      .filter((r) => rowMatchesQuery(r, q));
  }, [rows, dateRange, q]);

  /* =========================
     Label calendario
  ========================= */
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

  /* =========================
     Export base name
  ========================= */
  const exportBaseName = useMemo(() => {
    const { from, to } = dateRange;
    if (from && to) return `ordenes_pago_pendientes_${dateToAPI(from)}_${dateToAPI(to)}`;
    if (from) return `ordenes_pago_pendientes_desde_${dateToAPI(from)}`;
    return "ordenes_pago_pendientes";
  }, [dateRange]);

  /* =========================
     Export helpers
  ========================= */
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
    const montoColIndex = headers.findIndex((h) => h === "MONTO");

    if (montoColIndex >= 0 && ws["!ref"]) {
      const colLetter = XLSX.utils.encode_col(montoColIndex);
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[`${colLetter}${r + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("OrdenesPago_Pendientes"));
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
  }, [getExportData, exportBaseName]);

  const exportToCSV = useCallback(() => {
    const dataToExport = getExportData();
    const headers = Object.keys(dataToExport[0] || {});
    const lines = [
      headers.join(";"),
      ...dataToExport.map((row) => headers.map((h) => escapeCSV(row[h])).join(";")),
    ];
    downloadBlob("\uFEFF" + lines.join("\n"), `${exportBaseName}.csv`, "text/csv;charset=utf-8;");
  }, [getExportData, exportBaseName]);

  const exportToTXT = useCallback(() => {
    const dataToExport = getExportData();
    const lines = dataToExport.map((row, index) =>
      [
        `REGISTRO ${index + 1}`,
        `FECHA: ${row.FECHA ?? ""}`,
        `DESCRIPCION: ${row.DESCRIPCION ?? ""}`,
        `PROVEEDOR: ${row.PROVEEDOR ?? ""}`,
        `ESTADO: ${row.ESTADO ?? ""}`,
        `MONTO: ${row.MONTO ?? ""}`,
        "----------------------------------------",
      ].join("\n")
    );
    downloadBlob(lines.join("\n"), `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
  }, [getExportData, exportBaseName]);

  const handleExport = useCallback(
    async (type) => {
      try {
        if (hasMore) {
          showToast(
            "error",
            'Todavía hay más registros sin cargar. Tocá "Cargar 100 más" hasta completar todo.');
          return;
        }

        if (type === "excel") {
          exportToExcel();
          showToast("exito", "Excel exportado.");
          return;
        }

        if (type === "csv") {
          exportToCSV();
          showToast("exito", "CSV exportado.");
          return;
        }

        if (type === "txt") {
          exportToTXT();
          showToast("exito", "TXT exportado.");
        }
      } catch (e) {
        showToast("error", e?.message || "Error exportando archivo.");
      }
    },
    [hasMore, exportToExcel, exportToCSV, exportToTXT, showToast]
  );

  const exportOptions = useMemo(
    () => [
      { key: "excel", label: "Exportar Excel (.xlsx)", icon: faFileExcel, onClick: () => handleExport("excel") },
      { key: "csv", label: "Exportar CSV (.csv)", onClick: () => handleExport("csv") },
      { key: "txt", label: "Exportar TXT (.txt)", onClick: () => handleExport("txt") },
    ],
    [handleExport]
  );

  /* =========================
     Cargar 100 más
  ========================= */
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loadingRows || loadingListsCtx) return;
    if (nextOffset === null) return;

    showToast("cargando", "Cargando registros...");

    try {
      const res = await loadRows({
        from: dateRange?.from,
        to: dateRange?.to,
        q: (q || "").trim(),
        offset: nextOffset,
        append: true,
      });

      if (!res) {
        showToast("error", "No se pudieron cargar más órdenes de pago.");
        return;
      }

      showToast("exito", `${res.received || PAGE_SIZE} registros más cargados.`);
    } catch (e) {
      showToast("error", e?.message || "Error cargando más órdenes.");
    }
  }, [hasMore, loadingMore, loadingRows, loadingListsCtx, nextOffset, dateRange, q, loadRows, showToast]);

  /* =========================
     Modales Pagar / Editar / Ver Comprobante
  ========================= */
  const [openPagar, setOpenPagar] = useState(false);
  const [pagarProveedor, setPagarProveedor] = useState(null);
  const [pagarDeudas, setPagarDeudas] = useState([]);

  const closePagarModal = useCallback(() => {
    setOpenPagar(false);
    setPagarProveedor(null);
    setPagarDeudas([]);
  }, []);

  const getDeudasProveedor = useCallback(
    (rowProv) => {
      const idProv = Number(rowProv?.id_proveedor || rowProv?.proveedor_id || 0);
      const nombreProv = String(rowProv?.proveedor || "").trim();

      return (rows || []).filter((r) => {
        const rid = Number(r?.id_proveedor || r?.proveedor_id || 0);
        const rnom = String(r?.proveedor || "").trim();

        return (
          ((idProv > 0 && rid === idProv) ||
            (!idProv && nombreProv && rnom.toLowerCase() === nombreProv.toLowerCase())) &&
          isCompraCuentaCorriente(r) &&
          !isPagado(r)
        );
      });
    },
    [rows]
  );

  const openPagarModal = useCallback(
    (r) => {
      setPagarProveedor(r);
      setPagarDeudas(getDeudasProveedor(r));
      setOpenPagar(true);
    },
    [getDeudasProveedor]
  );

  const [openEditar, setOpenEditar] = useState(false);
  const [editRow, setEditRow] = useState(null);

  const closeEditarModal = useCallback(() => {
    setOpenEditar(false);
    setEditRow(null);
  }, []);

  const openEditarModal = useCallback((r) => {
    setEditRow(r);
    setOpenEditar(true);
  }, []);

  const [openVerComprobante, setOpenVerComprobante] = useState(false);
  const [comprobanteUrl, setComprobanteUrl] = useState("");
  const [loadingComprobante, setLoadingComprobante] = useState(false);
  const [openDetalleMovimiento, setOpenDetalleMovimiento] = useState(false);
  const [detalleRow, setDetalleRow] = useState(null);

  const closeVerComprobanteModal = useCallback(() => {
    setOpenVerComprobante(false);
    setComprobanteUrl("");
    setLoadingComprobante(false);
  }, []);

  const openVerComprobanteModal = useCallback(async (idComprobante) => {
    if (!idComprobante) {
      showToast("error", "No hay comprobante asociado a esta orden.");
      return;
    }

    setLoadingComprobante(true);
    setOpenVerComprobante(true);

    try {
      const signedUrl = await getOrdenPagoSignedUrl(idComprobante);
      if (!signedUrl) {
        throw new Error("No se pudo obtener el comprobante.");
      }
      setComprobanteUrl(signedUrl);
    } catch (error) {
      showToast("error", error.message || "Error al cargar el comprobante.");
      setOpenVerComprobante(false);
    } finally {
      setLoadingComprobante(false);
    }
  }, [getOrdenPagoSignedUrl, showToast]);

  /* =========================
     Acciones backend
  ========================= */
  const refreshAfterMutation = useCallback(async () => {
    cacheRef.current.clear();

    await loadRows({
      from: dateRange?.from,
      to: dateRange?.to,
      q,
      offset: 0,
      append: false,
    });

    try {
      await refreshLists?.();
    } catch {}
  }, [dateRange, loadRows, q, refreshLists]);

  const applyPagoParcialToRows = useCallback((idsMovimiento, info = {}) => {
    const ids = Array.isArray(idsMovimiento)
      ? idsMovimiento.map((x) => Number(x || 0)).filter(Boolean)
      : [Number(idsMovimiento || 0)].filter(Boolean);

    if (!ids.length) return;

    let restante = Number(info?.montoPagado ?? info?.monto_pagado ?? info?.montoCobrado ?? info?.total ?? 0);
    if (!Number.isFinite(restante) || restante <= 0) return;

    cacheRef.current.clear();

    setRows((prev) => {
      const next = (Array.isArray(prev) ? prev : []).map((r) => {
        const idMov = Number(r?.id_movimiento || 0);
        if (!idMov || !ids.includes(idMov) || restante <= 0) return r;

        const saldoAntes = getSaldoPendienteRow(r);
        const aplicado = Math.min(saldoAntes, restante);
        restante = Math.max(0, restante - aplicado);

        const nuevoCobrado = getCobradoTotalRow(r) + aplicado;
        const nuevoSaldo = Math.max(0, getMontoTotalRow(r) - nuevoCobrado);

        return {
          ...r,
          cobrado_total: nuevoCobrado,
          saldo_pendiente: nuevoSaldo,
          pagado: nuevoSaldo <= 0.009 ? 1 : 0,
        };
      });

      rowsRef.current = next;
      return next;
    });
  }, []);

  /* =========================
     Al finalizar/cerrar orden
  ========================= */
  const onOrdenPagoFinalizado = useCallback(
    async () => {
      try {
        cacheRef.current.clear();
        skipSearchRef.current = true;

        const tasks = [
          loadRows({ from: dateRange?.from, to: dateRange?.to, q, offset: 0, append: false }),
          typeof refreshLists === "function" ? refreshLists() : Promise.resolve(),
        ];

        const [rowsRes, listsRes] = await Promise.allSettled(tasks);

        const rowsFailed = rowsRes.status === "rejected" || rowsRes.value === null;
        const listsFailed = listsRes.status === "rejected";

        if (rowsFailed || listsFailed) {
          showToast(
            "error",
            "La orden se guardó, pero no pude refrescar toda la pantalla automáticamente.");
          return;
        }

        showToast("exito", "Orden de pago guardada correctamente.");
      } catch (e) {
        showToast("error", e?.message || "La orden se guardó, pero no pude refrescar la lista.");
      }
    },
    [dateRange, q, loadRows, refreshLists, showToast]
  );

  /* =========================
     Confirmar pago (ACTUALIZADO)
  ========================= */
  const onConfirmPago = useCallback(
    async (payload) => {
      const ids =
        payload?.ids_movimiento ??
        payload?.ids_movimientos ??
        payload?.seleccion?.map((x) => Number(x?.id_movimiento || 0)).filter(Boolean) ??
        [];

      const { idUsuario, idUsuarioMaster } = getAuthInfo();

      const mediosPagoPayload = Array.isArray(payload?.medios_pago)
        ? payload.medios_pago
        : [];

      const primaryMedioId = mediosPagoPayload[0]?.id_medio_pago || Number(payload?.id_medio_pago || 0);

      const data = await apiPostJson(`${API}?action=ordenes_pago_confirmar_pago`, {
        ids_movimiento: ids,
        medios_pago: mediosPagoPayload,
        id_medio_pago: primaryMedioId,
        fecha_cobro: payload?.fecha_cobro || payload?.fecha_pago || payload?.fecha || todayISO(),
        fecha_pago: payload?.fecha_pago || payload?.fecha_cobro || payload?.fecha || todayISO(),
        fecha: payload?.fecha || payload?.fecha_cobro || payload?.fecha_pago || todayISO(),
        idUsuario,
        idUsuarioMaster: idUsuarioMaster || idUsuario,
      });

      if (!data?.exito) {
        throw new Error(data?.mensaje || "No se pudo confirmar el pago.");
      }

      return data;
    },
    [API, apiPostJson]
  );

  /* =========================
     Guardar edición (ACTUALIZADO)
  ========================= */
  const onSaveEditar = useCallback(
    async (payloadFinal) => {
      try {
        showToast("cargando", "Guardando cambios…");

        const { idUsuario, idUsuarioMaster } = getAuthInfo();
        const data = await apiPostJson(`${API}?action=ordenes_pago_actualizar`, {
          ...payloadFinal,
          idUsuario,
          idUsuarioMaster: idUsuarioMaster || idUsuario,
        });

        if (!data?.exito) throw new Error(data?.mensaje || "No se pudo guardar la orden de pago.");

        await refreshAfterMutation();
        showToast("exito", data?.mensaje || "Orden de pago actualizada.");

        return data;
      } catch (e) {
        showToast("error", e?.message || "Error guardando orden de pago.");
        throw e;
      }
    },
    [API, apiPostJson, refreshAfterMutation, showToast]
  );

  /* =========================
     Columnas / grilla
  ========================= */
  const columns = useMemo(
    () => [
      { key: "fecha", label: "FECHA", align: "center", fr: .9, render: (r) => safeText(formatFechaDMY(r.fecha)) },
      {
        key: "detalle",
        label: "DESCRIPCIÓN",
        fr: 2.5,
        strong: true,
        align: "left",
        render: (r) => productosLabel(r),
      },
      { key: "proveedor", label: "PROVEEDOR", fr: 1.9, align: "center", render: (r) => safeText(r.proveedor) },
      {
        key: "estado",
        label: "ESTADO",
        align: "center",
        fr: 1.5,
        render: (r) => <span className={getEstadoOrdenPagoChipClass(r)}>{getEstadoOrdenPagoLabel(r)}</span>,
      },
      { key: "monto", label: "SALDO", fr: 1.2, align: "right", render: (r) => moneyARS(getSaldoPendienteRow(r)) },
      { key: "acciones", label: "ACCIONES", fr: 1, align: "center", render: () => null },
    ],
    []
  );

  const gridCols = useMemo(() => {
    const fallback = `repeat(${columns.length}, minmax(0, 1fr))`;
    if (!columns.length) return fallback;

    return columns
      .map((c) => {
        const n = Number(c.fr);
        return Number.isFinite(n) && n > 0 ? `${n}fr` : "1fr";
      })
      .join(" ");
  }, [columns]);

  const skelWidths = useMemo(
    () => ({
      fecha: ["44%", "38%", "50%", "42%"],
      detalle: ["72%", "58%", "66%", "48%"],
      proveedor: ["62%", "54%", "46%", "58%"],
      estado: ["52%", "44%", "58%", "50%"],
      monto: ["38%", "30%", "34%", "28%"],
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
            <div key={c.key} className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label={c.label}>
              <div className="mov-skelActions">
                <span className="mov-skelIcon" />
                <span className="mov-skelIcon" />
              </div>
            </div>
          );
        }

        const w = (skelWidths[c.key] || ["60%"])[idx % (skelWidths[c.key]?.length || 1)];

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

  const isAnyLoading = loadingRows || loadingMore;
  const lists = listasCtx || {
    periodos: [],
    clientes: [],
    medios_pago: [],
    tipos_venta: [],
    clasificaciones: [],
    cuentas_corrientes: [],
    detalles: [],
    proveedores: [],
    tipos_movimiento: [],
  };

  return (
    <div className="mov-page mov-page--ordenesPago">
      {toast && (
        <Toast
          key={toast.id}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          onClose={closeToast}
        />
      )}

      {errorListsCtx && (
        <div className="mov-alert" role="alert">
          {errorListsCtx}
        </div>
      )}

      {error && (
        <div className="mov-alert" role="alert">
          {error}
        </div>
      )}

      <section className="mov-card mov-card--table">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov">
              <div className="mov-card__title">Movs · Órdenes de Pago</div>
              <div className="mov-card__hint">
                Mostrando <b>{filteredRows.length}</b>
                {hasMore && filteredRows.length > 0 ? " (hay más por cargar)" : ""}
              </div>
            </div>

            <div className="mov-headFilters">
              <div className="mov-filter mov-filter--cal floatingField">
                <button
                  type="button"
                  className={`mov-calTrigger cc-calTrigger ${showCalendario ? "is-open" : ""}`}
                  onClick={() => setShowCalendario((v) => !v)}
                  disabled={isAnyLoading || loadingListsCtx}
                  title="Seleccionar rango de fechas"
                >
                  {dateRangeLabel}
                  <span className="mov-calTrigger__arrow">
                    <FontAwesomeIcon icon={faChevronDown} />
                  </span>
                </button>

                <span className="floatingLabel floatingLabel--active">
                  <FontAwesomeIcon icon={faCalendarDays} /> Período
                </span>

                {showCalendario && (
                  <div className="mov-calDropdown">
                    <Calendario
                      value={dateRange}
                      onChange={async (newRange) => {
                        if (newRange?.from && newRange?.to) setShowCalendario(false);
                        await handleDateRangeChange(newRange);
                      }}
                      onClose={() => setShowCalendario(false)}
                    />
                  </div>
                )}
              </div>

              <div className="mov-search floatingField floatingField--search is-active">
                <div className="mov-searchInput">
                  <input
                    ref={searchInputRef}
                    className="mov-input--floating"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                        skipSearchRef.current = true;
                        await loadRows({
                          from: dateRange?.from,
                          to: dateRange?.to,
                          q: e.currentTarget.value,
                          offset: 0,
                          append: false,
                        });
                      }
                    }}
                    placeholder="Buscar por descripción, proveedor..."
                    disabled={loadingListsCtx || loadingMore}
                  />

                  <span className="floatingLabel">
                    <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                  </span>

                  {q.trim() !== "" && (
                    <button
                      type="button"
                      className="mov-clearSearch clearSearch--inside"
                      title="Limpiar búsqueda"
                      onClick={async () => {
                        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                        setQ("");
                        skipSearchRef.current = true;
                        await loadRows({
                          from: dateRange?.from,
                          to: dateRange?.to,
                          q: "",
                          offset: 0,
                          append: false,
                        });
                        searchInputRef.current?.focus();
                      }}
                      disabled={loadingMore}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mov-card__actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <BotonExportar
              disabled={loadingRows || filteredRows.length === 0}
              loading={false}
              label="Exportar"
              title={filteredRows.length ? "Exportar archivo" : "No hay datos para exportar"}
              opciones={exportOptions}
              align="right"
            />
          </div>
        </div>

        <div className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`} style={{ gridTemplateColumns: gridCols }} role="row">
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
          <div className={["mov-gridBody", "mov-gridBody--relative", showSkeleton ? "mov-softLoading" : ""].join(" ")}>
            {showSkeleton ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
              </div>
            ) : (
              <>
                {filteredRows.map((r) => (
                  <div
                    key={r.id_movimiento}
                    className="mov-gridTable mov-gridTable--row"
                    style={{ gridTemplateColumns: gridCols }}
                    role="row"
                    data-movement-id={Number(r?.id_movimiento || 0) || undefined}
                  >
                    {columns.map((c) => {
                      if (c.key === "acciones") {
                        return (
                          <div
                            key={c.key}
                            data-label={c.label}
                            className={["mov-gridCell", "mov-gridCell--actions", "is-center"].join(" ")}
                            role="cell"
                          >
                            <div className="mov-actionsInline">
                              <button
                                type="button"
                                className="mov-iconBtn"
                                title="Ver detalle de la deuda"
                                onClick={() => {
                                  setDetalleRow(r);
                                  setOpenDetalleMovimiento(true);
                                }}
                                disabled={isAnyLoading || loadingListsCtx}
                              >
                                <FontAwesomeIcon icon={faInfoCircle} />
                              </button>

                              <button
                                type="button"
                                className="mov-iconBtn"
                                title="Pagar"
                                onClick={() => openPagarModal(r)}
                                disabled={isAnyLoading || loadingListsCtx}
                              >
                                <FontAwesomeIcon icon={faMoneyBill1Wave} />
                              </button>

                              <button
                                type="button"
                                className="mov-iconBtn"
                                title="Editar"
                                onClick={() => openEditarModal(r)}
                                disabled={isAnyLoading || loadingListsCtx}
                              >
                                <FontAwesomeIcon icon={faPenToSquare} />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      const val = c.render ? c.render(r) : safeText(r[c.key]);

                      return (
                        <div
                          key={c.key}
                          data-label={c.label}
                          className={[
                            "mov-gridCell",
                            c.align === "right" ? "is-right" : "",
                            c.align === "center" ? "is-center" : "",
                            c.strong ? "is-strong" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          role="cell"
                          title={typeof val === "string" ? val : undefined}
                        >
                          <span className="mov-ellipsissss">{val}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {!isAnyLoading && filteredRows.length === 0 && (
                  <div className="cc-emptyState">
                    <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                    <div className="cc-emptyText">
                      {q.trim()
                        ? `No se encontraron órdenes de pago para "${q.trim()}".`
                        : "No hay órdenes de pago pendientes para mostrar en el rango de fechas seleccionado."}
                    </div>
                  </div>
                )}

                {!loadingRows && hasMore && filteredRows.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
                    <button
                      type="button"
                      className="mov-btn mov-btn--loadAll"
                      onClick={handleLoadMore}
                      disabled={loadingMore || loadingListsCtx}
                      title="Cargar los próximos 100 registros"
                    >
                      {loadingMore ? "Cargando…" : "Cargar 100 más"}
                    </button>
                  </div>
                )}

                {loadingMore && (
                  <div className="mov-skeletonMore" aria-busy="true" aria-label="Cargando más registros">
                    {Array.from({ length: 6 }).map((_, i) => renderSkeletonRow(i))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <ModalDetalleMovimiento
        open={openDetalleMovimiento}
        row={detalleRow}
        title="Detalle de deuda a pagar"
        onClose={() => {
          setOpenDetalleMovimiento(false);
          setDetalleRow(null);
        }}
      />

      <ModalPagarOrdenesPago
        open={openPagar}
        onClose={closePagarModal}
        proveedor={pagarProveedor}
        deudas={pagarDeudas}
        onToast={showToast}
        onConfirm={onConfirmPago}
        lists={lists}
        onOrdenPagoFinalizado={onOrdenPagoFinalizado}
        onAfterPaid={applyPagoParcialToRows}
      />

      <ModalEditarOrdenPago
        open={openEditar}
        row={editRow}
        lists={lists}
        periodoDefault={
          dateRange?.from
            ? `${String(dateRange.from.getMonth() + 1).padStart(2, "0")}-${dateRange.from.getFullYear()}`
            : ""
        }
        onClose={closeEditarModal}
        onToast={showToast}
        onSave={onSaveEditar}
      />

      <ModalVerComprobante
        open={openVerComprobante}
        onClose={closeVerComprobanteModal}
        url={comprobanteUrl}
        loading={loadingComprobante}
      />
    </div>
  );
}
