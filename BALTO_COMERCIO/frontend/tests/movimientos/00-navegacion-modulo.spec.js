import { registerNavigationSmoke } from '../support/navigation-smoke.js';

// Comprueba rutas y carga de pantallas del modulo, ademas de sus pruebas funcionales.
registerNavigationSmoke([
  "/panel/movimientos",
  "/panel/ventas",
  "/panel/compras",
  "/panel/recibos",
  "/panel/OrdenesPago",
  "/panel/Otrosingresos",
  "/panel/Otrosegresos",
  "/panel/documentos_comerciales",
  "/panel/presupuesto",
  "/panel/facturacion",
  "/panel/remitos"
]);
