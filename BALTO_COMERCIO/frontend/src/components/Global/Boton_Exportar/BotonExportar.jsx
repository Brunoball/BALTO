import React, { useEffect, useRef, useState } from "react";
import "./BotonExportar.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExport,
  faChevronDown,
  faFilePdf,
  faFileExcel,
  faFileCsv,
  faFileWord,
  faFileLines,
  faPrint,
  faImage,
  faDatabase,
  faDownload,
} from "@fortawesome/free-solid-svg-icons";

function getTipoVisual(opcion = {}) {
  const tipo = String(opcion.tipo || opcion.variant || "").toLowerCase();
  const label = String(opcion.label || "").toLowerCase();

  if (tipo.includes("pdf") || label.includes("pdf")) {
    return {
      icon: opcion.icon || faFilePdf,
      tone: "pdf",
    };
  }

  if (
    tipo.includes("excel") ||
    tipo.includes("xlsx") ||
    tipo.includes("xls") ||
    label.includes("excel")
  ) {
    return {
      icon: opcion.icon || faFileExcel,
      tone: "excel",
    };
  }

  if (tipo.includes("csv") || label.includes("csv")) {
    return {
      icon: opcion.icon || faFileCsv,
      tone: "csv",
    };
  }

  if (tipo.includes("word") || tipo.includes("doc") || label.includes("word")) {
    return {
      icon: opcion.icon || faFileWord,
      tone: "word",
    };
  }

  if (tipo.includes("txt") || label.includes("txt") || label.includes("texto")) {
    return {
      icon: opcion.icon || faFileLines,
      tone: "txt",
    };
  }

  if (tipo.includes("print") || tipo.includes("imprimir") || label.includes("imprimir")) {
    return {
      icon: opcion.icon || faPrint,
      tone: "print",
    };
  }

  if (tipo.includes("image") || tipo.includes("png") || tipo.includes("jpg")) {
    return {
      icon: opcion.icon || faImage,
      tone: "image",
    };
  }

  if (tipo.includes("backup") || tipo.includes("db") || label.includes("base")) {
    return {
      icon: opcion.icon || faDatabase,
      tone: "db",
    };
  }

  return {
    icon: opcion.icon || faDownload,
    tone: "default",
  };
}

export default function BotonExportar({
  disabled = false,
  loading = false,
  className = "",
  label = "Exportar",
  title = "Exportar archivo",
  opciones = [],
  align = "right", // right | left
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const opcionesSeguras = Array.isArray(opciones) ? opciones.filter(Boolean) : [];

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }

    function handleEscape(e) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleMainClick = () => {
    if (disabled || loading || opcionesSeguras.length === 0) return;
    setOpen((prev) => !prev);
  };

  const handleOptionClick = async (opcion) => {
    if (!opcion || opcion.disabled || loading) return;

    try {
      await opcion.onClick?.();
    } finally {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className={`boton-exportar-wrap ${className}`.trim()}>
      <button
        type="button"
        className={`boton-exportar-trigger ${open ? "is-open" : ""}`}
        onClick={handleMainClick}
        disabled={disabled || loading || opcionesSeguras.length === 0}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="boton-exportar-trigger__left">
          <span className="boton-exportar-trigger__iconWrap">
            <FontAwesomeIcon icon={faFileExport} />
          </span>
          <span className="boton-exportar-trigger__text">
            {loading ? "Exportando..." : label}
          </span>
        </span>

        <span className="boton-exportar-trigger__right">
          <FontAwesomeIcon icon={faChevronDown} />
        </span>
      </button>

      {open && (
        <div
          className={`boton-exportar-menu boton-exportar-menu--${align}`}
          role="menu"
        >
          <div className="boton-exportar-menu__header">Elegí un formato</div>

          {opcionesSeguras.length === 0 ? (
            <div className="boton-exportar-menu__empty">Sin opciones</div>
          ) : (
            opcionesSeguras.map((opcion, idx) => {
              const visual = getTipoVisual(opcion);

              return (
                <button
                  key={opcion.key || opcion.label || idx}
                  type="button"
                  role="menuitem"
                  className={`boton-exportar-menu__item boton-exportar-menu__item--${visual.tone} ${
                    opcion.danger ? "is-danger" : ""
                  } ${opcion.disabled ? "is-disabled" : ""}`}
                  onClick={() => handleOptionClick(opcion)}
                  disabled={!!opcion.disabled || loading}
                  title={opcion.title || opcion.label}
                >
                  <span
                    className={`boton-exportar-menu__icon boton-exportar-menu__icon--${visual.tone}`}
                  >
                    {typeof visual.icon === "string" ? (
                      visual.icon
                    ) : (
                      <FontAwesomeIcon icon={visual.icon} />
                    )}
                  </span>

                  <span className="boton-exportar-menu__content">
                    <span className="boton-exportar-menu__label">
                      {opcion.label || "Opción"}
                    </span>

                    {opcion.description && (
                      <span className="boton-exportar-menu__desc">
                        {opcion.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}