import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faBookOpen,
  faChevronLeft,
  faChevronRight,
  faCompress,
  faDownload,
  faExpand,
  faMagnifyingGlass,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import manualPdfUrl from "../../../utils/manuales/manual_funcional_balto_comercio.pdf";
import manualDocxUrl from "../../../utils/manuales/manual_funcional_balto_comercio.docx";
import { acquireBodyScrollLock } from "../../../utils/bodyScrollLock";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./ModalManualFuncional.css";

const TOTAL_PAGES = 90;

const MANUAL_SECTIONS = [
  { title: "Ingreso y navegación", page: 3, keywords: "login inicio sesión menu lateral perfil permisos rol plan" },
  { title: "Dashboard", page: 6, keywords: "panel indicadores ingresos egresos resumen stock" },
  { title: "Movimientos", page: 8, keywords: "movimientos vista general filtros exportar" },
  { title: "Ventas", page: 9, keywords: "ventas cliente factura nota crédito cheque stock" },
  { title: "Ventas - Facturación ARCA", page: 13, keywords: "facturar consumidor final sin identificar cuit arca receptor factura fiscal" },
  { title: "Compras", page: 17, keywords: "compras proveedor nota crédito cheque stock cuenta corriente" },
  { title: "Recibos", page: 23, keywords: "recibo cobrar cliente cuenta corriente cheque" },
  { title: "Órdenes de Pago", page: 27, keywords: "orden pago proveedor pagar cuenta corriente cheques" },
  { title: "Otros Ingresos", page: 30, keywords: "otros ingresos entrada dinero factura" },
  { title: "Otros Ingresos - Facturación", page: 32, keywords: "factura consumidor final cuit otros ingresos nota crédito" },
  { title: "Otros Egresos", page: 34, keywords: "egresos salida dinero gasto costo" },
  { title: "Presupuestos", page: 37, keywords: "presupuesto modelos convertir venta propuesta comercial" },
  { title: "Flujo de Caja", page: 46, keywords: "flujo caja saldos medios dinero ingresos egresos ajustes" },
  { title: "Flujo de Caja - Ajustar saldo", page: 48, keywords: "establecer saldo sumar importe restar monto motivo conciliacion arqueo" },
  { title: "Flujo de Caja - Historial y reversión", page: 48, keywords: "historial ajustes revertir compensatorio auditoria registros" },
  { title: "Cuentas Corrientes", page: 50, keywords: "cuentas corrientes deuda saldo clientes proveedores" },
  { title: "Cuentas Corrientes - Clientes", page: 50, keywords: "clientes cobros recibos historial" },
  { title: "Cuentas Corrientes - Proveedores", page: 57, keywords: "proveedores deuda pagos ordenes historial" },
  { title: "Stock", page: 61, keywords: "stock inventario productos existencias precios categorias unidades" },
  { title: "Stock - Productos", page: 62, keywords: "productos alta editar precios costo venta categoria unidad datos generales" },
  { title: "Stock - Variantes", page: 63, keywords: "variantes atributos existencias precios" },
  { title: "Stock - Códigos de barra", page: 64, keywords: "codigos barra barcode scanner" },
  { title: "Stock - Reportes", page: 65, keywords: "reportes inventario exportar" },
  { title: "Stock - Vencimientos y alertas", page: 67, keywords: "stock vencimiento partidas lotes fecha retiro fefo notificaciones alerta" },
  { title: "Contabilidad", page: 69, keywords: "contabilidad iva ventas compras libros" },
  { title: "IVA Ventas", page: 69, keywords: "iva ventas subtotal impuesto notas credito" },
  { title: "IVA Compras", page: 71, keywords: "iva compras subtotal impuesto proveedor" },
  { title: "Cheques y E-Cheqs", page: 73, keywords: "cheque echeq cartera deposito banco flujo" },
  { title: "Cheques en Cartera", page: 73, keywords: "cheques cartera depositar banco" },
  { title: "Flujo de Cheques", page: 74, keywords: "flujo cheques ingreso egreso deposito" },
  { title: "E-Cheqs en Cartera", page: 75, keywords: "echeq cartera depositar banco" },
  { title: "Flujo de E-Cheqs", page: 77, keywords: "flujo echeq ingreso egreso deposito" },
  { title: "Análisis Financiero", page: 79, keywords: "analisis financiero dinero resultado saldos conciliacion medios" },
  { title: "Análisis Financiero - Disponibilidad", page: 79, keywords: "disponibilidad dinero disponible cierre variacion cobros pagos conciliacion saldo inicial" },
  { title: "Análisis Financiero - Resultados", page: 80, keywords: "resultados operativo ingreso costo variable fijo personal retiros pendientes" },
  { title: "Análisis Financiero - Medios de pago", page: 80, keywords: "medios pago arranque apertura cobros pagos cierre efectivo banco" },
  { title: "Configuración", page: 82, keywords: "configuracion ajustes sistema" },
  { title: "Configuración - Tienda Nube", page: 82, keywords: "tienda nube integracion sincronizacion catalogo webhooks" },
  { title: "Configuración - Usuarios", page: 83, keywords: "usuarios roles acceso contraseña" },
  { title: "Configuración - Datos legales", page: 84, keywords: "datos legales fiscal cuit razon social iva punto venta" },
  { title: "Configuración - Saldos iniciales", page: 85, keywords: "saldos iniciales caja banco cheques cuentas corrientes apertura" },
  { title: "Configuración - Listas y categorías", page: 87, keywords: "listas categorias unidades medios detalles" },
  { title: "Configuración - Calendario global", page: 89, keywords: "calendario fechas periodo mes dias" },
  { title: "Configuración - Manual funcional", page: 90, keywords: "manual word pdf busqueda visor ayuda" },
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export default function ModalManualFuncional({ open, onClose }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const searchRef = useRef(null);
  const onCloseRef = useRef(onClose);

  const pdfUrl = manualPdfUrl;
  const docxUrl = manualDocxUrl;

  const filteredSections = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return MANUAL_SECTIONS.slice(0, 10);

    return MANUAL_SECTIONS.filter((item) => {
      const haystack = normalizeText(`${item.title} ${item.keywords}`);
      return q.split(/\s+/).every((term) => haystack.includes(term));
    }).slice(0, 10);
  }, [query]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const releaseScroll = acquireBodyScrollLock();

    const onKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 50);

    return () => {
      releaseScroll();
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setFullscreen(false);
      setQuery("");
      setPage(1);
    }
  }, [open]);

  if (!open) return null;

  const goToPage = (nextPage) => {
    const safe = Math.max(1, Math.min(TOTAL_PAGES, Number(nextPage) || 1));
    setPage(safe);
  };

  const viewerUrl = `${pdfUrl}#page=${page}&zoom=page-width`;

  const modalContent = (
    <div
      className={`gm-modal-overlay manual-modalOverlay ${fullscreen ? "is-fullscreen" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Manual funcional de BALTO Comercio"
    >
      <div className={`gm-modal-container gm-modal-v2 manual-modal ${fullscreen ? "is-fullscreen" : ""}`}>
        <header className="gm-modal-header manual-modalHeader">
          <div className="gm-modal-head-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faBookOpen} />
          </div>

          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">Manual funcional</h2>
            <p className="gm-modal-subtitle">BALTO Comercio · Versión noviembre 2026 · {TOTAL_PAGES} páginas</p>
          </div>

          <div className="manual-modalHeaderActions">
            <a
              className="manual-headerBtn manual-headerBtn--primary"
              href={docxUrl}
              download="manual_funcional_balto_comercio.docx"
              title="Descargar manual en Word"
            >
              <FontAwesomeIcon icon={faDownload} />
              <span>Descargar Word</span>
            </a>

            <button
              type="button"
              className="manual-headerIconBtn"
              onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")}
              title="Abrir el manual en una pestaña nueva"
              aria-label="Abrir en una pestaña nueva"
            >
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </button>

            <button
              type="button"
              className="manual-headerIconBtn"
              onClick={() => setFullscreen((value) => !value)}
              title={fullscreen ? "Salir de pantalla completa" : "Expandir manual"}
              aria-label={fullscreen ? "Salir de pantalla completa" : "Expandir manual"}
            >
              <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />
            </button>

            <button
              type="button"
              className="gm-modal-close"
              onClick={onClose}
              title="Cerrar manual"
              aria-label="Cerrar manual"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </header>

        <div className="gm-modal-content manual-modalContent">
          <div className="manual-toolbar">
          <div className="manual-searchWrap">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="manual-searchIcon" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar módulo o sección..."
              aria-label="Buscar módulo o sección del manual"
            />
            {query && (
              <button
                type="button"
                className="manual-searchClear"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                aria-label="Limpiar búsqueda"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            )}

            {(query || filteredSections.length > 0) && (
              <div className={`manual-searchResults ${query ? "is-visible" : ""}`}>
                {query && filteredSections.length === 0 ? (
                  <div className="manual-searchEmpty">No se encontraron módulos con esa búsqueda.</div>
                ) : (
                  query && filteredSections.map((item) => (
                    <button
                      type="button"
                      key={`${item.title}-${item.page}`}
                      className="manual-searchResult"
                      onClick={() => {
                        goToPage(item.page);
                        setQuery("");
                      }}
                    >
                      <span>{item.title}</span>
                      <small>Página {item.page}</small>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="manual-pageControls" aria-label="Navegación por páginas">
            <button
              type="button"
              className="manual-iconBtn manual-iconBtn--toolbar"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
              aria-label="Página anterior"
              title="Página anterior"
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>

            <label className="manual-pageField">
              <span>Página</span>
              <input
                type="number"
                min="1"
                max={TOTAL_PAGES}
                value={page}
                onChange={(event) => goToPage(event.target.value)}
                aria-label="Número de página"
              />
              <span>de {TOTAL_PAGES}</span>
            </label>

            <button
              type="button"
              className="manual-iconBtn manual-iconBtn--toolbar"
              disabled={page >= TOTAL_PAGES}
              onClick={() => goToPage(page + 1)}
              aria-label="Página siguiente"
              title="Página siguiente"
            >
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </div>
        </div>

          <div className="manual-viewerWrap">
            <iframe
              key={viewerUrl}
              className="manual-viewer"
              src={viewerUrl}
              title="Manual funcional BALTO Comercio"
            />
          </div>
        </div>

        <footer className="gm-modal-footer manual-modalFooter">
          <span>Podés buscar módulos desde el campo superior o usar la búsqueda propia del visor PDF.</span>
          <span className="manual-footerHint">Atajo: Ctrl + K enfoca el buscador.</span>
        </footer>
      </div>
    </div>
  );

  // Renderizar el visor fuera del árbol de Configuración evita que los
  // stacking contexts del layout (por ejemplo .pp-content) intercepten
  // clicks cuando el manual está en pantalla completa.
  if (typeof document === "undefined") return modalContent;
  return createPortal(modalContent, document.body);
}
