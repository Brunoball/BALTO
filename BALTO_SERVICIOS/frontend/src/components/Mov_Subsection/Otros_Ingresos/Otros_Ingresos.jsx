import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { otrosIngresosFetch, getOtrosIngresosAuthInfo } from "./api/otrosIngresosApi.js";
import useOtrosIngresosToast from "./hooks/useOtrosIngresosToast.js";
import { moneyARS, safeText, cleanText, normalizeSearchText, formatFechaDMY, startOfDay, parseRowFecha, dateToAPI, formatDateUI } from "./utils/otrosIngresosUtils.js";
import BASE_URL from "../../../config/config.jsx";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";
import "../../Global/Global_css/Global_oscuro.css";
import "../Ventas/Ventas.css";

import Toast from "../../Global/Toast.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import "../../Global/Calendario/calendario.css";


import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalNuevoIngreso from "./modales/ModalNuevoIngreso.jsx";
import ModalEditarIngreso from "./modales/ModalEditarIngreso.jsx";
import ModalCobrarOtrosIngresos from "./modales/ModalCobrarOtrosIngresos.jsx";
import ModalEmitirNotaCreditoIngreso from "./modales/ModalEmitirNotaCreditoIngreso.jsx";
import ModalEliminar from "../../Global/Modales/ModalEliminar.jsx";
import { ModalDetalleMovimientoIngreso } from "../../Global/Modales/ModalDetalleMovimiento.jsx";

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
  faBoxOpen,
  faEye,
  faInfoCircle,
  faFileInvoiceDollar,
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
  const n = cantidadDetallesMovimiento(row);
  return n === 1 ? "1 DETALLE" : `${n} DETALLES`;
}








