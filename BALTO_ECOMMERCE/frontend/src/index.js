// Create React App requiere src/index.js como punto de entrada.
// Los componentes y páginas visuales están desarrollados en .jsx.
import React from 'react';
import ReactDOM from 'react-dom/client';
import Aplicacion from './Aplicacion.jsx';
import './index.css';
import medirRendimiento from './medirRendimiento';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><Aplicacion/></React.StrictMode>);
medirRendimiento();
