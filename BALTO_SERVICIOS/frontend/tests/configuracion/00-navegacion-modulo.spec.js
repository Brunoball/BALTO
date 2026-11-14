import { registerNavigationSmoke } from '../support/navigation-smoke.js';

// Comprueba rutas y carga de pantallas del modulo, ademas de sus pruebas funcionales.
registerNavigationSmoke([
  "/panel/configuracion",
  "/panel/configuracion/calendario",
  "/panel/configuracion/usuarios",
  "/panel/configuracion/datos-legales",
  "/panel/configuracion/listas-categorias",
  "/panel/configuracion/saldos-iniciales"
]);
