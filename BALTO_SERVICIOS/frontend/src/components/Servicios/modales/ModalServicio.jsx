import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import BuscadorSelector from "../components/BuscadorSelector";
import { clampText, decimalText, integerText, money } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBriefcase, faCircleInfo, faDollarSign, faLayerGroup } from "@fortawesome/free-solid-svg-icons";

const EMPTY = {
  nombre: "",
  id_categoria: "",
  id_unidad_cobro: "",
  descripcion: "",
  costo_base: "",
  duracion_estimada_minutos: "",
  precio_venta: "",
  iva_pct: "0",
};

function ArticulosCard({ rows, setRows, catalog }) {
  const [selected, setSelected] = useState("");
  const used = new Set(rows.map((r) => Number(r.id_articulo)));

  const add = () => {
    const found = catalog.find((r) => Number(r.id_articulo) === Number(selected));
    if (!found) return;
    setRows((prev) => [...prev, { id_articulo: found.id_articulo, cantidad: "1" }]);
    setSelected("");
  };

  return (
    <article className="gm-section servicios-component-card servicios-component-card--materials">
      <div className="gm-section-head servicios-component-card__title">
        <div>
          <h4>Materiales e insumos</h4>
          <p>Elementos utilizados para realizar el servicio. El costo se toma del valor vigente del artículo.</p>
        </div>
        <strong><span>{rows.length}</span><small>asignados</small></strong>
      </div>

      <div className="gm-section-body servicios-component-card__body">
        <div className="servicios-component-add">
          <BuscadorSelector
            options={catalog.filter((r) => Number(r.activo) === 1 && !used.has(Number(r.id_articulo)))}
            value={selected}
            onChange={setSelected}
            getValue={(r) => r.id_articulo}
            getLabel={(r) => `${r.tipo === "MATERIAL" ? "MATERIAL" : "INSUMO"} · ${r.nombre} · ${money(r.costo_unitario)} / ${r.unidad_simbolo || "UN"}`}
            label="Material / Insumo"
            placeholder="SELECCIONAR MATERIAL O INSUMO"
            searchPlaceholder="BUSCAR MATERIAL O INSUMO..."
            emptyText="NO HAY MATERIALES NI INSUMOS"
          />
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={add} disabled={!selected}>Agregar</button>
        </div>

        <div className="servicios-component-list">
          {rows.length === 0 ? (
            <p className="servicios-component-empty">SIN MATERIALES NI INSUMOS ASIGNADOS.</p>
          ) : rows.map((row) => {
            const id = Number(row.id_articulo);
            const found = catalog.find((r) => Number(r.id_articulo) === id);
            const unit = found?.unidad_simbolo || row.unidad_simbolo || "";

            return (
              <div className="servicios-component-row" key={id}>
                <div className="servicios-component-row__name">
                  <strong>{found?.nombre || row.nombre || "MATERIAL / INSUMO"}{Number(found?.activo ?? row.activo ?? 1) === 1 ? "" : " · BAJA"}</strong>
                  <small>{money(found?.costo_unitario ?? row.costo_unitario ?? 0)} por {unit || "unidad"}</small>
                </div>
                <label className="gm-field servicios-component-quantity">
                  <input
                    className="gm-input servicios-component-quantity__input"
                    inputMode="decimal"
                    value={row.cantidad}
                    onChange={(e) => setRows((prev) => prev.map((x) => Number(x.id_articulo) === id ? { ...x, cantidad: decimalText(e.target.value, 6) } : x))}
                    placeholder=" "
                  />
                  <span className="gm-label gm-label--up">Cantidad</span>
                </label>
                <span className="servicios-component-unit">{unit}</span>
                <button type="button" className="gm-action-btn gm-action-btn--danger servicios-component-remove" onClick={() => setRows((prev) => prev.filter((x) => Number(x.id_articulo) !== id))}>×</button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function TrabajadoresCard({ rows, setRows, catalog }) {
  const [selected, setSelected] = useState("");
  const used = new Set(rows.map((r) => Number(r.id_trabajador)));

  const add = () => {
    const found = catalog.find((r) => Number(r.id_trabajador) === Number(selected));
    if (!found) return;

    setRows((prev) => [
      ...prev,
      {
        id_trabajador: found.id_trabajador,
        horas_estimadas: "1",
        costo_hora_snapshot: found.costo_hora,
      },
    ]);
    setSelected("");
  };

  return (
    <article className="gm-section servicios-component-card servicios-component-card--labor">
      <div className="gm-section-head servicios-component-card__title">
        <div>
          <h4>Mano de obra</h4>
          <p>La tarifa queda congelada al asignar al trabajador para que cambios futuros no alteren costos históricos.</p>
        </div>
        <strong><span>{rows.length}</span><small>asignados</small></strong>
      </div>

      <div className="gm-section-body servicios-component-card__body">
        <div className="servicios-component-add">
          <BuscadorSelector
            options={catalog.filter((r) => Number(r.activo) === 1 && !used.has(Number(r.id_trabajador)))}
            value={selected}
            onChange={setSelected}
            getValue={(r) => r.id_trabajador}
            getLabel={(r) => `${r.nombre} · ${money(r.costo_hora)} / H`}
            label="Trabajador"
            placeholder="SELECCIONAR TRABAJADOR"
            searchPlaceholder="BUSCAR TRABAJADOR..."
            emptyText="NO HAY TRABAJADORES"
          />
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={add} disabled={!selected}>Agregar</button>
        </div>

        <div className="servicios-component-list">
          {rows.length === 0 ? (
            <p className="servicios-component-empty">SIN MANO DE OBRA ASIGNADA.</p>
          ) : rows.map((row) => {
            const found = catalog.find((r) => Number(r.id_trabajador) === Number(row.id_trabajador));
            const costoAplicado = Number(row.costo_hora_snapshot ?? found?.costo_hora ?? 0);
            const costoActual = Number(found?.costo_hora ?? costoAplicado);
            const cambioTarifa = Math.abs(costoActual - costoAplicado) > 0.000001;

            return (
              <div className="servicios-component-row" key={row.id_trabajador}>
                <div className="servicios-component-row__name">
                  <strong>{found?.nombre || row.nombre || "TRABAJADOR"}</strong>
                  <small>
                    {found?.rol || row.rol || "SIN ROL"} · {money(costoAplicado)} por hora
                    {cambioTarifa ? ` · actual ${money(costoActual)}` : ""}
                  </small>
                </div>
                <label className="gm-field servicios-component-quantity">
                  <input
                    className="gm-input servicios-component-quantity__input"
                    inputMode="decimal"
                    value={row.horas_estimadas}
                    onChange={(e) => setRows((prev) => prev.map((x) => Number(x.id_trabajador) === Number(row.id_trabajador) ? { ...x, horas_estimadas: decimalText(e.target.value, 4) } : x))}
                    placeholder=" "
                  />
                  <span className="gm-label gm-label--up">Horas</span>
                </label>
                <span className="servicios-component-unit">H</span>
                <button type="button" className="gm-action-btn gm-action-btn--danger servicios-component-remove" onClick={() => setRows((prev) => prev.filter((x) => Number(x.id_trabajador) !== Number(row.id_trabajador)))}>×</button>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default function ModalServicio({
  open,
  item,
  categorias = [],
  unidades = [],
  articulos = [],
  trabajadores = [],
  saving,
  onClose,
  onSave,
  onToast,
  onOpenAgregarCategoria,
}) {
  const [form, setForm] = useState(EMPTY);
  const [articleRows, setArticleRows] = useState([]);
  const [workerRows, setWorkerRows] = useState([]);

  useEffect(() => {
    if (!open) return;

    const defaultUnit = unidades.find(
      (u) => Number(u.activo) === 1 && String(u.nombre).toUpperCase() === "SERVICIO"
    )?.id_unidad || "";

    setForm({
      nombre: item?.nombre || "",
      id_categoria: item?.id_categoria ? String(item.id_categoria) : "",
      id_unidad_cobro: item?.id_unidad_cobro ? String(item.id_unidad_cobro) : String(defaultUnit),
      descripcion: item?.descripcion || "",
      costo_base: item ? String(item.costo_base ?? "") : "",
      duracion_estimada_minutos: item?.duracion_estimada_minutos == null ? "" : String(item.duracion_estimada_minutos),
      precio_venta: item ? String(item.precio_venta ?? "") : "",
      iva_pct: String(item?.iva_pct ?? "0"),
    });

    setArticleRows(
      (item?.articulos || item?.composicion?.articulos || []).map((r) => ({
        ...r,
        cantidad: String(r.cantidad ?? "1"),
      }))
    );

    setWorkerRows(
      (item?.trabajadores || item?.composicion?.trabajadores || []).map((r) => ({
        ...r,
        horas_estimadas: String(r.horas_estimadas ?? "1"),
      }))
    );
  }, [open, item, unidades]);

  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({ open, busy: saving, onClose });

  const cost = useMemo(() => {
    const articulosCosto = articleRows.reduce((sum, row) => {
      const found = articulos.find((a) => Number(a.id_articulo) === Number(row.id_articulo));
      return sum + Number(row.cantidad || 0) * Number(found?.costo_unitario ?? row.costo_unitario ?? 0);
    }, 0);

    const manoObra = workerRows.reduce((sum, row) => {
      const found = trabajadores.find((t) => Number(t.id_trabajador) === Number(row.id_trabajador));
      const costoAplicado = Number(row.costo_hora_snapshot ?? found?.costo_hora ?? 0);
      return sum + Number(row.horas_estimadas || 0) * costoAplicado;
    }, 0);

    const otros = Number(form.costo_base || 0);
    return {
      articulos: articulosCosto,
      manoObra,
      otros,
      total: otros + articulosCosto + manoObra,
    };
  }, [articleRows, workerRows, articulos, trabajadores, form.costo_base]);

  const saleSummary = useMemo(() => {
    const netPrice = Number(form.precio_venta || 0);
    const profit = netPrice - cost.total;

    return {
      price: netPrice,
      profit,
      margin: netPrice > 0 ? (profit / netPrice) * 100 : 0,
    };
  }, [cost.total, form.precio_venta]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();

    if (!form.nombre.trim()) return onToast?.("error", "Completá el nombre del servicio.", 4200);
    if (!form.id_unidad_cobro) return onToast?.("error", "Seleccioná una unidad de cobro.", 4200);
    if (Number(form.costo_base || 0) < 0) return onToast?.("error", "Otros costos no puede ser negativo.", 4200);
    if (Number(form.precio_venta || 0) < 0) return onToast?.("error", "Indicá un precio de venta válido.", 4200);
    if (articleRows.some((r) => Number(r.cantidad) <= 0) || workerRows.some((r) => Number(r.horas_estimadas) <= 0)) {
      return onToast?.("error", "Todas las cantidades y horas deben ser mayores a cero.", 4200);
    }

    await onSave({
      ...form,
      costo_base: form.costo_base === "" ? "0" : form.costo_base,
      precio_venta: form.precio_venta === "" ? "0" : form.precio_venta,
      id_servicio: item?.id_servicio,
      id_categoria: form.id_categoria || null,
      duracion_estimada_minutos: form.duracion_estimada_minutos || null,
      composicion: {
        articulos: articleRows,
        trabajadores: workerRows,
      },
    });
  };

  const categoria = (event) => {
    if (event.target.value === "__ADD__") {
      onOpenAgregarCategoria?.((id) => set("id_categoria", String(id || "")));
    } else {
      set("id_categoria", event.target.value);
    }
  };

  return createPortal(
    <div ref={overlayRef} className="gm-modal-overlay" data-servicios-modal-overlay="true" onMouseDown={cerrarDesdeFondo}>
      <form className="gm-modal-container gm-modal-v2 servicios-modal servicios-modal--service" onSubmit={submit} role="dialog" aria-modal="true">
        <header className="gm-modal-header">
          <div className="gm-modal-head-icon"><FontAwesomeIcon icon={faBriefcase} /></div>
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title">{item ? "Editar servicio" : "Agregar servicio"}</h2>
            <p className="gm-modal-subtitle">Definí la información, los costos y los recursos desde una sola ficha.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content servicios-service-content">
          <div className="servicios-service-overview">
            <section className="gm-section servicios-form-section servicios-service-panel servicios-service-panel--identity">
              <div className="gm-section-head servicios-service-sectionHead">
                <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faCircleInfo} /></span>
                <span className="servicios-service-sectionCopy"><strong>Información principal</strong><small>Los datos que identifican y describen el servicio.</small></span>
              </div>
              <div className="gm-section-body servicios-service-panelBody">
                <div className="servicios-form-grid">
                  <label className="gm-field servicios-field--span-12 servicios-service-nameField">
                    <input className="gm-input" autoFocus maxLength={150} value={form.nombre} onChange={(e) => set("nombre", clampText(e.target.value, 150))} placeholder=" " />
                    <span className="gm-label">Nombre del servicio</span>
                  </label>

                  <label className="gm-field servicios-field--span-4">
                    <select className="gm-input gm-select" value={form.id_categoria} onChange={categoria}>
                      <option value="__ADD__">+ AGREGAR CATEGORÍA</option>
                      <option value="">SIN CATEGORÍA</option>
                      {categorias.filter((c) => Number(c.activo) === 1).map((c) => (
                        <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}</option>
                      ))}
                    </select>
                    <span className="gm-label gm-label--up">Categoría</span>
                  </label>

                  <label className="gm-field servicios-field--span-4">
                    <select className="gm-input gm-select" value={form.id_unidad_cobro} onChange={(e) => set("id_unidad_cobro", e.target.value)}>
                      <option value="">SELECCIONAR UNIDAD</option>
                      {unidades.filter((u) => Number(u.activo) === 1).map((u) => (
                        <option key={u.id_unidad} value={u.id_unidad}>{u.nombre} ({u.simbolo})</option>
                      ))}
                    </select>
                    <span className="gm-label gm-label--up">Unidad de cobro</span>
                  </label>

                  <label className="gm-field servicios-field--span-4">
                    <input
                      className="gm-input"
                      inputMode="numeric"
                      value={form.duracion_estimada_minutos}
                      onChange={(e) => set("duracion_estimada_minutos", integerText(e.target.value, 7))}
                      placeholder=" "
                    />
                    <span className="gm-label">Duración estimada (min)</span>
                  </label>

                  <label className="gm-field servicios-field--wide servicios-service-descriptionField">
                    <textarea className="gm-input servicios-textarea" rows={3} maxLength={1000} value={form.descripcion} onChange={(e) => set("descripcion", clampText(e.target.value, 1000))} placeholder=" " />
                    <span className="gm-label">Descripción u observaciones</span>
                    <small className="servicios-field__counter">{form.descripcion.length}/1000</small>
                  </label>
                </div>
              </div>
            </section>

            <section className="gm-section servicios-form-section servicios-service-panel servicios-service-panel--pricing">
              <div className="gm-section-head servicios-service-sectionHead">
                <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faDollarSign} /></span>
                <span className="servicios-service-sectionCopy"><strong>Precio y rentabilidad</strong><small>El costo se recalcula según la composición.</small></span>
              </div>
              <div className="gm-section-body servicios-service-panelBody">
                <div className="servicios-form-grid servicios-service-priceFields">
                  <label className="gm-field servicios-field--span-6">
                    <input className="gm-input" inputMode="decimal" value={form.costo_base} onChange={(e) => set("costo_base", decimalText(e.target.value, 6))} placeholder="0" />
                    <span className="gm-label gm-label--up">Otros costos</span>
                  </label>
                  <label className="gm-field servicios-field--span-6">
                    <input className="gm-input" inputMode="decimal" value={form.precio_venta} onChange={(e) => set("precio_venta", decimalText(e.target.value, 2))} placeholder="0" />
                    <span className="gm-label gm-label--up">Precio de venta</span>
                  </label>
                  <label className="gm-field servicios-field--span-12">
                    <select className="gm-input gm-select" value={form.iva_pct} onChange={(e) => set("iva_pct", e.target.value)}>
                      {["0", "10.5", "21", "27"].map((v) => <option key={v} value={v}>{v} %</option>)}
                    </select>
                    <span className="gm-label gm-label--up">IVA aplicado</span>
                  </label>
                </div>

                <div className="servicios-service-financialSummary">
                  <div><span>Costo calculado</span><strong>{money(cost.total)}</strong></div>
                  <div><span>Precio de venta</span><strong>{money(saleSummary.price)}</strong></div>
                  <div className={saleSummary.profit < 0 ? "is-negative" : "is-positive"}>
                    <span>Resultado estimado</span>
                    <strong>{money(saleSummary.profit)}</strong>
                    <small>{saleSummary.margin.toLocaleString("es-AR", { maximumFractionDigits: 1 })}% de margen</small>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="gm-section servicios-composition servicios-service-panel servicios-service-panel--composition">
            <div className="gm-section-head servicios-composition__head servicios-service-sectionHead">
              <div className="servicios-composition__heading">
                <span className="servicios-service-sectionIcon"><FontAwesomeIcon icon={faLayerGroup} /></span>
                <span className="servicios-service-sectionCopy"><strong>Composición del servicio</strong><small>Agregá los recursos necesarios y ajustá sus cantidades u horas.</small></span>
              </div>
              <div className="servicios-composition__cost"><span>Costo automático</span><strong>{money(cost.total)}</strong></div>
            </div>

            <div className="gm-section-body servicios-composition__body">
              <div className="servicios-composition-grid servicios-composition-grid--two">
                <ArticulosCard rows={articleRows} setRows={setArticleRows} catalog={articulos} />
                <TrabajadoresCard rows={workerRows} setRows={setWorkerRows} catalog={trabajadores} />
              </div>

              <div className="servicios-composition__totals">
                <span>Materiales / Insumos: <strong>{money(cost.articulos)}</strong></span>
                <span>Mano de obra: <strong>{money(cost.manoObra)}</strong></span>
                <span>Otros costos: <strong>{money(cost.otros)}</strong></span>
                <span className="servicios-composition__grandTotal">Total costo: <strong>{money(cost.total)}</strong></span>
              </div>
            </div>
          </section>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" className="gm-action-btn gm-action-btn--save" disabled={saving}>{saving ? "Guardando..." : item ? "Guardar cambios" : "Crear servicio"}</button>
        </footer>
      </form>
    </div>,
    document.body
  );
}
