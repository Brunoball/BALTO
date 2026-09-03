import React, { useEffect, useRef, useState } from "react";
import { requestPasswordReset } from "../../../services/authApi";
import "./ModalRecuperar.css";

const IconoModal = ({ tipo }) => {
  const formas = {
    candado: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    enviar: (
      <>
        <path d="m3 3 18 9-18 9 4-9-4-9Z" />
        <path d="M7 12h14" />
      </>
    ),
    cerrar: <path d="m6 6 12 12M18 6 6 18" />,
  };

  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {formas[tipo]}
    </svg>
  );
};

const ocultarEmail = (email) => {
  const valor = String(email || "").trim();
  const [usuario, dominio] = valor.split("@");

  if (!usuario || !dominio) return "";

  const visibles = usuario.length <= 2 ? 1 : 2;
  const inicio = usuario.slice(0, visibles);
  const ocultos = "*".repeat(Math.max(3, usuario.length - visibles));

  return `${inicio}${ocultos}@${dominio}`;
};

export default function ModalRecuperarContra({
  onClose,
  usuarioPrefill = "",
  onToast,
}) {
  const [step, setStep] = useState("form");
  const [usuario, setUsuario] = useState(usuarioPrefill);
  const [cargando, setCargando] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const cerrarConEscape = (event) => {
      if (event.key === "Escape" && !cargando) onClose?.();
    };

    window.addEventListener("keydown", cerrarConEscape);
    return () => window.removeEventListener("keydown", cerrarConEscape);
  }, [cargando, onClose]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (cargando) return;

    const value = String(usuario || "").trim();
    if (!value) {
      onToast?.("advertencia", "Ingresá tu nombre de usuario.");
      inputRef.current?.focus();
      return;
    }

    setCargando(true);

    try {
      const respuesta = await requestPasswordReset(value);

      if (!respuesta.ok || respuesta.data?.exito === false) {
        onToast?.(
          "error",
          respuesta.data?.mensaje || "No se pudo procesar la recuperación."
        );
        return;
      }

      // Nunca mostramos el estado de éxito por un simple HTTP 200.
      // El backend debe confirmar explícitamente que aceptó el correo para envío.
      if (respuesta.data?.correo_enviado !== true) {
        onToast?.(
          "error",
          respuesta.data?.mensaje ||
            "El servidor no confirmó el envío del correo. Intentá nuevamente."
        );
        return;
      }

      const emailVisible =
        String(respuesta.data?.email_mascarado || "").trim() ||
        ocultarEmail(respuesta.data?.email) ||
        "tu correo registrado";

      setMaskedEmail(emailVisible);
      setStep("sent");
    } catch (error) {
      onToast?.(
        "error",
        error?.name === "AbortError"
          ? "Tiempo de espera agotado."
          : "No se pudo conectar al servidor. Intentá más tarde."
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <div
      className="modal-recuperar-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Recuperar contraseña"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !cargando) onClose?.();
      }}
    >
      <div className="modal-recuperar-card">
        <div className="modal-recuperar-header">
          <div className="modal-recuperar-icon-wrap">
            <IconoModal tipo="candado" />
          </div>

          <div className="modal-recuperar-title-group">
            <h2 className="modal-recuperar-title">Recuperar contraseña</h2>
            <p className="modal-recuperar-subtitle">
              {step === "form"
                ? "Te enviaremos un enlace a tu correo registrado"
                : "Revisá tu bandeja de entrada"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="modal-recuperar-close"
            aria-label="Cerrar"
            disabled={cargando}
          >
            <IconoModal tipo="cerrar" />
          </button>
        </div>

        <div className="modal-recuperar-body">
          {step === "form" ? (
            <form onSubmit={handleSubmit} noValidate>
              <label className="modal-recuperar-label" htmlFor="recuperar-usuario">
                Nombre de usuario
              </label>

              <input
                ref={inputRef}
                id="recuperar-usuario"
                type="text"
                value={usuario}
                onChange={(event) => setUsuario(event.target.value)}
                placeholder="Tu usuario de acceso"
                className="modal-recuperar-input"
                autoComplete="username"
                disabled={cargando}
              />

              <p className="modal-recuperar-hint">
                Ingresá el usuario con el que accedés al sistema. Si tiene un
                correo registrado, recibirás las instrucciones ahí.
              </p>

              <div className="modal-recuperar-actions">
                <button
                  type="button"
                  onClick={onClose}
                  className="modal-recuperar-btn-secondary"
                  disabled={cargando}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  className="modal-recuperar-btn-primary"
                  disabled={cargando || !usuario.trim()}
                >
                  {cargando ? (
                    <span className="modal-recuperar-spinner" />
                  ) : (
                    <>
                      <IconoModal tipo="enviar" />
                      Enviar instrucciones
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="modal-recuperar-sent-state">
              <div className="modal-recuperar-sent-icon">
                <IconoModal tipo="enviar" />
              </div>

              <p className="modal-recuperar-sent-title">
                ¡Listo! Revisá tu correo
              </p>
              <p className="modal-recuperar-sent-desc">
                Enviamos las instrucciones para restablecer tu contraseña a:
              </p>
              <div className="modal-recuperar-email-badge">{maskedEmail}</div>
              <p className="modal-recuperar-sent-hint">
                Si no lo ves en unos minutos, revisá la carpeta de spam.
              </p>

              <button
                type="button"
                onClick={onClose}
                className="modal-recuperar-btn-primary modal-recuperar-full-btn"
              >
                Entendido
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
