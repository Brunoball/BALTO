import React from "react";
import ModalEmitirNotaCreditoVenta from "../../Ventas/modales/ModalEmitirNotaCreditoVenta.jsx";

export default function ModalEmitirNotaCreditoIngreso(props) {
  return (
    <ModalEmitirNotaCreditoVenta
      {...props}
      scope="otros_ingresos"
      entityLabel="ingreso"
      entityTitle="Ingreso"
    />
  );
}
