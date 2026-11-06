import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PackageSearch } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCatalogo } from '../hooks/useCatalogo';
import { filterProducts, getCategories } from '../utils/catalog';
import Filters from '../components/catalog/Filters';
import ProductsGrid from '../components/catalog/ProductsGrid';
import { EmptyState, ErrorState, LoadingState } from '../components/common/StateView';

export default function CatalogPage({ config }) {
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const initialCategory = params.get('categoria') || 'todas';
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [term, setTerm] = useState(query);
  const [category, setCategory] = useState(initialCategory);
  const [order, setOrder] = useState('destacados');
  const [stockOnly, setStockOnly] = useState(false);
  const { productos, masPaginas, cargando, error } = useCatalogo(Boolean(config.modo_catalogo), page, refresh);
  useEffect(() => { setTerm(query); setCategory(initialCategory); setPage(1); }, [query, initialCategory]);
  const categories = useMemo(() => getCategories(productos), [productos]);
  const filtered = useMemo(() => filterProducts(productos, { term, category, order, stockOnly }), [productos, term, category, order, stockOnly]);
  const reset = () => { setTerm(''); setCategory('todas'); setOrder('destacados'); setStockOnly(false); };
  return <main className="catalog-page"><section className="catalog-banner"><div className="shell"><span className="eyebrow">TODO EN UN LUGAR</span><h1>Nuestro catálogo<span>.</span></h1><p>Explorá los productos publicados y encontrá tus favoritos.</p></div></section>
    <section className="shell catalog-main">
      <div className="catalog-topline"><div><h2>Todos los productos</h2><p>Precios y disponibilidad consultados desde BALTO Comercio.</p></div>{!cargando && <span className="result-counter">{productos.length} productos en esta página</span>}</div>
      {config.modo_catalogo && <Filters term={term} setTerm={setTerm} category={category} setCategory={setCategory} categories={categories} order={order} setOrder={setOrder} stockOnly={stockOnly} setStockOnly={setStockOnly} onReset={reset}/>}
      {!config.modo_catalogo ? <EmptyState title="Catálogo no disponible" description="La tienda todavía no tiene habilitada la publicación de productos."/> : cargando ? <LoadingState message="Buscando productos…"/> : error ? <ErrorState error={error} retry={() => setRefresh((v) => v + 1)}/> : productos.length === 0 && page === 1 ? <EmptyState/> : filtered.length ? <ProductsGrid products={filtered}/> : <EmptyState title="No encontramos coincidencias" description="Probá cambiar los filtros o pasar a otra página del catálogo." icon={PackageSearch}/>}
      {config.modo_catalogo && !cargando && !error && (page > 1 || masPaginas) && <div className="catalog-pagination"><button type="button" disabled={page === 1} onClick={() => { setPage((v) => Math.max(1, v - 1)); window.scrollTo({ top: 220, behavior: 'smooth' }); }}><ChevronLeft size={17}/> Anterior</button><span>Página {page}</span><button type="button" disabled={!masPaginas} onClick={() => { setPage((v) => v + 1); window.scrollTo({ top: 220, behavior: 'smooth' }); }}>Siguiente <ChevronRight size={17}/></button></div>}
      <p className="catalog-limit-note">La búsqueda, categorías y el orden se aplican únicamente a los productos de la página cargada. La búsqueda global estará disponible cuando se implemente en el backend.</p>
    </section>
  </main>;
}
