import BASE_URL from "../../../../config/config.jsx";

export const DOCUMENTOS_API = `${BASE_URL}/api.php`;

export function buildDocumentosUrl(action, params = {}) {
  const qs = new URLSearchParams({ action });
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });
  return `${DOCUMENTOS_API}?${qs.toString()}`;
}

/**
 * Transporte HTTP único de Documentos Comerciales.
 * El parseo/validación queda en cada flujo cuando existen contratos históricos
 * distintos, evitando cambiar mensajes o criterios de éxito durante la rearquitectura.
 */
export function documentosRequest(url, options = {}) {
  return fetch(url, options);
}
