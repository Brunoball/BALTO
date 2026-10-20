import { test, expect } from './support/test.js';

// Flujo de solo lectura: la lista de modelos se simula en el navegador.
// No genera presupuestos ni escribe modelos en la base de datos.
test('@presupuesto modelo existente no ofrece guardarse como modelo base duplicado', async ({ page }) => {
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
          descripcion: 'PRUEBA SOLO DE INTERFAZ',
          es_personalizado: 1,
          cantidad_items: 1,
          total_modelo: 1500,
          items: [{ tipo_item: 'MANUAL', descripcion: 'DETALLE MODELO DE PRUEBA', cantidad: 1, precio: 1500, iva_pct: 0 }],
        }],
      }),
    });
  });

  await page.goto('/panel/presupuesto');
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).click();
  const modal = page.locator('.presupuesto-modal[role="dialog"]');
  const tituloCheckbox = modal.getByText('Guardar también como modelo base');
  await expect(modal).toBeVisible();

  // Desde cero, sigue existiendo la posibilidad legítima de crear un modelo nuevo.
  await expect(tituloCheckbox).toBeVisible();
  await tituloCheckbox.click();
  await expect(modal.getByText('Nombre del modelo *')).toBeVisible();

  // Al aplicar un modelo existente incluso desde un formulario que tenía
  // el checkbox activo, no se debe ofrecer duplicarlo.
  await modal.getByRole('button', { name: 'Ver modelos de presupuesto' }).click();
  const modelos = page.getByRole('dialog', { name: 'Modelos de presupuesto' });
  await expect(modelos).toBeVisible();
  await modelos.getByRole('button', { name: `Usar modelo ${nombre}` }).click();
  await expect(modal).toContainText(`Modelo cargado: ${nombre}`);
  // El detalle se carga en el valor de un input, no como texto de un nodo HTML.
  await expect(modal.getByPlaceholder('Escribí el detalle…')).toHaveValue('DETALLE MODELO DE PRUEBA');
  await expect(tituloCheckbox).toHaveCount(0);
  await expect(modal.getByText('Nombre del modelo *')).toHaveCount(0);
  await expect(modal).toContainText('Se guarda como presupuesto y genera PDF');

  // Al volver a abrir un presupuesto vacío, la opción regresa.
  await modal.getByRole('button', { name: 'Cerrar' }).click();
  await expect(modal).toBeHidden();
  await page.getByRole('button', { name: 'Nuevo presupuesto' }).click();
  await expect(tituloCheckbox).toBeVisible();
  await expect(modal.getByText('Modelo cargado:')).toHaveCount(0);
});
