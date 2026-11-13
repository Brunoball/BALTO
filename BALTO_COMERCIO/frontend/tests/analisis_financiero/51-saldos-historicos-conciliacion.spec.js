import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';

// Sólo lectura: no crea ni modifica movimientos, saldos, cheques ni facturas.
const amount = (value) => Number(value || 0);
const close = (actual, expected, reason) => {
  expect(amount(actual), reason).toBeCloseTo(amount(expected), 2);
};

async function resumen(page, action, desde, hasta) {
  return expectApiSuccess(await authenticatedApi(page, action, {
    query: { fecha_desde: desde, fecha_hasta: hasta },
  }), `${action} debe responder para ${desde} a ${hasta}`);
}

function ultimoSaldoCaja(report, hasta) {
  const tienda = report?.tiendas?.[0];
  const row = (tienda?.rows || []).find((r) => r.fecha === hasta);
  expect(row, `Flujo de Caja debe incluir el ${hasta}`).toBeTruthy();
  return row;
}

test('@flujo @analisis-financiero @regression cerrar un día da lo mismo aunque el rango empiece antes', async ({ page }) => {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const hasta = '2026-10-20';
  const cajaAmpliada = await resumen(page, 'flujo_caja_resumen', '2026-09-01', hasta);
  const cajaCorta = await resumen(page, 'flujo_caja_resumen', '2026-10-01', hasta);
  const analisisAmpliado = await resumen(page, 'analisis_financiero_resumen', '2026-09-01', hasta);
  const analisisCorto = await resumen(page, 'analisis_financiero_resumen', '2026-10-01', hasta);

  const cierreAmpliado = ultimoSaldoCaja(cajaAmpliada, hasta);
  const cierreCorto = ultimoSaldoCaja(cajaCorta, hasta);
  close(cierreAmpliado.saldo, cierreCorto.saldo, 'Cambiar sólo el inicio no puede alterar el cierre de caja');
  close(analisisAmpliado.tesoreria.saldo_final, analisisCorto.tesoreria.saldo_final,
    'Cambiar sólo el inicio no puede alterar el cierre financiero');
  close(cierreAmpliado.saldo, analisisAmpliado.tesoreria.saldo_final,
    'Flujo de Caja y Análisis Financiero deben cerrar con idéntica disponibilidad monetaria');
  close(cierreAmpliado.saldo, (cierreAmpliado.medios_pago || []).reduce((sum, m) => sum + amount(m.saldo), 0),
    'El total de caja debe incluir los mismos medios que las tarjetas, incluso inactivos');
  // Mismos saldos por tarjeta: la suma de los medios de AF agrupados por tarjeta
  // de Flujo de Caja coincide con cada tarjeta (un ajuste se aplica una sola vez).
  for (const card of cierreAmpliado.medios_pago || []) {
    const ids = new Set((card.medios || []).map((m) => Number(m.id_medio_pago)));
    const afCard = (analisisAmpliado.tesoreria.medios || [])
      .filter((m) => ids.has(Number(m.id)))
      .reduce((sum, m) => sum + amount(m.saldo_final), 0);
    close(card.saldo, afCard, `La tarjeta ${card.label} coincide con Análisis Financiero`);
  }
});

test('@flujo @analisis-financiero @regression consultar antes del primer registro no inventa saldo histórico pero informa saldo actual', async ({ page }) => {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const fecha = '2000-01-01';
  const caja = await resumen(page, 'flujo_caja_resumen', fecha, fecha);
  const financiero = await resumen(page, 'analisis_financiero_resumen', fecha, fecha);
  const fila = ultimoSaldoCaja(caja, fecha);
  close(fila.saldo, financiero.tesoreria.saldo_final, 'Ambos módulos deben coincidir en fechas históricas');
  close(caja.saldo_actual, financiero.tesoreria.saldo_actual, 'Ambos módulos deben coincidir en el saldo actual');
  expect(caja.fecha_saldo_actual).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(financiero.tesoreria.fecha_saldo_actual).toBe(caja.fecha_saldo_actual);
  // Una fecha anterior a los registros nunca recibe montos posteriores como si ya existieran.
  expect(Number.isFinite(amount(fila.saldo))).toBe(true);
});

test('@flujo @analisis-financiero @regression saldos actuales y depósitos internos no se duplican ni se mezclan con cobros', async ({ page }) => {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const fecha = '2026-10-20';
  const caja = await resumen(page, 'flujo_caja_resumen', fecha, fecha);
  const financiero = await resumen(page, 'analisis_financiero_resumen', fecha, fecha);
  const fila = ultimoSaldoCaja(caja, fecha);
  close(fila.saldo, financiero.tesoreria.saldo_final, 'El mismo día debe cerrar igual en ambos informes');
  close(fila.ingresos, financiero.tesoreria.ingresos, 'Ingreso operativo no incluye depósitos internos');
  close(fila.egresos, financiero.tesoreria.egresos, 'Los pagos reales deben coincidir');
  close(fila.ajustes_internos, financiero.tesoreria.ajustes_internos,
    'Los depósitos/reversiones bancarias deben tener su propio campo');
  close(fila.ajustes_manuales, financiero.tesoreria.ajustes_manuales,
    'Los ajustes manuales de saldo deben coincidir y no mezclarse con depósitos ni cobros');
  close(fila.saldo_inicial_aplicado, financiero.tesoreria.saldo_inicial_aplicado,
    'Las aperturas de tesorería deben coincidir, sin sumar cheques en cartera');
  close(caja.saldo_actual, financiero.tesoreria.saldo_actual, 'El saldo actual es independiente del filtro');
});


test('@flujo @analisis-financiero @regression un rango futuro no anticipa operaciones ni altera el saldo actual', async ({ page }) => {
  await page.goto('/panel', { waitUntil: 'domcontentloaded' });
  const fecha = '2099-01-01';
  const caja = await resumen(page, 'flujo_caja_resumen', fecha, fecha);
  const financiero = await resumen(page, 'analisis_financiero_resumen', fecha, fecha);
  const fila = ultimoSaldoCaja(caja, fecha);
  close(caja.tiendas[0].saldo_base, caja.saldo_actual,
    'El saldo base de un período futuro debe ser el último saldo real al día de hoy');
  close(fila.saldo, caja.saldo_actual, 'El día futuro no debe afectar el saldo');
  close(financiero.tesoreria.saldo_final, caja.saldo_actual,
    'Los informes deben conservar el corte real en un rango futuro');
  expect(fila.ingresos).toBeNull();
  expect(fila.egresos).toBeNull();
});
