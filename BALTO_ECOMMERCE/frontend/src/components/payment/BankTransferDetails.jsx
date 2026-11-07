import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { precioARS } from '../../utils/format';

async function copiar(texto) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
  } catch (_) { /* sin permiso: se usa el método alternativo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}

function CopyRow({ label, value, mono }) {
  const [estado, setEstado] = useState(null);
  const click = async () => {
    const ok = await copiar(value);
    setEstado(ok ? 'ok' : 'error');
    setTimeout(() => setEstado(null), 2200);
  };
  return <div className="bank-row">
    <dt>{label}</dt>
    <dd><span className={mono ? 'mono' : undefined}>{value}</span>
      <button type="button" className="copy-button" onClick={click} aria-label={`Copiar ${label}`}>
        {estado === 'ok' ? <><Check size={14}/> Copiado</> : <><Copy size={14}/> Copiar</>}
      </button>
      <span className="sr-only" role="status" aria-live="polite">{estado === 'ok' ? `${label} copiado` : estado === 'error' ? 'No se pudo copiar' : ''}</span>
    </dd>
  </div>;
}

/** Datos de la cuenta de la tienda (vienen del servidor; el navegador no los puede cambiar). */
export default function BankTransferDetails({ destino, importe, moneda = 'ARS', alcance = 'TOTAL', compact = false }) {
  if (!destino) return null;
  return <div className={`bank-details ${compact ? 'is-compact' : ''}`}>
    {importe != null && <div className="bank-amount">
      <span>{alcance === 'PRODUCTOS' ? 'Importe a transferir (productos)' : 'Importe a transferir'}</span>
      <strong data-testid="bank-amount">{precioARS(importe, moneda)}</strong>
      {alcance === 'PRODUCTOS' && <small>El costo de envío se coordina con la tienda y se paga aparte.</small>}
    </div>}
    <dl>
      <div className="bank-row"><dt>Entidad</dt><dd>{destino.entidad}</dd></div>
      <div className="bank-row"><dt>Titular</dt><dd>{destino.titular}{destino.cuit_titular ? <small> · CUIT {destino.cuit_titular}</small> : null}</dd></div>
      {destino.alias && <CopyRow label="Alias" value={destino.alias}/>}
      <CopyRow label={destino.tipo || 'CBU/CVU'} value={destino.cbu_cvu} mono/>
    </dl>
    {destino.instrucciones && <p className="bank-note">{destino.instrucciones}</p>}
  </div>;
}
