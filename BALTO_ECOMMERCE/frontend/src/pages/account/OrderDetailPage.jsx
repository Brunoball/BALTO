import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, PackageSearch } from 'lucide-react';
import { obtenerPedido } from '../../services/clienteService';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/StateView';
import { formatQuantity } from '../../utils/cart';
import { precioARS } from '../../utils/format';
import { PAISES } from '../../utils/geografia';
import { estadoPago, estadoPedido, fechaPedido, modalidadEntrega, tonoEstado } from '../../utils/orderStatus';
import AccountLayout from './AccountLayout';
import PaymentStatus from '../../components/payment/PaymentStatus';
import { estadoPagoTexto, tonoPago } from '../../utils/paymentRules';

/** /mi-cuenta/pedidos/:numero — detalle de un pedido PROPIO (el servidor valida la propiedad). */
export default function OrderDetailPage() {
  const { numero } = useParams();
  const [state, setState] = useState({ cargando: true, error: null, pedido: null });
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState({ cargando: true, error: null, pedido: null });
    obtenerPedido(numero, c.signal)
      .then((d) => setState({ cargando: false, error: null, pedido: d.pedido }))
      .catch((error) => { if (error.name !== 'AbortError') setState({ cargando: false, error, pedido: null }); });
    return () => c.abort();
  }, [numero, rev]);
  const p = state.pedido;
  return <AccountLayout title={p ? `Pedido #${p.numero}` : 'Detalle del pedido'} eyebrow="MIS PEDIDOS">
    <Link to="/mi-cuenta/pedidos" className="back-to-catalog"><ArrowLeft size={16}/> Volver a mis pedidos</Link>
    {state.cargando ? <LoadingState compact message="Cargando el pedido…"/>
      : state.error ? (state.error.status === 404
        ? <EmptyState icon={PackageSearch} title="No encontramos ese pedido en tu cuenta" description="Revisá el número o volvé al listado de tus pedidos."/>
        : <ErrorState error={state.error} retry={() => setRev((n) => n + 1)}/>)
        : <div className="order-detail">
          <section className="account-card">
            <div className="order-detail-status">
              <span className={`status-chip is-${tonoEstado(p.estado)}`}>{estadoPedido(p.estado)}</span>
              {p.pago
                ? <span className={`status-chip is-soft is-${tonoPago(p.pago.estado, p.pago.estado_comprobante)}`}>{estadoPagoTexto(p.pago.metodo, p.pago.estado, p.pago.estado_comprobante)}</span>
                : <span className={`status-chip is-soft is-${tonoEstado(p.estado_pago)}`}>{estadoPago(p.estado_pago)}</span>}
              {p.es_prueba && <span className="status-chip is-test">Pedido de prueba</span>}
            </div>
            <dl className="order-facts">
              <div><dt>Fecha</dt><dd>{fechaPedido(p.fecha)}</dd></div>
              <div><dt>Entrega</dt><dd>{modalidadEntrega(p.modalidad_entrega)}</dd></div>
              <div><dt>Contacto</dt><dd>{p.contacto?.nombre}{p.contacto?.telefono ? ` · ${p.contacto.telefono}` : ''}</dd></div>
            </dl>
            {p.entrega && <div className="order-address"><MapPin size={17}/><div>
              <strong>{p.entrega.direccion}</strong>
              <span>{[p.entrega.localidad, p.entrega.provincia, p.entrega.codigo_postal ? `CP ${p.entrega.codigo_postal}` : null, p.entrega.pais ? (PAISES[p.entrega.pais] || p.entrega.pais) : null].filter(Boolean).join(' · ')}</span>
              {(p.entrega.destinatario || p.entrega.telefono) && <small>Recibe: {[p.entrega.destinatario, p.entrega.telefono].filter(Boolean).join(' · ')}</small>}
              {p.entrega.referencias && <small>{p.entrega.referencias}</small>}
            </div></div>}
            {p.observaciones && <p className="muted-small">Observaciones: {p.observaciones}</p>}
          </section>
          {p.pago && <section className="account-card order-payment">
            <PaymentStatus numero={p.numero} pago={p.pago} modalidad={p.modalidad_entrega}
              onChange={(pago) => setState((s) => ({ ...s, pedido: { ...s.pedido, pago, estado_pago: pago.estado } }))}/>
          </section>}
          <section className="order-summary" aria-labelledby="detalle-productos">
            <h2 id="detalle-productos">Productos</h2>
            <ul className="order-summary-lines">
              {p.items.map((it, i) => <li key={i}><span>{it.nombre}{it.variante ? ` · ${it.variante}` : ''}<small>{formatQuantity(it.cantidad, Number(it.cantidad) % 1 !== 0)} × {precioARS(it.precio_unitario, p.moneda)}</small></span><strong>{precioARS(it.total, p.moneda)}</strong></li>)}
            </ul>
            <dl className="order-summary-totals">
              <div><dt>Subtotal</dt><dd>{precioARS(p.subtotal, p.moneda)}</dd></div>
              <div><dt>Envío</dt><dd>{p.modalidad_entrega === 'RETIRO' ? 'Retiro en el local' : 'A coordinar con la tienda'}</dd></div>
              <div className="order-summary-total"><dt>Total</dt><dd>{precioARS(p.total, p.moneda)}</dd></div>
            </dl>
            <p className="order-summary-note">{p.pago ? 'El estado del pago lo confirma la tienda: un comprobante enviado no significa que el pago esté acreditado.' : 'No se realizaron cobros online. La tienda coordina con vos el pago y, si corresponde, el costo de envío.'}</p>
          </section>
        </div>}
  </AccountLayout>;
}
