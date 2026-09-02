import React, { useEffect } from "react";
import "./Toast.css";

export default function Toast({ tipo = "info", mensaje = "", duracion = 3200, onClose }) {
  useEffect(() => {
    const id = setTimeout(() => onClose?.(), duracion);
    return () => clearTimeout(id);
  }, [duracion, onClose]);

  return (
    <div className={`balto-toast balto-toast--${tipo}`} role="status" aria-live="polite">
      <span>{mensaje}</span>
      <button type="button" onClick={() => onClose?.()} aria-label="Cerrar">×</button>
    </div>
  );
}
