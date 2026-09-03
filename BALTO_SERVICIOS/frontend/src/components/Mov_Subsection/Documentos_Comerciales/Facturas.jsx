import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/roots.css";
import "../../Global/Global_css/Global_oscuro.css";
import "./DocumentosComerciales.css";
import "./DocumentosComercialesResponsive.css";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import { readMovPerfCache, writeMovPerfCache, MOV_CACHE_LONG_TTL_MS } from "../_shared/performanceCache.js";
import { buildDocumentosUrl, documentosRequest } from "./api/documentosComercialesApi.js";
import { formatFecha, isDocumentosNetworkError, moneyARS, normalizeText, safeText } from "./utils/documentosComercialesUtils.js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxesStacked,
  faDownload,
  faEye,
  faFileInvoiceDollar,
  faFilePdf,
  faMagnifyingGlass,
  faReceipt,
  faTimes,
  faUser,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

const DOCUMENTOS_TABS = [
  { key: "presupuesto", label: "Presupuestos", path: "/panel/presupuesto" },
  { key: "facturas", label: "Facturas", path: "/panel/facturacion" },
  { key: "remitos", label: "Remitos", path: "/panel/remitos" },
];

function DocumentosTabs({ activeKey }) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleTabClick = (tab) => {
    if (!tab?.path || location.pathname === tab.path) return;
    navigate(tab.path);
  };

  return (
    <div
      className="doccom-googleTabs"
      role="tablist"
      aria-label="Pestañas de documentos comerciales"
    >
      {DOCUMENTOS_TABS.map((tab) => {
        const isActive = tab.key === activeKey;

        return (
          <button
            key={tab.key}
            type="button"
            className={`doccom-googleTab ${isActive ? "is-active" : ""}`}
            role="tab"
            aria-selected={isActive}
            onClick={() => handleTabClick(tab)}
          >
            <span className="doccom-googleTab__label">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const CLIENTES_LIMIT = 120;
const SKELETON_ROWS = 6;

function getAuthHeaders() {
  const headers = { Accept: "application/json" };
  const token = String(localStorage.getItem("token") || "").trim();
  const sessionKey = String(
    localStorage.getItem("session_key") ||
      localStorage.getItem("sessionKey") ||
      localStorage.getItem("X-Session") ||
      ""
  ).trim();

  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionKey) headers["X-Session"] = sessionKey;
  return headers;
}

async function apiGetJson(url) {
  try {
    const res = await documentosRequest(url, {
      method: "GET",
      headers: getAuthHeaders(),
      cache: "no-store",
      timeoutMs: 20000,
    });
    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("La API no devolvió JSON válido.");
    }

    if (!res.ok || data?.exito === false || data?.success === false) {
      throw new Error(data?.mensaje || data?.message || "No se pudo completar la operación.");
    }

    return data || {};
  } catch (err) {
    if (err?.isCancelled) throw err;

    if (isDocumentosNetworkError(err)) {
      const e = new Error("Sin conexión o servidor no disponible. Cuando vuelva Internet, los datos se actualizarán automáticamente.");
      e.isNetworkError = true;
      throw e;
    }

    throw err;
  }
}

function getDocumentoIcon(tipo) {
  const t = String(tipo || "").toUpperCase();
  if (t === "REMITO") return faBoxesStacked;
  if (t === "VENTA_NO_FACTURADA") return faReceipt;
  return faFileInvoiceDollar;
}

function getDocumentoEstado(doc) {
  const tipo = String(doc?.tipo || "").toUpperCase();
  if (tipo === "FACTURA") return doc?.emitido_en_arca ? "EMITIDA EN ARCA" : "FACTURA";
  if (tipo === "VENTA_NO_FACTURADA") return "NO EMITIDA";
  if (tipo === "REMITO") return "REMITO";
  if (tipo === "NOTA_CREDITO") return "NOTA DE CRÉDITO";
  if (tipo === "NOTA_DEBITO") return "NOTA DE DÉBITO";
  if (tipo === "PRESUPUESTO") return "PRESUPUESTO";
  return safeText(doc?.documento_label || tipo, "DOCUMENTO").toUpperCase();
}

function getClienteDisplay(cliente) {
  return safeText(cliente?.razon_social || cliente?.nombre, "Cliente sin nombre");
}

function getClienteSubtext(cliente) {
  const partes = [];
  if (cliente?.nombre && cliente?.razon_social && cliente.nombre !== cliente.razon_social) partes.push(cliente.nombre);
  if (cliente?.cuit) partes.push(`CUIT ${cliente.cuit}`);
  if (cliente?.condicion_iva) partes.push(cliente.condicion_iva);
  return partes.length ? partes.join(" · ") : "Sin datos fiscales cargados";
}

function getDocumentActions(grupo) {
  const g = normalizeText(grupo);
  if (g === "remitos" || g === "remito") {
    return {
      clientes: "documentos_comerciales_remitos_clientes_listar",
      documentos: "documentos_comerciales_remitos_documentos_cliente",
      includeGrupo: false,
    };
  }
  if (g === "facturas" || g === "factura" || g === "facturacion") {
    return {
      clientes: "documentos_comerciales_facturas_clientes_listar",
      documentos: "documentos_comerciales_facturas_documentos_cliente",
      includeGrupo: false,
    };
  }
  return {
    clientes: "documentos_comerciales_clientes_listar",
    documentos: "documentos_comerciales_documentos_cliente",
    includeGrupo: true,
  };
}

function DocumentosClientePanel({
  grupo = "facturas",
  titulo = "Facturas",
  subtitulo = "Facturas emitidas, no emitidas y comprobantes fiscales del cliente.",
  emptyTitle = "Seleccioná un cliente",
  emptyText = "Elegí un cliente de la lista para ver sus documentos.",
  clienteCounterLabel = "Clientes con documentos",
  totalCounterLabel = "Documentos encontrados",
  visibleCounterLabel = "Documentos visibles",
  documentoSingular = "documento",
  documentoPlural = "documentos",
  searchPlaceholder = "Buscar por número, tipo o producto...",
  noDocsTitle = "No hay documentos para este cliente",
  noDocsText = "Probá con otro cliente o limpiá la búsqueda.",
  navigationTabs = null,
}) {
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();
  const [qClientes, setQClientes] = useState("");
  const [qDocumentos, setQDocumentos] = useState("");
  const [clientes, setClientes] = useState([]);
  const [documentos, setDocumentos] = useState([]);
  const [selectedCliente, setSelectedCliente] = useState(null);
  const [loadingClientes, setLoadingClientes] = useState(true);
  const [loadingDocumentos, setLoadingDocumentos] = useState(false);
  const [documentosLoaded, setDocumentosLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [openVerComprobante, setOpenVerComprobante] = useState(false);
  const [comprobanteUrl, setComprobanteUrl] = useState("");
  const [comprobanteMime, setComprobanteMime] = useState("application/pdf");
  const [comprobanteTitle, setComprobanteTitle] = useState("Comprobante");
  const mountedRef = useRef(true);
  const signedUrlCacheRef = useRef(new Map());
  const documentActions = useMemo(() => getDocumentActions(grupo), [grupo]);
  const gridCols = "1.15fr 0.85fr 1.65fr 0.95fr 0.95fr 0.8fr";
  const documentoHeader = documentoSingular.charAt(0).toUpperCase() + documentoSingular.slice(1);

  const skelWidths = useMemo(
    () => ({
      documento: ["64%", "52%", "70%", "46%"],
      fecha: ["44%", "38%", "42%", "34%"],
      detalle: ["74%", "62%", "68%", "54%"],
      estado: ["56%", "46%", "52%", "42%"],
      total: ["42%", "34%", "38%", "30%"],
    }),
    []
  );

  const renderSkeletonRow = useCallback(
    (idx) => (
      <div
        key={`skel-${idx}`}
        className="mov-gridTable mov-gridTable--row doccom-docGridRow mov-row--skeleton"
        style={{ gridTemplateColumns: gridCols }}
        role="row"
        aria-hidden="true"
      >
        <div className="mov-gridCell is-strong" role="cell" data-label={documentoHeader}>
          <span
            className="mov-skeletonBar"
            style={{ width: skelWidths.documento[idx % skelWidths.documento.length] }}
          />
        </div>
        <div className="mov-gridCell" role="cell" data-label="Fecha">
          <span
            className="mov-skeletonBar"
            style={{ width: skelWidths.fecha[idx % skelWidths.fecha.length] }}
          />
        </div>
        <div className="mov-gridCell" role="cell" data-label="Detalle">
          <span
            className="mov-skeletonBar"
            style={{ width: skelWidths.detalle[idx % skelWidths.detalle.length] }}
          />
        </div>
        <div className="mov-gridCell is-center" role="cell" data-label="Estado">
          <span
            className="mov-skeletonBar"
            style={{ width: skelWidths.estado[idx % skelWidths.estado.length] }}
          />
        </div>
        <div className="mov-gridCell is-right" role="cell" data-label="Total">
          <span
            className="mov-skeletonBar"
            style={{ width: skelWidths.total[idx % skelWidths.total.length] }}
          />
        </div>
        <div className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label="PDF">
          <div className="mov-skelActions">
            <span className="mov-skelIcon" />
            <span className="mov-skelIcon" />
          </div>
        </div>
      </div>
    ),
    [documentoHeader, gridCols, skelWidths]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleReconnect = () => {
      setError("");
      setReloadTick((tick) => tick + 1);
    };

    window.addEventListener("net:reconnected", handleReconnect);
    return () => window.removeEventListener("net:reconnected", handleReconnect);
  }, []);

  const totalDocumentos = useMemo(
    () => clientes.reduce((acc, cli) => acc + Number(cli?.total_documentos || 0), 0),
    [clientes]
  );

  const filteredDocumentos = useMemo(() => {
    const q = normalizeText(qDocumentos);
    if (!q) return documentos;

    return documentos.filter((doc) => {
      const texto = normalizeText([
        doc?.numero_visual,
        doc?.documento_label,
        doc?.tipo,
        doc?.detalle,
        doc?.cliente,
        doc?.razon_social,
        doc?.id_comprobante,
        doc?.id_movimiento,
        doc?.cbte_nro,
      ].join(" "));
      return texto.includes(q);
    });
  }, [documentos, qDocumentos]);

  const cargarClientes = useCallback(async () => {
    const cacheKey = `${grupo}|${qClientes}|${CLIENTES_LIMIT}`;
    const cached = readMovPerfCache(`documentos:${grupo}:clientes`, cacheKey, MOV_CACHE_LONG_TTL_MS);

    if (cached?.clientes && mountedRef.current) {
      const cachedRows = Array.isArray(cached.clientes) ? cached.clientes : [];
      setClientes(cachedRows);
      setSelectedCliente((prev) => {
        if (prev && cachedRows.some((cli) => Number(cli.id_cliente) === Number(prev.id_cliente))) return prev;
        return cachedRows[0] || null;
      });
      setLoadingClientes(false);
    } else {
      setLoadingClientes(true);
    }
    setError("");

    try {
      const data = await apiGetJson(
        buildDocumentosUrl(documentActions.clientes, {
          ...(documentActions.includeGrupo ? { grupo } : {}),
          q: qClientes,
          limit: CLIENTES_LIMIT,
          solo_con_documentos: 1,
        })
      );

      const rows = Array.isArray(data?.clientes) ? data.clientes : [];
      if (!mountedRef.current) return;

      setClientes(rows);
      writeMovPerfCache(`documentos:${grupo}:clientes`, cacheKey, { clientes: rows });
      setSelectedCliente((prev) => {
        if (prev && rows.some((cli) => Number(cli.id_cliente) === Number(prev.id_cliente))) return prev;
        return rows[0] || null;
      });
    } catch (err) {
      if (!mountedRef.current || err?.isCancelled) return;

      if (err?.isNetworkError) {
        setError("");
        return;
      }

      setClientes([]);
      setSelectedCliente(null);
      setError(err?.message || "No se pudieron cargar los clientes.");
    } finally {
      if (mountedRef.current) setLoadingClientes(false);
    }
  }, [documentActions, grupo, qClientes]);

  const cargarDocumentos = useCallback(async () => {
    const idCliente = Number(selectedCliente?.id_cliente || 0);
    if (!idCliente) {
      setDocumentos([]);
      setDocumentosLoaded(false);
      setLoadingDocumentos(false);
      return;
    }

    const cacheKey = `${grupo}|${idCliente}`;
    const cached = readMovPerfCache(`documentos:${grupo}:documentos`, cacheKey, MOV_CACHE_LONG_TTL_MS);
    if (cached?.documentos && mountedRef.current) {
      setDocumentos(Array.isArray(cached.documentos) ? cached.documentos : []);
      setDocumentosLoaded(true);
      setLoadingDocumentos(false);
    } else {
      setLoadingDocumentos(true);
      setDocumentosLoaded(false);
    }
    setError("");

    try {
      const data = await apiGetJson(
        buildDocumentosUrl(documentActions.documentos, {
          ...(documentActions.includeGrupo ? { grupo } : {}),
          id_cliente: idCliente,
        })
      );
      const rows = Array.isArray(data?.documentos) ? data.documentos : [];
      if (!mountedRef.current) return;
      setDocumentos(rows);
      writeMovPerfCache(`documentos:${grupo}:documentos`, cacheKey, { documentos: rows });
      setDocumentosLoaded(true);
    } catch (err) {
      if (!mountedRef.current || err?.isCancelled) return;

      if (err?.isNetworkError) {
        setError("");
        setDocumentosLoaded(true);
        return;
      }

      setDocumentos([]);
      setDocumentosLoaded(true);
      setError(err?.message || "No se pudieron cargar los documentos del cliente.");
    } finally {
      if (mountedRef.current) setLoadingDocumentos(false);
    }
  }, [documentActions, grupo, selectedCliente]);

  useEffect(() => {
    cargarClientes();
  }, [cargarClientes, reloadTick]);

  useEffect(() => {
    cargarDocumentos();
  }, [cargarDocumentos, reloadTick]);

  const showClientesSkeleton = loadingClientes;
  const showPanelSkeleton = Boolean(
    loadingClientes ||
      loadingDocumentos ||
      (selectedCliente && !documentosLoaded)
  );
  const showTablePanel = Boolean(selectedCliente) || showPanelSkeleton;

  const handleVerDocumento = async (doc) => {
    const id = Number(doc?.id_comprobante || 0);
    if (!id) {
      setError("Este documento no tiene comprobante asociado.");
      return;
    }

    try {
      setError("");
      let url = signedUrlCacheRef.current.get(String(id)) || "";
      if (!url) {
        const data = await apiGetJson(
          buildDocumentosUrl("ventas_comprobantes_descargar", { id_comprobante: id })
        );
        url = data?.url || data?.archivo_url || data?.download_url || "";
        if (url) signedUrlCacheRef.current.set(String(id), url);
      }
      if (!url) throw new Error("No se pudo obtener el enlace del PDF.");

      setComprobanteUrl(url);
      setComprobanteMime(safeText(doc?.archivo_mime, "application/pdf"));
      setComprobanteTitle(safeText(doc?.numero_visual || doc?.documento_label, "Comprobante"));
      setOpenVerComprobante(true);
    } catch (err) {
      setError(err?.message || "No se pudo abrir el comprobante.");
    }
  };

  const handleAbrirNuevaPestana = async (doc) => {
    const id = Number(doc?.id_comprobante || 0);
    if (!id) return;

    try {
      setError("");
      let url = signedUrlCacheRef.current.get(String(id)) || "";
      if (!url) {
        const data = await apiGetJson(
          buildDocumentosUrl("ventas_comprobantes_descargar", { id_comprobante: id })
        );
        url = data?.url || data?.archivo_url || data?.download_url || "";
        if (url) signedUrlCacheRef.current.set(String(id), url);
      }
      if (!url) throw new Error("No se pudo obtener el enlace del PDF.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err?.message || "No se pudo abrir el PDF en una nueva pestaña.");
    }
  };

  return (
    <div
      id={`doccom-${normalizeText(grupo) || "documentos"}-section`}
      className="doccom-subpage mov-page"
    >
      <section className="mov-card mov-card--table doccom-clientDocs">
        <div className="mov-card__head doccom-clientDocs__head">
          <div className="mov-card__headLeft">
            <div className="title-mov doccom-titleBlock">
              {navigationTabs && (
                <div className="doccom-tabsRow doccom-tabsRow--head">
                  {navigationTabs}
                </div>
              )}
            </div>
          </div>

          <div className="doccom-clientDocs__summary" aria-label="Resumen de documentos">
            <div>
              <strong>{clientes.length}</strong>
              <span>{clienteCounterLabel}</span>
            </div>
            <div>
              <strong>{totalDocumentos}</strong>
              <span>{totalCounterLabel}</span>
            </div>
            <div>
              <strong>{filteredDocumentos.length}</strong>
              <span>{visibleCounterLabel}</span>
            </div>
          </div>
        </div>

        {error ? <div className="doccom-alert">{error}</div> : null}

        <div className="doccom-clientDocs__layout">
          <aside className="doccom-clientList" aria-label="Clientes">
            <div className="cc-filter doccom-filter doccom-filter--clientes">
              <div className="cc-floatingField cc-floatingField--search is-active">
                <div className="cc-searchInput">
                  <div className="cc-searchInput__fieldWrap">
                    <input
                      className="cc-input cc-input--floating"
                      id={`doccom-clientes-${grupo}`}
                      type="text"
                      value={qClientes}
                      onChange={(e) => setQClientes(e.target.value)}
                      placeholder="Buscar cliente..."
                    />
                    <span className="cc-floatingLabel">
                      <FontAwesomeIcon icon={faMagnifyingGlass} /> Cliente
                    </span>
                    {qClientes.trim() !== "" && (
                      <button
                        type="button"
                        className="cc-clearSearch cc-clearSearch--inside"
                        title="Limpiar búsqueda"
                        onClick={() => setQClientes("")}
                      >
                        <FontAwesomeIcon icon={faTimes} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="doccom-clientList__body">
              {showClientesSkeleton ? (
                Array.from({ length: 7 }).map((_, idx) => (
                  <div className="doccom-clientSkeleton" key={idx} />
                ))
              ) : clientes.length ? (
                clientes.map((cliente) => {
                  const active = Number(selectedCliente?.id_cliente) === Number(cliente.id_cliente);
                  return (
                    <button
                      type="button"
                      key={cliente.id_cliente}
                      className={`doccom-clientItem ${active ? "is-active" : ""}`}
                      onClick={() => {
                        setSelectedCliente(cliente);
                        setQDocumentos("");
                        setDocumentos([]);
                        setDocumentosLoaded(false);
                      }}
                    >
                      <span className="doccom-clientItem__icon">
                        <FontAwesomeIcon icon={faUser} />
                      </span>
                      <span className="doccom-clientItem__main">
                        <strong>{getClienteDisplay(cliente)}</strong>
                        <small>{getClienteSubtext(cliente)}</small>
                      </span>
                      <span className="doccom-clientItem__count">
                        {Number(cliente.total_documentos || 0)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="doccom-emptyMini">
                  <FontAwesomeIcon icon={faUsers} />
                  <strong>No hay clientes para mostrar</strong>
                  <span>Cuando existan {documentoPlural} guardados, van a aparecer acá.</span>
                </div>
              )}
            </div>
          </aside>

          <main className="doccom-docPanel" aria-label="Documentos del cliente">
            {showTablePanel ? (
              <>
                <div className="doccom-docPanel__top">
                  <div>
                    <span>Cliente seleccionado</span>
                    <h3>{selectedCliente ? getClienteDisplay(selectedCliente) : "Cargando documentos..."}</h3>
                    <p>{selectedCliente ? getClienteSubtext(selectedCliente) : "Preparando la tabla."}</p>
                  </div>

                  <div className="cc-filter doccom-filter doccom-filter--docs">
                    <div className="cc-floatingField cc-floatingField--search is-active">
                      <div className="cc-searchInput">
                        <div className="cc-searchInput__fieldWrap">
                          <input
                            className="cc-input cc-input--floating"
                            id={`doccom-documentos-${grupo}`}
                            type="text"
                            value={qDocumentos}
                            onChange={(e) => setQDocumentos(e.target.value)}
                            placeholder={searchPlaceholder}
                            disabled={!selectedCliente}
                          />
                          <span className="cc-floatingLabel">
                            <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                          </span>
                          {qDocumentos.trim() !== "" && selectedCliente && (
                            <button
                              type="button"
                              className="cc-clearSearch cc-clearSearch--inside"
                              title="Limpiar búsqueda"
                              onClick={() => setQDocumentos("")}
                            >
                              <FontAwesomeIcon icon={faTimes} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  id={`doccom-${normalizeText(grupo) || "documentos"}-tableWrap`}
                  className="doccom-docTableWrap"
                  role="rowgroup"
                  ref={tableWrapRef}
                >
                  <div
                    className={`mov-gridTable mov-gridTable--head doccom-docGridHead ${
                      hasTableScroll ? "has-y-scroll" : ""
                    }`}
                    style={{ gridTemplateColumns: gridCols }}
                    role="row"
                  >
                    <div className="mov-gridCell mov-gridCell--head" role="columnheader">
                      {documentoHeader}
                    </div>
                    <div className="mov-gridCell mov-gridCell--head" role="columnheader">Fecha</div>
                    <div className="mov-gridCell mov-gridCell--head" role="columnheader">Detalle</div>
                    <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Estado</div>
                    <div className="mov-gridCell mov-gridCell--head is-right" role="columnheader">Total</div>
                    <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">PDF</div>
                  </div>

                  <div className={["mov-gridBody", "doccom-docGridBody", showPanelSkeleton ? "mov-softLoading" : ""].join(" ")}>
                    {showPanelSkeleton ? (
                      <div className="mov-skeletonWrap" aria-busy="true">
                        {Array.from({ length: SKELETON_ROWS }).map((_, idx) => renderSkeletonRow(idx))}
                      </div>
                    ) : filteredDocumentos.length ? (
                      filteredDocumentos.map((doc) => (
                        <div
                          key={`${doc.id_comprobante}-${doc.tipo}`}
                          className="mov-gridTable mov-gridTable--row doccom-docGridRow"
                          style={{ gridTemplateColumns: gridCols }}
                          role="row"
                        >
                          <div className="mov-gridCell is-strong" role="cell" data-label={documentoHeader}>
                            <div className="doccom-docMain">

                              <span>
                                <button type="button" onClick={() => handleVerDocumento(doc)}>
                                  {safeText(doc.numero_visual || doc.documento_label)}
                                </button>
                                <small>ID comprobante #{doc.id_comprobante}</small>
                              </span>
                            </div>
                          </div>
                          <div className="mov-gridCell" role="cell" data-label="Fecha">
                            <span className="mov-ellipsissss">{formatFecha(doc.fecha_cbte || doc.fecha || doc.created_at)}</span>
                          </div>
                          <div className="mov-gridCell" role="cell" data-label="Detalle">
                            <span className="doccom-docDetalle">
                              <strong>{safeText(doc.documento_label)}</strong>
                              <small>{safeText(doc.detalle, "Sin detalle cargado")}</small>
                            </span>
                          </div>
                          <div className="mov-gridCell is-center" role="cell" data-label="Estado">
                            <span className={`doccom-status doccom-status--${String(doc.tipo || "doc").toLowerCase()}`}>
                              {getDocumentoEstado(doc)}
                            </span>
                          </div>
                          <div className="mov-gridCell is-right is-strong" role="cell" data-label="Total">
                            <span>{moneyARS(doc.monto_total)}</span>
                          </div>
                          <div className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label="PDF">
                            <div className="mov-actionsInline doccom-actions">
                              <button type="button" className="mov-iconBtn" title="Ver PDF" onClick={() => handleVerDocumento(doc)}>
                                <FontAwesomeIcon icon={faEye} />
                              </button>
                              <button type="button" className="mov-iconBtn" title="Abrir PDF" onClick={() => handleAbrirNuevaPestana(doc)}>
                                <FontAwesomeIcon icon={faDownload} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="cc-emptyState doccom-emptyMini doccom-emptyMini--table">
                        <FontAwesomeIcon icon={faFilePdf} className="cc-emptyIcon" />
                        <strong>{noDocsTitle}</strong>
                        <span>{noDocsText}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="doccom-emptyStateBig">
                <FontAwesomeIcon icon={faFilePdf} />
                <h3>{emptyTitle}</h3>
                <p>{emptyText}</p>
              </div>
            )}
          </main>
        </div>
      </section>

      <ModalVerComprobante
        open={openVerComprobante}
        url={comprobanteUrl}
        mime={comprobanteMime}
        title={comprobanteTitle}
        onClose={() => {
          setOpenVerComprobante(false);
          setComprobanteUrl("");
          setComprobanteMime("application/pdf");
          setComprobanteTitle("Comprobante");
        }}
      />
    </div>
  );
}


export default function Facturas() {
  return (
    <DocumentosClientePanel
      navigationTabs={<DocumentosTabs activeKey="facturas" />}
      grupo="facturas"
      titulo="Facturación"
      subtitulo="Buscá un cliente y visualizá todas sus facturas emitidas, no emitidas, notas de crédito y notas de débito."
      emptyTitle="Seleccioná un cliente para ver sus facturas"
      emptyText="Acá se centralizan los PDFs fiscales y no fiscales generados desde ventas."
      clienteCounterLabel="Clientes con facturas"
      totalCounterLabel="Facturas encontradas"
      visibleCounterLabel="Facturas visibles"
      documentoSingular="factura"
      documentoPlural="facturas"
      searchPlaceholder="Buscar por número, tipo o producto..."
      noDocsTitle="No hay facturas para este cliente"
      noDocsText="Probá con otro cliente o limpiá la búsqueda."
    />
  );
}
