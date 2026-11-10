import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PackageSearch, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCatalogo } from './hooks/useCatalogo';
import { filterProducts, getCategories, normalizePriceRange } from './utilidades/catalogo';
import Filtros from './Filtros';
import GrillaProductos from './GrillaProductos';
import { EstadoVacio, EstadoError, EstadoCargando } from '../global/Estados';

/**
 * 20 productos por página: completa filas exactas con 5, 4, 2 y 1 columnas.
 * Solo cambia el valor del parámetro `limite` que la API ya recibe; si lo rechazara,
 * useCatalogo vuelve a pedir con el límite histórico (12).
 */
const PRODUCTOS_POR_PAGINA = 20;
const ESCRITORIO = '(min-width: 751px)';
const MARGEN_STICKY = 20;

const matchMediaSeguro = (query) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null);

/**
 * Bloquea el scroll del fondo mientras el panel móvil está abierto.
 * Se bloquea <html> y <body> (en iOS no alcanza con body) y se compensa el ancho
 * de la barra de desplazamiento para que el contenido no salte.
 */
function bloquearScrollDelFondo() {
  const html = document.documentElement;
  const body = document.body;
  const previo = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPadding: body.style.paddingRight };
  const anchoBarra = window.innerWidth - html.clientWidth;
  html.style.overflow = 'hidden';
  body.style.overflow = 'hidden';
  if (anchoBarra > 0) body.style.paddingRight = `${anchoBarra}px`;
  return () => {
    html.style.overflow = previo.htmlOverflow;
    body.style.overflow = previo.bodyOverflow;
    body.style.paddingRight = previo.bodyPadding;
  };
}

/**
 * En escritorio el panel solo queda fijo (sticky) si entra completo en la ventana.
 * Así nunca se corta su parte inferior y no hace falta darle scroll propio
 * (que generaba barras extra y atrapaba la rueda del mouse).
 */
function useStickySiEntra(ref, habilitado) {
  const [sticky, setSticky] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!habilitado || !el) { setSticky(false); return undefined; }
    const escritorio = matchMediaSeguro(ESCRITORIO);
    const medir = () => {
      const headerHeight = document.querySelector('.site-header')?.getBoundingClientRect().height || 64;
      setSticky(Boolean(escritorio?.matches) && el.offsetHeight + headerHeight + MARGEN_STICKY * 2 <= window.innerHeight);
    };
    medir();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observer?.observe(el);
    window.addEventListener('resize', medir);
    escritorio?.addEventListener?.('change', medir);
    return () => { observer?.disconnect(); window.removeEventListener('resize', medir); escritorio?.removeEventListener?.('change', medir); };
  }, [ref, habilitado]);
  return sticky;
}

