import React, { useId, useState } from 'react';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, ChevronDown, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import { ORDER_OPTIONS, sanitizePriceInput } from './utilidades/catalogo';

const ORDER_ICONS = { destacados: Sparkles, 'precio-asc': ArrowUpNarrowWide, 'precio-desc': ArrowDownWideNarrow, nombre: ArrowDownAZ };

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

export default function Filtros({
  term, setTerm, order, setOrder, category, setCategory, categories, stockOnly, setStockOnly,
  minPrice = '', setMinPrice, maxPrice = '', setMaxPrice, priceError = null, onReset, activeFilters = 0,
}) {
  const id = useId();
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const categoryOptions = [{ value: 'todas', label: 'Todas' }, ...categories.map((cat) => ({ value: cat, label: cat }))];
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

    <div className={`filter-group filter-accordion ${categoriesOpen ? 'is-open' : ''}`}>
      <h2 className="filter-accordion-heading">
        <button type="button" className="filter-accordion-toggle" aria-expanded={categoriesOpen} aria-controls={`${id}-categorias`} onClick={() => setCategoriesOpen((open) => !open)}>
          <span className="filter-title">Categorías</span>
          {!categoriesOpen && category !== 'todas' && <span className="filter-accordion-current" title={category}>{category}</span>}
          <ChevronDown className="filter-accordion-chevron" size={16} aria-hidden="true"/>
        </button>
      </h2>
      <div className="filter-accordion-panel" id={`${id}-categorias`}>
        <div className="filter-accordion-inner">
          <ul className="filter-categories" aria-label="Categorías">
            {categoryOptions.map(({ value, label }) => <li key={value}>
              <button type="button" className={category === value ? 'selected' : ''} aria-pressed={category === value} onClick={() => setCategory(value)} title={label}>{label}</button>
            </li>)}
          </ul>
        </div>
      </div>
    </div>

    <div className="filter-group">
      <span className="filter-title" id={`${id}-orden`}>Ordenar por</span>
      <div className="filter-order" role="radiogroup" aria-labelledby={`${id}-orden`} onKeyDown={onOrderKeyDown}>
        {ORDER_OPTIONS.map(({ value, label }) => {
          const Icon = ORDER_ICONS[value];
          const checked = order === value;
          return <button key={value} type="button" role="radio" data-value={value} aria-checked={checked} tabIndex={checked ? 0 : -1} title={label} className={`filter-order-option ${checked ? 'is-selected' : ''}`} onClick={() => setOrder(value)}>
            {Icon && <Icon size={15} aria-hidden="true"/>}<span>{label}</span>{checked && <Check className="filter-order-check" size={14} aria-hidden="true"/>}
          </button>;
        })}
      </div>
    </div>

    {setMinPrice && setMaxPrice && <fieldset className="filter-group filter-price">
      <legend className="filter-title">Precio</legend>
      <div className="filter-price-fields">
        <CampoFlotante id={`${id}-precio-min`} label="Mínimo" prefix="$" inputMode="numeric" pattern="[0-9]*" value={minPrice} onChange={(e) => setMinPrice(sanitizePriceInput(e.target.value))} invalid={Boolean(priceError)} describedBy={priceError ? priceErrorId : undefined}/>
        <span className="filter-price-sep" aria-hidden="true">–</span>
        <CampoFlotante id={`${id}-precio-max`} label="Máximo" prefix="$" inputMode="numeric" pattern="[0-9]*" value={maxPrice} onChange={(e) => setMaxPrice(sanitizePriceInput(e.target.value))} invalid={Boolean(priceError)} describedBy={priceError ? priceErrorId : undefined}/>
      </div>
      {priceError && <p className="filter-price-error" id={priceErrorId} role="alert">{priceError}</p>}
    </fieldset>}

    <div className="filter-group">
      <label className="stock-filter">
        <span>Solo disponibles</span>
        <input type="checkbox" role="switch" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)}/>
        <span className="stock-switch" aria-hidden="true"/>
      </label>
    </div>

    <button type="button" className="filter-clear" onClick={onReset} disabled={activeFilters === 0}><RotateCcw size={14} aria-hidden="true"/> Limpiar filtros{activeFilters > 0 && <span className="filter-clear-count">({activeFilters})</span>}</button>
  </div>;
}
