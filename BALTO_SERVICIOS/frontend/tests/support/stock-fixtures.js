// Compatibilidad con suites heredadas de BALTO Comercio.
// En BALTO Servicios el stock físico vive en servicio_articulos (MATERIAL/INSUMO),
// por lo que un "stock product fixture" es ahora un material del inventario de Servicios.
import { createServiceArticleFixture } from './services.js';

export async function createStockProductFixture(page, product = {}) {
  return createServiceArticleFixture(page, {
    type: product.type || 'MATERIAL',
    name: product.name,
    description: product.description || (product.sku ? `REF ${product.sku}` : undefined),
    stock: product.stock,
    cost: product.cost,
    price: product.price,
    ivaPct: product.ivaPct,
    categoryId: product.categoryId,
    idUnit: product.idUnit,
  });
}
