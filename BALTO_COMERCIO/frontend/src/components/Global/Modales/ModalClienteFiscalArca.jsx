import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBuilding,
  faCheckCircle,
  faIdCard,
  faMagnifyingGlass,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import "../Global_css/Global_Modals.css";
import "../Global_css/roots.css";
import "./ModalClienteFiscalArca.css";

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeCuitInput(value) {
  return onlyDigits(value).slice(0, 11);
}

function safeText(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

/**
 * Modal global para consultar CUIT en ARCA y confirmar datos fiscales.
 *
 * Se puede reutilizar en Ventas, Compras, Recibos, Clientes, Facturación, etc.
 * La lógica de consulta/guardado queda afuera para que cada sección decida qué endpoint usar.
 */
export default function ModalClienteFiscalArca({
  open,
  dark = false,
  title = "Datos fiscales del cliente",
  infoTitle = "Consulta por CUIT",
  description = null,
  cuit = "",
  fiscalData = null,
  error = "",
  loading = false,
  saving = false,
  lookupText = "Consultar ARCA",
  searchingText = "Consultando ARCA...",
  confirmText = "Confirmar",
  footerHelp = "",
  requireFiscalData = false,
  permitirConsumidorFinal = false,
  onConfirmarConsumidorFinal,
  onCuitChange,
  onLookup,
  onClose,
  onConfirm,
}) {
  const inputRef = useRef(null);
  const [modo, setModo] = useState("cuit");
  const esConsumidorFinal = permitirConsumidorFinal && modo === "consumidor_final";
  const busy = loading || saving;
  const cleanCuit = normalizeCuitInput(cuit);
  const cuitOk = cleanCuit.length === 11;
  const canConfirm = !busy && (esConsumidorFinal ? !!onConfirmarConsumidorFinal : cuitOk && (!requireFiscalData || !!fiscalData));
  const confirmar = () => esConsumidorFinal ? onConfirmarConsumidorFinal?.() : onConfirm?.();

  const helperText = useMemo(() => {
    if (footerHelp) return footerHelp;
    if (requireFiscalData) {
      return "Primero buscá el CUIT. Cuando aparezcan los datos, confirmá para guardar el cliente y sus datos fiscales.";
    }
    return "Ingresá el CUIT, consultá ARCA y confirmá para continuar.";
  }, [footerHelp, requireFiscalData]);

  useEffect(() => {
    if (open) setModo("cuit");
  }, [open]);

  useEffect(() => {
    if (!open || esConsumidorFinal) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, esConsumidorFinal]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose?.();
        return;
      }

      if (event.key === "Enter" && !busy) {
        event.preventDefault();
        if (canConfirm) {
          confirmar();
        } else if (!esConsumidorFinal && cuitOk) {
          onLookup?.();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, canConfirm, cuitOk, esConsumidorFinal, onClose, onConfirm, onConfirmarConsumidorFinal, onLookup]);

  if (!open) return null;

  return createPortal(
    <div className={["mi-modal__overlay", "gcf-modal__overlay", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}>
      <div
        className={["mi-modal__container", "gcf-modal", dark ? "mi-modal--dark" : ""].join(" ").trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mi-modal__header gcf-modal__head">
          <div className="mi-modal__head-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faIdCard} />
          </div>
          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title gcf-modal__title">{title}</h2>
          </div>
          <button
            type="button"
            className="mi-modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mi-modal__content gcf-modal__content">
          <div className="gcf-modal__layout">
            <section className="gcf-client-card" aria-label="Tarjeta del cliente">
              <div className="gcf-client-card__top">
                <div className="gcf-client-card__avatar" aria-hidden="true">
                  <FontAwesomeIcon icon={esConsumidorFinal || fiscalData ? faBuilding : faUser} />
                </div>
                <div className="gcf-client-card__heading">
                  <span className="gcf-client-card__eyebrow">Cliente fiscal</span>
                  <h3>{esConsumidorFinal ? "A CONSUMIDOR FINAL" : fiscalData ? safeText(fiscalData.razon_social) : infoTitle}</h3>
                </div>
              </div>

              {esConsumidorFinal ? (
                <div className="gcf-client-empty">
                  <div className="gcf-client-empty__icon"><FontAwesomeIcon icon={faCheckCircle} /></div>
                  <div><b>Sin identificación fiscal</b><span>Documento 99 / número 0. No se consultará el padrón ni se modificarán los datos del cliente de BALTO.</span></div>
                </div>
              ) : fiscalData ? (
                <>
                  <div className="gcf-client-card__status gcf-client-card__status--success">
                    <FontAwesomeIcon icon={faCheckCircle} />
                    Datos encontrados y listos para confirmar
                  </div>

                  <div className="gcf-client-data">
                    <div className="gcf-data-chip">
                      <span>CUIT</span>
                      <b>{safeText(fiscalData.cuit || cleanCuit)}</b>
                    </div>
                    <div className="gcf-data-chip">
                      <span>IVA</span>
                      <b>{safeText(fiscalData.condicion_iva || fiscalData.iva)}</b>
                    </div>
                    <div className="gcf-data-row gcf-data-row--full">
                      <span>Razón social</span>
                      <b>{safeText(fiscalData.razon_social)}</b>
                    </div>
                    <div className="gcf-data-row gcf-data-row--full">
                      <span>Domicilio</span>
                      <b>{safeText(fiscalData.domicilio)}</b>
                    </div>
                  </div>
                </>
              ) : (
                <div className="gcf-client-empty">
                  <div className="gcf-client-empty__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                  </div>
                  <div>
                    <b>Esperando consulta</b>
                    <span>Ingresá el CUIT en el panel derecho para traer los datos fiscales desde ARCA.</span>
                  </div>
                </div>
              )}
            </section>

            <aside className="nc-aside gcf-side-panel" aria-label="Consulta de CUIT">
              {permitirConsumidorFinal && (
                <div className="gcf-modo-emision" role="group" aria-label="Modo de facturación">
                  <label><input type="radio" name="gcf-modo-emision" checked={!esConsumidorFinal} onChange={() => setModo("cuit")} disabled={busy} /> Facturar con CUIT</label>
                  <label><input type="radio" name="gcf-modo-emision" checked={esConsumidorFinal} onChange={() => setModo("consumidor_final")} disabled={busy} /> Consumidor final sin identificar</label>
                </div>
              )}
              {esConsumidorFinal ? (
                <div className="gcf-alert gcf-final-info" role="status">
                  <b>Consumidor final sin CUIT</b>
                  <span>Disponible para operaciones inferiores a $10.000.000. Usá esta opción únicamente si el comprador real es consumidor final y no necesita identificarse.</span>
                </div>
              ) : <section className="nc-section gcf-panel-section">
                <div className="nc-section-head">
                  <span className="nc-section-dot" />
                  <span>Consulta ARCA</span>
                </div>

                <div className="nc-section-body gcf-panel-section__body">
                  <div className="gcf-panel-intro">
                    <b>{infoTitle}</b>
                    <span>Completá el CUIT para consultar y luego confirmar los datos.</span>
                  </div>

                  <div className="fl-field gcf-modal__field">
                    <input
                      ref={inputRef}
                      className="fl-input"
                      placeholder=" "
                      value={cleanCuit}
                      onChange={(event) => onCuitChange?.(normalizeCuitInput(event.target.value))}
                      disabled={busy}
                      autoComplete="off"
                      inputMode="numeric"
                    />
                    <label className="fl-label">
                      <FontAwesomeIcon icon={faIdCard} className="gcf-modal__label-icon" />
                      CUIT *
                    </label>
                  </div>

                  <button
                    type="button"
                    className="mit-btn mit-btn--ghost gcf-modal__lookup-btn"
                    onClick={onLookup}
                    disabled={busy || !cuitOk}
                  >
                    <FontAwesomeIcon icon={faMagnifyingGlass} className="gcf-modal__btn-icon" />
                    {loading ? searchingText : lookupText}
                  </button>
                </div>
              </section>}

              {error && (
                <div className="gcf-alert gcf-alert--error" role="alert">
                  {error}
                </div>
              )}

              {!esConsumidorFinal && helperText && <div className="gcf-modal__help">{helperText}</div>}

              <div className="gcf-modal__actions">
                <button type="button" className="mit-btn mit-btn--ghost" onClick={onClose} disabled={busy}>
                  Cancelar
                </button>
                <button type="button" className="mit-btn mit-btn--solid" onClick={confirmar} disabled={!canConfirm}>
                  {saving ? "Procesando..." : esConsumidorFinal ? "Continuar sin CUIT" : confirmText}
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
