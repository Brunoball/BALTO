import React from 'react';
import { Info, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { precioARS } from '../../utils/format';

/** Avisos de sincronización con el servidor: precios actualizados, verificación y errores. */
export default function CartNotices({ compact = false }) {
  const { cambios, dismissCambios, validation, validacionVigente, validarCarrito, bloqueos, items } = useStore();
  if (!items.length) return null;
  return <div className={`cart-notices ${compact ? 'is-compact' : ''}`} aria-live="polite">
    {validation.status === 'loading' && <p className="cart-sync"><LoaderCircle size={14} className="spin"/> Verificando precios y stock con la tienda…</p>}
    {validation.status === 'error' && <p className="cart-sync is-error">No pudimos verificar precios y stock. <button type="button" className="link-button" onClick={validarCarrito}><RotateCcw size={13}/> Reintentar</button></p>}
    {cambios.length > 0 && <div className="cart-changes" role="status">
      <div className="cart-changes-head"><Info size={15}/><strong>Actualizamos precios con los valores vigentes</strong><button type="button" aria-label="Cerrar aviso" onClick={dismissCambios}><X size={14}/></button></div>
      <ul>{cambios.map((c) => <li key={c.key}>{c.nombre}{c.variante ? ` (${c.variante})` : ''}: <s>{precioARS(c.anterior)}</s> → <strong>{precioARS(c.nuevo)}</strong></li>)}</ul>
    </div>}
    {validacionVigente && bloqueos.length > 0 && <p className="cart-sync is-warning">Hay productos que no se pueden comprar en este momento. Ajustalos o quitalos para continuar.</p>}
  </div>;
}
