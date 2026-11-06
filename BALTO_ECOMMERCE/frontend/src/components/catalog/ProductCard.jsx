import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Heart, Plus } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { precioARS } from '../../utils/format';
import { Picture } from '../common/StateView';
export default function ProductCard({ product }) {
  const { favorites, toggleFavorite, addItem } = useStore();
  const favorite = favorites.includes(product.slug);
  // Agregado rápido solo para productos simples por unidad; variantes y fraccionados se eligen en la ficha.
  const canAdd = Boolean(product.disponible && !product.tiene_variantes && !product.unidad?.permite_decimales && Number(product.precio) > 0);
  return <article className="product-card">
    <div className="product-media">
      <Link to={`/producto/${encodeURIComponent(product.slug)}`} className="product-media-link" aria-label={`Ver ${product.nombre}`}><Picture url={product.imagen_url} alt={product.nombre}/></Link>
      <div className="product-badges">{product.destacado && <span className="pill pill-featured">Destacado</span>}{!product.disponible && <span className="pill pill-unavailable">Sin stock</span>}</div>
      <button type="button" className={`favorite-button ${favorite ? 'is-favorite' : ''}`} aria-label={favorite ? `Quitar ${product.nombre} de favoritos` : `Guardar ${product.nombre} en favoritos`} aria-pressed={favorite} onClick={() => toggleFavorite(product.slug)}><Heart size={18} fill={favorite ? 'currentColor' : 'none'}/></button>
      {canAdd && <button type="button" className="quick-add" onClick={() => addItem(product)} aria-label={`Agregar ${product.nombre} al carrito`}><Plus size={18}/> Agregar</button>}
    </div>
    <div className="product-body"><span className="product-category">{product.categoria || 'Colección general'}</span><Link className="product-name" to={`/producto/${encodeURIComponent(product.slug)}`}>{product.nombre}</Link><div className="product-card-footer"><span className="product-price">{product.tiene_variantes && product.variantes?.length > 1 ? <small>Desde </small> : null}{precioARS(product.precio, product.moneda)}{product.unidad?.permite_decimales ? <small> / {product.unidad.abreviatura}</small> : null}</span><Link className="product-detail-arrow" to={`/producto/${encodeURIComponent(product.slug)}`} aria-label={`Ver detalles de ${product.nombre}`}><ArrowUpRight size={20}/></Link></div></div>
  </article>;
}
