import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertFrontendUsesConfiguredBackend, waitDialog } from './support/ui.js';

const sourcePath = (...parts) => path.resolve(process.cwd(), 'src', ...parts);

async function readSource(...parts) {
  return fs.readFile(sourcePath(...parts), 'utf8');
}

function expectModalBeforeAsync(source, {
  label,
  handlerToken,
  openToken,
  asyncToken,
  windowSize = 7000,
}) {
  const handlerIndex = source.indexOf(handlerToken);
  expect(handlerIndex, `${label}: debe existir ${handlerToken}`).toBeGreaterThanOrEqual(0);

  const scope = source.slice(handlerIndex, handlerIndex + windowSize);
  const openIndex = scope.indexOf(openToken);
  const asyncIndex = scope.indexOf(asyncToken);

  expect(openIndex, `${label}: debe abrir el modal`).toBeGreaterThanOrEqual(0);
  expect(asyncIndex, `${label}: debe resolver el comprobante en segundo plano`).toBeGreaterThanOrEqual(0);
  expect(
    openIndex,
    `${label}: el modal debe abrir antes de esperar URL firmada/PDF`,
  ).toBeLessThan(asyncIndex);
}

test('@smoke el frontend local usa el backend configurado', async ({ page }) => {
  await assertFrontendUsesConfiguredBackend(page);
});

test('@smoke los modales no se cierran al hacer clic fuera y sí con Escape', async ({ page }) => {
  await page.goto('/panel/ventas');
  await page.getByRole('button', { name: /Nueva Venta/i }).click();
  const dialog = await waitDialog(page, 'Nueva Venta');

  const overlay = page.locator('.gm-modal-overlay').last();
  await overlay.click({ position: { x: 5, y: 5 }, force: true });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('@performance todos los ojos de comprobantes abren el modal antes de esperar backend/PDF', async () => {
  const sources = {
    ventas: await readSource('components', 'Mov_Subsection', 'Ventas', 'Ventas.jsx'),
    compras: await readSource('components', 'Mov_Subsection', 'Compra', 'Compras.jsx'),
    ingresos: await readSource('components', 'Mov_Subsection', 'Otros_Ingresos', 'Otros_Ingresos.jsx'),
    egresos: await readSource('components', 'Mov_Subsection', 'Otros_Egresos', 'Otros_Egresos.jsx'),
    presupuestos: await readSource('components', 'Mov_Subsection', 'Documentos_Comerciales', 'Presupuestos.jsx'),
    facturas: await readSource('components', 'Mov_Subsection', 'Documentos_Comerciales', 'Facturas.jsx'),
    remitos: await readSource('components', 'Mov_Subsection', 'Documentos_Comerciales', 'Remitos.jsx'),
    ccClientes: await readSource('components', 'Cuentas_Corrientes', 'Clientes', 'Clientes.jsx'),
    ccProveedores: await readSource('components', 'Cuentas_Corrientes', 'Proveedores', 'Proveedores.jsx'),
    editarCompra: await readSource('components', 'Mov_Subsection', 'Compra', 'modales', 'ModalEditarCompra.jsx'),
    editarIngreso: await readSource('components', 'Mov_Subsection', 'Otros_Ingresos', 'modales', 'ModalEditarIngreso.jsx'),
    editarEgreso: await readSource('components', 'Mov_Subsection', 'Otros_Egresos', 'modales', 'ModalEditarEgreso.jsx'),
    visor: await readSource('components', 'Global', 'Ver_Comprobantes', 'ModalVerComprobante.jsx'),
  };

  expectModalBeforeAsync(sources.ventas, {
    label: 'Ventas',
    handlerToken: 'const handleVerComprobante',
    openToken: 'setOpenVerComprobante(true)',
    asyncToken: 'void Promise.allSettled',
  });
  expectModalBeforeAsync(sources.compras, {
    label: 'Compras',
    handlerToken: 'const openComprobanteModal',
    openToken: 'setOpenVerComp(true)',
    asyncToken: 'void Promise.allSettled',
  });
  expectModalBeforeAsync(sources.ingresos, {
    label: 'Otros ingresos',
    handlerToken: 'const handleOpenComprobante',
    openToken: 'setOpenViewComprobante(true)',
    asyncToken: 'void Promise.allSettled',
  });
  expectModalBeforeAsync(sources.egresos, {
    label: 'Otros egresos',
    handlerToken: 'const handleOpenComprobante',
    openToken: 'setOpenViewComprobante(true)',
    asyncToken: 'void getComprobanteSignedUrl',
  });
  expectModalBeforeAsync(sources.presupuestos, {
    label: 'Presupuestos',
    handlerToken: 'const handleVerComprobante',
    openToken: 'setOpenVerComprobante(true)',
    asyncToken: 'void getComprobanteSignedUrl',
  });
  expectModalBeforeAsync(sources.facturas, {
    label: 'Facturas',
    handlerToken: 'const handleVerDocumento',
    openToken: 'setOpenVerComprobante(true)',
    asyncToken: 'void apiGetJson',
  });
  expectModalBeforeAsync(sources.remitos, {
    label: 'Remitos',
    handlerToken: 'const handleVerDocumento',
    openToken: 'setOpenVerComprobante(true)',
    asyncToken: 'void apiGetJson',
  });
  expectModalBeforeAsync(sources.ccClientes, {
    label: 'CC Clientes',
    handlerToken: 'const openComprobante',
    openToken: 'open: true',
    asyncToken: 'void buildComprobantePreviewDocs',
  });
  expectModalBeforeAsync(sources.ccProveedores, {
    label: 'CC Proveedores',
    handlerToken: 'const openComprobante',
    openToken: 'open: true',
    asyncToken: 'void buildComprobantePreviewDocs',
  });
  expectModalBeforeAsync(sources.editarCompra, {
    label: 'Editar compra',
    handlerToken: 'const handleOpenVerComprobante',
    openToken: 'setOpenVerComp(true)',
    asyncToken: 'void obtenerUrlFirmadaComprobanteActual',
  });
  expectModalBeforeAsync(sources.editarIngreso, {
    label: 'Editar ingreso',
    handlerToken: 'const abrirViewer',
    openToken: 'setOpenViewer(true)',
    asyncToken: 'void (async () =>',
  });
  expectModalBeforeAsync(sources.editarEgreso, {
    label: 'Editar egreso',
    handlerToken: 'const abrirViewer',
    openToken: 'setOpenViewer(true)',
    asyncToken: 'void (async () =>',
  });

  expect(sources.visor).toContain('loading: externalLoading = false');
  expect(sources.visor).toContain('Cargando comprobante...');
  expect(sources.ventas).not.toContain('prewarmAllComprobantes');
});

