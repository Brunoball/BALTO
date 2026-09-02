import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import "../cuentas_corrientes.css";
import "../../Global/Global_css/Global_oscuro.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faFileExcel,
  faTimes,
  faEye,
  faInfoCircle,
  faBoxOpen,
  faChevronDown,
  faArrowRightLong,
  faMagnifyingGlass,
  faTrashCan,
  faArrowLeft,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../../Global/Toast.jsx";
import Calendario from "../../Global/Calendario/Calendario.jsx";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import ModalEliminarMovimientos from "../../Global/Modales/ModalEliminar.jsx";
import ModalDetalleMovimiento from "../../Global/Modales/ModalDetalleMovimiento.jsx";
import { useDateRange } from "../../../context/DateRangeContext.jsx";
import BotonExportar from "../../Global/Boton_Exportar/BotonExportar.jsx";
import ModalProveedores from "./modales/ModalProveedores.jsx";
import {
  CC_API_URL as API,
  ccApiGet as apiGet,
  ccApiPost as apiPost,
  getAuthInfo,
} from "../api/cuentasCorrientesApi";
import useCuentasCorrientesToast from "../hooks/useCuentasCorrientesToast";
import {
  buildExportRows,
  buildHistorialExportRows,
  buildProveedoresExportRows,
  canDeleteCobro,
  canPreviewComprobante,
  downloadBlob,
  escapeCSV,
  formatDateISO,
  formatDateLabel,
  formatDisplayDate,
  makeComprobanteAccessUrl,
  moneyARS,
  normLower,
  normalizeCCComprobanteDocs,
  prewarmComprobanteUrl,
  resolveFileUrl,
  safeText,
} from "../utils/cuentasCorrientesUtils";

/* =========================
   Helpers
========================= */
function saldoProveedorToneClass(value) {
  const saldo = Number(value || 0);
  if (!Number.isFinite(saldo)) return "cc-money cc-money--neutral";

  const saldoEnCentavos = Math.round(saldo * 100);
  if (saldoEnCentavos > 0) return "cc-money cc-money--negative";
  return "cc-money cc-money--positive";
}

function saldoTotalProveedorToneClass(totales) {
  const debito = Number(totales?.debito || 0);
  const credito = Number(totales?.credito || 0);

  if (debito > credito) return "cc-money cc-money--negative";
  if (credito > debito) return "cc-money cc-money--positive";
  return saldoProveedorToneClass(totales?.saldo);
}

function saldoMovimientoToneClass(row) {
  return saldoProveedorToneClass(row?.saldo);
}

