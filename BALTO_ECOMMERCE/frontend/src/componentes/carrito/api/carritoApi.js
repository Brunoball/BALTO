import { apiPost } from '../../global/api/clienteApi';
import { itemsForServer } from '../utilidades/carrito';

/** Precios, stock y estado ACTUALES de cada línea según Comercio. No reserva stock. */
export const validarCarrito = (items, signal) =>
  apiPost('carrito_validar', { items: itemsForServer(items) }, { signal });
