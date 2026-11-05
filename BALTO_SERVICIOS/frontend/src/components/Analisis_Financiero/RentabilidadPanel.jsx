import React, { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxOpen, faBriefcase, faCircleInfo, faScaleBalanced } from "@fortawesome/free-solid-svg-icons";
import { obtenerRentabilidadAnalisisFinanciero } from "./api/analisisFinancieroApi";
import { formatDateISO, moneyARS, toNumberOrZero } from "./utils/analisisFinancieroUtils";

const money = (v) => moneyARS(toNumberOrZero(v));
const pct = (v) => (v == null ? "—" : `${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);
const formatISODate = (iso) => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
const MAX_FILAS = 100;

function Bloque({ icon, titulo, datos }) {
  const ganancia = toNumberOrZero(datos?.ganancia);
  return (
    <article className="af-panel af-rent-block">
      <div className="af-panel__top"><h3><FontAwesomeIcon icon={icon} /> {titulo}</h3><span className="af-chip">{pct(datos?.margen_pct)} margen</span></div>
      <div className="af-rent-lines">
        <div><span>Facturado neto (sin IVA)</span><strong>{money(datos?.facturado_neto)}</strong></div>
        <div><span>Costo estimado</span><strong>{money(datos?.costo)}</strong></div>
        <div className={ganancia < 0 ? "is-negative" : "is-positive"}><span>Ganancia</span><strong>{money(ganancia)}</strong></div>
      </div>
    </article>
  );
}

/**
 * Pestaña "Rentabilidad" del Análisis Financiero (capacidad services.costing).
 * Carga perezosa: sólo consulta cuando la pestaña está activa y cambia el período.
 */
export default function RentabilidadPanel({ dateRange, active, porTipoHabilitado, onError }) {
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const lastKeyRef = useRef("");
  const desde = formatDateISO(dateRange?.from);
  const hasta = formatDateISO(dateRange?.to || dateRange?.from);
  const key = desde ? `${desde}|${hasta}` : "";

  useEffect(() => {
    if (!active || !key || lastKeyRef.current === key) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    obtenerRentabilidadAnalisisFinanciero(dateRange)
      .then((json) => {
        if (cancelled) return;
        lastKeyRef.current = key;
        setState({ loading: false, data: json, error: "" });
      })
      .catch((err) => {
        if (cancelled) return;
        const mensaje = err?.message || "No se pudo calcular la rentabilidad.";
        setState({ loading: false, data: null, error: mensaje });
        onError?.(mensaje);
      });
    return () => { cancelled = true; };
  }, [active, key, dateRange, onError]);

  const data = state.data;
  const trabajos = Array.isArray(data?.trabajos) ? data.trabajos : [];
  const totales = data?.totales || {};
  const porTipo = porTipoHabilitado && data?.por_tipo_habilitado ? data.por_tipo : null;

  return (
    <section className="af-section af-tabPanel" id="af-panel-rentabilidad" role="tabpanel" aria-labelledby="af-tab-rentabilidad" hidden={!active}>
      {state.loading && <div className="af-loading" role="status"><span className="af-loading__bar" />Calculando rentabilidad…</div>}
      {state.error && <div className="af-warning" role="alert">{state.error}</div>}
      {data && (
        <>
          <p className="af-muted af-rent-note">
            <FontAwesomeIcon icon={faCircleInfo} /> Ventas del período por fecha operativa, importes sin IVA y costos estimados al momento de cada venta (materiales, insumos y mano de obra). No es lo cobrado: el resultado de caja está en “Resultados”.
          </p>
          <div className={`af-rent-grid ${porTipo ? "af-rent-grid--three" : ""}`}>
            <Bloque icon={faScaleBalanced} titulo={`Total · ${Number(totales.trabajos || 0).toLocaleString("es-AR")} trabajos`} datos={totales} />
            {porTipo && <Bloque icon={faBriefcase} titulo="Servicios" datos={porTipo.servicios} />}
            {porTipo && <Bloque icon={faBoxOpen} titulo="Productos" datos={porTipo.productos} />}
          </div>
          {Number(totales.renglones_sin_costo || 0) > 0 && (
            <p className="af-muted af-rent-note">{totales.renglones_sin_costo} renglón(es) son detalles manuales sin costo asociado.</p>
          )}

          <article className="af-panel af-rent-tablePanel">
            <div className="af-panel__top"><h3>Costo y ganancia por trabajo</h3><span className="af-chip">{trabajos.length} ventas</span></div>
            {trabajos.length === 0 ? (
              <p className="af-empty">No hay ventas en el período seleccionado.</p>
            ) : (
              <div className="af-rent-tableWrap">
                <table className="af-rent-table">
                  <thead>
                    <tr><th>Fecha</th><th>Venta</th><th>Cliente / concepto</th><th className="is-right">Neto</th><th className="is-right">Costo</th><th className="is-right">Ganancia</th><th className="is-right">Margen</th></tr>
                  </thead>
                  <tbody>
                    {trabajos.slice(0, MAX_FILAS).map((t) => (
                      <tr key={t.id_movimiento}>
                        <td>{formatISODate(t.fecha)}</td>
                        <td>#{t.id_movimiento}</td>
                        <td title={(t.conceptos || []).join(" · ")}><strong>{t.cliente || "CONSUMIDOR FINAL"}</strong><small>{(t.conceptos || []).join(" · ")}</small></td>
                        <td className="is-right">{money(t.facturado_neto)}</td>
                        <td className="is-right">{money(t.costo)}</td>
                        <td className={`is-right ${toNumberOrZero(t.ganancia) < 0 ? "af-negative" : "af-positive"}`}>{money(t.ganancia)}</td>
                        <td className="is-right">{pct(t.margen_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(trabajos.length > MAX_FILAS || data.trabajos_truncados) && (
                  <p className="af-muted af-rent-note">Se muestran las {Math.min(MAX_FILAS, trabajos.length)} ventas más recientes. Acotá el período para ver el resto.</p>
                )}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
