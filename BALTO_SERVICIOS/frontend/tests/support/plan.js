import { authenticatedApi } from './api.js';

export const PLAN_DENIED_CODE = 'FUNCIONALIDAD_NO_INCLUIDA_PLAN';

/**
 * Plan efectivo del tenant de la sesión (calculado por el backend desde MASTER).
 * La suite se adapta al plan real del tenant de staging; para validar los tres
 * planes se corre una vez por plan (ver PW_EXPECTED_PLAN en 47-plan-capabilities).
 */
export async function getSessionPlan(page) {
  if (!/^https?:\/\//i.test(page.url())) {
    await page.goto('/panel/dashboard', { waitUntil: 'domcontentloaded' });
  }
  const result = await authenticatedApi(page, 'auth_session_check');
  const usuario = result.body?.usuario || {};
  const capacidades = Array.isArray(usuario.capacidades) ? usuario.capacidades : [];
  return {
    status: result.status,
    usuario,
    capacidades,
    nivel: Number(usuario.plan_nivel || 0),
    codigo: String(usuario.plan_codigo || ''),
    esDemo: Number(usuario.plan_es_demo || 0) === 1,
    firma: String(usuario.plan_firma || ''),
    can: (cap) => capacidades.includes(cap),
  };
}

export function isPlanDenied(result) {
  return result?.status === 403 && String(result?.body?.codigo || '') === PLAN_DENIED_CODE;
}
