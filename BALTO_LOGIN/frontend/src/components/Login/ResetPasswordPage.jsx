import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../../services/authApi";
import logoBalto from "../../imagenes/Logo_Balto_Azul.png";
import Toast from "../Global/Toast";
import "./inicio.css";

const IconoVisibilidad = ({ visible }) =>
  visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(
    () => String(params.get("token") || "").trim(),
    [params]
  );
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [mostrarPass, setMostrarPass] = useState(false);
  const [mostrarPass2, setMostrarPass2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const mostrarToast = (tipo, mensaje, duracion = 3000) => {
    setToast({ tipo, mensaje, duracion });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;

    if (!token) {
      mostrarToast("error", "El enlace no contiene token.");
      return;
    }

    if (pass.length < 6) {
      mostrarToast(
        "advertencia",
        "La contraseña debe tener al menos 6 caracteres."
      );
      return;
    }

    if (pass !== pass2) {
      mostrarToast("advertencia", "Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      const respuesta = await resetPassword(token, pass);

      if (!respuesta.ok || respuesta.data?.exito === false) {
        mostrarToast(
          "error",
          respuesta.data?.mensaje || "No se pudo restablecer la contraseña."
        );
        return;
      }

      mostrarToast(
        "exito",
        respuesta.data?.mensaje || "Contraseña actualizada."
      );
      setTimeout(() => navigate("/", { replace: true }), 900);
    } catch (error) {
      mostrarToast(
        "error",
        error?.name === "AbortError"
          ? "Tiempo de espera agotado."
          : "No se pudo conectar al servidor."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ini_page">
      <main className="ini_card" role="region" aria-label="Nueva contraseña">
        <div className="ini_brand">
          <img
            className="ini_brandLogo"
            src={logoBalto}
            alt="BALTO - Sistemas contables"
          />
        </div>

        <h1 className="ini_title">NUEVA CONTRASEÑA</h1>

        <form className="ini_form" onSubmit={submit} noValidate>
          <div className="ini_field ini_fieldPass">
            <input
              className="ini_input ini_inputPass"
              type={mostrarPass ? "text" : "password"}
              value={pass}
              onChange={(event) => setPass(event.target.value)}
              placeholder="Nueva contraseña"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="ini_passToggle"
              onClick={() => setMostrarPass((visible) => !visible)}
              aria-label={mostrarPass ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={mostrarPass ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              <IconoVisibilidad visible={mostrarPass} />
            </button>
          </div>

          <div className="ini_field ini_fieldPass">
            <input
              className="ini_input ini_inputPass"
              type={mostrarPass2 ? "text" : "password"}
              value={pass2}
              onChange={(event) => setPass2(event.target.value)}
              placeholder="Repetir contraseña"
              autoComplete="new-password"
            />
            <button
              type="button"
              className="ini_passToggle"
              onClick={() => setMostrarPass2((visible) => !visible)}
              aria-label={mostrarPass2 ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={mostrarPass2 ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              <IconoVisibilidad visible={mostrarPass2} />
            </button>
          </div>

          <button
            className="ini_btn"
            type="submit"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "GUARDANDO..." : "GUARDAR CONTRASEÑA"}
          </button>

          <div className="ini_links">
            <button
              type="button"
              className="ini_link"
              onClick={() => navigate("/", { replace: true })}
            >
              Volver al inicio de sesión
            </button>
          </div>
        </form>
      </main>

      {toast && (
        <Toast
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
