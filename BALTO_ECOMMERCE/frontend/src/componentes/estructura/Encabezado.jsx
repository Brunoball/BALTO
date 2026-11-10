import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Heart, LayoutGrid, Menu, Search, ShoppingBag, Store, X } from 'lucide-react';
import { useCarrito } from '../carrito/contexto/CarritoContext';
import { whatsAppLink } from '../global/utilidades/formato';
import BarraAnuncios from './BarraAnuncios';
import MenuCuenta, { EnlacesCuentaMovil } from '../cuenta/MenuCuenta';

export default function Encabezado({ config }) {
  const { cartOpen, setCartOpen, itemCount, menuOpen, setMenuOpen, favorites } = useCarrito();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const contact = whatsAppLink(config.whatsapp, `Hola, quiero consultar sobre ${config.nombre || 'la tienda'}.`);
  useEffect(() => { if (!menuOpen) return; const close = (event) => { if (event.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [menuOpen, setMenuOpen]);
  // El menú móvil se cierra al cambiar de página (por ejemplo, desde el panel del carrito).
  useEffect(() => { setMenuOpen(false); }, [location.pathname, setMenuOpen]);
  const submitSearch = (event) => { event.preventDefault(); setMenuOpen(false); navigate(`/catalogo${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`); };
  const closeMenu = () => setMenuOpen(false);
  const searchField = (id) => <form className="header-search" role="search" onSubmit={submitSearch}>
    <Search size={18} aria-hidden="true"/>
    <input id={id} type="search" aria-label="Buscar en la página del catálogo" placeholder="¿Qué estás buscando?" value={search} onChange={(e) => setSearch(e.target.value)}/>
    <button type="submit" aria-label="Ir al catálogo con esta búsqueda"><ArrowUpRight size={17}/></button>
  </form>;
  return <>
    <BarraAnuncios checkout={Boolean(config.checkout_habilitado)}/>
    <header className="site-header">
      <div className="shell header-main">
        <button className="icon-button mobile-menu-toggle" type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={menuOpen} aria-controls="menu-movil" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22}/> : <Menu size={22}/>}</button>
        <Link className="site-brand" to="/" onClick={closeMenu} aria-label="Ir al inicio de la tienda">
          {config.logo_url ? <img src={config.logo_url} alt="" className="brand-logo"/> : <span className="brand-symbol"><Store size={20}/></span>}
          <span className="brand-label">{config.nombre || 'Tienda online'}</span>
        </Link>
        <div className="header-search-desktop">{searchField('busqueda-encabezado')}</div>
        <div className="header-tools">
          <NavLink className="header-link" to="/catalogo" title="Todos los productos"><LayoutGrid size={17} aria-hidden="true"/> Productos</NavLink>
          <MenuCuenta onNavigate={closeMenu}/>
          <Link className="icon-button header-wishlist" to="/favoritos" aria-label={`Mis favoritos (${favorites.length})`}><Heart size={20}/>{favorites.length > 0 && <span className="tiny-indicator"/>}</Link>
          <button className="cart-trigger" type="button" aria-label={`Abrir carrito, ${itemCount} artículos`} aria-expanded={cartOpen} onClick={() => setCartOpen(true)}><ShoppingBag size={20}/>{itemCount > 0 && <span className="count-bubble">{itemCount}</span>}</button>
        </div>
      </div>
      {menuOpen && <>
        <button type="button" className="mobile-panel-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={closeMenu}/>
        <div className="mobile-panel" id="menu-movil">
          <div className="shell mobile-panel-inner">
            {searchField('busqueda-movil')}
            <nav aria-label="Navegación principal" className="mobile-nav">
              <NavLink end to="/" onClick={closeMenu}>Inicio</NavLink>
              <NavLink to="/catalogo" onClick={closeMenu}>Productos</NavLink>
              <NavLink to="/favoritos" onClick={closeMenu}>Favoritos</NavLink>
              <NavLink to="/contacto" onClick={closeMenu}>Contacto</NavLink>
            </nav>
            <EnlacesCuentaMovil onNavigate={closeMenu}/>
            {contact && <a href={contact} target="_blank" rel="noreferrer" className="mobile-contact">Hablemos por WhatsApp <ArrowUpRight size={15}/></a>}
          </div>
        </div>
      </>}
    </header>
  </>;
}
