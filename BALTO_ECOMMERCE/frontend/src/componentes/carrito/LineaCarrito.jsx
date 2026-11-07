import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useCarrito } from './contexto/CarritoContext';
import { formatQuantity, lineCents, maxFor, toMilli } from './utilidades/carrito';
import { precioARS } from '../global/utilidades/formato';
import { ImagenProducto } from '../global/Estados';
import SelectorCantidad from '../global/SelectorCantidad';

/** Una línea del carrito: datos locales + estado actual informado por el servidor. */
export default function LineaCarrito({ item, compact = false, onNavigate }) {
  const { changeQuantity, removeItem, lineState } = useCarrito();
  const line = lineState(item.key);
  const href = `/producto/${encodeURIComponent(item.slug)}`;
  const problem = line && line.estado !== 'OK' ? line : null;
  const max = maxFor(item.cantidad_maxima);
  const blocked = problem && ['NO_DISPONIBLE', 'SIN_STOCK', 'VARIANTE_NO_DISPONIBLE', 'VARIANTE_REQUERIDA', 'VARIANTE_INVALIDA'].includes(problem.estado);
  const adjustable = problem?.estado === 'CANTIDAD_EXCEDE_STOCK' && toMilli(problem.cantidad_maxima) > 0;
  const subtotal = lineCents(item.precio, item.cantidad) / 100;
  const unitSuffix = item.permite_decimales ? ` / ${item.unidad}` : '';
  return <article className={`cart-item ${compact ? '' : 'cart-item-full'} ${problem ? 'has-problem' : ''}`} data-testid="cart-line" data-key={item.key}>
    <Link to={href} onClick={onNavigate} className="cart-item-image" tabIndex={-1} aria-hidden="true"><ImagenProducto url={item.imagen_url} alt=""/></Link>
    <div className="cart-item-main">
      <Link to={href} onClick={onNavigate} className="cart-item-title">{item.nombre}</Link>
      {item.variante && <span className="cart-item-variant">Variante: {item.variante}</span>}
      <span className="cart-item-unit">{precioARS(item.precio, item.moneda)}{unitSuffix}</span>
      {problem && <p className={`cart-item-problem ${blocked ? 'is-blocked' : ''}`} role="status"><AlertTriangle size={14}/> {problem.mensaje}
        {adjustable && <button type="button" className="link-button" onClick={() => changeQuantity(item.key, Number(problem.cantidad_maxima))}>Ajustar a {formatQuantity(problem.cantidad_maxima, item.permite_decimales)} {item.unidad}</button>}
      </p>}
      <div className="cart-item-controls">
        <SelectorCantidad compact value={item.cantidad} onChange={(q) => changeQuantity(item.key, q)} permiteDecimales={item.permite_decimales} max={max} unidad={item.unidad} label={`Cantidad de ${item.nombre}`} disabled={Boolean(blocked)}/>
        <strong className="cart-item-subtotal" aria-label={`Subtotal ${precioARS(subtotal, item.moneda)}`}>{precioARS(subtotal, item.moneda)}</strong>
        <button type="button" className="cart-remove" aria-label={`Quitar ${item.nombre}${item.variante ? ` (${item.variante})` : ''}`} onClick={() => removeItem(item.key)}><Trash2 size={17}/></button>
      </div>
    </div>
  </article>;
}
