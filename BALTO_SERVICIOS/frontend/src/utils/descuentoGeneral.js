/* ================================================================
   Descuento general de VENTAS y PRESUPUESTOS (BALTO Servicios).

   Única fuente del cálculo en React. El backend PHP replica EXACTAMENTE
   este algoritmo (mov_descuento_general_prorratear y
   mov_descuento_general_resolver en modules/movimientos/global/helpers.php)
   y es la fuente autoritativa: recalcula, valida y rechaza diferencias.

   Basado en el mecanismo ya corregido de BALTO Comercio
   (Mov_Subsection/Ventas/utils/ventaDescuento.js), con dos diferencias
   pedidas para Servicios:
   - Los valores fuera de rango NO se recortan en silencio: ≥ 100 % o un
     monto ≥ total son inválidos y bloquean el guardado.
   - El precio y la cantidad se normalizan a la misma precisión que guarda
     la base (2 y 6 decimales) antes de calcular, para que navegador y
     servidor partan de los mismos números.

   Dos representaciones de cada renglón:
   - Comercial (lo que ve el usuario): precioLista, subtotalBruto,
     ivaMontoBruto, totalBruto. NO incluyen el descuento general.
   - Persistida / fiscal: precio (unitario neto), subtotal, ivaMonto, total.
     Incluyen el descuento prorrateado. Se usan para ARCA, para guardar la
     operación, para los pagos y para las notas de crédito.

   Prorrateo: cada renglón recibe round(totalBruto_i × factor) y el último
   renglón con importe absorbe el residuo de centavos, de modo que la suma
   de los renglones netos es exactamente totalBruto − descuento. Neto e IVA
   se reconstruyen desde ese total con la alícuota de cada renglón.
================================================================ */

export const DESCUENTO_PORCENTAJE = "PORCENTAJE";
export const DESCUENTO_MONTO = "MONTO";

export function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(v) {
  return Math.round((safeNumber(v) + Number.EPSILON) * 100) / 100;
}

export function roundQty(v) {
  return Math.round((safeNumber(v) + Number.EPSILON) * 1000000) / 1000000;
}

/**
 * Interpreta lo que escribe el usuario en el campo del descuento.
 * Acepta "10", "10,5", "10.5", "28.000" (miles AR), "1.234,56".
 * Devuelve { vacio, valido, valor }.
 */
export function parseDescuentoInput(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { vacio: false, valido: true, valor: raw }
      : { vacio: false, valido: false, valor: NaN };
  }
  let txt = String(raw ?? "").trim().replace(/\s+/g, "").replace(/^\$/, "").replace(/%$/, "");
  if (txt === "") return { vacio: true, valido: true, valor: 0 };

  const hasComma = txt.includes(",");
  const hasDot = txt.includes(".");
  if (hasComma && hasDot) {
    txt = txt.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    txt = txt.replace(",", ".");
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(txt)) {
    // "28.000" o "1.500.000": separadores de miles (formato argentino).
    txt = txt.replace(/\./g, "");
  }

  if (!/^-?\d*(\.\d*)?$/.test(txt) || txt === "-" || txt === "." || txt === "-.") {
    return { vacio: false, valido: false, valor: NaN };
  }
  const n = Number(txt);
  if (!Number.isFinite(n)) return { vacio: false, valido: false, valor: NaN };
  return { vacio: false, valido: true, valor: n };
}

/**
 * Renglones con su representación comercial (sin descuento).
 * @param {Array<object>} rows filas con cantidad, precio e ivaPct
 * @param {(row: object) => boolean} tieneItem indica si la fila cuenta para el total
 */
export function calcularRenglonesBrutos(rows, tieneItem = () => true) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const cuenta = Boolean(tieneItem(r));
    const cantidad = Math.max(0, roundQty(r?.cantidad));
    const precioLista = Math.max(0, roundMoney(r?.precio));
    const ivaPct = Math.max(0, roundMoney(r?.ivaPct ?? r?.iva_pct));
    const subtotalBruto = cuenta ? roundMoney(cantidad * precioLista) : 0;
    const ivaMontoBruto = roundMoney(subtotalBruto * (ivaPct / 100));
    const totalBruto = roundMoney(subtotalBruto + ivaMontoBruto);
    // No se pisan cantidad / ivaPct / precio de la fila: la grilla los sigue
    // mostrando y editando tal como los escribió el usuario (p. ej. "2,").
    return {
      ...r,
      cantidadNormalizada: cantidad,
      ivaPctNormalizado: ivaPct,
      precioLista,
      subtotalBruto,
      ivaMontoBruto,
      totalBruto,
    };
  });
}

