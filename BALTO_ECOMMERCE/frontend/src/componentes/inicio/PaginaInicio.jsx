import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCatalogo } from '../catalogo/hooks/useCatalogo';
import { getCategories } from '../catalogo/utilidades/catalogo';
import SeccionPrincipal from './SeccionPrincipal';
import SeccionBeneficios from './SeccionBeneficios';
import SeccionCategorias from './SeccionCategorias';
import SeccionDescubrir from './SeccionDescubrir';
import TituloSeccion from '../global/TituloSeccion';
import GrillaProductos from '../catalogo/GrillaProductos';
import { EstadoVacio, EstadoError, EstadoCargando } from '../global/Estados';

export default function PaginaInicio({ config }) {
  const [refresh, setRefresh] = useState(0);
  const { productos, cargando, error } = useCatalogo(Boolean(config.modo_catalogo), 1, refresh);
  const featured = productos.find((p) => p.destacado) || productos[0] || null;
  return <main>
    <SeccionPrincipal config={config} lead={featured}/>
    <SeccionBeneficios/>
    {config.modo_catalogo && !cargando && !error && <SeccionCategorias categories={getCategories(productos)}/>}
    <section className="shell section-space home-products"><TituloSeccion eyebrow="ELEGIDOS PARA VOS" title="Descubrí nuestro catálogo" description="Una selección de productos disponibles en nuestra tienda." action={productos.length ? 'Ver catálogo completo' : null} to="/catalogo" />
      {!config.modo_catalogo ? <EstadoVacio title="Estamos preparando el catálogo" description="Pronto vas a poder descubrir nuestros productos en este espacio."/> : cargando ? <EstadoCargando message="Cargando productos…"/> : error ? <EstadoError error={error} retry={() => setRefresh((v) => v + 1)}/> : productos.length ? <><GrillaProductos products={productos.slice(0,8)}/><div className="home-all-products"><Link to="/catalogo" className="btn btn-outline">Descubrir más productos <ArrowRight size={18}/></Link></div></> : <EstadoVacio/>}
    </section>
    <SeccionDescubrir />
    <section className="shell end-spacer" aria-hidden="true" />
  </main>;
}
