import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useGoogleIdentity } from '../../hooks/useGoogleIdentity';
import { obtenerNonce } from '../../services/authService';

const MENSAJES = {
  CUENTA_DESACTIVADA: 'Tu cuenta en esta tienda está desactivada. Podés comprar como invitado.',
  CUENTA_REQUIERE_VINCULACION: null, // usa el mensaje del servidor
  NONCE_VENCIDO: 'El inicio de sesión expiró. Volvé a presionar "Continuar con Google".',
  TOKEN_VENCIDO: 'La credencial de Google venció. Volvé a intentarlo.',
  TOKEN_INVALIDO: 'No pudimos validar tu cuenta de Google. Volvé a intentarlo.',
  SIN_CONEXION: 'No pudimos conectar con la tienda. Revisá tu conexión e intentá de nuevo.',
  DEMASIADAS_SOLICITUDES: 'Hiciste muchos intentos seguidos. Esperá unos minutos.',
};

/**
 * Botón OFICIAL "Continuar con Google" (Google Identity Services, modo popup).
 * Flujo: nonce del servidor -> Google -> ID token -> backend (verificación) -> cookie de sesión.
 * Si Google no carga o falla, muestra un aviso y NUNCA bloquea la compra como invitado.
 */
export default function GoogleSignInButton({ onSuccess, text = 'continue_with', compact = false }) {
  const auth = useAuth();
  const [revision, setRevision] = useState(0);
  const gis = useGoogleIdentity(auth.googleDisponible, revision);
  const containerRef = useRef(null);
  const [status, setStatus] = useState({ estado: 'preparando', mensaje: null });
  const [intento, setIntento] = useState(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const busyRef = useRef(false);

  const handleCredential = useCallback(async (response) => {
    if (busyRef.current) return; // doble callback / doble clic
    const credential = response?.credential;
    if (typeof credential !== 'string' || !credential) {
      setStatus({ estado: 'error', mensaje: 'Google no devolvió una credencial. Volvé a intentarlo.' });
      return;
    }
    busyRef.current = true;
    setStatus({ estado: 'enviando', mensaje: null });
    try {
      const data = await auth.loginConGoogle(credential);
      setStatus({ estado: 'ok', mensaje: null });
      onSuccessRef.current?.(data);
    } catch (error) {
      const msg = MENSAJES[error.codigo] || error.message || 'No pudimos iniciar sesión.';
      setStatus({ estado: 'error', mensaje: msg, codigo: error.codigo });
      setIntento((n) => n + 1); // el nonce es de un solo uso: se prepara uno nuevo
    } finally {
      busyRef.current = false;
    }
  }, [auth]);

  useEffect(() => {
    if (gis.estado !== 'listo' || !auth.googleClientId) return undefined;
    const controller = new AbortController();
    let renewTimer;
    (async () => {
      try {
        const { nonce } = await obtenerNonce(controller.signal);
        if (controller.signal.aborted || !containerRef.current) return;
        gis.google.accounts.id.initialize({
          client_id: auth.googleClientId,
          callback: handleCredential,
          nonce,
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        const width = Math.max(220, Math.min(400, Math.floor(containerRef.current.getBoundingClientRect().width || 320)));
        containerRef.current.innerHTML = '';
        gis.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard', theme: 'outline', size: 'large', text, shape: 'pill',
          logo_alignment: 'left', width, locale: 'es-419',
        });
        setStatus((s) => (s.estado === 'error' ? { ...s, estado: 'error-listo' } : { estado: 'listo', mensaje: null }));
        // El nonce vence a los 10 minutos: se renueva antes si la persona no hizo clic.
        renewTimer = setTimeout(() => setIntento((n) => n + 1), 9 * 60 * 1000);
      } catch (error) {
        if (error.name === 'AbortError') return;
        setStatus({ estado: 'error', mensaje: MENSAJES[error.codigo] || error.message, codigo: error.codigo, sinBoton: true });
      }
    })();
    return () => { controller.abort(); clearTimeout(renewTimer); };
  }, [gis.estado, gis.google, auth.googleClientId, handleCredential, text, intento]);

  if (!auth.googleDisponible) return null;
  const errorCarga = gis.estado === 'error';
  const sinBoton = errorCarga || status.sinBoton;
  return <div className={`google-signin ${compact ? 'is-compact' : ''}`}>
    <div ref={containerRef} className="google-signin-slot" aria-busy={status.estado === 'preparando' || status.estado === 'enviando'} hidden={sinBoton}/>
    {(gis.estado === 'cargando' || (status.estado === 'preparando' && !sinBoton)) && <span className="google-signin-loading"><LoaderCircle size={16} className="spin"/> Preparando el acceso con Google…</span>}
    {status.estado === 'enviando' && <span className="google-signin-loading" role="status"><LoaderCircle size={16} className="spin"/> Verificando tu cuenta…</span>}
    {(errorCarga || status.mensaje) && <div className="google-signin-error" role="alert">
      <AlertTriangle size={16}/>
      <span>{errorCarga ? gis.error?.message : status.mensaje}</span>
      {sinBoton && <button type="button" className="link-button" onClick={() => { setStatus({ estado: 'preparando', mensaje: null }); setRevision((n) => n + 1); setIntento((n) => n + 1); }}><RotateCcw size={14}/> Reintentar</button>}
    </div>}
  </div>;
}
