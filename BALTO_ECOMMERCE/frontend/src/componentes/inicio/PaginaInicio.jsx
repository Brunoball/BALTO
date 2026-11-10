import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCatalogo } from '../catalogo/hooks/useCatalogo';
import SeccionPrincipal from './SeccionPrincipal';
import SeccionBeneficios from './SeccionBeneficios';
import SeccionDescubrir from './SeccionDescubrir';
import TituloSeccion from '../global/TituloSeccion';
import GrillaProductos, { GrillaEsqueleto } from '../catalogo/GrillaProductos';
import { EstadoVacio, EstadoError } from '../global/Estados';

const INICIO = { pagina: 1, limite: 8 };

export default function PaginaInicio({ config }) {
  const [refresh, setRefresh] = useState(0);
  // Los primeros 8 en orden "destacados" (el servidor ya los ordena): el primero es el destacado.
  const { productos, cargando, error } = useCatalogo(Boolean(config.modo_catalogo), INICIO, refresh);
  const featured = productos.find((p) => p.destacado) || productos[0] || null;
  return <main className="home-page">
    <SeccionPrincipal config={config} lead={featured}/>
    <SeccionBeneficios/>
    <section className="shell home-products"><TituloSeccion eyebrow="ELEGIDOS PARA VOS" title="Descubrí nuestro catálogo" description="Una selección de productos disponibles en nuestra tienda." />
      {!config.modo_catalogo ? <EstadoVacio title="Estamos preparando el catálogo" description="Pronto vas a poder descubrir nuestros productos en este espacio."/> : cargando ? <GrillaEsqueleto cantidad={8}/> : error ? <EstadoError error={error} retry={() => setRefresh((v) => v + 1)}/> : productos.length ? <><GrillaProductos products={productos.slice(0,8)}/><div className="home-all-products"><Link to="/catalogo" className="btn btn-outline">Ver todos los productos <ArrowRight size={18}/></Link></div></> : <EstadoVacio/>}
    </section>
    <SeccionDescubrir />
  </main>;
}
