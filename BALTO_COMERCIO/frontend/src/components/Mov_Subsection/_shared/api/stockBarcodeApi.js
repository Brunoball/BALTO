import {
  API_URL,
  buildHeadersGET,
  parseJsonOrThrow,
} from "../../../Stock/modales/stockFormUtils";

function barcodeEndpointUrl(code) {
  const endpoint = new URL("../modules/stock/codigos_barra/endpoint.php", API_URL);
  endpoint.searchParams.set("op", "buscar");
  endpoint.searchParams.set("codigo_barra", code);
  endpoint.searchParams.set("_", String(Date.now()));
  return endpoint.toString();
}

export async function lookupBarcode(code, signal) {
  const response = await fetch(barcodeEndpointUrl(code), {
    method: "GET",
    headers: buildHeadersGET(),
    cache: "no-store",
    signal,
  });
  return parseJsonOrThrow(response);
}

function globalListsEndpointUrl() {
  const endpoint = new URL(API_URL);
  endpoint.searchParams.set("action", "global_obtener_listas");
  endpoint.searchParams.set("_ts", String(Date.now()));
  return endpoint.toString();
}

function firstArray(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  return [];
}

/**
 * Obtiene un catálogo de stock fresco directamente desde la misma API global
 * que alimenta los modales. Se usa como recuperación cuando el endpoint del
 * código de barra ya conoce el producto pero el modal quedó con una lista vieja.
 */
export async function fetchFreshBarcodeOptions(signal, { allowOutOfStock = false } = {}) {
  const response = await fetch(globalListsEndpointUrl(), {
    method: "GET",
    headers: buildHeadersGET(),
    cache: "no-store",
    signal,
  });
  const data = await parseJsonOrThrow(response);
  const lists = data?.listas || data || {};

  const keys = allowOutOfStock
    ? ["detalles_compras", "detallesCompras", "detalles_todos", "detallesTodos", "detalles"]
    : ["detalles", "detalles_stock", "detallesStock", "detalles_todos", "detallesTodos"];

  const options = firstArray(lists, keys);
  if (options.length) return options;

  // Algunas respuestas también duplican estos catálogos en la raíz.
  return firstArray(data, keys);
}
