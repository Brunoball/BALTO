const ROUTE_PREFETCH = {
  "/panel/movimientos": () => import("../../Movimientos/Movimientos"),
  "/panel/ventas": () => import("../../Mov_Subsection/Ventas/Ventas"),
  "/panel/documentos_comerciales": () =>
    import("../../Mov_Subsection/Documentos_Comerciales/Presupuestos"),
  "/panel/presupuesto": () =>
    import("../../Mov_Subsection/Documentos_Comerciales/Presupuestos"),
  "/panel/compras": () => import("../../Mov_Subsection/Compra/Compras"),
  "/panel/recibos": () => import("../../Mov_Subsection/Recibos/Recibos"),
  "/panel/OrdenesPago": () =>
    import("../../Mov_Subsection/OrdenesPago/OrdenesPago"),
  "/panel/flujo-de-caja": () => import("../../Flujo_de_Caja/Flujo_Caja"),
  "/panel/cuentas-corrientes": () =>
    import("../../Cuentas_Corrientes/Clientes/Clientes"),
  "/panel/cuentas-corrientes/clientes": () =>
    import("../../Cuentas_Corrientes/Clientes/Clientes"),
  "/panel/cuentas-corrientes/proveedores": () =>
    import("../../Cuentas_Corrientes/Proveedores/Proveedores"),
  "/panel/servicios": () => import("../../Servicios/Servicios"),
  "/panel/contabilidad": () =>
    import("../../Contabilidad/IVA_Ventas/IVA_Ventas"),
  "/panel/contabilidad/iva-compras": () =>
    import("../../Contabilidad/IVA_Compras/IVA_Compras"),
  "/panel/contabilidad/iva-ventas": () =>
    import("../../Contabilidad/IVA_Ventas/IVA_Ventas"),
  "/panel/analisis-financiero": () =>
    import("../../Analisis_Financiero/Analisis_Financiero"),
  "/panel/configuracion": () => import("../../Configuracion/Configuracion"),
  "/panel/configuracion/calendario": () =>
    import("../../Configuracion/ConfiguracionCalendario/ConfiguracionCalendario"),
  "/panel/configuracion/usuarios": () =>
    import("../../Configuracion/ConfiguracionUsuarios/ConfiguracionUsuarios"),
  "/panel/configuracion/datos-legales": () =>
    import("../../Configuracion/ConfiguracionDatosLegales/ConfiguracionDatosLegales"),
  "/panel/configuracion/saldos-iniciales": () =>
    import("../../Configuracion/ConfiguracionSaldosIniciales/ConfiguracionSaldosIniciales"),
  "/panel/configuracion/listas-categorias": () =>
    import("../../Configuracion/ConfiguracionListasCategorias/ConfiguracionListasCategorias"),
  "/panel/cheques": () =>
    import("../../Cheques/Cheques_Cartera/Cheques_Cartera"),
  "/panel/cheques/cartera": () =>
    import("../../Cheques/Cheques_Cartera/Cheques_Cartera"),
  "/panel/cheques/flujo": () =>
    import("../../Cheques/Flujo_Cheques/Flujo_Cheques"),
  "/panel/cheques/echeqs-cartera": () =>
    import("../../Cheques/Echeqs_Cartera/Echeqs_Cartera"),
  "/panel/cheques/flujo-echeqs": () =>
    import("../../Cheques/Flujo_Echeqs/Flujo_Echeqs"),
};

export function prefetchRoute(ruta) {
  try {
    const routeKey = String(ruta || "").split(/[?#]/)[0];
    const fn = ROUTE_PREFETCH[routeKey];
    if (fn) fn();
  } catch {}
}
