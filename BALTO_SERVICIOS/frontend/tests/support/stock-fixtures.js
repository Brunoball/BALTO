// Compatibilidad con suites heredadas de BALTO Comercio.
// En BALTO Servicios el stock físico vive en servicio_articulos. Los fixtures de producto
// usan el tipo PRODUCTO, que pertenece a Stock de forma independiente y siempre controla existencias.
import { createServiceArticleFixture } from './services.js';

export async function createStockProductFixture(page, product = {}) {
  return createServiceArticleFixture(page, {
    type: product.type || 'PRODUCTO',
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
