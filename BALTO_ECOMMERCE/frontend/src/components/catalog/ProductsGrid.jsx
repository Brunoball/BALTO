import React from 'react';
import ProductCard from './ProductCard';
export default function ProductsGrid({ products }) {
  return <div className="product-grid">{products.map((product) => <ProductCard key={product.idPublicacion || product.slug} product={product}/>)}</div>;
}
