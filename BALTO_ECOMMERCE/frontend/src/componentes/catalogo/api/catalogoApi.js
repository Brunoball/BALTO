import { apiGet } from '../../global/api/clienteApi';

export const listarProductos = ({ pagina = 1, limite = 12, signal } = {}) =>
  apiGet('catalogo_productos', { pagina, limite }, { signal });

export const obtenerProducto = (slug, signal) =>
  apiGet('catalogo_producto', { slug }, { signal });
