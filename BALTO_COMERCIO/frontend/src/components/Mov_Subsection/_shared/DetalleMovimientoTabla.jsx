import React, { createContext, useContext, useId, useState } from "react";
import { getDetalleMovimiento, getItemsVisiblesMovimiento, getResumenItemsMovimiento } from "./detalleMovimiento.js";
import "./DetalleMovimientoTabla.css";

const ContextoConceptos = createContext(null);
const texto = (value) => String(value ?? "").trim();
const formatoCantidad = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });
const formatoPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });

function numero(valor) {
  if (valor === null || valor === undefined || texto(valor) === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}
function primerNumero(obj, campos) {
  for (const campo of campos) {
    const n = numero(obj?.[campo]);
    if (n !== null) return n;
  }
  return null;
}
function resumenItem(item) {
  const cantidad = primerNumero(item, ["cantidad", "cant", "cantidad_items"]);
  const precio = primerNumero(item, ["precio", "precio_unitario", "precioUnitario", "valor_unitario", "unitario"]);
  if (cantidad === null && precio === null) return "";
  if (cantidad !== null && precio !== null) return `${formatoCantidad.format(cantidad)} × ${formatoPesos.format(precio)}`;
  if (cantidad !== null) return `${formatoCantidad.format(cantidad)} ${cantidad === 1 ? "unidad" : "unidades"}`;
  return `Precio unitario ${formatoPesos.format(precio)}`;
}
function totalItem(item) {
  const total = primerNumero(item, ["total", "monto_total", "importe_total"]);
  return total === null ? null : formatoPesos.format(total);
}

/** Mantiene la operación original intacta y agrega un renglón independiente debajo al abrir conceptos. */
export function FilaMovimientoExpandible({ movimiento, children }) {
  const [abierto, setAbierto] = useState(false);
  const panelId = useId();
  const items = getItemsVisiblesMovimiento(movimiento);
  const puedeAbrir = items.length > 1;
  const contexto = { abierto: abierto && puedeAbrir, setAbierto, panelId, cantidad: items.length, puedeAbrir };

  return (
    <ContextoConceptos.Provider value={contexto}>
      {children}
      {contexto.abierto && (
        <div className="mov-detalleTabla__filaExpandida" role="row">
          <div className="mov-detalleTabla__panel" role="cell" id={panelId} aria-label="Conceptos de la operación">
            <div className="mov-detalleTabla__panelCabecera">
              <span>CONCEPTOS DEL MOVIMIENTO</span>
              <span className="mov-detalleTabla__contador">{items.length} conceptos</span>
            </div>
            <div className="mov-detalleTabla__items">
              {items.map((item, i) => (
                <div className="mov-detalleTabla__item" key={`${item.id_movimiento_item ?? item.id_item ?? item.id_detalle ?? "item"}-${i}`}>
                  <div className="mov-detalleTabla__itemInfo">
                    <span className="mov-detalleTabla__itemNombre">{item.nombre_visible}</span>
                    {resumenItem(item) && <span className="mov-detalleTabla__aclaracion">{resumenItem(item)}</span>}
                  </div>
                  {totalItem(item) && <span className="mov-detalleTabla__itemTotal">{totalItem(item)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ContextoConceptos.Provider>
  );
}

/** Botón compacto junto al resumen de conceptos, sin añadir una columna o una tercera línea. */
export function ConceptosMovimientoBoton() {
  const contexto = useContext(ContextoConceptos);
  if (!contexto?.puedeAbrir) return null;
  return (
    <button
      className={`mov-detalleTabla__boton${contexto.abierto ? " is-open" : ""}`}
      type="button"
      aria-expanded={contexto.abierto}
      aria-controls={contexto.panelId}
      aria-label={`${contexto.abierto ? "Ocultar" : "Ver"} los ${contexto.cantidad} conceptos del movimiento`}
      onClick={() => contexto.setAbierto((actual) => !actual)}
    >
      <span className="mov-detalleTabla__botonTexto">{contexto.abierto ? "Ocultar" : `Ver (${contexto.cantidad})`}</span>
      <span aria-hidden="true" className="mov-detalleTabla__chevron">{contexto.abierto ? "▴" : "▾"}</span>
    </button>
  );
}

/** Resumen compacto y control integrado en DESCRIPCIÓN; la expansión se dibuja debajo de la fila. */
export default function DetalleMovimientoTabla({ movimiento, tituloEspecial = "" }) {
  const items = getItemsVisiblesMovimiento(movimiento);
  const resumen = getResumenItemsMovimiento(movimiento);
  const descripcion = texto(tituloEspecial) || getDetalleMovimiento(movimiento);
  const varios = items.length > 1;
  const tituloBase = texto(tituloEspecial) || (varios
    ? `${items[0].nombre_visible} + ${items.length - 1} MÁS`
    : (items[0]?.nombre_visible || descripcion || resumen || "SIN DETALLES"));
  const esTiendaNube = Number(movimiento?.origen_tienda_nube ?? 0) === 1 ||
    texto(movimiento?.origen).toUpperCase() === "TIENDA_NUBE";
  const titulo = esTiendaNube ? `${tituloBase} · TIENDA NUBE` : tituloBase;
  const aclaracion = items.length === 1 ? resumenItem(items[0]) : (varios ? resumen : "");

  return (
    <div className="mov-detalleTabla" title={titulo}>
      <span className="mov-detalleTabla__titulo">{titulo}</span>
      {(aclaracion || varios) && (
        <div className="mov-detalleTabla__resumenLinea">
          {aclaracion && <span className="mov-detalleTabla__aclaracion mov-detalleTabla__aclaracion--tabla">{aclaracion}</span>}
          {varios && <ConceptosMovimientoBoton />}
        </div>
      )}
    </div>
  );
}
