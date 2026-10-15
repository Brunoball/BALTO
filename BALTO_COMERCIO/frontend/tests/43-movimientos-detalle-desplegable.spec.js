import { test, expect } from './support/test.js';
import {
  getDetalleMovimiento,
  getItemsVisiblesMovimiento,
  getResumenItemsMovimiento,
} from '../src/components/Mov_Subsection/_shared/detalleMovimiento.js';

/**
 * Regresión de los conceptos desplegables de BALTO Comercio (solo lectura).
 *
 * Los ocho recorridos de interfaz reciben registros de prueba por intercepción
 * de GET al listado. NO se insertan movimientos ni se modifica MySQL.
 * Los botones de operaciones (guardar/editar/eliminar) jamás se presionan.
 * La API real, sus permisos y la persistencia siguen cubiertos por el resto
 * de la suite: estas pruebas aíslan el contrato visual de la tabla.
 */
const NOMBRE_VARIANTE = 'MATE PRUEBA E2E AZUL';
const NOMBRE_MANUAL = 'MANO DE OBRA PRUEBA E2E';
const NOMBRE_CONSUMO = 'INSUMO INTERNO OCULTO E2E';
const NOMBRE_UNICO = 'PRODUCTO UNICO PRUEBA E2E';

const MODULOS = [
  { nombre: 'Ventas', ruta: '/panel/ventas', accion: 'ventas_listar', tipoOperacion: 1 },
  { nombre: 'Compras', ruta: '/panel/compras', accion: 'compras_listar', tipoOperacion: 2 },
  { nombre: 'Otros ingresos', ruta: '/panel/Otrosingresos', accion: 'otros_ingresos_listar', tipoOperacion: 3 },
  { nombre: 'Otros egresos', ruta: '/panel/Otrosegresos', accion: 'otros_egresos_listar', tipoOperacion: 4 },
  { nombre: 'Recibos', ruta: '/panel/recibos', accion: 'recibos_listar', tipoOperacion: 1 },
  { nombre: 'Órdenes de pago', ruta: '/panel/OrdenesPago', accion: 'ordenes_pago_listar', tipoOperacion: 2, tipoVenta: 2 },
  { nombre: 'Presupuestos', ruta: '/panel/presupuesto', accion: 'presupuestos_listar', tipoOperacion: 1 },
  { nombre: 'Movimientos general', ruta: '/panel/movimientos', accion: 'movimientos_listar', tipoOperacion: 1 },
];

