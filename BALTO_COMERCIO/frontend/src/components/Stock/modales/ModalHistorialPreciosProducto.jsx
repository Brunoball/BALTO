import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faClockRotateLeft,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import "./ModalAjustePrecios.css";
import "./ModalHistorialPreciosProducto.css";
import { isTopStockModal } from "./modalStackUtils";
import { stockGet } from "../api/stockApi";

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "—";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatMoney(n)}`;
}

async function apiGet(paramsObj) {
  const params = new URLSearchParams(paramsObj);
  return stockGet(String(params.get("action") || ""), params);
}

const ModalHistorialPreciosProducto = ({ open, producto, onClose, onToast }) => {
  const overlayRef = useRef(null);
  const productoId = Number(producto?.id_stock_producto ?? producto?.id ?? 0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [productoInfo, setProductoInfo] = useState(null);
  const [error, setError] = useState("");
  const [grupoAbierto, setGrupoAbierto] = useState({});

  const avisar = useCallback(
    (tipo, mensaje) => {
      if (typeof onToast === "function") onToast(tipo, mensaje);
    },
    [onToast]
  );

  const cargarHistorial = useCallback(async () => {
    if (!productoId) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet({
        action: "stock_precios_historial_producto",
        id_stock_producto: String(productoId),
        limit: "300",
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setProductoInfo(data?.producto || null);
    } catch (err) {
      const msg = err?.message || "No se pudo cargar el historial de precios del producto.";
      setError(msg);
      setItems([]);
      avisar("error", msg);
    } finally {
      setLoading(false);
    }
  }, [avisar, productoId]);

  useEffect(() => {
    if (!open) return;
    setGrupoAbierto({});
    cargarHistorial();
  }, [open, cargarHistorial]);

  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (typeof onClose === "function") onClose();
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, onClose]);

  const grupos = useMemo(() => {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const varianteId = Number(item?.id_stock_variante || 0);
      const key = varianteId > 0 ? `var-${varianteId}` : "base";
      const label = varianteId > 0
        ? (item?.variante_nombre || `Variante #${varianteId}`)
        : "Precio base del producto";
      if (!map.has(key)) {
        map.set(key, { key, label, varianteId, items: [] });
      }
      map.get(key).items.push(item);
    });

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "base") return -1;
      if (b.key === "base") return 1;
      return String(a.label || "").localeCompare(String(b.label || ""), "es", { numeric: true, sensitivity: "base" });
    });
  }, [items]);

  const resumen = useMemo(() => {
    let subas = 0;
    let bajas = 0;
    let difTotal = 0;
    items.forEach((item) => {
      const dif = Number(item?.diferencia || 0);
      difTotal += dif;
      if (dif > 0) subas += 1;
      if (dif < 0) bajas += 1;
    });
    return { total: items.length, subas, bajas, difTotal };
  }, [items]);

  const toggleGrupo = useCallback((key) => {
    setGrupoAbierto((prev) => {
      const abiertoActual = prev[key] !== false;
      return { ...prev, [key]: !abiertoActual };
    });
  }, []);

  const handleOverlayMouseDown = useCallback((e) => {
    if (e.target !== overlayRef.current) return;
    if (!isTopStockModal(overlayRef.current)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof onClose === "function") onClose();
  }, [onClose]);

  const handleToggleGrupo = useCallback((e, key) => {
    e.preventDefault();
    e.stopPropagation();
    toggleGrupo(key);
  }, [toggleGrupo]);

  if (!open) return null;

  const nombreProducto = productoInfo?.nombre || producto?.nombre || "Producto";
  const skuProducto = productoInfo?.sku || producto?.sku || "—";

  return createPortal(
    <div
      ref={overlayRef}
      data-stock-modal-overlay="true"
      className="mi-modal__overlay ap-modalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="mi-modal__container ap-modal ap-modal--historyProduct"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header ap-modal__head">
          <div className="mi-modal__head-icon ap-modal__titleIcon">
            <FontAwesomeIcon icon={faClockRotateLeft} />
          </div>
          <div>
            <h2>Historial de precios</h2>
            <p>{nombreProducto} · SKU {skuProducto}</p>
          </div>
          <button type="button" className="mi-modal__close ap-modal__close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="mi-modal__content ap-modal__body">
          <section className="ap-summaryGrid">
            <div className="ap-summaryCard">
              <span>Cambios</span>
              <strong>{resumen.total}</strong>
            </div>
            <div className="ap-summaryCard is-positive">
              <span>Subas</span>
              <strong>{resumen.subas}</strong>
            </div>
            <div className="ap-summaryCard is-negative">
              <span>Bajas</span>
              <strong>{resumen.bajas}</strong>
            </div>
            <div className={`ap-summaryCard ${resumen.difTotal < 0 ? "is-negative" : "is-positive"}`}>
              <span>Diferencia total</span>
              <strong>{formatSignedMoney(resumen.difTotal)}</strong>
            </div>
          </section>

          <section className="ap-panel ap-panel--historyOnly">
            <div className="ap-sectionHead">
              <div>
                <h3><FontAwesomeIcon icon={faClockRotateLeft} /> Cambios del producto y sus variantes</h3>
                <p>Incluye precio base y todas las variantes asociadas a este producto.</p>
              </div>
            </div>

            {loading ? (
              <div className="ap-empty">Cargando historial...</div>
            ) : error ? (
              <div className="ap-empty">{error}</div>
            ) : grupos.length === 0 ? (
              <div className="ap-empty">Este producto todavía no tiene cambios de precios registrados.</div>
            ) : (
              <div className="ap-history">
                {grupos.map((grupo) => {
                  const abierto = grupoAbierto[grupo.key] !== false;
                  const diferenciaGrupo = grupo.items.reduce((acc, item) => acc + Number(item?.diferencia || 0), 0);
                  return (
                    <div className="ap-historyItem" key={grupo.key}>
                      <button
                        type="button"
                        className="ap-historyItem__head"
                        aria-expanded={abierto}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => handleToggleGrupo(e, grupo.key)}
                      >
                        <span>
                          <strong>{grupo.label}</strong>
                          <small>{grupo.items.length} cambios registrados</small>
                        </span>
                        <span className="ap-historyDiff">{formatSignedMoney(diferenciaGrupo)}</span>
                        <FontAwesomeIcon icon={abierto ? faChevronUp : faChevronDown} />
                      </button>

                      {abierto ? (
                        <div className="ap-historyDetail">
                          <div className="ap-historyTable ap-historyTable--product">
                            <div className="ap-historyTable__head">
                              <span>Fecha / ajuste</span>
                              <span>Tipo precio</span>
                              <span>Anterior</span>
                              <span>Nuevo</span>
                              <span>Diferencia</span>
                            </div>
                            {grupo.items.map((item) => (
                              <div className="ap-historyTable__row" key={item.id_ajuste_precio_item}>
                                <span>
                                  <b>{item.created_at || "—"}</b>
                                  <small>
                                    Ajuste #{item.id_ajuste_precio}
                                    {item.observacion ? ` · ${item.observacion}` : ""}
                                  </small>
                                </span>
                                <span>{item.tipo_precio_nombre || "—"}</span>
                                <span>{formatMoney(item.precio_anterior)}</span>
                                <span>{formatMoney(item.precio_nuevo)}</span>
                                <span className={Number(item.diferencia || 0) < 0 ? "ap-negative" : "ap-positive"}>
                                  {formatSignedMoney(item.diferencia)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalHistorialPreciosProducto;