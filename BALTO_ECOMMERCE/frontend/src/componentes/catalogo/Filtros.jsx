import React, { useEffect, useId, useState } from 'react';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown, Clock, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import { ORDER_OPTIONS, sanitizePriceInput } from './utilidades/catalogo';

const ORDER_ICONS = { destacados: Sparkles, 'precio-asc': ArrowUpNarrowWide, 'precio-desc': ArrowDownWideNarrow, nombre: ArrowDownAZ, recientes: Clock };

/** Campo con etiqueta flotante: la etiqueta ocupa el lugar del placeholder y sube con foco o valor. */
function CampoFlotante({ id, label, value, onChange, icon: Icon, prefix, invalid = false, describedBy, onClear, ...inputProps }) {
  const filled = String(value ?? '') !== '';
  return <div className={`float-field ${filled ? 'has-value' : ''} ${Icon ? 'has-icon' : ''} ${prefix ? 'has-prefix' : ''} ${invalid ? 'is-invalid' : ''}`}>
    {Icon && <Icon className="float-field-icon" size={15} aria-hidden="true"/>}
    <input id={id} value={value} onChange={onChange} aria-invalid={invalid || undefined} aria-describedby={describedBy} autoComplete="off" {...inputProps}/>
    <label htmlFor={id}>{label}</label>
    {prefix && <span className="float-field-prefix" aria-hidden="true">{prefix}</span>}
    {onClear && filled && <button type="button" className="float-field-clear" onClick={onClear} aria-label={`Borrar ${label.toLowerCase()}`}><X size={14}/></button>}
  </div>;
}

/** Tarjeta desplegable: conserva los filtros al cerrar y excluye su contenido del foco. */
function TarjetaFiltro({ title, summary, children }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <section className={`filter-group filter-accordion ${open ? 'is-open' : ''}`}>
    <h2 className="filter-accordion-heading">
      <button id={`${id}-titulo`} type="button" className="filter-accordion-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((value) => !value)}>
        <span className="filter-card-heading"><span className="filter-title">{title}</span>{summary && <span className="filter-card-summary">{summary}</span>}</span>
        <ChevronDown className="filter-accordion-chevron" size={16} aria-hidden="true"/>
      </button>
    </h2>
    <div className="filter-accordion-panel" id={`${id}-panel`} role="region" aria-labelledby={`${id}-titulo`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div className="filter-accordion-inner"><div className="filter-card-content">{children}</div></div>
    </div>
  </section>;
}

export default function Filtros({
  term, setTerm, order, setOrder, category, setCategory, categories, stockOnly, setStockOnly,
  minPrice = '', setMinPrice, maxPrice = '', setMaxPrice, priceError = null, onReset, activeFilters = 0,
}) {
  const id = useId();
  // El valor real vive en la URL y React Router la actualiza como transición (no al instante):
  // mientras tanto React devolvía el interruptor a su valor anterior y "rebotaba". Se refleja el
  // clic de inmediato y se resincroniza cuando cambia la URL (atrás/adelante, "Limpiar filtros").
  const [soloDisponibles, setSoloDisponibles] = useState(Boolean(stockOnly));
  useEffect(() => { setSoloDisponibles(Boolean(stockOnly)); }, [stockOnly]);
  // Categorías reales del catálogo completo (servidor), con cantidad y sangría para las subcategorías.
  const categoryOptions = [
    { value: '', label: 'Todas', nivel: 0, cantidad: null },
    ...categories.map((c) => ({ value: String(c.id), label: c.nombre, nivel: c.nivel || 0, cantidad: c.cantidad })),
  ];
  const selectedCategory = categoryOptions.find((o) => o.value === String(category || ''));
  const priceErrorId = `${id}-precio-error`;

  // Navegación con flechas dentro del grupo de orden (patrón radiogroup).
  const onOrderKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = ORDER_OPTIONS.findIndex((o) => o.value === order);
    const next = ORDER_OPTIONS[(index + keys[event.key] + ORDER_OPTIONS.length) % ORDER_OPTIONS.length];
    setOrder(next.value);
    event.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus();
  };

  return <div className="filters-panel">
    <div className="filter-group">
      <CampoFlotante id={`${id}-buscar`} type="search" label="Buscar productos" icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} onClear={() => setTerm('')} enterKeyHint="search"/>
    </div>

    <TarjetaFiltro title="Categorías" summary={selectedCategory?.label || 'Todas'}>
          <ul className="filter-categories" aria-label="Categorías">
            {categoryOptions.map(({ value, label, nivel, cantidad }) => {
              const selected = String(category || '') === value;
              return <li key={value || 'todas'} style={nivel ? { '--nivel': nivel } : undefined} className={nivel ? 'is-sub' : undefined}>
                <button type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => setCategory(value)} title={label}>
                  <span className="filter-category-label">{label}</span>{cantidad !== null && <span className="filter-category-count" aria-label={`${cantidad} productos`}>{cantidad}</span>}
                </button>
              </li>;
            })}
          </ul>
    </TarjetaFiltro>

    <TarjetaFiltro title="Ordenar por" summary={ORDER_OPTIONS.find((option) => option.value === order)?.label}>
      <span className="filter-title" id={`${id}-orden`} hidden>Ordenar por</span>
      <div className="filter-order" role="radiogroup" aria-labelledby={`${id}-orden`} onKeyDown={onOrderKeyDown}>
        {ORDER_OPTIONS.map(({ value, label }) => {
          const Icon = ORDER_ICONS[value];
          const checked = order === value;
          return <button key={value} type="button" role="radio" data-value={value} aria-checked={checked} tabIndex={checked ? 0 : -1} title={label} className={`filter-order-option ${checked ? 'is-selected' : ''}`} onClick={() => setOrder(value)}>
            {Icon && <Icon size={15} aria-hidden="true"/>}<span>{label}</span>{checked && <Check className="filter-order-check" size={14} aria-hidden="true"/>}
          </button>;
        })}
      </div>
    </TarjetaFiltro>

    {setMinPrice && setMaxPrice && <TarjetaFiltro title="Precio" summary={minPrice || maxPrice ? `${minPrice ? '$' + minPrice : 'Sin mínimo'} – ${maxPrice ? '$' + maxPrice : 'Sin máximo'}` : 'Todos los precios'}>
      <div className="filter-price-fields">
        <CampoFlotante id={`${id}-precio-min`} label="Mínimo" prefix="$" inputMode="numeric" pattern="[0-9]*" value={minPrice} onChange={(e) => setMinPrice(sanitizePriceInput(e.target.value))} invalid={Boolean(priceError)} describedBy={priceError ? priceErrorId : undefined}/>
        <span className="filter-price-sep" aria-hidden="true">–</span>
        <CampoFlotante id={`${id}-precio-max`} label="Máximo" prefix="$" inputMode="numeric" pattern="[0-9]*" value={maxPrice} onChange={(e) => setMaxPrice(sanitizePriceInput(e.target.value))} invalid={Boolean(priceError)} describedBy={priceError ? priceErrorId : undefined}/>
      </div>
      {priceError && <p className="filter-price-error" id={priceErrorId} role="alert">{priceError}</p>}
    </TarjetaFiltro>}

    <TarjetaFiltro title="Disponibilidad" summary={soloDisponibles ? 'Solo disponibles' : 'Todos los productos'}>
      <label className="stock-filter">
        <span>Solo disponibles</span>
        <input type="checkbox" role="switch" checked={soloDisponibles} onChange={(e) => { setSoloDisponibles(e.target.checked); setStockOnly(e.target.checked); }}/>
        <span className="stock-switch" aria-hidden="true"/>
      </label>
    </TarjetaFiltro>

    <button type="button" className="filter-clear" onClick={onReset} disabled={activeFilters === 0}><RotateCcw size={14} aria-hidden="true"/> Limpiar filtros{activeFilters > 0 && <span className="filter-clear-count">({activeFilters})</span>}</button>
  </div>;
}
