/**
 * Datos geográficos estables de Argentina (fallback cuando Georef no responde).
 * Identificadores: códigos INDEC usados por Georef (datos.gob.ar).
 */
export const PROVINCIAS_AR = Object.freeze([
  { id: '02', nombre: 'Ciudad Autónoma de Buenos Aires' }, { id: '06', nombre: 'Buenos Aires' },
  { id: '10', nombre: 'Catamarca' }, { id: '22', nombre: 'Chaco' }, { id: '26', nombre: 'Chubut' },
  { id: '14', nombre: 'Córdoba' }, { id: '18', nombre: 'Corrientes' }, { id: '30', nombre: 'Entre Ríos' },
  { id: '34', nombre: 'Formosa' }, { id: '38', nombre: 'Jujuy' }, { id: '42', nombre: 'La Pampa' },
  { id: '46', nombre: 'La Rioja' }, { id: '50', nombre: 'Mendoza' }, { id: '54', nombre: 'Misiones' },
  { id: '58', nombre: 'Neuquén' }, { id: '62', nombre: 'Río Negro' }, { id: '66', nombre: 'Salta' },
  { id: '70', nombre: 'San Juan' }, { id: '74', nombre: 'San Luis' }, { id: '78', nombre: 'Santa Cruz' },
  { id: '82', nombre: 'Santa Fe' }, { id: '86', nombre: 'Santiago del Estero' },
  { id: '94', nombre: 'Tierra del Fuego, Antártida e Islas del Atlántico Sur' }, { id: '90', nombre: 'Tucumán' },
]);

export const PAISES = Object.freeze({ AR: 'Argentina', UY: 'Uruguay', CL: 'Chile', PY: 'Paraguay', BO: 'Bolivia', BR: 'Brasil' });

/**
 * La primera letra del CPA (Código Postal Argentino, 8 caracteres) identifica la
 * provincia (código ISO 3166-2:AR). Es la ÚNICA inferencia confiable sin una base
 * postal: no se deduce la localidad, y un CP de 4 dígitos no indica provincia.
 */
const CPA_LETRA_PROVINCIA = Object.freeze({
  C: '02', B: '06', K: '10', X: '14', W: '18', H: '22', U: '26', E: '30', P: '34', Y: '38', L: '42', F: '46',
  M: '50', N: '54', Q: '58', R: '62', A: '66', J: '70', D: '74', Z: '78', S: '82', G: '86', T: '90', V: '94',
});

export function normalizarCP(cp) {
  return String(cp || '').toUpperCase().replace(/\s+/g, '');
}

/** 'TRADICIONAL' (4 dígitos), 'CPA' (letra + 4 dígitos + 3 letras) o null. */
export function formatoCP(cp, pais = 'AR') {
  const v = normalizarCP(cp);
  if (pais !== 'AR') return /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(v) ? 'OTRO' : null;
  if (/^\d{4}$/.test(v)) return 'TRADICIONAL';
  if (/^[A-HJ-NP-Z]\d{4}[A-Z]{3}$/.test(v)) return 'CPA';
  return null;
}

/** Provincia sugerida por un CPA válido, o null. */
export function provinciaDesdeCPA(cp) {
  const v = normalizarCP(cp);
  if (formatoCP(v) !== 'CPA') return null;
  const id = CPA_LETRA_PROVINCIA[v[0]];
  return PROVINCIAS_AR.find((p) => p.id === id) || null;
}
