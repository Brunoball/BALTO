export function getCategories(products = []) {
  const seen = new Set();
  return products.reduce((list, product) => {
    const name = String(product.categoria || '').trim();
    if (name && !seen.has(name)) { seen.add(name); list.push(name); }
    return list;
  }, []);
}

export function filterProducts(products = [], { term = '', category = 'todas', stockOnly = false, order = 'destacados' } = {}) {
  const normalized = String(term).trim().toLocaleLowerCase('es-AR');
  const filtered = products.filter((p) => {
    const terms = `${p.nombre || ''} ${p.categoria || ''} ${p.sku || ''}`.toLocaleLowerCase('es-AR');
    return (!normalized || terms.includes(normalized)) && (category === 'todas' || p.categoria === category) && (!stockOnly || Boolean(p.disponible));
  });
  switch (order) {
    case 'precio-asc': return filtered.sort((a,b) => (Number(a.precio) || 0) - (Number(b.precio) || 0));
    case 'precio-desc': return filtered.sort((a,b) => (Number(b.precio) || 0) - (Number(a.precio) || 0));
    case 'nombre': return filtered.sort((a,b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es-AR'));
    default: return filtered.sort((a,b) => Number(Boolean(b.destacado)) - Number(Boolean(a.destacado)));
  }
}

export function cartKey(product, variant = null) {
  return `${String(product.idPublicacion)}:${variant ? String(variant.idVariante) : 'simple'}`;
}
