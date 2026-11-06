import React from 'react';
import { LoaderCircle, Lock } from 'lucide-react';
import { requiresAddress } from '../../utils/checkoutValidation';

function Field({ name, label, form, type = 'text', autoComplete, required = true, maxLength, as = 'input', hint }) {
  const id = `checkout-${name}`;
  const error = form.errors[name];
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  const props = {
    id, name, value: form.values[name], maxLength, autoComplete, required,
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

/** Formulario de compra como invitado. No pide registro ni datos de pago. */
export default function CheckoutForm({ form }) {
  const { modalidades, values, enabled, sending, canSubmit } = form;
  const address = requiresAddress(modalidades, values.modalidad_entrega);
  return <form className="checkout-form" onSubmit={form.submit} noValidate aria-describedby="checkout-legal">
    <fieldset disabled={!enabled || sending}>
      <legend>Tus datos</legend>
      <div className="form-grid">
        <Field name="nombre" label="Nombre" form={form} autoComplete="given-name" maxLength={100}/>
        <Field name="apellido" label="Apellido" form={form} autoComplete="family-name" maxLength={100}/>
        <Field name="email" label="Email" type="email" form={form} autoComplete="email" maxLength={190} hint="Te escribiremos para confirmar el pedido."/>
        <Field name="telefono" label="Teléfono" type="tel" form={form} autoComplete="tel" maxLength={40} hint="Con código de área, por ejemplo 351 555 0000."/>
      </div>
    </fieldset>
    <fieldset disabled={!enabled || sending}>
      <legend>Entrega</legend>
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
      {address && <div className="form-grid">
        <Field name="direccion" label="Dirección" form={form} autoComplete="street-address" maxLength={255}/>
        <Field name="localidad" label="Localidad" form={form} autoComplete="address-level2" maxLength={120}/>
        <Field name="provincia" label="Provincia" form={form} autoComplete="address-level1" maxLength={120} required={false}/>
        <Field name="codigo_postal" label="Código postal" form={form} autoComplete="postal-code" maxLength={20} required={false}/>
      </div>}
      <Field name="observaciones" label="Observaciones" as="textarea" form={form} required={false} maxLength={1000} hint="Horarios, referencias o cualquier aclaración para la tienda."/>
    </fieldset>
    {/* Campo trampa para bots: invisible para personas y lectores de pantalla. */}
    <div className="hp-field" aria-hidden="true"><label htmlFor="checkout-website">Sitio web</label><input id="checkout-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => form.setWebsite(e.target.value)}/></div>
    {form.serverError && <div className="checkout-alert" role="alert" data-testid="checkout-error">{form.serverError.mensaje}</div>}
    <button type="submit" className="btn btn-dark checkout-submit" disabled={!canSubmit} aria-disabled={!canSubmit} data-testid="checkout-submit">
      {sending ? <><LoaderCircle size={18} className="spin"/> Registrando pedido…</> : <><Lock size={17}/> Confirmar pedido</>}
    </button>
    <p id="checkout-legal" className="checkout-legal">Al confirmar registramos tu pedido como <strong>pendiente</strong>. No se realiza ningún cobro ni se reserva stock: la tienda se comunicará para confirmar disponibilidad, entrega y forma de pago.</p>
  </form>;
}
