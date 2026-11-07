import { addressFromServer, addressLine, addressPayload, EMPTY_ADDRESS, normalizarAltura, validateAddress } from './validacionDireccion';
import { formatoCP, provinciaDesdeCPA } from './geografia';
import { buyerPayload, validateBuyer } from '../../checkout/utilidades/validacionCheckout';

const ok = {
  ...EMPTY_ADDRESS, destinatario_nombre: 'Ana', destinatario_apellido: 'Pérez', provincia: 'Córdoba', provincia_id: '14',
  localidad: 'Córdoba', localidad_id: '14014010000', codigo_postal: 'x5000abc', calle: 'Av. Colón', altura: '1234',
};

test('dirección válida (misma regla que el servidor)', () => {
  expect(validateAddress(ok)).toEqual({});
});

test('errores por campo en una dirección incompleta', () => {
  const e = validateAddress({ ...EMPTY_ADDRESS, codigo_postal: '123', altura: 'abc', etiqueta: 'PLAYA' });
  expect(Object.keys(e).sort()).toEqual(['altura', 'calle', 'codigo_postal', 'destinatario_apellido', 'destinatario_nombre', 'etiqueta', 'localidad', 'provincia']);
});

test('destinatario opcional en el checkout, pero válido si se informa', () => {
  const sinDest = { ...ok, destinatario_nombre: '', destinatario_apellido: '' };
  expect(validateAddress(sinDest, { destinatario: 'opcional' })).toEqual({});
  expect(validateAddress({ ...sinDest, destinatario_nombre: '123' }, { destinatario: 'opcional' })).toHaveProperty('destinatario_nombre');
});

test('códigos postales argentinos: 4 dígitos o CPA; nunca se inventa la localidad', () => {
  expect(formatoCP('5000')).toBe('TRADICIONAL');
  expect(formatoCP('X5000ABC')).toBe('CPA');
  expect(formatoCP('b1636 aaa')).toBe('CPA');
  expect(formatoCP('50000')).toBeNull();
  expect(formatoCP('I5000ABC')).toBeNull();
  expect(provinciaDesdeCPA('X5000ABC')).toMatchObject({ id: '14', nombre: 'Córdoba' });
  expect(provinciaDesdeCPA('C1425ABC')).toMatchObject({ id: '02' });
  expect(provinciaDesdeCPA('5000')).toBeNull();
});

test('altura S/N normalizada y payload limpio', () => {
  expect(normalizarAltura('s/n')).toBe('S/N');
  expect(normalizarAltura(' 1234 ')).toBe('1234');
  const p = addressPayload({ ...ok, altura: 'sn', piso_depto: ' ', provincia_id: 'xx' });
  expect(p).toMatchObject({ altura: 'S/N', codigo_postal: 'X5000ABC', piso_depto: null, provincia_id: null, pais: 'AR' });
});

test('dirección del servidor a formulario y línea legible', () => {
  const f = addressFromServer({ id: 4, calle: 'Belgrano', altura: '10', piso_depto: '2 A', telefono: null, pais: 'AR' });
  expect(f).toMatchObject({ id: 4, calle: 'Belgrano', telefono: '' });
  expect(addressLine(f)).toBe('Belgrano 10, 2 A');
});

test('checkout con domicilio estructurado: errores con prefijo entrega_ y payload', () => {
  const modalidades = [{ codigo: 'RETIRO', requiere_direccion: false }, { codigo: 'ENVIO', requiere_direccion: true }];
  const comprador = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', telefono: '351 555-0000', modalidad_entrega: 'ENVIO', observaciones: '' };
  const errs = validateBuyer({ ...comprador, entrega: { ...EMPTY_ADDRESS, telefono: '12' } }, modalidades);
  expect(errs).toHaveProperty('entrega_calle');
  expect(errs).toHaveProperty('entrega_telefono');
  expect(errs).not.toHaveProperty('telefono');
  expect(validateBuyer({ ...comprador, entrega: ok }, modalidades)).toEqual({});
  expect(buyerPayload({ ...comprador, entrega: ok }, modalidades).entrega).toMatchObject({ calle: 'Av. Colón', codigo_postal: 'X5000ABC' });
  // Dirección guardada: solo se envía su id (el servidor verifica que sea del cliente).
  const guardada = buyerPayload({ ...comprador, id_direccion: 7, entrega: ok }, modalidades);
  expect(guardada.id_direccion).toBe(7);
  expect(guardada).not.toHaveProperty('entrega');
  // RETIRO: no se pide ni se envía domicilio.
  expect(validateBuyer({ ...comprador, modalidad_entrega: 'RETIRO', entrega: EMPTY_ADDRESS }, modalidades)).toEqual({});
  expect(buyerPayload({ ...comprador, modalidad_entrega: 'RETIRO', entrega: ok }, modalidades)).not.toHaveProperty('entrega');
});
