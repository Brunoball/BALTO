import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PackageSearch, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useCatalogo } from './hooks/useCatalogo';
import { arbolCategorias, filtrosAParams, leerFiltrosURL, normalizePriceRange } from './utilidades/catalogo';
import Filtros from './Filtros';
import GrillaProductos, { GrillaEsqueleto } from './GrillaProductos';
import { EstadoVacio, EstadoError } from '../global/Estados';

/**
 * 20 productos por página: completa filas exactas con 5, 4, 2 y 1 columnas.
 * Búsqueda, categorías, precio, disponibilidad y orden se aplican en el SERVIDOR sobre
 * todo el catálogo, y quedan en la URL (se pueden compartir y el botón "atrás" funciona).
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

const ESPERA_BUSQUEDA_MS = 350;
const ESPERA_PRECIO_MS = 600;

/** Números de página a mostrar: 1 … 4 5 [6] 7 8 … 20 */
function paginasVisibles(actual, total) {
  const set = new Set([1, total, actual - 1, actual, actual + 1]);
  if (actual <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (actual >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => set.add(n));
  const lista = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  lista.forEach((n, i) => { if (i && n - lista[i - 1] > 1) out.push(`gap-${n}`); out.push(n); });
  return out;
}

function Paginacion({ pagina, totalPaginas, onChange }) {
  if (totalPaginas <= 1) return null;
  return <nav className="catalog-pagination" aria-label="Paginación del catálogo">
    <button type="button" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)}><ChevronLeft size={17}/> Anterior</button>
    <div className="catalog-pages">
      {paginasVisibles(pagina, totalPaginas).map((n) => typeof n === 'string'
        ? <span key={n} className="catalog-pages-gap" aria-hidden="true">…</span>
        : <button key={n} type="button" className="catalog-page" aria-current={n === pagina ? 'page' : undefined} aria-label={`Página ${n}`} onClick={() => n !== pagina && onChange(n)}>{n}</button>)}
    </div>
    <span className="catalog-page-status">Página {pagina} de {totalPaginas}</span>
    <button type="button" disabled={pagina >= totalPaginas} onClick={() => onChange(pagina + 1)}>Siguiente <ChevronRight size={17}/></button>
  </nav>;
}

