import { test, expect } from '../support/test.js';
import { authenticatedApi, expectApiSuccess } from '../support/api.js';
import { RUN_PREFIX, todayISO } from '../support/data.js';
import { requireMutations } from '../support/ui.js';
import { cleanupTestUser, createEmployeeTestUser, loginTestUserInNewContext } from '../support/users.js';
import { createParty, createProduct, getLists, tipoVentaId, createSale, financialAnalysis } from '../support/financial-api.js';

/**
 * BALTO Comercio · Cierre de Caja y Conciliación de Diferencias (Flujo de Caja)
 *
 *  A) Interfaz con mocks (page.route): no escribe nada. Apto para cualquier entorno.
 *  B) API de sólo lectura: permisos, validaciones y tenant sin migración.
 *  C) Mutaciones reales: requieren PW_ALLOW_MUTATIONS=1 **y** PW_CIERRES_MUTATIONS=1,
 *     un tenant E2E aislado con la migración aplicada y la limpieza
 *     tesoreria_cierres_e2e_cleanup() integrada en config_testing_e2e_cleanup
 *     (los cierres y sus ajustes llevan el RUN_PREFIX). Usan fechas operativas
 *     históricas (año 2001) para no ocupar el cierre del día real.
 *     Nunca se ejecutan contra producción sin habilitación explícita.
 *
 * Los números (1-50) refieren a la lista de casos de la especificación.
 */

const FLUJO_ROUTE = '/panel/flujo-de-caja';
const CIERRES_MUTATIONS = ['1', 'true', 'si', 'sí', 'yes'].includes(String(process.env.PW_CIERRES_MUTATIONS || '').toLowerCase());
const n = (v) => Number(v || 0);
const close = (a, b, m) => expect(n(a), m).toBeCloseTo(n(b), 2);
const cents = (v) => Math.round(n(v) * 100);
const money = (v) => (Math.round(n(v) * 100) / 100).toFixed(2);

