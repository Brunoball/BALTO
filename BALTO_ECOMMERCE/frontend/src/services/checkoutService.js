import { apiPost } from './apiClient';
import { itemsForServer } from '../utils/cart';

/**
 * Crea un pedido PENDIENTE en la base eCommerce. El servidor recalcula todo:
 * `total_esperado` solo sirve para detectar que el comprador vio un total distinto.
 * Con sesión, `cuenta: 'CLIENTE'` + `cliente_esperado` (la cuenta que la persona VE en
 * pantalla). El servidor toma el id del cliente SOLO de la cookie de sesión.
 */
export const crearPedido = ({
  claveIdempotencia, comprador, items, totalEsperado, website = '', pago,
  cuenta = 'INVITADO', cliente_esperado: clienteEsperado, guardar_direccion: guardarDireccion, guardar_telefono: guardarTelefono,
}, signal) => apiPost('checkout_crear', {
  clave_idempotencia: claveIdempotencia,
  comprador,
  items: itemsForServer(items),
  total_esperado: totalEsperado,
  website,
  cuenta,
  ...(pago ? { pago } : {}),
  ...(cuenta === 'CLIENTE' ? { cliente_esperado: clienteEsperado, guardar_direccion: Boolean(guardarDireccion), guardar_telefono: Boolean(guardarTelefono) } : {}),
}, { signal });
