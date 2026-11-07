import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ShoppingBag, X } from 'lucide-react';
import { useCarrito } from './contexto/CarritoContext';
import { useSincronizarCarrito } from './hooks/useSincronizarCarrito';
import { formatQuantity } from './utilidades/carrito';
import { precioARS, whatsAppLink } from '../global/utilidades/formato';
import LineaCarrito from './LineaCarrito';
import AvisosCarrito from './AvisosCarrito';

function buildInquiry(items, shopName) {
  const lines = items.map((x) => `• ${x.nombre}${x.variante ? ` (${x.variante})` : ''} x${formatQuantity(x.cantidad, x.permite_decimales)}${x.permite_decimales ? ` ${x.unidad}` : ''} — ${precioARS(x.precio, x.moneda)}${x.permite_decimales ? `/${x.unidad}` : ' c/u'}`);
  return [`Hola, quisiera consultar disponibilidad y condiciones de los siguientes productos de ${shopName || 'la tienda'}:`, '', ...lines, '', 'Entiendo que esta consulta no registra un pedido ni reserva stock.'].join('\n');
}

export default function PanelCarrito({ config }) {
  const { cartOpen, setCartOpen, items, itemCount, subtotal, clearItems, validacionVigente, listoParaComprar, validation } = useCarrito();
  const closeRef = useRef(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useSincronizarCarrito(cartOpen);
  useEffect(() => {
    if (!cartOpen) { setConfirmClear(false); return undefined; }
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e) => { if (e.key === 'Escape') setCartOpen(false); };
    document.addEventListener('keydown', handleKey);
    closeRef.current?.focus();
    return () => { document.body.style.overflow = before; document.removeEventListener('keydown', handleKey); };
  }, [cartOpen, setCartOpen]);
  if (!cartOpen) return null;
  const close = () => setCartOpen(false);
  const checkout = Boolean(config.checkout_habilitado);
  const contact = items.length ? whatsAppLink(config.whatsapp, buildInquiry(items, config.nombre)) : null;
  const currency = items[0]?.moneda || config.moneda || 'ARS';
  const shownSubtotal = validacionVigente && validation.resumen ? Number(validation.resumen.subtotal) : subtotal;
  return <div className="drawer-layer"><button className="drawer-overlay" type="button" aria-label="Cerrar carrito" onClick={close}/>
    <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <div className="drawer-head"><div><span className="eyebrow">TU COMPRA</span><h2 id="cart-title">Carrito <span>({itemCount} {itemCount === 1 ? 'artículo' : 'artículos'})</span></h2></div><button ref={closeRef} className="drawer-close" type="button" onClick={close} aria-label="Cerrar carrito"><X size={22}/></button></div>
      {items.length === 0
        ? <div className="cart-empty"><span><ShoppingBag size={42}/></span><h3>Tu carrito está vacío</h3><p>Encontrá productos que te gusten y agregalos al carrito.</p><Link to="/catalogo" className="btn btn-dark" onClick={close}>Explorar catálogo <ArrowUpRight size={17}/></Link></div>
        : <>
          <div className="cart-list"><AvisosCarrito compact/>{items.map((item) => <LineaCarrito key={item.key} item={item} compact onNavigate={close}/>)}</div>
          <div className="cart-summary">
            <div className="summary-line"><span>Subtotal</span><strong data-testid="drawer-subtotal">{precioARS(shownSubtotal, currency)}</strong></div>
            <p>{validacionVigente ? 'Precios y stock verificados con la tienda. ' : 'Precios guardados en este dispositivo; se verifican con la tienda. '}{checkout ? 'La entrega y el pago se coordinan con la tienda al confirmar el pedido.' : 'La compra online todavía no está habilitada: podés consultarnos por tu selección.'}</p>
            <div className="cart-actions">
              {checkout && (listoParaComprar
                ? <Link to="/checkout" className="btn btn-dark" onClick={close}>Iniciar compra <ArrowUpRight size={18}/></Link>
                : <button type="button" className="btn btn-dark" disabled>Iniciar compra</button>)}
              <Link to="/carrito" className="btn btn-outline" onClick={close}>Ver carrito</Link>
              {!checkout && (contact ? <a className="btn btn-dark cart-inquire" href={contact} target="_blank" rel="noreferrer">Consultar por WhatsApp <ArrowUpRight size={18}/></a> : <div className="cart-no-contact">El contacto de esta tienda todavía no está configurado.</div>)}
            </div>
            {confirmClear
              ? <div className="cart-clear-confirm" role="group" aria-label="Confirmar vaciado"><span>¿Vaciar el carrito?</span><button type="button" onClick={() => { clearItems(); setConfirmClear(false); }}>Sí, vaciar</button><button type="button" onClick={() => setConfirmClear(false)}>Cancelar</button></div>
              : <button type="button" className="cart-clear" onClick={() => setConfirmClear(true)}>Vaciar carrito</button>}
          </div>
        </>}
    </aside></div>;
}
