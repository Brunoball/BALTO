import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BASE_URL from "../../../config/config.jsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";
import "./RecibosResponsive.css";

import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";

import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";


import ModalEditarRecibo from "./modales/ModalEditarRecibo.jsx";
import ModalPagarRecibos from "./modales/ModalPagarRecibos.jsx";
import ModalDetalleMovimiento from "../../Global/Modales/ModalDetalleMovimiento.jsx";

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
import { apiGet, apiPostJson, getAuthInfo } from "./api/recibosApi.js";
import useRecibosToast from "./hooks/useRecibosToast.js";
import { moneyARS, safeText, formatFechaDMY, dateToAPI, todayISO, formatDateUI, slugifySheetName, escapeCSV, downloadBlob, isAccionNoValidaErrorMessage } from "./utils/recibosUtils.js";


/* =========================
   PERF
========================= */
const PAGE_SIZE = 100;
const PROBE_LIMIT = PAGE_SIZE + 1;
const MIN_LOADING_MS = 0;
const FORCE_SHOW_LOADER_DEV = false;
const SKELETON_ROWS = 10;

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
  if (row?.pagado === true) return 0;
  return total;
}

function isPagadoRow(row) {
  return getSaldoPendienteRow(row) <= 0.009;
}

function isParcialRow(row) {
  return !isPagadoRow(row) && getCobradoTotalRow(row) > 0.009;
}

function getEstadoReciboLabel(row) {
  if (isPagadoRow(row)) return "PAGADO";
  if (isParcialRow(row)) return "PENDIENTE PARCIAL";
  return "PENDIENTE";
}

function getEstadoReciboChipClass(row) {
  if (isPagadoRow(row)) return "mov-chip mov-chip--ok";
  if (isParcialRow(row)) return "mov-chip mov-chip--warn mov-chip--partial";
  return "mov-chip mov-chip--warn";
}

function getMontoVisibleRecibo(row) {
  return getSaldoPendienteRow(row);
}
function productosLabel(row) {
  return getResumenProductosMovimiento(row);
}

function enriquecerDeudaConRowCompleta(deuda, rowCompleta) {
  const idDeuda = Number(deuda?.id_movimiento || 0);
  const idCompleta = Number(rowCompleta?.id_movimiento || 0);
  if (!idDeuda || !idCompleta || idDeuda !== idCompleta) return deuda;

  const itemsDeuda = Array.isArray(deuda?.items_detalle) ? deuda.items_detalle : [];
  const itemsCompleta = Array.isArray(rowCompleta?.items_detalle) ? rowCompleta.items_detalle : [];
  const usarItemsCompletos = itemsCompleta.length > itemsDeuda.length;
  const itemsFinales = usarItemsCompletos ? itemsCompleta : itemsDeuda;

  return {
    ...rowCompleta,
    ...deuda,
    items_detalle: itemsFinales,
    cantidad_items:
      Number(deuda?.cantidad_items || 0) > 0
        ? Number(deuda.cantidad_items)
        : Number(rowCompleta?.cantidad_items || itemsFinales.length || 0),
    detalle:
      Number(deuda?.cantidad_items || itemsFinales.length || 0) > 0
        ? productosLabel({ ...deuda, items_detalle: itemsFinales })
        : deuda?.detalle || rowCompleta?.detalle,
    detalle_original: deuda?.detalle_original || rowCompleta?.detalle_original,
    tipo_venta: deuda?.tipo_venta || rowCompleta?.tipo_venta,
    pago_tipo_venta: deuda?.pago_tipo_venta || rowCompleta?.pago_tipo_venta,
    clasificacion: deuda?.clasificacion || rowCompleta?.clasificacion,
    medios_pago_detalle: Array.isArray(deuda?.medios_pago_detalle)
      ? deuda.medios_pago_detalle
      : rowCompleta?.medios_pago_detalle,
    cantidad_medios_pago:
      Number(deuda?.cantidad_medios_pago || 0) > 0
        ? Number(deuda.cantidad_medios_pago)
        : Number(rowCompleta?.cantidad_medios_pago || 0),
  };
}

