import React from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faBoxOpen, faPenToSquare, faPlus, faRotateLeft, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import useTableScrollGutter from "../../Global/useTableScrollGutter.jsx";
import useServiciosGlobalModal from "./useServiciosGlobalModal";

const CATEGORY_GRID_COLUMNS = "minmax(240px, 1fr) 110px 110px 140px";

export default function ModalCategorias({
  open,
  titulo,
  categorias,
  getId,
  getCount,
  saving,
  onClose,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
  nota,
}) {
  const { overlayRef, cerrarDesdeFondo } = useServiciosGlobalModal({
    open,
    busy: saving,
    onClose,
  });
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="gm-modal-overlay servicios-modal-backdrop--above"
      data-servicios-modal-overlay="true"
      onMouseDown={cerrarDesdeFondo}
    >
      <div
        className="gm-modal-container gm-modal-v2 servicios-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="servicios-categories-modal-title"
      >
        <header className="gm-modal-header">
          <div className="gm-modal-head-left">
            <h2 className="gm-modal-title" id="servicios-categories-modal-title">{titulo}</h2>
            <p className="gm-modal-subtitle">Creá, editá y administrá las categorías disponibles.</p>
          </div>
          <button type="button" className="gm-modal-close" onClick={onClose} disabled={saving} aria-label="Cerrar">✕</button>
        </header>

        <div className="gm-modal-content servicios-modal__content">
          <div className="gm-view-footer-actions">
            <button
              type="button"
              className="gm-action-btn gm-action-btn--save"
              onClick={onAdd}
              disabled={saving}
            >
              <FontAwesomeIcon icon={faPlus} /> Nueva categoría
            </button>
          </div>

          <div className="mov-page" role="table" aria-label={titulo}>
            <div
              className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`}
              style={{ gridTemplateColumns: CATEGORY_GRID_COLUMNS }}
              role="row"
            >
              <div className="mov-gridCell mov-gridCell--head" role="columnheader">Categoría</div>
              <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Registros</div>
              <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Estado</div>
              <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Acciones</div>
            </div>

            <div className="mov-tableWrap servicios-category-tableWrap" role="rowgroup" ref={tableWrapRef}>
              <div className="mov-gridBody mov-gridBody--relative">
                {categorias.length === 0 ? (
                  <div className="cc-emptyState servicios-emptyState">
                    <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                    <div className="cc-emptyText">NO HAY CATEGORÍAS.</div>
                  </div>
                ) : (
                  categorias.map((categoria) => {
                    const id = getId(categoria);
                    const activo = Number(categoria.activo) === 1;
                    return (
                      <div className="mov-gridTable mov-gridTable--row" style={{ gridTemplateColumns: CATEGORY_GRID_COLUMNS }} key={id} role="row">
                        <div className="mov-gridCell is-strong" role="cell" data-label="Categoría">
                          <div className="servicios-category-detail">
                            <span className="mov-ellipsissss">{categoria.nombre}</span>
                            <small>{categoria.descripcion || "SIN DESCRIPCIÓN"}</small>
                          </div>
                        </div>
                        <div className="mov-gridCell is-center" role="cell" data-label="Registros">
                          <span className="mov-ellipsissss">{getCount(categoria)}</span>
                        </div>
                        <div className="mov-gridCell is-center" role="cell" data-label="Estado">
                          <span className={`mov-chip ${activo ? "mov-chip--ok" : "mov-chip--neutral"}`}>
                            {activo ? "ACTIVA" : "BAJA"}
                          </span>
                        </div>
                        <div className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label="Acciones">
                          <div className="mov-actionsInline">
                            <button type="button" className="mov-iconBtn" title="Editar" aria-label="Editar" disabled={saving} onClick={() => onEdit?.(categoria)}>
                              <FontAwesomeIcon icon={faPenToSquare} />
                            </button>
                            <button type="button" className="mov-iconBtn" title={activo ? "Dar de baja" : "Reactivar"} aria-label={activo ? "Dar de baja" : "Reactivar"} disabled={saving} onClick={() => onToggle(categoria)}>
                              <FontAwesomeIcon icon={activo ? faBan : faRotateLeft} />
                            </button>
                            <button type="button" className="mov-iconBtn mov-iconBtn--danger" title="Eliminar" aria-label="Eliminar" disabled={saving} onClick={() => onDelete(categoria)}>
                              <FontAwesomeIcon icon={faTrashCan} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="gm-info-box">
            {nota || "Al eliminar una categoría, los registros asociados quedan sin categoría. Antes de borrar se mostrará una advertencia con el impacto de la acción."}
          </div>
        </div>

        <footer className="gm-modal-footer gm-view-footer-actions">
          <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onClose} disabled={saving}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
