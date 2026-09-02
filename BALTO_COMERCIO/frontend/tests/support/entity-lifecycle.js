import { expect } from '@playwright/test';
import { waitForBusyToFinish } from './ui.js';

function entityConfig(kind) {
  const isClient = kind === 'cliente';
  return {
    singular: isClient ? 'cliente' : 'proveedor',
    plural: isClient ? 'Clientes' : 'Proveedores',
    route: isClient
      ? '/panel/cuentas-corrientes/clientes'
      : '/panel/cuentas-corrientes/proveedores',
    openTitle: isClient ? 'Clientes' : 'Proveedores',
    addLabel: isClient ? 'Agregar cliente' : 'Agregar proveedor',
    editLabel: isClient ? 'Editar cliente' : 'Editar proveedor',
    createLabel: isClient ? /Crear cliente$/i : /Crear proveedor$/i,
    saveLabel: /Guardar$/i,
    searchPlaceholder: isClient
      ? /Buscar por cliente o CUIT/i
      : /Buscar por proveedor o CUIT/i,
  };
}

async function getAdminDialog(page, config) {
  return page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: config.plural, exact: true }) })
    .last();
}

export async function openEntityAdmin(page, kind) {
  const config = entityConfig(kind);
  await page.goto(config.route);
  await waitForBusyToFinish(page);
  await page.getByTitle(config.openTitle).click();
  const dialog = await getAdminDialog(page, config);
  await expect(dialog).toBeVisible();
  return { config, dialog };
}

export async function searchEntityRow(dialog, config, name) {
  const search = dialog.getByPlaceholder(config.searchPlaceholder);
  await expect(search).toBeVisible();
  await search.fill(name);
  const row = dialog.locator('.cc-grid-row').filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

function nameInput(formDialog) {
  return formDialog
    .locator('.cc-entity-form-body input[type="text"]:not([inputmode="numeric"])')
    .last();
}

export async function createEntity(page, kind, name) {
  const { config, dialog } = await openEntityAdmin(page, kind);
  await dialog.getByRole('button', { name: config.addLabel, exact: true }).click();

  const formDialog = page.getByRole('dialog', { name: config.addLabel }).last();
  await expect(formDialog).toBeVisible();
  await nameInput(formDialog).fill(name);

  const responsePromise = page.waitForResponse(
    (response) => {
      const action = new URL(response.url()).searchParams.get('action');
      return response.request().method() === 'POST' && action === (kind === 'cliente' ? 'cc_cliente_crear' : 'cc_proveedor_crear');
    },
    { timeout: 90_000 },
  );

  await formDialog.getByRole('button', { name: config.createLabel }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  await expect(formDialog).toBeHidden({ timeout: 30_000 });

  return searchEntityRow(dialog, config, name);
}

export async function editEntity(page, kind, oldName, newName) {
  const config = entityConfig(kind);
  const dialog = await getAdminDialog(page, config);
  const row = await searchEntityRow(dialog, config, oldName);
  await row.getByTitle('Editar').click();

  const formDialog = page.getByRole('dialog', { name: config.editLabel }).last();
  await expect(formDialog).toBeVisible();
  await nameInput(formDialog).fill(newName);

  const responsePromise = page.waitForResponse(
    (response) => {
      const action = new URL(response.url()).searchParams.get('action');
      return response.request().method() === 'POST' && action === (kind === 'cliente' ? 'cc_cliente_actualizar' : 'cc_proveedor_actualizar');
    },
    { timeout: 90_000 },
  );

  await formDialog.getByRole('button', { name: config.saveLabel }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  await expect(formDialog).toBeHidden({ timeout: 30_000 });

  return searchEntityRow(dialog, config, newName);
}

async function confirmEntityAction(page, kind, action, name) {
  const config = entityConfig(kind);
  const dialog = await getAdminDialog(page, config);
  const row = await searchEntityRow(dialog, config, name);
  const title = action === 'baja' ? 'Dar de baja' : action === 'alta' ? 'Dar de alta' : 'Eliminar';
  await row.getByTitle(title).click();

  const heading = action === 'baja'
    ? new RegExp(`Dar de baja ${config.singular}`, 'i')
    : action === 'alta'
      ? new RegExp(`Dar de alta ${config.singular}`, 'i')
      : new RegExp(`Eliminar ${config.singular}`, 'i');
  const confirmDialog = page.getByRole('dialog').filter({ hasText: heading }).last();
  await expect(confirmDialog).toBeVisible();

  const apiAction = action === 'baja'
    ? `cc_${config.singular}_dar_baja`
    : action === 'alta'
      ? `cc_${config.singular}_dar_alta`
      : `cc_${config.singular}_eliminar`;
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).searchParams.get('action') === apiAction,
    { timeout: 90_000 },
  );

  await confirmDialog.getByRole('button', { name: new RegExp(`^${title}$`, 'i') }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  await expect(confirmDialog).toBeHidden({ timeout: 30_000 });
}

export async function deactivateEntity(page, kind, name) {
  await confirmEntityAction(page, kind, 'baja', name);
  const config = entityConfig(kind);
  const dialog = await getAdminDialog(page, config);
  await dialog.getByRole('button', { name: 'Inactivos', exact: true }).click();
  const row = await searchEntityRow(dialog, config, name);
  await expect(row).toContainText('Inactivo');
}

export async function reactivateEntity(page, kind, name) {
  await confirmEntityAction(page, kind, 'alta', name);
  const config = entityConfig(kind);
  const dialog = await getAdminDialog(page, config);
  await dialog.getByRole('button', { name: 'Activos', exact: true }).click();
  const row = await searchEntityRow(dialog, config, name);
  await expect(row).toContainText('Activo');
}

export async function deleteEntity(page, kind, name) {
  await confirmEntityAction(page, kind, 'eliminar', name);
  const config = entityConfig(kind);
  const dialog = await getAdminDialog(page, config);
  const search = dialog.getByPlaceholder(config.searchPlaceholder);
  await search.fill(name);
  await expect(dialog.locator('.cc-grid-row').filter({ hasText: name })).toHaveCount(0, { timeout: 30_000 });
}