/* =========================
   Row key robusto
========================= */
function getRowKey(r) {
  const id = Number(r?.id_movimiento ?? 0);
  if (id > 0) return `id:${id}`;
  const f = String(r?.fecha ?? "").trim();
  const c = String(r?.cliente ?? "").trim();
  const d = String(r?.detalle ?? r?.descripcion ?? "").trim();
  const m = String(Number(r?.monto_total ?? r?.total ?? 0) || 0);
  return `fx:${f}|${c}|${d}|${m}`;
}

function buildExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    FECHA: safeText(formatFechaDMY(r?.fecha)),
    DESCRIPCION: productosLabel(r),
    CLIENTE: safeText(r?.cliente),
    ESTADO: getEstadoReciboLabel(r),
    SALDO: getMontoVisibleRecibo(r),
    MONTO_ORIGINAL: getMontoTotalRow(r),
    COBRADO: getCobradoTotalRow(r),
  }));
}

export default function Recibos() {
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

  const [openEdit, setOpenEdit] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  const [openPagar, setOpenPagar] = useState(false);
  const [pagarCliente, setPagarCliente] = useState(null);
  const [pagarDeudas, setPagarDeudas] = useState([]);
  const [openDetalleMovimiento, setOpenDetalleMovimiento] = useState(false);
  const [detalleRow, setDetalleRow] = useState(null);
  const [loadingClienteDeudas, setLoadingClienteDeudas] = useState(false);

  const { toast, showToast, closeToast } = useRecibosToast();

  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);
  const rowsReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const skipSearchRef = useRef(false);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  /* =========================
     Comprobante helpers
  ========================= */
  const applyComprobanteToRows = useCallback((idsMovimiento, idComprobante) => {
    const idComp = Number(idComprobante || 0);
    if (!idComp) return;

    const ids = Array.isArray(idsMovimiento)
      ? idsMovimiento.map((x) => Number(x || 0)).filter(Boolean)
      : [Number(idsMovimiento || 0)].filter(Boolean);

    if (!ids.length) return;

    setRows((prev) =>
      (Array.isArray(prev) ? prev : []).map((r) => {
        const idMov = Number(r?.id_movimiento || 0);
        if (!idMov || !ids.includes(idMov)) return r;
        return { ...r, id_comprobante: idComp };
      })
    );
  }, []);

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
        sp.set("action", "recibos_listar");
        if (fromAPI) sp.set("fecha_desde", fromAPI);
        if (toAPI) sp.set("fecha_hasta", toAPI);
        if (qKey) sp.set("q", qKey);
        sp.set("limit", String(PROBE_LIMIT));
        sp.set("offset", String(offset));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar recibos.");

        if (myReqId !== reqIdRef.current) return null;

        const rawArr = Array.isArray(data.movimientos) ? data.movimientos : [];

        let newHasMore =
          data.has_more !== undefined ? !!data.has_more : rawArr.length > PAGE_SIZE;

        let newNextOffset =
          data.next_offset !== undefined && data.next_offset !== null
            ? Number(data.next_offset)
            : newHasMore
            ? offset + PAGE_SIZE
            : null;

        const page = newHasMore ? rawArr.slice(0, PAGE_SIZE) : rawArr;
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
                cacheRef.current.set(cacheKey, {
                  rows: page,
                  hasMore: newHasMore,
                  nextOffset: newNextOffset,
                });
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

        return await new Promise((resolve) => {
          setTimeout(() => {
            if (myReqId !== reqIdRef.current) return resolve(null);

            setError(e.message || "Error cargando recibos.");

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
    })();
    return () => {
      alive = false;
    };
  }, [ensureListsLoaded, loadRows, dateRange?.from, dateRange?.to]);

  /* =========================
     Refresco cuando cambia rango global
  ========================= */
  const prevRangeKeyRef = useRef("");
  useEffect(() => {
    const k = `${dateToAPI(dateRange?.from)}|${dateToAPI(dateRange?.to)}`;
    if (!k || k === "||") return;

    if (prevRangeKeyRef.current === "") {
      prevRangeKeyRef.current = k;
      return;
    }

    if (prevRangeKeyRef.current !== k) {
      prevRangeKeyRef.current = k;
      cacheRef.current.clear();
      skipSearchRef.current = true;
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      loadRows({ from: dateRange?.from, to: dateRange?.to, q, offset: 0, append: false });
    }
  }, [dateRange?.from, dateRange?.to, loadRows, q]);

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
  }, [q, loadRows, dateRange?.from, dateRange?.to]);

  /* =========================
     Handler cambio de rango
  ========================= */
  const handleDateRangeChange = useCallback(
    async (newRange) => {
      if (!newRange.from && !newRange.to) return;
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
     Filtrado final
  ========================= */
  const filteredRows = useMemo(() => {
    return Array.isArray(rows) ? rows : [];
  }, [rows]);

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
    if (from && to) return `recibos_pendientes_${dateToAPI(from)}_${dateToAPI(to)}`;
    if (from) return `recibos_pendientes_desde_${dateToAPI(from)}`;
    return "recibos_pendientes";
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
    const montoColIndex = headers.findIndex((h) => h === "MONTO");

    if (montoColIndex >= 0 && ws["!ref"]) {
      const colLetter = XLSX.utils.encode_col(montoColIndex);
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cell = ws[`${colLetter}${r + 1}`];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("Recibos_Pendientes"));
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
        `CLIENTE: ${row.CLIENTE ?? ""}`,
        `ESTADO: ${row.ESTADO ?? ""}`,
        `MONTO: ${row.MONTO ?? ""}`,
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
          showToast(
            "error",
            'Todavía hay más registros sin cargar. Tocá "Cargar 100 más" hasta completar todo.'
          );
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

  const columns = useMemo(() => {
    return [
      {
        key: "fecha",
        label: "FECHA",
        align: "center",
        fr: .9,
        render: (r) => safeText(formatFechaDMY(r.fecha)),
      },
      {
        key: "detalle",
        label: "DESCRIPCION",
        fr: 2.7,
        strong: true,
        align: "left",
        render: (r) => productosLabel(r),
      },
      {
        key: "cliente",
        label: "CLIENTE",
        fr: 1.8,
        align: "center",
        render: (r) => safeText(r.cliente),
      },
      {
        key: "estado",
        label: "ESTADO",
        fr: 1.4,
        align: "center",
        render: (r) => <span className={getEstadoReciboChipClass(r)}>{getEstadoReciboLabel(r)}</span>,
      },
      {
        key: "monto",
        label: "SALDO",
        fr: 1.2,
        align: "right",
        render: (r) => moneyARS(getMontoVisibleRecibo(r)),
      },
      { key: "acciones", label: "ACCIONES", fr: 1, align: "center", render: () => null },
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

  /* =========================
     Fetch deudas del cliente
  ========================= */
  const fetchRecibosCliente = useCallback(
    async (rowCliente) => {
      const idCli = Number(rowCliente?.id_cliente || 0);
      if (!idCli) throw new Error("El registro no tiene id_cliente.");

      const ACTIONS = [
        "recibos_cliente_listar",
        "recibos_listar_cliente",
        "recibos_cliente",
        "recibos_listar_por_cliente",
      ];

      for (const action of ACTIONS) {
        try {
          const sp = new URLSearchParams();
          sp.set("action", action);
          sp.set("id_cliente", String(idCli));
          const data = await apiGet(`${API}?${sp.toString()}`);
          const movs = Array.isArray(data.movimientos) ? data.movimientos : [];
          return movs;
        } catch (e) {
          const msg = e?.message || "";
          if (isAccionNoValidaErrorMessage(msg)) continue;
          throw e;
        }
      }

      throw new Error(
        `Tu backend no tiene ninguna action de listar recibos por cliente.\nProbé: ${ACTIONS.join(", ")}.`
      );
    },
    [API, apiGet]
  );

  const openPagarModal = useCallback(
    async (r) => {
      try {
        setLoadingClienteDeudas(true);
        const deudas = await fetchRecibosCliente(r);
        const deudasCompletasBase = Array.isArray(deudas)
          ? deudas.map((d) => enriquecerDeudaConRowCompleta(d, r))
          : [];

        // Algunas respuestas del endpoint por cliente pueden venir paginadas o
        // desactualizadas respecto de la fila que el usuario acaba de abrir.
        // La deuda seleccionada siempre debe estar disponible dentro del modal.
        const idSeleccionado = Number(r?.id_movimiento || 0);
        const yaIncluida = idSeleccionado > 0 && deudasCompletasBase.some(
          (d) => Number(d?.id_movimiento || 0) === idSeleccionado
        );
        const deudasCompletas = idSeleccionado > 0 && !yaIncluida
          ? [enriquecerDeudaConRowCompleta(r, r), ...deudasCompletasBase]
          : deudasCompletasBase;

        setPagarCliente(r);
        setPagarDeudas(deudasCompletas);
        setOpenPagar(true);
      } catch (e) {
        showToast("error", e?.message || "No se pudieron cargar los registros del cliente.");
      } finally {
        setLoadingClienteDeudas(false);
      }
    },
    [fetchRecibosCliente, showToast]
  );

  const applyPagoParcialToRows = useCallback((idsMovimiento, info = {}) => {
    const ids = Array.isArray(idsMovimiento)
      ? idsMovimiento.map((x) => Number(x || 0)).filter(Boolean)
      : [Number(idsMovimiento || 0)].filter(Boolean);

    if (!ids.length) return;

    let restante = Number(info?.montoCobrado ?? info?.monto_cobrado ?? info?.total ?? 0);
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
          pagado: nuevoSaldo <= 0.009,
        };
      });

      rowsRef.current = next;
      return next;
    });
  }, []);

  /* =========================
     Finalización real
  ========================= */
  const onReciboFinalizado = useCallback(
    async (saved, fallback = {}) => {
      const idComp =
        Number(saved?.id_comprobante || saved?.idComprobante || saved?.comprobante_id || saved?.id || 0) ||
        Number(fallback?.idComprobante || 0) ||
        0;

      const ids =
        (Array.isArray(saved?.ids_movimiento) ? saved.ids_movimiento : null) ||
        (Array.isArray(fallback?.idsMovimiento) ? fallback.idsMovimiento : null) ||
        (Array.isArray(fallback?.ids_movimiento) ? fallback.ids_movimiento : null) ||
        null;

      if (idComp > 0 && ids && ids.length) {
        applyComprobanteToRows(ids, idComp);
      } else if (idComp > 0) {
        const idMov =
          Number(saved?.id_movimiento || saved?.idMovimiento || saved?.movimiento_id || 0) ||
          Number(fallback?.idMovimiento || 0) ||
          0;
        if (idMov > 0) applyComprobanteToRows([idMov], idComp);
      }

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
            "El recibo se guardó, pero no pude refrescar toda la pantalla automáticamente."
          );
          return;
        }

        showToast("exito", "Recibo guardado correctamente.");
      } catch (e) {
        showToast("error", e?.message || "El recibo se guardó, pero no pude refrescar la lista.");
      }
    },
    [applyComprobanteToRows, dateRange, q, loadRows, refreshLists, showToast]
  );

  /* =========================
     Confirmar pago — ahora soporta medios_pago[]
  ========================= */
  const onConfirmPago = useCallback(
    async (payload) => {
      const ids =
        payload?.ids_movimiento ??
        payload?.ids_movimientos ??
        payload?.seleccion?.map((x) => Number(x?.id_movimiento || 0)).filter(Boolean) ??
        [];

      const { idUsuario, idUsuarioMaster } = getAuthInfo();

      // Soporta tanto array de medios como medio único (backward compat)
      const mediosPagoArr = Array.isArray(payload?.medios_pago) && payload.medios_pago.length > 0
        ? payload.medios_pago
        : payload?.id_medio_pago
        ? [{ id_medio_pago: Number(payload.id_medio_pago), monto: payload?.totalSeleccionado || 0 }]
        : [];

      // Primer medio como primary (backward compat con backends que usan id_medio_pago simple)
      const primaryMedioId = mediosPagoArr[0]?.id_medio_pago || Number(payload?.id_medio_pago || 0);

      const data = await apiPostJson(`${API}?action=recibos_confirmar_pago`, {
        ids_movimiento: ids,
        medios_pago: mediosPagoArr,
        fecha_cobro: payload?.fecha_cobro || payload?.fecha_pago || payload?.fecha || todayISO(),
        fecha_pago: payload?.fecha_pago || payload?.fecha_cobro || payload?.fecha || todayISO(),
        fecha: payload?.fecha || payload?.fecha_cobro || payload?.fecha_pago || todayISO(),
        id_medio_pago: primaryMedioId,   // backward compat
        idUsuario,
        idUsuarioMaster: idUsuarioMaster || idUsuario,
      });

      if (!data?.exito) {
        throw new Error(data?.mensaje || "Error confirmando pago.");
      }

      return data;
    },
    [API, apiPostJson]
  );

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
        showToast("error", "No se pudieron cargar más registros.");
        return;
      }

      showToast("exito", `${res.received || PAGE_SIZE} registros más cargados.`);
    } catch (e) {
      showToast("error", e?.message || "Error cargando más registros.");
    }
  }, [
    hasMore,
    loadingMore,
    loadingRows,
    loadingListsCtx,
    nextOffset,
    dateRange,
    q,
    loadRows,
    showToast,
  ]);

  const isAnyLoading = loadingRows || loadingMore;

  const skelWidths = useMemo(
    () => ({
      fecha: ["46%", "38%", "42%", "34%"],
      detalle: ["72%", "58%", "66%", "48%"],
      cliente: ["62%", "54%", "46%", "58%"],
      estado: ["44%", "34%", "40%", "30%"],
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
    <div className="mov-page" data-section="recibos">
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
              <div className="mov-card__title">Movs · Recibos</div>
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
                        if (newRange.from && newRange.to) setShowCalendario(false);
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
                    placeholder="Buscar por descripción, cliente..."
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

        <div className="mov-tableWrap mov-table---Wrap" role="rowgroup" ref={tableWrapRef}>
          <div className={["mov-gridBody", "mov-gridBody--relative", loadingRows ? "mov-softLoading" : ""].join(" ")}>
            {loadingRows ? (
              <div className="mov-skeletonWrap" aria-busy="true">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
              </div>
            ) : (
              <>
                {filteredRows.map((r) => {
                  const key = getRowKey(r);

                  return (
                    <div
                      key={key}
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
                              className={["mov-gridCell", "mov-gridCell--actions", "is-center"].join(" ")}
                              role="cell"
                              data-label={c.label}
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
                                  disabled={isAnyLoading || loadingListsCtx || loadingClienteDeudas}
                                >
                                  <FontAwesomeIcon icon={faInfoCircle} />
                                </button>

                                <button
                                  type="button"
                                  className="mov-iconBtn"
                                  title="Cobrar"
                                  onClick={() => openPagarModal(r)}
                                  disabled={isAnyLoading || loadingListsCtx || loadingClienteDeudas}
                                >
                                  <FontAwesomeIcon icon={faMoneyBill1Wave} />
                                </button>

                                <button
                                  type="button"
                                  className="mov-iconBtn"
                                  title="Editar"
                                  onClick={() => {
                                    setSelectedRow(r);
                                    setOpenEdit(true);
                                  }}
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
                        ? `No se encontraron recibos para "${q.trim()}".`
                        : "No hay recibos pendientes para mostrar en el rango de fechas seleccionado."}
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
                      title="Cargar 100 registros más"
                    >
                      {loadingMore ? "Cargando..." : "Cargar 100 más"}
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
        title="Detalle de deuda a cobrar"
        onClose={() => {
          setOpenDetalleMovimiento(false);
          setDetalleRow(null);
        }}
      />

      <ModalPagarRecibos
        open={openPagar}
        onClose={() => {
          setOpenPagar(false);
          setPagarCliente(null);
          setPagarDeudas([]);
        }}
        onConfirm={onConfirmPago}
        onToast={showToast}
        cliente={pagarCliente}
        deudas={pagarDeudas}
        lists={lists}
        onReciboFinalizado={onReciboFinalizado}
        onAfterPaid={applyPagoParcialToRows}
      />

      <ModalEditarRecibo
        open={openEdit}
        row={selectedRow}
        lists={lists}
        periodoDefault={
          dateRange?.from ? `${String(dateRange.from.getMonth() + 1).padStart(2, "0")}-${dateRange.from.getFullYear()}` : ""
        }
        onClose={() => {
          setOpenEdit(false);
          setSelectedRow(null);
        }}
        onToast={showToast}
        onSave={async (payloadFinal) => {
          const { idUsuario, idUsuarioMaster } = getAuthInfo();

          const data = await apiPostJson(`${API}?action=recibos_actualizar`, {
            ...payloadFinal,
            idUsuario,
            idUsuarioMaster: idUsuarioMaster || idUsuario,
          });

          cacheRef.current.clear();
          await Promise.allSettled([
            loadRows({ from: dateRange?.from, to: dateRange?.to, q, offset: 0, append: false }),
            refreshLists(),
          ]);

          return data;
        }}
      />
    </div>
  );
}
