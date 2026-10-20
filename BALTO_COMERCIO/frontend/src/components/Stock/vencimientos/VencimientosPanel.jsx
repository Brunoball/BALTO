import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  consultarVencimientosStock,
  guardarVencimientoStock,
  quitarVencimientoStock,
  retirarStockVencido,
} from "../api/stockApi";
import { stockToInput } from "../utils/stockFormUtils";
import "./vencimientos.css";

const EMPTY = { id_vencimiento: 0, fecha_vencimiento: "", cantidad: "", referencia: "", observaciones: "" };
const cantidadTexto = (n) => Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 });
const fechaTexto = (fecha) => {
  const match = String(fecha || "").match(/^(\d{4})-(\d\d)-(\d\d)/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : fecha;
};

export default function VencimientosPanel({ productoId, initialVarianteId = null, onVencimientoCambiado, onToast }) {
  const [datos, setDatos] = useState(null);
  const [variante, setVariante] = useState(String(initialVarianteId || 0));
  const [retirar, setRetirar] = useState(null);
  const [cantidadRetirar, setCantidadRetirar] = useState("");
  const [motivoRetirar, setMotivoRetirar] = useState("Mercadería vencida");
  const [form, setForm] = useState(EMPTY);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
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
    const onEscape = (event) => {
      if (event.key === "Escape" && !guardando) {
        event.preventDefault();
        setRetirar(null);
        setError("");
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [retirar, guardando]);

  const conVariantes = Number(datos?.producto?.tiene_variantes ?? 0) === 1;
  const variantes = useMemo(() => (datos?.variantes || []).filter((v) => Number(v.activo) === 1), [datos]);
  const varianteId = conVariantes ? Number(variante) : 0;
  const elegida = variantes.find((v) => Number(v.id_stock_variante) === varianteId);
  const stock = Number(conVariantes ? (elegida?.stock || 0) : (datos?.producto?.stock || 0));
  const vencimientos = (datos?.vencimientos || []).filter((v) =>
    conVariantes ? Number(v.id_stock_variante) === varianteId : !v.id_stock_variante
  );
  const asignadas = vencimientos.reduce((acc, v) => acc + Number(v.cantidad_disponible || 0), 0);
  const sinFecha = Math.max(0, stock - asignadas);
  const vencido = vencimientos.filter(v => Number(v.dias_restantes) < 0).reduce((sum,v) => sum + Number(v.cantidad_disponible || 0), 0);
  const proximo = vencimientos.filter(v => Number(v.dias_restantes) >= 0 && Number(v.dias_restantes) <= 7).reduce((sum,v) => sum + Number(v.cantidad_disponible || 0), 0);
  const cancel = () => setForm(EMPTY);
  const abrirRetiro = (partida) => {
    setRetirar(partida);
    setCantidadRetirar(stockToInput(partida.cantidad_disponible));
    setMotivoRetirar(Number(partida.dias_restantes) < 0 ? "Mercadería vencida" : "Retiro preventivo por vencimiento");
    setError("");
  };
  const ejecutarRetiro = async (event) => {
    event.preventDefault();
    if (!retirar) return;
    const cantidad = Number(cantidadRetirar);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > Number(retirar.cantidad_disponible)) {
      setError("Revisá la cantidad a retirar: no puede superar la disponible en esta partida.");
      return;
    }
    if (motivoRetirar.trim().length < 5) {
      setError("Indicá el motivo del retiro (al menos 5 caracteres).");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const resultado = await retirarStockVencido({ id_vencimiento: retirar.id_vencimiento, cantidad: cantidadRetirar, motivo: motivoRetirar.trim() });
      setRetirar(null);
      cancel();
      await recargar();
      await onVencimientoCambiado?.();
      const sync = resultado?.tiendanube_sync || resultado?.data?.tiendanube_sync || {};
      const huboErrorCanal = Object.keys(sync?.canales_con_errores || {}).length > 0 || Number(sync?.errores || 0) > 0;
      onToast?.(
        huboErrorCanal
          ? "Stock retirado correctamente. Revisá la sincronización con Tienda Nube."
          : "Stock retirado correctamente",
        huboErrorCanal ? "advertencia" : "exito"
      );
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
      window.dispatchEvent(new Event("balto:listas-updated"));
    } catch (err) {
      setError(err.message || "No se pudieron retirar las unidades.");
    } finally { setGuardando(false); }
  };

  const guardar = async (event) => {
    event.preventDefault();
    if (conVariantes && !varianteId) { setError("Elegí una variante antes de registrar la partida."); return; }
    setGuardando(true);
    setError("");
    try {
      await guardarVencimientoStock({
        ...form,
        id_stock_producto: Number(productoId),
        id_stock_variante: varianteId || null,
      });
      await recargar();
      cancel();
      onToast?.("Vencimiento registrado correctamente", "exito");
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
    } catch (err) { setError(err.message || "No se pudo guardar la partida."); }
    finally { setGuardando(false); }
  };

  const quitar = async (id) => {
    if (!window.confirm("¿Quitar solo la fecha de esta partida? Las unidades seguirán en el stock y quedarán SIN fecha de vencimiento. Para desechar mercadería usá Retirar stock.")) return;
    setGuardando(true);
    setError("");
    try {
      await quitarVencimientoStock({ id_vencimiento: id });
      await recargar();
      cancel();
      onToast?.("Registro de vencimiento quitado", "exito");
      window.dispatchEvent(new Event("balto:stock-vencimientos-cambio"));
    } catch (err) { setError(err.message || "No se pudo quitar la partida."); }
    finally { setGuardando(false); }
  };

  return (
    <section className="sv-panel" aria-label="Control de fechas de vencimiento">
      <h3>Control de vencimientos</h3>
      <p>Gestioná fechas por partida y cantidades. Si una mercadería está vencida, usá <strong>Retirar stock</strong>: se descuenta la partida y el stock real, se registra en el historial y se sincroniza el stock con Tienda Nube si corresponde.</p>
      {cargando && <p>Cargando partidas...</p>}
      {error && <div className="sv-error" role="alert">{error}</div>}
      {datos && !cargando && <>
        {conVariantes && <label className="sv-field">Variante
          <select value={variante} onChange={(e) => { setVariante(e.target.value); cancel(); }} disabled={guardando}>
            <option value="0">Seleccioná una variante</option>
            {variantes.map(v => <option key={v.id_stock_variante} value={v.id_stock_variante}>{v.nombre_variante || `VARIANTE #${v.id_stock_variante}`}</option>)}
          </select>
        </label>}
        {(!conVariantes || !!elegida) && <>
          <div className="sv-stat-grid">
            <div><span>Stock actual</span><strong>{cantidadTexto(stock)}</strong></div>
            <div><span>Con vencimiento registrado</span><strong>{cantidadTexto(asignadas)}</strong></div>
            <div><span>Sin fecha asignada</span><strong>{cantidadTexto(sinFecha)}</strong></div>
            <div className="sv-stat-expired"><span>Unidades vencidas</span><strong>{cantidadTexto(vencido)}</strong></div>
            <div className="sv-stat-soon"><span>Vencen en 7 días</span><strong>{cantidadTexto(proximo)}</strong></div>
          </div>
          <form className="sv-form" onSubmit={guardar}>
            <h4>{form.id_vencimiento ? "Editar partida" : "Agregar partida con vencimiento"}</h4>
            <div className="sv-fields">
              <label className="sv-field">Vence el <input type="date" required value={form.fecha_vencimiento} onChange={(e) => setForm(f=>({...f,fecha_vencimiento:e.target.value}))} disabled={guardando}/></label>
              <label className="sv-field">Cantidad <input type="number" required min="0.001" step="0.001" placeholder="Ej: 5" value={form.cantidad} onChange={(e) => setForm(f=>({...f,cantidad:e.target.value}))} disabled={guardando}/></label>
              <label className="sv-field">Referencia (opcional) <input type="text" maxLength={100} placeholder="Ej: partida de octubre" value={form.referencia} onChange={(e) => setForm(f=>({...f,referencia:e.target.value}))} disabled={guardando}/></label>
              <label className="sv-field">Observación (opcional) <input type="text" maxLength={255} placeholder="Ej: proveedor" value={form.observaciones} onChange={(e) => setForm(f=>({...f,observaciones:e.target.value}))} disabled={guardando}/></label>
            </div>
            <div className="sv-actions"><button type="submit" disabled={guardando}>{guardando ? "Guardando..." : form.id_vencimiento ? "Guardar edición" : "Agregar vencimiento"}</button>{form.id_vencimiento > 0 && <button type="button" className="sv-secondary" onClick={cancel}>Cancelar edición</button>}</div>
          </form>
          <h4>Partidas registradas</h4>
          <div className="sv-scroll"><table className="sv-table"><thead><tr><th>Vencimiento</th><th>Cantidad restante</th><th>Referencia</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{vencimientos.length === 0 ? <tr><td colSpan="5">Todavía no hay fechas cargadas.</td></tr> : vencimientos.map(v => {
              const dias = Number(v.dias_restantes);
              const estado = Number(v.cantidad_disponible) === 0 ? "Sin unidades" : dias < 0 ? "Vencido" : dias <= 7 ? `Vence en ${dias} días` : "Vigente";
              return <tr key={v.id_vencimiento}><td>{fechaTexto(v.fecha_vencimiento)}</td><td>{cantidadTexto(v.cantidad_disponible)}</td><td>{v.referencia || "—"}</td><td><span className={`sv-state ${dias < 0 ? "sv-expired" : dias <= 7 ? "sv-soon" : ""}`}>{estado}</span></td><td>
                <button type="button" disabled={guardando} onClick={() => setForm({id_vencimiento:Number(v.id_vencimiento),fecha_vencimiento:String(v.fecha_vencimiento).slice(0,10),cantidad:stockToInput(v.cantidad_disponible),referencia:v.referencia || "",observaciones:v.observaciones || ""})}>Editar</button>{" "}
                <button type="button" disabled={guardando} className="sv-secondary" onClick={()=>quitar(v.id_vencimiento)}>Quitar fecha</button>{" "}
                {Number(v.cantidad_disponible) > 0 && <button type="button" disabled={guardando} className="sv-danger" onClick={() => abrirRetiro(v)}>Retirar stock</button>}
              </td></tr>;
            })}</tbody>
          </table></div>
          <p className="sv-hint">Quitar fecha no modifica el stock. Retirar stock lo descuenta de la partida seleccionada y deja un movimiento auditable. Las ventas descuentan primero las partidas con vencimiento más cercano; una devolución vuelve como stock sin fecha y requiere asignación manual. El sistema alerta, pero no bloquea la venta de mercadería vencida.</p>
          {retirar && <div className="sv-retire-backdrop" role="presentation" onMouseDown={() => !guardando && setRetirar(null)}>
            <section className="sv-retire-dialog" role="dialog" aria-modal="true" aria-label="Confirmar retiro de stock vencido" onMouseDown={(e) => e.stopPropagation()}>
              <h3>Retirar unidades del inventario</h3>
              <p>Partida del {fechaTexto(retirar.fecha_vencimiento)} · Disponibles: <strong>{cantidadTexto(retirar.cantidad_disponible)}</strong>. Esta operación disminuye el stock real, registra el motivo y puede actualizar Tienda Nube.</p>
              <form onSubmit={ejecutarRetiro} className="sv-retire-form">
                <label className="sv-field">Cantidad a retirar
                  <input type="number" min="0.001" max={retirar.cantidad_disponible} step="0.001" required autoFocus disabled={guardando} value={cantidadRetirar} onChange={(e) => setCantidadRetirar(e.target.value)} />
                </label>
                <label className="sv-field">Motivo del retiro
                  <textarea minLength={5} maxLength={200} rows={2} required disabled={guardando} value={motivoRetirar} onChange={(e) => setMotivoRetirar(e.target.value)} />
                </label>
                <div className="sv-retire-warning">Esta acción no es solo quitar una fecha: descuenta existencias y no puede deshacerse desde este modal.</div>
                {error && <div role="alert" className="sv-error">{error}</div>}
                <div className="sv-actions"><button type="button" className="sv-secondary" disabled={guardando} onClick={() => { setRetirar(null); setError(""); }}>Cancelar</button><button type="submit" className="sv-danger" disabled={guardando}>{guardando ? "Retirando…" : "Confirmar retiro"}</button></div>
              </form>
            </section>
          </div>}
        </>}
      </>}
    </section>
  );
}
