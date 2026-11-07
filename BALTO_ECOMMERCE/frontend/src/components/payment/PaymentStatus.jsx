import React, { useState } from 'react';
import { AlertTriangle, Clock, Download, FileText, ShieldCheck } from 'lucide-react';
import { descargarComprobante } from '../../services/paymentService';
import { estadoPagoTexto, METODOS, tamanoLegible, tonoPago } from '../../utils/paymentRules';
import { fechaPedido } from '../../utils/orderStatus';
import BankTransferDetails from './BankTransferDetails';
import PaymentProofUploader from './PaymentProofUploader';

const ESTADO_COMP = { PENDIENTE: 'En revisión', APROBADO: 'Aprobado', RECHAZADO: 'Rechazado' };

/**
 * Estado del pago de un pedido (datos REALES del servidor). Para transferencias:
 * cuenta original del pedido, comprobantes enviados y carga cuando corresponde.
 * Nunca ofrece "marcar como pagado".
 */
export default function PaymentStatus({ numero, pago, modalidad, token = null, maxBytes, onChange }) {
  const [subiendo, setSubiendo] = useState(false);
  const [recibido, setRecibido] = useState(false);
  const [descargaError, setDescargaError] = useState(null);
  if (!pago) return null;
  const esTransfer = pago.metodo === 'TRANSFERENCIA_BANCARIA';
  const tono = tonoPago(pago.estado, pago.estado_comprobante);
  const Icon = tono === 'ok' ? ShieldCheck : tono === 'danger' ? AlertTriangle : Clock;
  const ultimo = pago.comprobantes?.[0];
  const bajar = async (c) => {
    setDescargaError(null);
    try {
      const blob = await descargarComprobante(numero, c.id, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = c.nombre || 'comprobante';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setDescargaError(e.message); }
  };
  return <section className="payment-status" aria-labelledby={`pago-${numero}`}>
    <div className={`payment-status-head is-${tono}`}>
      <Icon size={20}/>
      <div>
        <h3 id={`pago-${numero}`}>{METODOS[pago.metodo]?.nombre || pago.metodo}</h3>
        <span data-testid="payment-state">{estadoPagoTexto(pago.metodo, pago.estado, pago.estado_comprobante)}</span>
      </div>
    </div>
    {pago.metodo === 'EFECTIVO' && <p className="payment-text">
      {modalidad === 'RETIRO' ? 'Pagás en efectivo cuando retirás tu compra. La tienda te avisará cuándo está lista.'
        : modalidad === 'ENVIO' ? 'Pagás en efectivo al recibir tu compra. La tienda se comunicará para confirmar las condiciones de entrega.'
          : 'Pagás en efectivo al concretar la entrega que coordines con la tienda.'}
      {pago.estado === 'PAGADO' && ' La tienda registró el pago.'}
    </p>}
    {esTransfer && pago.estado !== 'PAGADO' && <BankTransferDetails destino={pago.destino} importe={pago.importe} moneda={pago.moneda} alcance={pago.alcance} compact/>}
    {esTransfer && ultimo?.estado === 'RECHAZADO' && pago.estado === 'PENDIENTE' && <div className="checkout-banner is-warning" role="alert">
      <span><strong>Tu comprobante fue rechazado.</strong> {ultimo.motivo_rechazo ? `Motivo: ${ultimo.motivo_rechazo}. ` : ''}Podés enviar uno nuevo.</span>
    </div>}
    {esTransfer && (pago.estado === 'EN_REVISION' || recibido) && pago.estado !== 'PAGADO' && <div className="payment-received" role="status">
      <strong>¡Recibimos tu comprobante!</strong>
      <span>Tu pago está pendiente de verificación. El comercio revisará la transferencia y te confirmará cuando el dinero esté acreditado.</span>
    </div>}
    {esTransfer && pago.estado === 'PAGADO' && <p className="payment-text">El comercio verificó la acreditación de tu transferencia{pago.pagado_en ? ` el ${fechaPedido(pago.pagado_en)}` : ''}.</p>}
    {esTransfer && pago.puede_subir_comprobante && (subiendo
      ? <PaymentProofUploader numero={numero} token={token} maxBytes={maxBytes} onCancel={() => setSubiendo(false)}
        onUploaded={(data) => { setSubiendo(false); setRecibido(true); onChange?.(data.pago); }}/>
      : <button type="button" className="btn btn-dark payment-upload-cta" onClick={() => setSubiendo(true)} data-testid="proof-open">
        {ultimo ? 'Enviar otro comprobante' : 'Ya transferí — Subir comprobante'}
      </button>)}
    {esTransfer && pago.comprobantes?.length > 0 && <ul className="proof-list" aria-label="Comprobantes enviados">
      {pago.comprobantes.map((c) => <li key={c.id}>
        <FileText size={16}/>
        <span><strong>{c.nombre}</strong><small>{fechaPedido(c.subido_en)} · {tamanoLegible(c.tamano_bytes)}</small></span>
        <em className={`status-chip is-soft is-${c.estado === 'APROBADO' ? 'ok' : c.estado === 'RECHAZADO' ? 'danger' : 'pending'}`}>{ESTADO_COMP[c.estado] || c.estado}</em>
        <button type="button" className="icon-button" onClick={() => bajar(c)} aria-label={`Descargar ${c.nombre}`}><Download size={15}/></button>
      </li>)}
    </ul>}
    {descargaError && <p className="field-error" role="alert">{descargaError}</p>}
  </section>;
}
