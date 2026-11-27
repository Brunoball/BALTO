export function getStockModalOverlays() {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll('[data-stock-modal-overlay="true"], [data-modal-overlay="true"]')).filter((el) => el?.isConnected);
}

export function isTopStockModal(overlayElement) {
  if (!overlayElement) return true;
  const overlays = getStockModalOverlays();
  return overlays.length === 0 || overlays[overlays.length - 1] === overlayElement;
}

/**
 * Escape dentro de un indicador de rentabilidad editable (ganancia, margen o
 * recargo de ProductPricingPanel) sólo descarta lo escrito ahí: los modales
 * de Stock que escuchan Escape en captura no deben cerrarse por esa tecla.
 */
export function isProfitabilityEditTarget(event) {
  const target = event?.target;
  return typeof Element !== "undefined"
    && target instanceof Element
    && !!target.closest(".ppp-kpi--editable");
}