export default function ProveedoresCC() {
  const { dateRange, setDateRange } = useDateRange();

  const [calOpen, setCalOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [summaryRows, setSummaryRows] = useState([]);
  const [selectedProveedor, setSelectedProveedor] = useState(null);

  const [rows, setRows] = useState([]);
  const [totales, setTotales] = useState({ debito: 0, credito: 0, saldo: 0 });
  const [historialRows, setHistorialRows] = useState([]);
  const [historialTotales, setHistorialTotales] = useState({ debito: 0, credito: 0, saldo: 0 });
  const [activeDetailTab, setActiveDetailTab] = useState("cuenta");

  const [hasSearched, setHasSearched] = useState(false);
  const [queryUsed, setQueryUsed] = useState("");

  const comprobanteUrlCacheRef = useRef(new Map());

  const [previewComprobante, setPreviewComprobante] = useState({
    open: false,
    url: "",
    mime: "",
    title: "Comprobante",
    documents: [],
  });

  const [deleteState, setDeleteState] = useState({
    open: false,
    loading: false,
    row: null,
  });

  const [detalleMovimientoState, setDetalleMovimientoState] = useState({
    open: false,
    row: null,
  });

  const { toast, showToast, closeToast } = useCuentasCorrientesToast();
  const [modalProveedoresOpen, setModalProveedoresOpen] = useState(false);

  const rangeLabel = useMemo(() => {
    const from = dateRange?.from || null;
    const to = dateRange?.to || null;
    if (!from) return "Seleccionar período";
    if (!to || formatDateISO(from) === formatDateISO(to)) return formatDateLabel(from);
    return (
      <>
        <span>{formatDateLabel(from)}</span>
        <span className="cc-rangeArrow">
          <FontAwesomeIcon icon={faArrowRightLong} />
        </span>
        <span>{formatDateLabel(to)}</span>
      </>
    );
  }, [dateRange]);

  const exportBaseName = useMemo(() => {
    if (!selectedProveedor) {
      const safeSearch = String(q || "").trim().replace(/[^\w.-]+/g, "_");
      return safeSearch ? `cc_proveedores_${safeSearch}` : "cc_proveedores";
    }

    const safeName = String(queryUsed || selectedProveedor?.nombre || "proveedor").replace(/[^\w.-]+/g, "_");
    const from = formatDateISO(dateRange?.from);
    const to = formatDateISO(dateRange?.to || dateRange?.from);
    const detailSuffix = activeDetailTab === "historial" ? "historial" : "cuenta_corriente";
    return `cc_proveedor_${safeName}_${detailSuffix}_${from}_${to}`;
  }, [selectedProveedor, q, queryUsed, dateRange, activeDetailTab]);

  const filteredSummaryRows = useMemo(() => {
    const needle = normLower(q);
    const base = Array.isArray(summaryRows) ? summaryRows : [];
    if (!needle) return base;
    return base.filter((r) => normLower(r.nombre).includes(needle));
  }, [summaryRows, q]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet(`${API}?action=cc_saldos_proveedores`);
      if (!data || data.exito !== true) {
        throw new Error(data?.mensaje || "No se pudo cargar el listado de proveedores.");
      }
      const rowsApi = Array.isArray(data.rows) ? data.rows : [];
      const rowsOrdenadas = [...rowsApi].sort((a, b) =>
        safeText(a?.nombre).localeCompare(safeText(b?.nombre), "es", {
          sensitivity: "base",
          numeric: true,
        })
      );
      setSummaryRows(rowsOrdenadas);
    } catch (e) {
      setSummaryRows([]);
      showToast("error", e?.message || "Error cargando proveedores.", 3500);
    } finally {
      setLoading(false);
    }
  }, [API, showToast]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const loadHistorial = useCallback(
    async (proveedor, options = {}) => {
      if (!proveedor?.id_proveedor) return;

      const keepSelection = options.keepSelection === true;

      setLoading(true);
      setHasSearched(true);

      if (!keepSelection) {
        setSelectedProveedor(proveedor);
        setQueryUsed(proveedor.nombre || "");
        setActiveDetailTab("cuenta");
        setHistorialRows([]);
        setHistorialTotales({ debito: 0, credito: 0, saldo: 0 });
      }

      try {
        const sp = new URLSearchParams();
        sp.set("action", "cc_historial_proveedor");
        sp.set("id_proveedor", String(proveedor.id_proveedor));

        if (dateRange?.from) {
          sp.set("fecha_desde", formatDateISO(dateRange.from));
          sp.set("fecha_hasta", formatDateISO(dateRange.to || dateRange.from));
        }

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data || data.exito !== true) {
          throw new Error(data?.mensaje || "Error al cargar historial del proveedor.");
        }

        setRows(Array.isArray(data.rows) ? data.rows : []);
        setTotales(data.totales || { debito: 0, credito: 0, saldo: 0 });
      } catch (e) {
        setRows([]);
        setTotales({ debito: 0, credito: 0, saldo: 0 });
        showToast("error", e?.message || "Error inesperado", 4200);
      } finally {
        setLoading(false);
      }
    },
    [API, dateRange, showToast]
  );

  const loadMovimientosHistorial = useCallback(
    async (proveedor) => {
      if (!proveedor?.id_proveedor) return;

      setLoading(true);
      setHasSearched(true);

      try {
        const sp = new URLSearchParams();
        sp.set("action", "cc_movimientos_historial_proveedor");
        sp.set("id_proveedor", String(proveedor.id_proveedor));

        if (dateRange?.from) {
          sp.set("fecha_desde", formatDateISO(dateRange.from));
          sp.set("fecha_hasta", formatDateISO(dateRange.to || dateRange.from));
        }

        const data = await apiGet(`${API}?${sp.toString()}`);
        if (!data || data.exito !== true) {
          throw new Error(data?.mensaje || "Error al cargar historial completo del proveedor.");
        }

        setHistorialRows(Array.isArray(data.rows) ? data.rows : []);
        setHistorialTotales(data.totales || { debito: 0, credito: 0, saldo: 0 });
      } catch (e) {
        setHistorialRows([]);
        setHistorialTotales({ debito: 0, credito: 0, saldo: 0 });
        showToast("error", e?.message || "Error inesperado", 4200);
      } finally {
        setLoading(false);
      }
    },
    [API, dateRange, showToast]
  );

  useEffect(() => {
    if (!selectedProveedor?.id_proveedor) return;

    loadHistorial(selectedProveedor, { keepSelection: true });
    if (activeDetailTab === "historial") {
      loadMovimientosHistorial(selectedProveedor);
    }
  }, [dateRange?.from, dateRange?.to, selectedProveedor?.id_proveedor, activeDetailTab, loadHistorial, loadMovimientosHistorial]);

  const volverAlListado = useCallback(() => {
    setSelectedProveedor(null);
    setRows([]);
    setTotales({ debito: 0, credito: 0, saldo: 0 });
    setHistorialRows([]);
    setHistorialTotales({ debito: 0, credito: 0, saldo: 0 });
    setActiveDetailTab("cuenta");
    setHasSearched(false);
    setQueryUsed("");

    // Al volver desde el detalle, el saldo del listado debe recalcularse
    // porque una acción interna (por ejemplo eliminar un cobro) puede cambiarlo.
    loadSummary();
  }, [loadSummary]);

  const handleDetailTabChange = useCallback((tab) => {
    setActiveDetailTab(tab === "historial" ? "historial" : "cuenta");
  }, []);

  const getExportData = useCallback(() => {
    const data = selectedProveedor
      ? activeDetailTab === "historial"
        ? buildHistorialExportRows(historialRows)
        : buildExportRows(rows)
      : buildProveedoresExportRows(filteredSummaryRows);
    if (!data.length) throw new Error("No hay datos para exportar.");
    return data;
  }, [selectedProveedor, activeDetailTab, rows, historialRows, filteredSummaryRows]);

  const exportToExcel = useCallback(() => {
    const dataToExport = getExportData();
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    ws["!cols"] = selectedProveedor
      ? [
          { wch: 14 },
          { wch: 28 },
          { wch: 28 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 },
        ]
      : [
          { wch: 42 },
          { wch: 18 },
        ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      selectedProveedor ? (activeDetailTab === "historial" ? "Historial Proveedor" : "Cuenta Corriente Proveedor") : "Proveedores"
    );
    XLSX.writeFile(wb, `${exportBaseName}.xlsx`);
  }, [getExportData, exportBaseName, selectedProveedor, activeDetailTab]);

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
      const rowLines = Object.entries(row).map(([key, value]) => `${key}: ${value ?? ""}`);
      return [`REGISTRO ${index + 1}`, ...rowLines, "----------------------------------------"].join("\n");
    });
    downloadBlob(lines.join("\n"), `${exportBaseName}.txt`, "text/plain;charset=utf-8;");
  }, [getExportData, exportBaseName]);

  const handleExport = useCallback(
    async (type) => {
      try {
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
    [exportToExcel, exportToCSV, exportToTXT, showToast]
  );

  const exportOptions = useMemo(() => {
    const excelOption = {
      key: "excel",
      label: selectedProveedor ? "Exportar Excel (.xlsx)" : "Exportar listado Excel (.xlsx)",
      icon: faFileExcel,
      onClick: () => handleExport("excel"),
    };

    if (!selectedProveedor) return [excelOption];

    return [
      excelOption,
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
    ];
  }, [handleExport, selectedProveedor]);

  const getComprobanteResolvedUrl = useCallback(
    async (doc) => {
      const idComp = Number(doc?.id_comprobante || doc?.id_archivo || 0);
      const rawUrl = safeText(doc?.rawUrl || doc?.url || doc?.archivo_url || doc?.comprobante_url || "");

      if (idComp <= 0) {
        return resolveFileUrl(rawUrl);
      }

      const cacheKey = `id:${idComp}:${safeText(doc?.cacheSalt || doc?.tipo || doc?.key || "")}`;
      if (comprobanteUrlCacheRef.current.has(cacheKey)) {
        return comprobanteUrlCacheRef.current.get(cacheKey) || "";
      }

      const data = await apiGet(`${API}?action=cc_comprobante_info&id_comprobante=${idComp}&_=${Date.now()}`);
      if (!data || data.exito !== true) {
        throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      }

      const payload = data?.data || {};
      const finalUrl = safeText(
        data?.url ||
          data?.download_url ||
          data?.archivo_url ||
          payload?.url ||
          payload?.download_url ||
          payload?.archivo_url ||
          payload?.cc_download_url ||
          rawUrl
      );

      if (!finalUrl) {
        throw new Error("El backend no devolvió la URL del comprobante.");
      }

      comprobanteUrlCacheRef.current.set(cacheKey, finalUrl);
      return finalUrl;
    },
    [API]
  );

  const buildComprobantePreviewDocs = useCallback(
    async (row) => {
      const candidates = normalizeCCComprobanteDocs(row);
      const docs = (
        await Promise.all(
          candidates.map(async (doc) => ({
            ...doc,
            url: await getComprobanteResolvedUrl(doc),
          }))
        )
      ).filter((doc) => safeText(doc?.url) !== "");

      return docs;
    },
    [getComprobanteResolvedUrl]
  );

  const handlePrewarmComprobante = useCallback(
    (row) => {
      normalizeCCComprobanteDocs(row).forEach((doc) => {
        getComprobanteResolvedUrl(doc)
          .then((url) => prewarmComprobanteUrl(url, safeText(doc?.mime || doc?.archivo_mime)))
          .catch(() => {});
      });
    },
    [getComprobanteResolvedUrl]
  );

  const openComprobante = useCallback(
    async (row) => {
      const candidates = normalizeCCComprobanteDocs(row);
      if (!candidates.length) {
        showToast("advertencia", "Este registro no tiene comprobante asociado.", 2600);
        return;
      }

      try {
        const docs = await buildComprobantePreviewDocs(row);
        if (!docs.length) {
          showToast("advertencia", "Este registro no tiene comprobante asociado.", 2600);
          return;
        }

        docs.forEach((doc) => prewarmComprobanteUrl(doc.url, safeText(doc?.mime || doc?.archivo_mime)));

        const isHistorialMovimiento = row?.tipo_registro === "historial_movimiento";
        const isNotaCredito = row?.tipo_registro === "nota_credito";
        const isCobro = !isHistorialMovimiento && !isNotaCredito && Number(row?.credito || 0) > 0;
        const isMovimiento = isHistorialMovimiento || Number(row?.debito || 0) > 0;

        setPreviewComprobante({
          open: true,
          url: docs[0]?.url || "",
          mime: docs[0]?.mime || docs[0]?.archivo_mime || safeText(row?.comprobante_mime) || "application/pdf",
          title: isNotaCredito
          ? row?.comprobante
            ? `Nota de crédito · ${row.comprobante}`
            : "Nota de crédito"
          : isCobro
          ? row?.comprobante
            ? `Orden de pago · ${row.comprobante}`
            : "Orden de pago"
          : isMovimiento
          ? row?.tipo_registro === "historial_movimiento"
            ? "Comprobantes del movimiento"
            : "Comprobantes de Compra"
          : "Comprobante",
          documents: docs,
        });
      } catch (e) {
        showToast("error", e?.message || "No se pudieron abrir los comprobantes.", 3200);
      }
    },
    [buildComprobantePreviewDocs, showToast]
  );

  const askDeleteCobro = useCallback((row) => {
    if (!canDeleteCobro(row)) return;
    setDeleteState({ open: true, loading: false, row });
  }, []);

  const closeDeleteModal = useCallback(() => {
    setDeleteState({ open: false, loading: false, row: null });
  }, []);

  const closePreviewComprobante = useCallback(() => {
    setPreviewComprobante({ open: false, url: "", mime: "", title: "Comprobante", documents: [] });
  }, []);

  const openDetalleMovimiento = useCallback((row) => {
    if (!row) return;

    const proveedorNombre = safeText(
      row?.proveedor ||
        row?.nombre_proveedor ||
        row?.razon_social_proveedor ||
        row?.proveedor_nombre ||
        selectedProveedor?.nombre
    );

    setDetalleMovimientoState({
      open: true,
      row: {
        ...row,
        id_proveedor: row?.id_proveedor ?? selectedProveedor?.id_proveedor ?? null,
        proveedor: row?.proveedor || proveedorNombre,
        nombre_proveedor: row?.nombre_proveedor || proveedorNombre,
        razon_social_proveedor: row?.razon_social_proveedor || proveedorNombre,
        proveedor_nombre: row?.proveedor_nombre || proveedorNombre,
      },
    });
  }, [selectedProveedor]);

  const closeDetalleMovimiento = useCallback(() => {
    setDetalleMovimientoState({
      open: false,
      row: null,
    });
  }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key !== "Escape") return;

      if (modalProveedoresOpen) return;

      const stopEscape = () => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      };

      if (deleteState.open) {
        stopEscape();
        if (!deleteState.loading) closeDeleteModal();
        return;
      }

      if (previewComprobante.open) {
        stopEscape();
        closePreviewComprobante();
        return;
      }

      if (detalleMovimientoState.open) {
        stopEscape();
        closeDetalleMovimiento();
      }
    };

    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [
    modalProveedoresOpen,
    deleteState.open,
    deleteState.loading,
    previewComprobante.open,
    detalleMovimientoState.open,
    closeDeleteModal,
    closePreviewComprobante,
    closeDetalleMovimiento,
  ]);

  const refreshCurrent = useCallback(async () => {
    if (selectedProveedor?.id_proveedor) {
      await loadHistorial(selectedProveedor, { keepSelection: true });
      if (activeDetailTab === "historial") {
        await loadMovimientosHistorial(selectedProveedor);
      }
      await loadSummary();
      return;
    }

    await loadSummary();
  }, [selectedProveedor, activeDetailTab, loadHistorial, loadMovimientosHistorial, loadSummary]);

  const refreshAfterProveedoresUpdate = useCallback(async () => {
    await loadSummary();

    if (selectedProveedor?.id_proveedor) {
      try {
        await loadHistorial(selectedProveedor, { keepSelection: true });
        if (activeDetailTab === "historial") {
          await loadMovimientosHistorial(selectedProveedor);
        }
      } catch {
        volverAlListado();
      }
    }
  }, [loadSummary, selectedProveedor, activeDetailTab, loadHistorial, loadMovimientosHistorial, volverAlListado]);

  const confirmDeleteCobro = useCallback(async () => {
    const row = deleteState.row;
    const idCobro = Number(row?.id_cobro || 0);
    if (idCobro <= 0) {
      throw new Error("No se encontró un id_cobro válido.");
    }

    const { idUsuario } = getAuthInfo();

    setDeleteState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await apiPost(`${API}?action=cc_eliminar_cobro`, {
        id_cobro: idCobro,
        idUsuario,
      });

      if (!data || data.exito !== true) {
        throw new Error(data?.mensaje || "No se pudo eliminar el cobro.");
      }

      closeDeleteModal();
      await refreshCurrent();
    } catch (e) {
      setDeleteState((prev) => ({ ...prev, loading: false }));
      throw e;
    }
  }, [deleteState.row, API, closeDeleteModal, refreshCurrent]);

  const isDetailMode = !!selectedProveedor;
  const isHistorialTab = activeDetailTab === "historial";
  const detailRows = isHistorialTab ? historialRows : rows;
  const detailTotales = isHistorialTab ? historialTotales : totales;
  const detailCount = detailRows.length;

  const renderDetailTabs = (extraClass = "") => (
    <div
      className={`cc-detailTabs ${extraClass}`}
      role="tablist"
      aria-label="Detalle de cuenta corriente"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeDetailTab === "cuenta"}
        className={`cc-detailTab ${activeDetailTab === "cuenta" ? "is-active" : ""}`}
        onClick={() => handleDetailTabChange("cuenta")}
        disabled={loading}
      >
        Cuenta corriente
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeDetailTab === "historial"}
        className={`cc-detailTab ${activeDetailTab === "historial" ? "is-active" : ""}`}
        onClick={() => handleDetailTabChange("historial")}
        disabled={loading}
      >
        Historial
      </button>
    </div>
  );

  return (
    <div className="contenedor-cards mov-page">
      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={closeToast}
        />
      )}

      <ModalVerComprobante
        open={previewComprobante.open}
        url={previewComprobante.url}
        mime={previewComprobante.mime}
        documents={previewComprobante.documents}
        title={previewComprobante.title}
        onClose={closePreviewComprobante}
      />

      <ModalDetalleMovimiento
        open={detalleMovimientoState.open}
        row={detalleMovimientoState.row}
        onClose={closeDetalleMovimiento}
        showCreditTrace
        unifiedItemsScroll
        creditTraceEntity="compra"
        title={
          detalleMovimientoState.row?.tipo_registro === "nota_credito"
            ? "Detalle de la nota de crédito"
            : "Detalle del movimiento"
        }
      />

      <ModalEliminarMovimientos
        open={deleteState.open}
        row={{
          ...deleteState.row,
          id_movimiento: deleteState.row?.id_cobro ?? null,
          tipo_movimiento: "Cobro CC Proveedor",
          detalle: deleteState.row
            ? `Comprobante: ${safeText(deleteState.row.comprobante) || "-"} · Fecha: ${
                formatDisplayDate(deleteState.row.fecha || deleteState.row.fecha_raw) || "-"
              }`
            : "",
          monto_total: Number(deleteState.row?.credito || 0),
        }}
        loading={deleteState.loading}
        onClose={closeDeleteModal}
        onConfirm={confirmDeleteCobro}
        onToast={showToast}
        title="Eliminar registro de cobro"
        message="¿Seguro que querés eliminar solo este cobro de la cuenta corriente?"
        warning="No se eliminará la deuda ni el movimiento original. Solo el cobro seleccionado."
        loadingMessage="Eliminando cobro…"
        successMessage="Cobro eliminado correctamente."
        errorMessage="No se pudo eliminar el cobro."
        confirmLabel="Eliminar cobro"
        cancelLabel="Cancelar"
      />

      <ModalProveedores
        open={modalProveedoresOpen}
        onClose={() => setModalProveedoresOpen(false)}
        onActualizado={refreshAfterProveedoresUpdate}
        onToast={showToast}
      />

      <div className={`mov-card__head cc-accountHeader ${isDetailMode ? "is-detail" : ""}`}>
        <div className="mov-card__headLeft">
          <div className="title-mov">
            <div className="cc-accountHeader__nameRow">
              <div className="mov-card__title cc-accountHeader__entityName">
                {isDetailMode ? `${selectedProveedor.nombre}` : "Cuentas Corrientes"}
              </div>

              {isDetailMode && (
                <div className="cc-accountHeader__nameInfo">
                  <button
                    type="button"
                    className="cc-accountHeader__nameInfoButton"
                    aria-label="Mostrar nombre completo del proveedor"
                    aria-describedby="cc-proveedor-name-tooltip"
                  >
                    <FontAwesomeIcon icon={faInfoCircle} />
                  </button>

                  <span
                    id="cc-proveedor-name-tooltip"
                    className="cc-accountHeader__nameTooltip"
                    role="tooltip"
                  >
                    {selectedProveedor.nombre}
                  </span>
                </div>
              )}
            </div>

            <div className="mov-card__hint">
              {isDetailMode ? (
                <>
                  Mostrando <b>{detailCount}</b> registro{detailCount === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  Mostrando <b>{filteredSummaryRows.length}</b> proveedor
                  {filteredSummaryRows.length === 1 ? "" : "es"}
                </>
              )}
            </div>
          </div>

          {isDetailMode && renderDetailTabs("cc-detailTabs--top cc-detailTabs--between-title-period")}

          <div className="mov-headFilters">
            {isDetailMode && (
              <>
                <div className="cc-filter cc-filter--cal">
                  <div
                    className={`cc-floatingField cc-floatingField--calendar is-active ${
                      calOpen ? "is-open" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={`cc-calTrigger ${calOpen ? "is-open" : ""}`}
                      onClick={() => setCalOpen((v) => !v)}
                      disabled={loading}
                    >
                      {rangeLabel}
                      <span className="cc-calTrigger__iconRight">
                        <FontAwesomeIcon icon={faChevronDown} />
                      </span>
                    </button>

                    <span className="cc-floatingLabel cc-floatingLabel--active">
                      <FontAwesomeIcon icon={faCalendarDays} /> Período
                    </span>

                    {calOpen && (
                      <div className="cc-calDropdown">
                        <Calendario
                          value={dateRange}
                          onChange={(range) => {
                            setDateRange(range);
                            if (range?.from && range?.to) setCalOpen(false);
                          }}
                          onClose={() => setCalOpen(false)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="cc-filter cc-filter--search" id="vents-comppr-wits">
              <div className="cc-floatingField cc-floatingField--search is-active">
                <div className="cc-searchInput">
                  <div className="cc-searchInput__fieldWrap">
                    <input
                      className="cc-input cc-input--floating"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Buscar por proveedor..."
                      disabled={loading}
                    />

                    <span className="cc-floatingLabel">
                      <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                    </span>

                    {safeText(q) !== "" && !loading && (
                      <button
                        type="button"
                        className="cc-clearSearch cc-clearSearch--inside"
                        onClick={() => setQ("")}
                      >
                        <FontAwesomeIcon icon={faTimes} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="cc-row-actions">
              <button
                type="button"
                className="mov-btn mov-btn--ghost mov-btn--icon cc-row-actions__btn"
                onClick={() => setModalProveedoresOpen(true)}
                disabled={loading}
                title={!isDetailMode ? "Proveedores" : "Nuevo proveedor"}
              >
                <FontAwesomeIcon icon={faUserPlus} />
                {!isDetailMode && <span style={{ marginLeft: 8 }}>Proveedores</span>}
              </button>

              <div className="cc-row-actions__export">
                <BotonExportar
                  disabled={loading || (isDetailMode ? detailRows.length === 0 : filteredSummaryRows.length === 0)}
                  loading={false}
                  label="Exportar"
                  opciones={exportOptions}
                  align="right"
                />
              </div>

              {isDetailMode && (
                <button
                  type="button"
                  className="mov-btn mov-btn--ghost mov-btn--icon cc-row-actions__btn"
                  onClick={volverAlListado}
                  title="Volver"
                >
                  <FontAwesomeIcon icon={faArrowLeft} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {!isDetailMode ? (
        <div className="cc-cliente-table">
          <div
            className="mov-gridTable mov-gridTable--head cc-cliente-table__desktopHead"
            style={{ gridTemplateColumns: "2fr 1fr" }}
          >
            <div className="mov-gridCell mov-gridCell--head">Proveedor</div>
            <div className="mov-gridCell mov-gridCell--head is-right">Saldo actual</div>
          </div>

          <div className="cc-cliente-table__body">
            {loading ? (
              <div className="mov-emptyRow">Cargando proveedores…</div>
            ) : filteredSummaryRows.length > 0 ? (
              filteredSummaryRows.map((r) => (
                <button
                  key={r.id_proveedor}
                  type="button"
                  className="mov-gridTable mov-gridTable--row cc-cliente-table__movRow"
                  style={{ gridTemplateColumns: "2fr 1fr", width: "100%" }}
                  onClick={() => loadHistorial(r)}
                >
                  <div className="mov-gridCell is-strong">
                    <span className="mov-ellipsissss mov-ellipsialingf">{r.nombre || "-"}</span>
                  </div>
                  <div className="mov-gridCell is-right is-strong">
                    <span className={`mov-ellipsissss ${saldoProveedorToneClass(r.saldo)}`}>{moneyARS(r.saldo || 0)}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="mov-emptyRow cc-emptyState">
                <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                <div className="cc-emptyText">No se encontraron proveedores.</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="cc-cliente-table cc-cliente-table--detail">
          <div
            className="mov-gridTable mov-gridTable--head cc-cliente-table__desktopHead"
            style={{ gridTemplateColumns: ".8fr 2.2fr 1fr 1fr 1fr .9fr" }}
          >
            <div className="mov-gridCell mov-gridCell--head">Fecha</div>
            <div className="mov-gridCell mov-gridCell--head">{isHistorialTab ? "Movimiento" : "Comprobante"}</div>
            <div className="mov-gridCell mov-gridCell--head is-right">{isHistorialTab ? "Total" : "Débito"}</div>
            <div className="mov-gridCell mov-gridCell--head is-right">{isHistorialTab ? "Pagado" : "Crédito"}</div>
            <div className="mov-gridCell mov-gridCell--head is-right">Saldo</div>
            <div className="mov-gridCell mov-gridCell--head is-center">Acciones</div>
          </div>

          <div className="cc-cliente-table__body">
            {loading ? (
              <div className="mov-emptyRow">{isHistorialTab ? "Cargando historial completo…" : "Cargando cuenta corriente del proveedor…"}</div>
            ) : detailRows.length > 0 ? (
              detailRows.map((r, i) => {
                const verHabilitado = canPreviewComprobante(r);
                const puedeEliminar = !isHistorialTab && canDeleteCobro(r);
                const isSaldoInicial = r?.tipo_registro === "saldo_inicial";
                const isNotaCredito = !isHistorialTab && r?.tipo_registro === "nota_credito";
                const isCobro = !isHistorialTab && !isNotaCredito && !isSaldoInicial && Number(r.credito || 0) > 0;
                const puedeVerDetalle =
                  !isSaldoInicial && (isHistorialTab || isNotaCredito || (!isCobro && Number(r.debito || 0) > 0));

                return (
                  <div
                    key={r.id || `${i}`}
                    className="mov-gridTable mov-gridTable--row"
                    style={{ gridTemplateColumns: ".8fr 2.2fr 1fr 1fr 1fr .9fr" }}
                  >
                    <div className="mov-gridCell">
                      <span className="mov-ellipsissss">
                        {formatDisplayDate(r.fecha || r.fecha_raw)}
                      </span>
                    </div>

                    <div className="mov-gridCell is-strong">
                      <span className="mov-ellipsissss">{r.comprobante || "-"}</span>
                    </div>

                    <div className="mov-gridCell is-right">
                      <span className="mov-ellipsissss cc-money cc-money--negative">
                        {Number(r.debito || 0) > 0 ? moneyARS(r.debito) : "—"}
                      </span>
                    </div>

                    <div className="mov-gridCell is-right">
                      <span className="mov-ellipsissss cc-money cc-money--positive">
                        {Number(r.credito || 0) > 0 ? moneyARS(r.credito) : "—"}
                      </span>
                    </div>

                    <div className="mov-gridCell is-right is-strong">
                      <span className={`mov-ellipsissss ${saldoMovimientoToneClass(r)}`}>{moneyARS(r.saldo || 0)}</span>
                    </div>

                    <div className="mov-gridCell mov-gridCell--actions">
                      <div className="mov-actionsInline">
                        <button
                          type="button"
                          onMouseEnter={() => verHabilitado && handlePrewarmComprobante(r)}
                          onPointerEnter={() => verHabilitado && handlePrewarmComprobante(r)}
                          onFocus={() => verHabilitado && handlePrewarmComprobante(r)}
                          onClick={() => verHabilitado && openComprobante(r)}
                          disabled={!verHabilitado}
                          title={
                            verHabilitado
                              ? isNotaCredito
                                ? "Ver nota de crédito"
                                : isCobro
                                ? "Ver recibo / comprobante del cobro"
                                : "Ver factura / comprobante de la deuda"
                              : "Este registro no tiene comprobante asociado"
                          }
                          className="mov-iconBtn"
                        >
                          <FontAwesomeIcon icon={faEye} />
                        </button>

                        {puedeVerDetalle ? (
                          <button
                            type="button"
                            onClick={() => openDetalleMovimiento(r)}
                            title={isNotaCredito ? "Ver detalle completo de la nota de crédito" : "Ver detalle completo del movimiento"}
                            className="mov-iconBtn"
                          >
                            <FontAwesomeIcon icon={faInfoCircle} />
                          </button>
                        ) : null}

                        {puedeEliminar ? (
                          <button
                            type="button"
                            onClick={() => askDeleteCobro(r)}
                            title="Eliminar solo este registro de cobro"
                            className="mov-iconBtn mov-iconBtn--danger"
                          >
                            <FontAwesomeIcon icon={faTrashCan} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="mov-emptyRow cc-emptyState">
                <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                <div className="cc-emptyText">
                  {hasSearched
                    ? isHistorialTab
                      ? `No se encontraron movimientos en el historial de "${queryUsed}".`
                      : `No se encontraron registros de cuenta corriente para "${queryUsed}".`
                    : "Sin movimientos para mostrar."}
                </div>
              </div>
            )}
          </div>

          <div className="cc-cliente-table__footWrap">
            <div
              className="mov-gridTable mov-gridTable_rsp"
              style={{ gridTemplateColumns: ".8fr 2.2fr 1fr 1fr 1fr .9fr" }}
            >
              <div className="mov-gridCell is-strong">Totales</div>
              <div className="mov-gridCell mov-gridCellf vacio"></div>
              <div className="mov-gridCell mov-gridCellf is-right is-strong cc-money cc-money--negative">
                {moneyARS(detailTotales?.debito || 0)}
              </div>
              <div className="mov-gridCell mov-gridCellf is-right is-strong cc-money cc-money--positive">
                {moneyARS(detailTotales?.credito || 0)}
              </div>
              <div className={`mov-gridCell mov-gridCellf is-right is-strong ${saldoTotalProveedorToneClass(detailTotales)}`}>
                {moneyARS(detailTotales?.saldo || 0)}
              </div>
              <div className="mov-gridCell vacio mov-gridCellf"></div>
            </div>
          </div>
        </div>
      )}

      {isDetailMode && renderDetailTabs("cc-detailTabs--bottom")}
    </div>
  );
}
