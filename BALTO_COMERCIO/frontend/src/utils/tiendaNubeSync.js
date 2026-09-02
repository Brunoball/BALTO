function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readSyncPayload(response) {
  if (!response || typeof response !== "object") return null;

  return (
    response.tiendanube_sync ??
    response.tiendanube_delete ??
    response.tiendanube_sync_producto ??
    response.data?.tiendanube_sync ??
    response.data?.tiendanube_delete ??
    response.data?.tiendanube_sync_producto ??
    response.resultado?.tiendanube_sync ??
    response.resultado?.tiendanube_delete ??
    response.resultado?.tiendanube_sync_producto ??
    response.data ??
    response
  );
}

function readSyncError(sync, response) {
  // `response.message` también contiene el mensaje exitoso de la operación local
  // (por ejemplo, "Producto eliminado permanentemente."). Solo se considera
  // error general cuando la propia respuesta indica que falló.
  const responseFailed = response?.exito === false || response?.success === false;

  const direct = firstText(
    sync?.error,
    sync?.mensaje_error,
    sync?.message,
    sync?.description,
    responseFailed ? response?.error : "",
    responseFailed ? response?.mensaje : "",
    responseFailed ? response?.message : "",
    responseFailed ? response?.description : ""
  );
  if (direct) return direct;

  const arrays = [
    sync?.errores,
    sync?.errors,
    sync?.categorias?.errores,
    sync?.imagenes?.errores,
  ];

  for (const values of arrays) {
    if (!Array.isArray(values)) continue;
    const text = values
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        return firstText(item.error, item.message, item.description, item.detalle);
      })
      .filter(Boolean)
      .join(" · ");
    if (text) return text;
  }

  return "";
}

function hasRetryQueued(sync) {
  return Boolean(
    sync?.job_reintento ||
      sync?.reintento_encolado ||
      sync?.encolado ||
      Number(sync?.encolados ?? sync?.pendientes ?? 0) > 0
  );
}

/**
 * Convierte la respuesta de sincronización con Tienda Nube en un mensaje de UI.
 * La operación local ya fue realizada; los fallos remotos se muestran como
 * advertencia y no como un falso error del guardado en Balto.
 */
export function tiendaNubeFeedback(response, mensajeLocal = "Operación realizada correctamente.") {
  const sync = readSyncPayload(response);

  if (!sync || typeof sync !== "object") {
    return { tipo: "exito", mensaje: mensajeLocal };
  }

  if (sync.procesamiento_segundo_plano === true) {
    const errores = Number(sync.errores ?? 0);
    if (errores === 0) return { tipo: "exito", mensaje: mensajeLocal };
  }

  if (sync.sincronizado === true || sync.sincronizado === 1) {
    return { tipo: "exito", mensaje: mensajeLocal };
  }

  // No tener una integración aplicable no invalida la operación local.
  if (sync.saltado === true && !readSyncError(sync, response)) {
    return { tipo: "exito", mensaje: mensajeLocal };
  }

  const error = readSyncError(sync, response);
  const retryQueued = hasRetryQueued(sync);

  if (retryQueued) {
    return {
      tipo: "advertencia",
      mensaje: `${mensajeLocal} La actualización de Tienda Nube quedó pendiente y se reintentará automáticamente${error ? ` (${error})` : "."}`,
    };
  }

  if (error || sync.sincronizado === false || sync.sincronizado === 0) {
    return {
      tipo: "advertencia",
      mensaje: `${mensajeLocal} No se pudo confirmar la actualización en Tienda Nube${error ? ` (${error})` : "."}`,
    };
  }

  return { tipo: "exito", mensaje: mensajeLocal };
}

export default tiendaNubeFeedback;
