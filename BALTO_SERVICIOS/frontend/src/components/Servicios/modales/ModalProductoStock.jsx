import React from "react";
import ModalArticulo from "./ModalArticulo";

export default function ModalProductoStock(props) {
  return <ModalArticulo {...props} tipo="PRODUCTO" entidad="producto" controlaStockFijo />;
}
