import React from 'react';
import TarjetaProducto from './TarjetaProducto';
export default function GrillaProductos({ products }) {
  return <div className="product-grid">{products.map((product) => <TarjetaProducto key={product.idPublicacion || product.slug} product={product}/>)}</div>;
}
