import React from "react";
import ModalEliminar from "../../Global/Modales/ModalEliminar";

export default function ModalDarBajaStock({
  open,
  title = "Dar de baja",
  message = "El registro se ocultará de la lista principal.",
  details = [],
  loading = false,
  confirmLabel = "Dar de baja",
  cancelLabel = "Cancelar",
  entidadLabel = "registro",
  onClose,
  onConfirm,
  onToast,
}) {
  return (
    <ModalEliminar
      open={open}
      row={null}
      loading={loading}
      onClose={onClose}
      onConfirm={onConfirm}
      onToast={onToast}
      title={title}
      message={message}
      warning={`Esta acción no elimina información: solo oculta el ${entidadLabel} y permite volver a activarlo más adelante.`}
      loadingMessage={`Dando de baja ${entidadLabel}…`}
      loadingLabel="Dando de baja..."
      successMessage={`${entidadLabel.charAt(0).toUpperCase()}${entidadLabel.slice(1)} dado de baja correctamente.`}
      errorMessage={`No se pudo dar de baja el ${entidadLabel}.`}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmVariant="primary"
      visualVariant="deactivate"
      details={details}
      hideDefaultCard={false}
    />
  );
}
