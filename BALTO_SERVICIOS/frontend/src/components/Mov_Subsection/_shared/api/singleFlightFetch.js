// Deduplicación temporal de GET idénticos.
//
// Si dos componentes/modales solicitan exactamente el mismo GET mientras la
// primera petición todavía está en vuelo, ambos comparten la petición HTTP.
// Cada consumidor recibe su propio Response.clone(), por lo que puede leer el
// body normalmente. Al finalizar la petición se elimina inmediatamente del
// mapa: NO es un cache de datos y no deja respuestas viejas.
//
// Por seguridad no interviene cuando hay body, AbortSignal o un método que no
// sea GET. POST/PUT/PATCH/DELETE conservan exactamente su comportamiento.
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

export function movSubsectionFetch(url, options = {}) {
  if (!canShareGet(options)) {
    return fetch(url, options);
  }

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

  // Nunca exponemos el mismo body de Response a dos consumidores.
  return request.then((response) => response.clone());
}
