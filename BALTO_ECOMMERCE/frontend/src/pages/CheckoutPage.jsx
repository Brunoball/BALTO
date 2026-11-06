import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical, ShoppingBag } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useCartSync } from '../hooks/useCartSync';
import { useCheckout } from '../hooks/useCheckout';
import CheckoutForm from '../components/checkout/CheckoutForm';
import OrderSummary from '../components/checkout/OrderSummary';
import CartNotices from '../components/cart/CartNotices';
import { EmptyState } from '../components/common/StateView';

export default function CheckoutPage({ config }) {
  const { items, bloqueos, validacionVigente } = useStore();
  const form = useCheckout(config);
  useCartSync(items.length > 0 && !form.sending);
  if (!items.length) {
    return <main className="shell standard-page"><EmptyState title="No hay productos para comprar" description="Agregá productos al carrito para continuar." icon={ShoppingBag}/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Ir al catálogo</Link></div></main>;
  }
  return <main className="shell standard-page checkout-page">
    <Link to="/carrito" className="back-to-catalog"><ArrowLeft size={16}/> Volver al carrito</Link>
    <div className="page-intro"><span className="eyebrow">COMPRA COMO INVITADO</span><h1>Finalizar pedido<span>.</span></h1><p>No necesitás registrarte. Completá tus datos y la tienda se comunicará para coordinar la entrega y el pago.</p></div>
    {!form.enabled && <div className="checkout-banner" role="status" data-testid="checkout-disabled"><span><strong>La compra online todavía no está habilitada en esta tienda.</strong> Podés revisar tu pedido, pero el botón de confirmación permanece deshabilitado.</span></div>}
    {config.checkout_modo === 'PRUEBA' && <div className="checkout-banner is-test" role="status"><FlaskConical size={17}/> <span><strong>Modo prueba autorizado.</strong> El pedido se registra como prueba (número T-…), no genera ventas, no descuenta stock ni registra pagos.</span></div>}
    {validacionVigente && bloqueos.length > 0 && <div className="checkout-banner is-warning" role="alert"><span>Algunos productos de tu carrito cambiaron. <Link to="/carrito">Revisá el carrito</Link> para continuar.</span></div>}
    <div className="checkout-layout">
      <div><CartNotices/><CheckoutForm form={form}/></div>
      <aside className="cart-page-aside"><OrderSummary config={config}/></aside>
    </div>
  </main>;
}
