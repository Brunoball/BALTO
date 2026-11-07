import {
  addEntry, applyServerLines, buildEntry, cartSignature, cartTotals, itemsForServer, lineCents,
  sanitizeStoredItems, setQuantity, stepQuantity, toMilli, validateQuantity,
} from './carrito';
import { buyerPayload, validateBuyer } from '../../checkout/utilidades/validacionCheckout';

const simple = { idPublicacion: 1, slug: 'remera-test', nombre: 'Remera', precio: '1500.00', moneda: 'ARS', disponible: true, tiene_variantes: false, unidad: { abreviatura: 'u', permite_decimales: false }, cantidad_maxima: '10.000' };
const kg = { idPublicacion: 2, slug: 'queso', nombre: 'Queso', precio: '9000.00', disponible: true, tiene_variantes: false, unidad: { abreviatura: 'kg', permite_decimales: true }, cantidad_maxima: '2.500' };
const conVariantes = { idPublicacion: 3, slug: 'buzo', nombre: 'Buzo', precio: '2000.00', disponible: true, tiene_variantes: true, unidad: { abreviatura: 'u', permite_decimales: false } };
const rojo = { idVariante: 201, nombre: 'Rojo', precio: '2000.00', disponible: true, unidad: { abreviatura: 'u', permite_decimales: false }, cantidad_maxima: '5.000' };
const azul = { idVariante: 202, nombre: 'Azul', precio: '2100.00', disponible: true, unidad: { abreviatura: 'u', permite_decimales: false }, cantidad_maxima: '3.000' };
const add = (items, p, v, q) => addEntry(items, buildEntry(p, v, q).entry);

test('agrega un producto simple', () => {
  const r = add([], simple, null, 2);
  expect(r.resultado).toBe('agregado');
  expect(r.items).toHaveLength(1);
  expect(r.items[0]).toMatchObject({ key: '1:simple', cantidad: 2, precio: '1500.00' });
});

test('agregar dos veces el mismo producto suma en la misma línea', () => {
  let r = add([], simple, null, 2);
  r = add(r.items, simple, null, 3);
  expect(r.items).toHaveLength(1);
  expect(r.items[0].cantidad).toBe(5);
});

test('no supera el stock informado al sumar', () => {
  let r = add([], simple, null, 8);
  r = add(r.items, simple, null, 8);
  expect(r.resultado).toBe('limitado');
  expect(r.items[0].cantidad).toBe(10);
});

test('variantes distintas son líneas independientes y la variante es obligatoria', () => {
  expect(buildEntry(conVariantes, null, 1).ok).toBe(false);
  let r = add([], conVariantes, rojo, 1);
  r = add(r.items, conVariantes, azul, 1);
  expect(r.items.map((x) => x.key)).toEqual(['3:201', '3:202']);
  expect(r.items[1].precio).toBe('2100.00');
});

test('no agrega variantes sin stock ni productos sin precio', () => {
  expect(buildEntry(conVariantes, { ...azul, disponible: false }, 1).ok).toBe(false);
  expect(buildEntry({ ...simple, precio: null }, null, 1).ok).toBe(false);
  expect(buildEntry({ ...simple, precio: '0' }, null, 1).ok).toBe(false);
});

test('valida cantidades según la unidad (permite_decimales)', () => {
  expect(validateQuantity('1.5', { permiteDecimales: false }).ok).toBe(false);
  expect(validateQuantity('1,25', { permiteDecimales: true, max: 2.5 })).toMatchObject({ ok: true, value: 1.25 });
  expect(validateQuantity('0', { permiteDecimales: true }).ok).toBe(false);
  expect(validateQuantity('-1', {}).ok).toBe(false);
  expect(validateQuantity('abc', {}).ok).toBe(false);
  expect(validateQuantity('1.0001', { permiteDecimales: true }).ok).toBe(false);
  expect(validateQuantity(4, { max: 3 })).toMatchObject({ ok: false, value: 3 });
  expect(toMilli(0.1 + 0.2)).toBe(300);
});

