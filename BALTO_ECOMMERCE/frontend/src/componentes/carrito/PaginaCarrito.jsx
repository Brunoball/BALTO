import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, MessageCircle, ShoppingBag, Trash2 } from 'lucide-react';
import { useCarrito } from './contexto/CarritoContext';
import { useSincronizarCarrito } from './hooks/useSincronizarCarrito';
import LineaCarrito from './LineaCarrito';
import AvisosCarrito from './AvisosCarrito';
import ResumenPedido from '../checkout/ResumenPedido';
import { EstadoVacio } from '../global/Estados';
import { whatsAppLink } from '../global/utilidades/formato';

export default function PaginaCarrito({ config }) {
  const { items, itemCount, clearItems, listoParaComprar } = useCarrito();
  const [confirmClear, setConfirmClear] = useState(false);
  useSincronizarCarrito(true);
  const checkout = Boolean(config.checkout_habilitado);
  const contact = whatsAppLink(config.whatsapp, `Hola, quiero consultar por los productos de mi carrito en ${config.nombre || 'la tienda'}.`);
  return <main className="shell standard-page cart-page">
    <div className="page-intro"><span className="eyebrow">TU COMPRA</span><h1>Carrito<span>.</span></h1><p>{items.length ? `${itemCount} ${itemCount === 1 ? 'artículo' : 'artículos'} en ${items.length} ${items.length === 1 ? 'producto' : 'productos'}. Los precios y el stock se verifican con la tienda.` : 'Todavía no agregaste productos.'}</p></div>
    {items.length === 0
      ? <><EstadoVacio title="Tu carrito está vacío" description="Explorá el catálogo y agregá los productos que te interesen." icon={ShoppingBag}/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Ver catálogo <ArrowUpRight size={17}/></Link></div></>
      : <div className="cart-layout">
        <section className="cart-page-list" aria-label="Productos en el carrito">
          <div className="cart-list-heading"><span className="cart-section-icon"><ShoppingBag size={19} aria-hidden="true"/></span><h2>Tus productos</h2><span className="cart-items-badge">{itemCount} {itemCount === 1 ? 'artículo' : 'artículos'}</span></div>
          <AvisosCarrito/>
          {items.map((item) => <LineaCarrito key={item.key} item={item}/>)}
          <div className="cart-page-tools">
            <Link to="/catalogo" className="back-to-catalog"><ArrowLeft size={16}/> Seguir comprando</Link>
            {confirmClear
              ? <div className="cart-clear-confirm" role="group" aria-label="Confirmar vaciado"><span>¿Vaciar el carrito?</span><button type="button" onClick={() => { clearItems(); setConfirmClear(false); }}>Sí, vaciar</button><button type="button" onClick={() => setConfirmClear(false)}>Cancelar</button></div>
              : <button type="button" className="cart-clear inline" onClick={() => setConfirmClear(true)}><Trash2 size={14} aria-hidden="true"/> Vaciar carrito</button>}
          </div>
        </section>
        <aside className="cart-page-aside">
          <ResumenPedido config={config} destacado>
            {checkout
              ? (listoParaComprar
                ? <Link to="/checkout" className="btn btn-dark summary-cta" data-testid="go-checkout">Continuar con la compra <ArrowUpRight size={18}/></Link>
                : <button type="button" className="btn btn-dark summary-cta" disabled data-testid="go-checkout">Continuar con la compra</button>)
              : <div className="checkout-off" data-testid="checkout-off"><strong>La compra online todavía no está habilitada.</strong><span>Podés guardar tu carrito y consultarnos por estos productos.</span>{contact && <a className="btn btn-outline" href={contact} target="_blank" rel="noreferrer"><MessageCircle size={17}/> Consultar por WhatsApp</a>}</div>}
          </ResumenPedido>
        </aside>
      </div>}
  </main>;
}
