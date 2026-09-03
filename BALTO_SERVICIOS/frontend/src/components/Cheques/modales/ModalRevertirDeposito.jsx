import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaArrowRotateLeft,
  FaBuildingColumns,
  FaCircleInfo,
  FaDollarSign,
  FaHashtag,
  FaXmark,
} from "react-icons/fa6";
import "../../Global/Global_css/Global_Modals.css";
import "./ModalRevertirDeposito.css";

function todayLocalISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidISODate(fecha) {
  const s = String(fecha || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function moneyARS(valor) {
  const n = Number(valor || 0);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}

export default function ModalRevertirDeposito({
  open,
  onClose,
  onConfirm,
  loading = false,
  cheque = null,
  tipoLabel = "Cheque",
}) {
  const [fechaReversion, setFechaReversion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errors, setErrors] = useState({});
  const fechaInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setFechaReversion(todayLocalISO());
    setMotivo("");
    setErrors({});
  }, [open, cheque?.id_cheque]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !loading) onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const abrirCalendario = () => {
    if (loading) return;

    try {
      fechaInputRef.current?.showPicker?.();
    } catch {
      fechaInputRef.current?.focus();
    }
  };

  const confirmar = () => {
    const nextErrors = {};
    const motivoLimpio = String(motivo || "").trim();

    if (!isValidISODate(fechaReversion)) {
      nextErrors.fecha = "Seleccioná una fecha de reversión válida.";
    }
    if (motivoLimpio.length < 5) {
      nextErrors.motivo = "Ingresá un motivo de al menos 5 caracteres.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    onConfirm?.({
      fecha_reversion: fechaReversion,
      motivo: motivoLimpio,
      confirmacion: true,
    });
  };

  return createPortal(
    <div className="mi-modal__overlay cheque-reversion-modal__overlay" role="presentation">
      <div
        className="mi-modal__container cheque-reversion-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-revertir-deposito-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-icon" aria-hidden="true">
            <FaArrowRotateLeft />
          </div>

          <div className="mi-modal__head-left">
            <h2 id="modal-revertir-deposito-title" className="mi-modal__title">
              Reactivar en cartera
            </h2>
          </div>

          <button
            type="button"
            className="mi-modal__close"
            onClick={() => (!loading ? onClose?.() : null)}
            disabled={loading}
            aria-label="Cerrar"
          >
            <FaXmark />
          </button>
        </div>

        <div className="mi-modal__content cheque-reversion-modal__content">
          <p className="cheque-reversion-modal__question">
            El {tipoLabel.toLowerCase()} volverá a quedar disponible en cartera. El egreso de depósito no se edita ni se elimina.
          </p>

          <div className="cheque-reversion-modal__summary">
            <div className="cheque-reversion-modal__summaryCard cheque-reversion-modal__summaryCard--issuer">
              <div className="cheque-reversion-modal__summaryIcon" aria-hidden="true">
                <FaBuildingColumns />
              </div>
              <div className="cheque-reversion-modal__summaryContent">
                <span>Emisor</span>
                <strong>{safeText(cheque?.emisor)}</strong>
              </div>
            </div>

            <div className="cheque-reversion-modal__summaryCard cheque-reversion-modal__summaryCard--number">
              <div className="cheque-reversion-modal__summaryIcon" aria-hidden="true">
                <FaHashtag />
              </div>
              <div className="cheque-reversion-modal__summaryContent">
                <span>Número</span>
                <strong>{safeText(cheque?.numero_cheque)}</strong>
              </div>
            </div>

            <div className="cheque-reversion-modal__summaryCard cheque-reversion-modal__summaryCard--amount">
              <div className="cheque-reversion-modal__summaryIcon" aria-hidden="true">
                <FaDollarSign />
              </div>
              <div className="cheque-reversion-modal__summaryContent">
                <span>Importe</span>
                <strong>{moneyARS(cheque?.importe)}</strong>
              </div>
            </div>
          </div>

          <div className="cheque-reversion-modal__fields">
            <div className="fl-field">
              <input
                ref={fechaInputRef}
                className="fl-input"
                type="date"
                value={fechaReversion}
                onClick={abrirCalendario}
                onChange={(event) => {
                  setFechaReversion(event.target.value);
                  setErrors((prev) => ({ ...prev, fecha: "" }));
                }}
                disabled={loading}
                placeholder=" "
              />
              <label className="fl-label">Fecha de reactivación</label>
              {errors.fecha && <small className="cheque-reversion-modal__error">{errors.fecha}</small>}
            </div>

            <div className="fl-field">
              <textarea
                className="fl-input cheque-reversion-modal__textarea"
                value={motivo}
                maxLength={500}
                onChange={(event) => {
                  setMotivo(event.target.value.toUpperCase());
                  setErrors((prev) => ({ ...prev, motivo: "" }));
                }}
                disabled={loading}
                placeholder=" "
                rows={3}
              />
              <label className="fl-label">Motivo obligatorio</label>
              <div className="cheque-reversion-modal__counter">{motivo.length}/500</div>
              {errors.motivo && <small className="cheque-reversion-modal__error">{errors.motivo}</small>}
            </div>
          </div>

          <div className="cheque-reversion-modal__info">
            <FaCircleInfo />
            <span>
              Esta acción conserva el depósito original en el historial, registra la reversión y devuelve el valor a cartera.
            </span>
          </div>
        </div>

        <div className="mit-actions cheque-reversion-modal__actions">
          <button
            type="button"
            className="mit-btn mit-btn--ghost"
            onClick={() => (!loading ? onClose?.() : null)}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="mit-btn mit-btn--solid"
            onClick={confirmar}
            disabled={loading}
          >
            {loading ? "Reactivando..." : `Reactivar ${tipoLabel}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