function fechaActualLocal() {
  // Usar una sola fecha para TODAS las peticiones de la prueba.
  // DateRangeContext puede consultar primero el mes entero y después los
  // últimos N días (configuración del tenant). Si cada respuesta pone su
  // fecha_desde en el fixture, la primera puede quedar fuera del rango final
  // y el listado aparece vacío aunque la intercepción haya funcionado.
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

function detalleMixto() {
  return [
    {
      id_movimiento_item: 990001,
      tipo_item_db: 'ARTICULO',
      producto_nombre: 'MATE PRUEBA E2E',
      stock_variante_nombre: 'AZUL',
      cantidad: 2,
      precio: 3500,
      total: 7000,
    },
    {
      id_movimiento_item: 990002,
      tipo_item_db: 'DETALLE',
      descripcion: NOMBRE_MANUAL,
      cantidad: 1,
      precio: 4000,
      total: 4000,
    },
    {
      // Consumo automático de una receta: no representa un renglón comercial.
      id_movimiento_item: 990003,
      tipo_item_db: 'CONSUMO_ARTICULO',
      articulo_nombre: NOMBRE_CONSUMO,
      cantidad: 3,
      precio: 99,
      total: 297,
    },
  ];
}

function registroSimulado(modulo, fecha, individual = false) {
  const id = individual ? 990012 : 990011;
  const items = individual
    ? [{
        id_movimiento_item: 990004,
        tipo_item_db: 'ARTICULO',
        producto_nombre: NOMBRE_UNICO,
        cantidad: 1,
        precio: 2500,
        total: 2500,
      }]
    : detalleMixto();
  const total = individual ? 2500 : 11000;
  return {
    id_movimiento: id,
    id_presupuesto: id,
    id_venta: id,
    fecha,
    id_tipo_operacion: modulo.tipoOperacion,
    id_tipo_venta: modulo.tipoVenta ?? 1,
    id_cliente: 1,
    id_proveedor: 1,
    cliente: 'CLIENTE CONTROL E2E',
    proveedor: 'PROVEEDOR CONTROL E2E',
    nombre_cliente: 'CLIENTE CONTROL E2E',
    nombre_proveedor: 'PROVEEDOR CONTROL E2E',
    tipo_operacion: modulo.tipoOperacion === 2 ? 'COMPRA' : 'VENTA',
    detalle: individual ? '1 PRODUCTO' : '1 PRODUCTO / 1 DETALLE',
    descripcion: individual ? '1 PRODUCTO' : '1 PRODUCTO / 1 DETALLE',
    cantidad_items: individual ? 1 : 2,
    monto_total: total,
    total,
    subtotal: total,
    importe: total,
    pagado: 0,
    cobrado_total: 0,
    pagado_total: 0,
    saldo_pendiente: total,
    convertido_a_venta: 0,
    items_detalle: items,
    origen_tienda_nube: 0,
  };
}

async function instalarListadoControlado(page, modulo) {
  let respuestas = 0;
  const fechaFixture = fechaActualLocal();
  await page.route('**/api.php?*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const accion = url.searchParams.get('action');
    // El calendario del tenant se carga de manera asíncrona y puede reemplazar
    // el período durante la prueba. Fijamos SOLO esta configuración GET para
    // evitar una recarga concurrente que desmonte la fila recién desplegada.
    if (req.method() === 'GET' && accion === 'configuracion_calendario_get') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ ok: true, exito: true, config: { modo: 'mes_completo', dias_atras: 10 } }),
      });
      return;
    }
    if (req.method() !== 'GET' || accion !== modulo.accion) {
      await route.fallback();
      return;
    }
    respuestas += 1;
    // Datos con fecha estable durante los posibles refrescos de calendario.
    const registros = [registroSimulado(modulo, fechaFixture), registroSimulado(modulo, fechaFixture, true)];
    // Admitir los alias reales de los endpoints; solo se intercepta el GET del listado.
    const payload = {
      ok: true, exito: true, mensaje: 'Listado de prueba de solo lectura',
      movimientos: registros, ventas: registros, compras: registros,
      otros_ingresos: registros, ingresos: registros,
      otros_egresos: registros, egresos: registros,
      recibos: registros, ordenes: registros, ordenes_pago: registros,
      presupuestos: registros, has_more: false, next_offset: null,
      total: registros.length,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(payload),
    });
  });
  return () => respuestas;
}

test('@readonly @conceptos contrato: nombres reales, variante, cantidades y consumos internos', async () => {
  const mixto = registroSimulado(MODULOS[0], '2026-10-14');
  const items = getItemsVisiblesMovimiento(mixto);
  expect(items).toHaveLength(2);
  expect(items.map((i) => i.nombre_visible)).toEqual([NOMBRE_VARIANTE, NOMBRE_MANUAL]);
  expect(getResumenItemsMovimiento(mixto)).toBe('1 PRODUCTO / 1 DETALLE');
  expect(getDetalleMovimiento(mixto)).toContain(NOMBRE_VARIANTE);
  expect(getDetalleMovimiento(mixto)).toContain(NOMBRE_MANUAL);
  expect(getDetalleMovimiento(mixto)).not.toContain(NOMBRE_CONSUMO);

  const solo = registroSimulado(MODULOS[0], '2026-10-14', true);
  expect(getItemsVisiblesMovimiento(solo)).toHaveLength(1);
  expect(getDetalleMovimiento(solo)).toBe(NOMBRE_UNICO);
  expect(getResumenItemsMovimiento(solo)).toBe('1 PRODUCTO');
});

