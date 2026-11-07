import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LoaderCircle, LogIn, LogOut, MapPin, Package, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { loginPath } from '../../utils/safeRedirect';

export function initials(cliente) {
  const a = String(cliente?.nombre || '').trim()[0] || '';
  const b = String(cliente?.apellido || '').trim()[0] || '';
  return (a + b).toUpperCase() || 'U';
}

/** Acceso a la cuenta en el header: "Ingresar" o menú con Mi cuenta / Direcciones / Pedidos / Cerrar sesión. */
export default function AccountMenu({ onNavigate }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(wrapRef.current?.querySelectorAll('[role="menuitem"]') || [])];
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!auth.habilitadas) return null;
  if (auth.cargando) return <span className="account-trigger is-loading" aria-label="Verificando sesión"><LoaderCircle size={18} className="spin"/></span>;
  if (!auth.autenticado) {
    if (!auth.googleDisponible) return null;
    const enLogin = location.pathname.startsWith('/iniciar-sesion');
    return <Link className="account-trigger" to={enLogin ? `${location.pathname}${location.search}` : loginPath(location)} onClick={onNavigate} aria-label="Ingresar a tu cuenta">
      <User size={20}/><span className="account-trigger-label">Ingresar</span>
    </Link>;
  }
  const c = auth.cliente;
  const salir = async () => {
    setSaliendo(true);
    await auth.logout();
    setSaliendo(false);
    setOpen(false);
    onNavigate?.();
    if (location.pathname.startsWith('/mi-cuenta')) navigate('/', { replace: true });
  };
  const close = () => { setOpen(false); onNavigate?.(); };
  return <div className="account-menu" ref={wrapRef}>
    <button ref={buttonRef} type="button" className="account-trigger is-auth" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); setTimeout(() => wrapRef.current?.querySelector('[role="menuitem"]')?.focus(), 0); } }}>
      <span className="account-avatar" aria-hidden="true">{initials(c)}</span>
      <span className="account-trigger-label">Hola, {c?.nombre || 'cliente'}</span>
      <ChevronDown size={15} className="account-chevron"/>
    </button>
    {open && <div className="account-dropdown" role="menu" id={menuId} aria-label="Mi cuenta">
      <div className="account-dropdown-head"><strong>{[c?.nombre, c?.apellido].filter(Boolean).join(' ')}</strong><small>{c?.email}</small></div>
      <Link role="menuitem" to="/mi-cuenta" onClick={close}><User size={16}/> Mi cuenta</Link>
      <Link role="menuitem" to="/mi-cuenta/direcciones" onClick={close}><MapPin size={16}/> Mis direcciones</Link>
      <Link role="menuitem" to="/mi-cuenta/pedidos" onClick={close}><Package size={16}/> Mis pedidos</Link>
      <button role="menuitem" type="button" onClick={salir} disabled={saliendo}>{saliendo ? <LoaderCircle size={16} className="spin"/> : <LogOut size={16}/>} Cerrar sesión</button>
    </div>}
  </div>;
}

/** Enlaces de cuenta dentro del menú móvil. */
export function MobileAccountLinks({ onNavigate }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.habilitadas || auth.cargando) return null;
  if (!auth.autenticado) {
    return auth.googleDisponible ? <div className="mobile-account"><Link to={loginPath(location)} onClick={onNavigate}><LogIn size={16}/> Ingresar con Google</Link></div> : null;
  }
  return <div className="mobile-account" aria-label="Mi cuenta">
    <span className="mobile-account-name"><span className="account-avatar" aria-hidden="true">{initials(auth.cliente)}</span>{auth.cliente?.nombre}</span>
    <Link to="/mi-cuenta" onClick={onNavigate}><User size={16}/> Mi cuenta</Link>
    <Link to="/mi-cuenta/direcciones" onClick={onNavigate}><MapPin size={16}/> Mis direcciones</Link>
    <Link to="/mi-cuenta/pedidos" onClick={onNavigate}><Package size={16}/> Mis pedidos</Link>
    <button type="button" onClick={async () => { await auth.logout(); onNavigate?.(); }}><LogOut size={16}/> Cerrar sesión</button>
  </div>;
}
