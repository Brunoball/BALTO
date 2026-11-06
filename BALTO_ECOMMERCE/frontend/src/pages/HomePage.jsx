import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCatalogo } from '../hooks/useCatalogo';
import { getCategories } from '../utils/catalog';
import HeroSection from '../components/home/HeroSection';
import BenefitsSection from '../components/home/BenefitsSection';
import CategoriesSection from '../components/home/CategoriesSection';
import DiscoverySection from '../components/home/DiscoverySection';
import SectionHeading from '../components/common/SectionHeading';
import ProductsGrid from '../components/catalog/ProductsGrid';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView';

export default function HomePage({ config }) {
  const [refresh, setRefresh] = useState(0);
  const { productos, cargando, error } = useCatalogo(Boolean(config.modo_catalogo), 1, refresh);
  const featured = productos.find((p) => p.destacado) || productos[0] || null;
  return <main>
    <HeroSection config={config} lead={featured}/>
    <BenefitsSection/>
    {config.modo_catalogo && !cargando && !error && <CategoriesSection categories={getCategories(productos)}/>}
    <section className="shell section-space home-products"><SectionHeading eyebrow="ELEGIDOS PARA VOS" title="Descubrí nuestro catálogo" description="Una selección de productos disponibles en nuestra tienda." action={productos.length ? 'Ver catálogo completo' : null} to="/catalogo" />
      {!config.modo_catalogo ? <EmptyState title="Estamos preparando el catálogo" description="Pronto vas a poder descubrir nuestros productos en este espacio."/> : cargando ? <LoadingState message="Cargando productos…"/> : error ? <ErrorState error={error} retry={() => setRefresh((v) => v + 1)}/> : productos.length ? <><ProductsGrid products={productos.slice(0,8)}/><div className="home-all-products"><Link to="/catalogo" className="btn btn-outline">Descubrir más productos <ArrowRight size={18}/></Link></div></> : <EmptyState/>}
    </section>
    <DiscoverySection />
    <section className="shell end-spacer" aria-hidden="true" />
  </main>;
}
