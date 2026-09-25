import React from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import "./GlobalFloatingNotice.css";

/**
 * Aviso flotante global para eventos importantes que requieren una acción.
 *
 * Pensado para integraciones, ventas recibidas, importaciones y otros avisos
 * persistentes. Se renderiza en document.body para no depender del layout de
 * cada sección y usa únicamente las variables globales de BALTO.
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
}) {
  if (!open || typeof document === "undefined") return null;

  const rows = Array.isArray(details)
    ? details.filter((item) => item && (item.label || item.value))
    : [];

  return createPortal(
    <aside className="gfn-card" role="status" aria-live="polite" aria-label={ariaLabel}>
      <div className="gfn-card__accent" aria-hidden="true" />

      {typeof onClose === "function" && (
        <button
          type="button"
          className="gfn-card__close"
          aria-label="Cerrar aviso"
          title="Cerrar aviso"
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

      {typeof onAction === "function" && actionLabel ? (
        <div className="gfn-card__footer">
          <button type="button" className="gfn-card__action" onClick={onAction}>
            <span>{actionLabel}</span>
            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </aside>,
    document.body
  );
}
