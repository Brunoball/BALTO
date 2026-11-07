import React from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { UserX } from 'lucide-react';
import { useCuenta } from '../cuenta/contexto/CuentaContext';
import { EstadoVacio, EstadoCargando } from '../global/Estados';
import { loginPath } from './utilidades/redireccionSegura';

/** Protege páginas privadas en la interfaz. La autorización real la hace el servidor en cada acción. */
export default function RequiereSesion({ children }) {
  const auth = useCuenta();
  const location = useLocation();
  if (auth.estado === 'no_disponible') {
    return <main className="shell standard-page"><EstadoVacio icon={UserX} title="Las cuentas todavía no están disponibles" description="Podés seguir comprando como invitado: no necesitás registrarte."/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Ir al catálogo</Link></div></main>;
  }
  if (auth.cargando) return <main className="shell standard-page"><EstadoCargando message="Verificando tu sesión…"/></main>;
  if (!auth.autenticado) return <Navigate to={loginPath(location)} replace/>;
  return children;
}
