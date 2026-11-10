import React from 'react';
import TarjetaProducto from './TarjetaProducto';

export default function GrillaProductos({ products }) {
  return <div className="product-grid">{products.map((product, i) => <TarjetaProducto key={product.idPublicacion || product.slug} product={product} prioridad={i < 4}/>)}</div>;
}

/** Tarjetas "fantasma" con el mismo tamaño que las reales mientras llega la primera carga. */
export function GrillaEsqueleto({ cantidad = 8 }) {
  return <div className="product-grid" role="status" aria-live="polite" aria-label="Cargando productos">
    {Array.from({ length: cantidad }, (_, i) => <div key={i} className="product-card is-skeleton" aria-hidden="true">
      <div className="product-media"><span className="skeleton-block"/></div>
      <div className="product-body"><span className="skeleton-block skeleton-line is-short"/><span className="skeleton-block skeleton-line"/><span className="skeleton-block skeleton-line is-price"/></div>
    </div>)}
    <span className="sr-only">Buscando productos…</span>
  </div>;
}