function getMovimientoId(r) {
  const cand =
    r?.id_movimiento ??
    r?.idMovimiento ??
    r?.id_mov ??
    r?.id ??
    r?.id_ingreso ??
    r?.idIngreso ??
    r?.ingreso_id ??
    r?.movimiento_id ??
    r?.id_movimiento_fk ??
    null;

  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getRowKey(r) {
  const id = getMovimientoId(r);
  if (id) return `id:${id}`;

  return `fx:${String(r?.fecha ?? "").trim()}|${String(
    r?.detalle ?? r?.descripcion ?? r?.concepto ?? ""
  ).trim()}|${String(r?.categoria ?? r?.categoria_nombre ?? "").trim()}|${String(
    Number(r?.monto_total ?? r?.total ?? r?.total_general ?? 0) || 0
  )}`;
}

function getIngresoIdComprobante(row) {
  const n = Number(row?.id_comprobante ?? row?.comprobante_id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeIngresoComprobantes(row) {
  const docs = Array.isArray(row?.comprobantes_detalle) ? row.comprobantes_detalle : [];
  return docs
    .map((doc) => {
      const id = Number(doc?.id_comprobante ?? doc?.id_archivo ?? doc?.id ?? 0);
      if (!(id > 0)) return null;
      const tipo = cleanText(doc?.tipo ?? doc?.archivo_tipo ?? doc?.comprobante_tipo).toUpperCase();
      const esNota = tipo.includes("NOTA_CREDITO");
      const esFactura = tipo.includes("FACTURA") || Number(doc?.emitido_en_arca || 0) === 1;
      const label = cleanText(
        doc?.label ?? doc?.title ??
        (esNota ? "Nota de crédito" : esFactura ? "Factura" : "Comprobante de ingreso")
      ) || "Comprobante de ingreso";
      return {
        ...doc,
        id_comprobante: id,
        key: cleanText(doc?.key) || `${tipo || "comprobante"}-${id}`,
        label,
        title: cleanText(doc?.title) || label,
        mime: cleanText(doc?.mime ?? doc?.archivo_mime) || "application/pdf",
        cacheSalt: cleanText(doc?.archivo_path ?? doc?.tipo ?? id) || String(id),
      };
    })
    .filter(Boolean);
}

function hasFacturaFiscal(row) {
  if (Number(row?.factura_emitida_en_arca || row?.emitido_en_arca || 0) === 1) return true;
  return normalizeIngresoComprobantes(row).some((doc) =>
    Number(doc?.emitido_en_arca || 0) === 1 && !String(doc?.tipo || "").toUpperCase().includes("NOTA_CREDITO")
  );
}

function getOtroIngresoMediosDetalle(row) {
  if (Array.isArray(row?.medios_pago_detalle)) return row.medios_pago_detalle;

  if (typeof row?.medios_pago_detalle === "string") {
    try {
      const parsed = JSON.parse(row.medios_pago_detalle);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getOtroIngresoCantidadMedios(row) {
  const n = Number(row?.cantidad_medios_pago);
  if (Number.isFinite(n) && n > 0) return n;

  const detalle = getOtroIngresoMediosDetalle(row);
  if (!detalle.length) return 0;

  const unicos = new Set();

  detalle.forEach((mp) => {
    const id = Number(mp?.id_medio_pago ?? mp?.medio_pago_id ?? mp?.idMedioPago ?? 0);
    if (Number.isFinite(id) && id > 0) {
      unicos.add(`id:${id}`);
      return;
    }

    const nombre = String(mp?.medio_pago_nombre ?? mp?.medio_pago ?? mp?.nombre ?? "")
      .trim()
      .toUpperCase();
    if (nombre) unicos.add(`nom:${nombre}`);
  });

  return unicos.size;
}

function hasOtroIngresoDetalleMedios(row) {
  return getOtroIngresoCantidadMedios(row) > 1;
}

function getOtroIngresoTotal(row) {
  const n = Number(row?.monto_total ?? row?.total ?? row?.total_general ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getOtroIngresoCobrado(row) {
  const explicit = Number(
    row?.cobrado_total ?? row?.monto_cobrado ?? row?.total_cobrado ?? row?.pagado_total ?? NaN
  );
  if (Number.isFinite(explicit)) return Math.max(0, explicit);

  return getOtroIngresoMediosDetalle(row).reduce((acc, mp) => {
    const n = Number(mp?.monto ?? mp?.importe ?? 0);
    return acc + (Number.isFinite(n) ? Math.max(0, n) : 0);
  }, 0);
}

function getOtroIngresoSaldo(row) {
  for (const key of ["saldo_pendiente", "saldo_restante", "monto_pendiente", "pendiente", "saldo"]) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  }
  return Math.max(0, getOtroIngresoTotal(row) - getOtroIngresoCobrado(row));
}

function getOtroIngresoEstadoPago(row) {
  const estado = String(row?.estado_pago ?? row?.estadoPago ?? "").trim().toLowerCase();
  if (estado) return estado;
  const total = getOtroIngresoTotal(row);
  const cobrado = getOtroIngresoCobrado(row);
  const saldo = getOtroIngresoSaldo(row);
  if (total <= 0.009 || saldo <= 0.009) return "pagado";
  if (cobrado > 0.009) return "pendiente_parcial";
  return "pendiente";
}

function getOtroIngresoEstadoLabel(row) {
  const estado = getOtroIngresoEstadoPago(row);
  if (estado === "pagado" || estado === "cobrado") return "PAGADO";
  if (estado === "pendiente_parcial" || estado === "parcial") return "PENDIENTE PARCIAL";
  return "PENDIENTE";
}

function getOtroIngresoEstadoChipClass(row) {
  const estado = getOtroIngresoEstadoPago(row);
  if (estado === "pagado" || estado === "cobrado") return "mov-chip mov-chip--ok";
  if (estado === "pendiente_parcial" || estado === "parcial") return "mov-chip mov-chip--warn mov-chip--partial";
  return "mov-chip mov-chip--warn";
}

function isOtroIngresoPagado(row) {
  return getOtroIngresoSaldo(row) <= 0.009;
}


function normalizeOtroIngresoRow(r) {
  const comprobantesDetalle = normalizeIngresoComprobantes(r);
  return {
    ...r,
    id_movimiento: getMovimientoId(r) ?? r?.id_movimiento ?? null,
    categoria: "OTROS INGRESOS",
    medio_pago_nombre: String(r?.medio_pago_nombre ?? r?.medio_pago ?? r?.pago_medio_pago ?? "").trim() || "",
    id_comprobante: Number(r?.id_comprobante ?? 0) || 0,
    comprobante_url: String(r?.comprobante_url ?? "").trim(),
    archivo_mime: String(r?.archivo_mime ?? "").trim(),
    comprobante_tipo: String(r?.comprobante_tipo ?? "").trim(),
    comprobantes_detalle: comprobantesDetalle,
    medios_pago_detalle: getOtroIngresoMediosDetalle(r),
    cantidad_medios_pago: getOtroIngresoCantidadMedios(r),
    cobrado_total: getOtroIngresoCobrado(r),
    saldo_pendiente: getOtroIngresoSaldo(r),
    estado_pago: getOtroIngresoEstadoPago(r),
    pagado: isOtroIngresoPagado(r),
    tiene_comprobante:
      comprobantesDetalle.length > 0 || Number(r?.id_comprobante ?? 0) > 0 || String(r?.comprobante_url ?? "").trim() !== "",
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

  parts.push(
    formatFechaDMY(row?.fecha),
    String(montoNum),
    String(Math.trunc(montoNum)),
    moneyARS(montoNum)
  );

  return normalizeSearchText(parts.join(" | ")).includes(qq);
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
  return (
    String(name || "OtrosIngresos")
      .replace(/[\[\]\*\/\\\?\:]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "OtrosIngresos"
  ).slice(0, 31);
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
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export default function OtrosIngresos() {
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
  const [openCobrar, setOpenCobrar] = useState(false);
  const [openNC, setOpenNC] = useState(false);
  const [modoNC, setModoNC] = useState("NORMAL");
  const [selectedRow, setSelectedRow] = useState(null);

  const [openDelete, setOpenDelete] = useState(false);
  const [rowToDelete, setRowToDelete] = useState(null);

  const [openViewComprobante, setOpenViewComprobante] = useState(false);
  const [comprobanteView, setComprobanteView] = useState({
    url: "",
    mime: "",
    title: "Comprobante",
    documents: [],
  });

  const [openMediosPago, setOpenMediosPago] = useState(false);
  const [selectedMediosRow, setSelectedMediosRow] = useState(null);

  const { toast, showToast, closeToast } = useOtrosIngresosToast();

  const signedUrlCacheRef = useRef(new Map());
  const signedUrlInFlightRef = useRef(new Set());

  useEffect(() => {
    if (errorListsCtx) showToast("error", errorListsCtx, 4200);
  }, [errorListsCtx, showToast]);

  useEffect(() => {
    if (error) showToast("error", error, 4200);
  }, [error, showToast]);

  const cacheRef = useRef(new Map());
  const reqIdRef = useRef(0);
  const rowsReqIdRef = useRef(0);
  const moreReqIdRef = useRef(0);
  const searchTimerRef = useRef(null);
  const skipSearchRef = useRef(false);

  const showSkeleton = loadingRows;

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, []);

  const buildHeadersGET = useCallback(() => {
    const { token, sessionKey } = getOtrosIngresosAuthInfo();
    const h = {};
    if (sessionKey) h["X-Session"] = sessionKey;
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, []);

  const buildHeadersPOST = useCallback(() => {
    const { token, sessionKey } = getOtrosIngresosAuthInfo();
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
      const res = await otrosIngresosFetch(url, { method: "GET", headers: buildHeadersGET() });
      return await parseJsonOrThrow(res);
    },
    [buildHeadersGET, parseJsonOrThrow]
  );

  const apiPostJson = useCallback(
    async (url, payload) => {
      const res = await otrosIngresosFetch(url, {
        method: "POST",
        headers: buildHeadersPOST(),
        body: JSON.stringify(payload ?? {}),
      });
      return await parseJsonOrThrow(res);
    },
    [buildHeadersPOST, parseJsonOrThrow]
  );

  const getComprobanteSignedUrl = useCallback(
    async (idComprobante, idMovimiento = null) => {
      const id = Number(idComprobante || 0);
      const mov = Number(idMovimiento || 0);

      const cacheKey = id > 0 ? `id:${id}` : `mov:${mov}`;
      if (!id && !mov) return "";

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
        sp.set("action", "otros_ingresos_comprobantes_descargar");

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
        const persisted = readMovPerfCache("otros_ingresos:listar:v3", cacheKey);
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
        sp.set("action", "otros_ingresos_listar");
        if (fromAPI) sp.set("fecha_desde", fromAPI);
        if (toAPI) sp.set("fecha_hasta", toAPI);
        if (qKey) sp.set("q", qKey);
        sp.set("limit", String(PROBE_LIMIT));
        sp.set("offset", String(offset));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) throw new Error(data?.mensaje || "No se pudieron cargar otros ingresos.");

        if (myReqId !== reqIdRef.current) return null;

        const listKey = Array.isArray(data.otros_ingresos)
          ? "otros_ingresos"
          : Array.isArray(data.ingresos)
          ? "ingresos"
          : Array.isArray(data.movimientos)
          ? "movimientos"
          : "otros_ingresos";

        const rawArr = Array.isArray(data[listKey]) ? data[listKey] : [];
        const normAll = rawArr.map(normalizeOtroIngresoRow);

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
                writeMovPerfCache("otros_ingresos:listar:v3", cacheKey, cachePayload);
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
        const msg = e?.message || "Error cargando otros ingresos.";

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
      clearMovPerfCache("otros_ingresos:listar:v3");
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
    if (from && to) return `otros_ingresos_${dateToAPI(from)}_${dateToAPI(to)}`;
    if (from) return `otros_ingresos_desde_${dateToAPI(from)}`;
    return "otros_ingresos_todos";
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

    XLSX.utils.book_append_sheet(wb, ws, slugifySheetName("OtrosIngresos_Vista"));
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
      const { idUsuario } = getOtrosIngresosAuthInfo();
      const idUsuarioMaster = idUsuario;
      const action = isEdit ? "otros_ingresos_actualizar" : "otros_ingresos_crear";

      try {
        const data = await apiPostJson(`${API}?action=${action}`, {
          ...(payload || {}),
          idUsuario,
          idUsuarioMaster,
        });

        if (!data?.exito) throw new Error(data?.mensaje || "No se pudo guardar.");
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
      signedUrlCacheRef.current.clear();
      signedUrlInFlightRef.current.clear();

      cacheRef.current.clear();
      clearMovPerfCache("otros_ingresos:listar:v3");
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

  const handleOpenDeleteModal = useCallback((row) => {
    if (!row?.id_movimiento) return;
    setRowToDelete(row);
    setOpenDelete(true);
  }, []);

  const handleConfirmDelete = useCallback(async ({ permitirFiscalAnulada = false } = {}) => {
    if (!rowToDelete?.id_movimiento) {
      throw new Error("No se encontró el movimiento a eliminar.");
    }

    const id = rowToDelete.id_movimiento;
    setDeletingId(id);
    setError("");

    try {
      const { idUsuario } = getOtrosIngresosAuthInfo();
      const idUsuarioMaster = idUsuario;
      const sp = new URLSearchParams();
      sp.set("action", "otros_ingresos_eliminar");
      sp.set("id_movimiento", String(id));

      const data = await apiPostJson(`${API}?${sp.toString()}`, {
        idUsuario,
        idUsuarioMaster,
        permitir_fiscal_anulada: permitirFiscalAnulada ? 1 : 0,
        eliminar_fiscal_anulada: permitirFiscalAnulada ? 1 : 0,
      });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar.");

      if (selectedRow?.id_movimiento === id) {
        setSelectedRow(null);
      }

      setOpenDelete(false);
      setRowToDelete(null);

      await reloadVista();
      await refreshPeriodos();
      return data;
    } catch (e) {
      const msg = e?.message || "Error eliminando ingreso.";
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
    showToast("cargando", "Cargando todos los ingresos…", 12000);

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
      showToast("exito", `Listo: se cargaron ${rowsRef.current.length} ingresos.`, 2600);
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
      const id = Number(row?.id_movimiento ?? 0);
      if (!id) return;
      if (hasFacturaFiscal(row)) {
        showToast("advertencia", "Los ingresos con factura emitida en ARCA no se pueden editar.", 3400);
        return;
      }
      if (Number(row?.nota_credito_cantidad || 0) > 0 || Number(row?.tiene_nota_credito || 0) === 1) {
        showToast("advertencia", "Los ingresos con notas de crédito no se pueden editar.", 3400);
        return;
      }

      setLoadingEditDataId(id);
      setError("");

      try {
        const sp = new URLSearchParams();
        sp.set("action", "otros_ingresos_obtener");
        sp.set("id_movimiento", String(id));

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data?.exito) {
          throw new Error(data?.mensaje || "No se pudo obtener el ingreso para editar.");
        }

        const ingreso = data?.ingreso ?? data?.otro_ingreso ?? data?.movimiento ?? null;
        if (!ingreso) {
          throw new Error("No se encontró la información del ingreso.");
        }

        setSelectedRow(ingreso);
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
    setSelectedMediosRow(normalizeOtroIngresoRow(row));
    setOpenMediosPago(true);
  }, []);

  const handleCloseMediosPago = useCallback(() => {
    setOpenMediosPago(false);
    setSelectedMediosRow(null);
  }, []);

  const handleOpenCobrar = useCallback((row) => {
    const normalized = normalizeOtroIngresoRow(row || {});
    const id = getMovimientoId(normalized);

    if (!id) {
      showToast("error", "No se encontró el ID del ingreso para cobrar.", 3200);
      return;
    }

    if (isOtroIngresoPagado(normalized)) {
      showToast("advertencia", "Este ingreso ya está cobrado completamente.", 2800);
      return;
    }

    setSelectedRow({ ...normalized, id_movimiento: id });
    setOpenCobrar(true);
  }, [showToast]);

  const handleCloseCobrar = useCallback(() => {
    setOpenCobrar(false);
    setSelectedRow(null);
  }, []);

  const handlePrewarmComprobante = useCallback(
    async (row) => {
      const docs = normalizeIngresoComprobantes(row);
      if (docs.length) {
        docs.forEach((doc) => getComprobanteSignedUrl(doc.id_comprobante, row?.id_movimiento).catch(() => {}));
        return;
      }
      const idComprobante = getIngresoIdComprobante(row);
      const idMovimiento = Number(row?.id_movimiento ?? 0);
      if (!idComprobante && !idMovimiento) return;

      getComprobanteSignedUrl(idComprobante, idMovimiento).catch(() => {});
    },
    [getComprobanteSignedUrl]
  );

  const handleOpenComprobante = useCallback(
    async (row) => {
      const docsDetalle = normalizeIngresoComprobantes(row);
      const idComprobante = getIngresoIdComprobante(row);
      const idMovimiento = Number(row?.id_movimiento ?? 0);

      const tieneComprobante =
        docsDetalle.length > 0 ||
        (idComprobante && idComprobante > 0) ||
        String(row?.comprobante_url ?? "").trim() !== "";

      if (!tieneComprobante) return;

      try {
        const candidates = docsDetalle.length
          ? docsDetalle
          : [{
              id_comprobante: idComprobante,
              label: "Comprobante de ingreso",
              title: "Comprobante de ingreso",
              mime: String(row?.archivo_mime ?? "").trim() || "application/octet-stream",
            }];
        const documents = (
          await Promise.all(candidates.map(async (doc) => ({
            ...doc,
            url: await getComprobanteSignedUrl(doc.id_comprobante, idMovimiento),
          })))
        ).filter((doc) => String(doc.url || "").trim());
        if (!documents.length) {
          showToast("error", "No se pudo obtener el comprobante.", 3000);
          return;
        }

        const detalle = String(row?.detalle ?? row?.descripcion ?? row?.concepto ?? "").trim();
        const fecha = formatFechaDMY(row?.fecha);

        setComprobanteView({
          url: documents[0].url,
          mime: documents[0].mime || "application/octet-stream",
          title: detalle
            ? `Comprobantes de ingreso - ${detalle} - ${fecha}`
            : `Comprobantes de ingreso - ${fecha}`,
          documents,
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
      documents: [],
    });
  }, []);

  const deleteEsFiscal = useMemo(() => hasFacturaFiscal(rowToDelete), [rowToDelete]);
  const deleteTieneNotas = useMemo(
    () =>
      Number(rowToDelete?.nota_credito_cantidad || 0) > 0 ||
      Number(rowToDelete?.tiene_nota_credito || 0) === 1 ||
      Number(rowToDelete?.factura_tiene_nota_credito || 0) === 1 ||
      Number(rowToDelete?.tiene_nota_credito_fiscal || 0) === 1 ||
      Number(rowToDelete?.monto_acreditado || 0) > 0,
    [rowToDelete]
  );
  const deleteNotaFiscalTotal = useMemo(
    () => deleteEsFiscal && (
      Number(rowToDelete?.nota_credito_total || 0) === 1 ||
      Number(rowToDelete?.monto_total ?? rowToDelete?.total ?? 0) <= 0.004
    ),
    [rowToDelete, deleteEsFiscal]
  );
  const deleteCantidadNotas = useMemo(() => {
    const cantidad = Number(rowToDelete?.nota_credito_cantidad || 0);
    return Number.isFinite(cantidad) && cantidad > 0 ? cantidad : (deleteTieneNotas ? 1 : 0);
  }, [rowToDelete, deleteTieneNotas]);
  const deleteExtraContent = useMemo(() => {
    if (!rowToDelete || !deleteEsFiscal) return null;

    if (deleteNotaFiscalTotal) {
      return (
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            color: "#237804",
            borderRadius: 12,
            padding: 12,
            marginTop: 10,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            La nota de crédito ya fue emitida
          </div>
          <div style={{ lineHeight: 1.5 }}>Ahora ya podés eliminar el ingreso.</div>
        </div>
      );
    }

    const texto = deleteTieneNotas
      ? "El ingreso tiene una acreditación parcial. Para eliminarlo, primero emití una nota de crédito por todo el saldo pendiente en ARCA."
      : "Para eliminar este ingreso, primero emití una nota de crédito por el total en ARCA.";

    return (
      <div className="extraContent-ventas extraContent-ventas--warning">
        <div className="extraContent-ventas__title">Se requiere una nota de crédito total</div>
        <div className="extraContent-ventas__text">{texto}</div>
      </div>
    );
  }, [rowToDelete, deleteEsFiscal, deleteNotaFiscalTotal, deleteTieneNotas]);
  const deleteDetails = useMemo(() => {
    const details = [
      {
        label: "ID Movimiento",
        value: rowToDelete?.id_movimiento ? `#${rowToDelete.id_movimiento}` : "—",
      },
      {
        label: "Tipo",
        value: rowToDelete?.tipo_movimiento || rowToDelete?.tipo || "OTROS INGRESOS",
      },
      {
        label: "Concepto",
        value:
          rowToDelete?.detalle ||
          rowToDelete?.descripcion ||
          rowToDelete?.concepto ||
          "—",
      },
      {
        label: "Monto neto",
        value: moneyARS(
          rowToDelete?.monto_total ??
            rowToDelete?.total ??
            rowToDelete?.total_general ??
            0
        ),
      },
    ];

    if (deleteEsFiscal) {
      details.push({
        label: "Estado fiscal",
        value: deleteNotaFiscalTotal
          ? "ANULADO POR NOTA DE CRÉDITO"
          : deleteTieneNotas
            ? "ACREDITACIÓN PARCIAL"
            : "FACTURA EMITIDA",
      });

      if (deleteTieneNotas) {
        details.push({ label: "Notas de crédito", value: String(deleteCantidadNotas) });
      }
    }

    return details;
  }, [rowToDelete, deleteEsFiscal, deleteNotaFiscalTotal, deleteTieneNotas, deleteCantidadNotas]);
  const deleteConfig = useMemo(() => {
    if (deleteEsFiscal && !deleteNotaFiscalTotal) {
      return {
        title: "No se puede eliminar todavía",
        message: deleteTieneNotas
          ? "La factura de ARCA todavía tiene saldo pendiente."
          : "Este ingreso tiene una factura emitida en ARCA.",
        warning: "",
        confirmLabel: "Eliminar",
        confirmDisabled: true,
        secondaryActionLabel: "Emitir nota de crédito",
        confirmVariant: "danger",
      };
    }
    if (deleteEsFiscal && deleteNotaFiscalTotal) {
      return {
        title: "Eliminar ingreso",
        message: "Este ingreso ya tiene su nota de crédito asociada.",
        warning: "Ahora sí podés eliminar el registro definitivamente.",
        confirmLabel: "Eliminar",
        confirmDisabled: false,
        secondaryActionLabel: "",
        confirmVariant: "danger",
      };
    }
    if (deleteTieneNotas) {
      return {
        title: "Eliminar ingreso y notas de crédito",
        message: "¿Seguro que querés eliminar este ingreso y sus notas de crédito internas?",
        warning: "Balto revertirá el impacto original y el de cada nota para conservar el stock correcto.",
        confirmLabel: "Eliminar todo",
        confirmDisabled: false,
        secondaryActionLabel: "",
        confirmVariant: "danger",
      };
    }
    return {
      title: "Eliminar ingreso",
      message: "¿Seguro que querés eliminar este ingreso definitivamente?",
      warning: "Esta acción no se puede deshacer.",
      confirmLabel: "Eliminar",
      confirmDisabled: false,
      secondaryActionLabel: "",
      confirmVariant: "danger",
    };
  }, [deleteEsFiscal, deleteNotaFiscalTotal, deleteTieneNotas]);

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
    categorias_ingreso: [],
  };

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
              <div className="mov-card__title">Movs · Otros Ingresos</div>
              <div className="mov-card__hint">
                Mostrando <b>{filteredRows.length}</b> ingresos
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
              title="Crear nuevo ingreso"
            >
              <FontAwesomeIcon icon={faPlus} /> Nuevo Ingreso
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
                  const tieneComprobante =
                    normalizeIngresoComprobantes(r).length > 0 ||
                    Number(r?.id_comprobante ?? 0) > 0 || String(r?.comprobante_url ?? "").trim() !== "";
                  const ingresoFiscal = hasFacturaFiscal(r);
                  const tieneNotaCredito = Number(r?.nota_credito_cantidad || 0) > 0 || Number(r?.tiene_nota_credito || 0) === 1;
                  const ingresoSinSaldo = Number(r?.monto_total ?? r?.total ?? 0) <= 0.004;
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
                                      : "Este ingreso no tiene comprobante"
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

                                <button
                                  type="button"
                                  className="mov-iconBtn"
                                  title={ingresoSinSaldo ? "Ingreso acreditado totalmente" : "Emitir nota de crédito"}
                                  onClick={() => {
                                    setSelectedRow(r);
                                    setModoNC("NORMAL");
                                    setOpenNC(true);
                                  }}
                                  disabled={isAnyLoading || loadingListsCtx || ingresoSinSaldo}
                                >
                                  <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                </button>


                                {!ingresoFiscal && !tieneNotaCredito && (
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

                                <button
                                  type="button"
                                  className="mov-iconBtn mov-iconBtn--danger"
                                  title="Eliminar"
                                  disabled={isAnyLoading || loadingListsCtx || deletingId === r.id_movimiento}
                                  onClick={() => handleOpenDeleteModal(r)}
                                >
                                  {deletingId === r.id_movimiento ? "..." : <FontAwesomeIcon icon={faTrashCan} />}
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
                        ? `No se encontraron ingresos para "${q.trim()}".`
                        : "No hay ingresos para mostrar en el rango de fechas seleccionado."}
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
                      title="Cargar todos los ingresos restantes"
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

      <ModalNuevoIngreso
        open={openAdd}
        mode="create"
        initialData={null}
        lists={lists}
        onClose={() => {
          setOpenAdd(false);
          setSelectedRow(null);
        }}
        onToast={showToast}
        onSubmit={apiPostSave}
        onSaved={async (result) => {
          const fueFacturado = result?.accion_final === "facturar";
          setOpenAdd(false);
          setSelectedRow(null);
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
          await reloadVista();
          await refreshPeriodos();
          showToast(
            "exito",
            fueFacturado
              ? "Ingreso guardado y factura emitida correctamente."
              : "Ingreso guardado correctamente.",
            fueFacturado ? 3600 : 2600
          );
        }}
      />

      <ModalEditarIngreso
        open={openEdit}
        initialData={selectedRow}
        lists={lists}
        onClose={() => {
          setOpenEdit(false);
          setSelectedRow(null);
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
          showToast("exito", "Ingreso actualizado correctamente.", 2600);
        }}
      />

      <ModalCobrarOtrosIngresos
        open={openCobrar}
        row={selectedRow}
        lists={lists}
        onClose={handleCloseCobrar}
        onToast={showToast}
        onOpenDetalle={handleOpenMediosPago}
        detalleIngresoOpen={openMediosPago}
        onSaved={async () => {
          setOpenCobrar(false);
          setSelectedRow(null);
          await reloadVista();
          await refreshPeriodos();
        }}
      />

      <ModalEmitirNotaCreditoIngreso
        open={openNC}
        row={selectedRow}
        modo={modoNC}
        onClose={() => {
          setOpenNC(false);
          setModoNC("NORMAL");
          setSelectedRow(null);
        }}
        onToast={showToast}
        onDone={async () => {
          const currentId = Number(selectedRow?.id_movimiento || 0);
          const currentRow = selectedRow;
          const currentMode = modoNC;
          setOpenNC(false);
          setModoNC("NORMAL");
          signedUrlCacheRef.current.clear();
          signedUrlInFlightRef.current.clear();
          await reloadVista();

          if (currentMode === "ELIMINAR_TOTAL") {
            const updated = rowsRef.current.find((item) => getMovimientoId(item) === currentId) || {
              ...(currentRow || {}),
              factura_tiene_nota_credito: 1,
              tiene_nota_credito_fiscal: 1,
              nota_credito_total: 1,
              monto_total: 0,
              total: 0,
            };
            setSelectedRow(null);
            setRowToDelete(updated);
            setOpenDelete(true);
            showToast("exito", "Nota de crédito total emitida. Ahora podés confirmar la eliminación.", 3800);
            return;
          }

          setSelectedRow(null);
          showToast("exito", "Nota de crédito aplicada. El ingreso original queda en el historial.", 3800);
        }}
      />

      <ModalEliminar
        open={openDelete}
        row={rowToDelete}
        onClose={handleCloseDeleteModal}
        onConfirm={deleteEsFiscal
          ? (deleteNotaFiscalTotal ? () => handleConfirmDelete({ permitirFiscalAnulada: true }) : null)
          : handleConfirmDelete}
        onToast={showToast}
        title={deleteConfig.title}
        message={deleteConfig.message}
        warning={deleteConfig.warning}
        loading={!!deletingId}
        loadingMessage="Eliminando ingreso…"
        successMessage={deleteTieneNotas ? "Ingreso y notas de crédito eliminados." : "Ingreso eliminado."}
        errorMessage="No se pudo eliminar el ingreso."
        confirmLabel={deleteConfig.confirmLabel}
        cancelLabel="Cancelar"
        confirmDisabled={deleteConfig.confirmDisabled}
        confirmVariant={deleteConfig.confirmVariant}
        secondaryActionLabel={deleteConfig.secondaryActionLabel}
        onSecondaryAction={deleteEsFiscal && !deleteNotaFiscalTotal ? async () => {
          const current = rowToDelete;
          setOpenDelete(false);
          setRowToDelete(null);
          setSelectedRow(current);
          setModoNC("ELIMINAR_TOTAL");
          setOpenNC(true);
        } : null}
        details={deleteDetails}
        extraContent={deleteExtraContent}
      />

      <ModalDetalleMovimientoIngreso
        open={openMediosPago}
        row={selectedMediosRow}
        onClose={handleCloseMediosPago}
      />

      <ModalVerComprobante
        open={openViewComprobante}
        url={comprobanteView.url}
        mime={comprobanteView.mime}
        title={comprobanteView.title}
        documents={comprobanteView.documents}
        onClose={closeComprobanteModal}
      />
    </div>
  );
}
