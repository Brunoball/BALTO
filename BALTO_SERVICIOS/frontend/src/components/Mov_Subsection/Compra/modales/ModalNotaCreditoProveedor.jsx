import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { comprasFetch } from "../api/comprasApi.js";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowDown,
  faCreditCard,
  faEye,
  faMoneyBillTrendUp,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";
import BASE_URL from "../../../../config/config.jsx";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import "../../../Global/Global_css/roots.css";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "./ModalNotaCreditoProveedor.css";
import {
  DEMO_BLOCK_MESSAGE,
  isBaltoDemoMode,
} from "../../../../utils/demoMode";

const MOTIVOS = [
  ["DEVOLUCION_MERCADERIA", "DEVOLUCIÓN DE MERCADERÍA AL PROVEEDOR"],
  ["ANULACION_TOTAL", "ANULACIÓN TOTAL DE LA COMPRA"],
  ["DESCUENTO", "DESCUENTO DEL PROVEEDOR"],
  ["BONIFICACION", "BONIFICACIÓN DEL PROVEEDOR"],
  ["DIFERENCIA_PRECIO", "DIFERENCIA DE PRECIO"],
  ["OTRO", "OTRO AJUSTE"],
];

const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

const MOTIVOS_AJUSTE_SIN_STOCK = new Set([
  "DESCUENTO",
  "BONIFICACION",
  "DIFERENCIA_PRECIO",
  "OTRO",
]);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function boundedNumberValue(value, maximum) {
  const raw = String(value ?? "");
  if (raw === "") return "";

  const parsed = Number(raw.replace(",", "."));
  const max = Math.max(0, Number(maximum) || 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max + 0.000001)
    return null;
  return raw;
}

function preventInvalidNumberKeys(event) {
  if (["e", "E", "+", "-"].includes(event.key)) event.preventDefault();
}

function money(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
  });
}

function quantity(value) {
  return Number(value || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function makeKey(id) {
  const uuid =
    window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  return `nc-compra-${id || 0}-${uuid}`.slice(0, 100);
}

function auth() {
  const token = (localStorage.getItem("token") || "").trim();
  const sessionKey = (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("X-Session") ||
    ""
  ).trim();
  let idUsuario = 0;
  try {
    const user = JSON.parse(localStorage.getItem("usuario") || "null");
    idUsuario =
      Number(
        user?.idUsuarioMaster ??
          user?.idUsuario ??
          user?.id_usuario ??
          user?.id ??
          0,
      ) || 0;
  } catch {
    // El backend admite id_usuario nulo.
  }
  return { token, sessionKey, idUsuario };
}

function headers(json = false) {
  const session = auth();
  const result = json ? { "Content-Type": "application/json" } : {};
  if (session.sessionKey) result["X-Session"] = session.sessionKey;
  if (session.token) result.Authorization = `Bearer ${session.token}`;
  return result;
}

async function parse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(text || "Respuesta inválida.");
  }
  if (!response.ok || !data?.exito) {
    throw new Error(data?.mensaje || data?.message || "Error en la operación.");
  }
  return data;
}

function allowedFile(file) {
  if (!file) return false;
  return (
    file.type === "application/pdf" ||
    String(file.type || "").startsWith("image/")
  );
}