export default function PaginaCatalogo({ config }) {
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const initialCategory = params.get('categoria') || 'todas';
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [term, setTerm] = useState(query);
  const [category, setCategory] = useState(initialCategory);
  const [order, setOrder] = useState('destacados');
  const [stockOnly, setStockOnly] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sidebarRef = useRef(null);
  const toggleRef = useRef(null);
  const closeRef = useRef(null);
  const enabled = Boolean(config.modo_catalogo);
  const { productos, masPaginas, cargando, error } = useCatalogo(enabled, page, refresh, PRODUCTOS_POR_PAGINA);
  const sidebarSticky = useStickySiEntra(sidebarRef, enabled);
  useEffect(() => { setTerm(query); setCategory(initialCategory); setPage(1); }, [query, initialCategory]);

  // Panel de filtros en celulares y tablets: Escape lo cierra, el fondo no se desplaza
  // mientras está abierto y el foco entra al panel y vuelve al botón "Filtros" al cerrar.
  useEffect(() => {
    if (!filtersOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setFiltersOpen(false); };
    const desbloquear = bloquearScrollDelFondo();
    // Si la pantalla pasa a escritorio, el panel se cierra (allí los filtros están siempre visibles).
    const desktop = matchMediaSeguro(ESCRITORIO);
    const onDesktop = (event) => { if (event.matches) setFiltersOpen(false); };
    window.addEventListener('keydown', onKey);
    desktop?.addEventListener?.('change', onDesktop);
    const toggle = toggleRef.current;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 60);
    return () => {
      window.clearTimeout(focusTimer);
      desbloquear();
      window.removeEventListener('keydown', onKey);
      desktop?.removeEventListener?.('change', onDesktop);
      if (toggle && !desktop?.matches && toggle.offsetParent !== null) toggle.focus({ preventScroll: true });
    };
  }, [filtersOpen]);

  const categories = useMemo(() => getCategories(productos), [productos]);
  const priceRange = useMemo(() => normalizePriceRange(minPrice, maxPrice), [minPrice, maxPrice]);
  const filtered = useMemo(
    () => filterProducts(productos, { term, category, order, stockOnly, minPrice: priceRange.min, maxPrice: priceRange.max }),
    [productos, term, category, order, stockOnly, priceRange.min, priceRange.max]
  );
  const reset = () => { setTerm(''); setCategory('todas'); setOrder('destacados'); setStockOnly(false); setMinPrice(''); setMaxPrice(''); };
  const priceActive = Boolean(minPrice || maxPrice);
  const activeFilters = [term.trim(), category !== 'todas', order !== 'destacados', stockOnly, priceActive].filter(Boolean).length;
  const changePage = (next) => { setPage(next); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const searchTerm = term.trim();
  const title = searchTerm ? <>Resultados para “{searchTerm}”</> : category !== 'todas' ? category : 'Todos los productos';
  const ready = config.modo_catalogo && !cargando && !error;
  const countLabel = `${filtered.length} ${filtered.length === 1 ? 'producto' : 'productos'}`;

  return <main className="catalog-page">
    <div className={`shell catalog-layout ${config.modo_catalogo ? '' : 'is-single'}`}>
      {config.modo_catalogo && <>
        {filtersOpen && <button type="button" className="catalog-sidebar-backdrop" aria-label="Cerrar filtros" tabIndex={-1} onClick={() => setFiltersOpen(false)}/>}
        <aside id="filtros-catalogo" ref={sidebarRef} className={`catalog-sidebar ${filtersOpen ? 'is-open' : ''} ${sidebarSticky ? 'is-sticky' : ''}`} aria-label="Filtros del catálogo">
          <div className="catalog-sidebar-head">
            <strong>Filtros</strong>
            <button type="button" ref={closeRef} className="icon-button" aria-label="Cerrar filtros" onClick={() => setFiltersOpen(false)}><X size={19}/></button>
          </div>
          <div className="catalog-sidebar-body">
            <Filtros
              term={term} setTerm={setTerm}
              category={category} setCategory={setCategory} categories={categories}
              order={order} setOrder={setOrder}
              stockOnly={stockOnly} setStockOnly={setStockOnly}
              minPrice={minPrice} setMinPrice={setMinPrice} maxPrice={maxPrice} setMaxPrice={setMaxPrice} priceError={priceRange.error}
              onReset={reset} activeFilters={activeFilters}
            />
          </div>
          <div className="catalog-sidebar-foot">
            <button type="button" className="btn btn-dark" onClick={() => setFiltersOpen(false)}>Ver {countLabel}</button>
          </div>
        </aside>
      </>}
      <section className="catalog-content" aria-labelledby="catalogo-titulo">
        <div className="catalog-toolbar">
          <div className="catalog-heading">
            <h1 id="catalogo-titulo">{title}</h1>
            {ready && <span className="catalog-count">{countLabel}</span>}
          </div>
          {config.modo_catalogo && <button type="button" ref={toggleRef} className="catalog-filter-toggle" aria-controls="filtros-catalogo" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={16}/> Filtros{activeFilters > 0 && <span className="catalog-filter-badge">{activeFilters}</span>}</button>}
        </div>
        {!config.modo_catalogo ? <EstadoVacio title="Catálogo no disponible" description="La tienda todavía no tiene habilitada la publicación de productos."/> : cargando ? <EstadoCargando message="Buscando productos…"/> : error ? <EstadoError error={error} retry={() => setRefresh((v) => v + 1)}/> : productos.length === 0 && page === 1 ? <EstadoVacio/> : filtered.length ? <GrillaProductos products={filtered}/> : <EstadoVacio title="No encontramos coincidencias" description="Probá cambiar los filtros o pasar a otra página del catálogo." icon={PackageSearch}/>}
        {ready && (page > 1 || masPaginas) && <div className="catalog-pagination"><button type="button" disabled={page === 1} onClick={() => changePage(Math.max(1, page - 1))}><ChevronLeft size={17}/> Anterior</button><span>Página {page}</span><button type="button" disabled={!masPaginas} onClick={() => changePage(page + 1)}>Siguiente <ChevronRight size={17}/></button></div>}
        {config.modo_catalogo && <p className="catalog-limit-note">La búsqueda, las categorías, el precio y el orden se aplican a los productos de la página cargada.</p>}
      </section>
    </div>
  </main>;
}
