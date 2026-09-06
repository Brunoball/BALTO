/**
 * Compatibilidad deliberada con suites antiguas de BALTO Comercio.
 *
 * BALTO Servicios no expone códigos de barra, variantes ni el antiguo módulo Stock.
 * Este archivo conserva los nombres exportados para que cualquier spec viejo falle
 * con un diagnóstico explícito en vez de ejecutar requests/rutas incorrectas.
 */
function obsoleteBarcodeFeature() {
  throw new Error(
    'Testing obsoleto de BALTO Comercio: códigos de barra y variantes no pertenecen a BALTO Servicios. '
      + 'Eliminá esa spec y usá 20-services-inventory-lifecycle.spec.js / 25-services-movements-integration.spec.js.',
  );
}

export function barcodeEndpointUrl() {
  return obsoleteBarcodeFeature();
}

export async function barcodeApi() {
  return obsoleteBarcodeFeature();
}

export function expectBarcodeSuccess() {
  return obsoleteBarcodeFeature();
}

export async function getBarcodeProduct() {
  return obsoleteBarcodeFeature();
}

export function uniqueExternalBarcode() {
  return obsoleteBarcodeFeature();
}

export async function simulateBarcodeScan() {
  return obsoleteBarcodeFeature();
}

export async function expectDialogSelectedProduct() {
  return obsoleteBarcodeFeature();
}

export async function createVariantStockProduct() {
  return obsoleteBarcodeFeature();
}

export async function setVariantActiveState() {
  return obsoleteBarcodeFeature();
}
