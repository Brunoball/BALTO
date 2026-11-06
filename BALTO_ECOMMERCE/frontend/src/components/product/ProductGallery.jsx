import React, { useState } from 'react';
import { Picture } from '../common/StateView';

/** Galería con las imágenes reales de la publicación (portada web + archivos de Comercio). */
export default function ProductGallery({ product }) {
  const images = Array.isArray(product.imagenes) && product.imagenes.length
    ? product.imagenes.filter((i) => i && typeof i.url === 'string')
    : (product.imagen_url ? [{ url: product.imagen_url }] : []);
  const [index, setIndex] = useState(0);
  const current = images[index] || images[0] || null;
  return <div className="product-gallery">
    <div className="product-gallery-main"><Picture url={current?.url} alt={current?.alt || product.nombre}/></div>
    {images.length > 1 && <div className="gallery-thumbs" role="list" aria-label="Imágenes del producto">
      {images.map((img, i) => <button key={img.url} type="button" role="listitem" className={i === index ? 'is-active' : ''} aria-label={`Ver imagen ${i + 1} de ${images.length}`} aria-pressed={i === index} onClick={() => setIndex(i)}><Picture url={img.url} alt=""/></button>)}
    </div>}
    <div className="gallery-caption">{current ? 'Imagen de referencia del producto' : 'Imagen no disponible todavía'}</div>
  </div>;
}
