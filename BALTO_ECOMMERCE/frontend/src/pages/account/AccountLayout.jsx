import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LoaderCircle, LogOut, MapPin, Package, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { initials } from '../../components/account/AccountMenu';

/** Estructura común de /mi-cuenta: saludo, navegación de secciones y cierre de sesión. */
export default function AccountLayout({ title, eyebrow = 'MI CUENTA', description, children }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [saliendo, setSaliendo] = useState(false);
  const c = auth.cliente || {};
  const salir = async () => {
    setSaliendo(true);
    await auth.logout();
    navigate('/', { replace: true });
  };
  return <main className="shell standard-page account-page">
    <div className="account-header">
      <span className="account-avatar is-large" aria-hidden="true">{initials(c)}</span>
      <div className="page-intro">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}<span>.</span></h1>
        {description && <p>{description}</p>}
      </div>
    </div>
    <div className="account-layout">
      <nav className="account-nav" aria-label="Secciones de mi cuenta">
        <NavLink end to="/mi-cuenta"><User size={17}/> Mis datos</NavLink>
        <NavLink to="/mi-cuenta/direcciones"><MapPin size={17}/> Mis direcciones</NavLink>
        <NavLink to="/mi-cuenta/pedidos"><Package size={17}/> Mis pedidos</NavLink>
        <button type="button" onClick={salir} disabled={saliendo}>{saliendo ? <LoaderCircle size={17} className="spin"/> : <LogOut size={17}/>} Cerrar sesión</button>
      </nav>
      <div className="account-content">{children}</div>
    </div>
  </main>;
}
