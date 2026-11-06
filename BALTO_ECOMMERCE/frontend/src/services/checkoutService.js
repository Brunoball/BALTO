import { apiPost } from './apiClient';
import { itemsForServer } from '../utils/cart';

/**
 * Crea un pedido PENDIENTE en la base eCommerce. El servidor recalcula todo:
 * `total_esperado` solo sirve para detectar que el comprador vio un total distinto.
 */
export const crearPedido = ({ claveIdempotencia, comprador, items, totalEsperado, website = '' }, signal) =>
  apiPost('checkout_crear', {
    clave_idempotencia: claveIdempotencia,
    comprador,
    items: itemsForServer(items),
    total_esperado: totalEsperado,
    website,
  }, { signal });
