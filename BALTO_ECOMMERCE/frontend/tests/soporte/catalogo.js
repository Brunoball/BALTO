// Descubre productos REALES publicados en la tienda: los tests se adaptan a lo que haya
// (no se inventan datos). Si falta un caso, el test se salta con el motivo.
const { apiGet, expectExito } = require('./api');

async function productos(request, { pagina = 1, limite = 40 } = {}) {
  // Si la API falla (ej. 500) el test FALLA: no se disfraza de "no hay productos" ni se salta.
  const r = expectExito(await apiGet(request, 'catalogo_productos', { pagina, limite }), 'catalogo_productos debe responder para descubrir productos');
  return Array.isArray(r.productos) ? r.productos : [];
}

const disponibles = (p) => (p.variantes || []).filter((v) => v.disponible && Number(v.precio) > 0);

const elegir = {
  simple: (ps, minimo = 3) => ps.find((p) => !p.tiene_variantes && p.disponible && Number(p.precio) > 0 && !p.unidad?.permite_decimales && Number(p.cantidad_maxima) >= minimo),
  simpleConTope: (ps) => ps.find((p) => !p.tiene_variantes && p.disponible && Number(p.precio) > 0 && !p.unidad?.permite_decimales && Number(p.cantidad_maxima) >= 1 && Number(p.cantidad_maxima) < 999),
  variantes: (ps) => ps.find((p) => p.tiene_variantes && disponibles(p).length >= 1),
  dosVariantes: (ps) => ps.find((p) => p.tiene_variantes && disponibles(p).length >= 2),
  decimal: (ps) => ps.find((p) => !p.tiene_variantes && p.disponible && Number(p.precio) > 0 && p.unidad?.permite_decimales && Number(p.cantidad_maxima) >= 1.5),
  sinImagen: (ps) => ps.find((p) => !p.imagen_url),
  conImagen: (ps) => ps.find((p) => typeof p.imagen_url === 'string' && /X-Amz-Signature=|action=producto_imagen/.test(p.imagen_url)),
  sinStock: (ps) => ps.find((p) => !p.disponible),
};

module.exports = { productos, elegir, disponibles };
