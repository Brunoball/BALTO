import React, { useMemo, useState } from "react";
import { crearUnidadStock, actualizarUnidadStock } from "../api/stockApi";

function unitId(unit) {
  return String(unit?.id_stock_unidad ?? unit?.id ?? "");
}

export default function StockUnitField({
  value,
  unidades = [],
  onChange,
  onUnitsChange,
  disabled = false,
  onToast,
  className = "cmi-input cmi-select",
}) {
  const [mode, setMode] = useState("");
  const [nombre, setNombre] = useState("");
  const [abreviatura, setAbreviatura] = useState("");
  const [permiteDecimales, setPermiteDecimales] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => (unidades || []).find((u) => unitId(u) === String(value || "")) || null,
    [unidades, value]
  );
  const disponibles = useMemo(
    () => (unidades || []).filter((u) => Number(u?.activo ?? 1) === 1 || unitId(u) === String(value || "")),
    [unidades, value]
  );

  const openNew = () => {
    setMode("new");
    setNombre("");
    setAbreviatura("");
    setPermiteDecimales(true);
  };
  const openEdit = () => {
    if (!selected) return;
    setMode("edit");
    setNombre(String(selected.nombre || ""));
    setAbreviatura(String(selected.abreviatura || ""));
    setPermiteDecimales(Number(selected.permite_decimales ?? 1) === 1);
  };

  const save = async () => {
    const cleanName = nombre.trim();
    const cleanAbbr = abreviatura.trim();
    if (!cleanName || !cleanAbbr) {
      onToast?.("error", "Completá nombre y abreviatura de la unidad.");
      return;
    }
    setSaving(true);
    try {
      const payload = { nombre: cleanName, abreviatura: cleanAbbr, permite_decimales: permiteDecimales ? 1 : 0 };
      const res = mode === "edit"
        ? await actualizarUnidadStock({ ...payload, id_stock_unidad: Number(unitId(selected)) })
        : await crearUnidadStock(payload);
      const saved = res?.unidad || res?.data?.unidad;
      if (saved) {
        const id = unitId(saved);
        onUnitsChange?.((prev = []) => {
          const exists = prev.some((u) => unitId(u) === id);
          const next = exists ? prev.map((u) => unitId(u) === id ? { ...u, ...saved } : u) : [...prev, saved];
          return next.sort((a, b) => Number(b?.es_default || 0) - Number(a?.es_default || 0) || String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es"));
        });
        onChange?.(id);
      }
      setMode("");
      onToast?.("exito", mode === "edit" ? "Unidad actualizada." : "Unidad creada.");
    } catch (error) {
      onToast?.("error", error?.message || "No se pudo guardar la unidad.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 7 }}>
      <select
        className={className}
        value={String(value || "")}
        disabled={disabled || saving}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "__new_unit__") return openNew();
          if (next === "__edit_unit__") return openEdit();
          onChange?.(next);
        }}
      >
        <option value="">Seleccionar unidad</option>
        {disponibles.map((u) => (
          <option key={unitId(u)} value={unitId(u)}>
            {String(u.nombre || "UNIDAD")} ({String(u.abreviatura || "u")})
          </option>
        ))}
        <option value="__new_unit__">+ Nueva unidad</option>
        {selected && Number(selected?.es_default || 0) !== 1 ? <option value="__edit_unit__">✎ Editar unidad seleccionada</option> : null}
      </select>

      {mode ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr .55fr auto", gap: 6, alignItems: "center" }}>
          <input className="cmi-input" value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} placeholder="Nombre (GRAMO)" disabled={saving} />
          <input className="cmi-input" value={abreviatura} onChange={(e) => setAbreviatura(e.target.value)} placeholder="g" disabled={saving} />
          <div style={{ display: "flex", gap: 5 }}>
            <button type="button" className="cmi-btn cmi-btn--primary" onClick={save} disabled={saving}>{saving ? "…" : "Guardar"}</button>
            <button type="button" className="cmi-btn" onClick={() => setMode("")} disabled={saving}>×</button>
          </div>
          <label style={{ gridColumn: "1 / -1", display: "inline-flex", gap: 7, alignItems: "center", fontSize: 11 }}>
            <input type="checkbox" checked={permiteDecimales} onChange={(e) => setPermiteDecimales(e.target.checked)} />
            Permitir cantidades decimales (ej. 0,125 kg)
          </label>
        </div>
      ) : null}
    </div>
  );
}
