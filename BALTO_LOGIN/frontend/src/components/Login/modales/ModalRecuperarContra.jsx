import React, { useState } from "react";
import { requestPasswordReset } from "../../../services/authApi";
import "./ModalRecuperar.css";

export default function ModalRecuperarContra({ onClose, usuarioPrefill = "", onToast }) {
  const [usuario, setUsuario] = useState(usuarioPrefill);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const value = String(usuario || "").trim();
    if (!value) return onToast?.("advertencia", "Ingresá tu usuario.");

    setLoading(true);
    try {
      const r = await requestPasswordReset(value);
      if (!r.ok || r.data?.exito === false) {
        onToast?.("error", r.data?.mensaje || "No se pudo iniciar la recuperación.");
        return;
      }
      onToast?.("exito", r.data?.mensaje || "Si la cuenta es válida, recibirás las instrucciones por email.");
      onClose?.();
    } catch (e2) {
      onToast?.("error", e2?.name === "AbortError" ? "Tiempo de espera agotado." : "No se pudo conectar al servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rec-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="rec-card" role="dialog" aria-modal="true" aria-label="Recuperar contraseña">
        <button className="rec-close" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        <h2>RECUPERAR CONTRASEÑA</h2>
        <p>Ingresá tu usuario y te enviaremos las instrucciones al email de recuperación configurado.</p>
        <form onSubmit={submit}>
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario" autoFocus />
          <button type="submit" disabled={loading}>{loading ? "ENVIANDO..." : "CONTINUAR"}</button>
        </form>
      </div>
    </div>
  );
}
