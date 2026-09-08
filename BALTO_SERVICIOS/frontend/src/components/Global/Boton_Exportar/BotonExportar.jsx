import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./BotonExportar.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExport,
  faFilePdf,
  faFileExcel,
  faFileCsv,
  faFileWord,
  faFileLines,
  faPrint,
  faImage,
  faDatabase,
  faDownload,
  faLayerGroup,
  faListUl,
  faXmark,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";

function getTipoVisual(opcion = {}) {
  const tipo = String(opcion.tipo || opcion.variant || opcion.key || "").toLowerCase();
  const label = String(opcion.label || "").toLowerCase();

  if (tipo.includes("pdf") || label.includes("pdf")) return { icon: opcion.icon || faFilePdf, tone: "pdf" };
  if (tipo.includes("excel") || tipo.includes("xlsx") || tipo.includes("xls") || label.includes("excel")) {
    return { icon: opcion.icon || faFileExcel, tone: "excel" };
  }
  if (tipo.includes("csv") || label.includes("csv")) return { icon: opcion.icon || faFileCsv, tone: "csv" };
  if (tipo.includes("word") || tipo.includes("doc") || label.includes("word")) return { icon: opcion.icon || faFileWord, tone: "word" };
  if (tipo.includes("txt") || label.includes("txt") || label.includes("texto")) return { icon: opcion.icon || faFileLines, tone: "txt" };
  if (tipo.includes("print") || tipo.includes("imprimir") || label.includes("imprimir")) return { icon: opcion.icon || faPrint, tone: "print" };
  if (tipo.includes("image") || tipo.includes("png") || tipo.includes("jpg")) return { icon: opcion.icon || faImage, tone: "image" };
  if (tipo.includes("backup") || tipo.includes("db") || label.includes("base")) return { icon: opcion.icon || faDatabase, tone: "db" };
  return { icon: opcion.icon || faDownload, tone: "default" };
}

function cleanFormatLabel(opcion = {}) {
  const raw = String(opcion.shortLabel || opcion.label || "Formato").trim();
  return raw
    .replace(/^exportar\s+/i, "")
    .replace(/\s*\(\.[^)]+\)\s*$/i, "")
    .trim() || "Formato";
}

function countLabel(value, fallback = "—") {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n.toLocaleString("es-AR") : fallback;
}

