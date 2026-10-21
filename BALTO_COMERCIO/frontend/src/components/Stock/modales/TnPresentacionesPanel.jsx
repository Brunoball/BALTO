import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxOpen,
  faBoxesStacked,
  faCheck,
  faCircleExclamation,
  faCircleInfo,
  faCloudArrowUp,
  faCubesStacked,
  faFloppyDisk,
  faLayerGroup,
} from "@fortawesome/free-solid-svg-icons";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import { consultarPresentacionesTnStock, guardarPresentacionTnStock } from "../api/stockApi";
import "./TnPresentacionesPanel.css";

const numero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: 3 }) : "—";
};
const valorInput = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
};
const varianteNombre = (row, id) => id ? row.nombre_variante || `Variante #${id}` : "Producto original";
const nombreUnidad = (row) => row.unidad || "u";

/** Pantalla compartida por Nuevo producto (vista previa) y Editar producto (persistencia). */
export default function TnPresentacionesPanel({ productoId, onToast, preview = null }) {
  const enAlta = !productoId;
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState({});
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(null);
  const [confirmacion, setConfirmacion] = useState(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const cargar = useCallback(async () => {
    if (!productoId) return;
    setLoading(true);
    setError("");
    try {
      const data = await consultarPresentacionesTnStock(productoId);
      const lista = Array.isArray(data?.presentaciones) ? data.presentaciones : [];
      setRows(lista);
      setEdit(Object.fromEntries(lista.map((row) => [String(row.id_stock_variante || 0), valorInput(row.cantidad_local_por_unidad_tn ?? 1)])));
    } catch (e) {
      setError(e?.message || "No se pudieron consultar las presentaciones.");
    } finally {
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const filasAlta = useMemo(() => {
    if (!enAlta) return [];
    const variantes = preview?.tiene_variantes ? (preview?.variantes || []).filter(v =>
      String(v.nombre_variante || v.sku || "").trim() ||
      (v.atributos || []).some(a => String(a.atributo || a.valor || "").trim())
    ) : [];
    return preview?.tiene_variantes
      ? variantes.map((v, i) => ({ id: `nueva-${i}`, nombre: v.nombre_variante || `Variante ${i + 1}`, stock: v.stock, unidad: v.unidad || preview?.unidad || "u" }))
      : [{ id: "nuevo-producto", nombre: preview?.nombre || "Producto original", stock: preview?.stock, unidad: preview?.unidad || "u" }];
  }, [enAlta, preview]);

  const validarCantidad = (key) => {
    const bruto = String(edit[key] ?? "").replace(",", ".").trim();
    const cantidad = Number(bruto);
    if (!/^[0-9]+(?:\.[0-9]{1,3})?$/.test(bruto) || !Number.isFinite(cantidad) || cantidad < 0.001 || cantidad > 1000000) {
      setError("Ingresá una equivalencia mayor a cero, con hasta tres decimales.");
      return null;
    }
    return cantidad;
  };

  const solicitarGuardar = (row) => {
    const variante = Number(row.id_stock_variante || 0);
    const key = String(variante);
    const cantidad = validarCantidad(key);
    if (cantidad === null) return;
    setError("");
    setMensaje("");
    setConfirmacion({ variante, cantidad, nombre: varianteNombre(row, variante), unidad: nombreUnidad(row) });
  };

  const confirmarGuardar = async () => {
    if (!confirmacion || guardando !== null) return;
    const { variante, cantidad } = confirmacion;
    const key = String(variante);
    setGuardando(key);
    setError("");
    try {
      const res = await guardarPresentacionTnStock({ id_stock_producto: productoId, id_stock_variante: variante, cantidad_local: cantidad });
      const sync = res?.tiendanube_sync;
      const aviso = Number(sync?.errores || 0) > 0 || Number(sync?.saltados || 0) > 0
        ? "Equivalencia guardada. Revisá la conexión y sincronización pendiente con Tienda Nube."
        : "Equivalencia guardada. Se solicitó la actualización en Tienda Nube.";
      setConfirmacion(null);
      setMensaje(aviso);
      onToast?.(aviso, "exito");
      // No reportar el guardado como fallido si solo falló la actualización visual.
      try { await cargar(); } catch (_err) { /* cargar muestra su propio error */ }
    } catch (e) {
      const aviso = e?.message || "No se pudo guardar la equivalencia.";
      setError(aviso);
      throw e;
    } finally {
      setGuardando(null);
    }
  };

  const cantidadTotal = rows.reduce((total, row) => total + (Number(row.stock) || 0), 0);
  const cantidadPublicable = rows.reduce((total, row) => total + (Number(row.stock_publicable_tn) || 0), 0);

  return (
    <section className="tnp-panel" aria-label="Presentaciones de Tienda Nube">
      <header className="tnp-head">
        <div className="tnp-head__text">
          <div className="tnp-head__title">
            <h3>Presentaciones de Tienda Nube</h3>
            <span className="tnp-help">
              <button type="button" className="tnp-help__button" aria-label="¿Cómo se calcula la equivalencia?" aria-describedby="tnp-help-calculo">
                <FontAwesomeIcon icon={faCircleInfo} />
              </button>
              <span className="tnp-help__tooltip" id="tnp-help-calculo" role="tooltip">
                <strong>¿Cómo se calcula?</strong>
                <span>Si vendés un paquete de 500 g y controlás el stock en kg, la equivalencia es <strong>0,5 kg por unidad TN</strong>. Solo se publican paquetes completos; el sobrante permanece en Balto.</span>
              </span>
            </span>
          </div>
          <p>Definí cuánto stock real de Balto representa <strong>una unidad vendida</strong> en Tienda Nube.</p>
        </div>
      </header>

      <div className="tnp-layout">
        <div className="tnp-layout__main">
      {enAlta ? (
        <>
          <div className="tnp-section-title"><h4>Presentaciones del producto</h4><span className="tnp-count">{filasAlta.length}</span></div>
          <div className="tnp-list">
            {filasAlta.length ? filasAlta.map((row) => <article key={row.id} className={`tnp-item tnp-item--preview${preview?.tiene_variantes ? " tnp-item--variant-preview" : " tnp-item--original"}`}>
              <div className="tnp-item__identity">
                <span className="tnp-item__icon"><FontAwesomeIcon icon={preview?.tiene_variantes ? faCubesStacked : faBoxOpen} /></span>
                <div><strong title={row.nombre}>{row.nombre}</strong><span>Stock inicial: {numero(row.stock)} {row.unidad}</span></div>
              </div>
              <span className="tnp-pill"><FontAwesomeIcon icon={faCheck} /> Equivalencia inicial 1:1</span>
            </article>) : <div className="tnp-empty">Agregá una variante desde la pestaña Variantes para visualizarla aquí.</div>}
          </div>
          <div className="tnp-notice" role="note"><FontAwesomeIcon icon={faCircleExclamation} /> Primero guardá el producto para asignarle un ID. Luego, desde <strong>Editar producto → Tienda Nube</strong>, podrás configurar y guardar las equivalencias reales.</div>
        </>
      ) : (
        <>
          {error && <div className="tnp-feedback tnp-feedback--error" role="alert"><FontAwesomeIcon icon={faCircleExclamation} />{error}</div>}
          {mensaje && <div className="tnp-feedback tnp-feedback--success" role="status"><FontAwesomeIcon icon={faCheck} />{mensaje}</div>}
          <div className="tnp-section-title"><h4>Equivalencias por presentación</h4><span className="tnp-count">{loading ? "…" : rows.length}</span></div>
          {loading ? <div className="tnp-loading" role="status" aria-live="polite"><div /><div /><div /></div> : (
            <div className="tnp-list">
              {rows.length ? rows.map((row) => {
                const id = Number(row.id_stock_variante || 0);
                const key = String(id);
                const unidad = nombreUnidad(row);
                const valor = edit[key] ?? "1";
                const modificado = Number(String(valor).replace(",", ".")) !== Number(row.cantidad_local_por_unidad_tn ?? 1);
                return <article key={key} className={`tnp-item${id ? "" : " tnp-item--original"}`}>
                  <div className="tnp-item__top">
                    <div className="tnp-item__identity">
                      <span className="tnp-item__icon"><FontAwesomeIcon icon={id ? faCubesStacked : faBoxOpen} /></span>
                      <div><strong title={varianteNombre(row, id)}>{varianteNombre(row, id)}</strong><span>{id ? "Variante" : "Producto simple"}</span></div>
                    </div>
                    <span className={`tnp-pill ${modificado ? "tnp-pill--pending" : ""}`}><FontAwesomeIcon icon={modificado ? faCircleExclamation : faCheck} />{modificado ? "Sin guardar" : "Configurado"}</span>
                  </div>
                  <div className="tnp-item__stats">
                    <div><span>Stock local</span><strong>{numero(row.stock)} <small>{unidad}</small></strong></div>
                    <div><span>Publicable ahora</span><strong>{numero(row.stock_publicable_tn)} <small>unid. TN</small></strong></div>
                  </div>
                  <div className="tnp-item__bottom">
                    <label className="cmi-floatingField cmi-floatingField--active tnp-field">
                      <span className="cmi-floatingLabel cmi-floatingLabel--active" title={`Cantidad local por 1 unidad de Tienda Nube (${unidad})`}>Cantidad por unidad TN ({unidad})</span>
                      <input className="cmi-input" type="text" inputMode="decimal" value={valor} disabled={guardando !== null || loading}
                        onChange={(event) => { setEdit(prev => ({ ...prev, [key]: event.target.value })); setError(""); }}
                        aria-label={`Cantidad local por presentación ${varianteNombre(row, id)}`} />
                    </label>
                    <button type="button" className="mit-btn mit-btn--solid tnp-save" disabled={guardando !== null || !modificado || loading} onClick={() => solicitarGuardar(row)}>
                      <FontAwesomeIcon icon={faFloppyDisk} /> {guardando === key ? "Guardando…" : "Guardar equivalencia"}
                    </button>
                  </div>
                </article>;
              }) : <div className="tnp-empty">No hay presentaciones disponibles para este producto.</div>}
            </div>
          )}
          <p className="tnp-footnote">Las unidades publicables se calculan en números enteros. Antes de cambiar una equivalencia, revisá que no haya pedidos pendientes con la presentación anterior.</p>
        </>
      )}
        </div>
        <aside className="tnp-layout__side" aria-label="Indicadores de presentaciones">
      <div className="tnp-summary" aria-label="Resumen de presentaciones">
        <article className="tnp-stat tnp-stat--blue">
          <span className="tnp-stat__icon"><FontAwesomeIcon icon={faLayerGroup} /></span>
          <div className="tnp-stat__body"><span>Presentaciones</span><strong>{enAlta ? filasAlta.length : loading ? "—" : rows.length}</strong></div>
        </article>
        <article className="tnp-stat tnp-stat--green">
          <span className="tnp-stat__icon"><FontAwesomeIcon icon={faBoxesStacked} /></span>
          <div className="tnp-stat__body"><span>{enAlta ? "Stock inicial" : "Stock local"}</span><strong>{enAlta ? numero(filasAlta.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)) : loading ? "—" : numero(cantidadTotal)}</strong></div>
        </article>
        <article className="tnp-stat tnp-stat--violet">
          <span className="tnp-stat__icon"><FontAwesomeIcon icon={faCloudArrowUp} /></span>
          <div className="tnp-stat__body"><span>Unidades publicables</span><strong>{enAlta || loading ? "—" : numero(cantidadPublicable)}</strong></div>
        </article>
      </div>

        </aside>
      </div>
      <ModalEliminar
        open={!!confirmacion}
        row={null}
        loading={guardando !== null}
        title="Confirmar equivalencia"
        message="Este cambio puede modificar el stock y los precios publicados en Tienda Nube."
        warning="Verificá la presentación ofrecida y los pedidos pendientes antes de continuar."
        details={confirmacion ? [
          { label: "Presentación", value: confirmacion.nombre },
          { label: "Nueva equivalencia", value: `${numero(confirmacion.cantidad)} ${confirmacion.unidad} / unidad TN` },
        ] : []}
        confirmLabel="Guardar equivalencia"
        confirmVariant="primary"
        visualVariant="deactivate"
        successMessage="Equivalencia guardada correctamente."
        loadingMessage="Guardando equivalencia…"
        onClose={() => setConfirmacion(null)}
        onConfirm={confirmarGuardar}
        onToast={(tipo, texto) => { if (tipo === "error") { setError(texto); onToast?.(texto, "error"); } }}
      />
    </section>
  );
}
