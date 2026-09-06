import { test, expect } from './support/test.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { uniqueName } from './support/data.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';

async function cfgGet(page, action, query = {}) {
  return expectApiSuccess(await authenticatedApi(page, action, { query }), `Falló ${action}`);
}
async function cfgPost(page, action, body = {}) {
  return expectApiSuccess(
    await authenticatedApi(page, action, { method: 'POST', body }),
    `Falló ${action}`,
  );
}
async function bestEffort(page, action, body = {}) {
  try { return await authenticatedApi(page, action, { method: 'POST', body }); } catch { return null; }
}
function exact(rows, name) {
  const wanted = String(name).trim().toUpperCase();
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.nombre || '').trim().toUpperCase() === wanted);
}

test.describe('Configuración - Listas y categorías de BALTO Servicios', () => {
  test('@smoke @config muestra las cinco listas actuales y su resumen', async ({ page }) => {
    await page.goto('/panel/configuracion/listas-categorias');
    await waitForBusyToFinish(page);

    const resumen = await cfgGet(page, 'config_listas_categorias_resumen_listar', { activo: 'todos' });
    for (const key of ['detalles', 'unidades', 'categorias_servicios', 'categorias_materiales', 'categorias_insumos']) {
      expect(Array.isArray(resumen[key]), `${key} debe formar parte del resumen actual`).toBe(true);
    }

    const tabs = page.getByRole('tablist');
    for (const label of ['Detalles', 'Unidades', 'Cat. servicios', 'Cat. materiales', 'Cat. insumos']) {
      await expect(tabs.getByRole('button', { name: label, exact: true })).toBeVisible();
    }

    for (const [label, addButton] of [
      ['Detalles', 'Agregar detalle'],
      ['Unidades', 'Agregar unidad'],
      ['Cat. servicios', 'Agregar categoría'],
      ['Cat. materiales', 'Agregar categoría'],
      ['Cat. insumos', 'Agregar categoría'],
    ]) {
      await tabs.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('button', { name: addButton, exact: true }).first()).toBeVisible();
    }
  });

  test('@crud @critical detalles y unidades: alta, edición, baja, reactivación y borrado', async ({ page }) => {
    await page.goto('/panel/configuracion/listas-categorias');
    await waitForBusyToFinish(page);
    await requireMutations(test, page);

    const detailName = uniqueName('DETALLE-LISTA', 120);
    const detailEdited = `${detailName}-EDIT`.slice(0, 120);
    const unitName = uniqueName('UNIDAD-LISTA', 70);
    const unitEdited = `${unitName}-EDIT`.slice(0, 70);
    let detailId = 0;
    let unitId = 0;

    try {
      const detail = await cfgPost(page, 'config_listas_categorias_detalle_crear', { nombre: detailName });
      detailId = Number(detail.id_detalle || detail.data?.id_detalle || 0);
      expect(detailId).toBeGreaterThan(0);
      let details = (await cfgGet(page, 'config_listas_categorias_detalles_listar', { activo: 'todos' })).detalles;
      expect(exact(details, detailName)).toBeTruthy();

      await cfgPost(page, 'config_listas_categorias_detalle_actualizar', { id_detalle: detailId, nombre: detailEdited });
      await cfgPost(page, 'config_listas_categorias_detalle_dar_baja', { id_detalle: detailId });
      details = (await cfgGet(page, 'config_listas_categorias_detalles_listar', { activo: 0 })).detalles;
      expect(exact(details, detailEdited)).toBeTruthy();
      await cfgPost(page, 'config_listas_categorias_detalle_reactivar', { id_detalle: detailId });

      const unit = await cfgPost(page, 'config_listas_categorias_unidad_crear', {
        nombre: unitName,
        simbolo: `C${Date.now().toString(36).slice(-5)}`.toUpperCase(),
      });
      unitId = Number(unit.id_unidad || unit.data?.id_unidad || 0);
      expect(unitId).toBeGreaterThan(0);
      let units = (await cfgGet(page, 'config_listas_categorias_unidades_listar', { activo: 'todos' })).unidades;
      expect(exact(units, unitName)).toBeTruthy();

      await cfgPost(page, 'config_listas_categorias_unidad_actualizar', {
        id_unidad: unitId,
        nombre: unitEdited,
        simbolo: 'CFG',
      });
      await cfgPost(page, 'config_listas_categorias_unidad_dar_baja', { id_unidad: unitId });
      units = (await cfgGet(page, 'config_listas_categorias_unidades_listar', { activo: 0 })).unidades;
      expect(exact(units, unitEdited)).toBeTruthy();
      await cfgPost(page, 'config_listas_categorias_unidad_reactivar', { id_unidad: unitId });

      const tabs = page.getByRole('tablist');
      await tabs.getByRole('button', { name: 'Detalles', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Agregar detalle', exact: true }).first()).toBeVisible();
      await tabs.getByRole('button', { name: 'Unidades', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Agregar unidad', exact: true }).first()).toBeVisible();
    } finally {
      if (detailId) await bestEffort(page, 'config_listas_categorias_detalle_eliminar', { id_detalle: detailId });
      if (unitId) await bestEffort(page, 'config_listas_categorias_unidad_eliminar', { id_unidad: unitId });
    }
  });

  test('@crud @critical categorías de servicio, material e insumo: ciclo completo por grupo', async ({ page }) => {
    await page.goto('/panel/configuracion/listas-categorias');
    await waitForBusyToFinish(page);
    await requireMutations(test, page);

    const groups = [
      { group: 'SERVICIO', list: 'config_listas_categorias_categorias_servicios_listar', tab: 'Cat. servicios' },
      { group: 'MATERIAL', list: 'config_listas_categorias_categorias_materiales_listar', tab: 'Cat. materiales' },
      { group: 'INSUMO', list: 'config_listas_categorias_categorias_insumos_listar', tab: 'Cat. insumos' },
    ];
    const created = [];

    try {
      for (const cfg of groups) {
        const name = uniqueName(`CFG-CAT-${cfg.group}`, 100);
        const edited = `${name}-EDIT`.slice(0, 100);
        const result = await cfgPost(page, 'config_listas_categorias_categoria_crear', {
          grupo: cfg.group,
          nombre: name,
          descripcion: `CATEGORIA ${cfg.group} E2E`,
        });
        const id = Number(result.id_categoria || result.data?.id_categoria || 0);
        expect(id).toBeGreaterThan(0);
        created.push({ ...cfg, id, name: edited });

        let categories = (await cfgGet(page, cfg.list, { activo: 'todos' })).categorias;
        expect(exact(categories, name)).toBeTruthy();
        await cfgPost(page, 'config_listas_categorias_categoria_actualizar', {
          grupo: cfg.group,
          id_categoria: id,
          nombre: edited,
          descripcion: `CATEGORIA ${cfg.group} EDITADA`,
        });
        await cfgPost(page, 'config_listas_categorias_categoria_dar_baja', { grupo: cfg.group, id_categoria: id });
        categories = (await cfgGet(page, cfg.list, { activo: 0 })).categorias;
        expect(exact(categories, edited)).toBeTruthy();
        await cfgPost(page, 'config_listas_categorias_categoria_reactivar', { grupo: cfg.group, id_categoria: id });

        await page.getByRole('tablist').getByRole('button', { name: cfg.tab, exact: true }).click();
        await expect(page.getByRole('button', { name: 'Agregar categoría', exact: true }).first()).toBeVisible();
      }
    } finally {
      for (const item of created.reverse()) {
        await bestEffort(page, 'config_listas_categorias_categoria_eliminar', {
          grupo: item.group,
          id_categoria: item.id,
        });
      }
    }
  });
});
