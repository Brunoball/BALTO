import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faTriangleExclamation,
  faCircleInfo,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import "./ModalAccionEntidadStock.css";
import { isTopStockModal } from "./modalStackUtils";

function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

function getIconByVariant(variant) {
  switch (variant) {
    case "success":
      return faCircleCheck;
    case "danger":
      return faTriangleExclamation;
    default:
      return faCircleInfo;
  }
}

export default function ModalAccionEntidadStock({
  open,
  onClose,
  onConfirm,
  loading = false,
  title = "Confirmar acción",
  message = "¿Seguro que querés continuar?",
  warning = "",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  details = [],
  variant = "info", // info | danger | success
}) {
  const closeBtnRef = useRef(null);
  const overlayRef = useRef(null);
  const [dark, setDark] = useState(isTemaOscuro);

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());

    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const o2 = new MutationObserver(update);
    if (document.body) {
      o2.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    return () => {
      o1.disconnect();
      o2.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const h = (e) => {
      if (e.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (!loading) onClose?.();
    };

    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [open, loading, onClose]);

  useEffect(() => {
    if (open) {
      setTimeout(() => closeBtnRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const icon = getIconByVariant(variant);

  const colorMap = {
    info: {
      bg: "rgba(59,130,246,.14)",
      border: "rgba(59,130,246,.28)",
      color: "#2563eb",
    },
    danger: {
      bg: "rgba(239,68,68,.14)",
      border: "rgba(239,68,68,.28)",
      color: "#dc2626",
    },
    success: {
      bg: "rgba(16,185,129,.14)",
      border: "rgba(16,185,129,.28)",
      color: "#059669",
    },
  };

  const tone = colorMap[variant] || colorMap.info;

  return createPortal(
    <div
      ref={overlayRef}
      data-stock-modal-overlay="true"
      className={[
        "mi-modal__overlay",
        dark ? "mi-modal__overlay--dark" : "",
      ].join(" ").trim()}
    >
      <div
        className={[
          "mi-modal__container",
          "mi-modal__container--small",
          dark ? "mi-modal--dark" : "",
        ].join(" ").trim()}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div
            className="mi-modal__head-icon"
            aria-hidden="true"
            style={{
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              color: tone.color,
            }}
          >
            <FontAwesomeIcon icon={icon} />
          </div>

          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">{title}</h2>
            <p className="mi-modal__subtitle">{message}</p>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            className="mi-modal__close"
            onClick={() => onClose?.()}
            disabled={loading}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-modal__content">
          {details?.length > 0 && (
            <div className={`stock-actionDetails ${warning ? "stock-actionDetails--withWarning" : ""}`.trim()}>
              {details.map((item, idx) => (
                <div className="stock-actionDetailRow" key={`${item?.label || "detail"}-${idx}`}>
                  <span className="stock-actionDetailLabel">{item?.label || "Dato"}</span>
                  <span className="stock-actionDetailValue">{item?.value || "—"}</span>
                </div>
              ))}
            </div>
          )}

          {warning ? <div className={`stock-actionWarning stock-actionWarning--${variant}`}>{warning}</div> : null}
        </div>

        <div className="mit-actions">
          <button
            type="button"
            className="mit-btn mit-btn--ghost"
            onClick={() => onClose?.()}
            disabled={loading}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            className={`mit-btn ${
              variant === "danger" ? "mit-btn--danger" : "mit-btn--solid"
            }`}
            onClick={() => onConfirm?.()}
            disabled={loading}
          >
            {loading ? "Procesando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}