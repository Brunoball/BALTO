import React from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/roots.css";

export default function ModalEliminarVenta({
  open,
  row,
  loading = false,
  onClose,
  onConfirm,
  onEmitNotaCredito,
}) {
  if (!open) return null;

  const requiereNC =
    Number(row?.factura_emitida_en_arca || 0) === 1 &&
    Number(row?.factura_tiene_nota_credito || 0) !== 1;

  const yaTieneNC =
    Number(row?.factura_emitida_en_arca || 0) === 1 &&
    Number(row?.factura_tiene_nota_credito || 0) === 1;

  return createPortal(
    <div onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        
        <div>
          <h3>Eliminar venta</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            ×
          </button>
        </div>

        <div>
          {requiereNC ? (
            <>
              <p>
                Este registro tiene asociado una <b>factura emitida en ARCA</b>.
              </p>
              <p>
                Antes de eliminar se necesita crear una <b>nota de crédito</b>.
              </p>
              <div>
                Venta #{row?.id_movimiento ?? "—"} · Cliente: {row?.cliente || "—"}
              </div>
            </>
          ) : yaTieneNC ? (
            <>
              <p>
                Esta venta tiene una <b>factura ARCA</b> y ya posee una{" "}
                <b>nota de crédito asociada</b>.
              </p>
              <p>
                Ahora sí podés eliminar el registro.
              </p>
            </>
          ) : (
            <p>
              ¿Seguro que querés eliminar esta venta?
            </p>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
          >
            Cancelar
          </button>

          {requiereNC ? (
            <button
              type="button"
              onClick={onEmitNotaCredito}
              disabled={loading}
            >
              Emitir nota de crédito
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? "Eliminando..." : "Eliminar"}
            </button>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
