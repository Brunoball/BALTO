import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import "../Global_css/Global_Modals.css";
import "../Global_css/Global_responsive.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMoneyCheckDollar,
  faXmark,
  faCreditCard,
  faMoneyBill,
  faShoppingCart,
  faArrowRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";

/* =========================
   Helpers
========================= */
function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "—";

  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return `${String(Number(m[3])).padStart(2, "0")}/${String(
      Number(m[2])
    ).padStart(2, "0")}/${m[1]}`;
  }

  return s;
}

function firstText(...values) {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function toFiniteNumber(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getChequeNumero(item) {
  return firstText(
    item?.cheque_numero,
    item?.numero_cheque,
    item?.cheque?.numero_cheque,
    item?.cheque?.numero,
    item?.id_cheque
  );
}

function getChequeEmisor(item) {
  return firstText(item?.cheque_emisor, item?.emisor, item?.cheque?.emisor);
}

function getChequeFechaEmision(item) {
  return firstText(item?.cheque_fecha_emision, item?.fecha_emision, item?.cheque?.fecha_emision);
}

function getChequeFechaPago(item) {
  return firstText(
    item?.cheque_fecha_pago,
    item?.cheque_fecha_vencimiento,
    item?.cheque?.fecha_pago,
    item?.cheque?.fecha_vencimiento,
    item?.fecha_vencimiento,
    item?.fecha_pago
  );
}

function getChequeImporteReal(item) {
  const candidates = [
    item?.cheque_importe,
    item?.importe_cheque,
    item?.cheque?.importe,
    item?.cheque_monto,
  ];

  for (const value of candidates) {
    const n = toFiniteNumber(value);
    if (n > 0) return n;
  }

  return toFiniteNumber(item?.monto);
}

function getMedioMontoAplicado(item) {
  const n = toFiniteNumber(item?.monto_aplicado ?? item?.monto);
  return n > 0 ? n : 0;
}

function getMedioMontoVisible(item) {
  return item?.id_cheque ? getChequeImporteReal(item) : getMedioMontoAplicado(item);
}

function shouldShowMontoAplicado(item) {
  if (!item?.id_cheque) return false;
  const aplicado = getMedioMontoAplicado(item);
  const real = getChequeImporteReal(item);
  return aplicado > 0 && real > 0 && Math.abs(real - aplicado) > 0.009;
}

function getDetalleList(row) {
  if (Array.isArray(row?.medios_pago_detalle)) return row.medios_pago_detalle;

  if (typeof row?.medios_pago_detalle === "string") {
    try {
      const parsed = JSON.parse(row.medios_pago_detalle);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeTipo(nombre) {
  const s = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) {
    return "echeq";
  }
  if (s.includes("cheque")) return "cheque";
  return null;
}

/* =========================
   Cheque Card
========================= */
function ChequeDetalle({ item }) {
  const tipoCheque = normalizeTipo(
    item?.cheque_tipo || item?.medio_pago_nombre || ""
  );
  const isEcheq = tipoCheque === "echeq";

  return (
    <div
      className={["cheque-card", isEcheq ? "cheque-card--echeq" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="cheque-card__header">
        <div className="cheque-card__header-dots" aria-hidden="true" />

        <div className="cheque-card__brand">
          <div className="cheque-card__logo-icon">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 13 }} />
          </div>
          <div>
            <div className="cheque-card__bank-name">
              {safeText(item?.medio_pago_nombre)}
            </div>
            <div className="cheque-card__bank-sub">
              {isEcheq ? "E-CHEQ ELECTRÓNICO" : "CHEQUE DE PAGO DIFERIDO"}
            </div>
          </div>
        </div>

        <div className="cheque-card__header-right">
          <span className="cheque-card__num-label">N°</span>
          <span className="cheque-card__num-value">
            {safeText(getChequeNumero(item))}
          </span>
        </div>

        <div className="cheque-card__slash" aria-hidden="true" />
      </div>

      <div className="cheque-card__body">
        <div className="cheque-card__row cheque-card__row--spaced">
          <div className="cheque-card__field cheque-card__field--wide">
            <span className="cheque-card__field-label">Emisor</span>
            <div className="cheque-card__field-line">
              {safeText(getChequeEmisor(item))}
            </div>
          </div>

          <div className="cheque-card__field">
            <span className="cheque-card__field-label">F. emisión</span>
            <div className="cheque-card__field-line cheque-card__field-line--mono">
              {formatFechaDMY(getChequeFechaEmision(item))}
            </div>
          </div>
        </div>

        <div className="cheque-card__row cheque-card__row--spaced">
          <div className="cheque-card__field cheque-card__field--wide">
            <span className="cheque-card__field-label">ID cheque</span>
            <div className="cheque-card__field-line cheque-card__field-line--mono">
              {safeText(item?.id_cheque)}
            </div>
          </div>

          <div className="cheque-card__importe-box">
            <span className="cheque-card__importe-symbol">$</span>
            <span className="cheque-card__importe-value">
              {moneyARS(getChequeImporteReal(item))}
            </span>
          </div>
        </div>

        <div className="cheque-card__row cheque-card__row--spaced">
          <div className="cheque-card__field">
            <span className="cheque-card__field-label">F. pago</span>
            <div className="cheque-card__field-line cheque-card__field-line--mono">
              {formatFechaDMY(getChequeFechaPago(item))}
            </div>
          </div>

          <div className="cheque-card__field cheque-card__field--firma">
            <span className="cheque-card__field-label">Tipo</span>
            <div className="cheque-card__firma-line">
              <span className="cheque-card__firmante">
                {safeText(item?.cheque_tipo || (isEcheq ? "eCheq" : "Cheque"))}
              </span>
            </div>
          </div>
        </div>

        {shouldShowMontoAplicado(item) ? (
          <div className="cheque-card__row">
            <div className="cheque-card__field cheque-card__field--wide">
              <span className="cheque-card__field-label">Aplicado al movimiento</span>
              <div className="cheque-card__field-line cheque-card__field-line--mono">
                {moneyARS(getMedioMontoAplicado(item))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="cheque-card__micr">
        <div className="cheque-card__micr-accent" aria-hidden="true" />
        <span className="cheque-card__micr-text"></span>
        <div className="cheque-card__security">
          <svg width="11" height="13" viewBox="0 0 12 14" fill="none">
            <rect
              x="1"
              y="5"
              width="10"
              height="8"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <circle cx="6" cy="9" r="1.2" fill="currentColor" />
          </svg>
          <span>Seguridad</span>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Medio genérico (no cheque)
========================= */
function MedioGenericoDetalle({ item }) {
  return (
    <div className="mdp-medio-card">
      <div className="mdp-medio-card__icon">
        <FontAwesomeIcon icon={faCreditCard} />
      </div>

      <div className="mdp-medio-card__info">
        <span className="mdp-medio-card__nombre">
          {safeText(item?.medio_pago_nombre)}
        </span>
        <span className="mdp-medio-card__sub">Medio de pago</span>
      </div>

      <div className="mdp-medio-card__monto">
        {moneyARS(getMedioMontoVisible(item))}
      </div>
    </div>
  );
}

/* =========================
   Modal Principal Unificado
========================= */
export default function ModalDetalleMediosPago({
  open,
  row,
  onClose,
  tipo = "movimiento",
  variant = "modern",
  title,
}) {
  const detalle = useMemo(() => getDetalleList(row), [row]);

  const total = useMemo(
    () => detalle.reduce((acc, item) => acc + getMedioMontoVisible(item), 0),
    [detalle]
  );

  const config = {
    venta: {
      icon: faShoppingCart,
      label: "Venta",
      idField: "id_movimiento",
      subtitleField: null,
      emptyMessage: "Esta venta no tiene detalle de medios de pago guardado.",
    },
    compra: {
      icon: faShoppingCart,
      label: "Compra",
      idField: "id_movimiento",
      subtitleField: "proveedor",
      emptyMessage: "Esta compra no tiene detalle de medios de pago guardado.",
    },
    egreso: {
      icon: faArrowRightFromBracket,
      label: "Egreso",
      idField: "id_movimiento",
      subtitleField: "detalle",
      fallbackSubtitleFields: ["descripcion", "concepto"],
      emptyMessage: "Este egreso no tiene detalle de medios de pago guardado.",
    },
    movimiento: {
      icon: faMoneyCheckDollar,
      label: "Movimiento",
      idField: "id_movimiento",
      subtitleField: null,
      emptyMessage:
        "Este movimiento no tiene detalle de medios de pago guardado.",
    },
  };

  const currentConfig = config[tipo] || config.movimiento;

  let subtitleText = "";
  if (currentConfig.subtitleField && row?.[currentConfig.subtitleField]) {
    subtitleText = safeText(row[currentConfig.subtitleField]);
  } else if (currentConfig.fallbackSubtitleFields) {
    for (const field of currentConfig.fallbackSubtitleFields) {
      if (row?.[field] && safeText(row[field]) !== "—") {
        subtitleText = safeText(row[field]);
        break;
      }
    }
  }

  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const modalTitle = title || "Detalle de medios de pago";
  const idValue =
    row?.[currentConfig.idField] ||
    row?.id_movimiento ||
    row?.id_compra ||
    row?.id_egreso;

  return createPortal(
    <div className="mi-modal__overlay" onMouseDown={onClose}>
      <div
        className={`mi-modal__container mdp-container ${
          variant === "simple"  
        }`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          {variant === "modern" && (
            <div className="mi-modal__head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={currentConfig.icon} />
            </div>
          )}

          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">{modalTitle}</h2>
            <div
              className="mi-modal__subtitle"
              style={
                variant === "modern"
                  ? {
                      color: "rgba(255,255,255,0.55)",
                      fontSize: 12,
                      marginTop: 2,
                    }
                  : {}
              }
            >
              {currentConfig.label} #{safeText(idValue)}
              {subtitleText ? ` · ${subtitleText}` : ""}
            </div>
          </div>

          <button
            type="button"
            className="mi-modal__close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="mi-modal__content mdp-content">
          {detalle.length === 0 ? (
            <div
              className="mdp-empty"
              style={
                variant === "simple"
                  ? {
                      minHeight: "auto",
                      padding: "18px 14px",
                    }
                  : {}
              }
            >
              <FontAwesomeIcon
                icon={faMoneyBill}
                style={{ fontSize: 28, opacity: 0.3 }}
              />
              <span>{currentConfig.emptyMessage}</span>
            </div>
          ) : (
            <>
              <div className="mdp-items-grid">
                {detalle.map((item, index) => {
                  const esCheque = !!item?.id_cheque;
                  const key =
                    item?.id_movimiento_medio_pago ||
                    item?.id_compra_medio_pago ||
                    item?.id_egreso_medio_pago ||
                    `${item?.id_medio_pago || "mp"}-${
                      item?.id_cheque || "x"
                    }-${index}`;

                  return esCheque ? (
                    <ChequeDetalle key={key} item={item} />
                  ) : (
                    <MedioGenericoDetalle key={key} item={item} />
                  );
                })}
              </div>

              <div
                className="mdp-total-bar"
                style={
                  variant === "simple"
                    ? {
                        marginTop: 14,
                      }
                    : {}
                }
              >
                <span className="mdp-total-bar__label">Total medios</span>
                <span className="mdp-total-bar__value">{moneyARS(total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ModalDetalleMediosPagoVenta(props) {
  return <ModalDetalleMediosPago {...props} tipo="venta" variant="simple" />;
}

export function ModalDetalleMediosPagoCompra(props) {
  return <ModalDetalleMediosPago {...props} tipo="compra" variant="modern" />;
}

export function ModalDetalleMediosPagoEgreso(props) {
  return <ModalDetalleMediosPago {...props} tipo="egreso" variant="modern" />;
}