export default function PaginaCatalogo({ config }) {
  const [params, setParams] = useSearchParams();
  const filtros = useMemo(() => leerFiltrosURL(params), [params]);
  const [refresh, setRefresh] = useState(0);
  // Borradores de lo que se escribe: se aplican con una espera corta para no consultar en cada tecla.
  const [term, setTerm] = useState(filtros.q);
  const [minPrice, setMinPrice] = useState(filtros.precio_min);
  const [maxPrice, setMaxPrice] = useState(filtros.precio_max);
  const escrito = useRef({ q: filtros.q, min: filtros.precio_min, max: filtros.precio_max });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sidebarRef = useRef(null);
  const toggleRef = useRef(null);
  const closeRef = useRef(null);
  const enabled = Boolean(config.modo_catalogo);

  const consulta = useMemo(() => ({
    pagina: filtros.pagina, limite: PRODUCTOS_POR_PAGINA, q: filtros.q, categoria: filtros.categoria, orden: filtros.orden,
    precio_min: filtros.precio_min, precio_max: filtros.precio_max, solo_disponibles: filtros.disponibles,
  }), [filtros]);
  const { productos, total, totalPaginas, categorias, cargando, actualizando, error } = useCatalogo(enabled, consulta, refresh);
  const sidebarSticky = useStickySiEntra(sidebarRef, enabled);

  /** Cambia filtros en la URL. Todo cambio de filtro vuelve a la página 1. */
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const aplicar = useCallback((patch, { push = false } = {}) => {
    const next = { ...leerFiltrosURL(paramsRef.current), ...patch };
    if (!('pagina' in patch)) next.pagina = 1;
    const nuevos = filtrosAParams(next);
    paramsRef.current = nuevos;
    setParams(nuevos, { replace: !push });
  }, [setParams]);

  // La URL cambió desde afuera (buscador del encabezado, atrás/adelante, "limpiar"): actualizar borradores.
  useEffect(() => {
    if (filtros.q !== escrito.current.q) { escrito.current.q = filtros.q; setTerm(filtros.q); }
    if (filtros.precio_min !== escrito.current.min) { escrito.current.min = filtros.precio_min; setMinPrice(filtros.precio_min); }
    if (filtros.precio_max !== escrito.current.max) { escrito.current.max = filtros.precio_max; setMaxPrice(filtros.precio_max); }
  }, [filtros.q, filtros.precio_min, filtros.precio_max]);

  useEffect(() => {
    const q = term.trim();
    if (q === filtros.q) return undefined;
    const t = window.setTimeout(() => { escrito.current.q = q; aplicar({ q }); }, ESPERA_BUSQUEDA_MS);
    return () => window.clearTimeout(t);
  }, [term, filtros.q, aplicar]);

  const priceRange = useMemo(() => normalizePriceRange(minPrice, maxPrice), [minPrice, maxPrice]);
  useEffect(() => {
    if (priceRange.error || (minPrice === filtros.precio_min && maxPrice === filtros.precio_max)) return undefined;
    const t = window.setTimeout(() => {
      escrito.current.min = minPrice; escrito.current.max = maxPrice;
      aplicar({ precio_min: minPrice, precio_max: maxPrice });
    }, ESPERA_PRECIO_MS);
    return () => window.clearTimeout(t);
  }, [minPrice, maxPrice, priceRange.error, filtros.precio_min, filtros.precio_max, aplicar]);

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

  const arbol = useMemo(() => arbolCategorias(categorias), [categorias]);
  const categoriaActual = useMemo(() => {
    if (!filtros.categoria) return null;
    const porId = categorias.find((c) => String(c.id) === filtros.categoria);
    return porId || categorias.find((c) => c.nombre.toLocaleLowerCase('es-AR') === filtros.categoria.toLocaleLowerCase('es-AR')) || null;
  }, [categorias, filtros.categoria]);

  const reset = () => {
    setTerm(''); setMinPrice(''); setMaxPrice('');
    escrito.current = { q: '', min: '', max: '' };
    aplicar({ q: '', categoria: '', orden: 'destacados', precio_min: '', precio_max: '', disponibles: false });
  };
  const priceActive = Boolean(minPrice || maxPrice);
  const activeFilters = [term.trim(), filtros.categoria, filtros.orden !== 'destacados', filtros.disponibles, priceActive].filter(Boolean).length;
  const changePage = (next) => { aplicar({ pagina: next }, { push: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const searchTerm = filtros.q;
  const title = searchTerm ? <>Resultados para “{searchTerm}”</> : categoriaActual ? categoriaActual.nombre : 'Todos los productos';
  const ready = enabled && !cargando && !error;
  const countLabel = `${total} ${total === 1 ? 'producto' : 'productos'}`;
  const hayFiltros = Boolean(filtros.q || filtros.categoria || filtros.disponibles || filtros.precio_min || filtros.precio_max);

  let contenido;
  if (!enabled) contenido = <EstadoVacio title="Catálogo no disponible" description="La tienda todavía no tiene habilitada la publicación de productos."/>;
  else if (cargando) contenido = <GrillaEsqueleto cantidad={10}/>;
  else if (error) contenido = <EstadoError error={error} retry={() => setRefresh((v) => v + 1)}/>;
  else if (total === 0 && !hayFiltros) contenido = <EstadoVacio/>;
  else if (productos.length === 0) contenido = <div className={`catalog-results ${actualizando ? 'is-updating' : ''}`}><EstadoVacio title="No encontramos coincidencias" description="Probá con otra búsqueda o cambiá los filtros." icon={PackageSearch}/>{hayFiltros && <div className="standard-page-action"><button type="button" className="btn btn-outline" onClick={reset}><RotateCcw size={16}/> Limpiar filtros</button></div>}</div>;
  else contenido = <div className={`catalog-results ${actualizando ? 'is-updating' : ''}`} aria-busy={actualizando || undefined}>{actualizando && <span className="catalog-updating-bar" aria-hidden="true"/>}<GrillaProductos products={productos}/></div>;

  return <main className="catalog-page">
    <div className={`shell catalog-layout ${enabled ? '' : 'is-single'}`}>
      {enabled && <>
        {filtersOpen && <button type="button" className="catalog-sidebar-backdrop" aria-label="Cerrar filtros" tabIndex={-1} onClick={() => setFiltersOpen(false)}/>}
        <aside id="filtros-catalogo" ref={sidebarRef} className={`catalog-sidebar ${filtersOpen ? 'is-open' : ''} ${sidebarSticky ? 'is-sticky' : ''}`} aria-label="Filtros del catálogo">
          <div className="catalog-sidebar-head">
            <strong>Filtros</strong>
            <button type="button" ref={closeRef} className="icon-button" aria-label="Cerrar filtros" onClick={() => setFiltersOpen(false)}><X size={19}/></button>
          </div>
          <div className="catalog-sidebar-body">
            <Filtros
              term={term} setTerm={setTerm}
              category={categoriaActual ? String(categoriaActual.id) : filtros.categoria} setCategory={(categoria) => aplicar({ categoria })} categories={arbol}
              order={filtros.orden} setOrder={(orden) => aplicar({ orden })}
              stockOnly={filtros.disponibles} setStockOnly={(disponibles) => aplicar({ disponibles })}
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
            {ready && <span className="catalog-count" aria-live="polite">{countLabel}</span>}
          </div>
          {enabled && <button type="button" ref={toggleRef} className="catalog-filter-toggle" aria-controls="filtros-catalogo" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={16}/> Filtros{activeFilters > 0 && <span className="catalog-filter-badge">{activeFilters}</span>}</button>}
        </div>
        {contenido}
        {ready && <Paginacion pagina={filtros.pagina} totalPaginas={totalPaginas} onChange={changePage}/>}
      </section>
    </div>
  </main>;
}