function sinDescuento(totalBruto, tipo, valor, error = "") {
  return {
    activo: false,
    tipo,
    valor,
    monto: 0,
    totalBruto,
    totalFinal: totalBruto,
    porcentajeEfectivo: 0,
    factor: 1,
    error,
  };
}

/**
 * Valida y calcula el descuento general sobre el total comercial.
 * Si hay error, el descuento NO se aplica (monto 0) y `error` explica por qué:
 * la pantalla lo muestra y el guardado queda bloqueado.
 */
export function calcularDescuentoGeneral(rowsBase, descuentoTipo, descuentoValor) {
  let acc = 0;
  (Array.isArray(rowsBase) ? rowsBase : []).forEach((r) => {
    acc += safeNumber(r?.totalBruto);
  });
  const totalBruto = roundMoney(acc);
  const tipo = descuentoTipo === DESCUENTO_MONTO ? DESCUENTO_MONTO : DESCUENTO_PORCENTAJE;
  const parsed = parseDescuentoInput(descuentoValor);

  if (parsed.vacio) return sinDescuento(totalBruto, tipo, 0);
  if (!parsed.valido) return sinDescuento(totalBruto, tipo, 0, "Ingresá un número válido para el descuento.");
  if (parsed.valor < 0) return sinDescuento(totalBruto, tipo, 0, "El descuento no puede ser negativo.");

  const valor = roundMoney(parsed.valor);
  if (valor === 0) return sinDescuento(totalBruto, tipo, 0);
  if (tipo === DESCUENTO_PORCENTAJE && valor >= 100) {
    return sinDescuento(totalBruto, tipo, valor, "El descuento porcentual debe ser menor al 100 %.");
  }
  if (!(totalBruto > 0)) {
    return sinDescuento(totalBruto, tipo, valor, "Cargá al menos un renglón con importe antes de aplicar el descuento.");
  }
  if (tipo === DESCUENTO_MONTO && valor >= totalBruto) {
    return sinDescuento(totalBruto, tipo, valor, "El descuento debe ser menor al total de la operación.");
  }

  const monto = tipo === DESCUENTO_PORCENTAJE ? roundMoney(totalBruto * (valor / 100)) : valor;
  if (monto < 0.01) {
    return sinDescuento(totalBruto, tipo, valor, "El descuento resultante es menor a $0,01.");
  }
  const totalFinal = roundMoney(totalBruto - monto);
  if (monto >= totalBruto || totalFinal < 0.01) {
    return sinDescuento(totalBruto, tipo, valor, "El descuento debe ser menor al total de la operación.");
  }

  return {
    activo: true,
    tipo,
    valor,
    monto,
    totalBruto,
    totalFinal,
    porcentajeEfectivo: (monto / totalBruto) * 100,
    factor: totalFinal / totalBruto,
    error: "",
  };
}

