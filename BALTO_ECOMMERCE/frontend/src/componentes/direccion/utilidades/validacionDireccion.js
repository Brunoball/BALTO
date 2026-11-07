import { formatoCP, normalizarCP } from './geografia';

/**
 * Validación ÚNICA de domicilios (perfil y checkout). Espejo de
 * api/modulos/cliente/DireccionValidator.php: el servidor vuelve a validar todo.
 */
export const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]{0,99}$/u;
export const PHONE_RE = /^\+?[\d\s()-]{8,40}$/;
export const ETIQUETAS = Object.freeze([
  { codigo: 'CASA', nombre: 'Casa' }, { codigo: 'TRABAJO', nombre: 'Trabajo' }, { codigo: 'OTRA', nombre: 'Otra' },
]);

export const EMPTY_ADDRESS = Object.freeze({
  etiqueta: 'CASA', destinatario_nombre: '', destinatario_apellido: '', telefono: '',
  pais: 'AR', provincia: '', provincia_id: '', localidad: '', localidad_id: '', codigo_postal: '',
  calle: '', altura: '', piso_depto: '', referencias: '',
});

export function telefonoValido(v) {
  const s = String(v ?? '').trim();
  const digits = s.replace(/\D/g, '');
  return PHONE_RE.test(s) && digits.length >= 8 && digits.length <= 15;
}

export function normalizarAltura(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return ['SN', 'S/N', 'S-N', 'SIN', 'SINNUMERO', 'SINNÚMERO'].includes(s) ? 'S/N' : s;
}

/**
 * @param {object} a domicilio
 * @param {{destinatario?: 'requerido'|'opcional', paises?: string[]}} opts
 * @returns {object} errores por campo (vacío si es válido)
 */
export function validateAddress(a, { destinatario = 'requerido', paises = ['AR'] } = {}) {
  const e = {};
  const v = (k) => String(a?.[k] ?? '').trim();
  if (!ETIQUETAS.some((x) => x.codigo === (v('etiqueta') || 'CASA'))) e.etiqueta = 'Elegí Casa, Trabajo u Otra.';
  const exigir = destinatario === 'requerido';
  if ((exigir || v('destinatario_nombre')) && !NAME_RE.test(v('destinatario_nombre'))) e.destinatario_nombre = 'Ingresá el nombre de quien recibe (solo letras).';
  if ((exigir || v('destinatario_apellido')) && !NAME_RE.test(v('destinatario_apellido'))) e.destinatario_apellido = 'Ingresá el apellido de quien recibe (solo letras).';
  if (v('telefono') && !telefonoValido(v('telefono'))) e.telefono = 'Ingresá un teléfono válido (con código de área).';
  const pais = (v('pais') || 'AR').toUpperCase();
  if (!paises.includes(pais)) e.pais = 'Por ahora solo realizamos entregas en los países habilitados por la tienda.';
  if (v('provincia').length < 2) e.provincia = 'Elegí la provincia.';
  if (v('provincia').length > 120) e.provincia = 'Demasiado largo.';
  if (v('localidad').length < 2) e.localidad = 'Ingresá la localidad.';
  if (v('localidad').length > 120) e.localidad = 'Demasiado largo.';
  const cp = normalizarCP(v('codigo_postal'));
  if (cp && (cp.length > 10 || !formatoCP(cp, pais))) {
    e.codigo_postal = pais === 'AR' ? 'Código postal inválido: usá 4 números (5000) o el CPA (X5000ABC).' : 'Código postal inválido.';
  }
  if (v('calle').length < 2) e.calle = 'Ingresá la calle.';
  if (v('calle').length > 150) e.calle = 'Demasiado largo.';
  const altura = normalizarAltura(v('altura'));
  if (altura !== 'S/N' && !/^\d{1,6}[A-Z]?$/.test(altura)) e.altura = 'Ingresá la altura (número) o S/N.';
  if (v('piso_depto').length > 40) e.piso_depto = 'Máximo 40 caracteres.';
  if (v('referencias').length > 300) e.referencias = 'Máximo 300 caracteres.';
  return e;
}

/** Datos que se envían al servidor (sin campos vacíos innecesarios). */
export function addressPayload(a) {
  const t = (k) => String(a?.[k] ?? '').trim();
  const out = {
    etiqueta: t('etiqueta') || 'CASA',
    destinatario_nombre: t('destinatario_nombre') || null,
    destinatario_apellido: t('destinatario_apellido') || null,
    telefono: t('telefono') || null,
    pais: (t('pais') || 'AR').toUpperCase(),
    provincia: t('provincia'),
    provincia_id: /^\d{2}$/.test(t('provincia_id')) ? t('provincia_id') : null,
    localidad: t('localidad'),
    localidad_id: /^\d{1,20}$/.test(t('localidad_id')) ? t('localidad_id') : null,
    codigo_postal: normalizarCP(t('codigo_postal')) || null,
    calle: t('calle'),
    altura: normalizarAltura(t('altura')),
    piso_depto: t('piso_depto') || null,
    referencias: t('referencias') || null,
  };
  if (a?.id) out.id = a.id;
  return out;
}

/** Dirección guardada (respuesta del servidor) -> valores del formulario. */
export function addressFromServer(d) {
  const out = { ...EMPTY_ADDRESS };
  for (const k of Object.keys(EMPTY_ADDRESS)) if (d?.[k] !== null && d?.[k] !== undefined) out[k] = String(d[k]);
  return { ...out, id: d?.id };
}

export function addressLine(d) {
  if (!d) return '';
  const calle = [d.calle, d.altura].filter(Boolean).join(' ');
  return [calle, d.piso_depto].filter(Boolean).join(', ');
}

export function addressCity(d) {
  if (!d) return '';
  return [d.localidad, d.provincia, d.codigo_postal ? `CP ${d.codigo_postal}` : null].filter(Boolean).join(' · ');
}
