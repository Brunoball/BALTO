import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Heart, Plus } from 'lucide-react';
import { useCarrito } from '../carrito/contexto/CarritoContext';
import { precioARS } from '../global/utilidades/formato';
import { ImagenProducto } from '../global/Estados';
export default function TarjetaProducto({ product, prioridad = false }) {
  const { favorites, toggleFavorite, addItem } = useCarrito();
  const favorite = favorites.includes(product.slug);
  const href = `/producto/${encodeURIComponent(product.slug)}`;
  // La ficha se abre al instante con los datos que ya tenemos y se actualiza sola con precio/stock del momento.
  const state = { producto: product };
  const categoria = product.categoria || 'Colección general';
  const hasPrice = product.precio !== undefined && product.precio !== null && product.precio !== '' && Number(product.precio) >= 0;
  // Agregado rápido solo para productos simples por unidad; variantes y fraccionados se eligen en la ficha.
  const canAdd = Boolean(product.disponible && !product.tiene_variantes && !product.unidad?.permite_decimales && Number(product.precio) > 0);
  return <article className="product-card">
    <div className="product-media">
      <Link to={href} state={state} className="product-media-link" aria-label={`Ver ${product.nombre}`}><ImagenProducto url={product.imagen_url} alt={product.nombre} prioridad={prioridad}/></Link>
      <div className="product-badges">{product.destacado && <span className="pill pill-featured">Destacado</span>}{!product.disponible && <span className="pill pill-unavailable">Sin stock</span>}</div>
      <button type="button" className={`favorite-button ${favorite ? 'is-favorite' : ''}`} aria-label={favorite ? `Quitar ${product.nombre} de favoritos` : `Guardar ${product.nombre} en favoritos`} aria-pressed={favorite} onClick={() => toggleFavorite(product.slug)}><Heart size={18} fill={favorite ? 'currentColor' : 'none'}/></button>
      {canAdd && <button type="button" className="quick-add" onClick={() => addItem(product)} aria-label={`Agregar ${product.nombre} al carrito`}><Plus size={18}/> <span className="quick-add-label">Agregar</span></button>}
    </div>
    <div className="product-body">
      <span className="product-category" title={categoria}>{categoria}</span>
      <Link className="product-name" to={href} state={state} title={product.nombre}>{product.nombre}</Link>
      <div className="product-card-footer">
        <span className="product-price">{hasPrice && product.tiene_variantes && product.variantes?.length > 1 ? <small>Desde </small> : null}{precioARS(product.precio, product.moneda)}{hasPrice && product.unidad?.permite_decimales ? <small> / {product.unidad.abreviatura}</small> : null}</span>
        <Link className="product-detail-arrow" to={href} state={state} aria-label={`Ver detalles de ${product.nombre}`}><ArrowUpRight size={20}/></Link>
      </div>
    </div>
  </article>;
}
