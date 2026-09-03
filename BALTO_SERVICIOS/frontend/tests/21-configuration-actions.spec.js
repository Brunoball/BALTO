import { test, expect } from './support/test.js';
import { uniqueName } from './support/data.js';
import { authenticatedApi, expectApiSuccess } from './support/api.js';
import { requireMutations, waitForBusyToFinish } from './support/ui.js';

async function getCalendarConfig(page) {
  const result = await authenticatedApi(page, 'configuracion_calendario_get');
  expectApiSuccess(result, 'No se pudo leer la configuración del calendario');
  return result.body?.config || {};
}


async function cleanupTestUser(page, names) {
  try {
    const list = await authenticatedApi(page, 'configuracion_usuarios_listar');
    if (!list.ok || list.body?.exito === false) return;
    const candidates = Array.isArray(list.body?.usuarios) ? list.body.usuarios : [];
    const expected = new Set(names.map((value) => String(value).trim().toUpperCase()));
    const found = candidates.find((user) => expected.has(String(user?.usuario || '').trim().toUpperCase()));
    const id = Number(found?.idUsuarioMaster || found?.id_usuario_master || 0);
    if (!id) return;
    await authenticatedApi(page, 'configuracion_usuarios_eliminar', {
      method: 'POST',
      body: { idUsuarioMaster: id },
    });
  } catch {
    // Limpieza defensiva: no tapa el error funcional original del test.
  }
}

async function restoreCalendarConfig(page, config) {
  const result = await authenticatedApi(page, 'configuracion_calendario_set', {
    method: 'POST',
    body: {
      modo: config?.modo === 'dias_atras' ? 'dias_atras' : 'mes_completo',
      dias_atras: Math.max(1, Number(config?.dias_atras || 10)),
    },
  });
  expectApiSuccess(result, 'No se pudo restaurar la configuración del calendario');
}

test('@configuracion @crud calendario: guardar, persistir y restaurar', async ({ page }) => {
  await requireMutations(test, page);
  await page.goto('/panel/configuracion/calendario');
  await waitForBusyToFinish(page);
  const original = await getCalendarConfig(page);

  try {
    // El GET directo puede terminar unas milésimas antes que la hidratación del
    // contexto React. Esperamos que la UI muestre el valor real del backend para
    // evitar que un effect tardío revierta el click y vuelva a deshabilitar Guardar.
    const currentCard = page.locator('.cal-metaCard').filter({ hasText: /Estado actual/i }).first();
    await expect(currentCard).toBeVisible({ timeout: 30_000 });
    await expect(currentCard).toContainText(
      original?.modo === 'dias_atras' ? /Últimos N días/i : /Mes completo/i,
      { timeout: 30_000 },
    );

    const targetMode = original?.modo === 'dias_atras' ? 'mes_completo' : 'dias_atras';
    const targetButton = page.getByRole('button', {
      name: targetMode === 'dias_atras' ? /Últimos N días/i : /Mes completo/i,
    });
    await targetButton.click();
    await expect(targetButton).toHaveClass(/cal-actionRow--active/, { timeout: 15_000 });

    if (targetMode === 'dias_atras') {
      const maxAllowed = Math.max(1, new Date().getDate() - 1);
      const daysInput = page.getByLabel('Cantidad de días hacia atrás');
      await daysInput.fill(String(Math.min(2, maxAllowed)));
      await daysInput.blur();
    }

    const saveButton = page.getByRole('button', { name: /Guardar configuración/i });
    await expect(saveButton).toBeEnabled({ timeout: 20_000 });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'configuracion_calendario_set',
      { timeout: 90_000 },
    );
    await saveButton.click();
    const response = await responsePromise;
    expect(response.status()).toBeLessThan(400);

    await expect(page.locator('body')).toContainText(/Configuración guardada correctamente/i);
    const persisted = await getCalendarConfig(page);
    expect(persisted.modo).toBe(targetMode);
  } finally {
    await restoreCalendarConfig(page, original);
  }
});


