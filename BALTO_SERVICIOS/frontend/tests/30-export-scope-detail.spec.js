import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  downloadFromExportDialog,
  openExportDialog,
  selectExportFormat,
  selectExportScope,
} from './support/export.js';
import { collectAllExportRows } from '../src/components/Global/Boton_Exportar/exportScopeUtils.js';

const PAGE_ONE = [
  {
    id_movimiento: 910001,
    fecha: '2026-09-08',
    id_tipo_operacion: 1,
    tipo_movimiento_general: 'VENTA',
    cliente: 'Cliente Export E2E',
    detalle: '2 PRODUCTOS',
    cantidad_items: 2,
    tipo_venta: 'CONTADO',
    monto_total: 242,
    total_pagado: 242,
    saldo_pendiente: 0,
    estado_pago: 'PAGADO',
    factura_emitida_en_arca: 1,
    nota_credito_cantidad: 1,
    items_detalle: [
      {
        tipo_item_db: 'SERVICIO',
        servicio_nombre: 'Servicio Export E2E',
        cantidad: 1,
        precio: 100,
        subtotal: 100,
        iva_pct: 21,
        iva_monto: 21,
        total: 121,
      },
      {
        tipo_item_db: 'ARTICULO',
        articulo_nombre: 'Insumo Export E2E',
        sku: 'EXP-INS-01',
        cantidad: 2,
        precio: 50,
        subtotal: 100,
        iva_pct: 21,
        iva_monto: 21,
        total: 121,
      },
    ],
    medios_pago_detalle: [
      {
        medio_pago_nombre: 'TRANSFERENCIA',
        monto: 242,
      },
    ],
    comprobantes_detalle: [
      {
        label: 'Factura A',
        id_archivo: 991,
        emitido_en_arca: 1,
        cae: '70412345678901',
        pto_vta: 3,
        cbte_nro: 77,
      },
    ],
    notas_credito_detalle: [
      {
        id_nota_credito: 4401,
        fecha: '2026-09-08',
        modalidad: 'PARCIAL',
        motivo: 'Ajuste E2E',
        observaciones: 'Nota de crédito de prueba para exportación',
        total_nota: 20,
        emitida_arca: 0,
      },
    ],
  },
  {
    id_movimiento: 910002,
    fecha: '2026-09-08',
    id_tipo_operacion: 2,
    tipo_movimiento_general: 'COMPRA',
    proveedor: 'Proveedor Export E2E',
    detalle: '1 PRODUCTO',
    cantidad_items: 1,
    tipo_venta: 'CONTADO',
    monto_total: 80,
    total_pagado: 80,
    saldo_pendiente: 0,
    estado_pago: 'PAGADO',
    items_detalle: [
      {
        tipo_item_db: 'ARTICULO',
        articulo_nombre: 'Material Export E2E',
        cantidad: 4,
        precio: 20,
        subtotal: 80,
        iva_pct: 0,
        iva_monto: 0,
        total: 80,
      },
    ],
    medios_pago_detalle: [
      {
        medio_pago_nombre: 'EFECTIVO',
        monto: 80,
      },
    ],
  },
];

const PAGE_TWO = [
  {
    id_movimiento: 910003,
    fecha: '2026-09-07',
    id_tipo_operacion: 3,
    tipo_movimiento_general: 'OTROS INGRESOS',
    detalle: 'Ingreso segunda página Export E2E',
    cantidad_items: 1,
    monto_total: 35,
    total_pagado: 35,
    saldo_pendiente: 0,
    estado_pago: 'PAGADO',
    items_detalle: [
      {
        tipo_item_db: 'DETALLE',
        descripcion: 'Ingreso segunda página Export E2E',
        cantidad: 1,
        precio: 35,
        subtotal: 35,
        iva_pct: 0,
        iva_monto: 0,
        total: 35,
      },
    ],
    medios_pago_detalle: [
      {
        medio_pago_nombre: 'EFECTIVO',
        monto: 35,
      },
    ],
  },
];

async function mockMovimientosPagination(page) {
  const offsets = [];

  await page.route('**/api.php?**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action');

    if (action === 'movimientos_live_token') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exito: true, live_token: 'PW-EXPORT-STABLE' }),
      });
      return;
    }

    if (action !== 'movimientos_listar') {
      await route.continue();
      return;
    }

    const offset = Number(url.searchParams.get('offset') || 0);
    offsets.push(offset);

    let payload;
    if (offset === 0) {
      payload = {
        exito: true,
        movimientos: PAGE_ONE,
        has_more: true,
        next_offset: 2,
      };
    } else if (offset === 2) {
      payload = {
        exito: true,
        movimientos: PAGE_TWO,
        has_more: false,
        next_offset: null,
      };
    } else {
      payload = {
        exito: true,
        movimientos: [],
        has_more: false,
        next_offset: null,
      };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  return offsets;
}

