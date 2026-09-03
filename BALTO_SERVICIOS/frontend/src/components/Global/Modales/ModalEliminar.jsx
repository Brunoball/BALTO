import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { FaArchive, FaTrashAlt, FaTimes } from "react-icons/fa";
import { createPortal } from "react-dom";
import "./ModalEliminar.css";

function moneyARS(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return String(v ?? "—");

  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

function getMontoTotal(row) {
  if (!row || typeof row !== "object") return null;

  const candidates = [
    row.monto_total,
    row.total,
    row.total_item,
    row.subtotal,
    row.monto,
  ];

  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;

    const n = Number(c);

    if (Number.isFinite(n)) return n;

    return c;
  }

  return null;
}

export default function ModalEliminar({
  open,
  row,
  loading = false,
  onClose,
  onConfirm,
  onToast,

  title = "Eliminar movimiento",
  message = "¿Seguro que querés eliminar este movimiento definitivamente?",
  warning = "Esta acción no se puede deshacer.",
  loadingMessage = "Eliminando movimiento…",
  successMessage = "Movimiento eliminado correctamente.",
  errorMessage = "No se pudo eliminar el movimiento.",
  confirmLabel = "Eliminar",
  cancelLabel = "Cancelar",

  secondaryActionLabel = "",
  onSecondaryAction = null,
  secondaryActionDisabled = false,
  confirmDisabled = false,
  confirmVariant = "danger", // "danger" | "primary"
  visualVariant = "danger", // "danger" | "deactivate"
  loadingLabel = "",
  details = null,
  extraContent = null,
  hideDefaultCard = false,
}) {
  const cancelRef = useRef(null);

  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => {
      onToast?.(tipo, mensaje, duracion);
    },
    [onToast]
  );

  const cerrar = useCallback(() => {
    if (loading) return;
    onClose?.();
  }, [loading, onClose]);

  const handleConfirm = useCallback(async () => {
    if (loading || confirmDisabled) return;
    if (typeof onConfirm !== "function") return;

    showToast("cargando", loadingMessage, 12000);

    try {
      await onConfirm();

      // Reemplaza el toast de carga por el de éxito
      showToast("exito", successMessage, 2800);
    } catch (e) {
      // Importante: NO hacemos throw.
      // Si relanzás el error, puede quedar una promesa rota y el modal después no vuelve bien.
      showToast("error", e?.message || errorMessage, 4200);
    }
  }, [
    loading,
    confirmDisabled,
    onConfirm,
    showToast,
    loadingMessage,
    successMessage,
    errorMessage,
  ]);

  const handleSecondaryAction = useCallback(async () => {
    if (loading || secondaryActionDisabled) return;
    if (typeof onSecondaryAction !== "function") return;

    try {
      await onSecondaryAction();
    } catch (e) {
      showToast("error", e?.message || "No se pudo completar la acción.", 4200);
    }
  }, [loading, secondaryActionDisabled, onSecondaryAction, showToast]);

  useEffect(() => {
    if (!open) return;

    const timer = setTimeout(() => {
      cancelRef.current?.focus();
    }, 0);

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        cerrar();
        return;
      }

      if (e.key === "Enter" && !loading && !confirmDisabled && onConfirm) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        handleConfirm();
      }
    };

    // true = fase captura.
    // Así este modal toma el Escape antes que los modales de atrás.
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, cerrar, loading, confirmDisabled, onConfirm, handleConfirm]);

  const view = useMemo(() => {
    const idMov = row?.id_movimiento ?? row?.idMovimiento ?? row?.id ?? "—";

    const tipo = safeText(
      row?.tipo_movimiento ??
        row?.tipo_venta ??
        row?.pago_tipo_venta ??
        row?.tipo ??
        row?.estado ??
        ""
    );

    const concepto = safeText(
      row?.detalle ??
        row?.concepto ??
        row?.descripcion ??
        row?.observacion ??
        row?.nombre ??
        ""
    );

    const montoRaw = getMontoTotal(row);

    const monto =
      montoRaw === null
        ? "—"
        : typeof montoRaw === "number"
        ? moneyARS(montoRaw)
        : safeText(montoRaw);

    return { idMov, tipo, concepto, monto };
  }, [row]);

  const resolvedDetails = useMemo(() => {
    if (Array.isArray(details) && details.length > 0) {
      return details.map((item, idx) => ({
        key: `${idx}-${item?.label ?? "item"}`,
        label: safeText(item?.label),
        value: safeText(item?.value),
      }));
    }

    return [
      { key: "id", label: "ID Movimiento", value: `#${view.idMov}` },
      { key: "tipo", label: "Tipo", value: view.tipo },
      { key: "concepto", label: "Concepto", value: view.concepto },
      { key: "monto", label: "Monto", value: view.monto },
    ];
  }, [details, view]);

  const isDeactivate = visualVariant === "deactivate";

  const confirmClass =
    confirmVariant === "primary"
      ? "mvdel-btn mvdel-btn--solid-primary"
      : "mvdel-btn mvdel-btn--solid-danger";

  const modalClass = isDeactivate
    ? "mvdel-modal mvdel-modal--deactivate"
    : "mvdel-modal mvdel-modal--danger";

  const iconClass = isDeactivate
    ? "mvdel-icon mvdel-icon--deactivate"
    : "mvdel-icon mvdel-icon--danger";

  const titleClass = isDeactivate
    ? "mvdel-title mvdel-title--deactivate"
    : "mvdel-title mvdel-title--danger";

  if (!open) return null;

  return createPortal(
    <div
      className="mvdel-overlay"
      data-modal-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-eliminar-mov-title"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <div
        className={modalClass}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <button
          className="mvdel-close"
          type="button"
          onClick={cerrar}
          aria-label="Cerrar"
          disabled={loading}
        >
          <FaTimes />
        </button>

        <div className={iconClass} aria-hidden="true">
          {isDeactivate ? <FaArchive /> : <FaTrashAlt />}
        </div>

        <h3
          id="modal-eliminar-mov-title"
          className={titleClass}
        >
          {title}
        </h3>

        <p className="mvdel-body">
          {message}
          {warning ? (
            <>
              <br />
              {warning}
            </>
          ) : null}
        </p>

        {!hideDefaultCard && (
          <div className="mvdel-card">
            {resolvedDetails.map((item) => (
              <div className="mvdel-row" key={item.key}>
                <span className="mvdel-label">{item.label}</span>
                <span className="mvdel-value">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {extraContent ? (
          <div className="mvdel-extraContent">{extraContent}</div>
        ) : null}

        <div className="mvdel-actions">
          <button
            ref={cancelRef}
            type="button"
            className="mvdel-btn mvdel-btn--ghost"
            onClick={cerrar}
            disabled={loading}
          >
            {cancelLabel}
          </button>

          {secondaryActionLabel && typeof onSecondaryAction === "function" ? (
            <button
              type="button"
              className="mvdel-btn mvdel-btn--solid-danger"
              onClick={handleSecondaryAction}
              disabled={loading || secondaryActionDisabled}
            >
              {secondaryActionLabel}
            </button>
          ) : null}

          {typeof onConfirm === "function" ? (
            <button
              type="button"
              className={confirmClass}
              onClick={handleConfirm}
              disabled={loading || confirmDisabled}
            >
              {loading ? loadingLabel || (isDeactivate ? "Dando de baja..." : "Eliminando...") : confirmLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}