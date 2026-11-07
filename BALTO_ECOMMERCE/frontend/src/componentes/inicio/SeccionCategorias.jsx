import React from 'react';
import { ArrowUpRight, Grid2X2, Layers, Package, Shapes } from 'lucide-react';
import { Link } from 'react-router-dom';
import TituloSeccion from '../global/TituloSeccion';
const icons = [Layers, Shapes, Grid2X2, Package];
export default function SeccionCategorias({ categories }) {
  if (!categories.length) return null;
  return <section className="shell section-space categories-section"><TituloSeccion eyebrow="ENCONTRÁ TU ESTILO" title="Explorá por categoría" description="Elegí una sección y conocé lo que tenemos para vos." action="Ver todo" to="/catalogo"/><div className="category-grid">{categories.slice(0,4).map((category,i) => { const Icon = icons[i]; return <Link className={`category-tile category-tile-${i%4}`} to={`/catalogo?categoria=${encodeURIComponent(category)}`} key={category}><div className="category-tile-ornament"><Icon size={72} strokeWidth={0.8}/></div><span className="category-count-label">COLECCIÓN</span><strong>{category}</strong><span className="category-cta">Explorar <ArrowUpRight size={17}/></span></Link>; })}</div></section>;
}
