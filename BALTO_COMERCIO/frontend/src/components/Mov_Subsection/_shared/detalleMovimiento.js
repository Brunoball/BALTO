function safeStr(value) {
  return String(value ?? "").trim();
}

function detalleProductosLabel(cantidad) {
  const n = Number(cantidad || 0);
  if (!Number.isFinite(n) || n <= 0) return "SIN PRODUCTOS";
  if (n === 1) return "1 PRODUCTO";
  return `${n} PRODUCTOS`;
}

function isResumenProductosText(value) {
  const text = safeStr(value).toUpperCase();
  return text === "SIN PRODUCTOS" || text === "1 CONCEPTO" || /^\d+\s+PRODUCTO(S)?$/.test(text);
}

function normalizeCompareText(value) {
  return safeStr(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function firstFilled(...values) {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = firstFilled(
        value.nombre_variante,
        value.stock_variante_nombre,
        value.variante_nombre,
        value.nombre,
        value.descripcion,
        value.detalle,
        value.valor,
        value.label
      );
      if (nested) return nested;
      continue;
    }

    const s = safeStr(value);
    if (s) return s;
  }
  return "";
}

function getItemVariantText(item) {
  const raw = item && typeof item === "object" ? item : {};
  return firstFilled(
    raw.stock_variante_nombre,
    raw.variante_nombre,
    raw.nombre_variante,
    raw.stock_variante,
    raw.variante,
    raw.stock_variante_valores,
    raw.stock_variante_detalle,
    raw.variant_name,
    raw.variantName,
    raw.atributos_variante,
    raw.atributos
  );
}

function compareTokens(value) {
  return normalizeCompareText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean);
}

function variantAlreadyIncludedInProduct(productName, variantName) {
  const productoNorm = normalizeCompareText(productName);
  const varianteNorm = normalizeCompareText(variantName);
  if (!productoNorm || !varianteNorm) return false;
  if (productoNorm === varianteNorm) return true;

  const productoTokens = compareTokens(productoNorm);
  const varianteTokens = compareTokens(varianteNorm);
  if (!productoTokens.length || !varianteTokens.length) return false;
  if (varianteTokens.length > productoTokens.length) return false;

  for (let i = 0; i <= productoTokens.length - varianteTokens.length; i += 1) {
    let matches = true;
    for (let j = 0; j < varianteTokens.length; j += 1) {
      if (productoTokens[i + j] !== varianteTokens[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }

  return false;
}

function composeProductoVariante(productName, variantName) {
  const producto = safeStr(productName);
  const variante = safeStr(variantName);
  if (!producto && !variante) return "";
  if (!producto) return variante;
  if (!variante) return producto;

  if (variantAlreadyIncludedInProduct(producto, variante)) return producto;

  return `${producto} ${variante}`;
}

function getItemDetalleText(item) {
  const raw = item && typeof item === "object" ? item : {};
  const producto = firstFilled(
    raw.stock_producto_nombre,
    raw.producto_base_nombre,
    raw.producto_nombre,
    raw.producto
  );
  const variante = getItemVariantText(raw);
  const explicit = firstFilled(
    raw.nombre_completo,
    raw.producto_variante_nombre,
    raw.nombre,
    raw.descripcion,
    raw.detalle,
    raw.detalle_nombre,
    raw.concepto
  );
  const value = composeProductoVariante(producto, variante);
  const productoNorm = normalizeCompareText(producto);
  const explicitNorm = normalizeCompareText(explicit);
  const finalValue = variante
    ? (value || explicit)
    : (explicit && productoNorm && explicitNorm && explicitNorm !== productoNorm ? explicit : (value || explicit));

  return finalValue && finalValue !== "Producto / Servicio" && !isResumenProductosText(finalValue) ? finalValue : "";
}

function buildDetalleItemsText(items) {
  const values = (Array.isArray(items) ? items : [])
    .map(getItemDetalleText)
    .filter(Boolean);

  return [...new Set(values)].join(", ");
}

function getItemsArray(row) {
  const candidates = [row?.items_detalle, row?.itemsDetalle, row?.items, row?.productos];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function getCantidadProductos(row) {
  const items = getItemsArray(row);
  if (items.length > 0) return items.length;

  const cantidadItems = Number(row?.cantidad_items ?? row?.cantidadItems ?? row?.productos_count ?? row?.productosCount ?? 0);
  if (Number.isFinite(cantidadItems) && cantidadItems > 0) return Math.trunc(cantidadItems);

  const resumenOriginal = safeStr(row?.detalle || row?.descripcion || row?.concepto || row?.nombre);
  const resumen = resumenOriginal.toUpperCase();
  const match = resumen.match(/^(\d+)\s+PRODUCTO(S)?$/);
  if (match) return Number(match[1]);

  const tieneProducto = safeStr(row?.id_stock_producto || row?.idStockProducto || row?.producto_nombre || row?.stock_producto_nombre);
  if (tieneProducto) return 1;

  if (resumenOriginal && !isResumenProductosText(resumenOriginal) && resumenOriginal !== "Producto / Servicio") return 1;

  return 0;
}

export function getResumenProductosMovimiento(row) {
  return detalleProductosLabel(getCantidadProductos(row));
}

export function getDetalleMovimiento(row) {
  const itemsText = buildDetalleItemsText(getItemsArray(row));
  if (itemsText) return itemsText;

  const original = safeStr(
    row?.detalle_original ||
      row?.descripcion_original ||
      row?.concepto_original ||
      row?.producto_nombre ||
      row?.stock_producto_nombre
  );
  if (original && !isResumenProductosText(original) && original !== "Producto / Servicio") return original;

  const detalle = safeStr(row?.detalle || row?.descripcion || row?.concepto || row?.nombre);
  if (detalle && !isResumenProductosText(detalle) && detalle !== "Producto / Servicio") return detalle;

  return getResumenProductosMovimiento(row);
}