async function openMockedMovimientos(page) {
  await page.addInitScript(() => {
    try {
      const prefix = 'balto_movimientos_perf_v2:';
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) sessionStorage.removeItem(key);
      }
    } catch {}
  });

  const offsets = await mockMovimientosPagination(page);
  await page.goto('/panel/movimientos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mostrando', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cliente Export E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Proveedor Export E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
  return offsets;
}

function rowsFromSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  expect(sheet, `Debe existir la hoja ${name}`).toBeTruthy();
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

test('@critical @export exportScopeUtils recorre todas las páginas, respeta nextOffset y elimina duplicados', async () => {
  const calls = [];
  const rows = await collectAllExportRows({
    fetchPage: async (offset) => {
      calls.push(offset);
      if (offset === 0) {
        return {
          rows: [{ id: 1 }, { id: 2 }],
          hasMore: true,
          nextOffset: 2,
        };
      }
      return {
        rows: [{ id: 2 }, { id: 3 }],
        hasMore: false,
        nextOffset: null,
      };
    },
    getRowKey: (row) => row.id,
  });

  expect(calls).toEqual([0, 2]);
  expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
});

test('@critical @export modal global muestra alcance y formatos, con página actual seleccionada por defecto', async ({ page }) => {
  await openMockedMovimientos(page);

  const dialog = await openExportDialog(page, /Exportar movimientos/i);
  await expect(dialog.getByText('REGISTROS DISPONIBLES', { exact: true })).toBeVisible();
  await expect(dialog.getByText('2+', { exact: true })).toBeVisible();
  await expect(dialog.getByText('ALCANCE', { exact: true })).toBeVisible();
  await expect(dialog.getByText('FORMATO', { exact: true })).toBeVisible();

  const current = dialog.getByRole('button', { name: /Exportar esta página/i });
  const all = dialog.getByRole('button', { name: /Exportar todos los registros/i });
  await expect(current).toHaveClass(/is-selected/);
  await expect(all).not.toHaveClass(/is-selected/);

  const formats = dialog.locator('.boton-exportar-choice--format');
  await expect(formats).toHaveCount(3);
  await expect(formats.nth(0)).toContainText('Excel');
  await expect(formats.nth(1)).toContainText('CSV');
  await expect(formats.nth(2)).toContainText('TXT');
  await expect(formats.nth(0)).toHaveClass(/is-selected/);

  await selectExportScope(dialog, 'all');
  await selectExportFormat(dialog, 'CSV');
  await expect(all).toHaveClass(/is-selected/);
  await expect(formats.nth(1)).toHaveClass(/is-selected/);

  await dialog.getByRole('button', { name: /Cancelar/i }).click();
  await expect(dialog).toBeHidden();
});

test('@critical @export movimientos exporta sólo la página visible cuando se elige "esta página"', async ({ page }, testInfo) => {
  const offsets = await openMockedMovimientos(page);

  const dialog = await openExportDialog(page, /Exportar movimientos/i);
  await selectExportScope(dialog, 'page');
  await selectExportFormat(dialog, 'CSV');
  const result = await downloadFromExportDialog(page, dialog, testInfo, 'movimientos-pagina');

  expect(result.suggestedFilename).toMatch(/^movimientos_.*\.csv$/i);
  const csv = await fs.readFile(result.path, 'utf8');
  expect(csv).toContain('Cliente Export E2E');
  expect(csv).toContain('Proveedor Export E2E');
  expect(csv).toContain('Servicio Export E2E');
  expect(csv).toContain('Insumo Export E2E');
  expect(csv).not.toContain('Ingreso segunda página Export E2E');

  // La exportación de página actual no debe necesitar pedir la página siguiente.
  expect(offsets.filter((offset) => offset === 2)).toHaveLength(0);
});

