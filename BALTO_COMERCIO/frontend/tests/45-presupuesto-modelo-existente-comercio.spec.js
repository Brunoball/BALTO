import { test, expect } from './support/test.js';

// Sólo interfaz: la respuesta de modelos se simula; no crea ni elimina datos reales.
test('@presupuesto Comercio no duplica un modelo de presupuesto ya cargado', async ({ page }) => {
  const nombre = 'MODELO E2E NO DUPLICAR';
  await page.route((url) => url.searchParams.get('action') === 'presupuestos_modelos_listar', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        exito: true,
        modelos: [{
          id_modelo: 98234001,
          nombre,
          descripcion: 'PRUEBA INTERFAZ COMERCIO',
          es_personalizado: 1,
          cantidad_items: 1,
          total_modelo: 1500,
          items: [{ descripcion: 'DETALLE MODELO DE PRUEBA', cantidad: 1, precio: 1500, iva_pct: 0 }],
        }],
      }),
    });
  });

  await page.goto('/panel/presupuesto');
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).click();
  const modal = page.locator('.presupuesto-modal[role="dialog"]');
  const guardarComoModelo = modal.getByText('Guardar también como modelo base');
  await expect(modal).toBeVisible();

  // Sin modelo cargado, debe permitirse crear uno nuevo.
  await expect(guardarComoModelo).toBeVisible();
  await guardarComoModelo.click();
  await expect(modal.getByText('Nombre del modelo *')).toBeVisible();

  // Cargar un modelo mientras la casilla estaba marcada no debe duplicarlo.
  await modal.getByRole('button', { name: 'Ver modelos de presupuesto' }).click();
  const modelos = page.getByRole('dialog', { name: 'Modelos de presupuesto' });
  await expect(modelos).toBeVisible();
  await modelos.getByRole('button', { name: `Usar modelo ${nombre}` }).click();
  await expect(modal).toContainText(`Modelo cargado: ${nombre}`);
  await expect(modal.locator('.gm-table-cell--detail input').first()).toHaveValue('DETALLE MODELO DE PRUEBA');
  await expect(guardarComoModelo).toHaveCount(0);
  await expect(modal.getByText('Nombre del modelo *')).toHaveCount(0);
  await expect(modal).toContainText('Se guarda como presupuesto y genera PDF');

  // Al cerrar y abrir un presupuesto vacío se vuelve a ofrecer la opción.
  await modal.getByRole('button', { name: 'Cerrar' }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).click();
  await expect(guardarComoModelo).toBeVisible();
});
