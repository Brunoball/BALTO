import React from 'react';
import { ArrowUpRight, Mail, MessageCircle, Phone, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { telephoneLink, whatsAppLink } from '../global/utilidades/formato';

// Sitio oficial del desarrollador. Si se completa, "3devs Solutions" se muestra como enlace.
const SITIO_DESARROLLADOR = '';

export default function PiePagina({ config }) {
  const chat = whatsAppLink(config.whatsapp, `Hola, tengo una consulta sobre ${config.nombre || 'la tienda'}.`);
  const phone = telephoneLink(config.telefono);
  return <footer className="site-footer">
    <div className="shell footer-main">
      <div className="footer-brand-col"><div className="footer-brand"><span className="footer-mark"><Store size={21}/></span><strong>{config.nombre || 'Tienda online'}</strong></div><p>{config.descripcion || 'Una manera simple de descubrir nuestros productos y hacer tus consultas.'}</p><span className="footer-note">{config.checkout_habilitado ? 'Pedidos online sin cobro anticipado: la tienda confirma disponibilidad, entrega y pago.' : 'Los pedidos online todavía no están habilitados.'}</span></div>
      <div className="footer-col"><h3>Explorar</h3><Link to="/">Inicio</Link><Link to="/catalogo">Catálogo</Link><Link to="/favoritos">Mis favoritos</Link><Link to="/carrito">Carrito</Link></div>
      <div className="footer-col"><h3>Información</h3><Link to="/contacto">Contacto</Link><span>Precios y stock según el sistema de la tienda</span><span>Disponibilidad según stock actual</span></div>
      <div className="footer-col footer-contact"><h3>Estamos cerca</h3>{chat && <a href={chat} target="_blank" rel="noreferrer"><MessageCircle size={17}/> Consultar por WhatsApp <ArrowUpRight size={14}/></a>}{config.email && <a href={`mailto:${config.email}`}><Mail size={17}/> {config.email}</a>}{phone && <a href={phone}><Phone size={17}/> {config.telefono}</a>}{!chat && !config.email && !phone && <p>Los datos de contacto se publicarán próximamente.</p>}</div>
    </div>
    <div className="shell footer-bottom"><span>© {new Date().getFullYear()} {config.nombre || 'Tienda online'}.</span><span className="footer-credits">Desarrollado por {SITIO_DESARROLLADOR ? <a href={SITIO_DESARROLLADOR} target="_blank" rel="noopener noreferrer">3devs Solutions</a> : <span>3devs Solutions</span>} · Tecnología BALTO</span></div>
  </footer>;
}
