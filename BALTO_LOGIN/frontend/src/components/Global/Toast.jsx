import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

const IconoToast = ({ tipo, className = "" }) => {
  const contenido = {
    exito: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.6 2.6L16.5 9" />
      </>
    ),
    error: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </>
    ),
    advertencia: (
      <>
        <path d="M10.3 4.1 2.5 17.6A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.4L13.7 4.1a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 16.5h.01" />
      </>
    ),
    cargando: (
      <>
        <circle cx="12" cy="12" r="9" opacity=".25" />
        <path d="M12 3a9 9 0 0 1 9 9" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  };

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {contenido[tipo] || contenido.info}
    </svg>
  );
};

const IconoCerrar = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
);

const TIPOS_CON_CIERRE_MANUAL = ["error", "advertencia"];

const normalizarTexto = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const esAlertaDeCampoObligatorio = (mensaje) => {
  const texto = normalizarTexto(mensaje);

  return [
    "campo obligatorio",
    "campos obligatorios",
    "faltan campos",
    "falta completar",
    "falta rellenar",
    "debes completar",
    "debe completar",
    "debes ingresar",
    "debe ingresar",
    "complete los campos",
    "completa los campos",
    "completar los campos",
    "completa todos los campos",
    "complete todos los campos",
    "rellena los campos",
    "rellene los campos",
    "ingresa",
    "ingrese",
    "ingresa un",
    "ingrese un",
    "selecciona",
    "seleccione",
  ].some((frase) => texto.includes(frase));
};

const normalizarTipoToast = (tipo, mensaje) => {
  if (tipo === "error" && esAlertaDeCampoObligatorio(mensaje)) {
    return "advertencia";
  }

  return tipo;
};

// Evento global para cerrar cualquier toast anterior
const TOAST_GLOBAL_EVENT = "toast:cerrar-anteriores";

const EVENTOS_QUE_CIERRAN_TOAST_MANUAL = [
  "keydown",
  "change",
  "submit",
  "mousedown",
  "touchstart",
];

// Elementos que SÍ cierran el toast.
// No están input, textarea ni select para que al escribir/tocarlos no se cierre.
const SELECTOR_INTERACCION_REAL = [
  "button",
  "a",
  "label",
  "[role='button']",
  ".btn",
  ".button",
].join(", ");

// Elementos que NO deben cerrar el toast.
const SELECTOR_NO_CIERRA_TOAST = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='option']",
  "[role='menuitem']",
  ".select",
  ".selector",
  ".react-select__control",
  ".react-select__option",
  ".react-select__menu",
].join(", ");

