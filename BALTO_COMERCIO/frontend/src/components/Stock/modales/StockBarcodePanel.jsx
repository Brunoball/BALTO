import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBarcode,
  faCheck,
  faKeyboard,
  faPrint,
  faRefresh,
  faSpinner,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import {
  buildCode128Geometry,
  isCode128BText,
  normalizeBarcodeText,
  renderCode128SvgMarkup,
} from "./barcodeCode128";
import { stockBarcodeGet, stockBarcodePost } from "../api/stockApi";
import "./StockBarcodePanel.css";

function Code128Preview({ value, className = "" }) {
  const text = normalizeBarcodeText(value);
  const geometry = useMemo(() => {
    try {
      return text && isCode128BText(text) ? buildCode128Geometry(text) : null;
    } catch {
      return null;
    }
  }, [text]);

  if (!geometry) {
    return (
      <div className={`stock-barcode__invalid ${className}`.trim()}>
        No se puede previsualizar este valor como CODE 128.
      </div>
    );
  }

  return (
    <svg
      className={`stock-barcode__svg ${className}`.trim()}
      viewBox={`0 0 ${geometry.width} 58`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Código de barra ${text}`}
    >
      <rect x="0" y="0" width={geometry.width} height="58" fill="#fff" />
      {geometry.bars.map((bar, index) => (
        <rect
          key={`${bar.x}-${bar.width}-${index}`}
          x={bar.x}
          y="0"
          width={bar.width}
          height="58"
          fill="#000"
        />
      ))}
    </svg>
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printBarcodeLabels(items, { source = "interno" } = {}) {
  const printable = (Array.isArray(items) ? items : [])
    .map((item) => {
      const code = source === "externo" ? item.codigo_barra : item.codigo_interno;
      return { ...item, code: normalizeBarcodeText(code) };
    })
    .filter((item) => item.code && isCode128BText(item.code));

  if (!printable.length || typeof document === "undefined") return false;

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Impresión de códigos de barra");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const labels = printable
    .map((item) => {
      const subtitle = item.tipo_entidad === "variante"
        ? `${item.producto_nombre || "Producto"} · ${item.nombre_variante || `Variante #${item.id_stock_variante}`}`
        : item.producto_nombre || "Producto";
      return `
        <article class="label">
          <div class="name">${escapeHtml(subtitle)}</div>
          <div class="barcode">${renderCode128SvgMarkup(item.code, { height: 38 })}</div>
          <div class="code">${escapeHtml(item.code)}</div>
        </article>`;
    })
    .join("");

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return false;
  }

  doc.open();
  doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Códigos de barra Balto</title>
<style>
  * { box-sizing: border-box; }
  @page { margin: 6mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, sans-serif; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; align-items: flex-start; }
  .label { width: 50mm; min-height: 25mm; border: 1px dashed #bbb; border-radius: 2mm; padding: 2.2mm 2.8mm; break-inside: avoid; display: flex; flex-direction: column; justify-content: center; }
  .name { font-size: 7.5pt; font-weight: 700; line-height: 1.15; min-height: 6mm; max-height: 12mm; overflow: hidden; margin-bottom: 1.2mm; }
  .barcode { height: 10mm; width: 100%; display: flex; align-items: center; justify-content: center; }
  .barcode svg { display: block; width: 100%; height: 100%; max-width: 44mm; }
  .code { margin-top: 1mm; text-align: center; font-size: 7.5pt; font-weight: 700; letter-spacing: .35px; }
  @media print { .label { border-color: transparent; } }
</style>
</head>
<body><main class="sheet">${labels}</main></body>
</html>`);
  doc.close();

  const triggerPrint = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1200);
    }
  };

  if (doc.readyState === "complete") window.setTimeout(triggerPrint, 80);
  else frame.onload = () => window.setTimeout(triggerPrint, 80);

  return true;
}

