import React from "react";
import ModalEliminar from "../../Global/Modales/ModalEliminar";

export default function ModalEliminarStock({
  open,
  title = "Eliminar definitivamente",
  message = "Esta acción no se puede deshacer.",
  warning = "Esta acción borra el registro para siempre.",
  details = [],
  extraContent = null,
  loading = false,
  confirmDisabled = false,
  confirmLabel = "Eliminar definitivamente",
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
      warning={warning}
      loadingMessage={`Eliminando ${entidadLabel}…`}
      successMessage={`${entidadLabel.charAt(0).toUpperCase()}${entidadLabel.slice(1)} eliminado correctamente.`}
      errorMessage={`No se pudo eliminar el ${entidadLabel}.`}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmDisabled={confirmDisabled}
      details={details}
      extraContent={extraContent}
      hideDefaultCard
    />
  );
}
