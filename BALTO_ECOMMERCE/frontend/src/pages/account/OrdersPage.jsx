import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { listarPedidos } from '../../services/clienteService';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/StateView';
import { precioARS } from '../../utils/format';
import { estadoPago, estadoPedido, fechaPedido, modalidadEntrega, tonoEstado } from '../../utils/orderStatus';
import AccountLayout from './AccountLayout';
import { estadoPagoTexto, METODOS, tonoPago } from '../../utils/paymentRules';

const LIMITE = 10;

/** /mi-cuenta/pedidos — historial privado, paginado en el servidor. */
export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const pagina = Math.max(1, Math.min(1000, parseInt(params.get('pagina') || '1', 10) || 1));
  const [state, setState] = useState({ cargando: true, error: null, pedidos: [], paginacion: null });
  const [rev, setRev] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setState((s) => ({ ...s, cargando: true, error: null }));
    listarPedidos(pagina, LIMITE, c.signal)
      .then((d) => setState({ cargando: false, error: null, pedidos: d.pedidos || [], paginacion: d.paginacion }))
      .catch((error) => { if (error.name !== 'AbortError') setState((s) => ({ ...s, cargando: false, error })); });
    return () => c.abort();
  }, [pagina, rev]);
  const ir = (p) => { setParams(p > 1 ? { pagina: String(p) } : {}); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const pg = state.paginacion;
  return <AccountLayout title="Mis pedidos" description="Pedidos realizados con tu cuenta en esta tienda. Los pedidos se registran como pendientes: la tienda confirma disponibilidad, entrega y pago.">
    {state.cargando ? <LoadingState compact message="Cargando tus pedidos…"/>
      : state.error ? <ErrorState error={state.error} retry={() => setRev((n) => n + 1)}/>
        : state.pedidos.length === 0 ? <><EmptyState icon={Package} title="Todavía no hiciste pedidos con tu cuenta" description="Los pedidos que hagas con la sesión iniciada aparecerán acá. Las compras como invitado no se asocian automáticamente."/><div className="standard-page-action"><Link to="/catalogo" className="btn btn-dark">Ver productos</Link></div></>
          : <>
            <ul className="orders-list">
              {state.pedidos.map((p) => <li key={p.numero} className="order-row">
                <div className="order-row-main">
                  <span className="order-number">#{p.numero}{p.es_prueba && <em className="order-test">Prueba</em>}</span>
                  <span className="order-date">{fechaPedido(p.fecha)} · {modalidadEntrega(p.modalidad_entrega)}{p.metodo_pago ? ` · ${METODOS[p.metodo_pago]?.nombre || p.metodo_pago}` : ''}</span>
                  <span className="order-products">{p.productos.map((it) => `${it.nombre}${it.variante ? ` (${it.variante})` : ''} × ${Number(it.cantidad).toLocaleString('es-AR')}`).join(' · ')}{p.cantidad_lineas > p.productos.length ? ` y ${p.cantidad_lineas - p.productos.length} más` : ''}</span>
                </div>
                <div className="order-row-side">
                  <span className={`status-chip is-${tonoEstado(p.estado)}`}>{estadoPedido(p.estado)}</span>
                  {p.metodo_pago
                    ? <span className={`status-chip is-soft is-${tonoPago(p.estado_pago, p.estado_comprobante)}`} title={METODOS[p.metodo_pago]?.nombre}>{estadoPagoTexto(p.metodo_pago, p.estado_pago, p.estado_comprobante)}</span>
                    : <span className={`status-chip is-soft is-${tonoEstado(p.estado_pago)}`}>{estadoPago(p.estado_pago)}</span>}
                  <strong>{precioARS(p.total, p.moneda)}</strong>
                  <Link to={`/mi-cuenta/pedidos/${encodeURIComponent(p.numero)}`} className="btn btn-outline btn-small">Ver detalle</Link>
                </div>
              </li>)}
            </ul>
            {pg && pg.paginas > 1 && <nav className="account-pagination" aria-label="Paginación de pedidos">
              <button type="button" className="btn btn-outline btn-small" onClick={() => ir(pagina - 1)} disabled={pagina <= 1}><ChevronLeft size={16}/> Anterior</button>
              <span>Página {pg.pagina} de {pg.paginas}</span>
              <button type="button" className="btn btn-outline btn-small" onClick={() => ir(pagina + 1)} disabled={pagina >= pg.paginas}>Siguiente <ChevronRight size={16}/></button>
            </nav>}
          </>}
  </AccountLayout>;
}
