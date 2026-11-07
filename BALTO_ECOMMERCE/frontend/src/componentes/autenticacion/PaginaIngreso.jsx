import React, { useEffect } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, Package, ShieldCheck, ShoppingBag, UserX } from 'lucide-react';
import { useCuenta } from '../cuenta/contexto/CuentaContext';
import { useCarrito } from '../carrito/contexto/CarritoContext';
import BotonGoogle from './BotonGoogle';
import { EstadoVacio, EstadoCargando } from '../global/Estados';
import { safeRedirect } from './utilidades/redireccionSegura';

/** /iniciar-sesion?volver=/ruta-interna — Login con Google; la compra como invitado sigue disponible. */
export default function PaginaIngreso({ config }) {
  const auth = useCuenta();
  const { items } = useCarrito();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const destino = safeRedirect(params.get('volver'), '/mi-cuenta');
  useEffect(() => { document.title = `Ingresar · ${config?.nombre || 'Tienda online'}`; }, [config]);

  if (auth.cargando) return <main className="shell standard-page"><EstadoCargando message="Verificando tu sesión…"/></main>;
  if (auth.autenticado) return <Navigate to={destino} replace/>;
  if (!auth.googleDisponible) {
    return <main className="shell standard-page"><EstadoVacio icon={UserX} title="El acceso con cuenta todavía no está disponible" description="Podés comprar como invitado: no necesitás registrarte."/>
      <div className="standard-page-action"><Link to={items.length ? '/checkout' : '/catalogo'} className="btn btn-dark">{items.length ? 'Continuar como invitado' : 'Ir al catálogo'}</Link></div></main>;
  }
  return <main className="shell standard-page login-page">
    <section className="login-card" aria-labelledby="login-title">
      <span className="eyebrow">TU CUENTA EN {String(config?.nombre || 'LA TIENDA').toUpperCase()}</span>
      <h1 id="login-title">Ingresá a tu cuenta<span>.</span></h1>
      <p className="login-lead">Usá tu cuenta de Google: no necesitás crear una contraseña. Si es tu primera vez, la cuenta se crea automáticamente.</p>
      <BotonGoogle onSuccess={() => navigate(destino, { replace: true })}/>
      <ul className="login-benefits">
        <li><ShoppingBag size={17}/> Completá tus compras más rápido con tus datos guardados.</li>
        <li><MapPin size={17}/> Guardá varias direcciones de entrega.</li>
        <li><Package size={17}/> Consultá el estado de tus pedidos.</li>
      </ul>
      <div className="login-guest">
        <span>¿Preferís no registrarte?</span>
        <Link to={items.length ? '/checkout' : '/catalogo'} className="btn btn-outline">{items.length ? 'Continuar como invitado' : 'Seguir explorando'}</Link>
      </div>
      <p className="login-legal"><ShieldCheck size={15}/> Solo recibimos tu nombre y email verificados por Google. Nunca vemos tu contraseña. Tu carrito se mantiene.</p>
    </section>
  </main>;
}
