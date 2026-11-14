import React from 'react';
import { Sparkles } from 'lucide-react';
export default function BarraAnuncios({ checkout = false, pagos = false }) {
  return <div className="announcement"><div className="shell announcement-inner"><span><Sparkles size={13}/> Un lugar para descubrir lo que buscás</span><span className="announcement-secondary">{checkout ? (pagos ? 'Pedidos online · Elegís el medio de pago al confirmar' : 'Pedidos online · Pago y entrega a coordinar') : 'Catálogo online · Consultas personalizadas'}</span></div></div>;
}
