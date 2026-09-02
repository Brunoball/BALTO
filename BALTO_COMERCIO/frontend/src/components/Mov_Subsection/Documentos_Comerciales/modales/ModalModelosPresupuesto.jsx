import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faPen, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import ProductStockAutocomplete from "../../_shared/ProductStockAutocomplete.jsx";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import ModalEliminar from "../../../Global/Modales/ModalEliminar.jsx";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalModelosPresupuesto.css";
import "./ModalPresupuestosChecklist.css";
import { DOCUMENTOS_API, documentosRequest } from "../api/documentosComercialesApi.js";

const IVA_OPTIONS = [0, 10.5, 21, 27];

function uid() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function upperInput(v) {
  return String(v ?? "").toLocaleUpperCase("es-AR");
}

function upperStr(v) {
  return upperInput(v).trim();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function moneyARS(v) {
  try {
    return Number(v || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${Number(v || 0).toFixed(2)}`;
  }
}

function getStockProductoId(d) {
  const n = Number(d?.id_stock_producto ?? d?.idStockProducto ?? d?.id_producto ?? d?.id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getStockVarianteId(d) {
  const n = Number(d?.id_stock_variante ?? d?.idStockVariante ?? d?.id_variante ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getNombre(d) {
  return upperStr(d?.nombre || d?.descripcion || d?.detalle || d?.label || "");
}

function getCodigo(d) {
  return upperStr(d?.sku || d?.codigo || d?.codigo_barra || "");
}

function getPrecio(d) {
  const candidates = [d?.precio_venta, d?.precio, d?.precio_promocional, d?.precio_mayorista];
  for (const raw of candidates) {
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const precios = Array.isArray(d?.precios) ? d.precios : [];
  for (const item of precios) {
    const raw = item?.monto ?? item?.precio;
    if (raw === null || raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function emptyRow() {
  return {
    localId: uid(),
    id_detalle: null,
    id_stock_producto: null,
    id_stock_variante: null,
    descripcion: "",
    codigo: "",
    cantidad: 1,
    precio: 0,
    iva_pct: 0,
  };
}

function rowFromItem(item) {
  return {
    localId: uid(),
    id_detalle: Number(item?.id_detalle || 0) || null,
    id_stock_producto: Number(item?.id_stock_producto || 0) || null,
    id_stock_variante: Number(item?.id_stock_variante || 0) || null,
    descripcion: upperStr(item?.descripcion || item?.detalle || item?.nombre),
    codigo: upperStr(item?.codigo || item?.sku),
    cantidad: safeNumber(item?.cantidad) || 1,
    precio: safeNumber(item?.precio ?? item?.precio_unitario),
    iva_pct: safeNumber(item?.iva_pct),
  };
}

function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const data = src.listas && typeof src.listas === "object" ? src.listas : src;
  return Array.isArray(data.detalles) ? data.detalles : Array.isArray(data.productos) ? data.productos : [];
}

function buildHeaders(json = true) {
  const sessionKey =
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") ||
    localStorage.getItem("X-Session") ||
    "";
  const token = localStorage.getItem("token") || localStorage.getItem("auth_token") || "";
  const headers = {};
  if (json) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseJson(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}`);
  }
  if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  return data || {};
}

export default function ModalModelosPresupuesto({ open, lists, onClose, onToast, onUseModel }) {
  const API = DOCUMENTOS_API;
  const stockOptions = useMemo(() => normalizeLists(lists), [lists]);
  const [modelos, setModelos] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [modeloEliminar, setModeloEliminar] = useState(null);
  const [form, setForm] = useState({
    id_modelo: null,
    nombre: "",
    descripcion: "",
    es_personalizado: true,
    validez_dias: "7",
    plazo_entrega: "",
    forma_pago: "",
    condiciones_comerciales: "",
    garantia: "",
    lugar_entrega: "",
    notas: "",
    rows: [emptyRow()],
  });

  const cargar = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await documentosRequest(`${API}?action=presupuestos_modelos_listar&limit=200`, {
        method: "GET",
        headers: buildHeaders(false),
      });
      const data = await parseJson(res);
      setModelos(Array.isArray(data?.modelos) ? data.modelos : Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      onToast?.("error", e?.message || "No se pudieron cargar los modelos.", 4500);
    } finally {
      setLoading(false);
    }
  }, [API, onToast, open]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setEditorOpen(false);
    setDeletingId(null);
    setModeloEliminar(null);
    cargar();
  }, [open, cargar]);

  const filtered = useMemo(() => {
    const needle = safeStr(q).toLowerCase();
    if (!needle) return modelos;
    return modelos.filter((m) => {
      const items = Array.isArray(m?.items) ? m.items : [];
      return [m?.nombre, m?.descripcion, ...items.map((i) => i?.descripcion || i?.nombre)]
        .map((v) => safeStr(v).toLowerCase())
        .some((v) => v.includes(needle));
    });
  }, [modelos, q]);

  const openCreate = useCallback(() => {
    setForm({
      id_modelo: null,
      nombre: "",
      descripcion: "",
      es_personalizado: true,
      validez_dias: "7",
      plazo_entrega: "",
      forma_pago: "",
      condiciones_comerciales: "",
      garantia: "",
      lugar_entrega: "",
      notas: "",
      rows: [emptyRow()],
    });
    setEditorOpen(true);
  }, []);

  const openEdit = useCallback((modelo) => {
    const c = modelo?.condiciones_presupuesto && typeof modelo.condiciones_presupuesto === "object"
      ? modelo.condiciones_presupuesto
      : {};
    setForm({
      id_modelo: Number(modelo?.id_modelo || 0) || null,
      nombre: upperStr(modelo?.nombre),
      descripcion: upperStr(modelo?.descripcion),
      es_personalizado: Number(modelo?.es_personalizado ?? 1) === 1,
      validez_dias: String(modelo?.validez_dias ?? c?.validez_dias ?? c?.validezDias ?? "7"),
      plazo_entrega: upperStr(modelo?.plazo_entrega || c?.plazo_entrega || c?.plazoEntrega),
      forma_pago: upperStr(modelo?.forma_pago || c?.forma_pago || c?.formaPago),
      condiciones_comerciales: upperStr(modelo?.condiciones_comerciales || c?.condiciones_comerciales || c?.condicionesComerciales),
      garantia: upperStr(modelo?.garantia || c?.garantia),
      lugar_entrega: upperStr(modelo?.lugar_entrega || c?.lugar_entrega || c?.lugarEntrega),
      notas: upperStr(modelo?.notas || c?.notas),
      rows: Array.isArray(modelo?.items) && modelo.items.length ? modelo.items.map(rowFromItem) : [emptyRow()],
    });
    setEditorOpen(true);
  }, []);

  const updateRow = useCallback((localId, patch) => {
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.localId === localId ? { ...row, ...patch } : row)),
    }));
  }, []);

  const selectStock = useCallback((localId, option) => {
    updateRow(localId, {
      id_detalle: null,
      id_stock_producto: getStockProductoId(option),
      id_stock_variante: getStockVarianteId(option),
      descripcion: getNombre(option),
      codigo: getCodigo(option),
      precio: getPrecio(option),
    });
  }, [updateRow]);

  const barcodePendingRef = useRef(null);

  const handleBarcodeProductSelect = useCallback((producto) => {
    const target = (form.rows || []).find((row) =>
      !Number(row?.id_stock_producto || 0) &&
      !Number(row?.id_stock_variante || 0) &&
      !String(row?.descripcion || "").trim()
    );

    if (target) {
      selectStock(target.localId, producto);
      onToast?.("exito", `Producto leído: ${getNombre(producto)}`, 1800);
      return;
    }

    const nextRow = emptyRow();
    barcodePendingRef.current = { localId: nextRow.localId, producto };
    setForm((prev) => ({ ...prev, rows: [...(prev.rows || []), nextRow] }));
  }, [form.rows, selectStock, onToast]);

  useEffect(() => {
    const pending = barcodePendingRef.current;
    if (!pending || !(form.rows || []).some((row) => row.localId === pending.localId)) return;
    barcodePendingRef.current = null;
    selectStock(pending.localId, pending.producto);
    onToast?.("exito", `Producto leído: ${getNombre(pending.producto)}`, 1800);
  }, [form.rows, selectStock, onToast]);

  useStockBarcodeScanner({
    enabled: open && editorOpen && !saving,
    options: stockOptions,
    allowOutOfStock: form.es_personalizado,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => onToast?.("advertencia", mensaje, 3200),
  });

  const itemsPayload = useMemo(() => {
    return form.rows
      .filter((r) => safeStr(r.descripcion) && safeNumber(r.cantidad) > 0)
      .map((r) => {
        const cantidad = safeNumber(r.cantidad);
        const precio = safeNumber(r.precio);
        const ivaPct = safeNumber(r.iva_pct);
        const subtotal = cantidad * precio;
        const ivaMonto = subtotal * ivaPct / 100;
        return {
          id_detalle: r.id_detalle || null,
          id_stock_producto: r.id_stock_producto || null,
          id_stock_variante: r.id_stock_variante || null,
          descripcion: upperStr(r.descripcion),
          detalle: upperStr(r.descripcion),
          codigo: upperStr(r.codigo),
          cantidad,
          precio,
          precio_unitario: precio,
          iva_pct: ivaPct,
          subtotal,
          iva_monto: ivaMonto,
          total: subtotal + ivaMonto,
        };
      });
  }, [form.rows]);

  const total = useMemo(() => itemsPayload.reduce((acc, item) => acc + safeNumber(item.total), 0), [itemsPayload]);

  const guardar = useCallback(async () => {
    if (!safeStr(form.nombre)) {
      onToast?.("error", "Ingresá un nombre para el modelo.", 3500);
      return;
    }
    if (!itemsPayload.length) {
      onToast?.("error", "Agregá al menos un elemento al modelo.", 3500);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        id_modelo: form.id_modelo,
        nombre: upperStr(form.nombre),
        descripcion: upperStr(form.descripcion),
        es_personalizado: form.es_personalizado ? 1 : 0,
        validez_dias: safeNumber(form.validez_dias) > 0 ? Math.floor(safeNumber(form.validez_dias)) : null,
        plazo_entrega: upperStr(form.plazo_entrega),
        forma_pago: upperStr(form.forma_pago),
        condiciones_comerciales: upperStr(form.condiciones_comerciales),
        garantia: upperStr(form.garantia),
        lugar_entrega: upperStr(form.lugar_entrega),
        notas: upperStr(form.notas),
        moneda: "ARS",
        condiciones_presupuesto: {
          validez_dias: safeNumber(form.validez_dias) > 0 ? Math.floor(safeNumber(form.validez_dias)) : null,
          plazo_entrega: safeStr(form.plazo_entrega),
          forma_pago: safeStr(form.forma_pago),
          condiciones_comerciales: safeStr(form.condiciones_comerciales),
          garantia: safeStr(form.garantia),
          lugar_entrega: safeStr(form.lugar_entrega),
          notas: safeStr(form.notas),
          moneda: "ARS",
        },
        items: itemsPayload,
      };
      const res = await documentosRequest(`${API}?action=presupuestos_modelos_guardar`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      await parseJson(res);
      onToast?.("exito", form.id_modelo ? "Modelo actualizado correctamente." : "Modelo creado correctamente.", 3000);
      setEditorOpen(false);
      await cargar();
    } catch (e) {
      onToast?.("error", e?.message || "No se pudo guardar el modelo.", 4800);
    } finally {
      setSaving(false);
    }
  }, [API, cargar, form, itemsPayload, onToast]);

  const eliminar = useCallback(async () => {
    const id = Number(modeloEliminar?.id_modelo || 0);
    if (!id) throw new Error("No se pudo identificar el modelo seleccionado.");

    setDeletingId(id);
    try {
      const res = await documentosRequest(`${API}?action=presupuestos_modelos_eliminar`, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({ id_modelo: id }),
      });
      await parseJson(res);
      setModelos((prev) => prev.filter((m) => Number(m?.id_modelo) !== id));
      setModeloEliminar(null);
    } finally {
      setDeletingId(null);
    }
  }, [API, modeloEliminar]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;

      // El modal de confirmación es la capa superior y administra su propio Escape.
      if (modeloEliminar || saving) return;

      event.preventDefault();

      if (editorOpen) {
        setEditorOpen(false);
        return;
      }

      onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen, modeloEliminar, onClose, open, saving]);

  if (!open) return null;

  return createPortal(
    <div
      className="gm-modal-overlay presupuesto-modelos-overlay"
      role="presentation"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={`gm-modal-container gm-modal-v2 presupuesto-modelos-modal ${
          editorOpen ? "gm-modal-container--movement presupuesto-modelos-modal--editor" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Modelos de presupuesto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M7 3.75h8.5L20.25 8.5V20.25H7V3.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M15.5 3.75V8.5h4.75M10.25 12h6.75M10.25 15.5h6.75" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.75 7.25v13h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">
              {editorOpen ? (form.id_modelo ? "Editar modelo" : "Nuevo modelo") : "Modelos de presupuesto"}
            </h2>
            <p className="gm-modal-subtitle">
              {editorOpen
                ? "Definí los elementos base; después cada presupuesto puede ajustar cantidades, medidas y precios."
                : "Guardá y reutilizá estructuras de trabajos frecuentes."}
            </p>
          </div>
          <button
            type="button"
            className="gm-modal-close"
            onClick={() => editorOpen ? setEditorOpen(false) : onClose?.()}
            disabled={saving}
            aria-label={editorOpen ? "Volver a modelos" : "Cerrar"}
          >
            ✕
          </button>
        </header>

        {!editorOpen ? (
          <div className="gm-modal-content presupuesto-modelos-content">
            <div className="presupuesto-modelos-toolbar">
              <div className="gm-field presupuesto-modelos-search">
                <svg className="presupuesto-modelos-search__icon" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input
                  className="gm-input"
                  value={q}
                  onChange={(e) => setQ(upperInput(e.target.value))}
                  placeholder=" "
                  aria-label="Buscar por nombre o material"
                />
                <label className="gm-label">Buscar por nombre o material</label>
              </div>
              <button
                type="button"
                className="gm-action-btn gm-action-btn--save presupuesto-modelos-create"
                onClick={openCreate}
              >
                <span aria-hidden="true">＋</span>
                Crear modelo
              </button>
            </div>

            {loading ? (
              <div className="gm-table-empty presupuesto-modelos-empty" aria-live="polite">Cargando modelos…</div>
            ) : filtered.length === 0 ? (
              <div className="gm-table-empty presupuesto-modelos-empty">
                {q ? "No hay modelos que coincidan con la búsqueda." : "Todavía no hay modelos guardados."}
              </div>
            ) : (
              <div className="presupuesto-modelos-grid">
                {filtered.map((modelo) => (
                  <article className="presupuesto-modelo-card" key={modelo.id_modelo}>
                    <div className="presupuesto-modelo-card__top">
                      <div className="presupuesto-modelo-card__eyebrow">
                        <div className="presupuesto-modelo-card__identity">
                          <span className="presupuesto-modelo-card__icon" aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M6.75 3.75h7.8l3.7 3.7v12.8H6.75V3.75Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                              <path d="M14.55 3.75v3.7h3.7M9.75 11h5.5M9.75 14.5h5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="presupuesto-modelo-card__badge">
                            {Number(modelo.es_personalizado ?? 1) === 1 ? "PERSONALIZADO" : "CON STOCK"}
                          </span>
                        </div>
                        <div className="presupuesto-modelo-card__actions" aria-label="Acciones del modelo">
                          <button
                            type="button"
                            className="gm-action-btn gm-action-btn--save presupuesto-modelo-card__button presupuesto-modelo-card__button--use"
                            onClick={() => onUseModel?.(modelo)}
                            title="Usar modelo"
                            aria-label={`Usar modelo ${upperStr(modelo.nombre) || "sin nombre"}`}
                          >
                            <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="gm-action-btn gm-action-btn--secondary presupuesto-modelo-card__button"
                            onClick={() => openEdit(modelo)}
                            title="Editar modelo"
                            aria-label={`Editar modelo ${upperStr(modelo.nombre) || "sin nombre"}`}
                          >
                            <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="gm-action-btn gm-action-btn--danger presupuesto-modelo-card__button"
                            disabled={Boolean(deletingId)}
                            onClick={() => setModeloEliminar(modelo)}
                            title="Eliminar modelo"
                            aria-label={`Eliminar modelo ${upperStr(modelo.nombre) || "sin nombre"}`}
                          >
                            <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <strong>{upperStr(modelo.nombre) || "MODELO SIN NOMBRE"}</strong>
                      <p>{upperStr(modelo.descripcion) || "SIN DESCRIPCIÓN"}</p>
                    </div>
                    <div className="presupuesto-modelo-card__items">
                      <div className="presupuesto-modelo-card__section-title">Elementos incluidos</div>
                      {(Array.isArray(modelo.items) ? modelo.items : []).slice(0, 3).map((item, idx) => (
                        <div key={`${modelo.id_modelo}-${idx}`}>
                          <span>{safeNumber(item.cantidad)}×</span>
                          <b>{upperStr(item.descripcion || item.nombre)}</b>
                        </div>
                      ))}
                      {(!Array.isArray(modelo.items) || modelo.items.length === 0) && (
                        <small className="presupuesto-modelo-card__empty-items">Sin elementos cargados</small>
                      )}
                      {Number(modelo.cantidad_items || 0) > 3 && <small>+ {Number(modelo.cantidad_items) - 3} elementos más</small>}
                    </div>
                    <div className="presupuesto-modelo-card__summary">
                      <div className="presupuesto-modelo-card__metric">
                        <span>Elementos</span>
                        <b>{Number(modelo.cantidad_items || 0)}</b>
                      </div>
                      <div className="presupuesto-modelo-card__metric presupuesto-modelo-card__metric--total">
                        <span>Total base</span>
                        <b>{moneyARS(modelo.total_modelo || 0)}</b>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="gm-modal-content presupuesto-modelos-editor">
            <div className="gm-movement-layout presupuesto-modelos-editor__layout">
              <section className="gm-table gm-table--movement gm-movement-main presupuesto-modelos-table">
                <div className="gm-table-head">
                  <div className="gm-table-th">Elemento / material</div>
                  <div className="gm-table-th">Cantidad / medida</div>
                  <div className="gm-table-th right">Precio</div>
                  <div className="gm-table-th">IVA</div>
                  <div className="gm-table-th right">Total</div>
                  <div className="gm-table-th" />
                </div>
                <div className="gm-table-body presupuesto-modelos-table__body">
                  {form.rows.map((row) => {
                    const subtotal = safeNumber(row.cantidad) * safeNumber(row.precio);
                    const totalRow = subtotal + subtotal * safeNumber(row.iva_pct) / 100;
                    return (
                      <div className="gm-table-row" key={row.localId}>
                        <div className="gm-table-cell gm-table-cell--detail">
                          <ProductStockAutocomplete
                            value={row.descripcion}
                            onChange={(value) => updateRow(row.localId, { descripcion: upperInput(value), id_detalle: null, id_stock_producto: null, id_stock_variante: null, codigo: "" })}
                            onSelect={(option) => selectStock(row.localId, option)}
                            options={stockOptions}
                            allowOutOfStock={form.es_personalizado}
                            showAllOnFocus={true}
                            placeholder="Buscar en stock o escribir manualmente…"
                            emptyMessage="Sin coincidencias. Podés dejar el texto escrito."
                            disabled={saving}
                            inputClassName="gm-cell-input"
                          />
                        </div>
                        <div className="gm-table-cell gm-table-cell--center">
                          <input
                            className="gm-cell-input gm-cell-input--center"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.cantidad}
                            onChange={(e) => updateRow(row.localId, { cantidad: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                        <div className="gm-table-cell gm-table-cell--center">
                          <input
                            className="gm-cell-input gm-cell-input--right"
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.precio}
                            onChange={(e) => updateRow(row.localId, { precio: e.target.value })}
                            disabled={saving}
                          />
                        </div>
                        <div className="gm-table-cell gm-table-cell--center">
                          <select
                            className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                            value={row.iva_pct}
                            onChange={(e) => updateRow(row.localId, { iva_pct: Number(e.target.value) })}
                            disabled={saving}
                          >
                            {IVA_OPTIONS.map((iva) => <option key={iva} value={iva}>{iva} %</option>)}
                          </select>
                        </div>
                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                          {moneyARS(totalRow)}
                        </div>
                        <div className="gm-table-cell gm-table-cell--center">
                          <button
                            type="button"
                            className="gm-row-delete"
                            onClick={() => setForm((p) => ({ ...p, rows: p.rows.length <= 1 ? p.rows : p.rows.filter((x) => x.localId !== row.localId) }))}
                            disabled={saving || form.rows.length <= 1}
                            title="Eliminar elemento"
                            aria-label="Eliminar elemento"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="presupuesto-modelos-conditions" aria-label="Condiciones comerciales del modelo">
                  <div className="presupuesto-modelos-conditions__title">
                    <span className="gm-section-dot" />
                    Condiciones comerciales
                  </div>
                  <div className="presupuesto-modelos-conditions__grid">
                    <div className="gm-field presupuesto-modelos-field--small">
                      <input
                        className="gm-input"
                        type="number"
                        min="0"
                        max="3650"
                        step="1"
                        placeholder=" "
                        value={form.validez_dias}
                        onChange={(e) => setForm((p) => ({ ...p, validez_dias: e.target.value }))}
                        disabled={saving}
                      />
                      <label className="gm-label">Validez (días)</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.plazo_entrega} onChange={(e) => setForm((p) => ({ ...p, plazo_entrega: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Plazo de entrega / ejecución</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.forma_pago} onChange={(e) => setForm((p) => ({ ...p, forma_pago: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Forma de pago</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.condiciones_comerciales} onChange={(e) => setForm((p) => ({ ...p, condiciones_comerciales: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Condiciones comerciales</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.garantia} onChange={(e) => setForm((p) => ({ ...p, garantia: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Garantía</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.lugar_entrega} onChange={(e) => setForm((p) => ({ ...p, lugar_entrega: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Lugar de entrega / instalación</label>
                    </div>
                    <div className="gm-field presupuesto-modelos-field--textarea presupuesto-modelos-field--wide">
                      <textarea className="gm-input" rows={2} placeholder=" " value={form.notas} onChange={(e) => setForm((p) => ({ ...p, notas: upperInput(e.target.value) }))} disabled={saving} />
                      <label className="gm-label">Notas</label>
                    </div>
                  </div>
                </div>

                <div className="gm-table-foot">
                  <div className="gm-foot-actions">
                    <button
                      type="button"
                      className="gm-foot-btn"
                      onClick={() => setForm((p) => ({ ...p, rows: [...p.rows, emptyRow()] }))}
                      disabled={saving}
                    >
                      <span className="gm-foot-btn__icon" aria-hidden="true">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M5 1.5V8.5M1.5 5H8.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      Agregar elemento
                    </button>
                  </div>
                  <div className="gm-summary-chips">
                    <div className="gm-summary-chip gm-summary-chip--total">
                      <span>Total base</span>
                      <b>{moneyARS(total)}</b>
                    </div>
                  </div>
                </div>
              </section>

              <div className="gm-movement-side presupuesto-modelos-side">
                <aside className="gm-aside">
                  <div className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Datos del modelo</span>
                    </div>
                    <div className="gm-section-body">
                      <div className="gm-field">
                        <input
                          className="gm-input"
                          value={form.nombre}
                          onChange={(e) => setForm((p) => ({ ...p, nombre: upperInput(e.target.value) }))}
                          placeholder=" "
                          maxLength={150}
                          disabled={saving}
                        />
                        <label className="gm-label">Nombre del modelo *</label>
                      </div>
                      <div className="gm-field">
                        <textarea
                          className="gm-input presupuesto-modelos-description"
                          value={form.descripcion}
                          onChange={(e) => setForm((p) => ({ ...p, descripcion: upperInput(e.target.value) }))}
                          placeholder=" "
                          maxLength={500}
                          rows={3}
                          disabled={saving}
                        />
                        <label className="gm-label">Descripción</label>
                      </div>
                      <label className={`gm-inline-check presupuesto-check-card presupuesto-modelos-check ${form.es_personalizado ? "is-active" : ""}`}>
                        <input
                          type="checkbox"
                          checked={form.es_personalizado}
                          onChange={(e) => setForm((p) => ({ ...p, es_personalizado: e.target.checked }))}
                          disabled={saving}
                        />
                        <span className="gm-inline-check__box" aria-hidden="true" />
                        <span className="presupuesto-check-card__copy">
                          <b>Trabajo personalizado</b>
                          <small>Permite materiales escritos a mano y productos sin stock disponible.</small>
                        </span>
                      </label>
                      <div className="gm-info-box presupuesto-modelos-info">
                        El modelo quedará disponible para reutilizar su estructura en nuevos presupuestos.
                      </div>
                    </div>
                  </div>
                </aside>

                <div className="gm-actions gm-actions--sticky presupuesto-modelos-actions">
                  <button type="button" className="gm-action-btn gm-action-btn--save" onClick={guardar} disabled={saving}>
                    {saving ? "Guardando…" : "Guardar modelo"}
                  </button>
                  <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={() => setEditorOpen(false)} disabled={saving}>
                    Volver
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ModalEliminar
        open={Boolean(modeloEliminar)}
        row={modeloEliminar}
        loading={deletingId === Number(modeloEliminar?.id_modelo || 0)}
        onClose={() => setModeloEliminar(null)}
        onConfirm={eliminar}
        onToast={onToast}
        title="Eliminar modelo de presupuesto"
        message="¿Seguro que querés eliminar este modelo de presupuesto?"
        warning="Esta acción no se puede deshacer."
        loadingMessage="Eliminando modelo de presupuesto…"
        successMessage="Modelo eliminado correctamente."
        errorMessage="No se pudo eliminar el modelo."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        confirmVariant="danger"
        details={[
          { label: "ID Modelo", value: `#${modeloEliminar?.id_modelo ?? "—"}` },
          { label: "Nombre", value: upperStr(modeloEliminar?.nombre) || "—" },
          {
            label: "Elementos",
            value: String(
              Number(
                modeloEliminar?.cantidad_items ??
                  (Array.isArray(modeloEliminar?.items) ? modeloEliminar.items.length : 0)
              )
            ),
          },
          { label: "Total base", value: moneyARS(modeloEliminar?.total_modelo || 0) },
        ]}
      />
    </div>,
    document.body
  );
}
