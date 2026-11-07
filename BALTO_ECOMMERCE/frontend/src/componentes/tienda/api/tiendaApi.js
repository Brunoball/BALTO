import { apiGet } from '../../global/api/clienteApi';
export const consultarTienda = (signal) => apiGet('tienda_configuracion', {}, { signal });
