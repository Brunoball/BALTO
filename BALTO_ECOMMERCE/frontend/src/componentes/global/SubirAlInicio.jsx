import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function SubirAlInicio() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    // El scroll suave global no debe arrastrar la sección nueva desde la anterior.
    // Restablecer antes de pintar permite que el fundido comience ya en el inicio.
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    html.style.scrollBehavior = previous;
  }, [pathname]);
  return null;
}
