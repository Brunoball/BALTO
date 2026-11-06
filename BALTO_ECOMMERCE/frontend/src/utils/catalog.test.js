import { filterProducts, getCategories, cartKey } from './catalog';
import { precioARS, whatsAppLink } from './format';
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
