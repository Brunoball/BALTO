import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { baltoConfig } from '../config/baltoConfig';
import { cerrarSesion, consultarSesion, loginGoogle } from '../services/authService';
import { onSesionInvalida } from '../services/apiClient';
import { loadGoogleIdentity } from '../hooks/useGoogleIdentity';
import { borrarAutorizaciones } from '../services/paymentService';

/**
 * Sesión del comprador de ESTA tienda.
 *  - La sesión es una cookie HttpOnly del servidor: aquí solo se guarda el perfil
 *    en memoria y el token CSRF (en apiClient, también en memoria).
 *  - No se guarda nada sensible en localStorage. Solo se publica un "evento"
 *    sin datos (login/logout + hora) para que otras pestañas se actualicen.
 */
const AuthContext = createContext(null);
const EVENT_KEY = `balto:ecommerce:auth-evento:${baltoConfig.tiendaDominio}`;
// Datos privados de la compra en curso que se borran al cerrar sesión.
const PRIVATE_SESSION_KEYS = [
  `balto:ecommerce:checkout-borrador:${baltoConfig.tiendaDominio}`,
  `balto:ecommerce:checkout-intento:${baltoConfig.tiendaDominio}`,
  `balto:ecommerce:ultimo-pedido:${baltoConfig.tiendaDominio}`,
];

function publishEvent(tipo) {
  try { localStorage.setItem(EVENT_KEY, JSON.stringify({ tipo, t: Date.now() })); } catch (_) {}
}
function clearPrivateSession() {
  for (const k of PRIVATE_SESSION_KEYS) { try { sessionStorage.removeItem(k); } catch (_) {} }
  borrarAutorizaciones();
}

export function AuthProvider({ cuentas, children }) {
  const habilitadas = Boolean(cuentas?.habilitadas);
  const googleClientId = cuentas?.google_client_id || null;
  const [state, setState] = useState(() => ({ estado: habilitadas ? 'cargando' : 'no_disponible', cliente: null, error: null }));
  const lastCheck = useRef(0);
  const requestId = useRef(0);

  const refrescar = useCallback(async () => {
    if (!habilitadas) { setState({ estado: 'no_disponible', cliente: null, error: null }); return null; }
    const id = ++requestId.current;
    lastCheck.current = Date.now();
    try {
      const data = await consultarSesion();
      if (id !== requestId.current) return null;
      setState(data.autenticado
        ? { estado: 'autenticado', cliente: data.cliente, error: null }
        : { estado: 'anonimo', cliente: null, error: null });
      return data;
    } catch (error) {
      if (id !== requestId.current) return null;
      // Sin conexión: se navega como invitado; nunca se bloquea la tienda.
      setState((s) => (s.estado === 'autenticado' ? { ...s, error } : { estado: 'anonimo', cliente: null, error }));
      return null;
    }
  }, [habilitadas]);

  useEffect(() => { refrescar(); }, [refrescar]);

  // Sesión invalidada por el servidor (vencida/revocada) en cualquier llamada.
  useEffect(() => onSesionInvalida(() => {
    requestId.current++;
    setState({ estado: 'anonimo', cliente: null, error: null });
  }), []);

  // Login/logout en otra pestaña, o volver a la pestaña después de un rato.
  useEffect(() => {
    if (!habilitadas) return undefined;
    const onStorage = (e) => { if (e.key === EVENT_KEY) refrescar(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > 5 * 60 * 1000) refrescar();
    };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible); };
  }, [habilitadas, refrescar]);

  const loginConGoogle = useCallback(async (credential) => {
    const data = await loginGoogle(credential);
    requestId.current++;
    lastCheck.current = Date.now();
    setState({ estado: 'autenticado', cliente: data.cliente, error: null });
    publishEvent('login');
    return data;
  }, []);

  const logout = useCallback(async ({ todas = false } = {}) => {
    try {
      await cerrarSesion({ todas });
    } catch (_) {
      // Aunque el servidor no responda, se limpian los datos privados locales.
    }
    requestId.current++;
    clearPrivateSession();
    // Evita cualquier reingreso automatico con Google en este navegador.
    if (googleClientId) loadGoogleIdentity().then((g) => g?.accounts?.id?.disableAutoSelect?.()).catch(() => {});
    setState({ estado: 'anonimo', cliente: null, error: null });
    publishEvent('logout');
  }, [googleClientId]);

  const actualizarCliente = useCallback((cliente) => {
    if (cliente && typeof cliente === 'object') setState((s) => (s.estado === 'autenticado' ? { ...s, cliente } : s));
  }, []);

  const marcarAnonimo = useCallback(() => {
    requestId.current++;
    setState({ estado: 'anonimo', cliente: null, error: null });
  }, []);

  const value = useMemo(() => ({
    ...state,
    habilitadas,
    googleClientId,
    googleDisponible: habilitadas && Boolean(googleClientId),
    autenticado: state.estado === 'autenticado',
    cargando: state.estado === 'cargando',
    refrescar, loginConGoogle, logout, actualizarCliente, marcarAnonimo,
  }), [state, habilitadas, googleClientId, refrescar, loginConGoogle, logout, actualizarCliente, marcarAnonimo]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requiere AuthProvider');
  return ctx;
}
