import React, { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCarrito } from '../carrito/contexto/CarritoContext';
import { listarPorSlugs } from './api/catalogoApi';
import GrillaProductos from './GrillaProductos';
import { EstadoVacio, EstadoError, EstadoCargando } from '../global/Estados';

export default function PaginaFavoritos() {
  const { favorites } = useCarrito();
  const [state, setState] = useState({ loading: false, products: [], error: null });
  const key = favorites.join('|');
  useEffect(() => {
    if (!favorites.length) { setState({ loading: false, products: [], error: null }); return undefined; }
    const controller = new AbortController();
    setState({ loading: true, products: [], error: null });
    // Una sola consulta para todos los favoritos (antes: un pedido por producto).
    listarPorSlugs(favorites.slice(0, 60), controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ loading: false, products: Array.isArray(data.productos) ? data.productos : [], error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ loading: false, products: [], error: new Error('No se pudieron cargar los favoritos. Probá de nuevo más tarde.') });
      });
    return () => controller.abort();
  // Recalcular solo cuando cambia la lista de slugs guardados.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <main className="shell standard-page"><div className="page-intro"><span className="eyebrow">TU LISTA ESPECIAL</span><h1>Mis favoritos<span>.</span></h1><p>Guardamos tus productos favoritos en este navegador para que puedas volver a encontrarlos.</p></div>{favorites.length === 0 ? <EstadoVacio title="Todavía no guardaste favoritos" description="Tocá el corazón de un producto para agregarlo a tu lista." icon={Heart}/> : state.loading ? <EstadoCargando message="Recuperando tus favoritos…"/> : state.error ? <EstadoError error={state.error}/> : state.products.length ? <><GrillaProductos products={state.products}/>{state.products.length < favorites.length && <p className="muted-small">Algunos productos ya no están publicados o no están disponibles.</p>}</> : <EstadoVacio title="Tus favoritos ya no están disponibles" description="Volvé al catálogo para conocer los productos publicados." icon={Heart}/>}<div className="standard-page-action"><Link to="/catalogo" className="btn btn-outline">Explorar productos</Link></div></main>;
}
