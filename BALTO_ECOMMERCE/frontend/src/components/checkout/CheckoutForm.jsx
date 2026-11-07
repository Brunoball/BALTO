import React from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, LoaderCircle, Lock, MapPin, Plus } from 'lucide-react';
import AddressFields from '../address/AddressFields';
import PaymentMethodSelector from '../payment/PaymentMethodSelector';
import BankTransferDetails from '../payment/BankTransferDetails';
import { addressCity, addressLine } from '../../utils/addressValidation';

function Field({ name, label, form, type = 'text', autoComplete, required = true, maxLength, as = 'input', hint, readOnly = false }) {
  const id = `checkout-${name}`;
  const error = form.errors[name];
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  const props = {
    id, name, value: form.values[name], maxLength, autoComplete, required, readOnly,
    className: readOnly ? 'is-readonly' : undefined,
    disabled: !form.enabled || form.sending,
    'aria-invalid': Boolean(error), 'aria-describedby': describedBy,
    onChange: (e) => form.setField(name, e.target.value),
    onBlur: () => form.validateField(name),
  };
  return <div className={`form-field ${error ? 'has-error' : ''}`}>
    <label htmlFor={id}>{label}{required ? <span aria-hidden="true"> *</span> : <span className="optional"> (opcional)</span>}</label>
    {as === 'textarea' ? <textarea rows={3} {...props}/> : <input type={type} {...props}/>}
    {hint && <small id={`${id}-hint`}>{hint}</small>}
    {error && <span id={`${id}-error`} className="field-error">{error}</span>}
  </div>;
}

/** Errores del domicilio (prefijo entrega_) con las claves que usa AddressFields. */
function addressErrors(errors) {
  const out = {};
  for (const [k, v] of Object.entries(errors || {})) if (k.startsWith('entrega_') && v) out[k.slice(8)] = v;
  return out;
}

function SavedAddresses({ form }) {
  const { direcciones, values } = form;
  if (direcciones.cargando) return <p className="delivery-single"><LoaderCircle size={15} className="spin"/> Cargando tus direcciones…</p>;
  if (!direcciones.lista.length) return null;
  const sel = values.id_direccion ? Number(values.id_direccion) : '';
  return <div className="saved-addresses" role="radiogroup" aria-label="Dirección de entrega" aria-describedby={form.errors.id_direccion ? 'checkout-id_direccion-error' : undefined}>
    {direcciones.lista.map((d, i) => <label key={d.id} className={`delivery-option ${sel === d.id ? 'is-selected' : ''}`}>
      <input type="radio" id={i === 0 ? 'checkout-id_direccion' : undefined} name="id_direccion" checked={sel === d.id} onChange={() => form.setField('id_direccion', d.id)}/>
      <span><strong><MapPin size={13}/> {addressLine(d)}{d.predeterminada ? ' · Predeterminada' : ''}</strong>
        <small>{addressCity(d)} — Recibe {d.destinatario_nombre} {d.destinatario_apellido}</small></span>
    </label>)}
    <label className={`delivery-option ${sel === '' ? 'is-selected' : ''}`}>
      <input type="radio" name="id_direccion" checked={sel === ''} onChange={() => form.setField('id_direccion', '')}/>
      <span><strong><Plus size={13}/> Usar otra dirección</strong><small>Solo para esta compra, o guardala para la próxima.</small></span>
    </label>
    {form.errors.id_direccion && <span id="checkout-id_direccion-error" className="field-error">{form.errors.id_direccion}</span>}
    <Link to="/mi-cuenta/direcciones" className="muted-link">Administrar mis direcciones</Link>
  </div>;
}

