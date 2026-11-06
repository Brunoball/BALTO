import { apiGet } from './apiClient';
export const consultarTienda = (signal) => apiGet('tienda_configuracion', {}, { signal });
