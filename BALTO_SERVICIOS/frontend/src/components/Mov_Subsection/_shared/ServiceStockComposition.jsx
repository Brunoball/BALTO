import React, { useEffect, useMemo, useState } from "react";
import "./ServiceStockComposition.css";

const EPS = 0.0000005;

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function positiveId(v) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? x : null;
}

function text(v) {
  return String(v ?? "").trim();
}

function articleId(x) {
  return positiveId(x?.id_articulo ?? x?.idArticulo ?? x?.articulo_id ?? x?.id_stock_producto ?? x?.id);
}

function articleType(x) {
  return text(x?.articulo_tipo ?? x?.tipo ?? x?.tipo_articulo).toUpperCase();
}

function currentStock(x) {
  const raw = x?.stock_actual ?? x?.stock_disponible ?? x?.stock ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function quantityPerService(x) {
  const raw = x?.cantidad_por_unidad ?? x?.cantidadPorUnidad ?? x?.cantidad ?? 0;
  return Math.max(0, n(raw, 0));
}

function formatQty(v) {
  const value = n(v, 0);
  if (Math.abs(value - Math.round(value)) <= EPS) return String(Math.round(value));
  return String(Math.round(value * 1000000) / 1000000).replace(".", ",");
}

export function normalizeServiceStockComponents(source) {
  const raw = Array.isArray(source)
    ? source
    : Array.isArray(source?.consumos_snapshot)
    ? source.consumos_snapshot
    : Array.isArray(source?.componentes_servicio)
    ? source.componentes_servicio
    : Array.isArray(source?.componentes_stock)
    ? source.componentes_stock
    : [];

  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const id = articleId(item);
    const qty = quantityPerService(item);
    if (!id || qty <= 0 || seen.has(id)) return;
    seen.add(id);
    out.push({
      id_articulo: id,
      nombre: text(item?.nombre ?? item?.articulo_nombre ?? item?.descripcion) || `Artículo #${id}`,
      articulo_tipo: articleType(item),
      cantidad_por_unidad: qty,
      stock_actual: currentStock(item),
      stock_disponible: currentStock(item),
      unidad_nombre: text(item?.unidad_nombre),
      unidad_simbolo: text(item?.unidad_simbolo),
      controla_stock: Number(item?.controla_stock ?? 1) === 1 ? 1 : 0,
      activo: Number(item?.activo ?? 1) === 0 ? 0 : 1,
    });
  });
  return out;
}

export function serializeServiceStockComponents(components) {
  return normalizeServiceStockComponents(components).map((item) => ({
    id_articulo: item.id_articulo,
    cantidad_por_unidad: Math.round(item.cantidad_por_unidad * 1000000) / 1000000,
  }));
}

export function getServiceStockShortages(components, serviceQuantity, stockOptions = []) {
  const qtyService = Math.max(0, n(serviceQuantity, 0));
  const optionsById = new Map(
    (Array.isArray(stockOptions) ? stockOptions : [])
      .map((x) => [articleId(x), x])
      .filter(([id]) => id)
  );

  return normalizeServiceStockComponents(components)
    .map((component) => {
      const current = optionsById.get(component.id_articulo) || component;
      const controlaStock = Number(current?.controla_stock ?? component?.controla_stock ?? 1) === 1;
      const stock = controlaStock ? currentStock(current) : null;
      const required = Math.round(qtyService * component.cantidad_por_unidad * 1000000) / 1000000;
      const missing = controlaStock && stock !== null ? Math.max(0, required - stock) : 0;
      return {
        ...component,
        stock_disponible: stock,
        cantidad_total: required,
        faltante: missing,
        insuficiente: controlaStock && stock !== null && required > stock + EPS,
      };
    })
    .filter((x) => x.insuficiente);
}

export function firstServiceStockShortageMessage(components, serviceQuantity, stockOptions = []) {
  const shortage = getServiceStockShortages(components, serviceQuantity, stockOptions)[0];
  if (!shortage) return "";
  const unit = shortage.unidad_simbolo ? ` ${shortage.unidad_simbolo}` : "";
  return `Stock insuficiente para "${shortage.nombre}". Disponible: ${formatQty(shortage.stock_disponible)}${unit}, necesario: ${formatQty(shortage.cantidad_total)}${unit}.`;
}

function optionToComponent(option, qty = 1) {
  const id = articleId(option);
  if (!id) return null;
  return {
    id_articulo: id,
    nombre: text(option?.nombre ?? option?.articulo_nombre ?? option?.descripcion) || `Artículo #${id}`,
    articulo_tipo: articleType(option),
    cantidad_por_unidad: Math.max(EPS, n(qty, 1)),
    stock_actual: currentStock(option),
    stock_disponible: currentStock(option),
    unidad_nombre: text(option?.unidad_nombre),
    unidad_simbolo: text(option?.unidad_simbolo),
    controla_stock: Number(option?.controla_stock ?? 1) === 1 ? 1 : 0,
    activo: Number(option?.activo ?? 1) === 0 ? 0 : 1,
  };
}

