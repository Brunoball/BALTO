import { registerNavigationSmoke } from '../support/navigation-smoke.js';

// Comprueba rutas y carga de pantallas del modulo, ademas de sus pruebas funcionales.
registerNavigationSmoke([
  "/panel/cuentas-corrientes/clientes",
  "/panel/cuentas-corrientes/proveedores"
]);
