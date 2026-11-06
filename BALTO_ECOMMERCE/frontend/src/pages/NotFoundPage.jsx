import React from 'react';
import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
export default function NotFoundPage() { return <main className="shell not-found"><Compass size={46}/><span className="eyebrow">ERROR 404</span><h1>Esta página no está disponible.</h1><p>Quizá cambió de dirección o ya no existe.</p><Link to="/" className="btn btn-dark"><ArrowLeft size={17}/> Volver al inicio</Link></main>; }