function clave(label = 'k') {
  return `${RUN_PREFIX}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/* =========================================================
   A) Backend simulado para la interfaz
========================================================= */

const MEDIOS = [
  { id_medio_pago: 1, nombre: 'EFECTIVO', activo: true, clase_medio: 'EFECTIVO', saldo_esperado: 100000 },
  { id_medio_pago: 2, nombre: 'MERCADO PAGO', activo: true, clase_medio: 'CUENTA', saldo_esperado: 350000 },
  { id_medio_pago: 4, nombre: 'BANCO', activo: true, clase_medio: 'CUENTA', saldo_esperado: 200000 },
  { id_medio_pago: 8, nombre: 'BANCO GALICIA', activo: true, clase_medio: 'CUENTA', saldo_esperado: 50000 },
  { id_medio_pago: 7, nombre: 'PERSONAL PAY', activo: true, clase_medio: 'CUENTA', saldo_esperado: 0 },
];

function estadoDetalle(dif, conc) {
  if (cents(dif) === 0) return 'SIN_DIFERENCIA';
  if (cents(conc) <= 0) return 'PENDIENTE';
  return cents(conc) >= Math.abs(cents(dif)) ? 'CONCILIADA' : 'PARCIALMENTE_CONCILIADA';
}

/** Mock con estado: emula el contrato del backend real. */
async function mockCierres(page, { stale = false } = {}) {
  const today = todayISO();
  const st = { cierres: [], calls: { confirmar: [], conciliar: [], ajustar: [] }, staleOnce: stale };
  const route = (action, fn) => page.route((u) => u.pathname.endsWith('/api.php') && u.searchParams.get('action') === action, fn);
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const detalleDe = (c) => {
    const detalles = c.detalles.map((d) => ({
      ...d,
      importe_pendiente: Math.abs(d.diferencia) - d.importe_conciliado,
      estado_conciliacion: estadoDetalle(d.diferencia, d.importe_conciliado),
      puede_conciliar: Math.abs(d.diferencia) - d.importe_conciliado > 0,
      puede_aplicar_ajuste: Math.abs(d.diferencia) - d.importe_conciliado > 0 && !d.id_ajuste_saldo,
    }));
    const con = detalles.filter((d) => d.estado_conciliacion !== 'SIN_DIFERENCIA');
    const estado = !con.length ? 'SIN_DIFERENCIAS' : con.every((d) => d.estado_conciliacion === 'CONCILIADA') ? 'CONCILIADO'
      : con.every((d) => d.estado_conciliacion === 'PENDIENTE') ? 'PENDIENTE' : 'PARCIALMENTE_CONCILIADO';
    return { exito: true, cierre: { ...c.cabecera, estado_conciliacion: estado, importe_pendiente: detalles.reduce((s, d) => s + d.importe_pendiente, 0) }, detalles, ajustes: [], eventos: c.eventos, avisos: [] };
  };

  // Igual que 55-ajustes: después de confirmar, la pantalla vuelve a pedir el
  // resumen. Si cada lectura hace route.fetch() al backend real, la petición
  // puede seguir viva al terminar el test ("Response has been disposed").
  // Una sola lectura real por URL, compartida y reutilizada.
  const resumenCache = new Map();
  await page.route((u) => u.pathname.endsWith('/api.php') && u.searchParams.get('action') === 'flujo_caja_resumen', async (r) => {
    const key = r.request().url();
    if (!resumenCache.has(key)) {
      resumenCache.set(key, (async () => {
        const res = await r.fetch();
        const body = await res.json();
        body.cierres_caja = { habilitado: true, puede_gestionar: true };
        body.ajustes_saldo = { ...(body.ajustes_saldo || {}), habilitado: true, puede_gestionar: true };
        return body;
      })());
    }
    let body;
    try {
      body = await resumenCache.get(key);
    } catch (e) {
      resumenCache.delete(key);
      throw e;
    }
    await json(r, body).catch(() => null);
  });
  await route('flujo_caja_cierres_estado', (r) => json(r, { exito: true, habilitado: true, fecha_negocio: today, cierre_hoy: null, ultimo_cierre: null, diferencias_pendientes: 0 }));
  await route('flujo_caja_ajustes_medios', (r) => json(r, { exito: true, medios: MEDIOS }));
  await route('flujo_caja_cierres_previsualizar', (r) => {
    const fecha = new URL(r.request().url()).searchParams.get('fecha_operativa') || today;
    const existente = st.cierres.find((c) => c.cabecera.fecha_operativa === fecha);
    json(r, {
      exito: true, fecha_operativa: fecha, fecha_negocio: today, ahora: `${today} 18:30:00`, es_historico: fecha < today, responsable: 'ADMIN',
      medios: MEDIOS.map((m) => ({ ...m, obligatorio: true, admite_ajuste_al_confirmar: m.clase_medio === 'EFECTIVO' && fecha === today })),
      cierre_existente: existente ? existente.cabecera : null, puede_cerrar: !existente, avisos: fecha < today ? ['Cierre de una fecha anterior: NO se ajustará el saldo actual.'] : [],
    });
  });
  await route('flujo_caja_cierres_confirmar', async (r) => {
    const body = r.request().postDataJSON();
    st.calls.confirmar.push(body);
    await new Promise((res) => setTimeout(res, 300));
    if (st.staleOnce) {
      st.staleOnce = false;
      MEDIOS[0].saldo_esperado = 101000;
      return json(r, { exito: false, codigo: 'SALDOS_DESACTUALIZADOS', mensaje: 'Los saldos cambiaron desde que abriste el formulario (EFECTIVO).', medios: [{ id_medio_pago: 1, nombre: 'EFECTIVO', saldo_mostrado: 100000, saldo_actual: 101000 }] }, 409);
    }
    const id = st.cierres.length + 1;
    const detalles = body.medios.map((m, i) => {
      const esp = n(m.saldo_esperado); const ver = n(m.saldo_verificado); const dif = Math.round((ver - esp) * 100) / 100;
      return {
        id_cierre_detalle: id * 100 + i, id_cierre: id, id_medio_pago: m.id_medio_pago, medio_nombre: MEDIOS.find((x) => x.id_medio_pago === m.id_medio_pago).nombre,
        clase_medio: MEDIOS.find((x) => x.id_medio_pago === m.id_medio_pago).clase_medio, saldo_esperado: esp, saldo_verificado: ver, diferencia: dif,
        tipo_diferencia: dif > 0 ? 'SOBRANTE' : dif < 0 ? 'FALTANTE' : 'SIN_DIFERENCIA', ajuste_provisional: m.aplicar_ajuste ? dif : 0,
        id_ajuste_saldo: m.aplicar_ajuste ? 500 + i : null, importe_conciliado: 0, importe_compensado: 0, conciliaciones: [],
      };
    });
    const sob = detalles.reduce((s, d) => s + Math.max(0, d.diferencia), 0); const fal = detalles.reduce((s, d) => s + Math.max(0, -d.diferencia), 0);
    const c = {
      cabecera: { id_cierre: id, numero: `CC-${String(id).padStart(6, '0')}`, fecha_operativa: body.fecha_operativa, created_at: `${today} 18:31:00`, usuario_nombre: 'ADMIN',
        es_historico: body.fecha_operativa < today, total_esperado: detalles.reduce((s, d) => s + d.saldo_esperado, 0), total_verificado: detalles.reduce((s, d) => s + d.saldo_verificado, 0),
        total_sobrantes: sob, total_faltantes: fal, diferencia_neta: sob - fal, cantidad_medios: detalles.length, cantidad_diferencias: detalles.filter((d) => d.diferencia).length },
      detalles, eventos: [{ id_evento: 1, evento: 'CIERRE_CONFIRMADO', importe: sob - fal, created_at: `${today} 18:31:00`, usuario_nombre: 'ADMIN' }],
    };
    st.cierres.push(c);
    json(r, { ...detalleDe(c), duplicado: false, mensaje: 'Cierre de caja confirmado.' });
  });
  await route('flujo_caja_cierres_listar', (r) => {
    const q = new URL(r.request().url()).searchParams;
    let rows = st.cierres.map((c) => ({ ...detalleDe(c).cierre, diferencias_pendientes: detalleDe(c).detalles.filter((d) => d.importe_pendiente > 0).length }));
    if (q.get('fecha_desde')) rows = rows.filter((x) => x.fecha_operativa >= q.get('fecha_desde'));
    if (q.get('fecha_hasta')) rows = rows.filter((x) => x.fecha_operativa <= q.get('fecha_hasta'));
    if (q.get('estado') === 'CON_PENDIENTES') rows = rows.filter((x) => ['PENDIENTE', 'PARCIALMENTE_CONCILIADO'].includes(x.estado_conciliacion));
    json(r, { exito: true, habilitado: true, rows, total: rows.length });
  });
  await route('flujo_caja_cierres_detalle', (r) => {
    const id = Number(new URL(r.request().url()).searchParams.get('id_cierre'));
    json(r, detalleDe(st.cierres.find((c) => c.cabecera.id_cierre === id)));
  });
  const findDet = (id) => st.cierres.flatMap((c) => c.detalles.map((d) => ({ c, d }))).find((x) => x.d.id_cierre_detalle === Number(id));
  await route('flujo_caja_cierres_ajuste_previsualizar', (r) => {
    const { d } = findDet(new URL(r.request().url()).searchParams.get('id_cierre_detalle'));
    const saldo = 200000;
    json(r, { exito: true, preview: { importe_pendiente: Math.abs(d.diferencia) - d.importe_conciliado, saldo_actual: saldo,
      ajuste: d.diferencia, saldo_resultante: saldo + d.diferencia, fecha_efectiva: today,
      aviso: 'El ajuste afecta el saldo actual, no modifica el cierre original.' } });
  });
  await route('flujo_caja_cierres_ajuste_aplicar', (r) => {
    const b = r.request().postDataJSON();
    st.calls.ajustar.push(b);
    const { c, d } = findDet(b.id_cierre_detalle);
    if (Math.abs(n(b.saldo_verificado_actual) - (200000 + d.diferencia)) > 0.01) {
      return json(r, { exito: false, mensaje: 'Saldo verificado inválido.', codigo: 'VERIFICACION_NO_COINCIDE' }, 400);
    }
    d.id_ajuste_saldo = 9999;
    d.ajuste_provisional = d.diferencia;
    return json(r, { ...detalleDe(c), mensaje: 'Ajuste registrado correctamente.' });
  });
  await route('flujo_caja_cierres_conciliacion_candidatos', (r) => json(r, { exito: true, rows: [
    { id_movimiento_medio_pago: 9001, id_movimiento: 77, id_medio_pago: 1, id_tipo_operacion: 1, tipo_operacion: 'VENTA', sentido: 'INGRESO', fecha_pago: today, monto: 10000, contraparte: 'CONSUMIDOR FINAL' },
  ] }));
  await route('flujo_caja_cierres_conciliacion_previsualizar', (r) => {
    const q = new URL(r.request().url()).searchParams;
    const { d } = findDet(q.get('id_cierre_detalle'));
    const imp = n(q.get('importe')); const pend = Math.abs(d.diferencia) - d.importe_conciliado;
    const comp = d.id_ajuste_saldo && q.get('tipo_resolucion') !== 'DIFERENCIA_ACEPTADA' ? -Math.sign(d.diferencia) * imp : 0;
    json(r, { exito: true, preview: { id_cierre_detalle: d.id_cierre_detalle, medio_nombre: d.medio_nombre, tipo_resolucion: q.get('tipo_resolucion'), tipo_label: 'OPERACIÓN REAL REGISTRADA',
      diferencia_original: d.diferencia, importe_conciliado_anterior: d.importe_conciliado, pendiente_anterior: pend, importe: imp, pendiente_posterior: pend - imp,
      estado_resultante: estadoDetalle(d.diferencia, d.importe_conciliado + imp), compensacion: comp, saldo_actual: 125000, saldo_resultante: 125000 + comp,
      movimientos: [], efecto: ['Ajuste provisional original: + $ 15.000,00', `Compensación del ajuste provisional: ${comp}`], advertencias: [], fecha_efectiva: today } });
  });
  await route('flujo_caja_cierres_conciliar', (r) => {
    const b = r.request().postDataJSON();
    st.calls.conciliar.push(b);
    const { c, d } = findDet(b.id_cierre_detalle);
    d.importe_conciliado += n(b.importe);
    d.conciliaciones.push({ id_conciliacion: st.calls.conciliar.length, tipo_label: 'OPERACIÓN REAL REGISTRADA', importe: n(b.importe), compensacion: d.id_ajuste_saldo ? -Math.sign(d.diferencia) * n(b.importe) : 0, created_at: `${today} 19:00:00`, usuario_nombre: 'ADMIN', movimientos: [] });
    json(r, { ...detalleDe(c), duplicado: false, mensaje: 'Conciliación registrada.' });
  });
  return st;
}

async function abrirCierre(page) {
  await page.goto(FLUJO_ROUTE);
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const dlg = page.getByRole('dialog', { name: 'Cerrar caja' });
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('fc-cc-input-1')).toBeVisible();
  return dlg;
}

async function completar(page, valores) {
  for (const [id, v] of Object.entries(valores)) await page.getByTestId(`fc-cc-input-${id}`).fill(String(v));
}

test.describe('@flujo @cierre-caja interfaz (mocks, sin escrituras)', () => {
  test.beforeEach(() => { MEDIOS[0].saldo_esperado = 100000; });

  test('1-2 · botones Cerrar caja e Historial de cierres sin romper las acciones existentes', async ({ page }) => {
    await mockCierres(page);
    await page.goto(FLUJO_ROUTE);
    await expect(page.getByRole('button', { name: 'Cerrar caja' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Historial de cierres' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ajustar saldo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Historial de ajustes de saldo' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Exportar/ })).toBeVisible();
    const dlg = await abrirCierre(page);
    await expect(dlg.getByText('Fecha y hora de realización')).toBeVisible();
    await expect(page.getByTestId('fc-cc-responsable')).toHaveText('ADMIN');
  });

  test('3-7 · medios reales por id, sin CHEQUE/ECHEQ, dos bancos y no verificado ≠ 0', async ({ page }) => {
    await mockCierres(page);
    const dlg = await abrirCierre(page);
    await expect(dlg.locator('[data-medio-id]')).toHaveCount(MEDIOS.length);
    await expect(dlg.getByText(/^E?CHEQ/)).toHaveCount(0);
    await expect(page.getByTestId('fc-cc-row-4')).toContainText('BANCO');
    await expect(page.getByTestId('fc-cc-row-8')).toContainText('BANCO GALICIA');
    await expect(page.getByTestId('fc-cc-esperado-1')).toContainText('100.000,00');
    await expect(page.getByTestId('fc-cc-estado-7')).toHaveText('Sin verificar');
    await expect(page.getByTestId('fc-cc-progreso')).toContainText('0 de 5 verificadas');
    await expect(page.getByText('Controlá el dinero real de cada caja')).toBeVisible();
    await expect(page.getByTestId('fc-cc-neto')).toHaveText('—');
    await page.getByTestId('fc-cc-input-7').fill('0');
    await expect(page.getByTestId('fc-cc-progreso')).toContainText('1 de 5 verificadas');
    await expect(page.getByTestId('fc-cc-estado-7')).toHaveText('Coincide');
    await page.getByTestId('fc-cc-revisar').click();
    await expect(page.getByTestId('fc-cc-notice')).toContainText('Faltan verificar');
  });

  test('9-14 · diferencias en tiempo real, sin compensar medios, ajuste sólo de efectivo', async ({ page }) => {
    const st = await mockCierres(page);
    await abrirCierre(page);
    await completar(page, { 1: '110.000', 2: '340000', 4: '200000', 8: '50000', 7: '0' });
    await expect(page.getByTestId('fc-cc-dif-1')).toContainText('10.000');
    await expect(page.getByTestId('fc-cc-estado-1')).toHaveText('Sobrante');
    await expect(page.getByTestId('fc-cc-estado-2')).toHaveText('Faltante');
    await expect(page.getByTestId('fc-cc-sobrantes')).toContainText('10.000');
    await expect(page.getByTestId('fc-cc-faltantes')).toContainText('10.000');
    await expect(page.getByText('Las diferencias se compensan en el total, pero se registran por separado')).toBeVisible();
    await expect(page.getByTestId('fc-cc-aplicar-1')).toBeChecked();
    await expect(page.getByTestId('fc-cc-aplicar-2')).toHaveCount(0);
    await page.getByTestId('fc-cc-revisar').click();
    await expect(page.getByTestId('fc-cc-ajustes')).toContainText('EFECTIVO');
    await expect(page.getByTestId('fc-cc-ajustes')).not.toContainText('MERCADO PAGO');
    await expect(page.getByTestId('fc-cc-pendientes')).toContainText('MERCADO PAGO');
    await page.getByTestId('fc-cc-confirmar').click();
    await expect(page.getByTestId('fc-cc-done')).toBeVisible();
    const enviado = st.calls.confirmar[0];
    expect(enviado.medios.find((m) => m.id_medio_pago === 1).aplicar_ajuste).toBe(true);
    expect(enviado.medios.find((m) => m.id_medio_pago === 2).aplicar_ajuste).toBe(false);
    expect(enviado.medios.find((m) => m.id_medio_pago === 7).saldo_verificado).toBe('0.00');
  });

  test('15 · doble clic en Confirmar cierre envía una sola solicitud con clave', async ({ page }) => {
    const st = await mockCierres(page);
    await abrirCierre(page);
    await completar(page, { 1: '100000', 2: '350000', 4: '200000', 8: '50000', 7: '0' });
    await page.getByTestId('fc-cc-revisar').click();
    await page.getByTestId('fc-cc-confirmar').dblclick();
    await expect(page.getByTestId('fc-cc-done')).toBeVisible();
    expect(st.calls.confirmar).toHaveLength(1);
    expect(st.calls.confirmar[0].clave_solicitud).toMatch(/^cie-[A-Za-z0-9_-]{8,}$/);
  });

  test('18 · saldo desactualizado: 409, aviso y formulario actualizado conservando lo contado', async ({ page }) => {
    await mockCierres(page, { stale: true });
    await abrirCierre(page);
    await completar(page, { 1: '100000', 2: '350000', 4: '200000', 8: '50000', 7: '0' });
    await page.getByTestId('fc-cc-revisar').click();
    await page.getByTestId('fc-cc-confirmar').click();
    await expect(page.getByTestId('fc-cc-notice')).toContainText('cambiaron');
    await expect(page.getByTestId('fc-cc-esperado-1')).toContainText('101.000,00');
    await expect(page.getByTestId('fc-cc-input-1')).toHaveValue('100000');
    await expect(page.getByTestId('fc-cc-dif-1')).toContainText('1.000');
  });

  test('19, 38-43 · cierre existente, historial, detalle, conciliación parcial y comprobante', async ({ page }) => {
    await mockCierres(page);
    await abrirCierre(page);
    await completar(page, { 1: '115000', 2: '350000', 4: '200000', 8: '50000', 7: '0' });
    await page.getByTestId('fc-cc-revisar').click();
    await page.getByTestId('fc-cc-confirmar').click();
    await page.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(page.getByTestId('fc-cc-detalle')).toBeVisible();
    const ef = page.getByTestId('fc-cc-detalle-1');
    await expect(ef).toContainText('Pendiente');
    await page.getByTestId('fc-cc-conciliar-1').click();
    const cn = page.getByRole('dialog', { name: /Resolver diferencia/ });
    await cn.locator('#fc-cn-tipo').selectOption('MOVIMIENTO_REGISTRADO');
    await page.getByTestId('fc-cn-candidatos').locator('input[type=checkbox]').first().check();
    await expect(page.getByTestId('fc-cn-importe')).toHaveValue(/^10\.000/);
    await page.getByTestId('fc-cn-revisar').click();
    await expect(page.getByTestId('fc-cn-compensacion')).toContainText('10.000');
    await page.getByTestId('fc-cn-confirmar').click();
    await expect(cn).toBeHidden();
    await expect(ef).toContainText('Parcialmente conciliada');
    await expect(ef.getByTestId('fc-cc-pendiente')).toContainText('5.000');
    await expect(ef.getByTestId('fc-cc-dif-original')).toContainText('15.000');
    const pdf = page.waitForEvent('download');
    await page.getByTestId('fc-cc-pdf').click();
    expect((await pdf).suggestedFilename()).toMatch(/^cierre_caja_CC-000001_/);
    await page.getByRole('button', { name: /Volver al historial/ }).click();
    await expect(page.locator('[data-cierre-id]')).toHaveCount(1);
    await page.locator('#fc-hc-desde').fill('2000-01-01');
    await page.locator('#fc-hc-hasta').fill('2000-01-02');
    await expect(page.locator('[data-cierre-id]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cerrar caja' }).click();
    await expect(page.getByTestId('fc-cc-existente')).toContainText('No se reemplaza');
    await expect(page.getByTestId('fc-cc-revisar')).toBeDisabled();
  });

  test('UX V2 · detalle simple y opciones independientes: conciliar movimientos o ajustar sin conciliar', async ({ page }) => {
    const st = await mockCierres(page);
    await abrirCierre(page);
    await completar(page, { 1: '100000', 2: '350000', 4: '431910,04', 8: '50000', 7: '0' });
    await page.getByTestId('fc-cc-revisar').click();
    await page.getByTestId('fc-cc-confirmar').click();
    await page.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(page.getByText('Cajas revisadas')).toBeVisible();
    await expect(page.getByText('Ver información completa y trazabilidad')).toBeVisible();
    const banco = page.getByTestId('fc-cc-detalle-4');
    await expect(banco).toContainText('231.910,04');
    await expect(banco).toContainText('Resolver diferencia');
    await banco.getByRole('button', { name: 'Resolver diferencia' }).click();
    const dlg = page.getByRole('dialog', { name: /Resolver diferencia/ });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: /Conciliar diferencia/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByRole('button', { name: /Aplicar ajuste autorizado/ })).toBeEnabled();
    await expect(dlg.getByText('Movimientos seleccionados')).toBeVisible();
    await dlg.getByRole('button', { name: /Aplicar ajuste autorizado/ }).click();
    await expect(dlg.getByTestId('fc-caj-panel')).toBeVisible();
    await expect(dlg.getByText(/La diferencia seguirá pendiente/)).toBeVisible();
    await dlg.locator('#fc-caj-ver').fill('431910,04');
    await dlg.locator('#fc-caj-obs').fill('Corrección autorizada por arqueo bancario');
    await dlg.getByTestId('fc-caj-aplicar').click();
    await expect(dlg).toBeHidden();
    expect(st.calls.ajustar).toHaveLength(1);
    await expect(banco).toContainText('Se registró un ajuste de saldo');
    await expect(banco.getByTestId('fc-cc-pendiente')).toContainText('231.910,04');
    await banco.getByRole('button', { name: 'Resolver diferencia' }).click();
    const nuevamente = page.getByRole('dialog', { name: /Resolver diferencia/ });
    await expect(nuevamente.getByRole('button', { name: /Aplicar ajuste autorizado/ })).toBeDisabled();
    await expect(nuevamente.getByText(/No se puede aplicar otro ajuste provisional/)).toBeVisible();
  });

  test('responsive y modo oscuro sin desbordes', async ({ page }) => {
    await mockCierres(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(FLUJO_ROUTE);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'oscuro'));
    await page.getByRole('button', { name: 'Cerrar caja' }).click();
    await expect(page.getByTestId('fc-cc-input-1')).toBeVisible();
    const overflow = await page.locator('.fc-cc-modal').evaluate((m) => m.scrollWidth - m.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* =========================================================
   B) API sin escrituras
========================================================= */

test.describe('@flujo @cierre-caja API sin escrituras', () => {
  test('48 · tenant con o sin migración: el resto de Flujo de Caja sigue respondiendo', async ({ page }) => {
    const today = todayISO();
    const resumen = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_resumen', { query: { fecha_desde: today, fecha_hasta: today } }));
    expect(resumen.cierres_caja, 'el resumen informa la habilitación').toBeTruthy();
    const estado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_estado'));
    expect(typeof estado.habilitado).toBe('boolean');
    if (!estado.habilitado) {
      const prev = await authenticatedApi(page, 'flujo_caja_cierres_previsualizar');
      expect(prev.status).toBe(409);
      expect(prev.body.codigo).toBe('CIERRES_NO_HABILITADOS');
      test.info().annotations.push({ type: 'info', description: 'Tenant sin migración de cierres: comportamiento controlado verificado.' });
    }
  });

  test('3-6 · medios reales sin CHEQUE/ECHEQ y saldos iguales a Ajustes / Análisis Financiero', async ({ page }) => {
    const estado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_estado'));
    test.skip(!estado.habilitado, 'Migración de cierres no aplicada en este tenant.');
    const prev = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_previsualizar'));
    expect(prev.medios.some((m) => /CHEQ/i.test(m.nombre))).toBe(false);
    const ids = prev.medios.map((m) => m.id_medio_pago);
    expect(new Set(ids).size).toBe(ids.length);
    const aj = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios'));
    for (const m of prev.medios) {
      const a = aj.medios.find((x) => x.id_medio_pago === m.id_medio_pago);
      if (a) close(m.saldo_esperado, a.saldo_actual, `${m.nombre}: misma fuente de saldos que Ajustes`);
    }
    const af = await financialAnalysis(page, prev.fecha_negocio, prev.fecha_negocio);
    const total = prev.medios.reduce((s, m) => s + n(m.saldo_esperado), 0);
    const afMedios = (af?.tesoreria?.medios || af?.data?.tesoreria?.medios || []);
    if (afMedios.length) close(total, afMedios.reduce((s, m) => s + n(m.saldo_final), 0), 'total esperado = Análisis Financiero');
  });

  test('validaciones: POST obligatorio, fecha futura y clave inválida no escriben', async ({ page }) => {
    const estado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_estado'));
    test.skip(!estado.habilitado, 'Migración de cierres no aplicada en este tenant.');
    for (const action of ['flujo_caja_cierres_confirmar', 'flujo_caja_cierres_conciliar', 'flujo_caja_cierres_ajuste_aplicar']) {
      const res = await authenticatedApi(page, action, { method: 'GET' });
      expect(res.status, action).toBe(405);
    }
    const futura = await authenticatedApi(page, 'flujo_caja_cierres_previsualizar', { query: { fecha_operativa: '2999-01-01' } });
    expect(futura.status).toBe(400);
    expect(futura.body.codigo).toBe('FECHA_FUTURA');
    const inexistente = await authenticatedApi(page, 'flujo_caja_cierres_detalle', { query: { id_cierre: 999999999 } });
    expect(inexistente.status).toBe(404);
  });
});

/* =========================================================
   C) Mutaciones reales (tenant E2E aislado)
========================================================= */

test.describe('@flujo @cierre-caja @mutations cierres y conciliaciones reales', () => {
  test.describe.configure({ mode: 'serial' });
  let fecha = '';
  let prev = null;
  let cierre = null;

  async function fechaLibre(page) {
    const usados = new Set((expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_listar', { query: { fecha_desde: '2001-01-01', fecha_hasta: '2001-12-31', limit: 500 } })).rows || []).map((r) => r.fecha_operativa));
    for (let i = 0; i < 365; i += 1) {
      const d = new Date(Date.UTC(2001, 0, 1 + ((Date.now() / 86400000 + i) % 365))).toISOString().slice(0, 10);
      if (!usados.has(d)) return d;
    }
    throw new Error('No hay fechas E2E libres en 2001.');
  }

  test.beforeEach(async ({ page }) => {
    test.skip(!CIERRES_MUTATIONS, 'PW_CIERRES_MUTATIONS no está habilitado (requiere limpieza de cierres integrada).');
    await requireMutations(test, page);
    const estado = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_estado'));
    test.skip(!estado.habilitado, 'Migración de cierres no aplicada en el tenant E2E.');
  });

  test('20, 16-17, 19 · cierre histórico, idempotencia, concurrencia y duplicado', async ({ page }) => {
    fecha = await fechaLibre(page);
    prev = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_previsualizar', { query: { fecha_operativa: fecha } }));
    expect(prev.es_historico).toBe(true);
    const efectivo = prev.medios.find((m) => m.clase_medio === 'EFECTIVO') || prev.medios[0];
    const cuenta = prev.medios.find((m) => m.clase_medio === 'CUENTA' && m.id_medio_pago !== efectivo.id_medio_pago);
    const medios = prev.medios.map((m) => ({
      id_medio_pago: m.id_medio_pago, saldo_esperado: money(m.saldo_esperado),
      saldo_verificado: money(n(m.saldo_esperado) + (m === efectivo ? 1500 : m === cuenta ? -1000 : 0)),
    }));
    const base = { fecha_operativa: fecha, observaciones: `${RUN_PREFIX} CIERRE E2E`, medios };
    const sinUno = await authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, medios: medios.slice(1), clave_solicitud: clave('cie-falta') } });
    expect(sinUno.body.codigo).toBe('MEDIOS_SIN_VERIFICAR');
    const conAjuste = await authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, medios: medios.map((m) => (m.id_medio_pago === efectivo.id_medio_pago ? { ...m, aplicar_ajuste: true } : m)), clave_solicitud: clave('cie-hist-aj') } });
    expect(conAjuste.body.codigo, '20 · un histórico no ajusta el saldo actual').toBe('AJUSTE_NO_PERMITIDO');
    const stale = await authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, medios: medios.map((m, i) => (i === 0 ? { ...m, saldo_esperado: money(n(m.saldo_esperado) + 1) } : m)), clave_solicitud: clave('cie-stale') } });
    expect(stale.status, '18 · 409 por saldo desactualizado').toBe(409);

    const kA = clave('cie-a');
    const kB = clave('cie-b');
    const [a, b] = await Promise.all([
      authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, clave_solicitud: kA } }),
      authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, clave_solicitud: kB } }),
    ]);
    const exitos = [a, b].filter((r) => r.status === 200);
    expect(exitos.length, '17 · dos solicitudes simultáneas: sólo una crea el cierre').toBe(1);
    expect([a, b].filter((r) => r.status === 409 && r.body.codigo === 'CIERRE_DUPLICADO').length).toBe(1);
    cierre = exitos[0].body;
    const kOk = a.status === 200 ? kA : kB;
    const repetido = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, clave_solicitud: kOk } }));
    expect([repetido.duplicado, repetido.cierre.id_cierre], '16 · doble envío con la misma clave').toEqual([true, cierre.cierre.id_cierre]);
    const dupClave = await authenticatedApi(page, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { ...base, clave_solicitud: clave('cie-dup') } });
    expect(dupClave.body.codigo, '19 · cierre duplicado del día').toBe('CIERRE_DUPLICADO');
    const ef = cierre.detalles.find((d) => d.id_medio_pago === efectivo.id_medio_pago);
    close(ef.diferencia, 1500, '9 · sobrante de efectivo');
    expect(ef.id_ajuste_saldo, '20 · sin ajuste automático').toBeNull();
    if (cuenta) {
      const cu = cierre.detalles.find((d) => d.id_medio_pago === cuenta.id_medio_pago);
      expect([cu.tipo_diferencia, cu.estado_conciliacion, cu.id_ajuste_saldo]).toEqual(['FALTANTE', 'PENDIENTE', null]);
    }
  });

  test('13, 24-30, 34 · ajuste posterior, conciliación parcial y total sin duplicar dinero', async ({ page }) => {
    test.skip(!cierre, 'Requiere el cierre del test anterior.');
    const ef = cierre.detalles.find((d) => d.tipo_diferencia === 'SOBRANTE');
    const medios0 = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios')).medios;
    const saldo0 = medios0.find((m) => m.id_medio_pago === ef.id_medio_pago).saldo_actual;
    const pv = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_ajuste_previsualizar', { query: { id_cierre_detalle: ef.id_cierre_detalle } })).preview;
    close(pv.ajuste, 1500, 'ajuste posterior = pendiente');
    const mal = await authenticatedApi(page, 'flujo_caja_cierres_ajuste_aplicar', { method: 'POST', body: { id_cierre_detalle: ef.id_cierre_detalle, saldo_actual_esperado: money(pv.saldo_actual), saldo_verificado_actual: money(pv.saldo_actual), observaciones: `${RUN_PREFIX} AJUSTE`, clave_solicitud: clave('caj-mal') } });
    expect(mal.body.codigo).toBe('VERIFICACION_NO_COINCIDE');
    const kAj = clave('caj');
    const bodyAj = { id_cierre_detalle: ef.id_cierre_detalle, saldo_actual_esperado: money(pv.saldo_actual), saldo_verificado_actual: money(pv.saldo_resultante), observaciones: `${RUN_PREFIX} AJUSTE POSTERIOR`, clave_solicitud: kAj };
    const aj = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_ajuste_aplicar', { method: 'POST', body: bodyAj }));
    const efAj = aj.detalles.find((d) => d.id_cierre_detalle === ef.id_cierre_detalle);
    expect(efAj.estado_conciliacion, '7 · ajustada sigue pendiente').toBe('PENDIENTE');
    expect(expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_ajuste_aplicar', { method: 'POST', body: bodyAj })).duplicado).toBe(true);
    const rev = await authenticatedApi(page, 'flujo_caja_ajustes_revertir', { method: 'POST', body: { id_ajuste: efAj.id_ajuste_saldo, observaciones: `${RUN_PREFIX} REVERSION`, clave_solicitud: clave('rev') } });
    expect(rev.body.codigo, '34-35 · la reversión completa del ajuste de cierre está bloqueada').toBe('AJUSTE_DE_CIERRE');

    // 25: conciliación parcial (error de arqueo 1.000) con compensación −1.000.
    const parcial = { id_cierre_detalle: ef.id_cierre_detalle, tipo_resolucion: 'ERROR_DE_ARQUEO', importe: '1000.00', observaciones: `${RUN_PREFIX} CONTEO`, pendiente_esperado: '1500.00', clave_solicitud: clave('cnc1') };
    const kC2 = clave('cnc1b');
    const [p1, p2] = await Promise.all([
      authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: parcial }),
      authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { ...parcial, clave_solicitud: kC2 } }),
    ]);
    expect([p1, p2].filter((r) => r.status === 200).length, '14 · dos conciliaciones simultáneas no concilian dos veces').toBe(1);
    const kOkC = p1.status === 200 ? parcial.clave_solicitud : kC2;
    const dup = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { ...parcial, clave_solicitud: kOkC } }));
    expect(dup.duplicado, '28 · conciliación duplicada').toBe(true);
    const det1 = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_detalle', { query: { id_cierre: cierre.cierre.id_cierre } }));
    const d1 = det1.detalles.find((d) => d.id_cierre_detalle === ef.id_cierre_detalle);
    expect([d1.estado_conciliacion, n(d1.importe_pendiente)]).toEqual(['PARCIALMENTE_CONCILIADA', 500]);
    close(d1.diferencia, 1500, '42 · conserva el importe original');
    const over = await authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { ...parcial, importe: '600.00', pendiente_esperado: '500.00', clave_solicitud: clave('cnc-over') } });
    expect(over.body.codigo, '27 · no se concilia más que lo pendiente').toBe('IMPORTE_SUPERA_PENDIENTE');

    // 26: segunda conciliación que completa.
    const fin = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { ...parcial, importe: '500.00', pendiente_esperado: '500.00', clave_solicitud: clave('cnc2') } }));
    const d2 = fin.detalles.find((d) => d.id_cierre_detalle === ef.id_cierre_detalle);
    expect(d2.estado_conciliacion).toBe('CONCILIADA');
    // 29-30: neto = ajuste +1.500 − compensaciones 1.500 = 0 sobre el saldo inicial.
    const medios1 = expectApiSuccess(await authenticatedApi(page, 'flujo_caja_ajustes_medios')).medios;
    close(medios1.find((m) => m.id_medio_pago === ef.id_medio_pago).saldo_actual, saldo0, '30 · sin doble contabilización');
  });

  test('21, 31-33 · conciliación con venta real y validación del pago vinculado', async ({ page }) => {
    test.skip(!cierre, 'Requiere el cierre del test anterior.');
    const cu = cierre.detalles.find((d) => d.tipo_diferencia === 'FALTANTE');
    test.skip(!cu, 'No hay medio de cuenta con faltante.');
    const ine = await authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { id_cierre_detalle: cu.id_cierre_detalle, tipo_resolucion: 'MOVIMIENTO_REGISTRADO', importe: '1000.00', ids_movimiento_medio_pago: [2147483000], pendiente_esperado: '1000.00', clave_solicitud: clave('cnc-ine') } });
    expect(ine.body.codigo, '31 · pago inexistente').toBe('MOVIMIENTO_INEXISTENTE');

    const lists = await getLists(page, 'ventas');
    const client = await createParty(page, 'client', 'CIERRE CLIENTE');
    const product = await createProduct(page, 'CIERRE PRODUCTO', { stock: 5, cost: 10, price: 1000 });
    const otroMedio = cierre.detalles.find((d) => d.id_medio_pago !== cu.id_medio_pago);
    const venta = expectApiSuccess(await createSale(page, { fecha: todayISO(), typeId: tipoVentaId(lists, 'CONTADO'), clientId: client.id, productId: product.id, amount: 1000, medios: [{ id_medio_pago: otroMedio.id_medio_pago, monto: 1000 }] }));
    const idPago = Number(venta.ids_pago?.[0] || 0);
    test.skip(!idPago, 'La venta no devolvió ids_pago.');
    const otro = await authenticatedApi(page, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { id_cierre_detalle: cu.id_cierre_detalle, tipo_resolucion: 'MOVIMIENTO_REGISTRADO', importe: '1000.00', ids_movimiento_medio_pago: [idPago], pendiente_esperado: '1000.00', clave_solicitud: clave('cnc-otro') } });
    expect(['MOVIMIENTO_OTRO_MEDIO', 'MOVIMIENTO_SENTIDO_INVALIDO'], '33 · pago de otro medio / sentido').toContain(otro.body.codigo);
  });

  test('44-47 · auditoría y empleado sin permisos por API directa', async ({ page, browser }) => {
    test.skip(!cierre, 'Requiere el cierre del test anterior.');
    const username = `${RUN_PREFIX}-CC-EMP`.slice(0, 36);
    const password = `Pw-${Date.now()}-Aa1!`;
    try {
      await createEmployeeTestUser(page, username, password);
      const employee = await loginTestUserInNewContext(browser, username, password);
      const ep = employee.page;
      for (const action of ['flujo_caja_cierres_estado', 'flujo_caja_cierres_previsualizar', 'flujo_caja_cierres_listar']) {
        expect((await authenticatedApi(ep, action)).status, `46 · ${action}`).toBe(403);
      }
      const conf = await authenticatedApi(ep, 'flujo_caja_cierres_confirmar', { method: 'POST', body: { fecha_operativa: fecha, medios: [], clave_solicitud: clave('emp') } });
      expect(conf.status, '45/47 · empleado no confirma').toBe(403);
      const conc = await authenticatedApi(ep, 'flujo_caja_cierres_conciliar', { method: 'POST', body: { id_cierre_detalle: cierre.detalles[0].id_cierre_detalle, clave_solicitud: clave('emp2') } });
      expect(conc.status, '47 · empleado no concilia').toBe(403);
      const resumen = expectApiSuccess(await authenticatedApi(ep, 'flujo_caja_resumen', { query: { fecha_desde: todayISO(), fecha_hasta: todayISO() } }));
      expect(resumen.cierres_caja?.habilitado).toBe(false);
      await employee.context.close();
    } finally {
      await cleanupTestUser(page, username);
    }
  });
});
