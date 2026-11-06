import { apiPost } from './apiClient';
import { itemsForServer } from '../utils/cart';

/** Precios, stock y estado ACTUALES de cada línea según Comercio. No reserva stock. */
export const validarCarrito = (items, signal) =>
  apiPost('carrito_validar', { items: itemsForServer(items) }, { signal });
