import React from 'react';
import { ArrowRight, ArrowUpRight, ShoppingBag, Sparkles, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { precioARS } from '../global/utilidades/formato';
import { ImagenProducto } from '../global/Estados';
export default function SeccionPrincipal({ config, lead }) {
  return <section className="hero-section">
    <div className="shell hero-layout">
      <div className="hero-copy"><div className="hero-kicker"><Sparkles size={15}/> TU ESPACIO ONLINE</div><h1>Todo lo que buscás.<span>En un solo lugar.</span></h1><p>{config.descripcion || 'Descubrí nuestro catálogo, elegí tus favoritos y consultanos por los productos que más te gustan.'}</p><div className="hero-buttons"><Link to="/catalogo" className="btn btn-white">Explorar catálogo <ArrowRight size={19}/></Link><Link to="/contacto" className="btn btn-ghost-light">¿Tenés una consulta? <ArrowUpRight size={18}/></Link></div><div className="hero-footnote"><span className="hero-dot"/> Descubrí nuestra selección online</div></div>
      <div className="hero-visual" aria-label={lead ? `Producto: ${lead.nombre}` : 'Presentación de nuestra tienda'}>
        <div className="hero-orbit hero-orbit-one"/><div className="hero-orbit hero-orbit-two"/>
        <div className="hero-visual-label"><Star size={15}/> EXPLORÁ Y DESCUBRÍ</div>
        {lead ? <Link to={`/producto/${encodeURIComponent(lead.slug)}`} className="hero-product"><div className="hero-product-image"><ImagenProducto url={lead.imagen_url} alt={lead.nombre}/></div><div className="hero-product-text"><span>En nuestro catálogo</span><strong>{lead.nombre}</strong><b>{precioARS(lead.precio, lead.moneda)}</b></div><span className="hero-product-arrow"><ArrowUpRight size={20}/></span></Link> : <div className="hero-placeholder"><div className="hero-bag"><ShoppingBag size={104} strokeWidth={0.95}/></div><span className="hero-placeholder-tag">Elegí · Descubrí · Consultá</span></div>}
        <div className="hero-visual-bottom"><span>UNA EXPERIENCIA SIMPLE</span><span>•</span><span>DISEÑADA PARA VOS</span></div>
      </div>
    </div>
  </section>;
}
