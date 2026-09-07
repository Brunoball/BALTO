function safeStr(value) {
  return String(value ?? "").trim();
}

function resumenCantidadLabel(cantidad, singular, plural) {
  const n = Number(cantidad || 0);
  if (!Number.isFinite(n) || n <= 0) return "SIN DETALLES";
  if (n === 1) return `1 ${singular}`;
  return `${Math.trunc(n)} ${plural}`;
}

function isResumenProductosText(value) {
  const text = safeStr(value).toUpperCase();
  const resumenParte = "\\d+\\s+(?:PRODUCTO(?:S)?|SERVICIO(?:S)?|DETALLE(?:S)?)";
  const resumenCompuesto = new RegExp(`^${resumenParte}(?:\\s*\\/\\s*${resumenParte})*$`);
  return (
    text === "SIN PRODUCTOS" ||
    text === "SIN DETALLES" ||
    text === "1 CONCEPTO" ||
    text === "COMBINADO" ||
    resumenCompuesto.test(text)
  );
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
    raw.servicio_nombre,
    raw.articulo_nombre,
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

function positiveId(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function getItemKind(item) {
  const raw = item && typeof item === "object" ? item : {};
  const tipoDb = safeStr(raw.tipo_item_db ?? raw.tipoItemDb).toUpperCase();

  // La receta de un servicio también genera filas internas de consumo. Esas filas
  // representan stock consumido, no productos vendidos, y nunca deben modificar
  // el resumen visible de la operación.
  if (tipoDb === "CONSUMO_ARTICULO") return "consumo";
  if (tipoDb === "SERVICIO") return "servicio";
  if (tipoDb === "ARTICULO") return "producto";
  if (tipoDb === "DETALLE" || tipoDb === "MANUAL") return "detalle";

  const tipo = safeStr(raw.tipo_item ?? raw.tipoItem ?? raw.tipo).toUpperCase();
  if (tipo === "CONSUMO_ARTICULO") return "consumo";
  if (tipo === "SERVICIO" || tipo === "SERVICE") return "servicio";
  if (tipo === "ARTICULO" || tipo === "PRODUCTO" || tipo === "STOCK") return "producto";

  if (positiveId(raw.id_servicio, raw.idServicio, raw.servicio_id)) return "servicio";
  if (positiveId(
    raw.id_articulo,
    raw.idArticulo,
    raw.id_stock_producto,
    raw.idStockProducto,
    raw.stock_producto_id,
    raw.id_producto,
    raw.idProducto
  )) return "producto";

  const servicioNombre = safeStr(raw.servicio_nombre ?? raw.servicioNombre);
  const productoNombre = safeStr(
    raw.articulo_nombre ??
      raw.articuloNombre ??
      raw.stock_producto_nombre ??
      raw.producto_nombre ??
      raw.productoNombre
  );
  if (servicioNombre && !productoNombre) return "servicio";
  if (productoNombre && !servicioNombre) return "producto";

  return "detalle";
}

function getCantidadFallback(row) {
  const n = Number(
    row?.cantidad_items ??
      row?.cantidadItems ??
      row?.productos_count ??
      row?.productosCount ??
      row?.detalles_count ??
      row?.detallesCount ??
      0
  );
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function resumenDesdeItems(row) {
  const items = getItemsArray(row);
  if (!items.length) return "";

  let servicios = 0;
  let productos = 0;
  let detalles = 0;

  for (const item of items) {
    const kind = getItemKind(item);
    if (kind === "consumo") continue;
    if (kind === "servicio") servicios += 1;
    else if (kind === "producto") productos += 1;
    else detalles += 1;
  }

  const partes = [];
  if (servicios > 0) partes.push(resumenCantidadLabel(servicios, "SERVICIO", "SERVICIOS"));
  if (productos > 0) partes.push(resumenCantidadLabel(productos, "PRODUCTO", "PRODUCTOS"));
  if (detalles > 0) partes.push(resumenCantidadLabel(detalles, "DETALLE", "DETALLES"));

  // En operaciones mixtas mostramos la composición real en vez de una etiqueta
  // genérica. Ej.: "1 SERVICIO / 1 PRODUCTO".
  return partes.join(" / ");
}

function resumenDesdeRow(row) {
  const cantidad = getCantidadFallback(row);
  const kind = getItemKind(row);
  if (kind === "servicio") return resumenCantidadLabel(cantidad || 1, "SERVICIO", "SERVICIOS");
  if (kind === "producto") return resumenCantidadLabel(cantidad || 1, "PRODUCTO", "PRODUCTOS");

  const resumenOriginal = safeStr(row?.detalle || row?.descripcion || row?.concepto || row?.nombre).toUpperCase();

  // Compatibilidad con filas antiguas: si alguna venía persistida como COMBINADO
  // pero sin items tipados, no volvemos a mostrar esa etiqueta genérica.
  if (resumenOriginal === "COMBINADO") {
    return resumenCantidadLabel(cantidad || 1, "DETALLE", "DETALLES");
  }

  const resumenParte = "\\d+\\s+(?:PRODUCTO(?:S)?|SERVICIO(?:S)?|DETALLE(?:S)?)";
  const resumenCompuesto = new RegExp(`^${resumenParte}(?:\\s*\\/\\s*${resumenParte})*$`);
  if (resumenCompuesto.test(resumenOriginal)) return resumenOriginal;
  if (resumenOriginal === "SIN PRODUCTOS" || resumenOriginal === "SIN DETALLES") return "SIN DETALLES";
  if (cantidad > 0 || resumenOriginal) return resumenCantidadLabel(cantidad || 1, "DETALLE", "DETALLES");

  return "SIN DETALLES";
}

export function getResumenItemsMovimiento(row) {
  return resumenDesdeItems(row) || resumenDesdeRow(row);
}

// Nombre legacy conservado para no romper las pantallas que ya importan este helper.
// Ahora el resumen distingue SERVICIOS, PRODUCTOS y muestra la composición exacta en operaciones mixtas.
export function getResumenProductosMovimiento(row) {
  return getResumenItemsMovimiento(row);
}

export function getDetalleMovimiento(row) {
  const itemsText = buildDetalleItemsText(getItemsArray(row));
  if (itemsText) return itemsText;

  const original = safeStr(
    row?.detalle_original ||
      row?.descripcion_original ||
      row?.concepto_original ||
      row?.servicio_nombre ||
      row?.articulo_nombre ||
      row?.producto_nombre ||
      row?.stock_producto_nombre
  );
  if (original && !isResumenProductosText(original) && original !== "Producto / Servicio") return original;

  const detalle = safeStr(row?.detalle || row?.descripcion || row?.concepto || row?.nombre);
  if (detalle && !isResumenProductosText(detalle) && detalle !== "Producto / Servicio") return detalle;

  return getResumenProductosMovimiento(row);
}