/** Formulario de compra: invitado o con cuenta. No pide registro ni datos de pago. */
export default function CheckoutForm({ form }) {
  const { modalidades, values, enabled, sending, canSubmit, cliente, conDireccion, opciones } = form;
  const usaGuardada = Boolean(cliente && values.id_direccion);
  const disabled = !enabled || sending;
  return <form className="checkout-form" onSubmit={form.submit} noValidate aria-describedby="checkout-legal">
    <fieldset disabled={disabled}>
      <legend>{form.pagosOn ? '1. ' : ''}Tus datos</legend>
      <div className="form-grid">
        <Field name="nombre" label="Nombre" form={form} autoComplete="given-name" maxLength={100}/>
        <Field name="apellido" label="Apellido" form={form} autoComplete="family-name" maxLength={100}/>
        <Field name="email" label="Email" type="email" form={form} autoComplete="email" maxLength={190} readOnly={Boolean(cliente)}
          hint={cliente ? 'Email de tu cuenta (verificado con Google).' : 'Te escribiremos para confirmar el pedido.'}/>
        <Field name="telefono" label="Teléfono" type="tel" form={form} autoComplete="tel" maxLength={40} hint="Con código de área, por ejemplo 351 555 0000."/>
      </div>
      {cliente && <p className="account-inline-note"><BadgeCheck size={14}/> Comprás con tu cuenta. Los cambios en estos datos se usan solo para este pedido.</p>}
      {cliente && !cliente.telefono && <label className="check-inline"><input type="checkbox" checked={opciones.guardar_telefono} onChange={(e) => form.setOpcion('guardar_telefono', e.target.checked)}/> Guardar este teléfono en mi perfil</label>}
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>{form.pagosOn ? '2. ' : ''}Entrega</legend>
      {modalidades.length > 1
        ? <div className="delivery-options" role="radiogroup" aria-labelledby="delivery-label" aria-describedby={form.errors.modalidad_entrega ? 'checkout-modalidad_entrega-error' : undefined}>
          <span id="delivery-label" className="sr-only">Modalidad de entrega</span>
          {modalidades.map((m, i) => <label key={m.codigo} className={`delivery-option ${values.modalidad_entrega === m.codigo ? 'is-selected' : ''}`}>
            <input type="radio" id={i === 0 ? 'checkout-modalidad_entrega' : undefined} name="modalidad_entrega" value={m.codigo} checked={values.modalidad_entrega === m.codigo} onChange={() => form.setField('modalidad_entrega', m.codigo)}/>
            <span><strong>{m.nombre}</strong>{m.detalle && <small>{m.detalle}</small>}</span>
          </label>)}
          {form.errors.modalidad_entrega && <span id="checkout-modalidad_entrega-error" className="field-error">{form.errors.modalidad_entrega}</span>}
        </div>
        : <p className="delivery-single"><strong>{modalidades[0]?.nombre || 'A coordinar con la tienda'}</strong>{modalidades[0]?.detalle ? ` — ${modalidades[0].detalle}` : ''}</p>}
      {conDireccion && <div className="checkout-address">
        {cliente && <SavedAddresses form={form}/>}
        {!usaGuardada && <>
          <label className="check-inline"><input type="checkbox" checked={opciones.otroDestinatario} onChange={(e) => form.setOpcion('otroDestinatario', e.target.checked)}/> Recibe otra persona</label>
          <AddressFields value={values.entrega} onChange={form.setEntrega} errors={addressErrors(form.errors)} disabled={disabled} idPrefix="entrega"
            destinatario={opciones.otroDestinatario ? 'opcional' : 'oculto'} mostrarEtiqueta={false} paises={form.paises}/>
          {cliente && <label className="check-inline"><input type="checkbox" checked={opciones.guardar_direccion} onChange={(e) => form.setOpcion('guardar_direccion', e.target.checked)}/> Guardar esta dirección en mi cuenta para próximas compras</label>}
        </>}
      </div>}
      <Field name="observaciones" label="Observaciones" as="textarea" form={form} required={false} maxLength={1000} hint="Horarios, referencias o cualquier aclaración para la tienda."/>
    </fieldset>
    {form.pagosOn && <fieldset disabled={disabled} className="payment-fieldset">
      <legend>3. Medio de pago</legend>
      <PaymentMethodSelector metodos={form.metodosPago} value={values.metodo_pago} modalidad={form.modalidadActual} disabled={disabled}
        error={form.errors.metodo_pago} onChange={(m) => form.setField('metodo_pago', m)}
        mercadoPagoProximamente={Boolean(form.mercadoPagoProximamente)}/>
      {values.metodo_pago === 'TRANSFERENCIA_BANCARIA' && form.cuentaBancaria && <div className="payment-preview">
        <p><strong>Transferencia bancaria.</strong> Realizá una transferencia a la cuenta del comercio. Una vez realizada, adjuntá el comprobante para que podamos verificar el pago. Podés hacerlo después de confirmar el pedido.</p>
        <BankTransferDetails destino={form.cuentaBancaria} importe={form.totalEsperado} alcance={form.metodoInfo?.alcance} compact/>
      </div>}
      {values.metodo_pago === 'EFECTIVO' && form.modalidadActual === 'ENVIO' && <p className="payment-note">Pagás en efectivo al recibir tu compra. La tienda debe confirmar previamente la disponibilidad y las condiciones de entrega.</p>}
    </fieldset>}
    {/* Campo trampa para bots: invisible para personas y lectores de pantalla. */}
    <div className="hp-field" aria-hidden="true"><label htmlFor="checkout-website">Sitio web</label><input id="checkout-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => form.setWebsite(e.target.value)}/></div>
    {form.serverError && <div className="checkout-alert" role="alert" data-testid="checkout-error">{form.serverError.mensaje}</div>}
    <button type="submit" className="btn btn-dark checkout-submit" disabled={!canSubmit} aria-disabled={!canSubmit} data-testid="checkout-submit">
      {sending ? <><LoaderCircle size={18} className="spin"/> Registrando pedido…</> : <><Lock size={17}/> Confirmar pedido</>}
    </button>
    <p id="checkout-legal" className="checkout-legal">{form.pagosOn
      ? <>Al confirmar registramos tu pedido como <strong>pendiente</strong>. No se realiza ningún cobro automático ni se reserva stock: la tienda confirma disponibilidad y verifica el pago.</>
      : <>Al confirmar registramos tu pedido como <strong>pendiente</strong>. No se realiza ningún cobro ni se reserva stock: la tienda se comunicará para confirmar disponibilidad, entrega y forma de pago.</>}</p>
  </form>;
}
