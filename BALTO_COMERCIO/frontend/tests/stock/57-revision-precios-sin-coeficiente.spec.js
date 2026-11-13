import { test, expect } from '../support/test.js';
import { uniqueName, todayISO } from '../support/data.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { requireMutations, waitForBusyToFinish } from '../support/ui.js';
import { deleteMovement, getLists, medioPago, movementId } from '../support/financial-api.js';

// ===== 57-revision-precios-sin-coeficiente.spec.js =====
//
// Sin compras de mercadería en el período el coeficiente ponderado es nulo
// (se veía "0,0000 → 0,0000") y "Aplicar cambios" siempre se rechaza. En ese
// caso no debe aparecer el aviso de revisión de precios (tarjeta de Stock ni
// campanita). Con un coeficiente válido el aviso sigue funcionando igual.
//
// Las pruebas de UI usan respuestas simuladas (no escriben datos).
// La prueba de API escribe sólo con PW_ALLOW_MUTATIONS=1 y limpia por ID.

const NOTICE = '[aria-label="Revisión pendiente de precios de Stock"], [aria-label="Abrir Revisión pendiente de precios de Stock"]';

function revisionSimulada(coeficienteActual) {
  return {
    id_revision: 990057,
    id_tenant: 1,
    periodo: todayISO().slice(0, 7),
    estado: 'PENDIENTE',
    coeficiente_base: coeficienteActual === null ? null : 1.5,
    coeficiente_actual: coeficienteActual,
    utilidad_deseada_pct: 10,
    compras_mercaderia: coeficienteActual === null ? 0 : 1000,
    gastos_fijos: 500,
    gastos_variables: 0,
    cantidad_cambios: 2,
    disponible: coeficienteActual !== null,
    advertencia: coeficienteActual === null
      ? 'No hay compras de mercadería en el período seleccionado; no se puede calcular un coeficiente ponderado confiable.'
      : null,
    eventos: [],
  };
}

async function simularRevision(page, revision) {
  await page.route('**/api.php?*', async (route) => {
    const action = new URL(route.request().url()).searchParams.get('action');
    if (action === 'stock_precios_revision_pendiente') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ exito: true, revision, pendientes_total: revision ? 1 : 0 }),
      });
      return;
    }
    if (action === 'stock_vencimientos_alertas') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exito: true, alertas: [] }) });
      return;
    }
    await route.continue();
  });
}

async function abrirStockYEsperarRevision(page) {
  const consulta = page.waitForResponse((r) => /action=stock_precios_revision_pendiente/.test(r.url()), { timeout: 30_000 });
  await page.goto('/panel/stock', { waitUntil: 'domcontentloaded' });
  await consulta;
  await waitForBusyToFinish(page);
  // Margen para que React procese la respuesta antes de afirmar ausencia.
  await page.waitForTimeout(1_000);
}

test('@stock @pricing @notificaciones-ui revisión sin coeficiente (0,0000): no aparece aviso ni cuenta en la campanita', async ({ page }) => {
  await simularRevision(page, revisionSimulada(null));
  await abrirStockYEsperarRevision(page);
  await expect(page.locator(NOTICE), 'No debe mostrarse "Hay cambios pendientes en tus precios"').toHaveCount(0);
  await expect(page.getByText('Revisión pendiente sin coeficiente aplicable')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Notificaciones de Stock/i }), 'La campanita no debe abrirse sola').toHaveCount(0);
  const bell = page.getByRole('button', { name: /^Notificaciones de Stock/ });
  if (await bell.count()) await expect(bell.first()).toHaveAttribute('aria-label', 'Notificaciones de Stock');
});

test('@stock @pricing @notificaciones-ui control: con coeficiente válido el aviso sí aparece', async ({ page }) => {
  await simularRevision(page, revisionSimulada(1.65));
  await abrirStockYEsperarRevision(page);
  await expect(page.locator(NOTICE).first(), 'Con coeficiente aplicable el aviso debe mostrarse').toBeVisible({ timeout: 15_000 });
});

test('@stock @pricing @mutations un COSTO FIJO en un mes sin compras no crea revisión de precios', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await requireMutations(test, page);
  const periodo = todayISO().slice(0, 7);
  const coef = expectApiSuccess(await authenticatedApi(page, 'stock_coeficiente_ponderado', {
    query: { periodo, _: Date.now() },
  }), 'No se pudo calcular el coeficiente ponderado');
  const datos = coef?.data || coef || {};
  test.skip(Boolean(datos.disponible), `El tenant ya tiene compras en ${periodo}: el caso "sin coeficiente" no aplica este mes.`);

  const lists = await getLists(page, 'ventas');
  const clas = (lists?.clasificaciones || []).find((c) => String(c?.nombre || '').trim().toUpperCase() === 'COSTO FIJO');
  expect(clas, 'Debe existir la clasificación COSTO FIJO').toBeTruthy();
  const medio = medioPago(lists);
  let id = 0;
  try {
    const total = 157;
    id = movementId(expectApiSuccess(await authenticatedApi(page, 'otros_egresos_crear', {
      method: 'POST',
      body: {
        fecha: todayISO(),
        id_clasificacion: Number(clas.id ?? clas.id_clasificacion),
        items: [{ detalle: uniqueName('REV-SIN-COEF'), cantidad: 1, precio: total, iva_pct: 0, total }],
        medios_pago: [{ id_medio_pago: medio.id, monto: total }],
      },
    }), 'No se pudo crear el egreso COSTO FIJO'));
    const pendiente = expectApiSuccess(await authenticatedApi(page, 'stock_precios_revision_pendiente', {
      query: { periodo, _: Date.now() },
    }), 'No se pudo consultar la revisión de precios');
    const revision = pendiente?.revision ?? pendiente?.data?.revision ?? null;
    expect(revision, 'Sin compras en el mes no debe haber revisión pendiente que mostrar').toBeNull();
  } finally {
    await deleteMovement(page, 'otros_egresos_eliminar', id);
  }
});
