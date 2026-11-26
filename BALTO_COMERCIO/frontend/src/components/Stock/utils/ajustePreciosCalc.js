// Cálculo puro del modal "Ajuste de precios" (sin imports: se prueba con node
// en tests/unit/stock-ajuste-precios.unit.mjs).
//
// Reglas que deben coincidir con AjustesPreciosService::crear (backend):
// - porcentaje: anterior * (1 + valor / 100)
// - valor:      anterior + valor
// - fijo:       valor
// - resultado negativo => 0; redondeo a centavos "half away from zero" como round() de PHP.
// - el valor del ajuste se normaliza a 4 decimales (porcentaje, DECIMAL(12,4) en la cabecera)
//   o a 2 decimales (importes), y ese MISMO número se usa en la vista previa y en el payload.

export const MODOS_AJUSTE = ["porcentaje", "valor", "fijo"];

export function parseAjusteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const cleaned = normalized.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Redondeo equivalente a round($x, $decimales) de PHP (pre-redondeo a 15 dígitos). */
export function roundHalfAwayFromZero(value, decimals = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(n) * factor).toPrecision(15));
  const rounded = Math.round(scaled) / factor;
  const signed = n < 0 ? -rounded : rounded;
  return Object.is(signed, -0) ? 0 : signed;
}

export function roundMoney(value) {
  return roundHalfAwayFromZero(value, 2);
}

/** Valor del ajuste ya normalizado (número) o null si el campo está vacío/incompleto. */
export function normalizarValorAjuste(modo, raw) {
  const n = parseAjusteNumber(raw);
  if (n === null) return null;
  return roundHalfAwayFromZero(n, modo === "porcentaje" ? 4 : 2);
}

/** Texto exacto que se envía al backend en `valor_ajuste`. */
export function valorAjusteParaApi(modo, raw) {
  const n = normalizarValorAjuste(modo, raw);
  if (n === null) return "";
  return n.toFixed(modo === "porcentaje" ? 4 : 2);
}

export function calcNuevoPrecio(precioActual, modo, valorNormalizado) {
  const anterior = roundMoney(Number(precioActual || 0));
  const valor = typeof valorNormalizado === "number" ? valorNormalizado : parseAjusteNumber(valorNormalizado);
  if (valor === null || !Number.isFinite(valor)) return anterior;

  let nuevo;
  if (modo === "porcentaje") {
    nuevo = anterior * (1 + valor / 100);
  } else if (modo === "valor") {
    nuevo = anterior + valor;
  } else {
    nuevo = valor;
  }

  if (!Number.isFinite(nuevo)) nuevo = anterior;
  if (nuevo < 0) nuevo = 0;
  return roundMoney(nuevo);
}

export function targetKey(row) {
  const prod = Number(row?.id_stock_producto || 0);
  const rawVar = row?.id_stock_variante;
  const variante = rawVar === null || rawVar === undefined || rawVar === "" || Number(rawVar) <= 0
    ? "base"
    : String(Number(rawVar));
  return `${prod}:${variante}`;
}

export function esVarianteRow(row) {
  const rawVar = row?.id_stock_variante;
  return !(rawVar === null || rawVar === undefined || rawVar === "" || Number(rawVar) <= 0);
}

export function esHeredadoRow(row) {
  return esVarianteRow(row) && Number(row?.precio_heredado || 0) === 1;
}

/** Fila elegible para seleccionar: las variantes que heredan el precio base no lo son. */
export function esSeleccionable(row) {
  return !esHeredadoRow(row);
}

/**
 * Ajuste propuesto para UNA fila. Si la fila no está seleccionada (o no hay valor)
 * el precio final es exactamente el actual y no hay ajuste.
 */
export function calcularFila(row, { seleccionado, modo, valor }) {
  const anterior = roundMoney(Number(row?.precio_actual || 0));
  if (!seleccionado || valor === null || valor === undefined || !esSeleccionable(row)) {
    return { anterior, nuevo: anterior, diferencia: 0, aplica: false };
  }
  const nuevo = calcNuevoPrecio(anterior, modo, valor);
  return { anterior, nuevo, diferencia: roundMoney(nuevo - anterior), aplica: true };
}

/** Filas seleccionadas, en el orden de `opciones`, sólo elegibles. */
export function filasSeleccionadas(opciones, seleccionados) {
  const map = seleccionados || {};
  return (Array.isArray(opciones) ? opciones : []).filter((row) => esSeleccionable(row) && !!map[targetKey(row)]);
}

