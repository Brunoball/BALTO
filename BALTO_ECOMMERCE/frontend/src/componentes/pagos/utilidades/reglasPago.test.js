import { estadoPagoTexto, metodosPara, pagosActivos, tamanoLegible, tonoPago, validarArchivoComprobante } from './reglasPago';

const config = (over = {}) => ({
  pagos: {
    activo: true,
    estado: 'ACTIVO',
    metodos_por_modalidad: {
      RETIRO: [{ codigo: 'TRANSFERENCIA_BANCARIA', alcance: 'TOTAL' }, { codigo: 'EFECTIVO' }],
      ENVIO: [{ codigo: 'EFECTIVO' }, { codigo: 'MERCADO_PAGO' }],
    },
    ...over,
  },
});

test('sin pagos activos no se ofrece ningún método (checkout legado)', () => {
  expect(pagosActivos(null)).toBe(false);
  expect(pagosActivos({ pagos: { activo: false, estado: 'DESACTIVADO' } })).toBe(false);
  expect(pagosActivos(config({ estado: 'SIN_METODOS' }))).toBe(false);
  expect(metodosPara({ pagos: { activo: false } }, 'RETIRO')).toEqual([]);
});

test('métodos según modalidad; Mercado Pago nunca es seleccionable', () => {
  expect(metodosPara(config(), 'RETIRO').map((m) => m.codigo)).toEqual(['TRANSFERENCIA_BANCARIA', 'EFECTIVO']);
  expect(metodosPara(config(), 'ENVIO').map((m) => m.codigo)).toEqual(['EFECTIVO']);
  expect(metodosPara(config(), 'A_COORDINAR')).toEqual([]);
  expect(metodosPara(config(), '')).toEqual([]);
});

test('el texto de estado nunca dice pagado sin confirmación del comercio', () => {
  expect(estadoPagoTexto('TRANSFERENCIA_BANCARIA', 'PENDIENTE', 'SIN_COMPROBANTE')).toBe('Esperando transferencia');
  expect(estadoPagoTexto('TRANSFERENCIA_BANCARIA', 'EN_REVISION', 'PENDIENTE')).toBe('Comprobante enviado · en revisión');
  expect(estadoPagoTexto('TRANSFERENCIA_BANCARIA', 'PENDIENTE', 'RECHAZADO')).toBe('Comprobante rechazado');
  expect(estadoPagoTexto('TRANSFERENCIA_BANCARIA', 'PAGADO', 'APROBADO')).toBe('Pago verificado');
  expect(estadoPagoTexto('EFECTIVO', 'PENDIENTE', null)).toBe('Pendiente de pago en efectivo');
  expect(estadoPagoTexto('EFECTIVO', 'PAGADO', null)).toBe('Pago recibido');
  expect(estadoPagoTexto(null, null, null)).toBe('Pago a coordinar');
  expect(tonoPago('PAGADO')).toBe('ok');
  expect(tonoPago('PENDIENTE', 'RECHAZADO')).toBe('danger');
  expect(tonoPago('EN_REVISION', 'PENDIENTE')).toBe('pending');
});

test('validación previa del comprobante', () => {
  expect(validarArchivoComprobante(null)).toBe('Elegí un archivo.');
  expect(validarArchivoComprobante({ type: 'image/gif', size: 10 })).toMatch(/Formato no admitido/);
  expect(validarArchivoComprobante({ type: 'text/html', size: 10 })).toMatch(/Formato no admitido/);
  expect(validarArchivoComprobante({ type: 'application/pdf', size: 0 })).toBe('El archivo está vacío.');
  expect(validarArchivoComprobante({ type: 'image/png', size: 6 * 1048576 })).toBe('El archivo supera el máximo de 5 MB.');
  expect(validarArchivoComprobante({ type: 'image/png', size: 3 * 1048576 }, 2.5 * 1048576)).toBe('El archivo supera el máximo de 2.5 MB.');
  expect(validarArchivoComprobante({ type: 'image/jpeg', size: 1000 })).toBe(null);
  expect(tamanoLegible(70)).toBe('70 B');
  expect(tamanoLegible(2048)).toBe('2 KB');
  expect(tamanoLegible(1.5 * 1048576)).toBe('1,5 MB');
});
