import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, MessageCircle, ShoppingBag } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useCartSync } from '../hooks/useCartSync';
import CartLine from '../components/cart/CartLine';
import CartNotices from '../components/cart/CartNotices';
import OrderSummary from '../components/checkout/OrderSummary';
import { EmptyState } from '../components/common/StateView';
import { whatsAppLink } from '../utils/format';

export default function CartPage({ config }) {
  const { items, itemCount, clearItems, listoParaComprar } = useStore();
  const [confirmClear, setConfirmClear] = useState(false);
  useCartSync(true);
  const checkout = Boolean(config.checkout_habilitado);
  const contact = whatsAppLink(config.whatsapp, `Hola, quiero consultar por los productos de mi carrito en ${config.nombre || 'la tienda'}.`);
  return <main className="shell standard-page cart-page">
    <div className="page-intro"><span className="eyebrow">TU COMPRA</span><h1>Carrito<span>.</span></h1><p>{items.length ? `${itemCount} ${itemCount === 1 ? 'artículo' : 'artículos'} en ${items.length} ${items.length === 1 ? 'producto' : 'productos'}. Los precios y el stock se verifican con la tienda.` : 'Todavía no agregaste productos.'}</p></div>
    {items.length === 0
      ? <><EmptyState title="Tu carrito está vacío" description="Explorá el catálogo y agregá los productos que te interesen." icon={ShoppingBag}/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Ver catálogo <ArrowUpRight size={17}/></Link></div></>
      : <div className="cart-layout">
        <section className="cart-page-list" aria-label="Productos en el carrito">
          <CartNotices/>
          {items.map((item) => <CartLine key={item.key} item={item}/>)}
          <div className="cart-page-tools">
            <Link to="/catalogo" className="back-to-catalog"><ArrowLeft size={16}/> Seguir comprando</Link>
            {confirmClear
              ? <div className="cart-clear-confirm" role="group" aria-label="Confirmar vaciado"><span>¿Vaciar el carrito?</span><button type="button" onClick={() => { clearItems(); setConfirmClear(false); }}>Sí, vaciar</button><button type="button" onClick={() => setConfirmClear(false)}>Cancelar</button></div>
              : <button type="button" className="cart-clear inline" onClick={() => setConfirmClear(true)}>Vaciar carrito</button>}
          </div>
        </section>
        <aside className="cart-page-aside">
          <OrderSummary config={config}>
            {checkout
              ? (listoParaComprar
                ? <Link to="/checkout" className="btn btn-dark summary-cta" data-testid="go-checkout">Continuar con la compra <ArrowUpRight size={18}/></Link>
                : <button type="button" className="btn btn-dark summary-cta" disabled data-testid="go-checkout">Continuar con la compra</button>)
              : <div className="checkout-off" data-testid="checkout-off"><strong>La compra online todavía no está habilitada.</strong><span>Podés guardar tu carrito y consultarnos por estos productos.</span>{contact && <a className="btn btn-outline" href={contact} target="_blank" rel="noreferrer"><MessageCircle size={17}/> Consultar por WhatsApp</a>}</div>}
          </OrderSummary>
        </aside>
      </div>}
  </main>;
}
