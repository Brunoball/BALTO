// src/components/Flujo_de_Caja/modales/FcModalParts.jsx
// Piezas compartidas por los modales de Flujo de Caja (cierres, conciliaciones,
// ajustes e historiales). Reutilizan las clases globales mi-mini__* (encabezado
// azul, cierre con X) y agregan sólo la estructura común fc-md-*.
//
// Comportamiento común:
//  - Escape cierra únicamente el modal que está arriba de la pila.
//  - Un clic en el fondo NO cierra el modal.
//  - El pie queda fijo; sólo el cuerpo hace scroll.

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_Modals.css";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./fc_modales.css";

/* Pila de modales abiertos: Escape sólo actúa sobre el último. */
const modalStack = [];

export function ModalShell({
  open = true,
  titleId,
  title,
  icon,
  onClose,
  onEscape,
  closeDisabled = false,
  size = "md",
  className = "",
  bodyClassName = "",
  overlayClassName = "",
  footer = null,
  role = "dialog",
  testId,
  children,
}) {
  const keyRef = useRef({});

  useEffect(() => {
    if (!open) return undefined;
    const key = keyRef.current;
    modalStack.push(key);
    return () => {
      const i = modalStack.lastIndexOf(key);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] !== keyRef.current) return;
      if (closeDisabled) return;
      e.preventDefault();
      (onEscape || onClose)?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onEscape, onClose, closeDisabled]);

  if (!open) return null;

  return createPortal(
    <div className={`mi-mini__overlay fc-md-overlay ${overlayClassName}`} role="presentation">
      <div
        className={`mi-mini__modal fc-md-modal fc-md-modal--${size} ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-mini__head fc-md-head">
          <h4 id={titleId} className="mi-mini__title fc-md-title">
            {icon && <FontAwesomeIcon icon={icon} aria-hidden="true" />}
            <span>{title}</span>
          </h4>
          <button
            type="button"
            className="mi-mini__close"
            onClick={() => !closeDisabled && onClose?.()}
            disabled={closeDisabled}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        <div className={`mi-mini__body fc-md-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="fc-md-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* =========================================================
   Importes
========================================================= */

/** Tono por signo: pos (sobrante / suma), neg (faltante / resta), zero. */
export function toneOf(n) {
  const v = Number(n || 0);
  if (v > 0.004) return "pos";
  if (v < -0.004) return "neg";
  return "zero";
}

/** Etiqueta de una diferencia de arqueo según su signo. */
export function etiquetaDiferencia(n) {
  const t = toneOf(n);
  if (t === "pos") return "Sobrante";
  if (t === "neg") return "Faltante";
  return "Coincide";
}

/**
 * Tarjeta de importe con el estilo de Indicadores generales del Dashboard:
 * ícono en chip, etiqueta corta y valor destacado. `tag` agrega una etiqueta
 * de texto (Sobrante, Faltante…) para no depender sólo del color.
 */
export function Stat({ icon, label, value, tone = "neutral", tag, highlight = false, testId, sub, className = "" }) {
  return (
    <div className={`fc-md-stat fc-md-stat--${tone} ${highlight ? "fc-md-stat--highlight" : ""} ${className}`}>
      {icon && (
        <span className="fc-md-stat__icon" aria-hidden="true">
          <FontAwesomeIcon icon={icon} />
        </span>
      )}
      <div className="fc-md-stat__body">
        <span className="fc-md-stat__label">{label}</span>
        <strong className="fc-md-stat__value" data-testid={testId}>{value}</strong>
        {(tag || sub) && (
          <span className="fc-md-stat__foot">
            {tag && <span className="fc-md-stat__tag">{tag}</span>}
            {sub && <small className="fc-md-stat__sub">{sub}</small>}
          </span>
        )}
      </div>
    </div>
  );
}

/** Estado con punto + texto: legible en ambos temas y sin depender del color. */
export function Badge({ tone = "muted", children, testId, title }) {
  return (
    <span className={`fc-md-badge fc-md-badge--${tone}`} data-testid={testId} title={title}>
      {children}
    </span>
  );
}

/** Lista de datos simples (fecha, responsable, observaciones…), sin tarjetas. */
export function MetaList({ items, className = "" }) {
  const visibles = (items || []).filter(Boolean);
  if (!visibles.length) return null;
  return (
    <dl className={`fc-md-meta ${className}`}>
      {visibles.map((it) => (
        <div key={it.label} className={it.wide ? "fc-md-meta__item--wide" : undefined}>
          <dt>{it.label}</dt>
          <dd data-testid={it.testId}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Mensaje bajo un campo. Reserva su altura para que el modal no salte. */
export function FieldMsg({ id, error, warn, hint, testId }) {
  const cls = error ? "is-error" : warn ? "is-warn" : "";
  return (
    <small id={id} className={`fc-md-fieldMsg ${cls}`} role={error ? "alert" : undefined} data-testid={testId}>
      {error || warn || hint || ""}
    </small>
  );
}

/** Indicador compacto del paso actual (va en el pie del modal). */
export function Steps({ labels, current }) {
  const idx = Math.max(0, labels.indexOf(current));
  return (
    <span className="fc-md-steps" aria-label={`Paso ${idx + 1} de ${labels.length}: ${labels[idx]}`}>
      <span className="fc-md-steps__dots" aria-hidden="true">
        {labels.map((l, i) => <i key={l} className={i < idx ? "is-done" : i === idx ? "is-current" : ""} />)}
      </span>
      <span aria-hidden="true">
        {idx + 1}/{labels.length}<span className="fc-md-steps__label"> · <b>{labels[idx]}</b></span>
      </span>
    </span>
  );
}
