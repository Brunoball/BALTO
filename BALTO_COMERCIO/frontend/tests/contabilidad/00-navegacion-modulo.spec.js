import { registerNavigationSmoke } from '../support/navigation-smoke.js';

// Comprueba rutas y carga de pantallas del modulo, ademas de sus pruebas funcionales.
registerNavigationSmoke([
  "/panel/contabilidad",
  "/panel/contabilidad/iva-ventas",
  "/panel/contabilidad/iva-compras"
]);