export function resumirSeleccion(opciones, seleccionados, modo, valor) {
  let anterior = 0;
  let nuevo = 0;
  let conCambio = 0;
  const filas = filasSeleccionadas(opciones, seleccionados);
  filas.forEach((row) => {
    const r = calcularFila(row, { seleccionado: true, modo, valor });
    anterior += r.anterior;
    nuevo += r.nuevo;
    if (r.aplica && r.nuevo !== r.anterior) conCambio += 1;
  });
  anterior = roundMoney(anterior);
  nuevo = roundMoney(nuevo);
  return {
    cantidad: filas.length,
    conCambio,
    anterior,
    nuevo,
    diferencia: roundMoney(nuevo - anterior),
  };
}

/** Ítems del payload: exclusivamente las filas seleccionadas y elegibles. */
export function itemsPayload(opciones, seleccionados) {
  return filasSeleccionadas(opciones, seleccionados).map((row) => ({
    id_stock_producto: Number(row.id_stock_producto),
    id_stock_variante: esVarianteRow(row) ? Number(row.id_stock_variante) : null,
  }));
}

/**
 * Variantes que heredan el precio base de un producto seleccionado: no se escriben,
 * pero su precio final cambia junto con el base. Se informa antes de guardar.
 * Devuelve Map<targetKeyVariante, { nuevoBase, anteriorBase }>.
 */
export function impactoHeredado(opciones, seleccionados, modo, valor) {
  const out = new Map();
  if (valor === null || valor === undefined) return out;
  const map = seleccionados || {};
  const basesSeleccionadas = new Map();
  (Array.isArray(opciones) ? opciones : []).forEach((row) => {
    if (esVarianteRow(row)) return;
    if (!map[targetKey(row)]) return;
    const r = calcularFila(row, { seleccionado: true, modo, valor });
    if (r.nuevo !== r.anterior) basesSeleccionadas.set(Number(row.id_stock_producto), r);
  });
  if (basesSeleccionadas.size === 0) return out;
  (Array.isArray(opciones) ? opciones : []).forEach((row) => {
    if (!esHeredadoRow(row)) return;
    const base = basesSeleccionadas.get(Number(row.id_stock_producto));
    if (base) out.set(targetKey(row), { anteriorBase: base.anterior, nuevoBase: base.nuevo });
  });
  return out;
}

/** Agrupa cada producto con sus variantes (el backend devuelve bases y variantes por separado). */
export function ordenarOpciones(opciones) {
  const rows = Array.isArray(opciones) ? opciones : [];
  const orden = new Map();
  rows.forEach((row, index) => {
    const id = Number(row?.id_stock_producto || 0);
    if (!orden.has(id)) orden.set(id, index);
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = orden.get(Number(a.row?.id_stock_producto || 0));
      const pb = orden.get(Number(b.row?.id_stock_producto || 0));
      if (pa !== pb) return pa - pb;
      const va = esVarianteRow(a.row) ? 1 : 0;
      const vb = esVarianteRow(b.row) ? 1 : 0;
      if (va !== vb) return va - vb;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export function filtrarOpciones(opciones, busqueda) {
  const q = String(busqueda || "").trim().toLowerCase();
  const rows = Array.isArray(opciones) ? opciones : [];
  if (!q) return rows;
  return rows.filter((row) => {
    const haystack = [row.producto_nombre, row.producto_sku, row.variante_nombre, row.variante_sku, row.sku]
      .map((v) => String(v || "").toLowerCase())
      .join(" ");
    return haystack.includes(q);
  });
}

/** Normaliza tipos de precio venidos del endpoint o de ListasContext ({id, nombre}). */
export function normalizarTiposPrecio(lista) {
  const out = [];
  const seen = new Set();
  (Array.isArray(lista) ? lista : []).forEach((tipo) => {
    const id = Number(tipo?.id_tipo_precio_stock ?? tipo?.id ?? 0);
    const nombre = String(tipo?.nombre ?? "").trim();
    if (!(id > 0) || !nombre || seen.has(id)) return;
    if (tipo?.activo !== undefined && tipo?.activo !== null && Number(tipo.activo) !== 1) return;
    seen.add(id);
    out.push({ id_tipo_precio_stock: id, nombre });
  });
  // Mismo orden que stock_tipos_precio_listar (ORDER BY id): el tipo predeterminado
  // no cambia según de dónde vinieron los datos.
  return out.sort((a, b) => a.id_tipo_precio_stock - b.id_tipo_precio_stock);
}