for (const modulo of MODULOS) {
  test(`@readonly @conceptos ${modulo.nombre}: desplegar sin deformar la fila original`, async ({ page }) => {
    test.setTimeout(100_000);
    const cantidadRespuestas = await instalarListadoControlado(page, modulo);

    await page.goto(modulo.ruta, { waitUntil: 'domcontentloaded' });
    const fila = page.locator('.mov-gridTable--row:not(.mov-row--skeleton)')
      .filter({ has: page.locator('.mov-detalleTabla__titulo', { hasText: NOMBRE_VARIANTE }) })
      .first();

    await expect(fila, `El listado ${modulo.nombre} debe mostrar el movimiento de prueba`).toBeVisible({ timeout: 45_000 });
    expect(cantidadRespuestas(), `${modulo.nombre} debe consultar el listado interceptado`).toBeGreaterThan(0);

    const descripcion = fila.locator('.mov-detalleTabla');
    await expect(descripcion.locator('.mov-detalleTabla__titulo')).toContainText(`${NOMBRE_VARIANTE} + 1 MÁS`);
    await expect(descripcion.locator('.mov-detalleTabla__aclaracion--tabla'))
      .toContainText('1 PRODUCTO / 1 DETALLE');

    // No hay columna DETALLE nueva ni botón en una tercera línea.
    const encabezados = page.locator('.mov-gridTable [role="columnheader"]');
    await expect(encabezados.filter({ hasText: /^DETALLE$/i })).toHaveCount(0);
    // IMPORTANTE: el nombre accesible del botón cambia de «Ver» a «Ocultar»
    // cuando se abre. Un locator por nombre /Ver.../ deja de encontrarlo
    // justamente al funcionar bien el clic. Seleccionarlo por su clase estable.
    const boton = descripcion.locator('.mov-detalleTabla__boton');
    await expect(boton).toBeVisible();
    await expect(boton).toHaveAttribute('aria-label', 'Ver los 2 conceptos del movimiento');
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await expect(fila.locator('.mov-detalleTabla__resumenLinea')).toContainText('Ver (2)');
    const filaAntes = await fila.boundingBox();
    const celdasAntes = await fila.locator(':scope > [role="cell"]').count();
    expect(celdasAntes).toBeGreaterThan(3);
    // La cabecera y la operación conservan exactamente las mismas columnas.
    await expect(encabezados).toHaveCount(celdasAntes);
    // El panel permanece montado al cerrar para animar CSS; solo .is-open es visible.
    const panel = page.locator('.mov-detalleTabla__filaExpandida.is-open').filter({ hasText: NOMBRE_MANUAL });
    await expect(panel).toHaveCount(0);

    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await expect(boton).toHaveAttribute('aria-label', 'Ocultar los 2 conceptos del movimiento');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.mov-detalleTabla__item')).toHaveCount(2);
    await expect(panel).toContainText(NOMBRE_VARIANTE);
    await expect(panel).toContainText(NOMBRE_MANUAL);
    await expect(panel).toContainText('2 ×');
    await expect(panel).toContainText('3.500');
    await expect(panel).toContainText('7.000');
    await expect(panel).not.toContainText(NOMBRE_CONSUMO);
    expect(await fila.locator(':scope > [role="cell"]').count()).toBe(celdasAntes);
    const filaDespues = await fila.boundingBox();
    expect(filaDespues?.height, 'Abrir el panel no debe agrandar la fila del movimiento')
      .toBeCloseTo(filaAntes?.height, 0);
    await expect(boton).toHaveAttribute('aria-controls', await panel.locator('.mov-detalleTabla__panel').getAttribute('id'));

    await boton.click();
    await expect(panel).toHaveCount(0);
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await expect(boton).toHaveAttribute('aria-label', 'Ver los 2 conceptos del movimiento');

    const filaUnica = page.locator('.mov-gridTable--row:not(.mov-row--skeleton)')
      .filter({ has: page.locator('.mov-detalleTabla__titulo', { hasText: NOMBRE_UNICO }) })
      .first();
    await expect(filaUnica).toBeVisible();
    await expect(filaUnica.locator('.mov-detalleTabla__aclaracion--tabla')).toContainText('1 ×');
    await expect(filaUnica.locator('.mov-detalleTabla__boton')).toHaveCount(0);
  });
}