function finiteCountOrNull(value) {
  // Number(null) y Number("") devuelven 0. En los contadores opcionales eso
  // no significa "cero registros": significa que el total todavía es desconocido.
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function BotonExportar({
  disabled = false,
  loading = false,
  className = "",
  label = "Exportar",
  title = "Exportar archivo",
  opciones = [],
  align = "right", // compatibilidad; el nuevo selector usa modal centrado
  entityLabel = "registros",
  modalTitle = "",
  modalDescription = "Elegí el alcance y el formato de exportación.",
  currentRows = null,
  allRows = null,
  loadAllRows = null,
  currentCount = null,
  allCount = null,
  hasMore = false,
  scopeEnabled = true,
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("page");
  const [selectedKey, setSelectedKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [localError, setLocalError] = useState("");

  // `align` se conserva para no romper llamadas existentes.
  void align;

  const opcionesSeguras = useMemo(
    () => (Array.isArray(opciones) ? opciones.filter(Boolean) : []),
    [opciones]
  );

  const firstEnabledKey = useMemo(() => {
    const first = opcionesSeguras.find((opcion) => !opcion?.disabled);
    return first?.key || first?.label || "";
  }, [opcionesSeguras]);

  const selectedOption = useMemo(
    () => opcionesSeguras.find((opcion) => (opcion?.key || opcion?.label) === selectedKey) || null,
    [opcionesSeguras, selectedKey]
  );

  const explicitPageCount = finiteCountOrNull(currentCount);
  const explicitAllCount = finiteCountOrNull(allCount);

  const pageCount = explicitPageCount !== null
    ? explicitPageCount
    : Array.isArray(currentRows)
      ? currentRows.length
      : null;

  const knownAllCount = explicitAllCount !== null
    ? explicitAllCount
    : (!hasMore && Array.isArray(allRows) ? allRows.length : null);

  const normalizedEntity = String(entityLabel || "registros").trim() || "registros";
  const resolvedModalTitle = modalTitle || `Exportar ${normalizedEntity}`;

  useEffect(() => {
    if (!open) return undefined;

    const handleEscape = (e) => {
      if (e.key === "Escape" && !exporting) setOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, exporting]);

  const handleOpen = () => {
    if (disabled || loading || opcionesSeguras.length === 0) return;
    setScope("page");
    setSelectedKey(firstEnabledKey);
    setLocalError("");
    setOpen(true);
  };

  const closeModal = () => {
    if (exporting) return;
    setOpen(false);
    setLocalError("");
  };

  const handleConfirm = async () => {
    if (!selectedOption || selectedOption.disabled || exporting || loading) return;

    setExporting(true);
    setLocalError("");

    try {
      let scopedRows = null;

      if (scope === "page") {
        scopedRows = Array.isArray(currentRows) ? currentRows : null;
      } else if (typeof loadAllRows === "function" && (hasMore || !Array.isArray(allRows))) {
        scopedRows = await loadAllRows();
      } else if (Array.isArray(allRows)) {
        scopedRows = allRows;
      } else if (Array.isArray(currentRows)) {
        scopedRows = currentRows;
      }

      if (Array.isArray(scopedRows) && scopedRows.length === 0) {
        throw new Error("No hay registros para exportar con los filtros actuales.");
      }

      await selectedOption.onClick?.({
        scope,
        rows: scopedRows,
        currentRows: Array.isArray(currentRows) ? currentRows : null,
        allRows: Array.isArray(allRows) ? allRows : null,
        hasMore: !!hasMore,
      });

      setOpen(false);
    } catch (error) {
      setLocalError(error?.message || "No se pudo completar la exportación.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={`boton-exportar-wrap ${className}`.trim()}>
      <button
        type="button"
        className="boton-exportar-trigger"
        onClick={handleOpen}
        disabled={disabled || loading || opcionesSeguras.length === 0}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="boton-exportar-trigger__iconWrap">
          <FontAwesomeIcon icon={faFileExport} />
        </span>
        <span className="boton-exportar-trigger__text">{loading ? "Exportando..." : label}</span>
      </button>

      {open && createPortal(
        <div className="boton-exportar-modalOverlay" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}>
          <div className="boton-exportar-modal" role="dialog" aria-modal="true" aria-labelledby="boton-exportar-modal-title">
            <div className="boton-exportar-modal__header">
              <div>
                <h2 id="boton-exportar-modal-title">{resolvedModalTitle}</h2>
                <p>{modalDescription}</p>
              </div>
              <button type="button" className="boton-exportar-modal__close" onClick={closeModal} disabled={exporting} aria-label="Cerrar">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="boton-exportar-modal__body">
              <div className="boton-exportar-summary">
                <span className="boton-exportar-summary__accent" />
                <span className="boton-exportar-summary__icon"><FontAwesomeIcon icon={faLayerGroup} /></span>
                <div>
                  <span className="boton-exportar-summary__label">REGISTROS DISPONIBLES</span>
                  <strong>{knownAllCount !== null ? countLabel(knownAllCount) : hasMore ? `${countLabel(pageCount, "0")}+` : countLabel(pageCount, "—")}</strong>
                </div>
              </div>

              {scopeEnabled && (
                <section className="boton-exportar-section">
                  <h3>ALCANCE</h3>
                  <div className="boton-exportar-choiceGrid boton-exportar-choiceGrid--scope">
                    <button type="button" className={`boton-exportar-choice ${scope === "page" ? "is-selected" : ""}`} onClick={() => setScope("page")} disabled={exporting}>
                      <span className="boton-exportar-choice__icon boton-exportar-choice__icon--scope"><FontAwesomeIcon icon={faListUl} /></span>
                      <span className="boton-exportar-choice__content">
                        <strong>Exportar esta página</strong>
                        <span>Descarga únicamente los registros visibles de la página actual.</span>
                        <small>{pageCount !== null ? `${countLabel(pageCount)} ${normalizedEntity}` : "Página actual"}</small>
                      </span>
                      {scope === "page" && <FontAwesomeIcon className="boton-exportar-choice__check" icon={faCircleCheck} />}
                    </button>

                    <button type="button" className={`boton-exportar-choice ${scope === "all" ? "is-selected" : ""}`} onClick={() => setScope("all")} disabled={exporting}>
                      <span className="boton-exportar-choice__icon boton-exportar-choice__icon--scope"><FontAwesomeIcon icon={faLayerGroup} /></span>
                      <span className="boton-exportar-choice__content">
                        <strong>Exportar todos los registros</strong>
                        <span>Incluye todas las páginas de {normalizedEntity} que coinciden con los filtros y el período actual.</span>
                        <small>{knownAllCount !== null ? `${countLabel(knownAllCount)} ${normalizedEntity}` : hasMore ? "Incluye páginas todavía no cargadas" : `${countLabel(pageCount, "0")} ${normalizedEntity}`}</small>
                      </span>
                      {scope === "all" && <FontAwesomeIcon className="boton-exportar-choice__check" icon={faCircleCheck} />}
                    </button>
                  </div>
                </section>
              )}

              <section className="boton-exportar-section">
                <h3>FORMATO</h3>
                <div className="boton-exportar-choiceGrid boton-exportar-choiceGrid--format">
                  {opcionesSeguras.map((opcion, idx) => {
                    const optionKey = opcion.key || opcion.label || String(idx);
                    const visual = getTipoVisual(opcion);
                    const isSelected = selectedKey === optionKey;
                    return (
                      <button key={optionKey} type="button" className={`boton-exportar-choice boton-exportar-choice--format boton-exportar-choice--${visual.tone} ${isSelected ? "is-selected" : ""}`} onClick={() => setSelectedKey(optionKey)} disabled={!!opcion.disabled || exporting}>
                        <span className={`boton-exportar-choice__icon boton-exportar-choice__icon--${visual.tone}`}>
                          {typeof visual.icon === "string" ? visual.icon : <FontAwesomeIcon icon={visual.icon} />}
                        </span>
                        <span className="boton-exportar-choice__content">
                          <strong>{cleanFormatLabel(opcion)}</strong>
                          <span>{opcion.description || opcion.title || `Descarga directa en formato ${cleanFormatLabel(opcion)}.`}</span>
                        </span>
                        {isSelected && <FontAwesomeIcon className="boton-exportar-choice__check" icon={faCircleCheck} />}
                      </button>
                    );
                  })}
                </div>
              </section>

              {localError && <div className="boton-exportar-modal__error" role="alert">{localError}</div>}
            </div>

            <div className="boton-exportar-modal__footer">
              <button type="button" className="boton-exportar-modal__cancel" onClick={closeModal} disabled={exporting}>Cancelar</button>
              <button type="button" className="boton-exportar-modal__submit" onClick={handleConfirm} disabled={!selectedOption || exporting || loading}>
                <FontAwesomeIcon icon={faFileExport} />
                {exporting ? "Preparando..." : "Exportar"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