test('@critical @export movimientos exporta todas las páginas y Excel incluye el detalle completo en hojas separadas', async ({ page }, testInfo) => {
  const offsets = await openMockedMovimientos(page);

  const dialog = await openExportDialog(page, /Exportar movimientos/i);
  await selectExportScope(dialog, 'all');
  await selectExportFormat(dialog, 'Excel');
  const result = await downloadFromExportDialog(page, dialog, testInfo, 'movimientos-todos');

  expect(result.suggestedFilename).toMatch(/^movimientos_.*\.xlsx$/i);
  expect(offsets).toContain(2);

  const workbook = XLSX.readFile(result.path, { cellDates: false });
  expect(workbook.SheetNames).toEqual(
    expect.arrayContaining([
      'Movimientos',
      'Detalle_items',
      'Medios_pago',
      'Comprobantes',
      'Notas_credito',
    ]),
  );

  const movimientos = rowsFromSheet(workbook, 'Movimientos');
  const items = rowsFromSheet(workbook, 'Detalle_items');
  const payments = rowsFromSheet(workbook, 'Medios_pago');
  const docs = rowsFromSheet(workbook, 'Comprobantes');
  const creditNotes = rowsFromSheet(workbook, 'Notas_credito');

  expect(movimientos).toHaveLength(3);
  expect(items).toHaveLength(4);
  expect(payments).toHaveLength(3);
  expect(docs).toHaveLength(1);
  expect(creditNotes).toHaveLength(1);

  const venta = movimientos.find((row) => Number(row.ID) === 910001);
  expect(venta).toBeTruthy();
  expect(String(venta.DETALLE)).toContain('Servicio Export E2E');
  expect(String(venta.DETALLE)).toContain('Insumo Export E2E');
  expect(String(venta.DETALLE)).not.toBe('2 PRODUCTOS');

  expect(items.some((row) => row.ITEM === 'Servicio Export E2E')).toBe(true);
  expect(items.some((row) => row.ITEM === 'Insumo Export E2E' && row.SKU === 'EXP-INS-01')).toBe(true);
  expect(items.some((row) => row.ITEM === 'Ingreso segunda página Export E2E')).toBe(true);
  expect(payments.some((row) => row.MEDIO_PAGO === 'TRANSFERENCIA' && Number(row.MONTO) === 242)).toBe(true);
  expect(docs[0]).toMatchObject({ COMPROBANTE: 'Factura A', CAE: '70412345678901' });
  expect(creditNotes[0]).toMatchObject({ MODALIDAD: 'PARCIAL', MOTIVO: 'Ajuste E2E' });
});

test('@export integración: las pantallas paginadas conservan el contrato página/todos', async () => {
  const root = process.cwd();
  const remotePagedFiles = [
    'src/components/Movimientos/Movimientos.jsx',
    'src/components/Mov_Subsection/Ventas/Ventas.jsx',
    'src/components/Mov_Subsection/Compra/Compras.jsx',
    'src/components/Mov_Subsection/Documentos_Comerciales/Presupuestos.jsx',
    'src/components/Mov_Subsection/Recibos/Recibos.jsx',
    'src/components/Mov_Subsection/OrdenesPago/OrdenesPago.jsx',
    'src/components/Mov_Subsection/Otros_Ingresos/Otros_Ingresos.jsx',
    'src/components/Mov_Subsection/Otros_Egresos/Otros_Egresos.jsx',
  ];

  for (const relative of remotePagedFiles) {
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    expect(source, `${relative}: falta BotonExportar`).toContain('<BotonExportar');
    expect(source, `${relative}: falta currentRows`).toMatch(/currentRows\s*=\s*\{/);
    expect(source, `${relative}: falta hasMore`).toMatch(/hasMore\s*=\s*\{/);
    expect(source, `${relative}: falta loadAllRows`).toMatch(/loadAllRows\s*=\s*\{/);
    expect(source, `${relative}: el formato no recibe las filas elegidas por el modal`).toMatch(/onClick\s*:\s*\(\{\s*rows\s*:/);
  }

  const serviciosSource = await fs.readFile(
    path.join(root, 'src/components/Servicios/Servicios.jsx'),
    'utf8',
  );
  expect(serviciosSource).toMatch(/currentRows=\{visibleRows\}/);
  expect(serviciosSource).toMatch(/allRows=\{rows\}/);
  expect(serviciosSource).toMatch(/allCount=\{rows\.length\}/);

  const globalSource = await fs.readFile(
    path.join(root, 'src/components/Global/Boton_Exportar/BotonExportar.jsx'),
    'utf8',
  );
  expect(globalSource).toContain('Exportar esta página');
  expect(globalSource).toContain('Exportar todos los registros');
  expect(globalSource).toMatch(/scope\s*===\s*["']all["']/);
  expect(globalSource).toContain('loadAllRows');
  expect(globalSource).toMatch(/rows:\s*scopedRows/);
});
