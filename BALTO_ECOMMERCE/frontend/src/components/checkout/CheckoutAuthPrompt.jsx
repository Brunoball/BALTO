import React, { useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import GoogleSignInButton from '../auth/GoogleSignInButton';

/**
 * Bloque opcional en el checkout para quien no inició sesión. Nunca bloquea:
 * "Continuar como invitado" solo lo colapsa. El carrito no se pierde (vive en
 * localStorage y el login es en una ventana emergente, sin salir de la página).
 */
export default function CheckoutAuthPrompt() {
  const auth = useAuth();
  const [oculto, setOculto] = useState(false);
  if (!auth.googleDisponible || auth.autenticado || auth.cargando) return null;
  if (oculto) {
    return <p className="checkout-guest-note">Comprás como invitado. <button type="button" className="link-button" onClick={() => setOculto(false)}>¿Querés ingresar con tu cuenta?</button></p>;
  }
  return <section className="checkout-auth" aria-labelledby="checkout-auth-title">
    <div className="checkout-auth-copy">
      <span className="checkout-auth-icon" aria-hidden="true"><UserCheck size={20}/></span>
      <div>
        <h2 id="checkout-auth-title">¿Ya tenés una cuenta?</h2>
        <p>Continuá con Google para completar tus datos más rápido. Tu carrito se mantiene.</p>
      </div>
    </div>
    <div className="checkout-auth-actions">
      <GoogleSignInButton compact/>
      <button type="button" className="btn btn-outline" onClick={() => { setOculto(true); document.getElementById('checkout-nombre')?.focus(); }}>Continuar como invitado</button>
    </div>
  </section>;
}