test('@configuracion tema: cambia, persiste y restaura', async ({ page }) => {
  await requireMutations(test, page);
  await page.goto('/panel/dashboard');
  await waitForBusyToFinish(page);

  const original = await page.locator('html').getAttribute('data-theme') || 'claro';
  const changed = original === 'oscuro' ? 'claro' : 'oscuro';

  try {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'usuario_tema_actualizar',
      { timeout: 45_000 },
    );
    await page.getByRole('button', {
      name: original === 'oscuro' ? /Cambiar a modo claro/i : /Cambiar a modo oscuro/i,
    }).click();
    expect((await responsePromise).status()).toBeLessThan(400);
    await expect(page.locator('html')).toHaveAttribute('data-theme', changed);
  } finally {
    const current = await page.locator('html').getAttribute('data-theme').catch(() => original);
    if (current !== original) {
      const restoreResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).searchParams.get('action') === 'usuario_tema_actualizar',
        { timeout: 45_000 },
      );
      await page.getByRole('button', {
        name: original === 'oscuro' ? /Cambiar a modo oscuro/i : /Cambiar a modo claro/i,
      }).click();
      expect((await restoreResponse).status()).toBeLessThan(400);
      await expect(page.locator('html')).toHaveAttribute('data-theme', original);
    }
  }
});

test('@configuracion @crud usuarios: alta, edición, baja, activación y eliminación', async ({ page }) => {
  await requireMutations(test, page);
  const username = uniqueName('USUARIO', 36);
  const editedUsername = `${username}-E`.slice(0, 40);
  const email = `${username.toLowerCase()}@example.test`;

  try {
    await page.goto('/panel/configuracion/usuarios');
    await waitForBusyToFinish(page);
    await page.getByRole('button', { name: /Agregar usuario/i }).click();

    let dialog = page.getByRole('dialog', { name: 'Agregar usuario' }).last();
    await expect(dialog).toBeVisible();
    const createInputs = dialog.locator('input.mu-input');
    await createInputs.nth(0).fill(username);
    await createInputs.nth(1).fill(email);
    await createInputs.nth(2).fill('Pw!123456');

    let responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'configuracion_usuarios_guardar',
      { timeout: 90_000 },
    );
    await dialog.getByRole('button', { name: /Crear usuario/i }).click();
    expect((await responsePromise).status()).toBeLessThan(400);
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    let row = page.locator('.cfg-users-table tbody tr').filter({ hasText: username }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: /Editar usuario/i }).click();

    dialog = page.getByRole('dialog', { name: 'Editar usuario' }).last();
    await expect(dialog).toBeVisible();
    await dialog.locator('input.mu-input').nth(0).fill(editedUsername);
    responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).searchParams.get('action') === 'configuracion_usuarios_guardar',
      { timeout: 90_000 },
    );
    await dialog.getByRole('button', { name: /Guardar cambios/i }).click();
    expect((await responsePromise).status()).toBeLessThan(400);
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    row = page.locator('.cfg-users-table tbody tr').filter({ hasText: editedUsername }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByRole('button', { name: /^Dar de baja$/i }).click();
    let confirmDialog = page.getByRole('dialog').filter({ hasText: /Dar de baja usuario/i }).last();
    responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('action') === 'configuracion_usuarios_estado',
      { timeout: 90_000 },
    );
    await confirmDialog.getByRole('button', { name: /^Dar de baja$/i }).click();
    expect((await responsePromise).status()).toBeLessThan(400);

    row = page.locator('.cfg-users-table tbody tr').filter({ hasText: editedUsername }).first();
    await expect(row).toContainText('Inactivo');
    await row.getByRole('button', { name: /^Activar$/i }).click();
    confirmDialog = page.getByRole('dialog').filter({ hasText: /Activar usuario/i }).last();
    responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('action') === 'configuracion_usuarios_estado',
      { timeout: 90_000 },
    );
    await confirmDialog.getByRole('button', { name: /^Activar$/i }).click();
    expect((await responsePromise).status()).toBeLessThan(400);

    row = page.locator('.cfg-users-table tbody tr').filter({ hasText: editedUsername }).first();
    await expect(row).toContainText('Activo');
    await row.getByRole('button', { name: /Eliminar usuario/i }).click();
    confirmDialog = page.getByRole('dialog').filter({ hasText: /Eliminar usuario/i }).last();
    responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).searchParams.get('action') === 'configuracion_usuarios_eliminar',
      { timeout: 90_000 },
    );
    await confirmDialog.getByRole('button', { name: /^Eliminar$/i }).click();
    expect((await responsePromise).status()).toBeLessThan(400);
    await expect(page.locator('.cfg-users-table tbody tr').filter({ hasText: editedUsername })).toHaveCount(0, {
      timeout: 30_000,
    });
  } finally {
    await cleanupTestUser(page, [username, editedUsername]);
  }
});
