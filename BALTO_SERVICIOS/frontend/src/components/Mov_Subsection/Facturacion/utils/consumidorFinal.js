// Receptor fiscal anónimo. No representa un cliente nuevo en BALTO ni debe
// guardarse en clientes_fiscales (el cliente comercial se conserva por separado).
export const LIMITE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR = 10000000;

export function crearReceptorConsumidorFinal() {
  return {
    doc_tipo: 99,
    doc_nro: "0",
    cuit: "",
    razon_social: "A CONSUMIDOR FINAL",
    cond_iva: "Consumidor Final",
    condicion_iva: "Consumidor Final",
    domicilio: "NR",
    origen: "consumidor_final_sin_identificar",
  };
}

export function validarConsumidorFinalSinIdentificar(total) {
  const monto = Number(total);
  if (!Number.isFinite(monto) || monto <= 0) return "El importe total debe ser mayor a cero.";
  if (monto >= LIMITE_CONSUMIDOR_FINAL_SIN_IDENTIFICAR) {
    return "Desde $10.000.000 inclusive ARCA exige identificar al comprador. Elegí la opción con documento.";
  }
  return "";
}
