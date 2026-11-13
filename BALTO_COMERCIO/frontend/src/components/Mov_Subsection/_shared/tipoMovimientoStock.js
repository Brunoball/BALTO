/* ================================================================
   TIPO DE MOVIMIENTO por renglón — Compras, Ventas y Presupuestos.

   Ambas opciones usan el MISMO producto del catálogo:
   - "MUEVE STOCK" (predeterminado): comportamiento normal; la compra suma
     y la venta resta existencias.
   - "NO MUEVE STOCK": se registra el producto con su cantidad, precio e IVA,
     pero no suma ni resta existencias.

   No confundir con `sinStock`, que en las filas indica falta de existencias.
   El backend vuelve a validar cada renglón.
================================================================ */

export const TIPO_MOV_MUEVE_STOCK = "MUEVE_STOCK";
export const TIPO_MOV_NO_MUEVE_STOCK = "NO_MUEVE_STOCK";

export const TIPO_MOVIMIENTO_STOCK_OPCIONES = [
  { value: TIPO_MOV_MUEVE_STOCK, label: "MUEVE STOCK" },
  { value: TIPO_MOV_NO_MUEVE_STOCK, label: "NO MUEVE STOCK" },
];

export function normalizarTipoMovimientoStock(value) {
  const v = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return v === TIPO_MOV_NO_MUEVE_STOCK ? TIPO_MOV_NO_MUEVE_STOCK : TIPO_MOV_MUEVE_STOCK;
}

export function esFilaNoMueveStock(row) {
  return normalizarTipoMovimientoStock(row?.tipoMovimientoStock) === TIPO_MOV_NO_MUEVE_STOCK;
}

/** Tipo guardado de un ítem leído del backend (registros viejos: MUEVE STOCK). */
export function tipoMovimientoDesdeItem(item) {
  const raw = item && typeof item === "object" ? item : {};
  const explicito = String(raw.tipo_movimiento_stock ?? raw.tipoMovimientoStock ?? "").trim();
  if (explicito) return normalizarTipoMovimientoStock(explicito);
  const registrado = raw.mueve_stock_registrado;
  if (registrado !== null && registrado !== undefined && registrado !== "" && Number(registrado) === 0) {
    return TIPO_MOV_NO_MUEVE_STOCK;
  }
  return TIPO_MOV_MUEVE_STOCK;
}

/** Campos del TIPO DE MOVIMIENTO que viajan en cada ítem con producto. */
export function payloadTipoMovimientoStock(row) {
  const tipo = normalizarTipoMovimientoStock(row?.tipoMovimientoStock);
  return {
    tipo_movimiento_stock: tipo,
    mueve_stock: tipo === TIPO_MOV_MUEVE_STOCK ? 1 : 0,
  };
}