function normalizeServerItems(data) {
  const producto = data?.producto && typeof data.producto === "object" ? data.producto : null;
  if (!producto) return [];

  const productoId = Number(producto.id_stock_producto || producto.id || 0);
  const nombreProducto = String(producto.nombre || "Producto").trim();
  const variantes = Array.isArray(data?.variantes) ? data.variantes : [];
  // Las filas reales de variantes mandan sobre el flag legacy. Si existen
  // variantes en DB, este producto debe generar un BL-V-ID por cada una.
  const tieneVariantes = variantes.length > 0 || Boolean(Number(producto.tiene_variantes || 0));

  if (tieneVariantes) {
    return variantes
      .filter((variant) => Number(variant?.id_stock_variante || variant?.id || 0) > 0)
      .map((variant) => {
        const variantId = Number(variant.id_stock_variante || variant.id);
        return {
          tipo_entidad: "variante",
          id_stock_producto: productoId,
          id_stock_variante: variantId,
          producto_nombre: nombreProducto,
          nombre_variante: String(variant.nombre_variante || variant.sku || `Variante #${variantId}`).trim(),
          sku: String(variant.sku || "").trim(),
          activo: Number(variant.activo ?? 1),
          producto_activo: Number(producto.activo ?? 1),
          codigo_interno: `BL-V-${variantId}`,
          codigo_barra: normalizeBarcodeText(variant.codigo_barra || ""),
        };
      });
  }

  return [{
    tipo_entidad: "producto",
    id_stock_producto: productoId,
    id_stock_variante: null,
    producto_nombre: nombreProducto,
    nombre_variante: "",
    sku: String(producto.sku || "").trim(),
    activo: Number(producto.activo ?? 1),
    producto_activo: Number(producto.activo ?? 1),
    codigo_interno: `BL-P-${productoId}`,
    codigo_barra: normalizeBarcodeText(producto.codigo_barra || ""),
  }];
}

