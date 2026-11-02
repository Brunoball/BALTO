import { authenticatedApi, expectApiSuccess } from './api.js';
import { todayISO } from './data.js';

export function addDaysISO(iso, days) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Fechas pasadas válidas para cargar operaciones históricas en el tenant de prueba.
 *
 * El backend rechaza cobros/pagos anteriores al saldo inicial de tesorería
 * (ese dinero ya está incluido en la apertura). Por eso las fechas se eligen
 * después de la apertura más reciente y antes de hoy, en vez de fijarlas a mano.
 *
 * Devuelve null si el tenant no deja margen (apertura de ayer u hoy).
 */
export async function historicalOperationDays(page) {
  const today = todayISO();
  let latestOpening = null;
  const result = await authenticatedApi(page, 'config_saldos_iniciales_get');
  const data = expectApiSuccess(result, 'No se pudieron leer los saldos iniciales');
  for (const row of Array.isArray(data?.tesoreria) ? data.tesoreria : []) {
    const fecha = String(row?.fecha_saldo || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(fecha) && (!latestOpening || fecha > latestOpening)) latestOpening = fecha;
  }

  const preferred = addDaysISO(today, -10);
  const operationDay = latestOpening && latestOpening > preferred ? latestOpening : preferred;
  const paymentDay = addDaysISO(operationDay, 1);
  const lastAllowed = addDaysISO(today, -1);
  if (paymentDay > lastAllowed) return null;
  return { today, latestOpening, operationDay, paymentDay };
}
