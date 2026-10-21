import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  consultarVencimientosStock,
  guardarVencimientoStock,
  quitarVencimientoStock,
  retirarStockVencido,
} from "../api/stockApi";
import { normalizeStockInput, stockToInput } from "../utils/stockFormUtils";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faBoxOpen } from "@fortawesome/free-solid-svg-icons";
import VencimientosResumen from "./VencimientosResumen";
import ModalPartidaVencimiento from "./ModalPartidaVencimiento";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import VencimientosTabla, { fechaVencimientoTexto } from "./VencimientosTabla";
import "./vencimientos.css";
import "./ModalRetirarVencimiento.css";

const cantidadTexto = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
const fechaTexto = fechaVencimientoTexto;

export default function VencimientosPanel({ productoId, initialVarianteId = null, onVencimientoCambiado, onToast }) {
  const [datos, setDatos] = useState(null);
  const [variante, setVariante] = useState(String(initialVarianteId || 0));
  const [retirar, setRetirar] = useState(null);
  const [quitarPartida, setQuitarPartida] = useState(null);
  const [cantidadRetirar, setCantidadRetirar] = useState("");
  const [motivoRetirar, setMotivoRetirar] = useState("Mercadería vencida");
  const [editorPartida, setEditorPartida] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const retiroAvisoRef = useRef("");
  const recargar = useCallback(async () => {
    const res = await consultarVencimientosStock(productoId);
    setDatos(res);
    setError("");
  }, [productoId]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    consultarVencimientosStock(productoId)
      .then((res) => { if (vigente) { setDatos(res); setError(""); } })
      .catch((err) => { if (vigente) setError(err.message || "No se pudieron cargar los vencimientos."); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [productoId]);

  useEffect(() => {
    if (!retirar) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [retirar]);

  const conVariantes = Number(datos?.producto?.tiene_variantes ?? 0) === 1;
  const variantes = useMemo(() => (datos?.variantes || []).filter((v) => Number(v.activo) === 1), [datos]);
  const varianteId = conVariantes ? Number(variante) : 0;
  const elegida = variantes.find((v) => Number(v.id_stock_variante) === varianteId);
  const stock = Number(conVariantes ? (elegida?.stock || 0) : (datos?.producto?.stock || 0));
  const vencimientos = (datos?.vencimientos || []).filter((v) =>
    conVariantes ? Number(v.id_stock_variante) === varianteId : !v.id_stock_variante
  );
  const asignadas = vencimientos.reduce((acc, v) => acc + Number(v.cantidad_disponible || 0), 0);
  const vencido = vencimientos.filter(v => Number(v.dias_restantes) < 0).reduce((sum,v) => sum + Number(v.cantidad_disponible || 0), 0);
  const proximo = vencimientos.filter(v => Number(v.dias_restantes) >= 0 && Number(v.dias_restantes) <= 7).reduce((sum,v) => sum + Number(v.cantidad_disponible || 0), 0);
  const cancel = () => setEditorPartida(null);
  const abrirRetiro = (partida) => {
    retiroAvisoRef.current = "";
    setRetirar(partida);
    setCantidadRetirar(stockToInput(partida.cantidad_disponible));
    setMotivoRetirar(Number(partida.dias_restantes) < 0 ? "Mercadería vencida" : "Retiro preventivo por vencimiento");
    setError("");
  };
  const ejecutarRetiro = async () => {
    if (!retirar || guardando) return;
    const cantidad = Number(cantidadRetirar);
    const disponible = Number(retirar.cantidad_disponible);
    if (!/^\d+(?:\.\d{1,3})?$/.test(cantidadRetirar) || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > disponible) {
      const mensaje = "Revisá la cantidad a retirar: debe ser mayor a cero y no superar la disponible en esta partida.";
      setError(mensaje);
      throw new Error(mensaje);
    }
    if (motivoRetirar.trim().length < 5) {
      const mensaje = "Indicá el motivo del retiro (al menos 5 caracteres).";
      setError(mensaje);
      throw new Error(mensaje);
    }
    setGuardando(true);
    setError("");
    try {
      const resultado = await retirarStockVencido({
        id_vencimiento: retirar.id_vencimiento,
        cantidad: cantidadRetirar,
        motivo: motivoRetirar.trim(),
      });
      setRetirar(null);
      cancel();
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
      window.dispatchEvent(new Event("balto:listas-updated"));
      // Una falla al refrescar la vista no debe reportar como fallida una baja ya persistida.
      const avisos = [];
      try {
        await recargar();
        await onVencimientoCambiado?.();
      } catch (_refreshError) {
        avisos.push("El retiro se registró, pero no se pudo actualizar toda la vista. Recargá Stock para consultar las existencias.");
      }
      const sync = resultado?.tiendanube_sync || resultado?.data?.tiendanube_sync || {};
      if (Object.keys(sync?.canales_con_errores || {}).length > 0 || Number(sync?.errores || 0) > 0) {
        avisos.push("Revisá la sincronización con Tienda Nube.");
      }
      retiroAvisoRef.current = avisos.length ? `Stock retirado correctamente. ${avisos.join(" ")}` : "";
    } catch (err) {
      const mensaje = err?.message || "No se pudieron retirar las unidades.";
      setError(mensaje);
      throw err;
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async (partida) => {
    if (conVariantes && !varianteId) throw new Error("Elegí una variante antes de registrar la partida.");
    setGuardando(true);
    setError("");
    try {
      await guardarVencimientoStock({
        ...partida,
        id_stock_producto: Number(productoId),
        id_stock_variante: varianteId || null,
      });
      await recargar();
      cancel();
      onToast?.("exito", partida.id_vencimiento ? "Vencimiento actualizado correctamente" : "Vencimiento registrado correctamente");
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
    } catch (err) {
      // El modal presenta el error al lado de los campos, sin cerrar ni descartar datos.
      throw err;
    } finally { setGuardando(false); }
  };

  const confirmarQuitar = async () => {
    if (!quitarPartida) return;
    setGuardando(true);
    setError("");
    try {
      await quitarVencimientoStock({ id_vencimiento: quitarPartida.id_vencimiento });
      await recargar();
      setQuitarPartida(null);
      cancel();
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="sv-panel" aria-label="Control de fechas de vencimiento">
      <div className="sv-section-head">
        <div><h3>Control de vencimientos</h3><p>Administrá las fechas y cantidades de cada partida sin salir de la edición del producto.</p></div>
        {datos && !cargando && (!conVariantes || !!elegida) && <button type="button" className="sv-primaryBtn" disabled={guardando} onClick={() => setEditorPartida({ id_vencimiento: 0, fecha_vencimiento: "", cantidad: "", referencia: "", observaciones: "" })}><FontAwesomeIcon icon={faPlus}/> Agregar vencimiento</button>}
      </div>
      {cargando && <div className="sv-empty">Cargando partidas...</div>}
      {error && <div className="sv-inline-error" role="alert">{error}</div>}
      {datos && !cargando && <>
        {conVariantes && <div className="cmi-floatingField sv-variantPicker"><label className="cmi-floatingLabel" htmlFor="sv-variant-select">Variante</label><select id="sv-variant-select" className="cmi-input cmi-select" value={variante} onChange={(e) => { setVariante(e.target.value); cancel(); }} disabled={guardando}>
          <option value="0">Seleccioná una variante</option>
          {variantes.map(v => <option key={v.id_stock_variante} value={v.id_stock_variante}>{v.nombre_variante || `VARIANTE #${v.id_stock_variante}`}</option>)}
        </select></div>}
        {(!conVariantes || !!elegida) && <>
          <VencimientosResumen stock={stock} asignadas={asignadas} vencidas={vencido} proximas={proximo}/>
          <div className="sv-list-head"><h4>Partidas registradas <span className="sv-count">{vencimientos.length}</span></h4></div>
          {vencimientos.length === 0
            ? <div className="sv-empty"><FontAwesomeIcon icon={faBoxOpen}/><strong>Todavía no hay fechas cargadas</strong><span>Agregá un vencimiento para llevar el seguimiento de tus partidas.</span></div>
            : <VencimientosTabla
                partidas={vencimientos}
                disabled={guardando}
                onEditar={(v) => setEditorPartida({
                  id_vencimiento: Number(v.id_vencimiento),
                  fecha_vencimiento: String(v.fecha_vencimiento).slice(0, 10),
                  cantidad: stockToInput(v.cantidad_disponible),
                  referencia: v.referencia || "",
                  observaciones: v.observaciones || "",
                })}
                onQuitar={setQuitarPartida}
                onRetirar={abrirRetiro}
              />}
          <p className="sv-hint">Quitar fecha no modifica las existencias. Retirar stock descuenta las unidades y registra un movimiento. Las ventas consumen primero las partidas próximas a vencer.</p>
          <ModalEliminar
            open={quitarPartida !== null}
            loading={guardando}
            onClose={() => setQuitarPartida(null)}
            onConfirm={confirmarQuitar}
            onToast={onToast}
            title="Quitar fecha de vencimiento"
            message="¿Querés quitar la fecha de esta partida?"
            warning="Las unidades NO se descontarán del inventario: quedarán como stock sin fecha. Para descartarlas, usá Retirar stock."
            confirmLabel="Quitar fecha"
            loadingMessage="Quitando fecha de vencimiento…"
            successMessage="Fecha de vencimiento quitada correctamente."
            errorMessage="No se pudo quitar la fecha."
            details={quitarPartida ? [
              { label: "Vencimiento", value: fechaTexto(quitarPartida.fecha_vencimiento) },
              { label: "Cantidad", value: cantidadTexto(quitarPartida.cantidad_disponible) },
              { label: "Referencia", value: quitarPartida.referencia || "—" },
            ] : []}
          />
          <ModalPartidaVencimiento open={editorPartida !== null} initialValue={editorPartida} onClose={cancel} onSave={guardar} busy={guardando} stock={stock} maxCantidad={Math.max(0, stock - asignadas + (editorPartida?.id_vencimiento ? Number(editorPartida.cantidad || 0) : 0))} permitirObservaciones subtitulo={conVariantes ? (elegida?.nombre_variante || "Variante seleccionada") : "Partida del producto"}/>
          <ModalEliminar
            open={retirar !== null}
            loading={guardando}
            onClose={() => { if (!guardando) { setRetirar(null); setError(""); } }}
            onConfirm={ejecutarRetiro}
            onToast={(tipo, mensaje, duracion) => {
              if (tipo === "exito" && retiroAvisoRef.current) {
                const aviso = retiroAvisoRef.current;
                retiroAvisoRef.current = "";
                onToast?.("advertencia", aviso, duracion);
              } else {
                onToast?.(tipo, mensaje, duracion);
              }
            }}
            title="Retirar unidades del inventario"
            message="¿Confirmás el retiro de estas unidades del stock real?"
            warning="Se registrará un movimiento de inventario y, si corresponde, se actualizará Tienda Nube. Esta acción no puede deshacerse desde este modal."
            confirmLabel="Confirmar retiro"
            loadingLabel="Retirando…"
            loadingMessage="Retirando unidades del inventario…"
            successMessage="Unidades retiradas correctamente."
            errorMessage="No se pudieron retirar las unidades."
            modalClassName="sv-retire-global"
            overlayClassName="sv-retire-overlay"
            submitOnEnter={false}
            confirmDisabled={!retirar}
            details={retirar ? [
              { label: "Vencimiento", value: fechaTexto(retirar.fecha_vencimiento) },
              { label: "Disponible", value: cantidadTexto(retirar.cantidad_disponible) },
              { label: "Referencia", value: retirar.referencia || "—" },
            ] : []}
            extraContent={retirar && <div className="sv-retire-fields">
              <div className="cmi-floatingField">
                <label className="cmi-floatingLabel" htmlFor="sv-retire-quantity">Cantidad a retirar *</label>
                <input id="sv-retire-quantity" className="cmi-input" type="text" inputMode="decimal"
                  value={cantidadRetirar} disabled={guardando} autoComplete="off"
                  onChange={(e) => { setCantidadRetirar(normalizeStockInput(e.target.value)); setError(""); }}
                  aria-describedby="sv-retire-quantity-help"/>
                <small id="sv-retire-quantity-help" className="sv-retire-help">Máximo disponible: {cantidadTexto(retirar.cantidad_disponible)}</small>
              </div>
              <div className="cmi-floatingField">
                <label className="cmi-floatingLabel" htmlFor="sv-retire-motive">Motivo del retiro *</label>
                <textarea id="sv-retire-motive" className="cmi-input cmi-textarea" rows={3} minLength={5} maxLength={200}
                  value={motivoRetirar} disabled={guardando} onChange={(e) => { setMotivoRetirar(e.target.value); setError(""); }}/>
              </div>
              {error && <p className="sv-retire-error" role="alert">{error}</p>}
            </div>}
          />
        </>}
      </>}
    </section>
  );
}
