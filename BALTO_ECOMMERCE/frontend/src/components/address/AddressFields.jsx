import React, { useEffect, useId, useRef, useState } from 'react';
import { Info, LoaderCircle, MapPin, Search } from 'lucide-react';
import { buscarLocalidades, obtenerProvincias } from '../../services/geografiaService';
import { ETIQUETAS } from '../../utils/addressValidation';
import { PAISES, PROVINCIAS_AR, formatoCP, provinciaDesdeCPA } from '../../utils/geografia';

/**
 * Componente ÚNICO de domicilio: se usa en "Mis direcciones" y en el checkout
 * (invitado o con cuenta), con la misma validación (utils/addressValidation.js).
 *
 * Argentina: provincias y localidades del servicio oficial Georef (vía backend),
 * con debounce, sugerencias filtradas por provincia, homónimas diferenciadas por
 * departamento y carga manual siempre posible. El código postal se valida por
 * formato; del CPA solo se deduce la provincia (letra inicial), nunca la localidad.
 */
function Field({ id, label, error, hint, required, children, className = '' }) {
  return <div className={`form-field ${error ? 'has-error' : ''} ${className}`}>
    <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : <span className="optional"> (opcional)</span>}</label>
    {children}
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {error && <span id={`${id}-error`} className="field-error">{error}</span>}
  </div>;
}

function useProvincias(enabled) {
  const [state, setState] = useState({ provincias: PROVINCIAS_AR, fuente: 'LOCAL', cargando: enabled });
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    obtenerProvincias(controller.signal)
      .then((r) => setState({ ...r, cargando: false }))
      .catch((e) => { if (e.name !== 'AbortError') setState({ provincias: PROVINCIAS_AR, fuente: 'LOCAL', cargando: false }); });
    return () => controller.abort();
  }, [enabled]);
  return state;
}

