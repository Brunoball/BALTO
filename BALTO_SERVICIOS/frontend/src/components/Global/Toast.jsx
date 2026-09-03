import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheckCircle,
  faExclamationTriangle,
  faTimesCircle,
  faSpinner,
  faInfoCircle,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import "./Toast.css";

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

  const iconos = {
    exito: faCheckCircle,
    error: faTimesCircle,
    advertencia: faExclamationTriangle,
    cargando: faSpinner,
  };

  const clasesTipo = {
    exito: "toast-exito",
    error: "toast-error",
    advertencia: "toast-advertencia",
    cargando: "toast-cargando",
  };

  const iconoSeleccionado = iconos[tipoVisual] || faInfoCircle;
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
      <FontAwesomeIcon
        icon={iconoSeleccionado}
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
          <FontAwesomeIcon icon={faTimes} />
        </button>
      )}
    </div>,
    document.body
  );
};

export default Toast;