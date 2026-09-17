import React, { useEffect, useMemo, useRef, useState } from "react";
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

import manualPdfUrl from "../../../utils/manuales/Manual_Funcional_BALTO_Servicios_FINAL.pdf";
import manualDocxUrl from "../../../utils/manuales/Manual_Funcional_BALTO_Servicios_FINAL.docx";
import "./ModalManualFuncional.css";

const TOTAL_PAGES = 86;

const MANUAL_SECTIONS = [
  { title: "Ingreso y navegación", page: 3, keywords: "login inicio sesión menu lateral perfil permisos rol plan" },
  { title: "Dashboard", page: 6, keywords: "panel indicadores ingresos egresos resumen" },
  { title: "Movimientos", page: 8, keywords: "movimientos vista general filtros exportar" },
  { title: "Ventas", page: 9, keywords: "venta cliente facturar factura nota crédito cheque echeq stock" },
  { title: "Compras", page: 16, keywords: "compra proveedor nota crédito cheque echeq stock cuenta corriente" },
  { title: "Recibos", page: 22, keywords: "recibo cobrar cobro cliente cuenta corriente cheque echeq" },
  { title: "Órdenes de Pago", page: 26, keywords: "orden pago proveedor pagar cuenta corriente cheque echeq" },
  { title: "Otros Ingresos", page: 29, keywords: "otros ingresos entrada dinero ingreso manual" },
  { title: "Otros Egresos", page: 33, keywords: "otros egresos salida dinero gasto costo fijo variable" },
  { title: "Presupuestos", page: 36, keywords: "presupuesto modelos convertir venta propuesta comercial" },
  { title: "Flujo de Caja", page: 45, keywords: "flujo caja saldo ingresos egresos medios pago" },
  { title: "Cuentas Corrientes", page: 48, keywords: "cuentas corrientes deuda saldo clientes proveedores" },
  { title: "Cuentas Corrientes - Clientes", page: 48, keywords: "clientes saldo deuda cobros recibos historial" },
  { title: "Cuentas Corrientes - Proveedores", page: 54, keywords: "proveedores saldo deuda pagos ordenes historial" },
  { title: "Servicios", page: 57, keywords: "servicios catálogo trabajadores inventario costos" },
  { title: "Servicios - Catálogo de servicios", page: 58, keywords: "servicio composición materiales insumos mano obra margen precio" },
  { title: "Servicios - Trabajadores", page: 61, keywords: "trabajadores tarifa costo hora empleados contratados" },
  { title: "Inventario e insumos", page: 63, keywords: "inventario materiales insumos stock productos" },
  { title: "Materiales", page: 63, keywords: "materiales stock costo unidad categoría" },
  { title: "Insumos", page: 65, keywords: "insumos stock costo unidad categoría" },
  { title: "Stock", page: 65, keywords: "stock inventario ajuste existencia productos historial" },
  { title: "Contabilidad", page: 66, keywords: "contabilidad iva ventas compras libros" },
  { title: "IVA Ventas", page: 67, keywords: "iva ventas subtotal impuesto notas crédito" },
  { title: "IVA Compras", page: 68, keywords: "iva compras subtotal impuesto notas crédito proveedor" },
  { title: "Cheques y E-Cheqs", page: 71, keywords: "cheques echeqs cartera depósito banco flujo" },
  { title: "Cheques en Cartera", page: 71, keywords: "cheques cartera depositar banco" },
  { title: "Flujo de Cheques", page: 72, keywords: "flujo cheques ingreso egreso depósito reactivar" },
  { title: "E-Cheqs en Cartera", page: 73, keywords: "echeq cartera depositar banco" },
  { title: "Flujo de E-Cheqs", page: 75, keywords: "flujo echeq ingreso egreso depósito reactivar" },
  { title: "Análisis Financiero", page: 77, keywords: "analisis financiero ventas costos resultado neto ganancia pérdida" },
  { title: "Configuración", page: 79, keywords: "configuracion ajustes sistema" },
  { title: "Configuración - Usuarios", page: 80, keywords: "usuarios roles acceso contraseña tema estado" },
  { title: "Configuración - Datos legales", page: 81, keywords: "datos legales fiscal cuit razon social iva punto venta" },
  { title: "Configuración - Saldos iniciales", page: 82, keywords: "saldos iniciales caja banco cheques cuentas corrientes apertura" },
  { title: "Configuración - Listas y categorías", page: 84, keywords: "listas categorías unidades detalles materiales insumos productos" },
  { title: "Configuración - Calendario global", page: 85, keywords: "calendario fechas periodo mes dias" },
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
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => searchRef.current?.focus(), 50);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

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

  return (
    <div
      className="manual-modalOverlay"
      role="dialog"
      aria-modal="true"
      aria-label="Manual funcional de BALTO Servicios"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className={`manual-modal ${fullscreen ? "is-fullscreen" : ""}`}>
        <header className="manual-modalHeader">
          <div className="manual-modalTitleWrap">
            <div className="manual-modalIcon" aria-hidden="true">
              <FontAwesomeIcon icon={faBookOpen} />
            </div>
            <div>
              <h2>Manual funcional</h2>
              <p>BALTO Servicios · Versión 2026 · {TOTAL_PAGES} páginas</p>
            </div>
          </div>

          <div className="manual-modalHeaderActions">
            <a
              className="manual-btn manual-btn--primary"
              href={docxUrl}
              download="Manual_Funcional_BALTO_Servicios_FINAL.docx"
              title="Descargar manual en Word"
            >
              <FontAwesomeIcon icon={faDownload} />
              <span>Descargar Word</span>
            </a>

            <button
              type="button"
              className="manual-iconBtn"
              onClick={() => window.open(pdfUrl, "_blank", "noopener,noreferrer")}
              title="Abrir el manual en una pestaña nueva"
              aria-label="Abrir en una pestaña nueva"
            >
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </button>

            <button
              type="button"
              className="manual-iconBtn"
              onClick={() => setFullscreen((value) => !value)}
              title={fullscreen ? "Salir de pantalla completa" : "Expandir manual"}
              aria-label={fullscreen ? "Salir de pantalla completa" : "Expandir manual"}
            >
              <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />
            </button>

            <button
              type="button"
              className="manual-iconBtn manual-iconBtn--close"
              onClick={onClose}
              title="Cerrar manual"
              aria-label="Cerrar manual"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </div>
        </header>

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
            title="Manual funcional BALTO Servicios"
          />
        </div>

        <footer className="manual-modalFooter">
          <span>Podés buscar módulos desde el campo superior o usar la búsqueda propia del visor PDF.</span>
          <span className="manual-footerHint">Atajo: Ctrl + K enfoca el buscador.</span>
        </footer>
      </div>
    </div>
  );
}