export default function ModalNotaCreditoProveedor({
  open,
  row,
  onClose,
  onToast,
  onDone,
}) {
  const API = `${BASE_URL}/api.php`;
  const [ctx, setCtx] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("DEVOLUCION_MERCADERIA");
  const [observaciones, setObservaciones] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [ajuste, setAjuste] = useState("");
  const [ivaAjuste, setIvaAjuste] = useState("0");
  const [descripcionAjuste, setDescripcionAjuste] = useState(
    "DESCUENTO / BONIFICACIÓN",
  );
  const [archivo, setArchivo] = useState(null);
  const [openPreview, setOpenPreview] = useState(false);
  const fileRef = useRef(null);
  const keyRef = useRef("");

  const archivoPreviewUrl = useMemo(
    () => (archivo ? URL.createObjectURL(archivo) : ""),
    [archivo],
  );

  useEffect(
    () => () => {
      if (archivoPreviewUrl) URL.revokeObjectURL(archivoPreviewUrl);
    },
    [archivoPreviewUrl],
  );

  const toast = useCallback(
    (type, message, duration = 3200) => onToast?.(type, message, duration),
    [onToast],
  );

  const idOrigen = Number(row?.id_movimiento ?? row?.id_compra ?? row?.id ?? 0);
  const esAjusteSinStock = MOTIVOS_AJUSTE_SIN_STOCK.has(motivo);
  const esAnulacionTotal = motivo === "ANULACION_TOTAL";

  const load = useCallback(async () => {
    if (!idOrigen) return;
    setLoading(true);
    setError("");
    try {
      const response = await comprasFetch(
        `${API}?action=compras_nota_credito_contexto&id_movimiento=${idOrigen}`,
        { headers: headers() },
      );
      const data = await parse(response);
      const context = data.contexto || data.data?.contexto;
      const contextItems = (context?.items || []).map((item) => ({
        id_item_origen: Number(item.id_item),
        descripcion: item.descripcion_resuelta || item.descripcion || "Ítem",
        disponible: Number(item.cantidad_disponible || 0),
        cantidadOriginal: Number(
          item.cantidad_original || item.cantidad || 0,
        ),
        subtotalOriginal: Number(item.subtotal || 0),
        ivaOriginal: Number(item.iva_monto || 0),
        totalOriginal: Number(item.total || 0),
        iva_pct: Number(item.iva_pct || 0),
        cantidad: "",
      }));
      setCtx(context);
      setItems(contextItems);
      const ivaCompra =
        contextItems.find((item) => Number.isFinite(item.iva_pct))?.iva_pct ?? 0;
      setIvaAjuste(String(ivaCompra));
    } catch (loadError) {
      setError(loadError.message || "No se pudo cargar la compra.");
    } finally {
      setLoading(false);
    }
  }, [API, idOrigen]);

  useEffect(() => {
    if (!open) return;
    keyRef.current = makeKey(idOrigen);
    setCtx(null);
    setItems([]);
    setError("");
    setMotivo("DEVOLUCION_MERCADERIA");
    setObservaciones("");
    setFecha(todayISO());
    setAjuste("");
    setIvaAjuste("0");
    setDescripcionAjuste("DESCUENTO / BONIFICACIÓN");
    setArchivo(null);
    setOpenPreview(false);
    if (fileRef.current) fileRef.current.value = "";
    load();
  }, [open, idOrigen, load]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !loading && !openPreview) onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, loading, onClose, openPreview]);

  useEffect(() => {
    if (esAnulacionTotal) {
      setItems((previous) =>
        previous.map((item) => ({
          ...item,
          cantidad: item.disponible > 0 ? String(item.disponible) : "",
        })),
      );
      setAjuste("");
      return;
    }

    if (esAjusteSinStock) {
      setItems((previous) =>
        previous.map((item) => ({ ...item, cantidad: "" })),
      );
      const descriptions = {
        DESCUENTO: "DESCUENTO DEL PROVEEDOR",
        BONIFICACION: "BONIFICACIÓN DEL PROVEEDOR",
        DIFERENCIA_PRECIO: "DIFERENCIA DE PRECIO",
        OTRO: "OTRO AJUSTE",
      };
      setDescripcionAjuste(descriptions[motivo] || "DESCUENTO / BONIFICACIÓN");
      return;
    }

    setAjuste("");
  }, [esAjusteSinStock, esAnulacionTotal, motivo]);

  const selected = useMemo(
    () =>
      items
        .filter((item) => num(item.cantidad) > 0)
        .map((item) => {
          const selectedQuantity = num(item.cantidad);
          const baseQuantity = Math.max(0.000001, item.cantidadOriginal);
          return {
            ...item,
            cantidad: selectedQuantity,
            subtotal: Number(
              (
                (item.subtotalOriginal / baseQuantity) *
                selectedQuantity
              ).toFixed(2),
            ),
            iva_monto: Number(
              ((item.ivaOriginal / baseQuantity) * selectedQuantity).toFixed(2),
            ),
            total: Number(
              ((item.totalOriginal / baseQuantity) * selectedQuantity).toFixed(
                2,
              ),
            ),
          };
        }),
    [items],
  );

  const ajusteN = esAjusteSinStock ? Math.max(0, num(ajuste)) : 0;
  const disponible = Number(ctx?.total_disponible || 0);
  const totalCalculado = useMemo(
    () =>
      Number(
        (selected.reduce((sum, item) => sum + item.total, 0) + ajusteN).toFixed(
          2,
        ),
      ),
    [selected, ajusteN],
  );
  const total = esAnulacionTotal ? disponible : totalCalculado;
  const totalCompraLuego = Math.max(0, Number((disponible - total).toFixed(2)));
  const excede = !esAnulacionTotal && total - disponible > 0.05;
  const cantidadesValidas = selected.every(
    (item) => item.cantidad <= item.disponible + 0.0001,
  );
  const contenidoValido = esAnulacionTotal
    ? disponible > 0
    : esAjusteSinStock
      ? ajusteN > 0
      : selected.length > 0;
  const valid =
    Boolean(fecha) &&
    total > 0 &&
    !excede &&
    cantidadesValidas &&
    contenidoValido;

  const submit = async () => {
    if (isBaltoDemoMode()) {
      toast("advertencia", DEMO_BLOCK_MESSAGE, 5200);
      return;
    }

    if (!valid) {
      setError(
        esAjusteSinStock
          ? "Ingresá un importe válido para la nota de crédito."
          : "Seleccioná las cantidades que devuelve la compra.",
      );
      return;
    }

    setLoading(true);
    setError("");
    try {
      const body = {
        id_movimiento_origen: idOrigen,
        modalidad: "PROVEEDOR",
        motivo,
        fecha,
        observaciones,
        id_usuario: auth().idUsuario || null,
        idempotency_key: keyRef.current,
        items: selected.map((item) => ({
          id_item_origen: item.id_item_origen,
          cantidad: item.cantidad,
          // En una devolución de compra, el producto sale del stock siempre.
          afecta_stock: true,
        })),
        importe_ajuste: ajusteN,
        iva_pct_ajuste: Math.max(0, num(ivaAjuste)),
        descripcion_ajuste: descripcionAjuste || "DESCUENTO / BONIFICACIÓN",
      };

      const response = await comprasFetch(`${API}?action=compras_nota_credito_crear`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(body),
      });
      const data = await parse(response);
      const idNc = Number(
        data.id_movimiento_nota_credito ||
          data.data?.id_movimiento_nota_credito ||
          0,
      );
      let archivoNoAdjuntado = false;

      if (idNc && archivo) {
        try {
          const formData = new FormData();
          formData.append("archivo", archivo);
          formData.append("tipo", "NOTA_CREDITO_PROVEEDOR");
          formData.append("force", "0");
          formData.append("ids_movimiento", JSON.stringify([idNc]));
          const uploadResponse = await comprasFetch(
            `${API}?action=compras_comprobantes_vincular_movimientos_lote_upload`,
            { method: "POST", headers: headers(), body: formData },
          );
          await parse(uploadResponse);
        } catch (uploadError) {
          archivoNoAdjuntado = true;
          toast(
            "advertencia",
            `La nota quedó aplicada, pero no se pudo adjuntar el archivo: ${uploadError.message || "error de carga"}.`,
            6200,
          );
        }
      }

      onDone?.({ ...data, archivo_no_adjuntado: archivoNoAdjuntado });
      onClose?.();
    } catch (submitError) {
      const message =
        submitError.message || "No se pudo aplicar la nota de crédito.";
      setError(message);
      toast("error", message, 4600);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {createPortal(
        <div className="gm-modal-overlay">
      <div
        className="gm-modal-container gm-modal-v2 ncp-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ncp-modal-title"
      >
        <header className="gm-modal-header">
          <div
            className="gm-modal-head-icon ncp-modal__head-icon"
            aria-hidden="true"
          >
            ↩
          </div>
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="ncp-modal-title">
              Aplicar nota de crédito del proveedor
            </h2>
            <p className="gm-modal-subtitle">
              Compra #{idOrigen || "—"} · Comprobante emitido por el proveedor
            </p>
          </div>
          <button
            type="button"
            className="gm-modal-close"
            onClick={onClose}
            disabled={loading}
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </header>

        <div className="gm-modal-content ncp-modal__body">
          {loading && !ctx && (
            <div className="ncp-feedback ncp-feedback--loading" role="status">
              <span className="ncp-feedback__dot" aria-hidden="true" />
              Cargando compra…
            </div>
          )}

          {error && (
            <div className="ncp-feedback ncp-feedback--error" role="alert">
              {error}
            </div>
          )}

          {ctx && (
            <>
              <div
                className="ncp-summary-grid"
                aria-label="Resumen de importes"
              >
                <article className="ncp-summary-card ncp-summary-card--blue">
                  <div className="ncp-summary-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faMoneyBillTrendUp} />
                  </div>
                  <div className="ncp-summary-card__body">
                    <span className="ncp-summary-card__label">
                      Total original
                    </span>
                    <b className="ncp-summary-card__value">
                      {money(ctx.total_original)}
                    </b>
                    <span className="ncp-summary-card__detail">
                      Importe de la compra
                    </span>
                  </div>
                </article>

                <article className="ncp-summary-card ncp-summary-card--pink">
                  <div className="ncp-summary-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faCreditCard} />
                  </div>
                  <div className="ncp-summary-card__body">
                    <span className="ncp-summary-card__label">
                      Ya acreditado
                    </span>
                    <b className="ncp-summary-card__value">
                      {money(ctx.total_acreditado)}
                    </b>
                    <span className="ncp-summary-card__detail">
                      Notas anteriores
                    </span>
                  </div>
                </article>

                <article className="ncp-summary-card ncp-summary-card--yellow">
                  <div className="ncp-summary-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faArrowDown} />
                  </div>
                  <div className="ncp-summary-card__body">
                    <span className="ncp-summary-card__label">Esta nota</span>
                    <b className="ncp-summary-card__value">{money(total)}</b>
                    <span className="ncp-summary-card__detail">
                      Importe seleccionado
                    </span>
                  </div>
                </article>

                <article className="ncp-summary-card ncp-summary-card--green">
                  <div className="ncp-summary-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faWallet} />
                  </div>
                  <div className="ncp-summary-card__body">
                    <span className="ncp-summary-card__label">
                      Compra quedará en
                    </span>
                    <b className="ncp-summary-card__value">
                      {money(totalCompraLuego)}
                    </b>
                    <span className="ncp-summary-card__detail">
                      Importe neto actualizado
                    </span>
                  </div>
                </article>
              </div>

              <div className="gm-info-box ncp-provider-notice">
                <div className="ncp-provider-notice__title">
                  Comprobante del proveedor
                </div>
                <div className="ncp-provider-notice__text">
                  La nota la emite el proveedor. En Balto sólo la aplicás sobre
                  esta compra y, si la tenés, adjuntás su imagen o PDF. No se
                  solicita CAE, punto de venta ni número de comprobante.
                </div>
              </div>

              <div className="ncp-form-grid">
                <div className="gm-field">
                  <input
                    className="gm-input"
                    type="date"
                    value={fecha}
                    onChange={(event) => setFecha(event.target.value)}
                    onClick={(event) => event.currentTarget.showPicker?.()}
                    disabled={loading}
                  />
                  <label className="gm-label gm-label--up">
                    Fecha de la nota
                  </label>
                </div>

                <div
                  className={`gm-field ncp-file-field${archivo ? " has-file" : ""}`}
                >
                  <input
                    className="gm-input ncp-file-input"
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={loading}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      if (file && !allowedFile(file)) {
                        setError("Solo se permiten imágenes o archivos PDF.");
                        event.target.value = "";
                        setOpenPreview(false);
                        setArchivo(null);
                        return;
                      }
                      setError("");
                      setOpenPreview(false);
                      setArchivo(file);
                    }}
                  />
                  <label className="gm-label gm-label--up">
                    Imagen o PDF (opcional)
                  </label>
                  {archivo && (
                    <>
                      <small className="ncp-file-name" title={archivo.name}>
                        {archivo.name}
                      </small>
                      <button
                        type="button"
                        className="ncp-file-preview-btn"
                        onClick={() => setOpenPreview(true)}
                        disabled={loading}
                        title="Ver archivo seleccionado"
                        aria-label="Ver archivo seleccionado"
                      >
                        <FontAwesomeIcon icon={faEye} />
                      </button>
                    </>
                  )}
                </div>

                <div className="gm-field">
                  <select
                    className="gm-input gm-select"
                    value={motivo}
                    onChange={(event) => setMotivo(event.target.value)}
                    disabled={loading}
                  >
                    {MOTIVOS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <label className="gm-label gm-label--up">Motivo</label>
                </div>

                <div className="gm-field">
                  <input
                    className="gm-input"
                    value={observaciones}
                    onChange={(event) =>
                      setObservaciones(event.target.value.toUpperCase())
                    }
                    placeholder=" "
                    disabled={loading}
                  />
                  <label className="gm-label">Observaciones</label>
                </div>
              </div>

              {!esAjusteSinStock && (
                <section className="gm-section">
                  <div className="gm-section-head">
                    <div className="gm-section-dot" />
                    <span>
                      {esAnulacionTotal
                        ? "Productos devueltos por la anulación total"
                        : "Productos devueltos al proveedor"}
                    </span>
                  </div>
                  <div className="gm-section-body ncp-products-body">
                    <div
                      className="gm-table ncp-table"
                      role="table"
                      aria-label="Productos de la compra"
                    >
                      <div className="gm-table-head" role="row">
                        <div className="gm-table-th" role="columnheader">
                          Producto
                        </div>
                        <div className="gm-table-th" role="columnheader">
                          Comprado
                        </div>
                        <div className="gm-table-th" role="columnheader">
                          Ya devuelto
                        </div>
                        <div className="gm-table-th" role="columnheader">
                          Disponible
                        </div>
                        <div className="gm-table-th" role="columnheader">
                          Devolver ahora
                        </div>
                        <div className="gm-table-th" role="columnheader">
                          Importe
                        </div>
                      </div>
                      <div className="gm-table-body">
                        {items.length === 0 ? (
                          <div className="ncp-table-empty" role="row">
                            La compra no tiene productos disponibles para
                            acreditar.
                          </div>
                        ) : (
                          items.map((item, index) => {
                            const selectedItem = selected.find(
                              (current) =>
                                current.id_item_origen === item.id_item_origen,
                            );
                            const alreadyReturned = Math.max(
                              0,
                              item.cantidadOriginal - item.disponible,
                            );
                            return (
                              <div
                                className="gm-table-row"
                                role="row"
                                key={item.id_item_origen}
                              >
                                <div
                                  className="gm-table-cell gm-table-cell--detail"
                                  role="cell"
                                  title={item.descripcion}
                                >
                                  <strong className="ncp-product-name">
                                    {item.descripcion}
                                  </strong>
                                </div>
                                <div
                                  className="gm-table-cell gm-table-cell--center gm-table-cell--mono"
                                  role="cell"
                                >
                                  {quantity(item.cantidadOriginal)}
                                </div>
                                <div
                                  className="gm-table-cell gm-table-cell--center gm-table-cell--mono"
                                  role="cell"
                                >
                                  {quantity(alreadyReturned)}
                                </div>
                                <div
                                  className="gm-table-cell gm-table-cell--center gm-table-cell--mono"
                                  role="cell"
                                >
                                  {quantity(item.disponible)}
                                </div>
                                <div
                                  className="gm-table-cell gm-table-cell--center"
                                  role="cell"
                                >
                                  <input
                                    className="gm-input ncp-quantity-input"
                                    type="number"
                                    min="0"
                                    max={item.disponible}
                                    step="0.001"
                                    value={item.cantidad}
                                    disabled={
                                      esAnulacionTotal || item.disponible <= 0
                                    }
                                    onKeyDown={preventInvalidNumberKeys}
                                    onChange={(event) => {
                                      const value = boundedNumberValue(
                                        event.target.value,
                                        item.disponible,
                                      );
                                      if (value === null) return;
                                      setItems((previous) =>
                                        previous.map((current, currentIndex) =>
                                          currentIndex === index
                                            ? { ...current, cantidad: value }
                                            : current,
                                        ),
                                      );
                                    }}
                                  />
                                </div>
                                <div
                                  className="gm-table-cell gm-table-cell--right gm-table-cell--total"
                                  role="cell"
                                >
                                  {money(selectedItem?.total || 0)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {esAjusteSinStock && (
                <section className="gm-section">
                  <div className="gm-section-head">
                    <div className="gm-section-dot" />
                    <span>Importe acreditado sin devolución de stock</span>
                  </div>
                  <div className="gm-section-body">
                    <div className="ncp-form-grid ncp-form-grid--adjustment">
                      <div className="gm-field">
                        <input
                          className="gm-input"
                          value={descripcionAjuste}
                          onChange={(event) =>
                            setDescripcionAjuste(
                              event.target.value.toUpperCase(),
                            )
                          }
                          placeholder=" "
                          disabled={loading}
                        />
                        <label className="gm-label">Descripción</label>
                      </div>
                      <div className="gm-field">
                        <input
                          className="gm-input"
                          type="number"
                          min="0"
                          max={disponible}
                          step="0.01"
                          value={ajuste}
                          onKeyDown={preventInvalidNumberKeys}
                          onChange={(event) => {
                            const value = boundedNumberValue(
                              event.target.value,
                              disponible,
                            );
                            if (value !== null) setAjuste(value);
                          }}
                          placeholder=" "
                          disabled={loading}
                        />
                        <label className="gm-label">Importe final</label>
                      </div>
                      <div className="gm-field">
                        <select
                          className="gm-input gm-select"
                          value={String(ivaAjuste)}
                          onChange={(event) => setIvaAjuste(event.target.value)}
                          disabled={loading}
                        >
                          {IVA_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <label className="gm-label gm-label--up">IVA % incluido</label>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {excede && (
                <div className="ncp-feedback ncp-feedback--error" role="alert">
                  La nota supera el importe que todavía queda disponible en la
                  compra.
                </div>
              )}
            </>
          )}
        </div>

        <footer className="gm-modal-footer ncp-modal__footer">
          <button
            type="button"
            className="gm-action-btn gm-action-btn--cancel"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="gm-action-btn gm-action-btn--save"
            onClick={submit}
            disabled={loading || !ctx || !valid}
          >
            {loading ? "Aplicando…" : "Aplicar nota de crédito"}
          </button>
        </footer>
      </div>
        </div>,
        document.body,
      )}

      <ModalVerComprobante
        open={openPreview && Boolean(archivoPreviewUrl)}
        url={archivoPreviewUrl}
        mime={archivo?.type || "application/octet-stream"}
        fileName={archivo?.name || ""}
        onClose={() => setOpenPreview(false)}
        title="Vista previa de la nota de crédito"
      />
    </>
  );
}
