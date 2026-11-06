/** Formatos de interfaz. Nunca se generan precios de prueba. */
export function precioARS(value, currency = 'ARS') {
  if (value === undefined || value === null || value === '') return 'Consultar precio';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 'Consultar precio';
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'ARS', maximumFractionDigits: 2 }).format(amount);
  } catch (_) {
    return `$ ${amount.toLocaleString('es-AR')}`;
  }
}

export function whatsAppLink(number, text = '') {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function telephoneLink(number) {
  const digits = String(number ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 8 ? `tel:${digits}` : null;
}

export function safePublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null;
  } catch (_) { return null; }
}
