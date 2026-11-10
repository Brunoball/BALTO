import { arbolCategorias, cartKey, filtrosAParams, leerFiltrosURL, normalizePriceRange, sanitizePriceInput, ORDER_OPTIONS } from './catalogo';
import { precioARS, whatsAppLink } from '../../global/utilidades/formato';
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


test('ofrece las opciones de orden que entiende el servidor', () => {
  expect(ORDER_OPTIONS.map((o) => o.value)).toEqual(['destacados', 'precio-asc', 'precio-desc', 'nombre', 'recientes']);
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

// Filtros en la URL: el catálogo filtra en el servidor y la URL se puede compartir.
test('lee los filtros de la URL y descarta valores inválidos', () => {
  const f = leerFiltrosURL(new URLSearchParams('q=remera&categoria=12&orden=precio-asc&precio_min=10.5&precio_max=abc&disponibles=1&pagina=3'));
  expect(f).toEqual({ q: 'remera', categoria: '12', orden: 'precio-asc', precio_min: '105', precio_max: '', disponibles: true, pagina: 3 });
  const d = leerFiltrosURL(new URLSearchParams('orden=hackeo&pagina=-4'));
  expect(d.orden).toBe('destacados');
  expect(d.pagina).toBe(1);
});
test('la URL solo lleva los filtros que no son los de por defecto', () => {
  expect(filtrosAParams({ q: '  ', categoria: '', orden: 'destacados', precio_min: '', precio_max: '', disponibles: false, pagina: 1 }).toString()).toBe('');
  expect(filtrosAParams({ q: 'remera azul', categoria: '3', orden: 'nombre', precio_min: '100', precio_max: '', disponibles: true, pagina: 2 }).toString())
    .toBe('q=remera+azul&categoria=3&orden=nombre&precio_min=100&disponibles=1&pagina=2');
  const ida = { q: 'buzo', categoria: '7', orden: 'precio-desc', precio_min: '1', precio_max: '9', disponibles: true, pagina: 4 };
  expect(leerFiltrosURL(filtrosAParams(ida))).toEqual(ida);
});
test('arma el árbol de categorías: padre y debajo sus hijas', () => {
  const arbol = arbolCategorias([
    { id: 3, nombre: 'REMERAS', id_padre: 2, cantidad: 1 },
    { id: 4, nombre: 'QUESOS', id_padre: null, cantidad: 1 },
    { id: 2, nombre: 'ROPA', id_padre: null, cantidad: 2 },
    { id: 9, nombre: 'HUERFANA', id_padre: 99, cantidad: 1 },
  ]);
  expect(arbol.map((c) => [c.nombre, c.nivel])).toEqual([['QUESOS', 0], ['ROPA', 0], ['REMERAS', 1], ['HUERFANA', 0]]);
});