function LocalidadCombobox({ id, value, provinciaId, onSelect, onType, error, disabled, describedBy }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [caido, setCaido] = useState(false);
  const timer = useRef(null);
  const ctrl = useRef(null);
  const typed = useRef(false);

  useEffect(() => () => { clearTimeout(timer.current); ctrl.current?.abort(); }, []);
  useEffect(() => {
    if (!typed.current) return undefined;
    clearTimeout(timer.current);
    const q = String(value || '').trim();
    if (q.length < 2) { setItems([]); setOpen(false); setLoading(false); return undefined; }
    timer.current = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        const r = await buscarLocalidades(q, provinciaId, c.signal);
        if (c.signal.aborted) return;
        setCaido(!r.servicio_disponible);
        setItems(r.localidades.slice(0, 12));
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if (e.name === 'AbortError') return;
        setCaido(true);
        setItems([]);
        setOpen(false);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [value, provinciaId]);

  const pick = (it) => { typed.current = false; onSelect(it); setOpen(false); setItems([]); };
  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };
  const repetidos = new Set(items.map((i) => i.nombre.toLowerCase()).filter((n, i, arr) => arr.indexOf(n) !== i));
  return <div className="combo">
    <div className="combo-input">
      <Search size={15} aria-hidden="true"/>
      <input id={id} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open && items.length > 0} aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} aria-invalid={Boolean(error)} aria-describedby={describedBy}
        autoComplete="address-level2" maxLength={120} disabled={disabled} value={value}
        onChange={(e) => { typed.current = true; onType(e.target.value); }} onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => { if (items.length) setOpen(true); }}/>
      {loading && <LoaderCircle size={15} className="spin combo-spinner" aria-label="Buscando localidades"/>}
    </div>
    {open && items.length > 0 && <ul className="combo-list" role="listbox" id={listId}>
      {items.map((it, i) => <li key={`${it.id}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
        onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
        <MapPin size={14} aria-hidden="true"/>
        <span><strong>{it.nombre}</strong><small>{[repetidos.has(it.nombre.toLowerCase()) || it.departamento ? it.departamento : null, it.provincia].filter(Boolean).join(', ')}</small></span>
      </li>)}
    </ul>}
    {open && !loading && items.length === 0 && String(value || '').trim().length >= 2 && !caido && <p className="combo-empty">Sin sugerencias: podés dejarla escrita así.</p>}
    {caido && <p className="combo-empty" role="status"><Info size={13}/> El buscador de localidades no responde. Escribí la localidad a mano.</p>}
  </div>;
}

export default function AddressFields({
  value, onChange, errors = {}, disabled = false, idPrefix = 'dir',
  destinatario = 'requerido', mostrarEtiqueta = true, paises = ['AR'], legend = null,
}) {
  const pais = (value.pais || 'AR').toUpperCase();
  const esAR = pais === 'AR';
  const prov = useProvincias(esAR);
  const id = (k) => `${idPrefix}-${k}`;
  const desc = (k, hint) => [errors[k] ? `${id(k)}-error` : null, hint ? `${id(k)}-hint` : null].filter(Boolean).join(' ') || undefined;
  const set = (patch) => onChange(patch);
  const sugerida = esAR ? provinciaDesdeCPA(value.codigo_postal) : null;
  const sugerenciaPendiente = sugerida && value.provincia_id !== sugerida.id && value.provincia;
  const inputProps = (k, extra = {}) => ({
    id: id(k), name: k, value: value[k] ?? '', disabled,
    'aria-invalid': Boolean(errors[k]), 'aria-describedby': desc(k, extra.hint),
    onChange: (e) => set({ [k]: e.target.value }),
  });

  // CPA válido y provincia vacía: se completa la provincia (nunca la localidad).
  useEffect(() => {
    if (sugerida && !value.provincia) onChange({ provincia: sugerida.nombre, provincia_id: sugerida.id });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugerida?.id]);

  const provinciaOptions = prov.provincias;
  const provinciaSelect = value.provincia_id || provinciaOptions.find((p) => p.nombre.toLowerCase() === String(value.provincia || '').toLowerCase())?.id || '';
  const cpFormato = value.codigo_postal ? formatoCP(value.codigo_postal, pais) : null;
  const sinNumero = String(value.altura || '').toUpperCase() === 'S/N';

  return <div className="address-fields">
    {legend && <p className="address-legend">{legend}</p>}
    {mostrarEtiqueta && <div className="form-field">
      <span className="field-label" id={id('etiqueta-label')}>Tipo de dirección</span>
      <div className="segmented" role="radiogroup" aria-labelledby={id('etiqueta-label')}>
        {ETIQUETAS.map((e) => <label key={e.codigo} className={value.etiqueta === e.codigo ? 'is-selected' : ''}>
          <input type="radio" name={id('etiqueta')} value={e.codigo} checked={value.etiqueta === e.codigo} disabled={disabled} onChange={() => set({ etiqueta: e.codigo })}/>
          {e.nombre}
        </label>)}
      </div>
    </div>}
    {destinatario !== 'oculto' && <div className="form-grid">
      <Field id={id('destinatario_nombre')} label="Nombre de quien recibe" error={errors.destinatario_nombre} required={destinatario === 'requerido'}>
        <input {...inputProps('destinatario_nombre')} autoComplete="shipping given-name" maxLength={100}/>
      </Field>
      <Field id={id('destinatario_apellido')} label="Apellido de quien recibe" error={errors.destinatario_apellido} required={destinatario === 'requerido'}>
        <input {...inputProps('destinatario_apellido')} autoComplete="shipping family-name" maxLength={100}/>
      </Field>
      <Field id={id('telefono')} label="Teléfono de contacto" error={errors.telefono} required={false} hint="Para coordinar la entrega." className="span-2">
        <input {...inputProps('telefono', { hint: true })} type="tel" autoComplete="shipping tel" maxLength={40}/>
      </Field>
    </div>}
    <div className="form-grid">
      {paises.length > 1
        ? <Field id={id('pais')} label="País" error={errors.pais} required>
          <select {...inputProps('pais')} autoComplete="shipping country" onChange={(e) => set({ pais: e.target.value, provincia: '', provincia_id: '', localidad: '', localidad_id: '' })}>
            {paises.map((p) => <option key={p} value={p}>{PAISES[p] || p}</option>)}
          </select>
        </Field>
        : <div className="form-field"><span className="field-label">País</span><span className="static-value">{PAISES[pais] || pais}</span></div>}
      <Field id={id('codigo_postal')} label="Código postal" error={errors.codigo_postal} required={false}
        hint={esAR ? (cpFormato === 'CPA' ? 'CPA válido.' : cpFormato === 'TRADICIONAL' ? 'Código de 4 números.' : '4 números (5000) o CPA (X5000ABC).') : null}>
        <input {...inputProps('codigo_postal', { hint: esAR })} autoComplete="shipping postal-code" maxLength={10} inputMode="text"
          onChange={(e) => set({ codigo_postal: e.target.value.toUpperCase() })}/>
      </Field>
      {sugerenciaPendiente && <div className="cp-suggestion span-2" role="status">
        <Info size={15}/><span>El CPA {String(value.codigo_postal).toUpperCase()} corresponde a <strong>{sugerida.nombre}</strong>.</span>
        <button type="button" className="link-button" onClick={() => set({ provincia: sugerida.nombre, provincia_id: sugerida.id, localidad_id: '' })}>Usar esta provincia</button>
      </div>}
      <Field id={id('provincia')} label={esAR ? 'Provincia' : 'Provincia / Estado'} error={errors.provincia} required>
        {esAR
          ? <select id={id('provincia')} name="provincia" value={provinciaSelect} disabled={disabled} autoComplete="shipping address-level1"
            aria-invalid={Boolean(errors.provincia)} aria-describedby={desc('provincia')}
            onChange={(e) => {
              const p = provinciaOptions.find((x) => x.id === e.target.value);
              set({ provincia: p ? p.nombre : '', provincia_id: p ? p.id : '', localidad_id: '' });
            }}>
            <option value="">{prov.cargando ? 'Cargando provincias…' : 'Elegí la provincia'}</option>
            {provinciaOptions.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          : <input {...inputProps('provincia')} autoComplete="shipping address-level1" maxLength={120}/>}
      </Field>
      <Field id={id('localidad')} label="Localidad" error={errors.localidad} required hint={esAR ? 'Escribí y elegí de la lista, o dejala escrita a mano.' : null}>
        {esAR
          ? <LocalidadCombobox id={id('localidad')} value={value.localidad || ''} provinciaId={value.provincia_id || provinciaSelect} disabled={disabled}
            error={errors.localidad} describedBy={desc('localidad', true)}
            onType={(v) => set({ localidad: v, localidad_id: '' })}
            onSelect={(it) => set({ localidad: it.nombre, localidad_id: it.id, provincia: it.provincia || value.provincia, provincia_id: it.provincia_id || value.provincia_id })}/>
          : <input {...inputProps('localidad')} autoComplete="shipping address-level2" maxLength={120}/>}
      </Field>
      <Field id={id('calle')} label="Calle" error={errors.calle} required className="span-2-mobile">
        <input {...inputProps('calle')} autoComplete="shipping address-line1" maxLength={150}/>
      </Field>
      <Field id={id('altura')} label="Altura" error={errors.altura} required>
        <div className="altura-row">
          <input {...inputProps('altura')} inputMode="numeric" maxLength={10} disabled={disabled || sinNumero} autoComplete="off"/>
          <label className="check-inline"><input type="checkbox" checked={sinNumero} disabled={disabled} onChange={(e) => set({ altura: e.target.checked ? 'S/N' : '' })}/> Sin número</label>
        </div>
      </Field>
      <Field id={id('piso_depto')} label="Piso / Depto." error={errors.piso_depto} required={false}>
        <input {...inputProps('piso_depto')} autoComplete="shipping address-line2" maxLength={40}/>
      </Field>
      <Field id={id('referencias')} label="Referencias" error={errors.referencias} required={false} hint="Entre calles, color de la puerta, timbre…" className="span-2">
        <input {...inputProps('referencias', { hint: true })} maxLength={300} autoComplete="off"/>
      </Field>
    </div>
  </div>;
}
