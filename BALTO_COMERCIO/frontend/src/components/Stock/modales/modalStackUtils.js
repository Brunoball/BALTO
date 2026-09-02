export function getStockModalOverlays() {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll('[data-stock-modal-overlay="true"], [data-modal-overlay="true"]')).filter((el) => el?.isConnected);
}

export function isTopStockModal(overlayElement) {
  if (!overlayElement) return true;
  const overlays = getStockModalOverlays();
  return overlays.length === 0 || overlays[overlays.length - 1] === overlayElement;
}