const Toast = ({ tipo, mensaje, onClose, duracion = 2500 }) => {
  const tipoVisual = normalizarTipoToast(tipo, mensaje);
  const [desapareciendo, setDesapareciendo] = useState(false);

  const toastIdRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const cerradoRef = useRef(false);
  const timersRef = useRef([]);

  const esManual = TIPOS_CON_CIERRE_MANUAL.includes(tipoVisual);

  const limpiarTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  };

  const cerrarToast = ({ conAnimacion = true } = {}) => {
    if (cerradoRef.current) return;

    cerradoRef.current = true;
    limpiarTimers();

    if (conAnimacion) {
      setDesapareciendo(true);

      const timer = setTimeout(() => {
        onClose?.();
      }, 250);

      timersRef.current.push(timer);
    } else {
      onClose?.();
    }
  };

  useEffect(() => {
    const miId = toastIdRef.current;

    const cerrarSiNoSoyYo = (event) => {
      const idEntrante = event?.detail?.id;

      if (idEntrante && idEntrante !== miId) {
        cerrarToast({ conAnimacion: false });
      }
    };

    window.addEventListener(TOAST_GLOBAL_EVENT, cerrarSiNoSoyYo);

    // Cuando este toast se monta, cierra todos los toast anteriores
    window.dispatchEvent(
      new CustomEvent(TOAST_GLOBAL_EVENT, {
        detail: { id: miId },
      })
    );

    return () => {
      window.removeEventListener(TOAST_GLOBAL_EVENT, cerrarSiNoSoyYo);
      limpiarTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    limpiarTimers();
    setDesapareciendo(false);
    cerradoRef.current = false;

    if (esManual) return;

    const d = Number(duracion) > 0 ? Number(duracion) : 2500;
    const tiempoAnimacion = 500;

    const mostrarTimer = setTimeout(() => {
      if (!cerradoRef.current) {
        setDesapareciendo(true);
      }
    }, Math.max(0, d - tiempoAnimacion));

    const ocultarTimer = setTimeout(() => {
      cerrarToast({ conAnimacion: false });
    }, d);

    timersRef.current.push(mostrarTimer, ocultarTimer);

    return () => {
      limpiarTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoVisual, mensaje, duracion, esManual]);

  useEffect(() => {
    if (!esManual) return;

    const cerrarPorEventoGlobal = (event) => {
      const target = event?.target;

      // Si el evento ocurre dentro del propio toast, no lo cerramos acá.
      // Así el botón X sigue cerrando con su propia animación.
      if (target?.closest?.(".toast-container")) return;

      // Escape SIEMPRE cierra el toast manual,
      // incluso si el foco está dentro de un input, textarea o select.
      if (event.type === "keydown" && event.key === "Escape") {
        cerrarToast({ conAnimacion: true });
        return;
      }

      // Si viene de inputs, textarea, select o selectores, NO cerramos el toast.
      // Esto mantiene el comportamiento de no cerrar mientras escribís o interactuás con campos.
      if (target?.closest?.(SELECTOR_NO_CIERRA_TOAST)) return;

      const esEventoSubmit = event.type === "submit";

      const esClickEnElementoInteractivo =
        event.type === "mousedown" || event.type === "touchstart"
          ? target?.closest?.(SELECTOR_INTERACCION_REAL)
          : false;

      const esTeclaDeAccion =
        event.type === "keydown" && ["Enter", "Tab"].includes(event.key);

      const debeCerrar =
        esEventoSubmit || esClickEnElementoInteractivo || esTeclaDeAccion;

      if (!debeCerrar) return;

      cerrarToast({ conAnimacion: true });
    };

    EVENTOS_QUE_CIERRAN_TOAST_MANUAL.forEach((evento) => {
      document.addEventListener(evento, cerrarPorEventoGlobal, true);
    });

    return () => {
      EVENTOS_QUE_CIERRAN_TOAST_MANUAL.forEach((evento) => {
        document.removeEventListener(evento, cerrarPorEventoGlobal, true);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esManual, tipoVisual, mensaje]);

  const clasesTipo = {
    exito: "toast-exito",
    error: "toast-error",
    advertencia: "toast-advertencia",
    cargando: "toast-cargando",
  };

  const claseSeleccionada = clasesTipo[tipoVisual] || "toast-info";

  return createPortal(
    <div
      className={`toast-container ${claseSeleccionada} ${
        desapareciendo ? "desaparecer" : ""
      }`}
      role={tipoVisual === "error" || tipoVisual === "advertencia" ? "alert" : "status"}
      aria-live={
        tipoVisual === "error" || tipoVisual === "advertencia" ? "assertive" : "polite"
      }
    >
      <IconoToast
        tipo={tipoVisual}
        className={`toast-icon ${tipoVisual === "cargando" ? "spin" : ""}`}
      />

      <span className="toast-message">{mensaje}</span>

      {esManual && (
        <button
          type="button"
          className="toast-close-btn"
          onClick={() => cerrarToast({ conAnimacion: true })}
          aria-label="Cerrar notificación"
        >
          <IconoCerrar />
        </button>
      )}
    </div>,
    document.body
  );
};

export default Toast;
