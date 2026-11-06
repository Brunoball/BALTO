import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { obtenerProducto } from '../services/catalogoService';
import ProductGallery from '../components/product/ProductGallery';
import ProductInfo from '../components/product/ProductInfo';
import { ErrorState, LoadingState } from '../components/common/StateView';

export default function ProductPage({ config }) {
  const { slug } = useParams();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState({ loading: true, product: null, error: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, product: null, error: null });
    obtenerProducto(slug, controller.signal).then(({ producto }) => {
      if (!controller.signal.aborted) setState({ loading: false, product: producto || null, error: producto ? null : new Error('Producto no disponible.') });
    }).catch((error) => { if (!controller.signal.aborted) setState({ loading: false, product: null, error }); });
    return () => controller.abort();
  }, [slug, refresh]);
  return <main className="shell product-page"><nav className="breadcrumbs" aria-label="Ruta de navegación"><Link to="/">Inicio</Link><ChevronRight size={15}/><Link to="/catalogo">Catálogo</Link>{state.product && <><ChevronRight size={15}/><span>{state.product.nombre}</span></>}</nav>
    {state.loading ? <LoadingState message="Cargando producto…"/> : state.error ? <><ErrorState error={state.error} title="No pudimos cargar este producto" retry={() => setRefresh((v) => v + 1)}/><Link className="back-to-catalog" to="/catalogo"><ArrowLeft size={16}/> Volver al catálogo</Link></> : <><div className="product-layout"><ProductGallery product={state.product}/><ProductInfo key={state.product.slug} product={state.product} config={config}/></div><div className="product-extra"><h2>Información sobre este producto</h2><p>{config.checkout_habilitado ? 'Los precios y el stock se obtienen del sistema comercial de la tienda y se vuelven a verificar al confirmar el pedido.' : 'Consultá directamente con la tienda por disponibilidad, variantes y condiciones de compra. Los precios se obtienen del sistema comercial y pueden cambiar.'}</p><Link className="back-to-catalog" to="/catalogo"><ArrowLeft size={16}/> Seguir explorando</Link></div></>}
  </main>;
}
