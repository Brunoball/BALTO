import { registerNavigationSmoke } from '../support/navigation-smoke.js';

// Comprueba rutas y carga de pantallas del modulo, ademas de sus pruebas funcionales.
registerNavigationSmoke([
  "/panel/cheques/cartera",
  "/panel/cheques/flujo",
  "/panel/cheques/echeqs-cartera",
  "/panel/cheques/flujo-echeqs"
]);
