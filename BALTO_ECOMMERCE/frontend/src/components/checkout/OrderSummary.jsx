import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { formatQuantity, lineCents } from '../../utils/cart';
import { precioARS } from '../../utils/format';

/**
 * Resumen del pedido. Solo muestra conceptos que existen en el sistema:
 * no hay costos de envío, impuestos, promociones ni medios de pago configurados,
 * por eso no se presentan como disponibles.
 */
export default function OrderSummary({ config, title = 'Resumen del pedido', children }) {
  const { items, lineState, validacionVigente, validation, subtotal } = useStore();
  const moneda = items[0]?.moneda || config?.moneda || 'ARS';
  const total = validacionVigente && validation.resumen ? Number(validation.resumen.subtotal) : subtotal;
  const modalidades = config?.entrega_modalidades || [];
  return <section className="order-summary" aria-labelledby="order-summary-title">
    <h2 id="order-summary-title">{title}</h2>
    <ul className="order-summary-lines">
      {items.map((x) => {
        const l = lineState(x.key);
        const amount = l?.subtotal ? Number(l.subtotal) : lineCents(x.precio, x.cantidad) / 100;
        return <li key={x.key} className={l && l.estado !== 'OK' ? 'is-problem' : ''}>
          <span>{x.nombre}{x.variante ? ` · ${x.variante}` : ''}<small>{formatQuantity(x.cantidad, x.permite_decimales)} {x.unidad} × {precioARS(x.precio, moneda)}</small></span>
          <strong>{l && l.estado !== 'OK' ? '—' : precioARS(amount, moneda)}</strong>
        </li>;
      })}
    </ul>
    <dl className="order-summary-totals">
      <div><dt>Subtotal</dt><dd data-testid="summary-subtotal">{precioARS(total, moneda)}</dd></div>
      <div><dt>Entrega</dt><dd>{modalidades.length === 1 ? modalidades[0].nombre : 'Según la modalidad elegida'}</dd></div>
      <div className="order-summary-total"><dt>Total</dt><dd data-testid="summary-total">{precioARS(total, moneda)}</dd></div>
    </dl>
    <p className="order-summary-note"><ShieldCheck size={16}/> {validacionVigente ? 'Importes verificados con la tienda. ' : 'Verificando importes con la tienda. '}No se realizan cobros online: la tienda coordinará con vos el pago y, si corresponde, el costo de envío.</p>
    {children}
  </section>;
}
