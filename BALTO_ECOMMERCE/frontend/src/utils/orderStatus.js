/**
 * Etiquetas de estados que el sistema REALMENTE usa hoy (todo pedido web nace
 * PENDIENTE / pago PENDIENTE). Cualquier otro valor que cargue la tienda se
 * muestra tal cual, sin inventar significados.
 */
const ESTADOS = { PENDIENTE: 'Pendiente de confirmación', CONFIRMADO: 'Confirmado', APROBADO: 'Aprobado', CANCELADO: 'Cancelado', ENTREGADO: 'Entregado' };
const PAGOS = { PENDIENTE: 'Pago a coordinar', APROBADO: 'Pago aprobado', PAGADO: 'Pagado', RECHAZADO: 'Pago rechazado' };
const ENTREGAS = { A_COORDINAR: 'A coordinar con la tienda', RETIRO: 'Retiro en el local', ENVIO: 'Envío a domicilio' };

const humanizar = (v) => String(v || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const estadoPedido = (v) => ESTADOS[v] || humanizar(v);
export const estadoPago = (v) => PAGOS[v] || humanizar(v);
export const modalidadEntrega = (v) => ENTREGAS[v] || humanizar(v);
export function tonoEstado(v) {
  if (v === 'CANCELADO' || v === 'RECHAZADO') return 'danger';
  if (v === 'PENDIENTE') return 'pending';
  return 'ok';
}

export function fechaPedido(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
  if (!m) return String(v || '');
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}