export function prorratearDescuentoGeneral(rowsBase, descuentoResumen) {
  const rows = Array.isArray(rowsBase) ? rowsBase : [];
  const monto = safeNumber(descuentoResumen?.monto);
  const validIndexes = rows
    .map((r, index) => (safeNumber(r.totalBruto) > 0 ? index : -1))
    .filter((index) => index >= 0);
  const lastValidIndex = validIndexes.length ? validIndexes[validIndexes.length - 1] : -1;
  let totalNetoAcumulado = 0;

  return rows.map((r, index) => {
    const cantidad = Math.max(0, safeNumber(r.cantidadNormalizada ?? r.cantidad));
    const ivaPct = Math.max(0, safeNumber(r.ivaPctNormalizado ?? r.ivaPct));
    const totalBruto = roundMoney(r.totalBruto);

    if (totalBruto <= 0 || monto <= 0) {
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

export function calcularResumenOperacion(rowsCalc, descuentoResumen) {
  const rows = Array.isArray(rowsCalc) ? rowsCalc : [];
  return {
    subtotal: roundMoney(rows.reduce((a, r) => a + safeNumber(r.subtotal), 0)),
    iva: roundMoney(rows.reduce((a, r) => a + safeNumber(r.ivaMonto), 0)),
    total: roundMoney(rows.reduce((a, r) => a + safeNumber(r.total), 0)),
    subtotalBruto: roundMoney(rows.reduce((a, r) => a + safeNumber(r.subtotalBruto), 0)),
    ivaBruto: roundMoney(rows.reduce((a, r) => a + safeNumber(r.ivaMontoBruto), 0)),
    totalBruto: safeNumber(descuentoResumen?.totalBruto),
    descuento: descuentoResumen?.activo ? safeNumber(descuentoResumen.monto) : 0,
    descuentoTipo: descuentoResumen?.tipo || DESCUENTO_PORCENTAJE,
    descuentoValor: safeNumber(descuentoResumen?.valor),
    descuentoPorcentajeEfectivo: safeNumber(descuentoResumen?.porcentajeEfectivo),
    descuentoError: String(descuentoResumen?.error || ""),
  };
}

/** Campos del descuento para enviar al backend (todos neutros sin descuento). */
export function descuentoPayload(resumen) {
  const activo = safeNumber(resumen?.descuento) > 0;
  return {
    descuento_tipo: activo ? resumen.descuentoTipo : null,
    descuento_valor: activo ? roundMoney(resumen.descuentoValor) : 0,
    descuento_monto: activo ? roundMoney(resumen.descuento) : 0,
    total_bruto: roundMoney(activo ? resumen.totalBruto : resumen?.total),
  };
}

/**
 * Descuento persistido de un movimiento (venta o presupuesto) o null.
 * Nunca vuelve a restar el descuento: el total final es la suma de renglones netos.
 */
export function descuentoDesdeMovimiento(mov, totalFinalFallback = null) {
  const m = mov && typeof mov === "object" ? mov : {};
  const monto = roundMoney(m.descuento_monto ?? m.monto_descuento ?? 0);
  if (!(monto > 0)) return null;
  const tipo = String(m.descuento_tipo || "").toUpperCase() === DESCUENTO_MONTO ? DESCUENTO_MONTO : DESCUENTO_PORCENTAJE;
  const valor = roundMoney(m.descuento_valor ?? 0);
  const totalFinal = roundMoney(
    totalFinalFallback ?? m.total_final ?? m.monto_total ?? m.total_movimiento ?? m.total ?? 0
  );
  let totalBruto = roundMoney(m.total_bruto ?? m.total_sin_descuento ?? 0);
  if (!(totalBruto > 0) || Math.abs(totalBruto - monto - totalFinal) > 0.02) {
    totalBruto = roundMoney(totalFinal + monto);
  }
  return {
    tipo,
    valor,
    monto,
    totalBruto,
    totalFinal,
    porcentajeEfectivo: totalBruto > 0 ? (monto / totalBruto) * 100 : 0,
  };
}

export function formatPorcentaje(v) {
  const n = safeNumber(v);
  return n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** "10 %" o "$ 28.000,00" (+ equivalente) para mostrar en resúmenes y PDFs. */
export function etiquetaDescuento(d, money = (n) => `$ ${roundMoney(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) {
  if (!d) return "";
  if (d.tipo === DESCUENTO_PORCENTAJE) return `${formatPorcentaje(d.valor)} %`;
  return `${money(d.monto)} (≈ ${formatPorcentaje(d.porcentajeEfectivo)} %)`;
}

/**
 * Renglones de un documento (detalle desde DB) con la información de
 * bonificación por renglón para comprobantes: precio unitario original y
 * bonificación incluida. Los importes netos (subtotal / IVA / total) no cambian.
 */
export function itemsConBonificacion(items) {
  return (Array.isArray(items) ? items : []).map((it) => {
    const precioLista = it?.precio_lista;
    if (precioLista === null || precioLista === undefined || precioLista === "") return it;
    const pl = roundMoney(precioLista);
    const cantidad = safeNumber(it?.cantidad);
    const subtotal = roundMoney(it?.subtotal);
    const subtotalBruto = roundMoney(cantidad * pl);
    const impBonif = Math.max(0, roundMoney(subtotalBruto - subtotal));
    return {
      ...it,
      precio_unitario: pl,
      precio: pl,
      precio_neto: safeNumber(it?.precio),
      impBonif,
      bonif_pct: subtotalBruto > 0 ? (impBonif / subtotalBruto) * 100 : 0,
    };
  });
}
