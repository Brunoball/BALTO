import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Check, LoaderCircle, MapPin, Package } from 'lucide-react';
import { useCuenta } from './contexto/CuentaContext';
import { actualizarPerfil } from './api/cuentaApi';
import { NAME_RE, telefonoValido } from '../direccion/utilidades/validacionDireccion';
import EstructuraCuenta from './EstructuraCuenta';

function validar(v) {
  const e = {};
  if (!NAME_RE.test(v.nombre.trim())) e.nombre = 'Ingresá tu nombre (solo letras).';
  if (!NAME_RE.test(v.apellido.trim())) e.apellido = 'Ingresá tu apellido (solo letras).';
  if (v.telefono.trim() && !telefonoValido(v.telefono)) e.telefono = 'Ingresá un teléfono válido (con código de área).';
  return e;
}

/** /mi-cuenta — Mis datos (el email verificado por Google es de solo lectura). */
export default function PaginaPerfil() {
  const auth = useCuenta();
  const c = auth.cliente;
  const [values, setValues] = useState({ nombre: c?.nombre || '', apellido: c?.apellido || '', telefono: c?.telefono || '' });
  const [errors, setErrors] = useState({});
  const [estado, setEstado] = useState({ guardando: false, ok: false, error: null });
  useEffect(() => { setValues({ nombre: c?.nombre || '', apellido: c?.apellido || '', telefono: c?.telefono || '' }); }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setValues((s) => ({ ...s, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setEstado((s) => ({ ...s, ok: false })); };
  const submit = async (ev) => {
    ev.preventDefault();
    const e = validar(values);
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) { document.getElementById(`perfil-${first}`)?.focus(); return; }
    setEstado({ guardando: true, ok: false, error: null });
    try {
      const data = await actualizarPerfil({ nombre: values.nombre.trim(), apellido: values.apellido.trim(), telefono: values.telefono.trim() || null });
      auth.actualizarCliente(data.cliente);
      setEstado({ guardando: false, ok: true, error: null });
    } catch (error) {
      if (error.datos?.errores) setErrors(error.datos.errores);
      setEstado({ guardando: false, ok: false, error: error.message });
    }
  };
  const field = (k, label, props = {}) => <div className={`form-field ${errors[k] ? 'has-error' : ''}`}>
    <label htmlFor={`perfil-${k}`}>{label}{props.required !== false ? <span aria-hidden="true"> *</span> : <span className="optional"> (opcional)</span>}</label>
    <input id={`perfil-${k}`} name={k} value={values[k]} onChange={(e) => set(k, e.target.value)} disabled={estado.guardando}
      aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `perfil-${k}-error` : props.hint ? `perfil-${k}-hint` : undefined}
      autoComplete={props.autoComplete} type={props.type || 'text'} maxLength={props.maxLength || 100}/>
    {props.hint && <small id={`perfil-${k}-hint`}>{props.hint}</small>}
    {errors[k] && <span id={`perfil-${k}-error`} className="field-error">{errors[k]}</span>}
  </div>;

  return <EstructuraCuenta title={`Hola, ${c?.nombre || ''}`.trim()} description="Tus datos se usan para completar tus compras más rápido. Podés cambiarlos en cada pedido sin modificar tu perfil.">
    <form className="account-card" onSubmit={submit} noValidate>
      <h2>Mis datos</h2>
      <div className="form-grid">
        {field('nombre', 'Nombre', { autoComplete: 'given-name' })}
        {field('apellido', 'Apellido', { autoComplete: 'family-name' })}
        <div className="form-field">
          <label htmlFor="perfil-email">Email</label>
          <input id="perfil-email" value={c?.email || ''} readOnly aria-describedby="perfil-email-hint" className="is-readonly"/>
          <small id="perfil-email-hint" className="verified-note">{c?.email_verificado && <><BadgeCheck size={13}/> Verificado con Google. </>}No se puede modificar desde la tienda.</small>
        </div>
        {field('telefono', 'Teléfono', { autoComplete: 'tel', type: 'tel', maxLength: 40, required: false, hint: 'Con código de área. Lo pedimos para confirmar pedidos.' })}
      </div>
      {estado.error && <div className="checkout-alert" role="alert">{estado.error}</div>}
      <div className="account-actions">
        {estado.ok && <span className="save-ok" role="status"><Check size={16}/> Datos guardados</span>}
        <button type="submit" className="btn btn-dark" disabled={estado.guardando}>{estado.guardando ? <><LoaderCircle size={17} className="spin"/> Guardando…</> : 'Guardar cambios'}</button>
      </div>
    </form>
    <div className="account-shortcuts">
      <Link to="/mi-cuenta/direcciones" className="account-shortcut"><MapPin size={20}/><span><strong>Mis direcciones</strong><small>Agregá o elegí tu dirección predeterminada.</small></span></Link>
      <Link to="/mi-cuenta/pedidos" className="account-shortcut"><Package size={20}/><span><strong>Mis pedidos</strong><small>Consultá el estado de tus compras.</small></span></Link>
    </div>
  </EstructuraCuenta>;
}
