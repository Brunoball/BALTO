import { loginPath, safeRedirect } from './redireccionSegura';

test('acepta rutas internas de la tienda', () => {
  expect(safeRedirect('/checkout')).toBe('/checkout');
  expect(safeRedirect('/mi-cuenta/pedidos?pagina=2#x')).toBe('/mi-cuenta/pedidos?pagina=2#x');
});

test('rechaza destinos externos o peligrosos', () => {
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'evil.com', '/%0d%0aSet-Cookie', '\u0000/x', '', null, '/iniciar-sesion?volver=/x', `/${'a'.repeat(600)}`]) {
    const r = safeRedirect(bad, '/mi-cuenta');
    expect(r.startsWith('/') && !r.startsWith('//')).toBe(true);
    if (bad !== '/%0d%0aSet-Cookie') expect(r).toBe('/mi-cuenta');
  }
});

test('loginPath vuelve a la página actual', () => {
  expect(loginPath({ pathname: '/checkout', search: '' })).toBe('/iniciar-sesion?volver=%2Fcheckout');
  expect(loginPath({ pathname: '/iniciar-sesion', search: '?volver=/x' })).toBe('/iniciar-sesion?volver=%2Fmi-cuenta');
});
