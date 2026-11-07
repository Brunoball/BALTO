import { useEffect, useState } from 'react';

/**
 * Carga Google Identity Services (biblioteca oficial actual; NO el Google
 * Sign-In "platform.js" deprecado). Un único <script> por página.
 */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
let loader = null;

export function cargarIdentidadGoogle(timeoutMs = 12000) {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sin navegador'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const done = (fn, arg) => { clearTimeout(timer); fn(arg); };
    const timer = setTimeout(() => { loader = null; reject(new Error('Google tardó demasiado en responder.')); }, timeoutMs);
    let script = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => {
      if (window.google?.accounts?.id) done(resolve, window.google);
      else { loader = null; done(reject, new Error('Google Identity Services no está disponible.')); }
    });
    script.addEventListener('error', () => {
      loader = null;
      script.remove();
      done(reject, new Error('No se pudo cargar el inicio de sesión de Google. Revisá tu conexión o bloqueadores de contenido.'));
    });
  });
  return loader;
}

/** Estado de carga de GIS: 'inactivo' | 'cargando' | 'listo' | 'error'. */
export function useIdentidadGoogle(enabled, revision = 0) {
  const [state, setState] = useState({ estado: enabled ? 'cargando' : 'inactivo', google: null, error: null });
  useEffect(() => {
    if (!enabled) { setState({ estado: 'inactivo', google: null, error: null }); return undefined; }
    let alive = true;
    setState((s) => (s.estado === 'listo' ? s : { estado: 'cargando', google: null, error: null }));
    cargarIdentidadGoogle()
      .then((google) => { if (alive) setState({ estado: 'listo', google, error: null }); })
      .catch((error) => { if (alive) setState({ estado: 'error', google: null, error }); });
    return () => { alive = false; };
  }, [enabled, revision]);
  return state;
}
