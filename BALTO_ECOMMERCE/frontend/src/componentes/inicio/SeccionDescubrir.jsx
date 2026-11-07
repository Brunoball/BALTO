import React from 'react';
import { ArrowRight, HeartHandshake, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
export default function SeccionDescubrir() {
  return <section className="shell discovery-section"><div className="discovery-copy"><span className="eyebrow eyebrow-light"><Sparkles size={14}/> UNA FORMA MÁS SIMPLE</span><h2>Tus próximos favoritos están más cerca.</h2><p>Explorá nuestro catálogo, guardá lo que te interesa y escribinos para conocer los detalles de cada producto.</p><Link to="/catalogo" className="btn btn-white">Conocer productos <ArrowRight size={18}/></Link></div><div className="discovery-art" aria-hidden="true"><span className="discovery-circle one"/><span className="discovery-circle two"/><span className="discovery-emblem"><HeartHandshake size={72} strokeWidth={1.1}/></span></div></section>;
}
