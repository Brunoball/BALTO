import React from 'react';
import { useLocation } from 'react-router-dom';
import './estilos/transiciones.css';

/** Solo cambia con la sección: buscar, filtrar o paginar no reinicia la página. */
export default function TransicionPagina({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="page-transition">{children}</div>;
}
