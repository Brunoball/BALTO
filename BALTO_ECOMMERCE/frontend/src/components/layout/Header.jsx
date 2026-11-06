import React, { useEffect, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Heart, Menu, Search, ShoppingBag, Store, X, ArrowUpRight } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { whatsAppLink } from '../../utils/format';
import AnnouncementBar from './AnnouncementBar';

export default function Header({ config }) {
  const { cartOpen, setCartOpen, itemCount, menuOpen, setMenuOpen, favorites } = useStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const contact = whatsAppLink(config.whatsapp, `Hola, quiero consultar sobre ${config.nombre || 'la tienda'}.`);
  useEffect(() => { if (!menuOpen) return; const close = (event) => { if (event.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [menuOpen, setMenuOpen]);
  const submitSearch = (event) => { event.preventDefault(); setMenuOpen(false); navigate(`/catalogo${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`); };
  const closeMenu = () => setMenuOpen(false);
  return <>
    <AnnouncementBar checkout={Boolean(config.checkout_habilitado)}/>
    <header className="site-header">
      <div className="shell header-main">
        <button className="icon-button mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={23}/> : <Menu size={23}/>}</button>
        <Link className="site-brand" to="/" onClick={closeMenu} aria-label="Ir al inicio de la tienda">
          {config.logo_url ? <img src={config.logo_url} alt="" className="brand-logo"/> : <span className="brand-symbol"><Store size={22}/></span>}
          <span className="brand-label">{config.nombre || 'Tienda online'}<small>SHOP ONLINE</small></span>
        </Link>
        <form className="header-search" role="search" onSubmit={submitSearch}><Search size={19}/><input aria-label="Buscar en la página del catálogo" placeholder="¿Qué estás buscando?" value={search} onChange={(e) => setSearch(e.target.value)}/><button type="submit" aria-label="Ir al catálogo con esta búsqueda"><ArrowUpRight size={18}/></button></form>
        <div className="header-tools">
          <Link className="icon-button header-wishlist" to="/favoritos" aria-label={`Mis favoritos (${favorites.length})`}><Heart size={21}/>{favorites.length > 0 && <span className="tiny-indicator"/>}</Link>
          <button className="cart-trigger" type="button" aria-label={`Abrir carrito, ${itemCount} artículos`} aria-expanded={cartOpen} onClick={() => setCartOpen(true)}><ShoppingBag size={21}/><span className="cart-trigger-label">Carrito</span>{itemCount > 0 && <span className="count-bubble">{itemCount}</span>}</button>
        </div>
      </div>
      <div className={`header-navigation ${menuOpen ? 'is-open' : ''}`}>
        <div className="shell nav-row">
          <nav aria-label="Navegación principal" className="main-nav">
            <NavLink end to="/" onClick={closeMenu}>Inicio</NavLink>
            <NavLink to="/catalogo" onClick={closeMenu}>Todos los productos</NavLink>
            <NavLink to="/favoritos" onClick={closeMenu}>Favoritos</NavLink>
            <NavLink to="/carrito" onClick={closeMenu}>Carrito</NavLink>
            <NavLink to="/contacto" onClick={closeMenu}>Contacto</NavLink>
          </nav>
          {contact ? <a href={contact} target="_blank" rel="noreferrer" className="nav-contact">Hablemos por WhatsApp <ArrowUpRight size={15}/></a> : <span className="nav-contact nav-note">Estamos preparando tu experiencia de compra</span>}
        </div>
      </div>
    </header>
  </>;
}
