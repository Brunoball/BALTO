// Deduplicación temporal de GET idénticos.
//
// Dos consumidores que solicitan el mismo GET mientras la primera petición
// sigue en curso comparten una única llamada HTTP. Cada consumidor recibe su
// propio Response.clone(), por lo que puede leer el body de forma independiente.
// Al finalizar, la entrada se elimina: no es un caché persistente y no deja
// datos viejos. POST/PUT/PATCH/DELETE y requests con AbortSignal no se comparten.
const inFlightGetRequests = new Map();

function normalizeHeaders(headers) {
  if (!headers) return "";

  try {
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return Array.from(headers.entries())
        .map(([k, v]) => [String(k).toLowerCase(), String(v)])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("|");
    }
  } catch {}

  if (Array.isArray(headers)) {
    return headers
      .map(([k, v]) => [String(k).toLowerCase(), String(v)])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
  }

  if (typeof headers === "object") {
    return Object.entries(headers)
      .map(([k, v]) => [String(k).toLowerCase(), String(v)])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
  }

  return String(headers);
}

function canShareGet(options = {}) {
  const method = String(options?.method || "GET").toUpperCase();
  return method === "GET" && options?.body == null && !options?.signal;
}

function buildRequestKey(url, options = {}) {
  return [
    String(url),
    normalizeHeaders(options?.headers),
    String(options?.credentials || ""),
    String(options?.mode || ""),
    String(options?.cache || ""),
    String(options?.redirect || ""),
    String(options?.referrerPolicy || ""),
  ].join("||");
}

export function singleFlightFetch(url, options = {}) {
  if (!canShareGet(options)) return fetch(url, options);

  const requestKey = buildRequestKey(url, options);
  let request = inFlightGetRequests.get(requestKey);

  if (!request) {
    request = fetch(url, options).finally(() => {
      if (inFlightGetRequests.get(requestKey) === request) {
        inFlightGetRequests.delete(requestKey);
      }
    });
    inFlightGetRequests.set(requestKey, request);
  }

  return request.then((response) => response.clone());
}
