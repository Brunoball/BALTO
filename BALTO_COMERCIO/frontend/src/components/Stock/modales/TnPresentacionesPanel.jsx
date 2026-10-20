import React, { useCallback, useEffect, useState } from "react";
import { consultarPresentacionesTnStock, guardarPresentacionTnStock } from "../api/stockApi";

function mostrarNumero(value) {
  const numero = Number(value);
  return Number.isFinite(numero) ? String(numero) : "";
}

export default function TnPresentacionesPanel({ productoId, onToast }) {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState({});
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(null);
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
      setEdit(Object.fromEntries(lista.map((row) => [String(row.id_stock_variante || 0), mostrarNumero(row.cantidad_local_por_unidad_tn ?? 1)])));
    } catch (e) {
      setError(e?.message || "No se pudieron consultar las presentaciones.");
    } finally {
      setLoading(false);
    }
  }, [productoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (variante) => {
    const key = String(variante || 0);
    const bruto = String(edit[key] ?? "").replace(",", ".").trim();
    const cantidad = Number(bruto);
    if (!/^[0-9]+(?:\.[0-9]{1,3})?$/.test(bruto) || !Number.isFinite(cantidad) || cantidad < 0.001 || cantidad > 1000000) {
      setError("Ingresá una cantidad positiva con hasta tres decimales.");
      return;
    }
    if (!window.confirm("¿Guardar la equivalencia? Esto cambia el stock y los precios publicados en Tienda Nube. Verificá que la presentación ofrecida coincida con la tienda.")) return;
    setGuardando(key);
    setError("");
    setMensaje("");
    try {
      const res = await guardarPresentacionTnStock({ id_stock_producto: productoId, id_stock_variante: Number(variante || 0), cantidad_local: cantidad });
      const sync = res?.tiendanube_sync;
      const aviso = Number(sync?.errores || 0) > 0 || Number(sync?.saltados || 0) > 0
        ? "Presentación guardada. Revisá la conexión de Tienda Nube y la sincronización pendiente."
        : "Presentación guardada. La actualización de Tienda Nube quedó solicitada.";
      setMensaje(aviso);
      onToast?.(aviso, "success");
      await cargar();
    } catch (e) {
      setError(e?.message || "No se pudo guardar la presentación.");
    } finally {
      setGuardando(null);
    }
  };

  return (
    <section className="cmi-uploadBox" aria-label="Presentaciones de Tienda Nube" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Presentaciones de Tienda Nube</h3>
      <p>Definí cuánto stock real de BALTO representa <strong>1 unidad vendida en Tienda Nube</strong>. Si no configurás nada, se vende de a 1 en la unidad original (por ejemplo: 1 kg).</p>
      <p>Ejemplo: un paquete de 500 g cuando el producto se mide en kilogramos equivale a <strong>0,5 kg</strong>. BALTO publicará solo paquetes completos y conservará cualquier sobrante local.</p>
      {loading && <p>Cargando presentaciones…</p>}
      {error && <p role="alert" style={{ color: "#c0392b" }}>{error}</p>}
      {mensaje && <p role="status">{mensaje}</p>}
      {!loading && rows.map((row) => {
        const variant = Number(row.id_stock_variante || 0);
        const key = String(variant);
        const suffix = row.unidad || "u";
        return <div key={key} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border-color, #ddd)", padding: "14px 0" }}>
          <div style={{ minWidth: 150, flex: "1 1 200px" }}>
            <strong>{variant ? row.nombre_variante || `VARIANTE #${variant}` : "PRODUCTO SIMPLE"}</strong>
            <div>Stock local: {mostrarNumero(row.stock)} {suffix}</div>
            <div>Publicable ahora: {row.stock_publicable_tn} unidades TN</div>
          </div>
          <label style={{ display: "grid", gap: 4, flex: "0 1 240px" }}>
            <span>Por 1 unidad de Tienda Nube ({suffix})</span>
            <input className="cmi-input" type="text" inputMode="decimal" value={edit[key] ?? "1"} disabled={!!guardando} onChange={(event) => setEdit((prev) => ({ ...prev, [key]: event.target.value }))} aria-label={`Cantidad local por presentación ${variant ? row.nombre_variante : "producto simple"}`} />
          </label>
          <button type="button" className="cmi-v2-mainTab" disabled={!!guardando || loading} onClick={() => guardar(variant)}>{guardando === key ? "Guardando…" : "Guardar equivalencia"}</button>
        </div>;
      })}
      <small>La cantidad de Tienda Nube siempre es entera. No cambies esta equivalencia con pedidos pendientes sin revisar las unidades que ofrecen tus publicaciones.</small>
    </section>
  );
}
