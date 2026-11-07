import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Check, Mail, Package } from 'lucide-react';
import { CONFIRMATION_KEY } from '../hooks/useCheckout';
import { EmptyState } from '../components/common/StateView';
import PaymentStatus from '../components/payment/PaymentStatus';
import { detallePago, leerAutorizacion } from '../services/paymentService';
import { formatQuantity } from '../utils/cart';
import { precioARS } from '../utils/format';
import { modalidadEntrega } from '../utils/orderStatus';
import { METODOS } from '../utils/paymentRules';

function storedOrder() {
  try { return JSON.parse(sessionStorage.getItem(CONFIRMATION_KEY) || 'null'); } catch (_) { return null; }
}

function mensajeMetodo(metodo, modalidad) {
  if (metodo === 'TRANSFERENCIA_BANCARIA') return 'Elegiste transferencia bancaria.';
  if (metodo === 'EFECTIVO' && modalidad === 'RETIRO') return 'Elegiste pagar en efectivo al retirar tu compra. La tienda confirmará cuándo estará listo para retirar.';
  if (metodo === 'EFECTIVO' && modalidad === 'ENVIO') return 'Elegiste pagar en efectivo cuando recibas tu compra. La tienda se comunicará para confirmar las condiciones de entrega.';
  if (metodo === 'EFECTIVO') return 'Elegiste pagar en efectivo. La tienda se comunicará para coordinar la entrega.';
  return null;
}

/**
 * Confirmación. El resumen viene de la respuesta del checkout; el ESTADO DEL PAGO
 * se consulta al servidor (nunca se da por pagado según datos del navegador).
 */
export default function OrderConfirmationPage() {
  const location = useLocation();
  const pedido = useMemo(() => location.state?.pedido || storedOrder(), [location.state]);
  const numero = typeof pedido?.numero === 'string' ? pedido.numero : null;
  const token = numero ? leerAutorizacion(numero) : null;
  // Si se puede consultar al servidor, el estado del pago se muestra SOLO con su respuesta
  // (lo guardado en el navegador puede estar desactualizado).
  const consultable = Boolean(numero && pedido?.pago && (token || pedido?.cuenta));
  const [pago, setPago] = useState(consultable ? null : pedido?.pago || null);
  const [pagoError, setPagoError] = useState(null);

  useEffect(() => {
    if (!consultable) return undefined;
    const c = new AbortController();
    detallePago(numero, token, c.signal)
      .then((d) => setPago(d.pago))
      .catch((e) => { if (e.name !== 'AbortError') { setPagoError(e); setPago(pedido.pago); } });
    return () => c.abort();
  }, [consultable, numero, token, pedido]);

  if (!numero) {
    return <main className="shell standard-page"><EmptyState title="No hay un pedido reciente para mostrar" description="Si ya confirmaste una compra, revisá tu email o comunicate con la tienda."/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Volver al catálogo</Link></div></main>;
  }
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  const metodo = pago?.metodo || pedido.metodo_pago || pedido.pago?.metodo || null;
  const msgMetodo = mensajeMetodo(metodo, pedido.modalidad_entrega);
  const puedeGestionar = Boolean(token || pedido.cuenta);
  return <main className="shell standard-page order-confirmation">
    <div className="confirmation-card">
      <span className="confirmation-icon" aria-hidden="true"><Check size={30} strokeWidth={2.6}/></span>
      <span className="eyebrow">PEDIDO RECIBIDO</span>
      <h1>{metodo ? '¡Tu pedido fue registrado!' : '¡Gracias por tu pedido!'}</h1>
      <p className="confirmation-number">Número de pedido <strong data-testid="order-number">{pedido.numero}</strong></p>
      {pedido.es_prueba && <p className="confirmation-test">Pedido de prueba: no genera ventas, no descuenta stock ni registra pagos.</p>}
      {metodo
        ? <>
          {msgMetodo && <p data-testid="payment-message">{msgMetodo}</p>}
          <p>Tu pedido quedó <strong>pendiente de confirmación</strong>{pedido.comprador_email ? <> y te escribiremos a <strong>{pedido.comprador_email}</strong></> : null}.</p>
          <dl className="confirmation-facts">
            <div><dt>Medio de pago</dt><dd>{METODOS[metodo]?.nombre || metodo}</dd></div>
            <div><dt>Entrega</dt><dd>{modalidadEntrega(pedido.modalidad_entrega)}</dd></div>
          </dl>
        </>
        : <p>Tu pedido quedó <strong>pendiente de confirmación</strong>. La tienda se comunicará {pedido.comprador_email ? <>a <strong>{pedido.comprador_email}</strong></> : null} para confirmar disponibilidad, coordinar la entrega y el pago. Todavía no se realizó ningún cobro.</p>}
      {consultable && !pago && !pagoError && <p className="confirmation-hint" role="status">Consultando el estado del pago…</p>}
      {pago && (puedeGestionar || pago.metodo === 'EFECTIVO') && <div className="confirmation-payment"><PaymentStatus numero={numero} pago={pago} modalidad={pedido.modalidad_entrega} token={token} onChange={setPago}/></div>}
      {pago?.metodo === 'TRANSFERENCIA_BANCARIA' && !puedeGestionar && <p className="confirmation-test">Para enviar el comprobante usá la misma pestaña en la que hiciste la compra o comunicate con la tienda indicando tu número de pedido.</p>}
      {pagoError && pagoError.status === 401 && <p className="confirmation-test">El permiso para enviar el comprobante desde este navegador venció. Comunicate con la tienda indicando tu número de pedido.</p>}
      <ul className="order-summary-lines">
        {items.map((it, i) => <li key={i}><span>{it.nombre}{it.variante ? ` · ${it.variante}` : ''}<small>{formatQuantity(it.cantidad, Number(it.cantidad) % 1 !== 0)} × {precioARS(it.precio_unitario, pedido.moneda)}</small></span><strong>{precioARS(it.total, pedido.moneda)}</strong></li>)}
      </ul>
      <dl className="order-summary-totals"><div className="order-summary-total"><dt>{pedido.modalidad_entrega === 'ENVIO' ? 'Total productos' : 'Total'}</dt><dd>{precioARS(pedido.total, pedido.moneda)}</dd></div></dl>
      {pedido.modalidad_entrega === 'ENVIO' && <p className="confirmation-hint">El costo de envío no está incluido: la tienda te lo informará.</p>}
      {pedido.perfil?.direccion_guardada && <p className="confirmation-hint"><Check size={16}/> Guardamos la dirección en tu cuenta.</p>}
      <p className="confirmation-hint"><Mail size={16}/> {pedido.cuenta ? 'Podés seguir este pedido desde tu cuenta.' : 'Guardá el número de pedido para cualquier consulta.'}</p>
      <div className="confirmation-actions">
        {pedido.cuenta && <Link to={`/mi-cuenta/pedidos/${encodeURIComponent(pedido.numero)}`} className="btn btn-outline"><Package size={17}/> Ver en mis pedidos</Link>}
        <Link to="/catalogo" className="btn btn-dark">Seguir explorando</Link>
      </div>
    </div>
  </main>;
}
