/**
 * Capa HTTP de Otros Egresos.
 * Centraliza el transporte y conserva el contrato histórico de autenticación.
 * Los modales mantienen sus validaciones particulares y usan el transporte crudo.
 */
export function getOtrosEgresosAuthInfo() {
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
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}

  return { token, sessionKey, idUsuario };
}

export function otrosEgresosFetch(url, options = {}) {
  return fetch(url, options);
}
