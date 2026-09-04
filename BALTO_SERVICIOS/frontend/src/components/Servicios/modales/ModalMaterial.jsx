import React from "react";
import ModalArticulo from "./ModalArticulo";

export default function ModalMaterial(props) {
  return <ModalArticulo {...props} tipo="MATERIAL" entidad="material" />;
}
