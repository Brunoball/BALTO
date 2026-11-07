import React from 'react';
import { Banknote, Clock, CreditCard, Landmark } from 'lucide-react';
import { descripcionMetodo, METODOS } from './utilidades/reglasPago';

const ICONOS = { TRANSFERENCIA_BANCARIA: Landmark, EFECTIVO: Banknote, MERCADO_PAGO: Clock };

/**
 * Tarjetas seleccionables de medio de pago (radiogroup nativo: flechas y Tab funcionan).
 * Solo muestra los métodos que el servidor habilitó para la modalidad de entrega elegida.
 */
function MercadoPagoProximamente() {
  return <div className="payment-card is-disabled" aria-disabled="true" data-testid="payment-mp-soon">
    <span className="payment-card-icon" aria-hidden="true"><CreditCard size={22}/></span>
    <span className="payment-card-text">
      <strong>Mercado Pago <span className="payment-soon">Próximamente</span></strong>
      <small>Tarjetas de crédito, débito y dinero en cuenta. Todavía no está disponible.</small>
    </span>
  </div>;
}

export default function SelectorMedioPago({ metodos, value, onChange, modalidad, disabled, error, idPrefix = 'checkout', mercadoPagoProximamente = false }) {
  if (!metodos.length) {
    return <>
      <p className="payment-empty" role="status">No hay medios de pago disponibles para esta modalidad de entrega. Elegí otra modalidad o comunicate con la tienda.</p>
      {mercadoPagoProximamente && <div className="payment-methods payment-methods-soon"><MercadoPagoProximamente/></div>}
    </>;
  }
  return <div className="payment-methods" role="radiogroup" aria-label="Medio de pago" aria-describedby={error ? `${idPrefix}-metodo_pago-error` : undefined}>
    {metodos.map((m, i) => {
      const Icon = ICONOS[m.codigo] || Landmark;
      const selected = value === m.codigo;
      return <label key={m.codigo} className={`payment-card ${selected ? 'is-selected' : ''}`}>
        <input type="radio" name={`${idPrefix}-metodo_pago`} id={i === 0 ? `${idPrefix}-metodo_pago` : undefined} value={m.codigo}
          checked={selected} disabled={disabled} onChange={() => onChange(m.codigo)}/>
        <span className="payment-card-icon" aria-hidden="true"><Icon size={22}/></span>
        <span className="payment-card-text">
          <strong>{m.codigo === 'EFECTIVO' && modalidad === 'ENVIO' ? 'Efectivo al recibir' : m.codigo === 'EFECTIVO' && modalidad === 'RETIRO' ? 'Efectivo al retirar' : METODOS[m.codigo]?.nombre || m.codigo}</strong>
          <small>{descripcionMetodo(m.codigo, modalidad, m.alcance)}</small>
        </span>
        <span className="payment-card-check" aria-hidden="true"/>
      </label>;
    })}
    {mercadoPagoProximamente && <MercadoPagoProximamente/>}
    {error && <span id={`${idPrefix}-metodo_pago-error`} className="field-error">{error}</span>}
  </div>;
}
