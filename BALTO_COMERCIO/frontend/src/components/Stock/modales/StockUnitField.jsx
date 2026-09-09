import React, { useEffect, useMemo, useRef, useState } from "react";
import { crearUnidadStock, actualizarUnidadStock } from "../api/stockApi";
import { isTopStockModal } from "./modalStackUtils";

function unitId(unit) {
  return String(unit?.id_stock_unidad ?? unit?.id ?? "");
}

function MiniUnitModal({
  open,
  mode,
  nombre,
  abreviatura,
  permiteDecimales,
  saving,
  onNombreChange,
  onAbreviaturaChange,
  onPermiteDecimalesChange,
  onCancel,
  onSave,
}) {
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;

      event.preventDefault();
      event.stopPropagation();

      if (!saving) onCancel?.();
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [open, saving, onCancel]);

  if (!open) return null;

  const handleEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!saving) onSave?.();
  };

  return (
    <div ref={overlayRef} data-stock-modal-overlay="true" className="cmi-miniOverlay">
      <div className="cmi-miniModal cmi-miniModal--unit" onMouseDown={(event) => event.stopPropagation()}>
        <div className="cmi-miniModal__head">
          {mode === "edit" ? "Editar unidad" : "Nueva unidad"}
        </div>

        <div className="cmi-miniModal__body cmi-miniModal__body--unit">
          <div className="cmi-floatingField fl-field">
            <label className="cmi-floatingLabel">Nombre *</label>
            <input
              className="cmi-input"
              value={nombre}
              onChange={(event) => onNombreChange(event.target.value.toUpperCase())}
              onKeyDown={handleEnter}
              placeholder="EJ: GRAMO"
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="cmi-floatingField fl-field">
            <label className="cmi-floatingLabel">Abreviatura *</label>
            <input
              className="cmi-input"
              value={abreviatura}
              onChange={(event) => onAbreviaturaChange(event.target.value)}
              onKeyDown={handleEnter}
              placeholder="Ej: g"
              disabled={saving}
            />
          </div>

          <label className="cmi-unitDecimalOption">
            <input
              type="checkbox"
              checked={permiteDecimales}
              onChange={(event) => onPermiteDecimalesChange(event.target.checked)}
              disabled={saving}
            />
            <span>
              <strong>Permitir cantidades decimales</strong>
              <small>Ejemplo: 0,125 kg</small>
            </span>
          </label>

          <div className="cmi-miniModal__actions">
            <button type="button" className="mit-btn mit-btn--ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="mit-btn mit-btn--solid" onClick={onSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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

  const closeModal = () => {
    if (saving) return;
    setMode("");
    setNombre("");
    setAbreviatura("");
    setPermiteDecimales(true);
  };

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
      const payload = {
        nombre: cleanName,
        abreviatura: cleanAbbr,
        permite_decimales: permiteDecimales ? 1 : 0,
      };
      const res = mode === "edit"
        ? await actualizarUnidadStock({ ...payload, id_stock_unidad: Number(unitId(selected)) })
        : await crearUnidadStock(payload);
      const saved = res?.unidad || res?.data?.unidad;

      if (saved) {
        const id = unitId(saved);
        onUnitsChange?.((prev = []) => {
          const exists = prev.some((u) => unitId(u) === id);
          const next = exists
            ? prev.map((u) => unitId(u) === id ? { ...u, ...saved } : u)
            : [...prev, saved];

          return next.sort(
            (a, b) =>
              Number(b?.es_default || 0) - Number(a?.es_default || 0) ||
              String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es")
          );
        });
        onChange?.(id);
      }

      setMode("");
      setNombre("");
      setAbreviatura("");
      setPermiteDecimales(true);
      onToast?.("exito", mode === "edit" ? "Unidad actualizada." : "Unidad creada.");
    } catch (error) {
      onToast?.("error", error?.message || "No se pudo guardar la unidad.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <select
        className={className}
        value={String(value || "")}
        disabled={disabled || saving}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "__new_unit__") return openNew();
          if (next === "__edit_unit__") return openEdit();
          onChange?.(next);
        }}
      >
        <option value="">Seleccionar unidad</option>
        {disponibles.map((unit) => (
          <option key={unitId(unit)} value={unitId(unit)}>
            {String(unit.nombre || "UNIDAD")} ({String(unit.abreviatura || "u")})
          </option>
        ))}
        <option value="__new_unit__">+ Nueva unidad</option>
        {selected && Number(selected?.es_default || 0) !== 1 ? (
          <option value="__edit_unit__">✎ Editar unidad seleccionada</option>
        ) : null}
      </select>

      <MiniUnitModal
        open={!!mode}
        mode={mode}
        nombre={nombre}
        abreviatura={abreviatura}
        permiteDecimales={permiteDecimales}
        saving={saving}
        onNombreChange={setNombre}
        onAbreviaturaChange={setAbreviatura}
        onPermiteDecimalesChange={setPermiteDecimales}
        onCancel={closeModal}
        onSave={save}
      />
    </>
  );
}
