import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { clampText, decimalNumber, decimalText, integerText, money, moneyApiValue, moneyDecimalText, moneyInputValue } from "../utils/serviciosFormUtils";
import useServiciosGlobalModal from "./useServiciosGlobalModal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBriefcase, faChevronDown, faCircleInfo, faDollarSign, faLayerGroup } from "@fortawesome/free-solid-svg-icons";

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

const percentageInputValue = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  const rounded = Math.round((number + Number.EPSILON) * 100) / 100;
  return rounded
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")
    .replace(".", ",");
};

const compositionDecimalInputValue = (value, fallback = "1,00") => {
  if (value == null || String(value).trim() === "") return fallback;
  return decimalNumber(value).toFixed(2).replace(".", ",");
};

const normalizeSearch = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

function SelectorMultipleRecursos({
  options = [],
  getValue,
  getLabel,
  label,
  placeholder,
  searchPlaceholder,
  emptyText,
  onAdd,
}) {
  const rootRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);

  const filtered = useMemo(() => {
    const q = normalizeSearch(query).trim();
    if (!q) return options;
    return options.filter((row) => normalizeSearch(getLabel(row)).includes(q));
  }, [options, query, getLabel]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedSet.has(String(getValue(row))));

  const toggle = (row) => {
    const id = String(getValue(row));
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]);
  };

  const toggleAllFiltered = () => {
    const filteredIds = filtered.map((row) => String(getValue(row)));
    if (allFilteredSelected) {
      const remove = new Set(filteredIds);
      setSelectedIds((prev) => prev.filter((id) => !remove.has(String(id))));
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev.map(String));
      filteredIds.forEach((id) => next.add(id));
      return [...next];
    });
  };

  const confirm = () => {
    if (selectedIds.length === 0) return;
    onAdd?.(selectedIds);
    setSelectedIds([]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={`servicios-multi-select ${open ? "is-open" : ""}`} ref={rootRef}>
      <div className="gm-field servicios-multi-select__field">
        <button
          type="button"
          className="servicios-multi-select__trigger"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span>
            <strong>{selectedIds.length > 0 ? `${selectedIds.length} seleccionado${selectedIds.length === 1 ? "" : "s"}` : placeholder}</strong>
            <small>{options.length > 0 ? `${options.length} disponible${options.length === 1 ? "" : "s"}` : emptyText}</small>
          </span>
          <FontAwesomeIcon className="servicios-multi-select__chevron" icon={faChevronDown} aria-hidden="true" />
        </button>
        <span className="gm-label gm-label--up">{label}</span>

        {open && (
          <div className="servicios-multi-select__menu" role="dialog" aria-label={label}>
            <div className="servicios-multi-select__search">
              <label className="gm-field">
                <input
                  ref={searchRef}
                  className="gm-input"
                  type="search"
                  maxLength={120}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder=" "
                />
                <span className="gm-label">{searchPlaceholder}</span>
              </label>
            </div>

            <div className="servicios-multi-select__toolbar">
              <button type="button" onClick={toggleAllFiltered} disabled={filtered.length === 0}>
                {allFilteredSelected ? "Quitar selección" : query.trim() ? "Seleccionar resultados" : "Seleccionar todos"}
              </button>
              <button type="button" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>Limpiar</button>
            </div>

            <div className="servicios-multi-select__options">
              {filtered.length === 0 ? (
                <div className="servicios-multi-select__empty">{emptyText}</div>
              ) : filtered.map((row) => {
                const id = String(getValue(row));
                const checked = selectedSet.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={checked ? "is-selected" : ""}
                    onClick={() => toggle(row)}
                    aria-pressed={checked}
                  >
                    <span className="servicios-multi-select__option-label">{getLabel(row)}</span>
                    <span className="servicios-multi-select__check" aria-hidden="true">{checked ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="gm-action-btn gm-action-btn--save servicios-multi-select__add"
        onClick={confirm}
        disabled={selectedIds.length === 0}
      >
        Agregar {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
      </button>
    </div>
  );
}

function ArticulosCard({ rows, setRows, catalog }) {
  const used = new Set(rows.map((r) => Number(r.id_articulo)));
  const available = catalog.filter((r) => Number(r.activo) === 1 && !used.has(Number(r.id_articulo)));

  const addMany = (ids) => {
    const selected = new Set(ids.map((id) => Number(id)));
    const additions = catalog
      .filter((row) => selected.has(Number(row.id_articulo)) && Number(row.activo) === 1)
      .map((row) => ({ id_articulo: row.id_articulo, cantidad: "1,00" }));

    if (additions.length === 0) return;
    setRows((prev) => {
      const existing = new Set(prev.map((row) => Number(row.id_articulo)));
      return [...prev, ...additions.filter((row) => !existing.has(Number(row.id_articulo)))];
    });
  };

  return (
    <article className="gm-section servicios-component-card servicios-component-card--materials">
      <div className="gm-section-head servicios-component-card__title">
        <div>
          <h4>Materiales e insumos</h4>
          <p>Seleccioná uno o varios recursos y después ajustá la cantidad utilizada de cada uno.</p>
        </div>
        <strong><span>{rows.length}</span><small>asignados</small></strong>
      </div>

      <div className="gm-section-body servicios-component-card__body">
        <div className="servicios-component-add servicios-component-add--multi">
          <SelectorMultipleRecursos
            options={available}
            getValue={(r) => r.id_articulo}
            getLabel={(r) => `${r.tipo === "MATERIAL" ? "MATERIAL" : "INSUMO"} · ${r.nombre} · ${money(r.costo_unitario)} / ${r.unidad_simbolo || "UN"}`}
            label="Materiales / Insumos"
            placeholder="SELECCIONAR RECURSOS"
            searchPlaceholder="Buscar material o insumo"
            emptyText="NO HAY RECURSOS DISPONIBLES"
            onAdd={addMany}
          />
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
                    onChange={(e) => setRows((prev) => prev.map((x) => Number(x.id_articulo) === id ? { ...x, cantidad: decimalText(e.target.value, 2).replace(".", ",") } : x))}
                    onBlur={() => setRows((prev) => prev.map((x) => Number(x.id_articulo) === id ? { ...x, cantidad: compositionDecimalInputValue(x.cantidad) } : x))}
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
  const used = new Set(rows.map((r) => Number(r.id_trabajador)));
  const available = catalog.filter((r) => Number(r.activo) === 1 && !used.has(Number(r.id_trabajador)));

  const addMany = (ids) => {
    const selected = new Set(ids.map((id) => Number(id)));
    const additions = catalog
      .filter((row) => selected.has(Number(row.id_trabajador)) && Number(row.activo) === 1)
      .map((row) => ({
        id_trabajador: row.id_trabajador,
        horas_estimadas: "1,00",
        costo_hora_snapshot: row.costo_hora,
      }));

    if (additions.length === 0) return;
    setRows((prev) => {
      const existing = new Set(prev.map((row) => Number(row.id_trabajador)));
      return [...prev, ...additions.filter((row) => !existing.has(Number(row.id_trabajador)))];
    });
  };

  return (
    <article className="gm-section servicios-component-card servicios-component-card--labor">
      <div className="gm-section-head servicios-component-card__title">
        <div>
          <h4>Mano de obra</h4>
          <p>Seleccioná trabajadores y después indicá las horas estimadas de cada uno.</p>
        </div>
        <strong><span>{rows.length}</span><small>asignados</small></strong>
      </div>

      <div className="gm-section-body servicios-component-card__body">
        <div className="servicios-component-add servicios-component-add--multi">
          <SelectorMultipleRecursos
            options={available}
            getValue={(r) => r.id_trabajador}
            getLabel={(r) => `${r.nombre} · ${r.rol || "SIN ROL"} · ${money(r.costo_hora)} / H`}
            label="Trabajadores"
            placeholder="SELECCIONAR TRABAJADORES"
            searchPlaceholder="Buscar trabajador"
            emptyText="NO HAY TRABAJADORES DISPONIBLES"
            onAdd={addMany}
          />
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
                    onChange={(e) => setRows((prev) => prev.map((x) => Number(x.id_trabajador) === Number(row.id_trabajador) ? { ...x, horas_estimadas: decimalText(e.target.value, 2).replace(".", ",") } : x))}
                    onBlur={() => setRows((prev) => prev.map((x) => Number(x.id_trabajador) === Number(row.id_trabajador) ? { ...x, horas_estimadas: compositionDecimalInputValue(x.horas_estimadas) } : x))}
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
  onOpenAgregarUnidad,
}) {
  const [form, setForm] = useState(EMPTY);
  const [articleRows, setArticleRows] = useState([]);
  const [workerRows, setWorkerRows] = useState([]);
  const [marginInput, setMarginInput] = useState("");
  const [pricingSource, setPricingSource] = useState("price");
  const [activeTab, setActiveTab] = useState("main");

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
      costo_base: item ? moneyInputValue(item.costo_base) : "",
      duracion_estimada_minutos: item?.duracion_estimada_minutos == null ? "" : String(item.duracion_estimada_minutos),
      precio_venta: item ? moneyInputValue(item.precio_venta) : "",
      iva_pct: String(item?.iva_pct ?? "0"),
    });

    setArticleRows(
      (item?.articulos || item?.composicion?.articulos || []).map((r) => ({
        ...r,
        cantidad: compositionDecimalInputValue(r.cantidad),
      }))
    );

    setWorkerRows(
      (item?.trabajadores || item?.composicion?.trabajadores || []).map((r) => ({
        ...r,
        horas_estimadas: compositionDecimalInputValue(r.horas_estimadas),
      }))
    );

    setMarginInput("");
    setPricingSource("price");
    setActiveTab("main");
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

    const otros = decimalNumber(form.costo_base);
    return {
      articulos: articulosCosto,
      manoObra,
      otros,
      total: otros + articulosCosto + manoObra,
    };
  }, [articleRows, workerRows, articulos, trabajadores, form.costo_base]);

  const saleSummary = useMemo(() => {
    const netPrice = decimalNumber(form.precio_venta);
    const profit = netPrice - cost.total;

    return {
      price: netPrice,
      profit,
      margin: netPrice > 0 ? (profit / netPrice) * 100 : 0,
    };
  }, [cost.total, form.precio_venta]);

  useEffect(() => {
    if (!open || pricingSource !== "price") return;

    const hasPrice = String(form.precio_venta ?? "").trim() !== "";
    const nextMargin = hasPrice ? percentageInputValue(saleSummary.margin) : "";
    setMarginInput((prev) => (prev === nextMargin ? prev : nextMargin));
  }, [open, pricingSource, form.precio_venta, saleSummary.margin]);

  useEffect(() => {
    if (!open || pricingSource !== "margin" || String(marginInput).trim() === "") return;

    const margin = decimalNumber(marginInput);
    if (margin < 0 || margin >= 100) return;

    const divisor = 1 - margin / 100;
    const nextPrice = moneyInputValue(divisor > 0 ? cost.total / divisor : 0);

    setForm((prev) => (
      prev.precio_venta === nextPrice
        ? prev
        : { ...prev, precio_venta: nextPrice }
    ));
  }, [open, pricingSource, marginInput, cost.total]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const changePrice = (value) => {
    setPricingSource("price");
    set("precio_venta", moneyDecimalText(value));
  };

  const changeMargin = (value) => {
    const normalized = decimalText(value, 2, 3);
    const nextMargin = normalized.replace(".", ",");

    if (normalized === "") {
      setMarginInput("");
      setPricingSource("price");
      return;
    }

    setMarginInput(nextMargin);
    setPricingSource("margin");

    const margin = decimalNumber(normalized);
    if (margin < 0 || margin >= 100) return;

    const divisor = 1 - margin / 100;
    set("precio_venta", moneyInputValue(divisor > 0 ? cost.total / divisor : 0));
  };

  const submit = async (event) => {
    event.preventDefault();

    if (!form.nombre.trim()) return onToast?.("error", "Completá el nombre del servicio.", 4200);
    if (!form.id_unidad_cobro) return onToast?.("error", "Seleccioná una unidad de cobro.", 4200);
    if (decimalNumber(form.costo_base) < 0) return onToast?.("error", "Otros costos no puede ser negativo.", 4200);
    if (pricingSource === "margin" && decimalNumber(marginInput) >= 100) return onToast?.("error", "El margen deseado debe ser menor a 100%.", 4200);
    if (decimalNumber(form.precio_venta) < 0) return onToast?.("error", "Indicá un precio de venta válido.", 4200);
    if (articleRows.some((r) => Number(r.cantidad) <= 0) || workerRows.some((r) => Number(r.horas_estimadas) <= 0)) {
      return onToast?.("error", "Todas las cantidades y horas deben ser mayores a cero.", 4200);
    }

    await onSave({
      ...form,
      costo_base: moneyApiValue(form.costo_base),
      precio_venta: moneyApiValue(form.precio_venta),
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
    if (event.target.value === "__ADD__") onOpenAgregarCategoria?.((id) => set("id_categoria", String(id || "")));
    else set("id_categoria", event.target.value);
  };

  const unidad = (event) => {
    if (event.target.value === "__ADD__") onOpenAgregarUnidad?.((id) => set("id_unidad_cobro", String(id || "")));
    else set("id_unidad_cobro", event.target.value);
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
          <div className="servicios-service-tabs" role="tablist" aria-label="Secciones del servicio">
            <button
              type="button"
              className={`servicios-service-tab ${activeTab === "main" ? "is-active" : ""}`}
              onClick={() => setActiveTab("main")}
              role="tab"
              aria-selected={activeTab === "main"}
            >
              <span>Información principal</span>
            </button>
            <button
              type="button"
              className={`servicios-service-tab ${activeTab === "composition" ? "is-active" : ""}`}
              onClick={() => setActiveTab("composition")}
              role="tab"
              aria-selected={activeTab === "composition"}
            >
              <span>Composición del servicio</span>
            </button>
          </div>

          {activeTab === "main" && (
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
                    <select className="gm-input gm-select" value={form.id_unidad_cobro} onChange={unidad}>
                      <option value="__ADD__">+ AGREGAR UNIDAD</option>
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
                  <label className="gm-field servicios-service-priceField">
                    <input className="gm-input" inputMode="decimal" value={form.costo_base} onChange={(e) => set("costo_base", moneyDecimalText(e.target.value))} placeholder="0" />
                    <span className="gm-label gm-label--up">Otros costos</span>
                  </label>
                  <label className="gm-field servicios-service-priceField">
                    <input className="gm-input" inputMode="decimal" value={marginInput} onChange={(e) => changeMargin(e.target.value)} placeholder="0" />
                    <span className="gm-label gm-label--up">Margen deseado (%)</span>
                  </label>
                  <label className="gm-field servicios-service-priceField">
                    <input className="gm-input" inputMode="decimal" value={form.precio_venta} onChange={(e) => changePrice(e.target.value)} placeholder="0" />
                    <span className="gm-label gm-label--up">Precio de venta</span>
                  </label>
                  <label className="gm-field servicios-service-priceField">
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
          )}

          {activeTab === "composition" && (
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

              <div className="gm-summary-chips">
                <div className="gm-summary-chip gm-summary-chip--sub">
                  <span>Materiales / Insumos</span>
                  <b>{money(cost.articulos)}</b>
                </div>
                <div className="gm-summary-chip gm-summary-chip--labor">
                  <span>Mano de obra</span>
                  <b>{money(cost.manoObra)}</b>
                </div>
                <div className="gm-summary-chip gm-summary-chip--iva">
                  <span>Otros costos</span>
                  <b>{money(cost.otros)}</b>
                </div>
                <div className="gm-summary-chip gm-summary-chip--total">
                  <span>Total costo</span>
                  <b>{money(cost.total)}</b>
                </div>
              </div>
            </div>
          </section>
          )}
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
