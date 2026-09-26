import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faChevronRight, faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import "./GlobalFloatingNotice.css";

/**
 * Aviso flotante global para eventos importantes que requieren una acción.
 *
 * Pensado para integraciones, ventas recibidas, importaciones y otros avisos
 * persistentes. Se renderiza en document.body para no depender del layout de
 * cada sección y usa únicamente las variables globales de BALTO.
 *
 * onClose = ocultar/minimizar temporalmente. Si se informa onRestore, queda una
 * pestaña compacta para volver a abrirlo. onDismiss es una acción distinta y
 * requiere confirmación para evitar perder avisos por un click accidental.
 */
export default function GlobalFloatingNotice({
  open = false,
  ariaLabel = "Notificación",
  brand = "BALTO",
  brandShort = "B",
  title,
  message,
  details = [],
  status,
  statusTone = "neutral",
  amount,
  extraText,
  actionLabel = "Continuar",
  onClose,
  onAction,
  collapsed = false,
  collapsedLabel = "Aviso pendiente",
  onRestore,
  dismissLabel = "Cerrar aviso",
  dismissConfirmTitle = "¿Cerrar este aviso?",
  dismissConfirmMessage = "El aviso dejará de mostrarse en esta sesión. La operación seguirá disponible en el sistema.",
  onDismiss,
}) {
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  useEffect(() => {
    if (!open || collapsed) setConfirmDismiss(false);
  }, [open, collapsed]);

  useEffect(() => {
    if (!confirmDismiss) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setConfirmDismiss(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmDismiss]);

  if (!open || typeof document === "undefined") return null;

  if (collapsed) {
    return createPortal(
      <button
        type="button"
        className="gfn-tab"
        aria-label={`Abrir ${ariaLabel}`}
        title="Abrir aviso pendiente"
        onClick={typeof onRestore === "function" ? onRestore : onClose}
      >
        <span className="gfn-tab__brand" aria-hidden="true">{brandShort}</span>
        <span className="gfn-tab__text">{collapsedLabel}</span>
        <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
      </button>,
      document.body
    );
  }

  const rows = Array.isArray(details)
    ? details.filter((item) => item && (item.label || item.value))
    : [];

  const notice = (
    <>
      <aside className="gfn-card" role="status" aria-live="polite" aria-label={ariaLabel}>
        <div className="gfn-card__accent" aria-hidden="true" />

        {typeof onClose === "function" && (
          <button
            type="button"
            className="gfn-card__close"
            aria-label="Ocultar aviso"
            title="Ocultar aviso (podés volver a abrirlo)"
            onClick={onClose}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        )}

        <div className="gfn-card__brandRow">
          <span className="gfn-card__brandBadge" aria-hidden="true">{brandShort}</span>
          <span className="gfn-card__brandName">{brand}</span>
        </div>

        {title ? <h3 className="gfn-card__title">{title}</h3> : null}
        {message ? <p className="gfn-card__message">{message}</p> : null}

        {rows.length > 0 && (
          <div className="gfn-card__details">
            {rows.map((item, index) => (
              <div className="gfn-card__detailRow" key={`${item.label || "detail"}-${index}`}>
                <span className="gfn-card__detailLabel">{item.label}</span>
                <strong className="gfn-card__detailValue" title={String(item.value ?? "")}>{item.value}</strong>
              </div>
            ))}
          </div>
        )}

        {(status || amount) && (
          <div className="gfn-card__meta">
            {status ? (
              <span className={`gfn-card__status is-${statusTone || "neutral"}`}>{status}</span>
            ) : <span />}
            {amount ? <strong className="gfn-card__amount">{amount}</strong> : null}
          </div>
        )}

        {extraText ? <div className="gfn-card__extra">{extraText}</div> : null}

        {(typeof onAction === "function" || typeof onDismiss === "function") ? (
          <div className="gfn-card__footer">
            {typeof onDismiss === "function" && dismissLabel ? (
              <button
                type="button"
                className="gfn-card__dismiss"
                onClick={() => setConfirmDismiss(true)}
              >
                {dismissLabel}
              </button>
            ) : null}
            {typeof onAction === "function" && actionLabel ? (
              <button type="button" className="gfn-card__action" onClick={onAction}>
                <span>{actionLabel}</span>
                <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>

      {confirmDismiss ? (
        <div
          className="gfn-confirmBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmDismiss(false);
          }}
        >
          <div
            className="gfn-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gfn-confirm-title"
            aria-describedby="gfn-confirm-message"
          >
            <h4 id="gfn-confirm-title" className="gfn-confirm__title">{dismissConfirmTitle}</h4>
            <p id="gfn-confirm-message" className="gfn-confirm__message">{dismissConfirmMessage}</p>
            <div className="gfn-confirm__actions">
              <button type="button" className="gfn-confirm__cancel" onClick={() => setConfirmDismiss(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="gfn-confirm__accept"
                onClick={() => {
                  setConfirmDismiss(false);
                  onDismiss();
                }}
              >
                Cerrar aviso
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return createPortal(notice, document.body);
}
