import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../RecibosModals.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faReceipt,
  faCalendarDays,
  faUser,
  faBoxOpen,
  faDollarSign,
} from "@fortawesome/free-solid-svg-icons";
import { recibosFetch } from "../api/recibosApi.js";


const NULL_OPTION = "";
const IVA_OPTIONS = [
  { value: "0", label: "0 %" },
  { value: "10.5", label: "10,5 %" },
  { value: "21", label: "21 %" },
  { value: "27", label: "27 %" },
];

/* =========================
   Helpers
========================= */
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(v) {
  return Math.round(safeNumber(v) * 100) / 100;
}

function roundQuantity(v) {
  return Math.round(safeNumber(v) * 1000000) / 1000000;
}

function moneyARS(v) {
  try {
    return Number(v || 0).toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${safeNumber(v).toFixed(2)}`;
  }
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodoToMMYYYY(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [yyyy, mmRaw] = s.split("-");
    const mm = String(Number(mmRaw)).padStart(2, "0");
    return `${mm}-${yyyy}`;
  }
  if (/^\d{1,2}-\d{4}$/.test(s)) {
    const [mmRaw, yyyy] = s.split("-");
    const mm = String(Number(mmRaw)).padStart(2, "0");
    return `${mm}-${yyyy}`;
  }
  return s;
}

function periodoToYYYYMM(input) {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (/^\d{1,2}-\d{4}$/.test(s)) {
    const [mmRaw, yyyy] = s.split("-");
    const mm = String(Number(mmRaw)).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  if (/^\d{4}-\d{1,2}$/.test(s)) {
    const [yyyy, mmRaw] = s.split("-");
    const mm = String(Number(mmRaw)).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  return s;
}

function periodoFromISODate(iso) {
  const s = String(iso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [, m] = s.split("-");
  return `${m}-${s.slice(0, 4)}`;
}

function normalizeSearchText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDarkEnabled(darkProp) {
  if (darkProp === true) return true;
  if (typeof document === "undefined") return false;
  const byAttr = document.documentElement.getAttribute("data-theme") === "oscuro";
  const byBody = document.body?.classList?.contains("dark");
  return Boolean(byAttr || byBody);
}

function getAuthInfo() {
  const sessionKey =
    localStorage.getItem("session_key") ||
    "";

  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand =
      u?.idUsuarioMaster ??
      u?.idUsuario ??
      u?.id_usuario ??
      u?.id ??
      u?.user_id ??
      0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}

  return { sessionKey, idUsuario };
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.length > 600 ? `${text.slice(0, 600)}...` : text;
    throw new Error(`Respuesta inválida (no JSON). HTTP ${res.status}\n${preview}`);
  }

  if (!res.ok) {
    const msg = data?.mensaje || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

async function apiGetJson(url) {
  const { sessionKey } = getAuthInfo();
  const headers = {};
  if (sessionKey) headers["X-Session"] = sessionKey;

  const res = await recibosFetch(url, { method: "GET", headers });
  return await parseJsonOrThrow(res);
}

function getArr(x) {
  return Array.isArray(x) ? x : [];
}

function getServicioId(x) {
  const cand = x?.id_servicio ?? x?.idServicio ?? x?.servicio_id ?? x?.id ?? 0;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getServicioNombre(x) {
  return String(x?.servicio_nombre ?? x?.nombre ?? x?.descripcion ?? "").trim();
}

function getCatalogPrecio(x) {
  const n = Number(x?.precio_venta ?? x?.precio ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getCatalogIva(x) {
  const n = Number(x?.iva_pct ?? x?.ivaPct ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function getProductoId(x) {
  const cand =
    x?.id_stock_producto ??
    x?.idStockProducto ??
    x?.stock_producto_id ??
    x?.id_producto ??
    x?.idProducto ??
    x?.producto_id ??
    x?.idProductoStock ??
    x?.id_stock ??
    x?.id ??
    x?.ID ??
    0;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getProductoVarianteId(x) {
  const cand =
    x?.id_stock_variante ??
    x?.idStockVariante ??
    x?.stock_variante_id ??
    x?.id_variante ??
    x?.idVariante ??
    x?.variante_id ??
    0;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getProductoVarianteNombre(x) {
  return String(
    x?.nombre_variante ??
      x?.variante_nombre ??
      x?.stock_variante_nombre ??
      x?.stock_variante_nombre_raw ??
      x?.variante ??
      ""
  ).trim();
}

function getProductoDisplayNombre(x) {
  const direct = String(x?.label ?? "").trim();
  if (direct) return direct;
  const producto = getProductoNombre(x);
  const variante = getProductoVarianteNombre(x);
  return [producto, variante].filter(Boolean).join(" - ") || producto;
}

function getClienteId(x) {
  const cand = x?.id_cliente ?? x?.idCliente ?? x?.cliente_id ?? x?.id ?? 0;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getProductoNombre(x) {
  return String(
    x?.producto_nombre ??
      x?.stock_producto_nombre ??
      x?.nombre_producto ??
      x?.detalle_nombre ??
      x?.nombre ??
      x?.descripcion ??
      ""
  ).trim();
}

function getClienteNombre(x) {
  return String(x?.cliente_nombre ?? x?.cliente ?? x?.nombre ?? x?.razon_social ?? x?.razon_social_cliente ?? "").trim();
}

function getMovimientoItems(row) {
  const raw = row?.items_detalle ?? row?.itemsDetalle ?? row?.items ?? row?.productos ?? [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getPrimerItem(row) {
  const items = getMovimientoItems(row);
  return items.length ? items[0] : null;
}

function calcTotals(cantidad, precio, ivaPct) {
  const c = Math.max(0, safeNumber(cantidad));
  const p = Math.max(0, safeNumber(precio));
  const iva = Math.max(0, safeNumber(ivaPct));
  const subtotal = round2(c * p);
  const iva_monto = round2(subtotal * iva / 100);
  const total = round2(subtotal + iva_monto);
  return { subtotal, iva_monto, total };
}

function nameById(arr, id, getId, getName) {
  const sid = String(id ?? "").trim();
  if (!sid) return "";
  const found = getArr(arr).find((x) => String(getId(x)) === sid);
  return found ? getName(found) : "";
}

/* =========================
   Lists normalize
========================= */
function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src.listas && typeof src.listas === "object" ? src.listas : src;

  const productos =
    Array.isArray(l.articulos_stock) && l.articulos_stock.length
      ? l.articulos_stock
      : Array.isArray(l.articulosStock) && l.articulosStock.length
      ? l.articulosStock
      : Array.isArray(l.productos) && l.productos.length
      ? l.productos
      : Array.isArray(l.stockProductos) && l.stockProductos.length
      ? l.stockProductos
      : Array.isArray(l.stock_productos) && l.stock_productos.length
      ? l.stock_productos
      : [];

  const servicios =
    Array.isArray(l.servicios_movimiento) && l.servicios_movimiento.length
      ? l.servicios_movimiento
      : Array.isArray(l.serviciosMovimiento) && l.serviciosMovimiento.length
      ? l.serviciosMovimiento
      : [];

  return {
    productos,
    servicios,
    clientes: Array.isArray(l.clientes) ? l.clientes : [],
  };
}

/* =========================
   Modal
========================= */
export default function ModalEditarRecibo({
  open,
  row,
  lists,
  periodoDefault,
  onClose,
  onSave,
  onToast,
  dark,
}) {
  const API_LISTS = `${BASE_URL}/api.php?action=global_obtener_listas`;
  const darkOn = isDarkEnabled(dark);

  const showToast = useCallback((tipo, mensaje) => onToast?.(tipo, mensaje), [onToast]);

  const [saving, setSaving] = useState(false);
  const [localLists, setLocalLists] = useState(() => normalizeLists(lists));
  const [productoFocus, setProductoFocus] = useState(false);
  const [productoArmed, setProductoArmed] = useState(false);
  const [clienteFocus, setClienteFocus] = useState(false);
  const [clienteArmed, setClienteArmed] = useState(false);

  const closeBtnRef = useRef(null);
  const fechaInputRef = useRef(null);

  useEffect(() => setLocalLists(normalizeLists(lists)), [lists]);

  const refreshLists = useCallback(async () => {
    const data = await apiGetJson(API_LISTS);
    const normalized = normalizeLists(data);
    setLocalLists((prev) => ({
      productos: normalized.productos?.length ? normalized.productos : prev.productos,
      servicios: normalized.servicios?.length ? normalized.servicios : prev.servicios,
      clientes: normalized.clientes?.length ? normalized.clientes : prev.clientes,
    }));
  }, [API_LISTS]);

  const defaultsRef = useRef({
    fecha: "",
    periodoMMYYYY: "",
    id_cliente: NULL_OPTION,
    clienteTxt: "",
    tipo_item: "ARTICULO",
    id_servicio: NULL_OPTION,
    id_stock_producto: NULL_OPTION,
    id_stock_variante: NULL_OPTION,
    productoTxt: "",
    cantidad: 1,
    precio: 0,
    iva_pct: 0,
  });

  const [form, setForm] = useState(() => ({
    id_movimiento: null,
    fecha: "",
    periodo: "",
    id_cliente: NULL_OPTION,
    clienteInput: "",
    tipo_item: "ARTICULO",
    id_servicio: NULL_OPTION,
    id_stock_producto: NULL_OPTION,
    id_stock_variante: NULL_OPTION,
    productoInput: "",
    cantidad: "1",
    precio: "",
    iva_pct: "0",
  }));

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    refreshLists().catch(() => {});

    const r = row || {};
    const item = getPrimerItem(r) || {};
    const fecha = String(r.fecha || "").slice(0, 10);
    const perRow = periodoToMMYYYY(r.periodo);
    const perDef = periodoToMMYYYY(periodoDefault);
    const perAuto = periodoFromISODate(fecha);

    const idCliente = r.id_cliente ?? r.cliente_id ?? r.idCliente ?? NULL_OPTION;
    const idServicio =
      item?.id_servicio ?? item?.idServicio ?? item?.servicio_id ??
      r.id_servicio ?? r.idServicio ?? r.servicio_id ?? NULL_OPTION;
    const tipoItem = Number(idServicio || 0) > 0 ? "SERVICIO" : "ARTICULO";
    const idProd = tipoItem === "ARTICULO"
      ? (item?.id_articulo ?? item?.idArticulo ?? item?.id_stock_producto ?? item?.idStockProducto ?? item?.stock_producto_id ??
         r.id_articulo ?? r.idArticulo ?? r.id_stock_producto ?? r.idStockProducto ?? r.stock_producto_id ?? NULL_OPTION)
      : NULL_OPTION;
    const idVar = NULL_OPTION;

    const cliNameFromList = nameById(localLists.clientes, idCliente, getClienteId, getClienteNombre);
    const catalogNameFromList = tipoItem === "SERVICIO"
      ? nameById(localLists.servicios, idServicio, getServicioId, getServicioNombre)
      : nameById(localLists.productos, idProd, getProductoId, getProductoNombre);

    const clienteFallback = String(r.cliente ?? r.cliente_nombre ?? "").trim();
    const productoFallback =
      (tipoItem === "SERVICIO" ? String(item?.servicio_nombre ?? r.servicio_nombre ?? "").trim() : "") ||
      String(item?.descripcion ?? item?.detalle ?? "").trim() ||
      getProductoNombre(item) ||
      String(r.articulo_nombre ?? r.producto_nombre ?? r.stock_producto_nombre ?? r.detalle_original ?? "").split("|")[0].trim() ||
      String(r.detalle ?? r.descripcion ?? "").replace(/^\s*\d+(?:[.,]\d+)?\s*x\s*/i, "").trim();
    const productoTxt = (catalogNameFromList || productoFallback || "").trim();

    const cantidad = Math.max(0, safeNumber(item?.cantidad ?? r.cantidad ?? 1)) || 1;
    const precio = Math.max(0, safeNumber(item?.precio ?? r.precio ?? (safeNumber(r.monto_total ?? r.total) / cantidad)));
    const ivaPct = Math.max(0, safeNumber(item?.iva_pct ?? item?.ivaPct ?? r.iva_pct ?? 0));

    defaultsRef.current = {
      fecha: fecha || "",
      periodoMMYYYY: perRow || perDef || perAuto || "",
      id_cliente: String(idCliente ?? NULL_OPTION),
      clienteTxt: (cliNameFromList || clienteFallback || "").trim(),
      tipo_item: tipoItem,
      id_servicio: tipoItem === "SERVICIO" ? String(idServicio ?? NULL_OPTION) : NULL_OPTION,
      id_stock_producto: tipoItem === "ARTICULO" ? String(idProd ?? NULL_OPTION) : NULL_OPTION,
      id_stock_variante: NULL_OPTION,
      productoTxt,
      cantidad: roundQuantity(cantidad),
      precio: round2(precio),
      iva_pct: round2(ivaPct),
    };

    setSaving(false);
    setProductoFocus(false);
    setProductoArmed(false);
    setClienteFocus(false);
    setClienteArmed(false);

    setForm({
      id_movimiento: safeNumber(r.id_movimiento ?? r.id) || null,
      fecha: defaultsRef.current.fecha,
      periodo: defaultsRef.current.periodoMMYYYY,
      id_cliente: defaultsRef.current.id_cliente,
      clienteInput: defaultsRef.current.clienteTxt,
      tipo_item: defaultsRef.current.tipo_item,
      id_servicio: defaultsRef.current.id_servicio,
      id_stock_producto: defaultsRef.current.id_stock_producto,
      id_stock_variante: NULL_OPTION,
      productoInput: defaultsRef.current.productoTxt,
      cantidad: String(defaultsRef.current.cantidad || 1),
      precio: defaultsRef.current.precio ? String(defaultsRef.current.precio) : "",
      iva_pct: String(defaultsRef.current.iva_pct || 0),
    });

    setTimeout(() => closeBtnRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, periodoDefault]);

  useEffect(() => {
    if (!open || saving) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, saving, onClose]);

  const openNativeDatePicker = useCallback(
    (input) => {
      if (!input || saving) return;
      input.focus();
      if (typeof input.showPicker === "function") {
        try { input.showPicker(); } catch {}
      }
    },
    [saving]
  );

  const filteredProductos = useMemo(() => {
    const esServicio = form.tipo_item === "SERVICIO";
    const all = getArr(esServicio ? localLists.servicios : localLists.productos);
    const getNombre = esServicio ? getServicioNombre : getProductoNombre;
    const q = normalizeSearchText(form.productoInput);
    if (!productoFocus || !productoArmed || q.length < 1) return [];
    return all.filter((p) => normalizeSearchText(getNombre(p)).includes(q)).slice(0, 25);
  }, [localLists.productos, localLists.servicios, form.tipo_item, form.productoInput, productoFocus, productoArmed]);

  const filteredClientes = useMemo(() => {
    const all = getArr(localLists.clientes);
    const q = normalizeSearchText(form.clienteInput);
    if (!clienteFocus || !clienteArmed || q.length < 1) return [];
    return all.filter((p) => normalizeSearchText(getClienteNombre(p)).includes(q)).slice(0, 25);
  }, [localLists.clientes, form.clienteInput, clienteFocus, clienteArmed]);

  const findExactProducto = useCallback((value) => {
    const q = normalizeSearchText(value);
    if (!q) return null;
    const esServicio = form.tipo_item === "SERVICIO";
    const all = getArr(esServicio ? localLists.servicios : localLists.productos);
    const getNombre = esServicio ? getServicioNombre : getProductoNombre;
    return all.find((p) => normalizeSearchText(getNombre(p)) === q) || null;
  }, [localLists.productos, localLists.servicios, form.tipo_item]);

  const findExactCliente = useCallback((value) => {
    const q = normalizeSearchText(value);
    if (!q) return null;
    return getArr(localLists.clientes).find((p) => normalizeSearchText(getClienteNombre(p)) === q) || null;
  }, [localLists.clientes]);

  const handleProductoInputChange = (e) => {
    const value = e.target.value;
    const exact = findExactProducto(value);
    const esServicio = form.tipo_item === "SERVICIO";
    setProductoArmed(true);
    setForm((p) => ({
      ...p,
      productoInput: value,
      id_servicio: esServicio && exact ? String(getServicioId(exact)) : NULL_OPTION,
      id_stock_producto: !esServicio && exact ? String(getProductoId(exact)) : NULL_OPTION,
      id_stock_variante: NULL_OPTION,
    }));
  };

  const handleSelectProducto = (prod) => {
    const esServicio = form.tipo_item === "SERVICIO";
    const nombre = esServicio ? getServicioNombre(prod) : getProductoNombre(prod);
    const id = esServicio ? getServicioId(prod) : getProductoId(prod);
    const precioCatalogo = getCatalogPrecio(prod);
    const ivaCatalogo = getCatalogIva(prod);
    setForm((p) => ({
      ...p,
      productoInput: nombre,
      id_servicio: esServicio ? String(id || NULL_OPTION) : NULL_OPTION,
      id_stock_producto: esServicio ? NULL_OPTION : String(id || NULL_OPTION),
      id_stock_variante: NULL_OPTION,
      precio: precioCatalogo > 0 ? String(round2(precioCatalogo)) : p.precio,
      iva_pct: String(round2(ivaCatalogo)),
    }));
    setProductoFocus(false);
    setProductoArmed(false);
  };

  const handleTipoItemChange = (e) => {
    const tipo = e.target.value === "SERVICIO" ? "SERVICIO" : "ARTICULO";
    setProductoFocus(false);
    setProductoArmed(false);
    setForm((p) => ({
      ...p,
      tipo_item: tipo,
      id_servicio: NULL_OPTION,
      id_stock_producto: NULL_OPTION,
      id_stock_variante: NULL_OPTION,
      productoInput: "",
    }));
  };


  const handleClienteInputChange = (e) => {
    const value = e.target.value;
    const exact = findExactCliente(value);
    setClienteArmed(true);
    setForm((p) => ({
      ...p,
      clienteInput: value,
      id_cliente: exact ? String(getClienteId(exact)) : NULL_OPTION,
    }));
  };

  const handleSelectCliente = (cli) => {
    const nombre = getClienteNombre(cli);
    const id = getClienteId(cli);
    setForm((p) => ({ ...p, clienteInput: nombre, id_cliente: String(id || NULL_OPTION) }));
    setClienteFocus(false);
    setClienteArmed(false);
  };

  const handleFechaChange = useCallback((e) => {
    const nuevaFecha = e.target.value;
    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.");
      return;
    }
    setForm((p) => ({
      ...p,
      fecha: nuevaFecha,
      periodo: periodoFromISODate(nuevaFecha) || p.periodo,
    }));
  }, [showToast]);

  const totals = useMemo(() => calcTotals(form.cantidad, form.precio, form.iva_pct), [form.cantidad, form.precio, form.iva_pct]);

  const resumen = useMemo(() => ({
    total: totals.total,
    cliente: String(form.clienteInput || "").trim() || "Sin cliente",
    producto: String(form.productoInput || "").trim() || "Sin producto",
    cantidad: Math.max(0, safeNumber(form.cantidad)),
    precio: Math.max(0, safeNumber(form.precio)),
    periodo: String(form.periodo || "").trim() || "--",
  }), [form, totals.total]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    showToast("cargando", "Guardando cambios…");

    try {
      const fechaFinal = String(form.fecha || defaultsRef.current.fecha || "").trim();
      if (!fechaFinal || !/^\d{4}-\d{2}-\d{2}$/.test(fechaFinal)) throw new Error("Fecha inválida.");
      if (fechaFinal > todayISO()) throw new Error("La fecha no puede ser posterior al día actual.");

      let clienteId = form.id_cliente && form.id_cliente !== NULL_OPTION ? Number(form.id_cliente) : null;
      if (!clienteId) {
        const exactCliente = findExactCliente(form.clienteInput);
        clienteId = exactCliente ? getClienteId(exactCliente) : null;
      }
      if (!clienteId) throw new Error("Seleccioná un cliente válido de la lista.");

      const esServicio = form.tipo_item === "SERVICIO";
      let servicioId = esServicio && form.id_servicio && form.id_servicio !== NULL_OPTION ? Number(form.id_servicio) : null;
      let productoId = !esServicio && form.id_stock_producto && form.id_stock_producto !== NULL_OPTION ? Number(form.id_stock_producto) : null;

      const exactCatalogo = findExactProducto(form.productoInput);
      if (esServicio && !servicioId) servicioId = exactCatalogo ? getServicioId(exactCatalogo) : null;
      if (!esServicio && !productoId) productoId = exactCatalogo ? getProductoId(exactCatalogo) : null;

      const textoActual = normalizeSearchText(defaultsRef.current.productoTxt);
      const textoNuevo = normalizeSearchText(form.productoInput);
      if (textoNuevo && textoNuevo === textoActual && form.tipo_item === defaultsRef.current.tipo_item) {
        if (esServicio && !servicioId) servicioId = Number(defaultsRef.current.id_servicio || 0) || null;
        if (!esServicio && !productoId) productoId = Number(defaultsRef.current.id_stock_producto || 0) || null;
      }

      if (esServicio && !servicioId) throw new Error("Seleccioná un servicio válido del catálogo.");
      if (!esServicio && !productoId) throw new Error("Seleccioná un artículo válido de stock.");

      const varianteId = null;

      const cantidad = roundQuantity(Math.max(0, safeNumber(form.cantidad)));
      const precio = round2(Math.max(0, safeNumber(form.precio)));
      const ivaPct = round2(Math.max(0, safeNumber(form.iva_pct)));
      if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor a 0.");
      if (!(precio > 0)) throw new Error("El precio unitario debe ser mayor a 0.");

      const t = calcTotals(cantidad, precio, ivaPct);
      const perUI = periodoToMMYYYY(form.periodo) || defaultsRef.current.periodoMMYYYY || periodoFromISODate(fechaFinal) || "";
      const perAPI = perUI ? periodoToYYYYMM(perUI) : "";

      const item = {
        tipo_item: esServicio ? "SERVICIO" : "ARTICULO",
        id_servicio: esServicio ? Number(servicioId) : null,
        id_articulo: esServicio ? null : Number(productoId),
        id_stock_producto: esServicio ? null : Number(productoId),
        id_stock_variante: null,
        id_detalle: null,
        descripcion: String(form.productoInput || "").trim(),
        cantidad,
        precio,
        iva_pct: ivaPct,
        subtotal: t.subtotal,
        iva_monto: t.iva_monto,
        total: t.total,
      };

      const payloadFinal = {
        id_movimiento: form.id_movimiento,
        fecha: fechaFinal,
        periodo: perAPI,
        id_cliente: Number(clienteId),
        cliente: String(form.clienteInput || "").trim(),
        tipo_item: esServicio ? "SERVICIO" : "ARTICULO",
        id_servicio: esServicio ? Number(servicioId) : null,
        id_articulo: esServicio ? null : Number(productoId),
        id_stock_producto: esServicio ? null : Number(productoId),
        id_stock_variante: null,
        id_detalle: null,
        producto: String(form.productoInput || "").trim(),
        descripcion: String(form.productoInput || "").trim(),
        cantidad,
        precio,
        iva_pct: ivaPct,
        subtotal: t.subtotal,
        iva_monto: t.iva_monto,
        total: t.total,
        monto_total: t.total,
        items: [item],
        editar_primer_item: true,
      };

      await onSave?.(payloadFinal);
      showToast("exito", "Recibo actualizado.");
      onClose?.();
    } catch (err) {
      showToast("error", err?.message || "Error guardando recibo.");
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <>
      <div className={`gm-modal-overlay ${darkOn ? "gm-modal-overlay--dark" : ""}`}>
        <div
          className={`gm-modal-container gm-modal-v2 rec-edit-modal ${darkOn ? "gm-modal-container--dark" : ""}`}
          id="mov--modaleditarrecibo"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon"><FontAwesomeIcon icon={faReceipt} /></div>

            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">Editar recibo</h2>
              <p className="gm-modal-subtitle">
                Modificá la venta de cuenta corriente: fecha, cliente, servicio o stock, cantidad y precio.
              </p>
            </div>

            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={() => !saving && onClose?.()}
              disabled={saving}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="gm-modal-content">
            <div className="gm-movement-layout rec-edit-layout">
              <section className="gm-movement-main rec-edit-main">
                <form onSubmit={submit} className="rec-edit-form">
                  <div className="gm-section">
                    <div className="gm-section-head"><div className="gm-section-dot" /><span>Servicio / Stock</span></div>
                    <div className="gm-section-body">
                      <div className="gm-field" style={{ marginBottom: 12 }}>
                        <select className="gm-input" value={form.tipo_item} onChange={handleTipoItemChange} disabled={saving}>
                          <option value="SERVICIO">Servicio</option>
                          <option value="ARTICULO">Stock / material / insumo</option>
                        </select>
                        <label className="gm-label">Tipo de ítem</label>
                      </div>
                      <div className="rec-edit-rel">
                        <div className="gm-field">
                          <input
                            className="gm-input"
                            placeholder=" "
                            value={form.productoInput}
                            onChange={handleProductoInputChange}
                            onFocus={() => { setProductoFocus(true); setProductoArmed(true); }}
                            onBlur={() => setTimeout(() => setProductoFocus(false), 120)}
                            disabled={saving}
                            autoComplete="off"
                          />
                          <label className="gm-label">{form.tipo_item === "SERVICIO" ? "Servicio" : "Artículo de stock"}</label>
                        </div>

                        {!!filteredProductos.length && (
                          <div className="rec-edit-autocomplete">
                            {filteredProductos.map((prod) => {
                              const esServicio = form.tipo_item === "SERVICIO";
                              const id = esServicio ? getServicioId(prod) : getProductoId(prod);
                              const nombre = esServicio ? getServicioNombre(prod) : getProductoNombre(prod);
                              return (
                                <button
                                  key={`${form.tipo_item}-${id}-${nombre}`}
                                  type="button"
                                  className="rec-edit-autocomplete__item"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleSelectProducto(prod)}
                                >
                                  {nombre}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="gm-section">
                    <div className="gm-section-head"><div className="gm-section-dot" /><span>Cantidad y precio</span></div>
                    <div className="gm-section-body">
                      <div className="rec-edit-grid-3">
                        <div className="gm-field">
                          <input
                            className="gm-input"
                            type="number"
                            step="0.000001"
                            min="0"
                            placeholder=" "
                            value={form.cantidad}
                            onChange={(e) => setForm((p) => ({ ...p, cantidad: e.target.value }))}
                            disabled={saving}
                          />
                          <label className="gm-label">Cantidad</label>
                        </div>

                        <div className="gm-field">
                          <input
                            className="gm-input"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder=" "
                            value={form.precio}
                            onChange={(e) => setForm((p) => ({ ...p, precio: e.target.value }))}
                            disabled={saving}
                          />
                          <label className="gm-label">Precio unitario</label>
                        </div>

                        <div className="gm-field">
                          <select
                            className="gm-input"
                            value={form.iva_pct}
                            onChange={(e) => setForm((p) => ({ ...p, iva_pct: e.target.value }))}
                            disabled={saving}
                          >
                            {IVA_OPTIONS.map((op) => (
                              <option key={op.value} value={op.value}>
                                {op.label}
                              </option>
                            ))}
                          </select>
                          <label className="gm-label">IVA %</label>
                        </div>
                      </div>

                      <div className="gm-info-box">
                        <b>Subtotal:</b> {moneyARS(totals.subtotal)} · <b>IVA:</b> {moneyARS(totals.iva_monto)} · <b>Total:</b> {moneyARS(totals.total)}
                      </div>
                    </div>
                  </div>

                  <div className="gm-section">
                    <div className="gm-section-head"><div className="gm-section-dot" /><span>Cliente</span></div>
                    <div className="gm-section-body">
                      <div className="rec-edit-rel">
                        <div className="gm-field">
                          <input
                            className="gm-input"
                            placeholder=" "
                            value={form.clienteInput}
                            onChange={handleClienteInputChange}
                            onFocus={() => { setClienteFocus(true); setClienteArmed(true); }}
                            onBlur={() => setTimeout(() => setClienteFocus(false), 120)}
                            disabled={saving}
                            autoComplete="off"
                          />
                          <label className="gm-label">Cliente</label>
                        </div>

                        {!!filteredClientes.length && (
                          <div className="rec-edit-autocomplete">
                            {filteredClientes.map((cli) => {
                              const id = getClienteId(cli);
                              const nombre = getClienteNombre(cli);
                              return (
                                <button
                                  key={`cli-${id}-${nombre}`}
                                  type="button"
                                  className="rec-edit-autocomplete__item"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleSelectCliente(cli)}
                                >
                                  {nombre}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </form>
              </section>

              <aside className="gm-movement-side gm-aside">
                <div className="gm-section">
                  <div className="gm-section-head"><div className="gm-section-dot" /><span>Fecha</span></div>
                  <div className="gm-section-body">
                    <div className="gm-field" onClick={() => openNativeDatePicker(fechaInputRef.current)}>
                      <input
                        ref={fechaInputRef}
                        className="gm-input"
                        type="date"
                        placeholder=" "
                        value={form.fecha}
                        max={todayISO()}
                        onMouseDown={(e) => {
                          if (saving) return;
                          e.preventDefault();
                          openNativeDatePicker(e.currentTarget);
                        }}
                        onClick={(e) => openNativeDatePicker(e.currentTarget)}
                        onChange={handleFechaChange}
                        disabled={saving}
                      />
                      <label className="gm-label">Fecha</label>
                    </div>
                  </div>
                </div>

                <div className="gm-section">
                  <div className="gm-section-head"><div className="gm-section-dot" /><span>Resumen del recibo</span></div>
                  <div className="gm-section-body">
                    <div className="gm-info-box">
                      <div className="rec-edit-summary-row"><FontAwesomeIcon icon={faCalendarDays} /><span><b>Fecha:</b> {form.fecha || "--"}</span></div>
                      <div className="rec-edit-summary-row"><FontAwesomeIcon icon={faUser} /><span><b>Cliente:</b> {resumen.cliente}</span></div>
                      <div className="rec-edit-summary-row"><FontAwesomeIcon icon={faBoxOpen} /><span><b>{form.tipo_item === "SERVICIO" ? "Servicio" : "Stock"}:</b> {resumen.producto}</span></div>
                      <div className="rec-edit-summary-row"><FontAwesomeIcon icon={faReceipt} /><span><b>Cantidad:</b> {resumen.cantidad || "--"}</span></div>
                      <div className="rec-edit-summary-row"><FontAwesomeIcon icon={faDollarSign} /><span><b>Total:</b> {moneyARS(resumen.total)}</span></div>
                    </div>
                  </div>
                </div>

                <div className="gm-actions">
                  <button
                    type="button"
                    className="gm-action-btn gm-action-btn--save rec-edit-action"
                    onClick={submit}
                    disabled={saving}
                  >
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>

                  <button
                    type="button"
                    className="gm-action-btn gm-action-btn--cancel rec-edit-action"
                    onClick={() => !saving && onClose?.()}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

