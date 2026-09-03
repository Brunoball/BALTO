// src/components/Movimientos/modales/ModalEditarMovimiento.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import "../../Global/Global_css/Global_Modals.css";
import "../../Global/Global_css/Global_responsive.css";
import { crearCatalogoMovimiento } from "../api/movimientosApi";

const NULL_OPTION = "";
const ADD_OPTION = "__ADD__";

// IVA selector
const IVA_OPTIONS = [
  { label: "0%", value: 0 },
  { label: "10,5%", value: 10.5 },
  { label: "21%", value: 21 },
];

/* =========================
   ✅ ID tolerante (igual al modal carga rápida)
========================= */
function getIdGeneric(x) {
  const cand =
    x?.id ??
    x?.id_cliente ??
    x?.idCliente ??
    x?.cliente_id ??
    x?.id_proveedor ??
    x?.idProveedor ??
    x?.proveedor_id ??
    x?.id_detalle ??
    x?.idDetalle ??
    x?.detalle_id ??
    x?.id_tipo_operacion ??
    x?.idTipoOperacion ??
    x?.tipo_operacion_id ??
    x?.id_tipo_venta ??
    x?.idTipoVenta ??
    x?.tipo_venta_id ??
    x?.id_clasificacion ??
    x?.idClasificacion ??
    x?.clasificacion_id ??
    x?.id_cuenta_corriente ??
    x?.idCuentaCorriente ??
    x?.cuenta_corriente_id ??
    x?.id_medio_pago ??
    x?.idMedioPago ??
    x?.medio_pago_id ??
    0;

  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* =========================
   Safe lists + normalización
========================= */
const SAFE_LISTS = {
  periodos: [],
  clasificaciones: [],
  tiposVenta: [],
  cuentasCorrientes: [],
  tiposOperacion: [],
  clientes: [],
  proveedores: [],
  detalles: [],
  mediosPago: [],
};

function normalizeIncomingLists(lists) {
  const l = lists && typeof lists === "object" ? lists : {};
  const src = l.listas && typeof l.listas === "object" ? l.listas : l;

  const tiposVenta =
    Array.isArray(src.tiposVenta) && src.tiposVenta.length
      ? src.tiposVenta
      : Array.isArray(src.tipos_venta)
      ? src.tipos_venta
      : [];

  const tiposOperacion =
    Array.isArray(src.tiposOperacion) && src.tiposOperacion.length
      ? src.tiposOperacion
      : Array.isArray(src.tipos_operacion)
      ? src.tipos_operacion
      : Array.isArray(src.tipo_operacion)
      ? src.tipo_operacion
      : Array.isArray(src.tipos_operaciones)
      ? src.tipos_operaciones
      : [];

  const cuentas =
    Array.isArray(src.cuentasCorrientes) && src.cuentasCorrientes.length
      ? src.cuentasCorrientes
      : Array.isArray(src.cuentas_corrientes)
      ? src.cuentas_corrientes
      : Array.isArray(src.cuenta_corriente)
      ? src.cuenta_corriente
      : [];

  const medios =
    Array.isArray(src.mediosPago) && src.mediosPago.length
      ? src.mediosPago
      : Array.isArray(src.medios_pago)
      ? src.medios_pago
      : [];

  return {
    periodos: Array.isArray(src.periodos) ? src.periodos : [],
    clasificaciones: Array.isArray(src.clasificaciones) ? src.clasificaciones : [],
    tiposVenta: Array.isArray(tiposVenta) ? tiposVenta : [],
    cuentasCorrientes: Array.isArray(cuentas) ? cuentas : [],
    tiposOperacion: Array.isArray(tiposOperacion) ? tiposOperacion : [],
    clientes: Array.isArray(src.clientes) ? src.clientes : [],
    proveedores: Array.isArray(src.proveedores) ? src.proveedores : [],
    detalles: Array.isArray(src.detalles) ? src.detalles : [],
    mediosPago: Array.isArray(medios) ? medios : [],
  };
}

function safeNumber(v) {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* =========================
   Fecha / Periodo helpers
========================= */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizePeriodoToMMYYYY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";

  let m = "";
  let y = "";

  if (/^\d{4}[-/]\d{1,2}$/.test(s)) {
    const parts = s.split(/[-/]/);
    y = parts[0];
    m = parts[1];
  } else if (/^\d{1,2}[-/]\d{4}$/.test(s)) {
    const parts = s.split(/[-/]/);
    m = parts[0];
    y = parts[1];
  } else if (/^\d{6}$/.test(s)) {
    const a = Number(s.slice(0, 4));
    if (a >= 1900 && a <= 2100) {
      y = s.slice(0, 4);
      m = s.slice(4);
    } else {
      m = s.slice(0, 2);
      y = s.slice(2);
    }
  } else {
    return s;
  }

  const mm = String(Number(m)).padStart(2, "0");
  const yyyy = String(y);
  return `${mm}-${yyyy}`;
}

function periodoMMYYYY_to_YYYYMM(mmYYYY) {
  const s = String(mmYYYY ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{2}-\d{4}$/.test(s)) {
    const [mm, yyyy] = s.split("-");
    return `${yyyy}-${mm}`;
  }
  return s;
}

function periodoFromISODate(iso) {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m] = s.split("-");
  return `${m}-${y}`;
}

/* =========================
   ✅ Auth helpers (JWT + X-Session)
   FIX: antes faltaba X-Session y backend multi-tenant te tira error
========================= */
function isTemaOscuro() {
  return document.documentElement.getAttribute("data-theme") === "oscuro";
}

