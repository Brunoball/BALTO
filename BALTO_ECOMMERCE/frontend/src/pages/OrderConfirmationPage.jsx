import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Mail } from 'lucide-react';
import { CONFIRMATION_KEY } from '../hooks/useCheckout';
import { EmptyState } from '../components/common/StateView';
import { formatQuantity } from '../utils/cart';
import { precioARS } from '../utils/format';

function storedOrder() {
  try { return JSON.parse(sessionStorage.getItem(CONFIRMATION_KEY) || 'null'); } catch (_) { return null; }
}

/** Confirmación con los datos que devolvió el servidor (no hay consulta pública de pedidos por número). */
export default function OrderConfirmationPage() {
  const location = useLocation();
  const pedido = useMemo(() => location.state?.pedido || storedOrder(), [location.state]);
  if (!pedido || typeof pedido.numero !== 'string') {
    return <main className="shell standard-page"><EmptyState title="No hay un pedido reciente para mostrar" description="Si ya confirmaste una compra, revisá tu email o comunicate con la tienda."/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Volver al catálogo</Link></div></main>;
  }
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  return <main className="shell standard-page order-confirmation">
    <div className="confirmation-card">
      <span className="confirmation-icon" aria-hidden="true"><Check size={30} strokeWidth={2.6}/></span>
      <span className="eyebrow">PEDIDO RECIBIDO</span>
      <h1>¡Gracias por tu pedido!</h1>
      <p className="confirmation-number">Número de pedido <strong data-testid="order-number">{pedido.numero}</strong></p>
      {pedido.es_prueba && <p className="confirmation-test">Pedido de prueba: no genera ventas, no descuenta stock ni registra pagos.</p>}
      <p>Tu pedido quedó <strong>pendiente de confirmación</strong>. La tienda se comunicará {pedido.comprador_email ? <>a <strong>{pedido.comprador_email}</strong></> : null} para confirmar disponibilidad, coordinar la entrega y el pago. Todavía no se realizó ningún cobro.</p>
      <ul className="order-summary-lines">
        {items.map((it, i) => <li key={i}><span>{it.nombre}{it.variante ? ` · ${it.variante}` : ''}<small>{formatQuantity(it.cantidad, Number(it.cantidad) % 1 !== 0)} × {precioARS(it.precio_unitario, pedido.moneda)}</small></span><strong>{precioARS(it.total, pedido.moneda)}</strong></li>)}
      </ul>
      <dl className="order-summary-totals"><div className="order-summary-total"><dt>Total</dt><dd>{precioARS(pedido.total, pedido.moneda)}</dd></div></dl>
      <p className="confirmation-hint"><Mail size={16}/> Guardá el número de pedido para cualquier consulta.</p>
      <Link to="/catalogo" className="btn btn-dark">Seguir explorando</Link>
    </div>
  </main>;
}
