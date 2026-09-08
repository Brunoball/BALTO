import React, { useEffect, useState } from "react";
import { loginGlobal } from "../../services/authApi";
import { clearGlobalSession, persistGlobalSession } from "../../auth/storage";
import { redirectLoginToPendingLocalFrontend } from "../../auth/localDevReturn";
import BASE_URL from "../../config/config";
import logoBalto from "../../imagenes/Logo_Balto_Azul.png";
import Toast from "../Global/Toast";
import ModalRecuperarContra from "./modales/ModalRecuperarContra";
import "./inicio.css";

const REMEMBER_FLAG = "rememberLogin";
const REMEMBER_USER = "remember_nombre";
const REMEMBER_PASSWORD = "remember_contrasena";

function resolverDestinoLogin(data) {
  const sistema = data?.sistema || data?.usuario?.sistema || {};
  const codigo = String(
    sistema?.codigo || data?.usuario?.sistema_codigo || ""
  )
    .trim()
    .toUpperCase();

  const redirectBackend = String(
    data?.redirect_url ||
      sistema?.frontend_url ||
      data?.usuario?.sistema_frontend_url ||
      ""
  ).trim();

  if (!redirectBackend) {
    throw new Error(
      `El sistema ${codigo || "del tenant"} no tiene URL de destino configurada.`
    );
  }

  // En desarrollo el frontend puede vivir en localhost mientras la API y los
  // sistemas reales viven en Hostinger. Por eso el destino se resuelve contra
  // el origen de BASE_URL, no obligatoriamente contra window.location.origin.
  const apiOrigin = new URL(BASE_URL, window.location.origin).origin;
  const destino = new URL(redirectBackend, `${apiOrigin}/`);

  // Permitimos únicamente el mismo origen del login o el origen de la API
  // configurada. Así funciona localhost -> Hostinger sin habilitar open redirects.
  const origenesPermitidos = new Set([window.location.origin, apiOrigin]);
  if (!origenesPermitidos.has(destino.origin)) {
    throw new Error("La URL de destino configurada no pertenece a BALTO.");
  }

  // Además, el path debe coincidir con la vertical autenticada. Esto evita que
  // un tenant de SERVICIOS sea enviado por error a COMERCIO (o viceversa).
  const prefijosPorSistema = {
    COMERCIO: ["/BALTO_COMERCIO/", "/BALTO/COMERCIO/"],
    SERVICIOS: ["/BALTO_SERVICIOS/", "/BALTO/SERVICIOS/"],
  };

  const prefijosEsperados = prefijosPorSistema[codigo] || [];
  if (prefijosEsperados.length > 0) {
    const path = destino.pathname.endsWith("/")
      ? destino.pathname
      : `${destino.pathname}/`;

    const coincide = prefijosEsperados.some(
      (prefijo) => path === prefijo || path.startsWith(prefijo)
    );

    if (!coincide) {
      throw new Error(
        `La URL configurada para ${codigo} no coincide con su sistema BALTO.`
      );
    }
  }

  return destino.href;
}