export default function StockBarcodePanel({
  productoId,
  nombreProducto = "",
  tieneVariantes = false,
  variantes = [],
  onToast,
  onSavePendingChanges,
  productSaving = false,
  refreshKey = 0,
  className = "",
}) {
  const idProducto = Number(productoId || 0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [error, setError] = useState("");
  const [integrityWarning, setIntegrityWarning] = useState("");
  const [items, setItems] = useState([]);
  const [loadedProductId, setLoadedProductId] = useState(0);
  const [scanTarget, setScanTarget] = useState(null);
  const [scanValue, setScanValue] = useState("");
  const inputRef = useRef(null);

  const notify = (message, type = "error") => {
    if (typeof onToast === "function") onToast(message, type);
  };

  const provisionalItems = useMemo(() => {
    if (idProducto > 0) return [];

    if (tieneVariantes) {
      return (Array.isArray(variantes) ? variantes : []).map((variant, index) => ({
        provisional: true,
        tipo_entidad: "variante",
        producto_nombre: nombreProducto || "Producto nuevo",
        nombre_variante: variant?.nombre_variante || variant?.sku || `Variante ${index + 1}`,
        codigo_interno: "BL-V-{ID}",
      }));
    }

    return [{
      provisional: true,
      tipo_entidad: "producto",
      producto_nombre: nombreProducto || "Producto nuevo",
      nombre_variante: "",
      codigo_interno: "BL-P-{ID}",
    }];
  }, [idProducto, nombreProducto, tieneVariantes, variantes]);

  const loadCodes = async ({ quiet = false } = {}) => {
    if (idProducto <= 0) {
      setItems([]);
      setLoadedProductId(0);
      setIntegrityWarning("");
      return false;
    }

    if (!quiet) setLoading(true);
    setError("");

    try {
      const data = await stockBarcodeGet({
        op: "obtener",
        id_stock_producto: idProducto,
      });
      setItems(normalizeServerItems(data));
      setIntegrityWarning(data?.requiere_variantes ? String(data?.advertencia || "El producto está marcado con variantes pero todavía no tiene variantes guardadas.") : "");
      setLoadedProductId(idProducto);
      return true;
    } catch (err) {
      const message = err?.message || "No se pudieron cargar los códigos de barra.";
      setError(message);
      if (!quiet) notify(message, "error");
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    setScanTarget(null);
    setScanValue("");
    setLoadedProductId(0);
    if (idProducto > 0) loadCodes();
    else {
      setItems([]);
      setError("");
      setIntegrityWarning("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idProducto, refreshKey]);

  useEffect(() => {
    if (!scanTarget) return undefined;

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    }, 40);

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        setScanTarget(null);
        setScanValue("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scanTarget, saving]);

  const formVariantRows = useMemo(() => {
    if (!tieneVariantes) return [];
    return (Array.isArray(variantes) ? variantes : []).filter((variant) => {
      const hasIdentity = Number(variant?.id_stock_variante || variant?.id || 0) > 0;
      const hasText = String(variant?.nombre_variante || variant?.nombre || variant?.sku || "").trim() !== "";
      const hasAttrs = (Array.isArray(variant?.atributos) ? variant.atributos : []).some((attr) =>
        String(attr?.atributo || attr?.valor || "").trim() !== ""
      );
      return hasIdentity || hasText || hasAttrs;
    });
  }, [tieneVariantes, variantes]);

  const hasPendingProductChanges = useMemo(() => {
    // En alta el producto ya fue persistido antes de recibir un ID; allí el panel
    // sólo consulta DB. La detección de cambios pendientes aplica al editor, que
    // provee explícitamente onSavePendingChanges.
    if (typeof onSavePendingChanges !== "function" || idProducto <= 0 || loadedProductId !== idProducto) return false;

    const dbVariants = items.filter((item) => item.tipo_entidad === "variante");
    const dbProduct = items.find((item) => item.tipo_entidad === "producto") || null;
    const dbProductName = String((dbProduct || dbVariants[0])?.producto_nombre || "").trim().toUpperCase();
    const formProductName = String(nombreProducto || "").trim().toUpperCase();

    // La etiqueta imprime el nombre del producto. Si fue renombrado y todavía no
    // se guardó, obligamos a persistir antes de imprimir para no sacar etiquetas viejas.
    if (dbProductName && formProductName && dbProductName !== formProductName) return true;

    if (!tieneVariantes) {
      return dbVariants.length > 0;
    }

    // Si el formulario ya está en modo variantes pero DB todavía responde como
    // producto simple, o hay alguna fila sin ID, primero hay que persistirla.
    if (dbProduct || formVariantRows.some((variant) => Number(variant?.id_stock_variante || variant?.id || 0) <= 0)) {
      return true;
    }

    const formById = new Map(
      formVariantRows
        .map((variant) => [Number(variant?.id_stock_variante || variant?.id || 0), variant])
        .filter(([id]) => id > 0)
    );
    const dbById = new Map(dbVariants.map((variant) => [Number(variant.id_stock_variante || 0), variant]));

    if (formById.size !== dbById.size) return true;

    for (const [id, variant] of formById.entries()) {
      const dbVariant = dbById.get(id);
      if (!dbVariant) return true;

      const formName = String(variant?.nombre_variante || variant?.nombre || "").trim().toUpperCase();
      const dbName = String(dbVariant?.nombre_variante || "").trim().toUpperCase();
      const formSku = String(variant?.sku || "").trim().toUpperCase();
      const dbSku = String(dbVariant?.sku || "").trim().toUpperCase();
      const formActivo = Number(variant?.activo === false ? 0 : (variant?.activo ?? 1));
      const dbActivo = Number(dbVariant?.activo ?? 1);

      if (formName !== dbName || formSku !== dbSku || formActivo !== dbActivo) return true;
    }

    return false;
  }, [idProducto, loadedProductId, items, nombreProducto, tieneVariantes, formVariantRows, onSavePendingChanges]);

  const savePendingProductChanges = async () => {
    if (savingProduct || productSaving || typeof onSavePendingChanges !== "function") return;
    setSavingProduct(true);
    try {
      const ok = await onSavePendingChanges();
      if (ok !== true) {
        if (ok !== false) notify("No se pudo confirmar que los cambios del producto hayan sido guardados.", "error");
        return;
      }
      const reloaded = await loadCodes({ quiet: true });
      if (!reloaded) {
        notify("El producto se guardó, pero no se pudieron recargar los códigos. Volvé a intentar desde esta pestaña.", "error");
        return;
      }
      notify("Cambios guardados. Los códigos ya usan los IDs definitivos de las variantes.", "exito");
    } catch (err) {
      notify(err?.message || "No se pudieron guardar los cambios del producto.", "error");
    } finally {
      setSavingProduct(false);
    }
  };

  const barcodeActionsBlocked = saving || savingProduct || productSaving || hasPendingProductChanges;

  const saveScannedCode = async () => {
    if (!scanTarget || barcodeActionsBlocked) return;
    const targetInactive = Number(scanTarget.activo ?? 1) === 0 || Number(scanTarget.producto_activo ?? 1) === 0;
    if (targetInactive) {
      notify("No se puede guardar o cambiar el código de un producto o variante dada de baja.", "error");
      setScanTarget(null);
      setScanValue("");
      return;
    }
    const code = normalizeBarcodeText(inputRef.current?.value ?? scanValue);

    if (!code) {
      notify("Escaneá o escribí un código antes de guardar.", "error");
      inputRef.current?.focus();
      return;
    }

    if (!isCode128BText(code)) {
      notify("El código contiene caracteres no compatibles. Volvé a escanearlo.", "error");
      return;
    }

    setSaving(true);
    try {
      const data = await stockBarcodePost({}, {
        op: "guardar",
        tipo_entidad: scanTarget.tipo_entidad,
        id_stock_producto: scanTarget.id_stock_producto,
        id_stock_variante: scanTarget.id_stock_variante || null,
        codigo_barra: code,
      });
      const saved = normalizeBarcodeText(data?.codigo_barra || code);
      setItems((prev) => prev.map((item) => {
        const same = item.tipo_entidad === scanTarget.tipo_entidad &&
          Number(item.id_stock_producto) === Number(scanTarget.id_stock_producto) &&
          Number(item.id_stock_variante || 0) === Number(scanTarget.id_stock_variante || 0);
        return same ? { ...item, codigo_barra: saved } : item;
      }));
      setScanTarget(null);
      setScanValue("");
      notify("Código de barra guardado correctamente.", "exito");
    } catch (err) {
      notify(err?.message || "No se pudo guardar el código de barra.", "error");
      inputRef.current?.focus();
      inputRef.current?.select?.();
    } finally {
      setSaving(false);
    }
  };

  const beginScan = (item) => {
    if (barcodeActionsBlocked) return;
    const itemInactive = Number(item?.activo ?? 1) === 0 || Number(item?.producto_activo ?? 1) === 0;
    if (itemInactive) {
      notify("No se puede asociar un código a un producto o variante dada de baja.", "error");
      return;
    }
    setScanTarget(item);
    setScanValue(item.codigo_barra || "");
  };

  const cancelScan = () => {
    if (saving) return;
    setScanTarget(null);
    setScanValue("");
  };

  const printInternal = (rows) => {
    const ok = printBarcodeLabels(rows, { source: "interno" });
    if (!ok) notify("No hay códigos internos listos para imprimir.", "error");
  };

  const renderRows = idProducto > 0 ? items : provisionalItems;
  const printableInternalItems = hasPendingProductChanges
    ? []
    : items.filter((item) => Number(item.activo ?? 1) !== 0 && Number(item.producto_activo ?? 1) !== 0);

  return (
    <>
      <section className={`stock-barcode cmi-barcodePanelOnly ${className}`.trim()} aria-label="Códigos de barra">
      <div className="stock-barcode__header">
        <div>
          <div className="stock-barcode__eyebrow"><FontAwesomeIcon icon={faBarcode} /> Stock</div>
          <h3>Código de barra</h3>
          <p>
            Generá etiquetas propias de Balto o asociá el código que el producto ya trae usando la pistola lectora.
          </p>
        </div>

        {idProducto > 0 && items.length > 0 && (
          <div className="stock-barcode__headerActions">
            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={() => printInternal(printableInternalItems)}
              disabled={loading || barcodeActionsBlocked || !printableInternalItems.length}
            >
              <FontAwesomeIcon icon={faPrint} /> {printableInternalItems.length > 1 ? "Imprimir todos" : "Imprimir código"}
            </button>
          </div>
        )}
      </div>

      {idProducto <= 0 && (
        <div className="stock-barcode__pending">
          <span className="stock-barcode__pendingIcon"><FontAwesomeIcon icon={faBarcode} /></span>
          <div>
            <strong>Primero hay que guardar el producto</strong>
            <p>
              El código usa el ID definitivo de la base. Al guardar desde esta pestaña, Balto mantiene el modal abierto y habilita automáticamente los códigos reales.
            </p>
          </div>
        </div>
      )}

      {idProducto > 0 && hasPendingProductChanges && (
        <div className="stock-barcode__pending">
          <span className="stock-barcode__pendingIcon"><FontAwesomeIcon icon={faRefresh} /></span>
          <div>
            <strong>Hay cambios de variantes sin guardar</strong>
            <p>
              Balto no anticipa IDs de MySQL. Guardá primero los cambios para crear las variantes y después se generan automáticamente todos los BL-V-ID definitivos, sin cerrar este modal.
            </p>
            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={savePendingProductChanges}
              disabled={savingProduct || productSaving || typeof onSavePendingChanges !== "function"}
            >
              <FontAwesomeIcon icon={savingProduct || productSaving ? faSpinner : faCheck} spin={savingProduct || productSaving} />
              {savingProduct || productSaving ? "Guardando cambios..." : "Guardar cambios y generar códigos"}
            </button>
          </div>
        </div>
      )}

      {integrityWarning && idProducto > 0 && (
        <div className="stock-barcode__pending">
          <span className="stock-barcode__pendingIcon"><FontAwesomeIcon icon={faRefresh} /></span>
          <div>
            <strong>Producto con variantes incompletas</strong>
            <p>{integrityWarning}</p>
          </div>
        </div>
      )}

      {error && idProducto > 0 && (
        <div className="stock-barcode__error">
          <span>{error}</span>
          <button type="button" className="mit-btn mit-btn--ghost" onClick={() => loadCodes()}>
            Reintentar
          </button>
        </div>
      )}

      {loading && idProducto > 0 ? (
        <div className="stock-barcode__loading">
          <FontAwesomeIcon icon={faSpinner} spin /> Cargando códigos de barra...
        </div>
      ) : (
        <div className="stock-barcode__list">
          {renderRows.map((item, index) => {
            const rowKey = item.provisional
              ? `provisional-${index}`
              : `${item.tipo_entidad}-${item.id_stock_variante || item.id_stock_producto}`;
            const displayName = item.tipo_entidad === "variante"
              ? (item.nombre_variante || `Variante ${index + 1}`)
              : (item.producto_nombre || nombreProducto || "Producto");
            const itemInactive = !item.provisional && (
              Number(item.activo ?? 1) === 0 || Number(item.producto_activo ?? 1) === 0
            );

            return (
              <article
                className={`stock-barcode__card stock-barcode__card--${item.tipo_entidad} ${item.provisional ? "is-provisional" : ""}`.trim()}
                key={rowKey}
              >
                <div className="stock-barcode__cardHead">
                  <div>
                    <div className="stock-barcode__itemType">
                      {item.tipo_entidad === "variante" ? "Variante" : "Producto simple"}
                    </div>
                    <strong>{displayName}</strong>
                    {!item.provisional && item.sku && <span>SKU: {item.sku}</span>}
                  </div>
                  {itemInactive && <span className="stock-barcode__inactive">Dado de baja</span>}
                </div>

                <div className="stock-barcode__sections">
                  <div className="stock-barcode__section stock-barcode__section--internal">
                    <div className="stock-barcode__sectionHead">
                      <div>
                        <span className="stock-barcode__label">Código Balto</span>
                        <small>Generado automáticamente</small>
                      </div>
                      {!item.provisional && <span className="stock-barcode__badge">Listo</span>}
                    </div>

                    {!item.provisional ? (
                      <>
                        <div className="stock-barcode__previewWrap">
                          <Code128Preview value={item.codigo_interno} />
                          <code>{item.codigo_interno}</code>
                        </div>
                        <button
                          type="button"
                          className="mit-btn mit-btn--ghost stock-barcode__printOne"
                          onClick={() => printInternal([item])}
                          disabled={barcodeActionsBlocked || itemInactive}
                          title={hasPendingProductChanges ? "Guardá primero los cambios de variantes" : itemInactive ? "El producto o la variante está dada de baja" : "Imprimir código"}
                        >
                          <FontAwesomeIcon icon={faPrint} /> Imprimir
                        </button>
                      </>
                    ) : (
                      <div className="stock-barcode__placeholderCode">
                        <FontAwesomeIcon icon={faBarcode} />
                        <code>{item.codigo_interno}</code>
                      </div>
                    )}
                  </div>

                  <div className={`stock-barcode__section stock-barcode__section--external ${!item.provisional && item.codigo_barra ? "has-code" : ""}`.trim()}>
                    <div className="stock-barcode__sectionHead">
                      <div>
                        <span className="stock-barcode__label">Código existente</span>
                        <small>El que ya trae el producto</small>
                      </div>
                      {!item.provisional && item.codigo_barra && (
                        <span className="stock-barcode__badge stock-barcode__badge--saved">
                          <FontAwesomeIcon icon={faCheck} /> Guardado
                        </span>
                      )}
                    </div>

                    {item.provisional ? (
                      <div className="stock-barcode__externalState is-pending">
                        <FontAwesomeIcon icon={faBarcode} />
                        <div>
                          <strong>Disponible después de guardar</strong>
                          <span>Balto necesita el ID definitivo del artículo.</span>
                        </div>
                      </div>
                    ) : item.codigo_barra ? (
                      <>
                        <div className="stock-barcode__previewWrap stock-barcode__previewWrap--external">
                          <Code128Preview value={item.codigo_barra} />
                          <code>{item.codigo_barra}</code>
                        </div>
                        <div className="stock-barcode__externalActions">
                          <button
                            type="button"
                            className="mit-btn mit-btn--ghost"
                            onClick={() => beginScan(item)}
                            disabled={barcodeActionsBlocked || itemInactive}
                            title={itemInactive ? "No se puede cambiar el código de un artículo dado de baja" : "Cambiar código"}
                          >
                            <FontAwesomeIcon icon={faKeyboard} /> Cambiar código
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="stock-barcode__externalState">
                          <FontAwesomeIcon icon={faBarcode} />
                          <div>
                            <strong>Sin código asociado</strong>
                            <span>Podés escanear el código que ya trae el artículo.</span>
                          </div>
                        </div>
                        <div className="stock-barcode__externalActions">
                          <button
                            type="button"
                            className="mit-btn mit-btn--ghost"
                            onClick={() => beginScan(item)}
                            disabled={barcodeActionsBlocked || itemInactive}
                            title={itemInactive ? "No se puede asociar un código a un artículo dado de baja" : "Agregar código de barra"}
                          >
                            <FontAwesomeIcon icon={faKeyboard} /> Agregar código
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && idProducto > 0 && !renderRows.length && !error && !integrityWarning && (
            <div className="stock-barcode__emptyState">
              No hay artículos activos para generar códigos de barra.
            </div>
          )}
        </div>
      )}
      </section>

      {scanTarget && typeof document !== "undefined" && createPortal(
        <div className="gm-modal-overlay" role="presentation">
          <div
            className="gm-modal-container gm-modal-container--small stock-barcode-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stock-barcode-modal-title"
          >
            <div className="gm-modal-header">
              <span className="gm-modal-head-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faBarcode} />
              </span>
              <div className="gm-modal-head-left">
                <h3 className="gm-modal-title" id="stock-barcode-modal-title">
                  {scanTarget.codigo_barra ? "Cambiar código de barra" : "Agregar código de barra"}
                </h3>
                <p className="gm-modal-subtitle">
                  {scanTarget.tipo_entidad === "variante"
                    ? (scanTarget.nombre_variante || "Variante")
                    : (scanTarget.producto_nombre || nombreProducto || "Producto")}
                </p>
              </div>
              <button
                type="button"
                className="gm-modal-close"
                onClick={cancelScan}
                disabled={saving}
                aria-label="Cerrar"
                title="Cerrar"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="gm-modal-content stock-barcode-modal__content">
              <div className="stock-barcode-modal__scanner">
                <span className="stock-barcode__scanPulse" />
                <div>
                  <strong>Listo para leer</strong>
                  <span>Escaneá con la pistola o escribí el código manualmente.</span>
                </div>
              </div>

              <div className="gm-field">
                <input
                  ref={inputRef}
                  className="gm-input stock-barcode__scanInput"
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value.replace(/[\r\n\t]/g, ""))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      saveScannedCode();
                    }
                  }}
                  placeholder=" "
                  autoComplete="off"
                  spellCheck={false}
                  disabled={barcodeActionsBlocked}
                />
                <label className="gm-label">Código de barra</label>
              </div>

              {scanValue && isCode128BText(normalizeBarcodeText(scanValue)) && (
                <div className="stock-barcode__livePreview stock-barcode-modal__preview">
                  <Code128Preview value={scanValue} />
                  <code>{normalizeBarcodeText(scanValue)}</code>
                </div>
              )}

              <small className="stock-barcode-modal__hint">
                Las lectoras suelen enviar Enter o Tab al terminar; si lo hacen, el código se guarda automáticamente.
              </small>
            </div>

            <div className="gm-modal-footer">
              <button
                type="button"
                className="gm-action-btn gm-action-btn--cancel"
                onClick={cancelScan}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="gm-action-btn gm-action-btn--save"
                onClick={saveScannedCode}
                disabled={barcodeActionsBlocked || !normalizeBarcodeText(scanValue)}
              >
                <FontAwesomeIcon icon={saving ? faSpinner : faCheck} spin={saving} />
                {saving ? "Guardando..." : "Guardar código"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
