import { useEffect, useRef } from "react";

const OVERLAY_SELECTOR = [
  "[data-servicios-modal-overlay='true']",
  "[data-modal-overlay='true']",
  ".mvdel-overlay",
  ".mi-modal__overlay",
].join(", ");

let cantidadModalesAbiertos = 0;
let overflowOriginal = "";

function bloquearScroll() {
  if (typeof document === "undefined") return;
  if (cantidadModalesAbiertos === 0) {
    overflowOriginal = document.body.style.overflow;
  }
  cantidadModalesAbiertos += 1;
  document.body.style.overflow = "hidden";
}

function liberarScroll() {
  if (typeof document === "undefined" || cantidadModalesAbiertos === 0) return;
  cantidadModalesAbiertos -= 1;
  if (cantidadModalesAbiertos === 0) {
    document.body.style.overflow = overflowOriginal;
  }
}

function esOverlaySuperior(overlay) {
  if (!overlay || typeof document === "undefined") return false;
  const overlays = Array.from(document.querySelectorAll(OVERLAY_SELECTOR));
  return overlays[overlays.length - 1] === overlay;
}

export default function useServiciosGlobalModal({ open, busy = false, onClose }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    bloquearScroll();

    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || busy) return;
      if (!esOverlaySuperior(overlayRef.current)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      liberarScroll();
    };
  }, [busy, onClose, open]);

  const cerrarDesdeFondo = (event) => {
    if (busy || event.target !== event.currentTarget) return;
    if (!esOverlaySuperior(overlayRef.current)) return;
    onClose?.();
  };

  return { overlayRef, cerrarDesdeFondo };
}
