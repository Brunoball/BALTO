import { test, expect } from './support/test.js';
import { expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations } from './support/ui.js';
import { ensureActiveServiceUnit, serviciosApi } from './support/services.js';

async function get(page, action, query = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { query }), `Falló ${action}`);
}
async function post(page, action, body = {}) {
  return expectApiSuccess(await serviciosApi(page, action, { method: 'POST', body }), `Falló ${action}`);
}
async function bestEffort(page, action, body = {}) {
  try { return await serviciosApi(page, action, { method: 'POST', body }); } catch { return null; }
}
function exact(rows, name) {
  const wanted = String(name).trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.nombre || '').trim().toUpperCase() === wanted);
}

test.describe('BALTO Servicios - contrato de acciones genéricas de artículos', () => {
  test('@api @crud categorías/artículos genéricos mantienen todos sus aliases actuales', async ({ page }) => {
    await requireMutations(test, page);
    const unit = await ensureActiveServiceUnit(page);
    const categoryName = uniqueName('CAT-ART-GENERICA', 100);
    const categoryEdited = `${categoryName}-EDIT`.slice(0, 100);
    const articleName = uniqueName('ART-GENERICO', 120);
    const articleEdited = `${articleName}-EDIT`.slice(0, 120);
    let categoryId = 0;
    let articleId = 0;

    try {
      const category = await post(page, 'servicios_articulos_categoria_crear', {
        tipo: 'MATERIAL',
        nombre: categoryName,
        descripcion: 'CATEGORIA GENERICA E2E',
      });
      categoryId = Number(category.id_categoria || category.data?.id_categoria || 0);
      expect(categoryId).toBeGreaterThan(0);

      let categories = (await get(page, 'servicios_articulos_categorias_listar', {
        tipo: 'MATERIAL', activo: 'todos',
      })).categorias;
      expect(exact(categories, categoryName)).toBeTruthy();

      await post(page, 'servicios_articulos_categoria_actualizar', {
        id_categoria: categoryId,
        tipo: 'MATERIAL',
        nombre: categoryEdited,
        descripcion: 'CATEGORIA GENERICA EDITADA',
      });
      await post(page, 'servicios_articulos_categoria_dar_baja', { id_categoria: categoryId, tipo: 'MATERIAL' });
      categories = (await get(page, 'servicios_articulos_categorias_listar', {
        tipo: 'MATERIAL', activo: 0,
      })).categorias;
      expect(exact(categories, categoryEdited)).toBeTruthy();
      await post(page, 'servicios_articulos_categoria_reactivar', { id_categoria: categoryId, tipo: 'MATERIAL' });

      const article = await post(page, 'servicios_articulo_crear', {
        tipo: 'MATERIAL',
        id_categoria: categoryId,
        id_unidad: Number(unit.id_unidad),
        nombre: articleName,
        descripcion: 'ARTICULO GENERICO E2E',
        stock_actual: 4,
        costo_unitario: 80,
        precio_venta: 130,
        iva_pct: 21,
      });
      articleId = Number(article.id_articulo || article.data?.id_articulo || 0);
      expect(articleId).toBeGreaterThan(0);

      let articles = (await get(page, 'servicios_articulos_listar', {
        tipo: 'MATERIAL', activo: 'todos', q: articleName, limit: 200,
      })).articulos;
      expect(exact(articles, articleName)).toBeTruthy();

      const fetched = await get(page, 'servicios_articulo_obtener', { id_articulo: articleId });
      expect(Number(fetched.articulo?.id_articulo)).toBe(articleId);
      expect(fetched.articulo?.tipo).toBe('MATERIAL');

      await post(page, 'servicios_articulo_actualizar', {
        id_articulo: articleId,
        tipo: 'MATERIAL',
        id_categoria: categoryId,
        id_unidad: Number(unit.id_unidad),
        nombre: articleEdited,
        descripcion: 'ARTICULO GENERICO EDITADO',
        costo_unitario: 95,
        precio_venta: 145,
        iva_pct: 10.5,
      });
      const history = await get(page, 'servicios_articulo_historial_precios', { id_articulo: articleId });
      expect(history.historial?.length || 0).toBeGreaterThanOrEqual(2);

      await post(page, 'servicios_articulo_dar_baja', { id_articulo: articleId });
      articles = (await get(page, 'servicios_articulos_listar', {
        tipo: 'MATERIAL', activo: 0, q: articleEdited, limit: 200,
      })).articulos;
      expect(exact(articles, articleEdited)).toBeTruthy();
      await post(page, 'servicios_articulo_reactivar', { id_articulo: articleId });

      await post(page, 'servicios_articulo_eliminar', { id_articulo: articleId });
      articleId = 0;
      await post(page, 'servicios_articulos_categoria_eliminar', { id_categoria: categoryId, tipo: 'MATERIAL' });
      categoryId = 0;
    } finally {
      if (articleId) await bestEffort(page, 'servicios_articulo_eliminar', { id_articulo: articleId });
      if (categoryId) await bestEffort(page, 'servicios_articulos_categoria_eliminar', { id_categoria: categoryId, tipo: 'MATERIAL' });
    }
  });
});
