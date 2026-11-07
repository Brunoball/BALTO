import { apiGet, apiPost } from '../../global/api/clienteApi';

/** Área privada del comprador: el servidor identifica al cliente por la sesión, nunca por un id enviado. */
export const obtenerPerfil = (signal) => apiGet('cliente_perfil', {}, { signal });
export const actualizarPerfil = (datos) => apiPost('cliente_actualizar', datos);
export const listarDirecciones = (signal) => apiGet('cliente_direcciones', {}, { signal });
export const guardarDireccion = (direccion) => apiPost('cliente_direccion_guardar', direccion);
export const eliminarDireccion = (id) => apiPost('cliente_direccion_eliminar', { id });
export const predeterminarDireccion = (id) => apiPost('cliente_direccion_predeterminada', { id });
export const listarPedidos = (pagina = 1, limite = 10, signal) => apiGet('cliente_pedidos', { pagina, limite }, { signal });
export const obtenerPedido = (numero, signal) => apiGet('cliente_pedido_detalle', { numero }, { signal });
