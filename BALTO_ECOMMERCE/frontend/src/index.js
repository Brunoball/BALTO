// Create React App requiere src/index.js como punto de entrada.
// Los componentes y páginas visuales están desarrollados en .jsx.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App/></React.StrictMode>);
reportWebVitals();
