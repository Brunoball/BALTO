import BASE_URL from "../../../config/config";

const API_URL = `${String(BASE_URL || "").replace(/\/+$/, "")}/api.php`;

function getAuthInfo() {
  const token = (localStorage.getItem("token") || "").trim();
  const sessionKey = (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("X-Session") ||
    localStorage.getItem("x_session") ||
    ""
  ).trim();

  let idUsuario = 0;
  try {
    const usuario = JSON.parse(localStorage.getItem("usuario") || "null");
    const candidato =
      usuario?.idUsuarioMaster ??
      usuario?.idUsuario ??
      usuario?.id_usuario ??
      usuario?.id ??
      usuario?.user_id ??
      0;

    if (Number.isFinite(Number(candidato))) {
      idUsuario = Number(candidato);
    }
  } catch {}

  return { token, sessionKey, idUsuario };
}

function getAuthHeaders(json = false) {
  const { sessionKey, token } = getAuthInfo();
  const headers = {};

  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";

  return headers;
}

function buildAuditUserPayload(extra = {}) {
  const { idUsuario } = getAuthInfo();
  const payload = { ...extra };

  if (Number.isFinite(Number(idUsuario)) && Number(idUsuario) > 0) {
    payload.idUsuarioMaster = Number(idUsuario);
    payload.idUsuario = Number(idUsuario);
  }

  return payload;
}

async function parseJsonOrThrow(res, invalidMessage = null) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const mensaje =
      typeof invalidMessage === "function"
        ? invalidMessage(res.status)
        : invalidMessage || `La API devolvió una respuesta inválida. HTTP ${res.status}`;
    throw new Error(mensaje);
  }

  if (!res.ok || data?.exito === false) {
    throw new Error(data?.mensaje || `Error HTTP ${res.status}`);
  }

  return data;
}

async function get(action, params = {}, options = {}) {
  const search = new URLSearchParams();
  search.set("action", action);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || typeof value === "undefined" || value === "") return;
    search.set(key, String(value));
  });

  const res = await fetch(`${API_URL}?${search.toString()}`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  return parseJsonOrThrow(res, options.invalidMessage);
}

async function post(action, payload = {}, { auditUser = false, invalidMessage = null } = {}) {
  const search = new URLSearchParams();
  search.set("action", action);

  const body = auditUser ? buildAuditUserPayload(payload) : payload;
  const res = await fetch(`${API_URL}?${search.toString()}`, {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify(body),
  });

  return parseJsonOrThrow(res, invalidMessage);
}

export function construirUrlComprobante(action, idCheque) {
  const search = new URLSearchParams();
  search.set("action", action);
  search.set("id_cheque", String(idCheque));

  const base = `${API_URL}?${search.toString()}`;

  try {
    const { sessionKey, token } = getAuthInfo();
    const url = new URL(base, window.location.origin);

    if (sessionKey && !url.searchParams.has("session_key")) {
      url.searchParams.set("session_key", sessionKey);
    }
    if (token && !url.searchParams.has("token")) {
      url.searchParams.set("token", token);
    }

    return url.toString();
  } catch {
    return base;
  }
}

export function listarChequesCartera({ limit = 100, offset = 0, q = "" } = {}) {
  return get("cheques_cartera_listar", {
    limit,
    offset,
    q: String(q || "").trim(),
  });
}

export function depositarChequeCartera({ idCheque, fechaDeposito }) {
  return post(
    "cheques_cartera_depositar",
    {
      id_cheque: idCheque,
      fecha_deposito: fechaDeposito,
      fecha_operacion: fechaDeposito,
      fecha: fechaDeposito,
    },
    { auditUser: true }
  );
}

export function listarEcheqsCartera({ limit = 100, offset = 0, q = "" } = {}) {
  return get(
    "echeq_cartera_listar",
    {
      limit,
      offset,
      q: String(q || "").trim(),
    },
    { invalidMessage: "La API devolvió una respuesta inválida." }
  );
}

export function depositarEcheqCartera({ idCheque, fechaDeposito }) {
  return post(
    "echeq_cartera_depositar",
    {
      id_cheque: idCheque,
      fecha_deposito: fechaDeposito,
      fecha_operacion: fechaDeposito,
      fecha: fechaDeposito,
    },
    { auditUser: true, invalidMessage: "La API devolvió una respuesta inválida." }
  );
}

export function listarFlujoCheques({ limit = 100, offset = 0, q = "" } = {}) {
  return get(
    "flujo_cheques_listar",
    { limit, offset, q: String(q || "").trim() },
    { invalidMessage: (status) => `Respuesta inválida. HTTP ${status}` }
  );
}

export function listarFlujoEcheqs({ limit = 100, offset = 0, q = "" } = {}) {
  return get(
    "flujos_echeq_listar",
    { limit, offset, q: String(q || "").trim() },
    { invalidMessage: (status) => `Respuesta inválida. HTTP ${status}` }
  );
}

export function revertirDepositoCheque({ idCheque, fechaReversion, motivo }) {
  return post(
    "cheques_deposito_revertir",
    {
      id_cheque: idCheque,
      fecha_reversion: fechaReversion,
      motivo,
      confirmacion: true,
    },
    { invalidMessage: (status) => `Respuesta inválida. HTTP ${status}` }
  );
}

export function revertirDepositoEcheq({ idCheque, fechaReversion, motivo }) {
  return post(
    "echeq_deposito_revertir",
    {
      id_cheque: idCheque,
      fecha_reversion: fechaReversion,
      motivo,
      confirmacion: true,
    },
    { invalidMessage: (status) => `Respuesta inválida. HTTP ${status}` }
  );
}
