import { movSubsectionFetch } from "../../_shared/api/singleFlightFetch.js";

/**
 * Capa HTTP de Otros Ingresos.
 * Centraliza el transporte usando únicamente la sesión global X-Session.
 * Los modales mantienen sus validaciones particulares y usan el transporte crudo.
 */
export function getOtrosIngresosAuthInfo() {
  const sessionKey = (localStorage.getItem("session_key") || "").trim();

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}

  return { sessionKey, idUsuario };
}

export function otrosIngresosFetch(url, options = {}) {
  return movSubsectionFetch(url, options);
}
