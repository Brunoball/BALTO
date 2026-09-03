import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import BuscadorSelector from "../components/BuscadorSelector";
import {
  cleanCode,
  clampText,
  decimalText,
  integerText,
  money,
} from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

const initialForm = {
  codigo: "",
  nombre: "",
  id_servicio_categoria: "",
  descripcion: "",
  costo_base: "0",
  precio_venta: "0",
  iva_pct: "0",
  duracion_estimada_minutos: "",
};

const idInsumo = (row) => Number(row?.id_insumo ?? row?.id_articulo ?? row?.id ?? 0);
const idStock = (row) => Number(row?.id_stock ?? row?.id ?? 0);

const IVA_OPTIONS = [
  { value: "0", label: "0 %" },
  { value: "10.5", label: "10,5 %" },
  { value: "21", label: "21 %" },
  { value: "27", label: "27 %" },
];

const isStandardIva = (value) => IVA_OPTIONS.some((option) => Number(option.value) === Number(value));

export default function ModalServicio({
  open,
  item,
  categorias = [],
  insumos = [],
  stock = [],
  saving,
  onClose,
  onSave,
  onToast,
  onOpenAgregarCategoria,
}) {
  const [form, setForm] = useState(initialForm);
  const [insumoRows, setInsumoRows] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [insumoToAdd, setInsumoToAdd] = useState("");
  const [stockToAdd, setStockToAdd] = useState("");

  useEffect(() => {
    if (!open) return;

    if (item) {
      setForm({
        codigo: item.codigo || "",
        nombre: item.nombre || "",
        id_servicio_categoria: item.id_servicio_categoria ? String(item.id_servicio_categoria) : "",
        descripcion: item.descripcion || "",
        costo_base: String(item.costo_base ?? "0"),
        precio_venta: String(item.precio_venta ?? "0"),
        iva_pct: String(item.iva_pct ?? "0"),
        duracion_estimada_minutos: item.duracion_estimada_minutos
          ? String(item.duracion_estimada_minutos)
          : "",
      });

      const rawInsumos = item.insumos || item.receta || item.composicion?.insumos || [];
      setInsumoRows(
        rawInsumos.map((row) => ({
          id_insumo: idInsumo(row),
          cantidad_requerida: String(row.cantidad_requerida ?? row.cantidad ?? "1"),
          merma_pct: String(row.merma_pct ?? "0"),
          observaciones: row.observaciones || "",
          nombre: row.insumo_nombre || row.nombre || "",
          unidad_simbolo: row.unidad_simbolo || "",
          costo_unitario: Number(row.costo_unitario || 0),
        }))
      );

      const rawStock = item.productos_stock || item.composicion?.stock || [];
      setStockRows(
        rawStock.map((row) => ({
          id_stock: idStock(row),
          cantidad_requerida: String(row.cantidad_requerida ?? row.cantidad ?? "1"),
          observaciones: row.observaciones || "",
          nombre: row.stock_nombre || row.nombre || "",
          unidad_simbolo: row.unidad_simbolo || "",
          stock_actual: Number(row.stock_actual || 0),
          costo_unitario: Number(row.costo_unitario || 0),
        }))
      );
    } else {
      setForm(initialForm);
      setInsumoRows([]);
      setStockRows([]);
    }

    setInsumoToAdd("");
    setStockToAdd("");
  }, [open, item]);

  const activeInsumos = useMemo(
    () => insumos.filter((row) => Number(row.activo) === 1),
    [insumos]
  );

  const activeStock = useMemo(
    () => stock.filter((row) => Number(row.activo) === 1),
    [stock]
  );

  const usedInsumos = useMemo(
    () => new Set(insumoRows.map((row) => Number(row.id_insumo))),
    [insumoRows]
  );

  const usedStock = useMemo(
    () => new Set(stockRows.map((row) => Number(row.id_stock))),
    [stockRows]
  );

  const costoInsumos = useMemo(
    () =>
      insumoRows.reduce((total, row) => {
        const catalog = insumos.find((i) => Number(i.id_insumo) === Number(row.id_insumo));
        const costo = Number(catalog?.costo_unitario ?? row.costo_unitario ?? 0);
        const cantidad = Number(row.cantidad_requerida || 0);
        const merma = Number(row.merma_pct || 0);
        return total + costo * cantidad * (1 + merma / 100);
      }, 0),
    [insumoRows, insumos]
  );

  const costoStock = useMemo(
    () =>
      stockRows.reduce((total, row) => {
        const catalog = stock.find((s) => Number(s.id_stock) === Number(row.id_stock));
        return total + Number(catalog?.costo_unitario ?? row.costo_unitario ?? 0) * Number(row.cantidad_requerida || 0);
      }, 0),
    [stockRows, stock]
  );

  const costoEstimado = Number(form.costo_base || 0) + costoInsumos + costoStock;

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({
    open,
    busy: saving,
    onClose,
  });

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const addInsumo = () => {
    const id = Number(insumoToAdd || 0);
    if (!id || usedInsumos.has(id)) return;
    const selected = insumos.find((row) => Number(row.id_insumo) === id);
    if (!selected) return;

    setInsumoRows((prev) => [
      ...prev,
      {
        id_insumo: id,
        cantidad_requerida: "1",
        merma_pct: "0",
        observaciones: "",
        nombre: selected.nombre || "",
        unidad_simbolo: selected.unidad_simbolo || selected.unidad_nombre || "",
        costo_unitario: Number(selected.costo_unitario || 0),
      },
    ]);
    setInsumoToAdd("");
  };

  const addStock = () => {
    const id = Number(stockToAdd || 0);
    if (!id || usedStock.has(id)) return;
    const selected = stock.find((row) => Number(row.id_stock) === id);
    if (!selected) return;

    const disponible = Math.max(0, Number(selected.stock_actual || 0));
    if (disponible < 1) {
      onToast?.("error", `${selected.nombre || "Este producto"} no tiene Stock disponible.`, 4200);
      return;
    }

    setStockRows((prev) => [
      ...prev,
      {
        id_stock: id,
        cantidad_requerida: "1",
        observaciones: "",
        nombre: selected.nombre || "",
        unidad_simbolo: selected.unidad_simbolo || selected.unidad_nombre || "",
        stock_actual: disponible,
        costo_unitario: Number(selected.costo_unitario || 0),
      },
    ]);
    setStockToAdd("");
  };

  const updateInsumo = (id, key, value) => {
    setInsumoRows((prev) =>
      prev.map((row) => (Number(row.id_insumo) === Number(id) ? { ...row, [key]: value } : row))
    );
  };

  const updateStock = (id, key, value) => {
    setStockRows((prev) =>
      prev.map((row) => (Number(row.id_stock) === Number(id) ? { ...row, [key]: value } : row))
    );
  };

  const updateStockCantidad = (row, rawValue) => {
    const limpio = integerText(rawValue, 10);
    if (limpio === "") {
      updateStock(row.id_stock, "cantidad_requerida", "");
      return;
    }

    const catalog = stock.find((s) => Number(s.id_stock) === Number(row.id_stock));
    const disponible = Math.max(0, Number(catalog?.stock_actual ?? row.stock_actual ?? 0));
    const solicitado = Number(limpio);

    if (solicitado > disponible) {
      updateStock(row.id_stock, "cantidad_requerida", String(disponible));
      onToast?.(
        "error",
        `${catalog?.nombre || row.nombre || "El producto"} tiene ${disponible} ${catalog?.unidad_simbolo || catalog?.unidad_nombre || row.unidad_simbolo || "unidades"} disponibles. No podés usar más de esa cantidad.`,
        4800
      );
      return;
    }

    updateStock(row.id_stock, "cantidad_requerida", limpio);
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!String(form.nombre || "").trim()) {
      onToast?.("error", "Completá el nombre del servicio.", 4200);
      return;
    }
    if (form.precio_venta === "" || Number(form.precio_venta) < 0) {
      onToast?.("error", "Indicá un precio de venta válido.", 4200);
      return;
    }

    for (const row of insumoRows) {
      const catalog = insumos.find((i) => Number(i.id_insumo) === Number(row.id_insumo));
      if (Number(row.cantidad_requerida || 0) <= 0) {
        onToast?.("error", `Indicá una cantidad válida para ${catalog?.nombre || row.nombre || "el insumo"}.`, 4200);
        return;
      }
    }

    const normalizedInsumos = insumoRows.map((row) => ({
      id_insumo: Number(row.id_insumo),
      cantidad_requerida: row.cantidad_requerida,
      merma_pct: row.merma_pct || "0",
      obligatorio: 1,
      observaciones: row.observaciones || null,
    }));

    for (const row of stockRows) {
      const catalog = stock.find((s) => Number(s.id_stock) === Number(row.id_stock));
      const disponible = Math.max(0, Number(catalog?.stock_actual ?? row.stock_actual ?? 0));
      const solicitado = Number(row.cantidad_requerida || 0);
      if (solicitado < 1) {
        onToast?.("error", `Indicá una cantidad válida para ${catalog?.nombre || row.nombre || "el producto"}.`, 4200);
        return;
      }
      if (solicitado > disponible) {
        onToast?.(
          "error",
          `${catalog?.nombre || row.nombre || "El producto"} tiene ${disponible} ${catalog?.unidad_simbolo || catalog?.unidad_nombre || row.unidad_simbolo || "unidades"} disponibles. No podés usar ${solicitado}.`,
          4800
        );
        return;
      }
    }

    const normalizedStock = stockRows.map((row) => ({
      id_stock: Number(row.id_stock),
      cantidad_requerida: row.cantidad_requerida,
      observaciones: row.observaciones || null,
    }));

    await onSave({
      ...form,
      id_servicio: item?.id_servicio,
      id_servicio_categoria: form.id_servicio_categoria || null,
      duracion_estimada_minutos: form.duracion_estimada_minutos || null,
      composicion: {
        insumos: normalizedInsumos,
        stock: normalizedStock,
      },
    });
  };

  const handleCategoria = (event) => {
    const value = event.target.value;
    if (value === "__ADD__") {
      onOpenAgregarCategoria?.((categoryId) => {
        set("id_servicio_categoria", String(categoryId || ""));
      });
      return;
    }
    set("id_servicio_categoria", value);
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="gm-modal-overlay"
      data-servicios-modal-overlay="true"
      onMouseDown={cerrarDesdeFondo}
    >
      <form
        className="gm-modal-container gm-modal-v2 servicios-modal servicios-modal--service"
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="servicios-service-modal-title"
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="servicios-service-modal-title">{item ? "Editar servicio" : "Agregar servicio"}</h2>
            <p className="gm-modal-subtitle">Definí la información comercial y los componentes necesarios para realizarlo.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content servicios-modal__content--service">
          <section className="gm-section servicios-form-section">
            <div className="gm-section-head">
              <span className="gm-section-dot" />
              <span>Datos generales</span>
            </div>
            <div className="gm-section-body">
              <div className="servicios-form-grid">
                <label className="gm-field servicios-field--span-3">
                  <input
                    className="gm-input"
                    maxLength={60}
                    value={form.codigo}
                    onChange={(e) => set("codigo", cleanCode(e.target.value))}
                    placeholder=" "
                    aria-label="Código"
                  />
                  <span className="gm-label">Código</span>
                </label>

                <label className="gm-field servicios-field--span-9">
                  <input
                    className="gm-input"
                    required
                    autoFocus
                    maxLength={150}
                    value={form.nombre}
                    onChange={(e) => set("nombre", clampText(e.target.value, 150))}
                    placeholder=" "
                    aria-label="Nombre"
                  />
                  <span className="gm-label">Nombre</span>
                </label>

                <label className="gm-field servicios-field--span-6">
                  <select className="gm-input gm-select" value={form.id_servicio_categoria} onChange={handleCategoria} aria-label="Categoría">
                    <option value="__ADD__">+ AGREGAR CATEGORÍA</option>
                    <option value="">SIN CATEGORÍA</option>
                    {categorias
                      .filter((c) => Number(c.activo) === 1)
                      .map((c) => (
                        <option key={c.id_servicio_categoria} value={c.id_servicio_categoria}>
                          {c.nombre}
                        </option>
                      ))}
                  </select>
                  <span className="gm-label gm-label--up">Categoría</span>
                </label>

                <label className="gm-field servicios-field--span-6">
                  <input
                    className="gm-input"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.duracion_estimada_minutos}
                    onChange={(e) => set("duracion_estimada_minutos", integerText(e.target.value, 6))}
                    placeholder=" "
                    aria-label="Duración estimada en minutos"
                  />
                  <span className="gm-label">Duración estimada (min)</span>
                </label>

                <label className="gm-field servicios-field--wide">
                  <textarea
                    className="gm-input servicios-textarea"
                    rows={3}
                    maxLength={1000}
                    value={form.descripcion}
                    onChange={(e) => set("descripcion", clampText(e.target.value, 1000))}
                    placeholder=" "
                    aria-label="Descripción"
                  />
                  <span className="gm-label">Descripción</span>
                  <small className="servicios-field__counter">{form.descripcion.length}/1000</small>
                </label>
              </div>
            </div>
          </section>

          <section className="gm-section servicios-form-section">
            <div className="gm-section-head">
              <span className="gm-section-dot" />
              <span>Valores comerciales</span>
            </div>
            <div className="gm-section-body">
              <div className="servicios-form-grid servicios-form-grid--commercial">
                <label className="gm-field servicios-field--span-4">
                  <input
                    className="gm-input"
                    inputMode="decimal"
                    value={form.costo_base}
                    onChange={(e) => set("costo_base", decimalText(e.target.value, 2))}
                    placeholder=" "
                    aria-label="Costo base"
                  />
                  <span className="gm-label">Costo base</span>
                </label>

                <label className="gm-field servicios-field--span-4">
                  <input
                    className="gm-input"
                    required
                    inputMode="decimal"
                    value={form.precio_venta}
                    onChange={(e) => set("precio_venta", decimalText(e.target.value, 2))}
                    placeholder=" "
                    aria-label="Precio de venta"
                  />
                  <span className="gm-label">Precio de venta</span>
                </label>

                <label className="gm-field servicios-field--span-4">
                  <select className="gm-input gm-select" value={form.iva_pct} onChange={(e) => set("iva_pct", e.target.value)} aria-label="IVA">
                    {!isStandardIva(form.iva_pct) && form.iva_pct !== "" && (
                      <option value={form.iva_pct}>{String(form.iva_pct).replace(".", ",")} % (ACTUAL)</option>
                    )}
                    {IVA_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="gm-label gm-label--up">IVA %</span>
                </label>
              </div>
            </div>
          </section>

          <section className="gm-section servicios-composition">
            <div className="gm-section-head servicios-composition__head">
              <div className="servicios-composition__heading">
                <span className="gm-section-dot" />
                <span>Composición del servicio</span>
              </div>
              <div className="servicios-composition__cost">
                <span>Costo estimado</span>
                <strong>{money(costoEstimado)}</strong>
              </div>
            </div>
            <div className="gm-section-body servicios-composition__body">
              <div className="servicios-composition-grid">
                <article className="gm-section servicios-component-card">
                  <div className="gm-section-head servicios-component-card__title">
                    <div>
                      <h4>Insumos</h4>
                      <p>Materiales o costos necesarios para realizar el servicio.</p>
                    </div>
                    <strong><span>{insumoRows.length}</span><small>asignados</small></strong>
                  </div>

                  <div className="gm-section-body servicios-component-card__body">
                    <div className="servicios-component-add">
                      <BuscadorSelector
                        options={activeInsumos.filter((row) => !usedInsumos.has(Number(row.id_insumo)))}
                        value={insumoToAdd}
                        onChange={setInsumoToAdd}
                        getValue={(row) => row.id_insumo}
                        getLabel={(row) => `${row.nombre} · ${row.unidad_simbolo || row.unidad_nombre || "UNIDAD"}`}
                        label="Insumo"
                        placeholder="SELECCIONAR INSUMO"
                        searchPlaceholder="BUSCAR INSUMO..."
                        emptyText="NO HAY INSUMOS DISPONIBLES"
                      />
                      <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={addInsumo} disabled={!insumoToAdd}>
                        Agregar
                      </button>
                    </div>

                    <div className="servicios-component-list">
                      {insumoRows.length === 0 ? (
                        <p className="servicios-component-empty">ESTE SERVICIO NO TIENE INSUMOS ASIGNADOS.</p>
                      ) : (
                        insumoRows.map((row) => {
                          const catalog = insumos.find((i) => Number(i.id_insumo) === Number(row.id_insumo));
                          const nombre = catalog?.nombre || row.nombre || "INSUMO";
                          const unidad = catalog?.unidad_simbolo || catalog?.unidad_nombre || row.unidad_simbolo || "";
                          return (
                            <div className="servicios-component-row" key={row.id_insumo}>
                              <div className="servicios-component-row__name">
                                <strong>{nombre}</strong>
                                <small>{money(catalog?.costo_unitario ?? row.costo_unitario ?? 0)} por {unidad || "unidad"}</small>
                              </div>
                              <label className="gm-field servicios-component-quantity">
                                <input
                                  className="gm-input servicios-component-quantity__input"
                                  required
                                  inputMode="decimal"
                                  value={row.cantidad_requerida}
                                  onChange={(e) => updateInsumo(row.id_insumo, "cantidad_requerida", decimalText(e.target.value, 6))}
                                  placeholder=" "
                                  aria-label={`Cantidad de ${nombre}`}
                                />
                                <span className="gm-label gm-label--up">Cantidad</span>
                              </label>
                              <span className="servicios-component-unit">{unidad}</span>
                              <button
                                type="button"
                                className="gm-action-btn gm-action-btn--danger servicios-component-remove"
                                onClick={() => setInsumoRows((prev) => prev.filter((r) => Number(r.id_insumo) !== Number(row.id_insumo)))}
                                aria-label={`Quitar ${nombre}`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </article>

                <article className="gm-section servicios-component-card servicios-component-card--stock">
                  <div className="gm-section-head servicios-component-card__title">
                    <div>
                      <h4>Productos de Stock</h4>
                      <p>La cantidad indicada se descuenta al registrar una venta del servicio.</p>
                    </div>
                    <strong><span>{stockRows.length}</span><small>asignados</small></strong>
                  </div>

                  <div className="gm-section-body servicios-component-card__body">
                    <div className="servicios-component-add">
                      <BuscadorSelector
                        options={activeStock.filter((row) => Number(row.stock_actual || 0) > 0 && !usedStock.has(Number(row.id_stock)))}
                        value={stockToAdd}
                        onChange={setStockToAdd}
                        getValue={(row) => row.id_stock}
                        getLabel={(row) => `${row.nombre} · DISPONIBLE ${Number(row.stock_actual || 0)}`}
                        label="Producto de Stock"
                        placeholder="SELECCIONAR PRODUCTO DE STOCK"
                        searchPlaceholder="BUSCAR PRODUCTO DE STOCK..."
                        emptyText="NO HAY PRODUCTOS DE STOCK DISPONIBLES"
                      />
                      <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={addStock} disabled={!stockToAdd}>
                        Agregar
                      </button>
                    </div>

                    <div className="servicios-component-list">
                      {stockRows.length === 0 ? (
                        <p className="servicios-component-empty">ESTE SERVICIO NO DESCUENTA PRODUCTOS DE STOCK.</p>
                      ) : (
                        stockRows.map((row) => {
                          const catalog = stock.find((s) => Number(s.id_stock) === Number(row.id_stock));
                          const nombre = catalog?.nombre || row.nombre || "PRODUCTO";
                          const unidad = catalog?.unidad_simbolo || catalog?.unidad_nombre || row.unidad_simbolo || "";
                          const disponible = Number(catalog?.stock_actual ?? row.stock_actual ?? 0);
                          return (
                            <div className="servicios-component-row" key={row.id_stock}>
                              <div className="servicios-component-row__name">
                                <strong>{nombre}</strong>
                                <small>DISPONIBLE: {disponible} {unidad}</small>
                              </div>
                              <label className="gm-field servicios-component-quantity">
                                <input
                                  className="gm-input servicios-component-quantity__input"
                                  required
                                  type="number"
                                  inputMode="numeric"
                                  min="1"
                                  max={Math.max(0, disponible)}
                                  step="1"
                                  value={row.cantidad_requerida}
                                  onChange={(e) => updateStockCantidad(row, e.target.value)}
                                  placeholder=" "
                                  aria-label={`Uso por servicio de ${nombre}`}
                                />
                                <span className="gm-label gm-label--up">Uso por servicio</span>
                              </label>
                              <span className="servicios-component-unit">{unidad}</span>
                              <button
                                type="button"
                                className="gm-action-btn gm-action-btn--danger servicios-component-remove"
                                onClick={() => setStockRows((prev) => prev.filter((r) => Number(r.id_stock) !== Number(row.id_stock)))}
                                aria-label={`Quitar ${nombre}`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </article>
              </div>

              <div className="servicios-composition__totals">
                <span>Costo base: <strong>{money(form.costo_base || 0)}</strong></span>
                <span>Insumos: <strong>{money(costoInsumos)}</strong></span>
                <span>Stock: <strong>{money(costoStock)}</strong></span>
                <span>Total estimado: <strong>{money(costoEstimado)}</strong></span>
              </div>
            </div>
          </section>

          <div className="gm-info-box">
            Los Insumos y Stock siguen siendo independientes. Agregarlos acá sólo indica qué necesita este servicio. Los productos de Stock se descuentan cuando el servicio se registra en una venta.
          </div>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>
            {saving ? "Guardando..." : item ? "Guardar cambios" : "Agregar servicio"}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