/* =========================
   Catálogo map
========================= */
const CATALOGO_MAP = {
  id_clasificacion: { catalogo: "clasificaciones", label: "Clasificación" },
  id_tipo_operacion: { catalogo: "tipos_operacion", label: "Tipo de operación" },
  id_tipo_venta: { catalogo: "tipos_venta", label: "Tipo de venta" },
  id_cuenta_corriente: { catalogo: "cuentas_corrientes", label: "Cuenta corriente" },
  id_cliente: { catalogo: "clientes", label: "Cliente" },
  id_proveedor: { catalogo: "proveedores", label: "Proveedor" },
  id_detalle: { catalogo: "detalles", label: "Detalle" },
  id_medio_pago: { catalogo: "medios_pago", label: "Medio de pago" },
};

const LISTKEY_BY_CATALOGO = {
  clasificaciones: "clasificaciones",
  tipos_operacion: "tiposOperacion",
  tipos_venta: "tiposVenta",
  cuentas_corrientes: "cuentasCorrientes",
  clientes: "clientes",
  proveedores: "proveedores",
  detalles: "detalles",
  medios_pago: "mediosPago",
};

/* =========================
   Mini Modal: alta rápida
========================= */
function AddCatalogMiniModal({ open, title, value, saving, onChange, onCancel, onSave, dark = false }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onCancel?.();
      if (e.key === "Enter") onSave?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel, onSave]);

  if (!open) return null;

  return createPortal(
    <div className="mi-mini__overlay" onMouseDown={onCancel}>
      <div
        className={["mi-mini__modal", dark ? "mi-modal--dark" : ""].join(" ").trim()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mi-mini__head">
          <h4 className="mi-mini__title">{title}</h4>
          <button
            type="button"
            className="mi-mini__close"
            onClick={onCancel}
            disabled={saving}
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="mi-mini__body">
          <div className="fl-field">
            <input
              ref={inputRef}
              className="fl-input"
              placeholder=" "
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              disabled={saving}
              autoComplete="off"
            />
            <label className="fl-label">Nombre</label>
          </div>

          <div className="mi-mini__actions">
            <button type="button" className="mit-btn mit-btn--ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>

            <button type="button" className="mit-btn mit-btn--solid" onClick={onSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* =========================
   Cálculo item
========================= */
function calcItemTotals(cantidad, precio, ivaPct) {
  const c = Math.max(0, safeNumber(cantidad));
  const p = Math.max(0, safeNumber(precio));
  const iva = Math.max(0, safeNumber(ivaPct));

  const subtotal = c * p;
  const iva_monto = subtotal * (iva / 100);
  const total = subtotal + iva_monto;

  const r2 = (n) => Math.round(n * 100) / 100;

  return {
    subtotal: r2(subtotal),
    iva_monto: r2(iva_monto),
    total: r2(total),
  };
}

/* =========================
   Build form desde row
========================= */
function buildFormFromRow(row, listsMerged, periodoDefault) {
  const r = row || {};

  const fecha = String(r.fecha || "").slice(0, 10) || "";
  const perRow = normalizePeriodoToMMYYYY(r.periodo_ui || r.periodo || "");
  const perDef = normalizePeriodoToMMYYYY(periodoDefault || "");
  const perByFecha = periodoFromISODate(fecha || todayISO());
  const pickPeriodo = perRow || perDef || perByFecha || "";

  const nOrNull = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : NULL_OPTION);

  const sOrNull = (v) => {
    if (v == null || v === "" || v === 0) return NULL_OPTION;
    return String(v);
  };

  const cantidad = r.cantidad != null ? safeNumber(r.cantidad) : 1;
  const precio = r.precio != null ? safeNumber(r.precio) : safeNumber(r.monto_total);
  const iva_pct = r.iva_pct != null ? safeNumber(r.iva_pct) : 0;

  const totals = calcItemTotals(cantidad, precio, iva_pct);

  const subtotal = r.subtotal != null ? safeNumber(r.subtotal) : totals.subtotal;
  const iva_monto = r.iva_monto != null ? safeNumber(r.iva_monto) : totals.iva_monto;
  const total = r.total != null ? safeNumber(r.total) : totals.total;

  const monto_total = r.monto_total != null ? safeNumber(r.monto_total) : total;

  return {
    id_movimiento: safeNumber(r.id_movimiento) || null,
    fecha,
    periodo: pickPeriodo,

    id_clasificacion: nOrNull(r.id_clasificacion),
    id_tipo_operacion: nOrNull(r.id_tipo_operacion),
    id_tipo_venta: nOrNull(r.id_tipo_venta),
    id_cuenta_corriente: sOrNull(r.id_cuenta_corriente),

    id_cliente: sOrNull(r.id_cliente),
    id_proveedor: sOrNull(r.id_proveedor),
    id_detalle: sOrNull(r.id_detalle),

    id_medio_pago: nOrNull(r.id_medio_pago),

    monto_total: Math.max(0, Math.round(monto_total * 100) / 100),

    cantidad: Math.max(0, Math.round(cantidad * 1000) / 1000),
    precio: Math.max(0, Math.round(precio * 100) / 100),
    iva_pct: Math.max(0, Math.round(iva_pct * 100) / 100),

    subtotal: Math.max(0, Math.round(subtotal * 100) / 100),
    iva_monto: Math.max(0, Math.round(iva_monto * 100) / 100),
    total: Math.max(0, Math.round(total * 100) / 100),
  };
}

export default function ModalEditarMovimiento({
  open,
  lists,
  row,
  periodoDefault,
  onClose,
  onSave,
  onCatalogCreated,
  onToast,
}) {
  // ✅ dark automático
  const [dark, setDark] = useState(isTemaOscuro());

  useEffect(() => {
    const obs = new MutationObserver(() => setDark(isTemaOscuro()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => onToast?.(tipo, mensaje, duracion),
    [onToast]
  );

  const listsRef = useRef(lists);
  const rowRef = useRef(row);
  const periodoDefaultRef = useRef(periodoDefault);

  useEffect(() => {
    listsRef.current = lists;
  }, [lists]);

  useEffect(() => {
    rowRef.current = row;
  }, [row]);

  useEffect(() => {
    periodoDefaultRef.current = periodoDefault;
  }, [periodoDefault]);

  const [localLists, setLocalLists] = useState(() => ({
    ...SAFE_LISTS,
    ...normalizeIncomingLists(lists),
  }));

  useEffect(() => {
    setLocalLists({ ...SAFE_LISTS, ...normalizeIncomingLists(lists) });
  }, [lists]);

  const safeLists = useMemo(() => localLists, [localLists]);

  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() =>
    buildFormFromRow(row, { ...SAFE_LISTS, ...normalizeIncomingLists(lists) }, periodoDefault)
  );

  const [addUI, setAddUI] = useState({
    open: false,
    field: null,
    text: "",
    saving: false,
  });

  const [clienteInput, setClienteInput] = useState("");
  const [clienteFocus, setClienteFocus] = useState(false);
  const clienteInputRef = useRef(null);

  const [proveedorInput, setProveedorInput] = useState("");
  const [proveedorFocus, setProveedorFocus] = useState(false);
  const proveedorInputRef = useRef(null);

  const [detalleInput, setDetalleInput] = useState("");
  const [detalleFocus, setDetalleFocus] = useState(false);
  const detalleInputRef = useRef(null);

  const closeBtnRef = useRef(null);
  const fechaRef = useRef(null);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;
    if (wasOpen) return;

    setSaving(false);
    setAddUI({ open: false, field: null, text: "", saving: false });

    const merged = { ...SAFE_LISTS, ...normalizeIncomingLists(listsRef.current) };
    setLocalLists(merged);

    const built = buildFormFromRow(rowRef.current, merged, periodoDefaultRef.current);
    setForm(built);

    // ✅ FIX: buscar por id tolerante (no solo x.id)
    const nameById = (arr, id) => {
      const sid = String(id ?? "").trim();
      if (!sid || sid === NULL_OPTION || sid === ADD_OPTION) return "";
      const found = (Array.isArray(arr) ? arr : []).find((x) => String(getIdGeneric(x)) === sid);
      return String(found?.nombre ?? "").trim();
    };

    setClienteInput(nameById(merged.clientes, built.id_cliente));
    setClienteFocus(false);

    setProveedorInput(nameById(merged.proveedores, built.id_proveedor));
    setProveedorFocus(false);

    setDetalleInput(nameById(merged.detalles, built.id_detalle));
    setDetalleFocus(false);

    setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const openDatePicker = useCallback(() => {
    const el = fechaRef.current;
    if (!el) return;
    if (saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }, [saving]);

  const onFechaChange = useCallback((iso) => {
    const v = String(iso || "").trim();
    setForm((p) => {
      const perAuto = periodoFromISODate(v);
      return { ...p, fecha: v, periodo: perAuto || p.periodo };
    });
  }, []);

  const onPeriodoChange = useCallback((raw) => {
    const digits = String(raw || "").replace(/\D/g, "").slice(0, 6);
    let next = "";
    if (digits.length <= 2) next = digits;
    else next = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length === 6) next = normalizePeriodoToMMYYYY(next);
    setForm((p) => ({ ...p, periodo: next }));
  }, []);

  /* =========================
     Lógica condicional (Cliente/Proveedor)
  ========================= */
  const tipoOperacionSeleccionado = form.id_tipo_operacion;

  const getFlagsFromTipoOperacion = useCallback(
    (idTipoOp) => {
      const sid = String(idTipoOp ?? "").trim();
      if (!sid || sid === NULL_OPTION || sid === ADD_OPTION) return { showCliente: false, showProveedor: false };

      // ✅ FIX: buscar id tolerante
      const tipoOp = (Array.isArray(safeLists.tiposOperacion) ? safeLists.tiposOperacion : []).find(
        (t) => String(getIdGeneric(t)) === sid
      );
      const nombreTipo = String(tipoOp?.nombre || "").toLowerCase();

      const showCliente = nombreTipo.includes("venta") || nombreTipo.includes("movimiento");
      const showProveedor = nombreTipo.includes("compra") || nombreTipo.includes("movimiento");

      return { showCliente, showProveedor };
    },
    [safeLists.tiposOperacion]
  );

  const mostrarCliente = useMemo(() => getFlagsFromTipoOperacion(tipoOperacionSeleccionado).showCliente, [
    tipoOperacionSeleccionado,
    getFlagsFromTipoOperacion,
  ]);

  const mostrarProveedor = useMemo(() => getFlagsFromTipoOperacion(tipoOperacionSeleccionado).showProveedor, [
    tipoOperacionSeleccionado,
    getFlagsFromTipoOperacion,
  ]);

  // Tipo de venta
  const tipoVentaSeleccionado = form.id_tipo_venta;

  const tipoVentaEsContado = useMemo(() => {
    if (!tipoVentaSeleccionado || tipoVentaSeleccionado === NULL_OPTION || tipoVentaSeleccionado === ADD_OPTION) return false;
    const tipoVenta = safeLists.tiposVenta.find((t) => String(getIdGeneric(t)) === String(tipoVentaSeleccionado));
    if (!tipoVenta) return false;
    const nombreTipo = String(tipoVenta?.nombre || "").toLowerCase();
    return nombreTipo.includes("contado");
  }, [tipoVentaSeleccionado, safeLists.tiposVenta]);

  const tipoVentaEsCuentaCorriente = useMemo(() => {
    if (!tipoVentaSeleccionado || tipoVentaSeleccionado === NULL_OPTION || tipoVentaSeleccionado === ADD_OPTION) return false;
    const tipoVenta = safeLists.tiposVenta.find((t) => String(getIdGeneric(t)) === String(tipoVentaSeleccionado));
    if (!tipoVenta) return false;
    const nombreTipo = String(tipoVenta?.nombre || "").toLowerCase();
    return nombreTipo.includes("cuenta corriente") || nombreTipo.includes("cta cte");
  }, [tipoVentaSeleccionado, safeLists.tiposVenta]);

  /* =========================
     Item handlers
  ========================= */
  const recalcFromItem = useCallback((nextPartial) => {
    setForm((p) => {
      const next = { ...p, ...nextPartial };

      const cantidad = safeNumber(next.cantidad);
      const precio = safeNumber(next.precio);
      const iva_pct = safeNumber(next.iva_pct);

      const t = calcItemTotals(cantidad, precio, iva_pct);

      next.subtotal = t.subtotal;
      next.iva_monto = t.iva_monto;
      next.total = t.total;
      next.monto_total = t.total;

      return next;
    });
  }, []);

  const onCantidadChange = useCallback((v) => recalcFromItem({ cantidad: v === "" ? "" : Number(v) }), [recalcFromItem]);
  const onPrecioChange = useCallback((v) => recalcFromItem({ precio: v === "" ? "" : Number(v) }), [recalcFromItem]);
  const onIvaPctChange = useCallback((v) => recalcFromItem({ iva_pct: v === "" ? "" : Number(v) }), [recalcFromItem]);

  const onMontoTotalManual = useCallback((v) => {
    const mt = v === "" ? "" : Number(v);
    setForm((p) => {
      const next = { ...p, monto_total: mt };
      const cantidad = Math.max(0, safeNumber(next.cantidad) || 1);
      const iva_pct = Math.max(0, safeNumber(next.iva_pct));

      const factor = cantidad * (1 + iva_pct / 100);
      const precio = factor > 0 ? safeNumber(mt) / factor : safeNumber(mt);

      const t = calcItemTotals(cantidad, precio, iva_pct);

      next.precio = Math.round(precio * 100) / 100;
      next.subtotal = t.subtotal;
      next.iva_monto = t.iva_monto;
      next.total = t.total;

      return next;
    });
  }, []);

  /* =========================
     Alta rápida catálogo
  ========================= */
  const closeAddMini = useCallback(() => {
    if (addUI.saving) return;
    setAddUI({ open: false, field: null, text: "", saving: false });
  }, [addUI.saving]);

  const guardarNuevoCatalogo = useCallback(async () => {
    if (!addUI.field) return;

    const meta = CATALOGO_MAP[addUI.field];
    if (!meta) return;

    const nombre = String(addUI.text || "").trim();
    if (!nombre) {
      showToast("advertencia", "Escribí un nombre antes de guardar.", 2600);
      return;
    }

    setAddUI((p) => ({ ...p, saving: true }));
    showToast("cargando", `Creando ${meta.label}…`, 12000);

    try {
      const data = await crearCatalogoMovimiento({
        catalogo: meta.catalogo,
        nombre,
      });

      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo crear el registro.");

      const newId = Number(data?.item?.id);
      const newNombre = String(data?.item?.nombre ?? "").trim() || nombre;

      if (!Number.isFinite(newId) || newId <= 0) {
        throw new Error("El servidor no devolvió un ID válido del registro creado.");
      }

      const listKey = LISTKEY_BY_CATALOGO[meta.catalogo];
      if (!listKey) throw new Error("Catálogo desconocido para actualizar listas.");

      setLocalLists((prev) => {
        const next = { ...prev };
        const arr = Array.isArray(prev[listKey]) ? prev[listKey].slice() : [];
        if (!arr.some((x) => Number(getIdGeneric(x)) === newId)) {
          arr.push({ id: newId, nombre: newNombre });
        }
        next[listKey] = arr;
        return next;
      });

      setForm((prev) => ({ ...prev, [addUI.field]: String(newId) }));

      if (addUI.field === "id_cliente") {
        setClienteInput(newNombre);
        setTimeout(() => clienteInputRef.current?.focus(), 0);
      }
      if (addUI.field === "id_proveedor") {
        setProveedorInput(newNombre);
        setTimeout(() => proveedorInputRef.current?.focus(), 0);
      }
      if (addUI.field === "id_detalle") {
        setDetalleInput(newNombre);
        setTimeout(() => detalleInputRef.current?.focus(), 0);
      }

      try {
        onCatalogCreated?.(meta.catalogo, { id: newId, nombre: newNombre });
      } catch {}

      setAddUI({ open: false, field: null, text: "", saving: false });
      showToast("exito", `${meta.label} creado: "${newNombre}"`, 2600);
    } catch (e) {
      const msg = e?.message || "Error creando el registro.";
      setAddUI((p) => ({ ...p, saving: false }));
      showToast("error", msg, 4200);
    }
  }, [addUI, onCatalogCreated, showToast]);

  const cerrar = useCallback(() => {
    if (saving) return;
    onClose?.();
  }, [saving, onClose]);

  /* =========================
     Autocomplete: Cliente / Proveedor / Detalle
  ========================= */
  const filteredClientes = useMemo(() => {
    const all = Array.isArray(safeLists.clientes) ? safeLists.clientes : [];
    const q = clienteInput.trim().toLowerCase();
    if (!clienteFocus || q.length < 1) return [];
    return all.filter((c) => String(c?.nombre ?? "").toLowerCase().includes(q)).slice(0, 25);
  }, [safeLists.clientes, clienteInput, clienteFocus]);

  const handleClienteInputChange = useCallback((e) => {
    const value = e.target.value;
    setClienteInput(value);
    setForm((prev) => ({ ...prev, id_cliente: NULL_OPTION }));
  }, []);

  const handleSelectCliente = useCallback((cliente) => {
    const nombre = String(cliente?.nombre ?? "").trim();
    const cid = getIdGeneric(cliente);
    setClienteInput(nombre);
    setForm((prev) => ({ ...prev, id_cliente: cid > 0 ? String(cid) : NULL_OPTION }));
    setClienteFocus(false);
  }, []);

  const startAddCliente = useCallback(() => {
    setClienteFocus(false);
    setAddUI({ open: true, field: "id_cliente", text: "", saving: false });
    setForm((prev) => ({ ...prev, id_cliente: ADD_OPTION }));
  }, []);

  const filteredProveedores = useMemo(() => {
    const all = Array.isArray(safeLists.proveedores) ? safeLists.proveedores : [];
    const q = proveedorInput.trim().toLowerCase();
    if (!proveedorFocus || q.length < 1) return [];
    return all.filter((p) => String(p?.nombre ?? "").toLowerCase().includes(q)).slice(0, 25);
  }, [safeLists.proveedores, proveedorInput, proveedorFocus]);

  const handleProveedorInputChange = useCallback((e) => {
    const value = e.target.value;
    setProveedorInput(value);
    setForm((prev) => ({ ...prev, id_proveedor: NULL_OPTION }));
  }, []);

  const handleSelectProveedor = useCallback((prov) => {
    const nombre = String(prov?.nombre ?? "").trim();
    const pid = getIdGeneric(prov);
    setProveedorInput(nombre);
    setForm((prev) => ({ ...prev, id_proveedor: pid > 0 ? String(pid) : NULL_OPTION }));
    setProveedorFocus(false);
  }, []);

  const startAddProveedor = useCallback(() => {
    setProveedorFocus(false);
    setAddUI({ open: true, field: "id_proveedor", text: "", saving: false });
    setForm((prev) => ({ ...prev, id_proveedor: ADD_OPTION }));
  }, []);

  const filteredDetalles = useMemo(() => {
    const all = Array.isArray(safeLists.detalles) ? safeLists.detalles : [];
    const q = detalleInput.trim().toLowerCase();
    if (!detalleFocus || q.length < 1) return [];
    return all.filter((d) => String(d?.nombre ?? "").toLowerCase().includes(q)).slice(0, 25);
  }, [safeLists.detalles, detalleInput, detalleFocus]);

  const handleDetalleInputChange = useCallback((e) => {
    const value = e.target.value;
    setDetalleInput(value);
    setForm((prev) => ({ ...prev, id_detalle: NULL_OPTION }));
  }, []);

  const handleSelectDetalle = useCallback((det) => {
    const nombre = String(det?.nombre ?? "").trim();
    const did = getIdGeneric(det);
    setDetalleInput(nombre);
    setForm((prev) => ({ ...prev, id_detalle: did > 0 ? String(did) : NULL_OPTION }));
    setDetalleFocus(false);
  }, []);

  const startAddDetalle = useCallback(() => {
    setDetalleFocus(false);
    setAddUI({ open: true, field: "id_detalle", text: "", saving: false });
    setForm((prev) => ({ ...prev, id_detalle: ADD_OPTION }));
  }, []);

  /* =========================
     Payload final
  ========================= */
  const payload = useMemo(() => {
    const isAdd = (v) => v === ADD_OPTION;

    const toNullableId = (v) => {
      if (v === NULL_OPTION || v === "" || v == null) return null;
      if (isAdd(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const cantidad = Math.max(0, safeNumber(form.cantidad));
    const precio = Math.max(0, safeNumber(form.precio));
    const iva_pct = Math.max(0, safeNumber(form.iva_pct));

    const t = calcItemTotals(cantidad, precio, iva_pct);

    return {
      id_movimiento: form.id_movimiento,

      fecha: form.fecha,
      periodo: periodoMMYYYY_to_YYYYMM(normalizePeriodoToMMYYYY(form.periodo)),

      id_clasificacion: toNullableId(form.id_clasificacion),
      id_tipo_operacion: toNullableId(form.id_tipo_operacion),
      id_tipo_venta: toNullableId(form.id_tipo_venta),
      id_cuenta_corriente: null,


      id_cliente: toNullableId(form.id_cliente),
      id_proveedor: toNullableId(form.id_proveedor),
      id_detalle: toNullableId(form.id_detalle),

      id_medio_pago: toNullableId(form.id_medio_pago),

      cantidad: Math.round(cantidad * 1000) / 1000,
      precio: Math.round(precio * 100) / 100,
      iva_pct: Math.round(iva_pct * 100) / 100,
      subtotal: t.subtotal,
      iva_monto: t.iva_monto,
      total: t.total,
      monto_total: Math.max(0, Math.round(t.total * 100) / 100),
    };
  }, [form]);

  const submit = async (e) => {
    e.preventDefault();

    if (addUI.open) {
      showToast("advertencia", "Terminá de crear el registro (o cancelá) antes de guardar.", 3200);
      return;
    }

    setSaving(true);
    showToast("cargando", "Guardando cambios…", 12000);

    try {
      if (!form.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) {
        throw new Error("Fecha inválida.");
      }

      const perUI = normalizePeriodoToMMYYYY(form.periodo);
      const perAuto = periodoFromISODate(form.fecha);
      const finalPer = perUI || perAuto;

      const addFields = [
        ["id_clasificacion", "Clasificación"],
        ["id_tipo_operacion", "Tipo de operación"],
        ["id_tipo_venta", "Tipo de venta"],
        ["id_medio_pago", "Medio de pago"],
        ["id_cuenta_corriente", "Cuenta corriente"],
        ["id_cliente", "Cliente"],
        ["id_proveedor", "Proveedor"],
        ["id_detalle", "Detalle"],
      ];
      const hasAdd = addFields.filter(([k]) => form[k] === ADD_OPTION);
      if (hasAdd.length) {
        const labels = hasAdd.map((x) => x[1]).join(", ");
        showToast("advertencia", `Tenés en "AGREGAR…" (${labels}). Se guardará sin ese campo (null).`, 3800);
      }

      const cantidad = Math.max(0, safeNumber(form.cantidad));
      const precio = Math.max(0, safeNumber(form.precio));
      const iva_pct = Math.max(0, safeNumber(form.iva_pct));
      const t = calcItemTotals(cantidad, precio, iva_pct);

      const payloadFinal = {
        ...payload,
        periodo: periodoMMYYYY_to_YYYYMM(finalPer || ""),
        cantidad: Math.round(cantidad * 1000) / 1000,
        precio: Math.round(precio * 100) / 100,
        iva_pct: Math.round(iva_pct * 100) / 100,
        subtotal: t.subtotal,
        iva_monto: t.iva_monto,
        total: t.total,
        monto_total: Math.max(0, Math.round(t.total * 100) / 100),
      };

      await onSave?.(payloadFinal);

      showToast("exito", "Movimiento actualizado.", 2400);
      onClose?.();
    } catch (e2) {
      showToast("error", e2?.message || "Error guardando movimiento.", 4200);
      setSaving(false);
    }
  };

  /* =========================
     UI helpers: select + inline add
  ========================= */
  const onSelectWithAdd = useCallback(
    (field, rawValue) => {
      if (rawValue === ADD_OPTION) {
        const isMini = field === "id_cliente" || field === "id_proveedor" || field === "id_detalle";
        if (isMini) return;
        setAddUI({ open: false, field, text: "", saving: false });
        setForm((p) => ({ ...p, [field]: ADD_OPTION }));
        return;
      }

      if (addUI.field === field && !addUI.open) {
        setAddUI({ open: false, field: null, text: "", saving: false });
      }

      setForm((p) => ({ ...p, [field]: rawValue }));
    },
    [addUI.field, addUI.open]
  );

  const handleTipoOperacionChange = useCallback(
    (nextValue) => {
      if (nextValue === ADD_OPTION) {
        onSelectWithAdd("id_tipo_operacion", nextValue);
        return;
      }

      const { showCliente, showProveedor } = getFlagsFromTipoOperacion(nextValue);

      setForm((prev) => ({
        ...prev,
        id_tipo_operacion: nextValue,
        id_cliente: showCliente ? prev.id_cliente : NULL_OPTION,
        id_proveedor: showProveedor ? prev.id_proveedor : NULL_OPTION,
      }));

      if (!showCliente) setClienteInput("");
      if (!showProveedor) setProveedorInput("");

      setClienteFocus(false);
      setProveedorFocus(false);
    },
    [getFlagsFromTipoOperacion, onSelectWithAdd]
  );

  const renderAddInline = (field) => {
    if (addUI.open) return null;
    if (addUI.field !== field) return null;
    if (field === "id_cliente" || field === "id_proveedor" || field === "id_detalle") return null;

    const label = CATALOGO_MAP[field]?.label || "Registro";

    return (
      <div className="mi-addInline">
        <div className="fl-field">
          <input
            className="fl-input"
            placeholder=" "
            value={addUI.text}
            onChange={(e) => setAddUI((p) => ({ ...p, text: e.target.value }))}
            disabled={addUI.saving}
          />
          <label className="fl-label">{`Nuevo ${label}`}</label>
        </div>

        <div className="mi-addInline__actions">
          <button
            type="button"
            className="mit-btn mit-btn--ghost"
            onClick={() => {
              setAddUI({ open: false, field: null, text: "", saving: false });
              setForm((p) => ({ ...p, [field]: NULL_OPTION }));
            }}
            disabled={addUI.saving}
          >
            Cancelar
          </button>

          <button type="button" className="mit-btn mit-btn--solid" onClick={guardarNuevoCatalogo} disabled={addUI.saving}>
            {addUI.saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    );
  };

  const miniOpen = addUI.open && ["id_cliente", "id_proveedor", "id_detalle"].includes(addUI.field);
  const miniTitle =
    addUI.field === "id_cliente" ? "Nuevo cliente" : addUI.field === "id_proveedor" ? "Nuevo proveedor" : "Nuevo detalle";

  const cancelMini = () => {
    setForm((p) => ({
      ...p,
      id_cliente: addUI.field === "id_cliente" ? NULL_OPTION : p.id_cliente,
      id_proveedor: addUI.field === "id_proveedor" ? NULL_OPTION : p.id_proveedor,
      id_detalle: addUI.field === "id_detalle" ? NULL_OPTION : p.id_detalle,
    }));
    closeAddMini();
  };

  if (!open) return null;

  const modalClass = `mi-modal__container mi-modal__container--mov ${dark ? "mi-modal--dark" : ""}`;

  return createPortal(
    <div
      className={["mi-modal__overlay", "mi-modal__overlay--mov", dark ? "mi-modal__overlay--dark" : ""].join(" ").trim()}
      onMouseDown={cerrar}
    >
      <div className={modalClass} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mi-modal__header">
          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">Editar movimiento</h2>
            <p className="mi-modal__subtitle">Actualizá los campos y guardá.</p>
          </div>

          <button
            ref={closeBtnRef}
            className="mi-modal__close"
            onClick={cerrar}
            aria-label="Cerrar"
            disabled={saving}
            type="button"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="mi-em-form">
          <div className="mi-em-grid">
            {/* Izquierda */}
            <section className="mi-em-panel">
              <div className="mi-em-panelHead">Datos del movimiento</div>

              <div className="mi-em-panelBody">
                <div className="fl-grid">
                  {/* 3 cols */}
                  <div className="mi-row3 fl-col-full">
                    {/* Clasificación */}
                    <div className="fl-field">
                      <select
                        className="fl-input fl-select"
                        value={String(form.id_clasificacion)}
                        onChange={(e) => onSelectWithAdd("id_clasificacion", e.target.value)}
                        disabled={saving}
                      >
                        <option value={NULL_OPTION}>-- Clasificación --</option>
                        {(safeLists.clasificaciones || []).map((x) => {
                          const xid = getIdGeneric(x);
                          return (
                            <option key={xid || x.id} value={String(xid || x.id || "")}>
                              {x.nombre}
                            </option>
                          );
                        })}
                        <option value={ADD_OPTION}>OTRO (AGREGAR…)</option>
                      </select>
                      <label className="fl-label">Clasificación</label>
                      {renderAddInline("id_clasificacion")}
                    </div>

                    {/* Tipo de operación */}
                    <div className="fl-field">
                      <select
                        className="fl-input fl-select"
                        value={String(form.id_tipo_operacion)}
                        onChange={(e) => handleTipoOperacionChange(e.target.value)}
                        disabled={saving}
                      >
                        <option value={NULL_OPTION}>-- Tipo de operación --</option>
                        {(safeLists.tiposOperacion || []).map((x) => {
                          const xid = getIdGeneric(x);
                          return (
                            <option key={xid || x.id} value={String(xid || x.id || "")}>
                              {x.nombre}
                            </option>
                          );
                        })}
                        <option value={ADD_OPTION}>OTRO (AGREGAR…)</option>
                      </select>
                      <label className="fl-label">Tipo de operación</label>
                      {renderAddInline("id_tipo_operacion")}
                    </div>


                  </div>

                  {/* 2 cols */}
                  <div className="mi-row2 fl-col-full  ">
                    {/* Detalle */}
                    <div className="fl-field mi-autocomplete fl-col-full--detalle" >
                      <input
                        ref={detalleInputRef}
                        className="fl-input"
                        placeholder=" "
                        value={detalleInput}
                        onChange={handleDetalleInputChange}
                        onFocus={() => setDetalleFocus(true)}
                        onBlur={() => setTimeout(() => setDetalleFocus(false), 120)}
                        disabled={saving || addUI.open}
                        autoComplete="off"
                      />
                      <label className="fl-label">Detalle</label>

                      {detalleFocus && filteredDetalles.length > 0 && (
                        <ul className="mi-cr-suggest">
                          {filteredDetalles.map((d) => {
                            const did = getIdGeneric(d);
                            return (
                              <li
                                key={did || d.id}
                                className="mi-cr-suggest__item"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectDetalle(d);
                                }}
                              >
                                {d.nombre}
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      <button type="button" onClick={startAddDetalle} className="mi-link" disabled={saving || addUI.saving}>
                        + Agregar nuevo detalle
                      </button>
                    </div>


                  </div>

                  {/* Item editable */}
                  <div className="mi-em-item fl-col-full">
                    <div className="mi-em-itemTitle">Ítem del movimiento (editable)</div>

                    <div className="mi-em-itemGrid3">
                      <div className="fl-field">
                        <input
                          className="fl-input"
                          type="number"
                          min="0"
                          step="0.001"
                          placeholder=" "
                          value={form.cantidad}
                          onChange={(e) => onCantidadChange(e.target.value)}
                          disabled={saving}
                        />
                        <label className="fl-label">Cantidad</label>
                      </div>

                      <div className="fl-field">
                        <input
                          className="fl-input"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder=" "
                          value={form.precio}
                          onChange={(e) => onPrecioChange(e.target.value)}
                          disabled={saving}
                        />
                        <label className="fl-label">Precio unitario</label>
                      </div>

                      <div className="fl-field">
                        <select
                          className="fl-input fl-select"
                          value={String(form.iva_pct)}
                          onChange={(e) => onIvaPctChange(e.target.value)}
                          disabled={saving}
                        >
                          {IVA_OPTIONS.map((x) => (
                            <option key={x.value} value={x.value}>
                              {x.label}
                            </option>
                          ))}
                        </select>
                        <label className="fl-label">IVA %</label>
                      </div>
                    </div>

                    <div className="mi-em-itemTotalsGrid3">
                      <div className="fl-field">
                        <input className="fl-input" value={form.subtotal} disabled />
                        <label className="fl-label">Subtotal</label>
                      </div>
                      <div className="fl-field">
                        <input className="fl-input" value={form.iva_monto} disabled />
                        <label className="fl-label">IVA $</label>
                      </div>
                      <div className="fl-field">
                        <input className="fl-input" value={form.total} disabled />
                        <label className="fl-label">Total</label>
                      </div>
                    </div>
                  </div>

                  <div className="fl-field fl-col-full">
                    <input
                      className="fl-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder=" "
                      value={form.monto_total}
                      onChange={(e) => onMontoTotalManual(e.target.value)}
                      disabled={saving}
                    />
                    <label className="fl-label">Monto total (ajusta el precio)</label>
                  </div>
                </div>
              </div>
            </section>

            {/* Derecha */}
            <aside className="mi-em-aside">
              <div className="mi-em-asideTitle">Relaciones y pago</div>

              <div className="mi-em-dates">
                <div className="fl-field">
                  <input
                    ref={fechaRef}
                    className="fl-input"
                    type="date"
                    value={form.fecha}
                    onChange={(e) => onFechaChange(e.target.value)}
                    disabled={saving}
                    onClick={openDatePicker}
                    onFocus={openDatePicker}
                  />
                  <label className="fl-label">Fecha</label>
                </div>

                <div className="fl-field">
                  <input
                    className="fl-input"
                    placeholder="MM-YYYY"
                    inputMode="numeric"
                    value={form.periodo}
                    onChange={(e) => onPeriodoChange(e.target.value)}
                    disabled={saving}
                  />
                  <label className="fl-label">Período</label>
                </div>
              </div>

              <div className="mi-em-asideBody">
              {/* Tipo de venta (derecha) */}
<div className="fl-field">
  <select
    className="fl-input fl-select"
    value={String(form.id_tipo_venta)}
    onChange={(e) => {
      onSelectWithAdd("id_tipo_venta", e.target.value);
      setForm((p) => ({
        ...p,
        id_medio_pago: NULL_OPTION,
        id_cuenta_corriente: NULL_OPTION,
      }));
    }}
    disabled={saving}
  >
    <option value={NULL_OPTION}>-- Tipo de venta --</option>
    {(safeLists.tiposVenta || []).map((x) => {
      const xid = getIdGeneric(x);
      return (
        <option key={xid || x.id} value={String(xid || x.id || "")}>
          {x.nombre}
        </option>
      );
    })}
    <option value={ADD_OPTION}>OTRO (AGREGAR…)</option>
  </select>
  <label className="fl-label">Tipo de venta</label>
  {renderAddInline("id_tipo_venta")}
</div>



                {/* Medio pago - condicional según tipo de venta */}
                {tipoVentaEsContado && (
                  <div className="fl-field">
                    <select
                      className="fl-input fl-select"
                      value={String(form.id_medio_pago)}
                      onChange={(e) => onSelectWithAdd("id_medio_pago", e.target.value)}
                      disabled={saving}
                    >
                      <option value={NULL_OPTION}>-- Seleccionar medio de pago --</option>
                      {(safeLists.mediosPago || []).map((x) => {
                        const xid = getIdGeneric(x);
                        return (
                          <option key={xid || x.id} value={String(xid || x.id || "")}>
                            {x.nombre}
                          </option>
                        );
                      })}
                      <option value={ADD_OPTION}>OTRO (AGREGAR…)</option>
                    </select>
                    <label className="fl-label">Medio de pago</label>
                    {renderAddInline("id_medio_pago")}
                  </div>
                )}

                {/* Cliente - condicional según tipo de operación */}
                {mostrarCliente && (
                  <div className="fl-field mi-autocomplete">
                    <input
                      ref={clienteInputRef}
                      className="fl-input"
                      placeholder=" "
                      value={clienteInput}
                      onChange={handleClienteInputChange}
                      onFocus={() => setClienteFocus(true)}
                      onBlur={() => setTimeout(() => setClienteFocus(false), 120)}
                      disabled={saving || addUI.open}
                      autoComplete="off"
                    />
                    <label className="fl-label">Cliente</label>

                    {clienteFocus && filteredClientes.length > 0 && (
                      <ul className="mi-cr-suggest">
                        {filteredClientes.map((c) => {
                          const cid = getIdGeneric(c);
                          return (
                            <li
                              key={cid || c.id}
                              className="mi-cr-suggest__item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectCliente(c);
                              }}
                            >
                              <span className="mi-suggestText">{c.nombre}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <button type="button" onClick={startAddCliente} disabled={saving || addUI.saving} className="mi-link">
                      + Agregar nuevo cliente
                    </button>
                  </div>
                )}

                {/* Proveedor - condicional según tipo de operación */}
                {mostrarProveedor && (
                  <div className="fl-field mi-autocomplete">
                    <input
                      ref={proveedorInputRef}
                      className="fl-input"
                      placeholder=" "
                      value={proveedorInput}
                      onChange={handleProveedorInputChange}
                      onFocus={() => setProveedorFocus(true)}
                      onBlur={() => setTimeout(() => setProveedorFocus(false), 120)}
                      disabled={saving || addUI.open}
                      autoComplete="off"
                    />
                    <label className="fl-label">Proveedor</label>

                    {proveedorFocus && filteredProveedores.length > 0 && (
                      <ul className="mi-cr-suggest">
                        {filteredProveedores.map((p) => {
                          const pid = getIdGeneric(p);
                          return (
                            <li
                              key={pid || p.id}
                              className="mi-cr-suggest__item"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectProveedor(p);
                              }}
                            >
                              <span className="mi-suggestText">{p.nombre}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <button
                      type="button"
                      onClick={startAddProveedor}
                      disabled={saving || addUI.saving}
                      className="mi-link"
                    >
                      + Agregar nuevo proveedor
                    </button>
                  </div>
                )}

                <div className="mi-em-actions">
                  <button type="submit" disabled={saving} className="mit-btn mit-btn--solid mit-btn--block">
                    {saving ? "Guardando..." : "Guardar"}
                  </button>

                  <button type="button" onClick={cerrar} disabled={saving} className="mit-btn mit-btn--ghost mit-btn--block">
                    Cancelar
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </form>

        <AddCatalogMiniModal
          open={miniOpen}
          title={miniTitle}
          value={addUI.text}
          saving={addUI.saving}
          onChange={(txt) => setAddUI((p) => ({ ...p, text: txt }))}
          onCancel={cancelMini}
          onSave={guardarNuevoCatalogo}
          dark={dark}
        />
      </div>
    </div>,
    document.body
  );
}
