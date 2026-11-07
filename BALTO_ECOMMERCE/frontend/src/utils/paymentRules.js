/**
 * Medios de pago en la interfaz. La disponibilidad REAL la decide el servidor
 * (tienda_configuracion.configuracion.pagos.metodos_por_modalidad); aquí solo se refleja.
 */
export const METODOS = Object.freeze({
  TRANSFERENCIA_BANCARIA: { nombre: 'Transferencia bancaria', descripcion: 'Transferí a la cuenta de la tienda y adjuntá el comprobante.' },
  EFECTIVO: { nombre: 'Efectivo', descripcion: 'Pagás en efectivo al recibir o retirar tu compra.' },
  MERCADO_PAGO: { nombre: 'Mercado Pago', descripcion: 'Próximamente.' },
});

export function pagosActivos(config) {
  return Boolean(config?.pagos?.activo && config.pagos.estado === 'ACTIVO');
}

/** Métodos seleccionables para la modalidad de entrega elegida. */
export function metodosPara(config, modalidad) {
  if (!pagosActivos(config) || !modalidad) return [];
  const lista = config.pagos.metodos_por_modalidad?.[modalidad];
  return Array.isArray(lista) ? lista.filter((m) => m.codigo !== 'MERCADO_PAGO') : [];
}

export function descripcionMetodo(metodo, modalidad, alcance) {
  if (metodo === 'EFECTIVO') {
    if (modalidad === 'RETIRO') return 'Pagás en efectivo cuando retirás tu compra en el local.';
    if (modalidad === 'ENVIO') return 'Pagás en efectivo al recibir tu compra. La tienda confirmará antes la disponibilidad y las condiciones de entrega.';
    return 'Pagás en efectivo al concretar la entrega que coordines con la tienda.';
  }
  if (metodo === 'TRANSFERENCIA_BANCARIA') {
    return alcance === 'PRODUCTOS'
      ? 'Transferís el importe de los productos. El costo de envío se coordina y se paga aparte.'
      : 'Transferís a la cuenta de la tienda y después adjuntás el comprobante.';
  }
  return METODOS[metodo]?.descripcion || '';
}

/** Texto del estado de pago para el comprador (nunca dice "pagado" sin confirmación del comercio). */
export function estadoPagoTexto(metodo, estadoPago, estadoComprobante) {
  if (estadoPago === 'PAGADO') return metodo === 'TRANSFERENCIA_BANCARIA' ? 'Pago verificado' : 'Pago recibido';
  if (estadoPago === 'CANCELADO') return 'Pago cancelado';
  if (estadoPago === 'DEVUELTO') return 'Pago devuelto';
  if (metodo === 'TRANSFERENCIA_BANCARIA') {
    if (estadoPago === 'EN_REVISION' || estadoComprobante === 'PENDIENTE') return 'Comprobante enviado · en revisión';
    if (estadoComprobante === 'RECHAZADO') return 'Comprobante rechazado';
    return 'Esperando transferencia';
  }
  if (metodo === 'EFECTIVO') return 'Pendiente de pago en efectivo';
  return 'Pago a coordinar';
}

export function tonoPago(estadoPago, estadoComprobante) {
  if (estadoPago === 'PAGADO') return 'ok';
  if (estadoComprobante === 'RECHAZADO' || estadoPago === 'CANCELADO') return 'danger';
  return 'pending';
}

export const COMPROBANTE_TIPOS = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** Validación previa en el navegador (el servidor revisa el contenido real). */
export function validarArchivoComprobante(file, maxBytes = 5 * 1024 * 1024) {
  if (!file) return 'Elegí un archivo.';
  if (!COMPROBANTE_TIPOS.includes(file.type)) return 'Formato no admitido. Subí una imagen JPG, PNG, WEBP o un PDF.';
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > maxBytes) return `El archivo supera el máximo de ${(maxBytes / 1048576).toFixed(1).replace('.0', '')} MB.`;
  return null;
}

export function tamanoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
}