export default function ServiceStockComposition({
  components = [],
  stockOptions = [],
  serviceQuantity = 1,
  onChange,
  disabled = false,
  serviceName = "",
  serviceId = null,
  stockLabel = "Stock actual",
  tableLayout = false,
}) {
  const normalized = useMemo(() => normalizeServiceStockComponents(components), [components]);
  const options = useMemo(
    () => (Array.isArray(stockOptions) ? stockOptions : [])
      .filter((x) => {
        const id = articleId(x);
        const tipo = articleType(x);
        return id && ["MATERIAL", "INSUMO"].includes(tipo) && Number(x?.activo ?? 1) !== 0;
      }),
    [stockOptions]
  );
  const optionsById = useMemo(() => new Map(options.map((x) => [articleId(x), x])), [options]);
  const shortages = useMemo(
    () => getServiceStockShortages(normalized, serviceQuantity, options),
    [normalized, serviceQuantity, options]
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [serviceId]);

  const emit = (next) => onChange?.(normalizeServiceStockComponents(next));

  const updateAt = (idx, patch) => {
    const next = normalized.map((x, i) => (i === idx ? { ...x, ...patch } : x));
    emit(next);
  };

  const removeAt = (idx) => emit(normalized.filter((_, i) => i !== idx));

  const changeArticle = (idx, idValue) => {
    const id = positiveId(idValue);
    const option = optionsById.get(id);
    if (!id || !option) return;
    const duplicate = normalized.some((x, i) => i !== idx && x.id_articulo === id);
    if (duplicate) return;
    const replacement = optionToComponent(option, normalized[idx]?.cantidad_por_unidad || 1);
    if (!replacement) return;
    const next = normalized.map((x, i) => (i === idx ? replacement : x));
    emit(next);
  };

  const addComponent = () => {
    const used = new Set(normalized.map((x) => x.id_articulo));
    const option = options.find((x) => !used.has(articleId(x)));
    if (!option) return;
    const component = optionToComponent(option, 1);
    if (component) emit([...normalized, component]);
    setOpen(true);
  };

  const enriched = normalized.map((component) => {
    const current = optionsById.get(component.id_articulo) || component;
    const controlaStock = Number(current?.controla_stock ?? component?.controla_stock ?? 1) === 1;
    const stock = controlaStock ? currentStock(current) : null;
    const required = Math.round(Math.max(0, n(serviceQuantity, 0)) * component.cantidad_por_unidad * 1000000) / 1000000;
    return {
      ...component,
      stock,
      required,
      controlaStock,
      insufficient: controlaStock && stock !== null && required > stock + EPS,
      sufficient: controlaStock && stock !== null && required <= stock + EPS,
      unidad_simbolo: text(current?.unidad_simbolo ?? component.unidad_simbolo),
    };
  });

  const usedIds = new Set(normalized.map((x) => x.id_articulo));
  const canAdd = options.some((x) => !usedIds.has(articleId(x)));

  return (
    <div className={`ssc ${shortages.length ? "ssc--danger" : ""} ${tableLayout ? "ssc--table-layout" : ""}`}>
      <button type="button" className="ssc__toggle" onClick={() => setOpen((v) => !v)} disabled={disabled && !normalized.length}>
        <span>{open ? "▾" : "▸"} Materiales / insumos ({normalized.length})</span>
        {shortages.length ? <strong>{shortages.length} con stock insuficiente</strong> : <span>Detalle del servicio</span>}
      </button>

      {open && (
        <div className="ssc__body">
          {serviceName ? <div className="ssc__intro">Composición usada para <strong>{serviceName}</strong>. Podés ajustar estas cantidades sólo para este movimiento.</div> : null}
          {!enriched.length ? <div className="ssc__empty">Este servicio no tiene materiales/insumos cargados.</div> : null}

          {tableLayout && enriched.length ? (
            <div className="ssc__excel-table">
              <div className="ssc__excel-head" aria-hidden="true">
                <div className="ssc__excel-th ssc__excel-th--resource">Material / insumo</div>
                <div className="ssc__excel-th">Cant. por servicio</div>
                <div className="ssc__excel-th">Necesario total</div>
                <div className="ssc__excel-th">{stockLabel}</div>
                <div className="ssc__excel-th">Acción</div>
              </div>

              {enriched.map((component, idx) => (
                <div className={`ssc__excel-row ${component.insufficient ? "ssc__excel-row--danger" : component.sufficient ? "ssc__excel-row--ok" : ""}`} key={`${component.id_articulo}-${idx}`}>
                  <div className="ssc__excel-cell ssc__excel-cell--resource">
                    <span className="ssc__excel-mobile-label">Material / insumo</span>
                    <select value={component.id_articulo} onChange={(e) => changeArticle(idx, e.target.value)} disabled={disabled}>
                      {!optionsById.has(component.id_articulo) ? (
                        <option value={component.id_articulo}>{component.nombre}</option>
                      ) : null}
                      {options.map((option) => {
                        const id = articleId(option);
                        const duplicate = usedIds.has(id) && id !== component.id_articulo;
                        return <option key={id} value={id} disabled={duplicate}>{text(option?.nombre) || `Artículo #${id}`}</option>;
                      })}
                    </select>
                    <small>{component.articulo_tipo || "MATERIAL / INSUMO"}{component.unidad_simbolo ? ` · ${component.unidad_simbolo}` : ""}</small>
                  </div>

                  <div className="ssc__excel-cell ssc__excel-cell--center">
                    <span className="ssc__excel-mobile-label">Cant. por servicio</span>
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={component.cantidad_por_unidad}
                      onChange={(e) => updateAt(idx, { cantidad_por_unidad: Math.max(0.000001, Number(e.target.value) || 0.000001) })}
                      disabled={disabled}
                    />
                  </div>

                  <div className="ssc__excel-cell ssc__excel-cell--metric">
                    <span className="ssc__excel-mobile-label">Necesario total</span>
                    <strong>{formatQty(component.required)}{component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}</strong>
                  </div>

                  <div className="ssc__excel-cell ssc__excel-cell--metric">
                    <span className="ssc__excel-mobile-label">{component.controlaStock ? stockLabel : "Stock"}</span>
                    {component.controlaStock ? (
                      <>
                        <strong>{component.stock === null ? "—" : `${formatQty(component.stock)}${component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}`}</strong>
                        {component.insufficient ? <small className="ssc__missing">Faltan {formatQty(component.required - component.stock)}{component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}</small> : <small className="ssc__ok">Disponible</small>}
                      </>
                    ) : (
                      <>
                        <strong>—</strong>
                        <small>Sin control de stock</small>
                      </>
                    )}
                  </div>

                  <div className="ssc__excel-cell ssc__excel-cell--action">
                    <button type="button" className="ssc__remove" onClick={() => removeAt(idx)} disabled={disabled} aria-label="Quitar material o insumo">×</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            enriched.map((component, idx) => (
              <div className={`ssc__row ${component.insufficient ? "ssc__row--danger" : ""}`} key={`${component.id_articulo}-${idx}`}>
                <div className="ssc__resource">
                  <label>Material / insumo</label>
                  <select value={component.id_articulo} onChange={(e) => changeArticle(idx, e.target.value)} disabled={disabled}>
                    {!optionsById.has(component.id_articulo) ? (
                      <option value={component.id_articulo}>{component.nombre}</option>
                    ) : null}
                    {options.map((option) => {
                      const id = articleId(option);
                      const duplicate = usedIds.has(id) && id !== component.id_articulo;
                      return <option key={id} value={id} disabled={duplicate}>{text(option?.nombre) || `Artículo #${id}`}</option>;
                    })}
                  </select>
                  <small>{component.articulo_tipo || "MATERIAL / INSUMO"}{component.unidad_simbolo ? ` · ${component.unidad_simbolo}` : ""}</small>
                </div>

                <div className="ssc__qty">
                  <label>Cant. por servicio</label>
                  <input
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={component.cantidad_por_unidad}
                    onChange={(e) => updateAt(idx, { cantidad_por_unidad: Math.max(0.000001, Number(e.target.value) || 0.000001) })}
                    disabled={disabled}
                  />
                </div>

                <div className="ssc__metric">
                  <label>Necesario total</label>
                  <strong>{formatQty(component.required)}{component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}</strong>
                </div>

                <div className="ssc__metric">
                  <label>{component.controlaStock ? stockLabel : "Stock"}</label>
                  {component.controlaStock ? (
                    <>
                      <strong>{component.stock === null ? "—" : `${formatQty(component.stock)}${component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}`}</strong>
                      {component.insufficient ? <small className="ssc__missing">Faltan {formatQty(component.required - component.stock)}{component.unidad_simbolo ? ` ${component.unidad_simbolo}` : ""}</small> : <small className="ssc__ok">Disponible</small>}
                    </>
                  ) : (
                    <>
                      <strong>—</strong>
                      <small>Sin control de stock</small>
                    </>
                  )}
                </div>

                <button type="button" className="ssc__remove" onClick={() => removeAt(idx)} disabled={disabled} aria-label="Quitar material o insumo">×</button>
              </div>
            ))
          )}

          <button type="button" className="ssc__add" onClick={addComponent} disabled={disabled || !canAdd}>+ Agregar material / insumo</button>
        </div>
      )}
    </div>
  );
}