export default function Inicio() {
  const [nombre, setNombre] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [toast, setToast] = useState(null);
  const [showRecuperar, setShowRecuperar] = useState(false);

  const mostrarToast = (tipo, mensaje, duracion = 3400) =>
    setToast({ tipo, mensaje, duracion });

  useEffect(() => {
    if (localStorage.getItem(REMEMBER_FLAG) !== "1") return;
    setRemember(true);
    setNombre(localStorage.getItem(REMEMBER_USER) || "");
    setContrasena(localStorage.getItem(REMEMBER_PASSWORD) || "");
  }, []);

  const persistRemember = (user, password, enabled) => {
    if (enabled) {
      localStorage.setItem(REMEMBER_FLAG, "1");
      localStorage.setItem(REMEMBER_USER, user);
      localStorage.setItem(REMEMBER_PASSWORD, password);
    } else {
      localStorage.removeItem(REMEMBER_FLAG);
      localStorage.removeItem(REMEMBER_USER);
      localStorage.removeItem(REMEMBER_PASSWORD);
    }
  };

  const manejarEnvio = async (e) => {
    e.preventDefault();
    if (cargando) return;

    const user = String(nombre || "").trim();
    const pass = String(contrasena || "");

    if (!user || !pass) {
      mostrarToast("advertencia", "Por favor complete todos los campos");
      return;
    }

    setCargando(true);

    try {
      const r = await loginGlobal(user, pass);

      if (r.status === 401 || r.status === 403) {
        mostrarToast(
          "error",
          r.data?.mensaje || "Usuario o contraseña incorrectos"
        );
        return;
      }

      if (!r.ok || !r.data?.exito) {
        mostrarToast(
          "error",
          r.data?.mensaje ||
            `No se pudo iniciar sesión. Error HTTP ${r.status}.`
        );
        return;
      }

      const sessionKey = String(r.data.session_key || "").trim();
      const usuario = r.data.usuario || {};
      const sistema = r.data.sistema || {
        codigo: usuario.sistema_codigo,
        nombre: usuario.sistema_nombre,
        frontend_url: usuario.sistema_frontend_url,
        api_base_url: usuario.sistema_api_base_url,
      };

      if (!sessionKey) {
        mostrarToast(
          "error",
          "Login correcto pero falta session_key en la respuesta."
        );
        return;
      }

      let destino;
      try {
        destino = resolverDestinoLogin(r.data);
      } catch (redirectError) {
        mostrarToast("error", redirectError.message);
        return;
      }

      const usuarioFinal = {
        ...usuario,
        sistema_codigo: String(
          sistema?.codigo || usuario?.sistema_codigo || ""
        ).toUpperCase(),
        sistema_nombre: sistema?.nombre || usuario?.sistema_nombre || "",
        sistema_frontend_url:
          sistema?.frontend_url || usuario?.sistema_frontend_url || "",
        sistema_api_base_url:
          sistema?.api_base_url || usuario?.sistema_api_base_url || "",
      };

      persistGlobalSession({
        sessionKey,
        usuario: usuarioFinal,
        sistema,
      });
      persistRemember(user, pass, remember);

      // Si este login fue iniciado por BALTO_COMERCIO o BALTO_SERVICIOS
      // ejecutándose en localhost, devolvemos la sesión directamente al
      // frontend local. El build productivo de Hostinger NO se abre ni se usa.
      try {
        const retornoLocal = redirectLoginToPendingLocalFrontend({
          sessionKey,
          usuario: usuarioFinal,
          sistema,
        });

        if (retornoLocal) return;
      } catch (localRedirectError) {
        clearGlobalSession();
        mostrarToast(
          "error",
          localRedirectError?.message ||
            "No se pudo volver al frontend local de BALTO."
        );
        return;
      }

      // Mientras desarrollamos el frontend del LOGIN en localhost no saltamos
      // a Hostinger. Las carpetas BALTO_COMERCIO/BALTO_SERVICIOS pueden estar
      // todavía vacías y Hostinger respondería 403. Conservamos la sesión local
      // y dejamos el login ejecutándose para poder seguir probándolo.
      const hostActual = String(window.location.hostname || "").toLowerCase();
      const esDesarrolloLocal =
        hostActual === "localhost" || hostActual === "127.0.0.1";

      if (esDesarrolloLocal) {
        const codigoSistema = String(usuarioFinal.sistema_codigo || "BALTO");
        mostrarToast(
          "exito",
          `Login correcto (${codigoSistema}). El redireccionamiento queda desactivado mientras ejecutás el LOGIN en localhost.`,
          5000
        );
        setContrasena("");
        return;
      }

      // En producción Login, Comercio y Servicios viven bajo balto.3devsnet.com.
      // Ahí sí se realiza el redirect normal devuelto por la MASTER.
      window.location.replace(destino);
    } catch (err) {
      mostrarToast(
        "error",
        err?.name === "AbortError"
          ? "Tiempo de espera agotado conectando al servidor."
          : "No se pudo conectar al servidor. Verificá tu conexión o la URL del API global."
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="ini_page">
      <main className="ini_card" role="region" aria-label="Inicio de sesión">
        <div className="ini_brand">
          <img
            className="ini_brandLogo"
            src={logoBalto}
            alt="BALTO - Sistemas contables"
          />
        </div>

        <h1 className="ini_title">INICIAR SESIÓN</h1>

        <form
          className="ini_form"
          onSubmit={manejarEnvio}
          autoComplete="on"
          noValidate
        >
          <div className="ini_field ini_fieldUser">
            <input
              id="balto-user"
              type="text"
              placeholder="Usuario"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="ini_input"
              autoComplete="username"
              inputMode="text"
            />
          </div>

          <div className="ini_field ini_fieldPass">
            <input
              id="balto-pass"
              type={showPassword ? "text" : "password"}
              placeholder="Contraseña"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              required
              className="ini_input ini_inputPass"
              autoComplete="current-password"
            />

            <button
              type="button"
              className="ini_passToggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? (
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
              )}
            </button>
          </div>

          <label className="ini_remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                const checked = e.target.checked;
                setRemember(checked);
                if (!checked) persistRemember("", "", false);
              }}
            />
            <span>Recordar cuenta</span>
          </label>

          <button
            className="ini_btn"
            type="submit"
            disabled={cargando}
            aria-busy={cargando}
          >
            {cargando ? "INICIANDO..." : "ACCEDER"}
          </button>

          <div className="ini_links">
            <button
              type="button"
              className="ini_link"
              onClick={() => setShowRecuperar(true)}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </form>
      </main>

      {showRecuperar && (
        <ModalRecuperarContra
          onClose={() => setShowRecuperar(false)}
          usuarioPrefill={nombre}
          onToast={mostrarToast}
        />
      )}

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
