import React from 'react';
import { AlertTriangle, Box, LoaderCircle, PackageSearch, RotateCcw } from 'lucide-react';

export function EstadoCargando({ message = 'Estamos preparando la tienda…', compact = false }) {
  return <div className={`state-view ${compact ? 'state-compact' : ''}`} role="status" aria-live="polite"><LoaderCircle size={34} className="spin"/><h3>{message}</h3><p>Un momento, por favor.</p></div>;
}
export function EstadoError({ error, title = 'No pudimos cargar esta sección', retry }) {
  return <div className="state-view" role="alert"><span className="state-symbol state-error"><AlertTriangle size={26}/></span><h3>{title}</h3><p>{error?.message || 'Ocurrió un error inesperado.'}</p>{retry && <button type="button" className="btn btn-dark" onClick={retry}><RotateCcw size={16}/> Reintentar</button>}{error?.codigo && <small>Referencia: {error.codigo}</small>}</div>;
}
export function EstadoVacio({ title = 'Pronto habrá productos para descubrir', description = 'Estamos preparando esta selección. Volvé a visitarnos pronto.', icon: Icon = PackageSearch }) {
  return <div className="state-view state-empty"><span className="state-symbol"><Icon size={29}/></span><h3>{title}</h3><p>{description}</p></div>;
}
export function ImagenProducto({ url, alt = '', className = '' }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [url]);
  return url && !broken ? <img className={className} src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} /> : <span className={`image-fallback ${className}`} aria-label={alt || 'Sin imagen'} role="img"><Box size={42} strokeWidth={1.3} /></span>;
}
