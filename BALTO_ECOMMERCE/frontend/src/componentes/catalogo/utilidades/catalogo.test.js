import { filterProducts, getCategories, cartKey, normalizePriceRange, sanitizePriceInput, ORDER_OPTIONS } from './catalogo';
import { precioARS, whatsAppLink } from '../../global/utilidades/formato';
test('obtiene categorías reales sin duplicados', () => {
  expect(getCategories([{categoria: 'Accesorios'},{categoria:'Accesorios'},{categoria:'Ropa'}])).toEqual(['Accesorios', 'Ropa']);
});
test('filtra productos de la página sin alterar el arreglo recibido', () => {
  const original = [{nombre:'B', precio:'2500', disponible:true, categoria:'Dos'}, {nombre:'A',precio:'1500', disponible:true, categoria:'Uno'}];
  expect(filterProducts(original, { order:'precio-asc' })[0].nombre).toBe('A');
  expect(original[0].nombre).toBe('B');
});
test('preserva claves diferentes para variantes de un mismo producto', () => {
  expect(cartKey({ idPublicacion: 2 }, { idVariante: 4 })).not.toBe(cartKey({ idPublicacion:2 }, { idVariante:5 }));
});
test('formatea importes reales y no genera precios ficticios', () => {
  expect(precioARS('1500.00', 'ARS')).toMatch(/1\.500/);
  expect(precioARS(null)).toBe('Consultar precio');
});
test('solo crea enlaces de whatsapp con número válido', () => {
  expect(whatsAppLink(null)).toBeNull();
  expect(whatsAppLink('5493415550000', 'Hola')).toContain('wa.me/5493415550000');
});

const productos = [
  { nombre: 'Taza', precio: '1500', disponible: true, categoria: 'Cocina', destacado: false },
  { nombre: 'Bowl', precio: '4200.50', disponible: false, categoria: 'Cocina', destacado: true },
  { nombre: 'Almohadón', precio: '9800', disponible: true, categoria: 'Deco', destacado: false },
  { nombre: 'Lámpara', precio: null, disponible: true, categoria: 'Deco', destacado: true },
];

test('ofrece las cuatro opciones de orden', () => {
  expect(ORDER_OPTIONS.map((o) => o.value)).toEqual(['destacados', 'precio-asc', 'precio-desc', 'nombre']);
});
test('limpia los importes ingresados: sin negativos, letras ni separadores', () => {
  expect(sanitizePriceInput('-1500')).toBe('1500');
  expect(sanitizePriceInput('1.500,50')).toBe('150050');
  expect(sanitizePriceInput('abc')).toBe('');
  expect(sanitizePriceInput('0042')).toBe('42');
  expect(sanitizePriceInput('0')).toBe('0');
});
test('valida el rango de precios', () => {
  expect(normalizePriceRange('', '')).toEqual({ min: null, max: null, error: null });
  expect(normalizePriceRange('1000', '')).toEqual({ min: 1000, max: null, error: null });
  expect(normalizePriceRange('', '5000')).toEqual({ min: null, max: 5000, error: null });
  expect(normalizePriceRange('5000', '1000').error).toMatch(/mínimo/);
  expect(normalizePriceRange('-5', '').error).toMatch(/negativos/);
  expect(normalizePriceRange('abc', '').error).toBeTruthy();
});
test('filtra por rango de precio y excluye productos sin precio', () => {
  const nombres = (lista) => lista.map((p) => p.nombre);
  expect(nombres(filterProducts(productos, { minPrice: 2000, order: 'precio-asc' }))).toEqual(['Bowl', 'Almohadón']);
  expect(nombres(filterProducts(productos, { maxPrice: 4200.5, order: 'precio-asc' }))).toEqual(['Taza', 'Bowl']);
  expect(nombres(filterProducts(productos, { minPrice: 1500, maxPrice: 1500 }))).toEqual(['Taza']);
  expect(filterProducts(productos, {}).length).toBe(4);
});
test('combina búsqueda, categoría, disponibilidad, precio y orden', () => {
  const result = filterProducts(productos, { term: 'a', category: 'Cocina', stockOnly: true, minPrice: 1000, maxPrice: 5000, order: 'precio-desc' });
  expect(result.map((p) => p.nombre)).toEqual(['Taza']);
  expect(filterProducts(productos, { category: 'Deco', order: 'nombre' }).map((p) => p.nombre)).toEqual(['Almohadón', 'Lámpara']);
  expect(filterProducts(productos, { order: 'destacados' })[0].destacado).toBe(true);
});
test('al ordenar por precio, los productos sin precio quedan al final', () => {
  expect(filterProducts(productos, { order: 'precio-asc' }).map((p) => p.nombre)).toEqual(['Taza', 'Bowl', 'Almohadón', 'Lámpara']);
  expect(filterProducts(productos, { order: 'precio-desc' }).map((p) => p.nombre)).toEqual(['Almohadón', 'Bowl', 'Taza', 'Lámpara']);
});
