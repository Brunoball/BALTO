import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faTrashCan, faArrowRightFromBracket } from "@fortawesome/free-solid-svg-icons";
import "../../Global/Global_css/Global_Section.css";
import "./VencimientosTabla.css";

const cantidadTexto = (value) => Number(String(value ?? 0).replace(",", ".") || 0)
  .toLocaleString("es-AR", { maximumFractionDigits: 3 });

export const fechaVencimientoTexto = (fecha) => {
  const match = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—";
};

function diasParaFecha(fecha) {
  const match = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return NaN;
  const hoy = new Date();
  const hoyUTC = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const vencimientoUTC = Date.UTC(+match[1], +match[2] - 1, +match[3]);
  return Math.round((vencimientoUTC - hoyUTC) / 86400000);
}

/** Tabla visual de BALTO con div/role=table y clases mov-grid* globales.
 * Se comparte entre las partidas pendientes de Nuevo producto y las registradas de Editar producto.
 */
export default function VencimientosTabla({ partidas = [], esAlta = false, disabled = false, onEditar, onQuitar, onRetirar }) {
  return (
    <div className="sv-gridScroll" role="region" aria-label="Listado de vencimientos" tabIndex={0}>
      <div className="sv-gridTable" role="table" aria-label="Partidas con vencimiento">
        <div className="sv-gridHeadGroup" role="rowgroup">
          <div className="mov-gridTable mov-gridTable--head sv-gridRow sv-gridHeader" role="row">
          <div className="mov-gridCell mov-gridCell--head" role="columnheader">Vencimiento</div>
          <div className="mov-gridCell mov-gridCell--head is-right" role="columnheader">{esAlta ? "Cantidad" : "Cantidad restante"}</div>
          <div className="mov-gridCell mov-gridCell--head" role="columnheader">Referencia</div>
          <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Estado</div>
          <div className="mov-gridCell mov-gridCell--head is-center" role="columnheader">Acciones</div>
          </div>
        </div>
        <div className="sv-gridBody" role="rowgroup">
          {partidas.map((partida, index) => {
            const dias = partida.dias_restantes === undefined || partida.dias_restantes === null
              ? diasParaFecha(partida.fecha_vencimiento)
              : Number(partida.dias_restantes);
            const cantidad = esAlta ? partida.cantidad : partida.cantidad_disponible;
            const sinUnidades = Number(String(cantidad ?? 0).replace(",", ".")) <= 0;
            const estado = sinUnidades ? "Sin unidades" : dias < 0 ? "Vencido" : dias <= 7 ? `Vence en ${dias} días` : "Vigente";
            const fecha = fechaVencimientoTexto(partida.fecha_vencimiento);
            const etiqueta = esAlta ? `partida ${index + 1}` : `partida del ${fecha}`;
            return (
              <div className="mov-gridTable mov-gridTable--row sv-gridRow sv-gridDataRow" role="row" key={esAlta ? index : partida.id_vencimiento}>
                <div className="mov-gridCell sv-gridCell" role="cell" data-label="Vencimiento" title={fecha}><span className="sv-gridText">{fecha}</span></div>
                <div className="mov-gridCell is-right sv-gridCell sv-gridCell--quantity" role="cell" data-label={esAlta ? "Cantidad" : "Cantidad restante"}><span className="sv-gridText">{cantidadTexto(cantidad)}</span></div>
                <div className="mov-gridCell sv-gridCell" role="cell" data-label="Referencia" title={partida.referencia || "Sin referencia"}><span className="sv-gridText">{partida.referencia || "—"}</span></div>
                <div className="mov-gridCell is-center sv-gridCell sv-gridCell--status" role="cell" data-label="Estado"><span className={`sv-state ${sinUnidades ? "sv-state--empty" : dias < 0 ? "sv-expired" : dias <= 7 ? "sv-soon" : ""}`}>{estado}</span></div>
                <div className="mov-gridCell mov-gridCell--actions sv-gridCell sv-gridCell--actions" role="cell" data-label="Acciones">
                  <div className="sv-table__buttons">
                    <button className="mov-iconBtn" type="button" title="Editar vencimiento" aria-label={`Editar ${etiqueta}`} disabled={disabled} onClick={() => onEditar?.(partida, index)}><FontAwesomeIcon icon={faPen}/></button>
                    <button className="mov-iconBtn mov-iconBtn--danger" type="button" title={esAlta ? "Quitar partida" : "Quitar fecha (no descuenta stock)"} aria-label={`Quitar ${etiqueta}`} disabled={disabled} onClick={() => onQuitar?.(partida, index)}><FontAwesomeIcon icon={faTrashCan}/></button>
                    {!esAlta && Number(partida.cantidad_disponible) > 0 && (
                      <button className="mov-iconBtn mov-iconBtn--danger" type="button" title="Retirar unidades del inventario" aria-label={`Retirar stock de ${etiqueta}`} disabled={disabled} onClick={() => onRetirar?.(partida, index)}><FontAwesomeIcon icon={faArrowRightFromBracket}/></button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