test('cambiar cantidades con botones respeta mínimo, máximo y paso', () => {
  expect(stepQuantity(1, -1, {})).toBe(1);
  expect(stepQuantity(9, 1, { max: 10 })).toBe(10);
  expect(stepQuantity(10, 1, { max: 10 })).toBe(10);
  expect(stepQuantity(1, 1, { permiteDecimales: true, max: 2.5 })).toBe(1.1);
  expect(stepQuantity(2.45, 1, { permiteDecimales: true, max: 2.5 })).toBe(2.5);
  let items = add([], simple, null, 2).items;
  items = setQuantity(items, '1:simple', 7);
  expect(items[0].cantidad).toBe(7);
  items = setQuantity(items, '1:simple', 0);
  expect(items[0].cantidad).toBe(7); // inválida: no cambia
  items = setQuantity(items, '1:simple', 50);
  expect(items[0].cantidad).toBe(10); // ajustada al máximo
});

test('eliminar y vaciar se resuelven filtrando líneas', () => {
  let items = add([], simple, null, 1).items;
  items = add(items, kg, null, 1).items;
  expect(items.filter((x) => x.key !== '1:simple').map((x) => x.key)).toEqual(['2:simple']);
});

test('recalcula subtotales exactos (centavos y milésimas)', () => {
  let items = add([], simple, null, 3).items;
  items = add(items, kg, null, 0.75).items;
  expect(lineCents('9000.00', 0.75)).toBe(675000);
  expect(lineCents('0.10', 3)).toBe(30);
  const t = cartTotals(items);
  expect(t.subtotalCents).toBe(450000 + 675000);
  expect(t.subtotal).toBe(11250);
  expect(t.articulos).toBe(4); // 3 unidades + 1 línea fraccionada
});

test('persistencia: sanea lo guardado y migra el formato anterior', () => {
  const stored = JSON.parse(JSON.stringify([
    ...add([], simple, null, 2).items,
    { key: 'x', idPublicacion: 'hack', slug: 'x', cantidad: 1 },
    { idPublicacion: 4, idVariante: null, slug: 'v1', nombre: 'Formato v1', precio: '100', cantidad: 3 },
    { idPublicacion: 5, slug: '../malo', cantidad: 1 },
    { idPublicacion: 1, idVariante: null, slug: 'remera-test', cantidad: 9 },
  ]));
  const items = sanitizeStoredItems(stored);
  expect(items.map((x) => x.key)).toEqual(['1:simple', '4:simple']);
  expect(items[1]).toMatchObject({ cantidad: 3, permite_decimales: false, unidad: 'u' });
  expect(sanitizeStoredItems('basura')).toEqual([]);
});

test('al servidor solo se envían identificadores y cantidades', () => {
  const items = add([], simple, null, 2).items;
  expect(itemsForServer(items)).toEqual([{ idPublicacion: 1, idVariante: null, cantidad: '2' }]);
});

test('actualiza precio y stock desde el servidor y avisa el cambio', () => {
  const items = add([], simple, null, 2).items;
  const { items: next, cambios } = applyServerLines(items, [{ key: '1:simple', slug: 'remera-test', nombre: 'Remera', precio_unitario: '1650.00', cantidad_maxima: '1.000', unidad: { abreviatura: 'u', permite_decimales: false }, estado: 'CANTIDAD_EXCEDE_STOCK' }]);
  expect(next[0].precio).toBe('1650.00');
  expect(next[0].cantidad_maxima).toBe('1.000');
  expect(cambios).toEqual([expect.objectContaining({ tipo: 'PRECIO', anterior: '1500.00', nuevo: '1650.00' })]);
  expect(cartSignature(next)).toBe(cartSignature(items)); // no cambia la cantidad elegida sin avisar
});

test('validación del comprador', () => {
  const modalidades = [{ codigo: 'A_COORDINAR', requiere_direccion: false }];
  const ok = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', telefono: '351 555-0000', modalidad_entrega: '', direccion: '', localidad: '', provincia: '', codigo_postal: '', observaciones: '' };
  expect(validateBuyer(ok, modalidades)).toEqual({});
  expect(Object.keys(validateBuyer({ ...ok, email: 'x', telefono: '12', nombre: '' }, modalidades)).sort()).toEqual(['email', 'nombre', 'telefono']);
  const conEnvio = [{ codigo: 'RETIRO', requiere_direccion: false }, { codigo: 'ENVIO', requiere_direccion: true }];
  expect(validateBuyer({ ...ok, modalidad_entrega: 'ENVIO' }, conEnvio)).toHaveProperty('direccion');
  expect(buyerPayload(ok, modalidades)).toMatchObject({ modalidad_entrega: 'A_COORDINAR' });
  expect(buyerPayload(ok, modalidades)).not.toHaveProperty('direccion');
});
