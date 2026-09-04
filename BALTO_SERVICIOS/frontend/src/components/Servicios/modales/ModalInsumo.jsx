import React from "react";
import ModalArticulo from "./ModalArticulo";

export default function ModalInsumo(props) {
  return <ModalArticulo {...props} tipo="INSUMO" entidad="insumo" />;
}
