import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaCheck, FaPlus, FaTrash } from "react-icons/fa";
import "./ModalFacturaBalto.css";

const CBTE_TIPOS = [{ id: 11, label: "Factura C (11)" }];

function safeStr(v) {
  return String(v ?? "").trim();
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function plusDaysISO(days = 10) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function buildItem() {
  return {
    id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    descripcion: "",
    cantidad: "1",
    precio_unitario: "",
    bonif_pct: "0",
    subtotal: 0,
  };
}

function calcSubtotal(item) {
  const cantidad = toNumber(item?.cantidad);
  const precio = toNumber(item?.precio_unitario);
  const bonif = toNumber(item?.bonif_pct);
  const bruto = cantidad * precio;
  const descuento = bruto * (bonif / 100);
  const subtotal = bruto - descuento;
  return Number.isFinite(subtotal) ? subtotal : 0;
}

export default function ModalFacturaDatos({
  open,
  onClose,
  onBack,
  data,
  clienteFact,
  docTipo,
  docNro,
  initialData,
  nombreCliente,
  nombreSistema,
  onNext,
}) {
  const [error, setError] = useState("");
  const [fechaCbte, setFechaCbte] = useState(todayISO());
  const [vtoPago, setVtoPago] = useState(plusDaysISO(10));
  const [cbteTipo, setCbteTipo] = useState(11);
  const [ptoVta, setPtoVta] = useState(2);
  const [items, setItems] = useState([buildItem()]);
  const [observaciones, setObservaciones] = useState("");

  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    setError("");
    setFechaCbte(initialData?.fecha_cbte_iso || todayISO());
    setVtoPago(initialData?.vto_pago_iso || plusDaysISO(10));
    setCbteTipo(Number(initialData?.cbte_tipo || 11));
    setPtoVta(Number(initialData?.pto_vta || 2));
    setObservaciones(initialData?.observaciones || "");

    const incoming = Array.isArray(initialData?.items_facturacion)
      ? initialData.items_facturacion
      : [];

    if (incoming.length) {
      setItems(
        incoming.map((it) => ({
          id: it?.id || `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          descripcion: safeStr(it?.descripcion),
          cantidad: String(it?.cantidad ?? "1"),
          precio_unitario: String(it?.precio_unitario ?? it?.precio ?? ""),
          bonif_pct: String(it?.bonif_pct ?? "0"),
          subtotal: Number(it?.subtotal || 0),
        }))
      );
    } else {
      setItems([buildItem()]);
    }

    setTimeout(() => firstRef.current?.focus?.(), 0);
  }, [open, initialData]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const itemsConSubtotal = useMemo(() => {
    return (items || []).map((it) => ({
      ...it,
      subtotal: calcSubtotal(it),
    }));
  }, [items]);

  const total = useMemo(() => {
    return itemsConSubtotal.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);
  }, [itemsConSubtotal]);

  const updateItem = useCallback((id, field, value) => {
    setItems((prev) =>
      (prev || []).map((it) =>
        it.id === id
          ? {
              ...it,
              [field]:
                field === "cantidad" || field === "precio_unitario" || field === "bonif_pct"
                  ? String(value).replace(/[^\d.,-]/g, "")
                  : value,
            }
          : it
      )
    );
    setError("");
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...(prev || []), buildItem()]);
    setError("");
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => {
      const next = (prev || []).filter((it) => it.id !== id);
      return next.length ? next : [buildItem()];
    });
    setError("");
  }, []);

  const validar = useCallback(() => {
    if (!clienteFact?.razon_social) {
      return { ok: false, msg: "Primero tenés que seleccionar un cliente." };
    }

    if (!fechaCbte) {
      return { ok: false, msg: "Completá la fecha del comprobante." };
    }

    if (!vtoPago) {
      return { ok: false, msg: "Completá la fecha de vencimiento." };
    }

    if (vtoPago < fechaCbte) {
      return { ok: false, msg: "La fecha de vencimiento no puede ser menor que la fecha del comprobante." };
    }

    if (!Number(ptoVta) || Number(ptoVta) <= 0) {
      return { ok: false, msg: "El punto de venta es inválido." };
    }

    const cleanItems = itemsConSubtotal.filter(
      (it) =>
        safeStr(it.descripcion) ||
        toNumber(it.cantidad) > 0 ||
        toNumber(it.precio_unitario) > 0
    );

    if (!cleanItems.length) {
      return { ok: false, msg: "Tenés que cargar al menos un ítem en el detalle." };
    }

    for (const it of cleanItems) {
      if (!safeStr(it.descripcion)) {
        return { ok: false, msg: "Todos los ítems deben tener descripción." };
      }
      if (toNumber(it.cantidad) <= 0) {
        return { ok: false, msg: "La cantidad debe ser mayor que 0." };
      }
      if (toNumber(it.precio_unitario) <= 0) {
        return { ok: false, msg: "El precio unitario debe ser mayor que 0." };
      }
      if (toNumber(it.bonif_pct) < 0) {
        return { ok: false, msg: "La bonificación no puede ser negativa." };
      }
    }

    if (total <= 0) {
      return { ok: false, msg: "El monto total debe ser mayor que 0." };
    }

    return {
      ok: true,
      items_facturacion: cleanItems.map((it, idx) => ({
        id: it.id,
        codigo: String(idx + 1),
        descripcion: safeStr(it.descripcion),
        cantidad: toNumber(it.cantidad),
        unidad: "u",
        precio_unitario: toNumber(it.precio_unitario),
        precio: toNumber(it.precio_unitario),
        bonif_pct: toNumber(it.bonif_pct),
        impBonif:
          toNumber(it.cantidad) *
          toNumber(it.precio_unitario) *
          (toNumber(it.bonif_pct) / 100),
        subtotal: Number(it.subtotal || 0),
        ars: Number(it.subtotal || 0),
      })),
    };
  }, [clienteFact, fechaCbte, vtoPago, ptoVta, itemsConSubtotal, total]);

  const siguiente = useCallback(() => {
    setError("");
    const v = validar();
    if (!v.ok) {
      setError(v.msg);
      return;
    }

    onNext?.({
      fecha_cbte_iso: fechaCbte,
      vto_pago_iso: vtoPago,
      cbte_tipo: Number(cbteTipo),
      pto_vta: Number(ptoVta),
      items_facturacion: v.items_facturacion,
      total_ars: total,
      observaciones: safeStr(observaciones),
    });
  }, [validar, onNext, fechaCbte, vtoPago, cbteTipo, ptoVta, total, observaciones]);

  if (!open) return null;

  return (
    <div
      className="mi-modal__overlay"
      onClick={(e) => e.target.classList.contains("mi-modal__overlay") && onClose?.()}
    >
      <div
        className="mi-modal__container"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1180 }}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">Facturar</h2>
            <p className="mi-modal__subtitle">
              Paso 2 de 3 — Cargá fechas y detalle del comprobante.
            </p>
          </div>

          <button
            className="mi-modal__close"
            onClick={onClose}
            aria-label="Cerrar"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mit-modal__body">
          {error && (
            <div className="arca-alert arca-alert--error" role="alert">
              {error}
            </div>
          )}

          <div className="mi-grid">
            <article className="mi-card">
              <h3 className="mi-card__title">Cliente seleccionado</h3>

              <div className="arca-resumen arca-resumen--2col">
                <div className="arca-row">
                  <b>Cliente:</b>
                  <span>{nombreCliente || "—"}</span>
                </div>

                <div className="arca-row">
                  <b>Sistema:</b>
                  <span>{nombreSistema || "—"}</span>
                </div>

                <div className="arca-row">
                  <b>Tipo doc:</b>
                  <span>{Number(docTipo) === 80 ? "CUIT" : "DNI"}</span>
                </div>

                <div className="arca-row">
                  <b>Nro doc:</b>
                  <span>{onlyDigits(docNro) || "—"}</span>
                </div>

                <div className="arca-row arca-row--full">
                  <b>Razón social:</b>
                  <span>{clienteFact?.razon_social || "—"}</span>
                </div>

                <div className="arca-row">
                  <b>IVA:</b>
                  <span>{clienteFact?.cond_iva || "—"}</span>
                </div>

                <div className="arca-row">
                  <b>Domicilio:</b>
                  <span>{clienteFact?.domicilio || "—"}</span>
                </div>
              </div>
            </article>

            <article className="mi-card">
              <h3 className="mi-card__title">Datos del comprobante</h3>

              <div className="fl-grid">
                <div className="fl-field">
                  <input
                    ref={firstRef}
                    className="fl-input"
                    type="date"
                    value={fechaCbte}
                    onChange={(e) => {
                      setFechaCbte(e.target.value);
                      setError("");
                    }}
                  />
                  <label className="fl-label">Fecha comprobante *</label>
                </div>

                <div className="fl-field">
                  <input
                    className="fl-input"
                    type="date"
                    value={vtoPago}
                    onChange={(e) => {
                      setVtoPago(e.target.value);
                      setError("");
                    }}
                  />
                  <label className="fl-label">Fecha vencimiento *</label>
                </div>

                <div className="fl-field">
                  <select
                    className="fl-input fl-select"
                    value={cbteTipo}
                    onChange={(e) => {
                      setCbteTipo(Number(e.target.value));
                      setError("");
                    }}
                  >
                    {CBTE_TIPOS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <label className="fl-label">Tipo comprobante</label>
                </div>

                <div className="fl-field">
                  <input
                    className="fl-input"
                    value={ptoVta}
                    onChange={(e) => {
                      setPtoVta(onlyDigits(e.target.value));
                      setError("");
                    }}
                    inputMode="numeric"
                  />
                  <label className="fl-label">Punto de venta *</label>
                </div>

                <div className="fl-field fl-col-full">
                  <input
                    className="fl-input"
                    placeholder=" "
                    value={observaciones}
                    onChange={(e) => {
                      setObservaciones(e.target.value);
                      setError("");
                    }}
                  />
                  <label className="fl-label">Observaciones (opcional)</label>
                </div>
              </div>
            </article>

            <article className="mi-card mi-card--full">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <h3 className="mi-card__title" style={{ marginBottom: 0 }}>Detalle de la factura</h3>

                <button
                  type="button"
                  className="mit-btn mit-btn--solid"
                  onClick={addItem}
                >
                  Agregar ítem <FaPlus style={{ marginLeft: 8 }} />
                </button>
              </div>

              <div style={{ marginTop: 14, overflowX: "auto" }}>
                <table className="tabla-factura-detalle" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Descripción</th>
                      <th style={thStyle}>Cantidad</th>
                      <th style={thStyle}>Precio Unit.</th>
                      <th style={thStyle}>Bonif. %</th>
                      <th style={thStyle}>Subtotal</th>
                      <th style={thStyle}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsConSubtotal.map((it) => (
                      <tr key={it.id}>
                        <td style={tdStyle}>
                          <input
                            className="fl-input"
                            value={it.descripcion}
                            onChange={(e) => updateItem(it.id, "descripcion", e.target.value)}
                            placeholder="Detalle del servicio o producto"
                          />
                        </td>

                        <td style={tdStyle}>
                          <input
                            className="fl-input"
                            value={it.cantidad}
                            onChange={(e) => updateItem(it.id, "cantidad", e.target.value)}
                            inputMode="decimal"
                          />
                        </td>

                        <td style={tdStyle}>
                          <input
                            className="fl-input"
                            value={it.precio_unitario}
                            onChange={(e) => updateItem(it.id, "precio_unitario", e.target.value)}
                            inputMode="decimal"
                          />
                        </td>

                        <td style={tdStyle}>
                          <input
                            className="fl-input"
                            value={it.bonif_pct}
                            onChange={(e) => updateItem(it.id, "bonif_pct", e.target.value)}
                            inputMode="decimal"
                          />
                        </td>

                        <td style={tdStyle}>
                          <input
                            className="fl-input"
                            value={moneyARS(it.subtotal)}
                            disabled
                            readOnly
                          />
                        </td>

                        <td style={tdStyle}>
                          <button
                            type="button"
                            className="mit-btn mit-btn--ghost"
                            onClick={() => removeItem(it.id)}
                            title="Eliminar ítem"
                          >
                            <FaTrash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className="arca-alert arca-alert--info"
                style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <div>
                  <strong>Total calculado</strong>
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {moneyARS(total)}
                </div>
              </div>
            </article>
          </div>

          <div className="mit-actions">
            <button
              type="button"
              className="mit-btn mit-btn--ghost"
              onClick={onBack}
            >
              <FaArrowLeft style={{ marginRight: 8 }} />
              Volver
            </button>

            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={siguiente}
            >
              Siguiente <FaCheck style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid rgba(255,255,255,.12)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px",
  verticalAlign: "top",
  borderBottom: "1px solid rgba(255,255,255,.08)",
};