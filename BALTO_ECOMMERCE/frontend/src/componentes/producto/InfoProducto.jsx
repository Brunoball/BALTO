import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Heart, MessageCircle, ShoppingBag, ShieldCheck } from 'lucide-react';
import { useCarrito } from '../carrito/contexto/CarritoContext';
import { formatQuantity, maxFor, minFor } from '../carrito/utilidades/carrito';
import { precioARS, whatsAppLink } from '../global/utilidades/formato';
import SelectorCantidad from '../global/SelectorCantidad';

export default function InfoProducto({ product, config }) {
  const { addItem, toggleFavorite, favorites } = useCarrito();
  const variants = Array.isArray(product.variantes) ? product.variantes : [];
  const [variantId, setVariantId] = useState(variants.length === 1 && variants[0].disponible ? String(variants[0].idVariante) : '');
  const [quantity, setQuantity] = useState(1);
  const [feedback, setFeedback] = useState(null);
  const selected = variants.find((v) => String(v.idVariante) === variantId);
  const needsVariant = Boolean(product.tiene_variantes || variants.length);
  const src = selected || product;
  const unidad = src.unidad || product.unidad || { abreviatura: 'u', permite_decimales: false };
  const permiteDecimales = Boolean(unidad.permite_decimales);
  const max = maxFor(src.cantidad_maxima);
  const currentPrice = src.precio;
  const available = needsVariant ? Boolean(selected?.disponible) : Boolean(product.disponible);
  const canAdd = available && (!needsVariant || selected) && Number(currentPrice) > 0;
  const favorite = favorites.includes(product.slug);
  const checkout = Boolean(config.checkout_habilitado);
  const contact = whatsAppLink(config.whatsapp, `Hola, quisiera consultar por ${product.nombre}${selected ? ` (${selected.nombre})` : ''}.`);
  const stockLabel = needsVariant && !selected
    ? (product.disponible ? 'Elegí una variante para ver disponibilidad' : 'Sin stock disponible')
    : available ? `Disponible${src.cantidad_maxima ? ` · hasta ${formatQuantity(max, permiteDecimales)} ${unidad.abreviatura}` : ''}` : 'Sin stock disponible';
  const add = () => {
    if (needsVariant && !selected) { setFeedback({ ok: false, text: 'Elegí una variante antes de agregar.' }); return; }
    const r = addItem(product, selected || null, quantity);
    setFeedback(r.ok ? { ok: true, text: r.motivo || 'Agregado al carrito.' } : { ok: false, text: r.motivo });
  };
  return <div className="product-details">
    <span className="eyebrow">{product.categoria || 'PRODUCTOS'}</span>
    <h1>{product.nombre}</h1>
    {(selected?.sku || product.sku) && <p className="product-sku">Código: {selected?.sku || product.sku}</p>}
    <div className="product-pricing"><strong>{needsVariant && !selected ? <>{variants.length > 1 && <small className="price-from">Desde </small>}{precioARS(product.precio, product.moneda)}</> : precioARS(currentPrice, product.moneda)}{permiteDecimales && <small className="price-unit"> / {unidad.abreviatura}</small>}</strong><span className={`stock-status ${available || (needsVariant && !selected && product.disponible) ? 'in-stock' : 'out-stock'}`}>{available ? <Check size={14}/> : null}{stockLabel}</span></div>
    {product.descripcion && <p className="product-description">{product.descripcion}</p>}
    {needsVariant && <div className="detail-field"><label htmlFor="variant-select">Variante <span aria-hidden="true">*</span></label><div className="detail-select"><select id="variant-select" required aria-required="true" value={variantId} onChange={(e) => { setVariantId(e.target.value); setQuantity(1); setFeedback(null); }}><option value="">Seleccioná una variante</option>{variants.map((v) => <option key={v.idVariante} value={v.idVariante} disabled={!v.disponible}>{v.nombre} — {precioARS(v.precio, product.moneda)}{!v.disponible ? ' (sin stock)' : ''}</option>)}</select><ChevronDown size={19}/></div></div>}
    <div className="detail-field"><label htmlFor="product-qty">Cantidad{permiteDecimales ? ` (${unidad.abreviatura})` : ''}</label>
      <SelectorCantidad key={`${variantId}:${permiteDecimales}`} id="product-qty" value={quantity} onChange={setQuantity} permiteDecimales={permiteDecimales} max={max} unidad={unidad.abreviatura} disabled={!available}/>
      {permiteDecimales && <small className="qty-help">Este producto se vende por {unidad.nombre?.toLowerCase() || unidad.abreviatura}: podés indicar decimales (mínimo {formatQuantity(minFor(true), true)}).</small>}
    </div>
    <div className="detail-actions"><button type="button" className="btn btn-dark detail-add" disabled={!canAdd} onClick={add} data-testid="add-to-cart"><ShoppingBag size={19}/> Agregar al carrito</button><button type="button" className={`detail-heart ${favorite ? 'is-favorite' : ''}`} aria-label={favorite ? 'Quitar de favoritos' : 'Guardar en favoritos'} aria-pressed={favorite} onClick={() => toggleFavorite(product.slug)}><Heart size={20} fill={favorite ? 'currentColor' : 'none'}/></button></div>
    {feedback && <p className={`add-feedback ${feedback.ok ? 'is-ok' : 'is-error'}`} role="status">{feedback.text}{feedback.ok && <> <Link to="/carrito">Ver carrito</Link></>}</p>}
    {contact && <a className="detail-whatsapp" href={contact} target="_blank" rel="noreferrer"><MessageCircle size={19}/> Consultar este producto por WhatsApp</a>}
    <p className="detail-disclaimer"><ShieldCheck size={19}/> {checkout
      ? 'Agregar al carrito no reserva stock. Al confirmar el pedido la tienda se comunica para coordinar entrega y pago; no se cobra online.'
      : 'Podés armar tu carrito y consultarnos. La compra online todavía no está habilitada y agregar productos no reserva stock.'}</p>
  </div>;
}
