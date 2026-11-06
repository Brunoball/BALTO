/**
 * Validación del formulario de compra como invitado (espejo de CheckoutValidator.php).
 * Es solo para ayudar al comprador: el servidor vuelve a validar todo.
 */
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]{0,99}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[\d\s()-]{8,40}$/;
const CP_RE = /^[A-Za-z0-9 -]{3,20}$/;

export const EMPTY_BUYER = Object.freeze({
  nombre: '', apellido: '', email: '', telefono: '', modalidad_entrega: '',
  direccion: '', localidad: '', provincia: '', codigo_postal: '', observaciones: '',
});

export function requiresAddress(modalidades = [], codigo = '') {
  return Boolean(modalidades.find((m) => m.codigo === codigo)?.requiere_direccion);
}

export function validateBuyer(values, modalidades = []) {
  const e = {};
  const v = (k) => String(values[k] ?? '').trim();
  if (!v('nombre') || !NAME_RE.test(v('nombre'))) e.nombre = 'Ingresá tu nombre (solo letras).';
  if (!v('apellido') || !NAME_RE.test(v('apellido'))) e.apellido = 'Ingresá tu apellido (solo letras).';
  if (!v('email') || v('email').length > 190 || !EMAIL_RE.test(v('email'))) e.email = 'Ingresá un email válido.';
  const digits = v('telefono').replace(/\D/g, '');
  if (!PHONE_RE.test(v('telefono')) || digits.length < 8 || digits.length > 15) e.telefono = 'Ingresá un teléfono válido (con código de área).';
  const codigos = modalidades.map((m) => m.codigo);
  const modalidad = v('modalidad_entrega') || (codigos.length === 1 ? codigos[0] : '');
  if (!codigos.includes(modalidad)) e.modalidad_entrega = 'Elegí una modalidad de entrega.';
  if (requiresAddress(modalidades, modalidad)) {
    if (v('direccion').length < 5) e.direccion = 'Ingresá la dirección de entrega.';
    if (v('direccion').length > 255) e.direccion = 'La dirección es demasiado larga.';
    if (v('localidad').length < 2) e.localidad = 'Ingresá la localidad.';
    if (v('codigo_postal') && !CP_RE.test(v('codigo_postal'))) e.codigo_postal = 'Código postal inválido.';
  }
  if (v('observaciones').length > 1000) e.observaciones = 'Máximo 1000 caracteres.';
  return e;
}

/** Datos del comprador que se envían (sin campos de dirección si la modalidad no los pide). */
export function buyerPayload(values, modalidades = []) {
  const codigos = modalidades.map((m) => m.codigo);
  const modalidad = String(values.modalidad_entrega || '').trim() || (codigos.length === 1 ? codigos[0] : '');
  const base = {
    nombre: values.nombre.trim(), apellido: values.apellido.trim(), email: values.email.trim(),
    telefono: values.telefono.trim(), modalidad_entrega: modalidad,
    observaciones: values.observaciones.trim() || null,
  };
  if (!requiresAddress(modalidades, modalidad)) return base;
  return {
    ...base,
    direccion: values.direccion.trim(), localidad: values.localidad.trim(),
    provincia: values.provincia.trim() || null, codigo_postal: values.codigo_postal.trim() || null,
  };
}
