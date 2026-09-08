import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function openExportDialog(page, titlePattern = /Exportar/i) {
  const trigger = page.locator('.boton-exportar-trigger:visible').first();
  await expect(trigger, 'Debe existir un botón Exportar habilitado').toBeVisible({ timeout: 20_000 });
  await expect(trigger).toBeEnabled();
  await trigger.click();

  const dialog = page.getByRole('dialog').filter({ hasText: titlePattern }).last();
  await expect(dialog, 'Debe abrirse el modal global de exportación').toBeVisible({ timeout: 10_000 });
  return dialog;
}

export async function selectExportScope(dialog, scope) {
  const name = scope === 'all' ? /Exportar todos los registros/i : /Exportar esta página/i;
  const choice = dialog.getByRole('button', { name }).first();
  await expect(choice).toBeVisible();
  await choice.click();
  await expect(choice).toHaveClass(/is-selected/);
  return choice;
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function selectExportFormat(dialog, format) {
  const normalized = String(format || '').trim();
  const choice = dialog
    .locator('.boton-exportar-choice--format')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(normalized)}`, 'i') })
    .first();
  await expect(choice, `Debe existir el formato ${normalized}`).toBeVisible();
  await choice.click();
  await expect(choice).toHaveClass(/is-selected/);
  return choice;
}

export async function downloadFromExportDialog(page, dialog, testInfo, label = 'export') {
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  const submit = dialog.locator('.boton-exportar-modal__submit');
  await expect(submit).toBeEnabled();
  await submit.click();

  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  const safeSuggested = String(suggested || 'archivo').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const output = testInfo.outputPath('exports', `${label}-${Date.now()}-${safeSuggested}`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await download.saveAs(output);
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  return { download, path: output, suggestedFilename: suggested };
}
