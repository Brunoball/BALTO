import React from 'react';
import { Heart, LayoutGrid, MessageCircle, RotateCcw } from 'lucide-react';
export default function BenefitsSection() {
  const benefits = [
    { icon: LayoutGrid, title: 'Descubrí productos', detail: 'Navegá nuestro catálogo online.' },
    { icon: Heart, title: 'Guardá favoritos', detail: 'Tené a mano lo que te gusta.' },
    { icon: RotateCcw, title: 'Información actualizada', detail: 'Precios y disponibilidad desde el sistema.' },
    { icon: MessageCircle, title: 'Consultá fácilmente', detail: 'Contactá a la tienda cuando quieras.' },
  ];
  return <section className="benefits-section" aria-label="Características de la tienda"><div className="shell benefits-grid">{benefits.map(({icon: Icon,title,detail}) => <div className="benefit" key={title}><span className="benefit-icon"><Icon size={22}/></span><div><strong>{title}</strong><p>{detail}</p></div></div>)}</div></section>;
}
