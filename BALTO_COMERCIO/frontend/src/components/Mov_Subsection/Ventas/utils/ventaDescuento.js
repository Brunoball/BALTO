/* ================================================================
   Cálculo del descuento general de una venta (Nueva Venta).

   Única fuente del cálculo en React. Se extrajo sin cambios de
   ModalNuevaVenta.jsx para poder probarlo de forma aislada y para que
   PHP (mov_venta_prorratear_descuento en movimientos/global/helpers.php)
   replique EXACTAMENTE el mismo algoritmo.

   Dos representaciones de cada renglón:
   - Comercial (lo que se muestra en pantalla): precioLista, subtotalBruto,
     ivaMontoBruto, totalBruto. NO incluyen el descuento general.
   - Fiscal / persistida: precio (neto), subtotal, ivaMonto, total. Incluyen
     el descuento general prorrateado. Se usan para ARCA, para guardar la
     venta y para las notas de crédito.

   Prorrateo: cada renglón recibe round(totalBruto_i * factor) y el último
   renglón válido absorbe el residuo de centavos, de modo que la suma de los
   renglones netos es exactamente el total final.
================================================================ */

export function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(v) {
  return Math.round((safeNumber(v) + Number.EPSILON) * 100) / 100;
}

/**
 * @param {Array<object>} rows         filas de la grilla (cantidad, precio, ivaPct)
 * @param {(row: object) => boolean} tieneItem  indica si la fila tiene producto seleccionado
 */
export function calcularRenglonesBrutos(rows, tieneItem) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const tieneItemSeleccionado = tieneItem(r);
    const cantidad = Math.max(0, safeNumber(r.cantidad));
    const precioLista = Math.max(0, safeNumber(r.precio));
    const ivaPct = Math.max(0, safeNumber(r.ivaPct));
    const subtotalBruto = tieneItemSeleccionado ? roundMoney(cantidad * precioLista) : 0;
    const ivaMontoBruto = roundMoney(subtotalBruto * (ivaPct / 100));
    const totalBruto = roundMoney(subtotalBruto + ivaMontoBruto);
    return {
      ...r,
      precioLista,
      subtotalBruto,
      ivaMontoBruto,
      totalBruto,
    };
  });
}

export function calcularDescuentoGeneral(rowsBase, descuentoTipo, descuentoValor) {
  const totalBruto = roundMoney(rowsBase.reduce((acc, r) => acc + safeNumber(r.totalBruto), 0));
  const tipo = descuentoTipo === "MONTO" ? "MONTO" : "PORCENTAJE";
  const valorIngresado = Math.max(0, safeNumber(descuentoValor));
  const valorNormalizado = tipo === "PORCENTAJE"
    ? roundMoney(Math.min(valorIngresado, 99.99))
    : roundMoney(valorIngresado);
  const maximoAplicable = Math.max(0, roundMoney(totalBruto - 0.01));
  const solicitado = tipo === "PORCENTAJE"
    ? roundMoney(totalBruto * (valorNormalizado / 100))
    : valorNormalizado;
  const monto = Math.min(maximoAplicable, solicitado);
  const totalFinal = roundMoney(totalBruto - monto);
  const porcentajeEfectivo = totalBruto > 0 ? (monto / totalBruto) * 100 : 0;

  return {
    tipo,
    valor: valorNormalizado,
    monto,
    totalBruto,
    totalFinal,
    porcentajeEfectivo,
    factor: totalBruto > 0 ? totalFinal / totalBruto : 1,
  };
}

export function prorratearDescuentoGeneral(rowsBase, descuentoResumen) {
  const validIndexes = rowsBase
    .map((r, index) => (safeNumber(r.totalBruto) > 0 ? index : -1))
    .filter((index) => index >= 0);
  const lastValidIndex = validIndexes.length ? validIndexes[validIndexes.length - 1] : -1;
  let totalNetoAcumulado = 0;

  return rowsBase.map((r, index) => {
    const cantidad = Math.max(0, safeNumber(r.cantidad));
    const ivaPct = Math.max(0, safeNumber(r.ivaPct));
    const totalBruto = roundMoney(r.totalBruto);

    if (totalBruto <= 0 || descuentoResumen.monto <= 0) {
      return {
        ...r,
        precio: r.precioLista,
        subtotal: r.subtotalBruto,
        ivaMonto: r.ivaMontoBruto,
        total: r.totalBruto,
        descuentoMonto: 0,
        descuentoSubtotalMonto: 0,
        bonifPctAplicado: 0,
      };
    }

    const totalNeto = index === lastValidIndex
      ? roundMoney(descuentoResumen.totalFinal - totalNetoAcumulado)
      : roundMoney(totalBruto * descuentoResumen.factor);
    totalNetoAcumulado = roundMoney(totalNetoAcumulado + totalNeto);

    const divisorIva = 1 + ivaPct / 100;
    const subtotal = divisorIva > 0 ? roundMoney(totalNeto / divisorIva) : totalNeto;
    const ivaMonto = roundMoney(totalNeto - subtotal);
    const precioNeto = cantidad > 0 ? roundMoney(subtotal / cantidad) : 0;
    const descuentoMonto = roundMoney(totalBruto - totalNeto);
    const descuentoSubtotalMonto = roundMoney(r.subtotalBruto - subtotal);
    const bonifPctAplicado = r.subtotalBruto > 0
      ? (descuentoSubtotalMonto / r.subtotalBruto) * 100
      : 0;

    return {
      ...r,
      precio: precioNeto,
      subtotal,
      ivaMonto,
      total: totalNeto,
      descuentoMonto,
      descuentoSubtotalMonto,
      bonifPctAplicado,
    };
  });
}

export function calcularResumenVenta(rowsCalc, descuentoResumen) {
  return {
    subtotal: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.subtotal), 0)),
    iva: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.ivaMonto), 0)),
    total: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.total), 0)),
    totalBruto: descuentoResumen.totalBruto,
    descuento: descuentoResumen.monto,
    descuentoTipo: descuentoResumen.tipo,
    descuentoValor: descuentoResumen.valor,
    descuentoPorcentajeEfectivo: descuentoResumen.porcentajeEfectivo,
  };
}
