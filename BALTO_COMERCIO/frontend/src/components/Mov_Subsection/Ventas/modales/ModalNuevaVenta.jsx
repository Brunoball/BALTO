import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ventasFetch } from "../api/ventasApi.js";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "./ModalNuevaVenta.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";
import ModalFacturaBaltoResumen from "../../Facturacion/ModalFacturaBaltoResumen.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileInvoiceDollar, faPlus, faMoneyCheckDollar } from "@fortawesome/free-solid-svg-icons";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import ProductStockAutocomplete from "../../_shared/ProductStockAutocomplete.jsx";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import ModalNuevoCheque from "../../../Global/Modales/ModalNuevoCheque.jsx";
import ModalClienteFiscalArca from "../../../Global/Modales/ModalClienteFiscalArca.jsx";
import {
  saveVentaNoFacturadaPdf,
  preloadVentaNoFacturadaPdfAssets,
} from "../../../../utils/VentaNoFacturadaPdfBuilder";
import { saveRemitoPdf } from "../../../../utils/RemitoPdfBuilder";
import { DEMO_BLOCK_MESSAGE, isBaltoDemoMode } from "../../../../utils/demoMode";

/* ================================================================
   CONSTANTS
================================================================ */
const NULL_OPTION = "";

const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

const API_CHECK_NUMERO = `${BASE_URL}/api.php?action=mov_global_cheques_obtener&modo=verificar_numero`;

/* ================================================================
   UTILS
================================================================ */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDaysISOFrom(baseIso, days = 10) {
  const base = String(baseIso || todayISO()).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(base) ? new Date(`${base}T00:00:00`) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function roundMoney(v) {
  return Math.round((safeNumber(v) + Number.EPSILON) * 100) / 100;
}
function isBlank(v) {
  return String(v ?? "").trim() === "";
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
    return `$${Number(v || 0).toFixed(2)}`;
  }
}
function safeStr(v) {
  return String(v ?? "").trim();
}
function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function uid() {
  return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function onlyDigits(v) {
  return String(v ?? "").replace(/\D/g, "");
}
function getDetalleId(d) {
  const cand = d?.id ?? d?.id_detalle ?? d?.idDetalle ?? d?.detalle_id ?? d?.iddetalle ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockProductoId(d) {
  const cand = d?.id_stock_producto ?? d?.idStockProducto ?? d?.stock_producto_id ?? d?.id_producto ?? d?.idProducto ?? getDetalleId(d);
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockVarianteId(d) {
  const cand = d?.id_stock_variante ?? d?.idStockVariante ?? d?.stock_variante_id ?? d?.id_variante ?? d?.idVariante ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getDetalleNombre(d) {
  return safeStr(d?.nombre || d?.descripcion || d?.detalle || d?.producto || d?.label || "");
}
function getClienteId(c) {
  const cand = c?.id ?? c?.id_cliente ?? c?.idCliente ?? c?.cliente_id ?? c?.idcliente ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function fechaToYYYYMM(isoDate) {
  const s = String(isoDate ?? "").trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}
function getStockDisponible(detalle) {
  const cand =
    detalle?.stock ??
    detalle?.stock_disponible ??
    detalle?.stockDisponible ??
    detalle?.cantidad_stock ??
    detalle?.cantidad ??
    null;
  if (cand === null || cand === undefined || cand === "") return null;
  const n = Number(cand);
  return Number.isFinite(n) ? n : null;
}
function isSinStock(stock) {
  return stock !== null && stock !== undefined && Number(stock) <= 0;
}
function normalizeTipoPrecioNombre(nombre) {
  return String(nombre ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function getDetallePreciosDisponibles(detalle) {
  const lista = Array.isArray(detalle?.precios) ? detalle.precios : [];
  const out = [];
  const seen = new Set();

  for (let i = 0; i < lista.length; i += 1) {
    const p = lista[i] ?? {};
    const idTipo = Number(p?.id_tipo_precio_stock ?? 0);
    const monto = Number(p?.monto ?? p?.precio ?? 0);
    const tipoPrecio = safeStr(
      p?.tipo_precio || p?.nombre || (idTipo > 0 ? `Precio ${idTipo}` : `Precio ${i + 1}`)
    );
    if (!Number.isFinite(monto)) continue;

    const key = `${idTipo}|${tipoPrecio}|${monto}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      value: idTipo > 0 ? String(idTipo) : `precio_${i + 1}`,
      id_tipo_precio_stock: idTipo > 0 ? idTipo : null,
      tipo_precio: tipoPrecio || `Precio ${i + 1}`,
      monto,
      label: `${tipoPrecio || `Precio ${i + 1}`} - ${moneyARS(monto)}`,
    });
  }

  if (!out.length) {
    const montoFallback = Number(detalle?.precio ?? detalle?.precio_venta ?? detalle?.precio_promocional ?? 0);
    out.push({
      value: "default",
      id_tipo_precio_stock: null,
      tipo_precio: "PRECIO",
      monto: Number.isFinite(montoFallback) ? montoFallback : 0,
      label: `PRECIO - ${moneyARS(Number.isFinite(montoFallback) ? montoFallback : 0)}`,
    });
  }

  return out;
}
function pickDetallePrecioInicial(precios) {
  if (!Array.isArray(precios) || !precios.length) return null;
  for (const p of precios) {
    const nombre = normalizeTipoPrecioNombre(p?.tipo_precio);
    if (nombre === "PRECIO DE VENTA" || nombre === "PRECIO VENTA" || nombre === "VENTA") return p;
  }
  for (const p of precios) {
    if (Number(p?.id_tipo_precio_stock ?? 0) === 2) return p;
  }
  return precios[0] ?? null;
}

const SAFE_LISTS = { clientes: [], detalles: [], medios_pago: [], tipos_venta: [], cuentas_corrientes: [] };
const ADD_CLIENTE_OPTION = { __action: "add_cliente", id: "__add_cliente__", nombre: "➕ Agregar cliente" };

function isAddClienteOption(option) {
  return option?.__action === "add_cliente";
}

function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src.listas && typeof src.listas === "object" ? src.listas : src;
  const pick = (k) => (Array.isArray(l?.[k]) ? l[k] : []);

  const mediosPago = pick("medios_pago").length
    ? pick("medios_pago")
    : pick("mediosPago").length
    ? pick("mediosPago")
    : pick("medios");

  const cuentas = pick("cuentas_corrientes").length
    ? pick("cuentas_corrientes")
    : pick("cuentasCorrientes").length
    ? pick("cuentasCorrientes")
    : pick("cuentas");

  const tiposVenta = pick("tipos_venta").length
    ? pick("tipos_venta")
    : pick("tiposVenta").length
    ? pick("tiposVenta")
    : pick("tipo_venta").length
    ? pick("tipo_venta")
    : [];

  return {
    clientes: pick("clientes"),
    detalles: pick("detalles"),
    medios_pago: Array.isArray(mediosPago) ? mediosPago : [],
    cuentas_corrientes: Array.isArray(cuentas) ? cuentas : [],
    tipos_venta: Array.isArray(tiposVenta) ? tiposVenta : [],
  };
}

function getAuthInfo() {
  const sessionKey =
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") ||
    localStorage.getItem("X-Session") ||
    "";
  const token = localStorage.getItem("token") || "";
  let idUsuario = 0;

  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}

  return { token, sessionKey, idUsuario };
}

function nuevaVentaArcaStorageKey() {
  const { idUsuario } = getAuthInfo();
  return `balto:arca:nueva-venta:${Number(idUsuario || 0)}`;
}

function makeNuevaVentaArcaOperationKey() {
  const { idUsuario } = getAuthInfo();
  const randomPart =
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `factura-venta-${Number(idUsuario || 0)}-${randomPart}`.slice(0, 100);
}

function getOrCreateNuevaVentaArcaKey() {
  try {
    const storageKey = nuevaVentaArcaStorageKey();
    const existing = safeStr(localStorage.getItem(storageKey));
    if (existing) return existing;

    const created = makeNuevaVentaArcaOperationKey();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    // La persistencia es una protección adicional. Si el navegador la bloquea,
    // la emisión sigue usando una clave estable durante la vida del modal.
    return makeNuevaVentaArcaOperationKey();
  }
}

function clearNuevaVentaArcaKey(expectedKey = "") {
  try {
    const storageKey = nuevaVentaArcaStorageKey();
    const current = safeStr(localStorage.getItem(storageKey));
    const expected = safeStr(expectedKey);

    // Evita borrar por accidente una clave más nueva creada en otra instancia.
    if (expected && current && current !== expected) return;
    localStorage.removeItem(storageKey);
  } catch {
    // El fallo al limpiar almacenamiento no debe afectar una venta ya guardada.
  }
}

function normalizeRolVenta(value, idRol = null) {
  const id = Number(idRol);
  const v = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (id === 1 || ["1", "admin", "administrator", "administrador", "superadmin"].includes(v)) {
    return "admin";
  }

  return "empleado_basico";
}

function getUsuarioActualVenta() {
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    return u && typeof u === "object" ? u : null;
  } catch {
    return null;
  }
}

function usuarioVentaEsBasico() {
  const u = getUsuarioActualVenta();
  const rol = normalizeRolVenta(u?.rol ?? u?.tipo_rol, u?.id_rol);
  return rol !== "admin";
}

async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");

  try {
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(`Respuesta inválida. HTTP ${res.status}`);
  }
}

function buildAuthHeaders(isJson = true) {
  const { token, sessionKey } = getAuthInfo();
  const headers = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  else if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiPostJson(url, payload) {
  const res = await ventasFetch(url, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload ?? {}),
  });
  return await parseJsonOrThrow(res);
}

async function apiPostJsonConReintentoSeguro(url, payload, maxIntentos = 3) {
  let lastError = null;

  for (let intento = 1; intento <= maxIntentos; intento += 1) {
    try {
      const res = await ventasFetch(url, {
        method: "POST",
        headers: buildAuthHeaders(true),
        body: JSON.stringify(payload ?? {}),
      });

      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        const text = await res.text();
        let mensaje = `HTTP ${res.status}`;
        try {
          const data = text ? JSON.parse(text) : null;
          mensaje = data?.mensaje || data?.error || mensaje;
        } catch {
          // Si el gateway devolvió HTML/texto se considera un error transitorio.
        }
        const err = new Error(mensaje);
        err.httpStatus = res.status;
        throw err;
      }

      return await parseJsonOrThrow(res);
    } catch (e) {
      lastError = e;
      const status = Number(e?.httpStatus || 0);
      const msg = String(e?.message || "");
      const transitorio =
        e instanceof TypeError ||
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        /failed to fetch|network|load failed|gateway|respuesta vacía/i.test(msg);

      if (!transitorio || intento >= maxIntentos) throw e;
      await new Promise((resolve) => window.setTimeout(resolve, 650 * intento));
    }
  }

  throw lastError || new Error("No se pudo completar la operación.");
}

async function fetchFormDataConReintentoSeguro(url, formData, maxIntentos = 3) {
  let lastError = null;

  for (let intento = 1; intento <= maxIntentos; intento += 1) {
    try {
      const res = await ventasFetch(url, {
        method: "POST",
        body: formData,
        headers: buildAuthHeaders(false),
      });

      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        const text = await res.text();
        let mensaje = `HTTP ${res.status}`;
        try {
          const data = text ? JSON.parse(text) : null;
          mensaje = data?.mensaje || data?.error || mensaje;
        } catch {
          // Error transitorio sin JSON.
        }
        const err = new Error(mensaje);
        err.httpStatus = res.status;
        throw err;
      }

      return await parseJsonOrThrow(res);
    } catch (e) {
      lastError = e;
      const status = Number(e?.httpStatus || 0);
      const msg = String(e?.message || "");
      const transitorio =
        e instanceof TypeError ||
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        /failed to fetch|network|load failed|gateway|respuesta vacía/i.test(msg);

      if (!transitorio || intento >= maxIntentos) throw e;
      await new Promise((resolve) => window.setTimeout(resolve, 650 * intento));
    }
  }

  throw lastError || new Error("No se pudo completar la subida.");
}

async function apiGetJson(url) {
  const res = await ventasFetch(url, {
    method: "GET",
    headers: buildAuthHeaders(false),
  });
  return await parseJsonOrThrow(res);
}

function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

function normalizeArcaSummary(s) {
  const x = s && typeof s === "object" ? s : {};
  return {
    cuit: safeStr(x.cuit),
    razon_social: safeStr(x.razon_social),
    condicion_iva: safeStr(x.iva || x.condicion_iva),
    domicilio: safeStr(x.domicilio),
    doc_tipo: 80,
    doc_nro: safeStr(x.cuit),
    origen: "arca_cuit",
  };
}

function normalizeClienteFiscalDb(data) {
  const s = data && typeof data === "object" ? data : {};
  return {
    id_cliente_fiscal: Number(s.id_cliente_fiscal || 0) || null,
    id_cliente: Number(s.id_cliente || 0) || null,
    doc_tipo: Number(s.doc_tipo || 80) || 80,
    doc_nro: safeStr(s.doc_nro),
    cuit: safeStr(s.cuit),
    razon_social: safeStr(s.razon_social),
    condicion_iva: safeStr(s.condicion_iva || s.cond_iva),
    domicilio: safeStr(s.domicilio),
    origen: safeStr(s.origen || "manual"),
  };
}

function normalizeClienteSimple(data) {
  const s = data && typeof data === "object" ? data : {};
  const id = getClienteId(s) || Number(s.id_cliente || s.id || 0) || null;
  return {
    id_cliente: id,
    id,
    nombre: safeStr(s.nombre || s.razon_social || s.label || ""),
    activo: Number(s.activo ?? 1) === 0 ? 0 : 1,
  };
}

function normalizeConfigFacturacionPdf(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const razon = safeStr(c.razon_social || c.nombre_fantasia || c.nombre || "BALTO");
  const domicilio = safeStr(c.domicilio_comercial || c.domicilio || c.domicilio_fiscal || "");
  const condicionIva = safeStr(c.condicion_iva || c.cond_iva || "");
  const inicio = safeStr(c.fecha_inicio_actividades || c.inicio_actividades || "");

  return {
    raw: c,
    emisor_nombre: razon,
    emisor_domicilio: domicilio,
    cuit_emisor: safeStr(c.cuit || ""),
    cond_iva_emisor: condicionIva,
    ingresos_brutos_emisor: safeStr(c.ingresos_brutos || ""),
    fecha_inicio_actividades_emisor: inicio,
    logo_url: safeStr(c.logo_url || ""),
    emisor: {
      razon_social: razon,
      nombre_fantasia: safeStr(c.nombre_fantasia || ""),
      domicilio_comercial: domicilio,
      domicilio,
      cuit: safeStr(c.cuit || ""),
      condicion_iva: condicionIva,
      cond_iva: condicionIva,
      ingresos_brutos: safeStr(c.ingresos_brutos || ""),
      fecha_inicio_actividades: inicio,
      inicio_actividades: inicio,
      punto_venta: safeStr(c.punto_venta || ""),
      tipo_comprobante_default: safeStr(c.tipo_comprobante_default || ""),
      codigo_comprobante: safeStr(c.codigo_comprobante || ""),
      logo_url: safeStr(c.logo_url || ""),
    },
  };
}

function configFacturacionKey(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const id = Number(c.id_config_facturacion || c.idConfigFacturacion || 0) || 0;
  const cuit = String(c.cuit || c.cuit_emisor || "").replace(/\D/g, "");
  if (id > 0) return `id:${id}`;
  if (cuit) return `cuit:${cuit}`;
  return JSON.stringify(c);
}

function extractConfigsFacturacionResponse(data) {
  const candidates = [
    data?.configs,
    data?.data?.configs,
    data?.cuentas_fiscales,
    data?.data?.cuentas_fiscales,
    data?.cuentas,
    data?.data?.cuentas,
    data?.configuraciones,
    data?.data?.configuraciones,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function mergeConfigsFacturacionList(...lists) {
  const out = [];
  const seen = new Set();

  lists.flat().forEach((cfg) => {
    if (!cfg || typeof cfg !== "object") return;
    if (Number(cfg.activo ?? 1) === 0) return;
    const key = configFacturacionKey(cfg);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cfg);
  });

  return out;
}

function buildClienteFiscalPdf(fiscalSource, clienteSource, nombreFallback = "Cliente") {
  const fiscal = normalizeClienteFiscalDb(fiscalSource || {});
  const cliente = clienteSource && typeof clienteSource === "object" ? clienteSource : {};
  const nombre =
    safeStr(fiscal.razon_social) ||
    safeStr(cliente.razon_social) ||
    safeStr(cliente.nombre) ||
    safeStr(nombreFallback) ||
    "Cliente";
  const docNro = safeStr(fiscal.doc_nro || fiscal.cuit || cliente.doc_nro || cliente.cuit || cliente.dni || "");
  const cuit = safeStr(fiscal.cuit || cliente.cuit || (String(fiscal.doc_tipo) === "80" ? docNro : ""));
  const condicion = safeStr(fiscal.condicion_iva || cliente.condicion_iva || cliente.cond_iva || "");
  const domicilio = safeStr(fiscal.domicilio || cliente.domicilio || cliente.direccion || "");

  return {
    id_cliente_fiscal: fiscal.id_cliente_fiscal || null,
    id_cliente: fiscal.id_cliente || getClienteId(cliente) || null,
    doc_tipo: fiscal.doc_tipo || (cuit ? 80 : null),
    doc_nro: docNro,
    cuit,
    razon_social: nombre,
    cond_iva: condicion,
    condicion_iva: condicion,
    domicilio,
    origen: safeStr(fiscal.origen || (fiscal.id_cliente_fiscal ? "clientes_fiscales" : "cliente")),
  };
}

function resolveClienteByInput(clientes, inputValue) {
  const q = normalizeText(inputValue);
  if (!q) return null;

  const arr = Array.isArray(clientes) ? clientes : [];
  const wm = arr
    .map((c) => ({
      raw: c,
      id: getClienteId(c),
      nombreNorm: normalizeText(c?.nombre),
    }))
    .filter((x) => x.id && x.nombreNorm);

  if (!wm.length) return null;

  const exact = wm.find((x) => x.nombreNorm === q);
  if (exact) return exact.raw;

  const starts = wm.filter((x) => x.nombreNorm.startsWith(q));
  if (starts.length === 1) return starts[0].raw;

  const contains = wm.filter((x) => x.nombreNorm.includes(q));
  if (contains.length === 1) return contains[0].raw;

  return null;
}

function isContadoTipoVenta(tv) {
  return (
    String(tv?.nombre ?? "").toLowerCase().includes("contado") ||
    String(tv?.nombre ?? "").toLowerCase().includes("efectivo")
  );
}

function getMedioPagoId(mp) {
  const c = mp?.id ?? mp?.id_medio_pago ?? mp?.medio_pago_id ?? mp?.idMedioPago ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getMedioPagoNombre(mp) {
  return safeStr(
    mp?.nombre ||
      mp?.Nombre ||
      mp?.medio_pago ||
      mp?.medioPago ||
      mp?.nombre_medio_pago ||
      mp?.descripcion ||
      mp?.detalle ||
      mp?.label ||
      ""
  );
}

function normalizeChequeTipoFromMedio(nombre) {
  const s = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) return "echeq";
  if (s.includes("cheque")) return "cheque";
  return null;
}

function getSelectedSaleItemId(r) {
  const id = Number(r?.id_stock_producto || r?.id_detalle);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function isUsableSaleRow(r) {
  return getSelectedSaleItemId(r) !== null && safeNumber(r?.total) > 0;
}

function describeLineProblem(r, idx1based) {
  const detId = getSelectedSaleItemId(r);
  const detTxt = String(r.detalleText || "").trim();
  const qtyBlank = isBlank(r.cantidad);
  const precioLista = r.precioLista ?? r.precio;
  const priceBlank = isBlank(precioLista);
  const qty = safeNumber(r.cantidad);
  const price = safeNumber(precioLista);
  const total = safeNumber(r.total);

  const touched =
    detTxt !== "" ||
    String(r.id_stock_producto || r.id_detalle || "").trim() !== "" ||
    String(r.id_stock_variante || "").trim() !== "" ||
    !qtyBlank ||
    !priceBlank ||
    safeNumber(r.cantidad) !== 0 ||
    safeNumber(precioLista) !== 0;

  if (!touched) return null;

  const issues = [];
  if (!(Number.isFinite(detId) && detId > 0)) {
    issues.push(detTxt ? `el detalle "${detTxt}" no está seleccionado del listado` : "falta el detalle");
  }
  if (qtyBlank) issues.push("falta la cantidad");
  else if (!(Number.isFinite(qty) && qty > 0)) issues.push("la cantidad debe ser > 0");

  if (priceBlank) issues.push("falta el precio");
  else if (!(Number.isFinite(price) && price > 0)) issues.push("el precio debe ser > 0");

  if (!(Number.isFinite(total) && total > 0)) issues.push("el total queda en 0");

  if (!issues.length) return null;
  return `Fila ${idx1based}: ${issues.join(", ")}.`;
}

function buildEmptyRow() {
  return {
    id: uid(),
    id_detalle: NULL_OPTION,
    id_stock_producto: NULL_OPTION,
    id_stock_variante: NULL_OPTION,
    detalleText: "",
    cantidad: 1,
    precio: 0,
    precioDraft: "",
    precioFocused: false,
    id_tipo_precio_stock: NULL_OPTION,
    precio_tipo_label: "",
    precios_disponibles: [],
    ivaPct: 0,
    stock_disponible: null,
    sinStock: false,
  };
}

function buildMediosPagoPayload(mediosFilas, mediosPagoList) {
  return (Array.isArray(mediosFilas) ? mediosFilas : [])
    .filter((mp) => mp.id_medio_pago && mp.id_medio_pago !== "")
    .map((mp) => {
      const mpRow = mediosPagoList.find(
        (x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago)
      );
      const medioPagoNombre = getMedioPagoNombre(mpRow);
      const tipoCheque = normalizeChequeTipoFromMedio(medioPagoNombre);

      const base = {
        frontend_row_uid: mp.id,
        id_medio_pago: Number(mp.id_medio_pago),
        nombre: medioPagoNombre,
        medio_pago: medioPagoNombre,
        descripcion: medioPagoNombre,
        monto: tipoCheque !== null ? safeNumber(mp.cheque?.importe) : safeNumber(mp.monto),
      };

      if (tipoCheque !== null && mp.cheque) {
        return {
          ...base,
          cheque: {
            tipo: tipoCheque,
            fecha_emision: mp.cheque.fecha_emision,
            emisor: mp.cheque.emisor,
            numero_cheque: mp.cheque.numero_cheque,
            importe: safeNumber(mp.cheque.importe),
            fecha_pago: mp.cheque.fecha_pago,
            observaciones: mp.cheque.observaciones || "",
            archivo_nombre:
              mp.cheque.archivo_nombre ||
              (mp.cheque.archivo instanceof File ? mp.cheque.archivo.name : ""),
          },
        };
      }

      return base;
    });
}

function formatMoneyInputARS(v) {
  const n = safeNumber(v);
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `$ ${n.toFixed(2)}`;
  }
}

function parseMoneyInputARS(v) {
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/\$/g, "").replace(/\s+/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatEditableMoney(v) {
  const n = safeNumber(v);
  if (n === 0) return "";
  return String(n).replace(".", ",");
}
function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}
function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return s;
}

/* ================================================================
   EXPORTED: buildEmptyMedioPagoVenta
================================================================ */
export function buildEmptyMedioPagoVenta() {
  return {
    id: uid(),
    id_medio_pago: NULL_OPTION,
    monto: 0,
    montoDraft: "",
    montoFocused: false,
    cheque: null,
  };
}

/* ================================================================
   ABREVIADOR DE TIPO PRECIO
================================================================ */
function abreviarTipoPrecio(nombre) {
  const n = normalizeTipoPrecioNombre(nombre);
  if (n === "PRECIO DE VENTA" || n === "PRECIO VENTA" || n === "VENTA") return "P. Venta";
  if (n === "PRECIO DE COSTO" || n === "COSTO") return "P. de COSTO";
  if (n === "PRECIO PROMOCIONAL" || n === "PROMOCIONAL" || n === "PROMO") return "P. Promo";
  if (n === "PRECIO MAYORISTA" || n === "MAYORISTA") return "P. Mayor.";
  if (n === "PRECIO MINORISTA" || n === "MINORISTA") return "P. Minor.";
  if (n === "PRECIO ESPECIAL" || n === "ESPECIAL") return "P. Especial";
  if (n === "PRECIO COSTO" || n === "COSTO") return "P. Costo";
  if (n === "PRECIO LISTA" || n === "LISTA") return "P. Lista";
  if (n === "PRECIO" || n === "PRECIO 1") return "Precio";
  return nombre.length > 12 ? nombre.slice(0, 11).trim() + "…" : nombre;
}

/* ================================================================
   PRECIO DROPDOWN
================================================================ */
function PrecioDropdown({ precios, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const ref = useRef(null);

  const safePrecios = Array.isArray(precios) ? precios : [];
  const selectedIndex = Math.max(
    0,
    safePrecios.findIndex((p) => String(p.value) === String(value))
  );
  const selected = safePrecios[selectedIndex] || safePrecios[0] || null;

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open]);

  const moveSelection = useCallback(
    (direction) => {
      if (!safePrecios.length) return;
      const currentIndex = safePrecios.findIndex((p) => String(p.value) === String(value));
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      let nextIndex = baseIndex + direction;

      if (nextIndex < 0) nextIndex = safePrecios.length - 1;
      if (nextIndex >= safePrecios.length) nextIndex = 0;

      const next = safePrecios[nextIndex];
      if (next) onChange(next.value);
      setHighlightIndex(nextIndex);
    },
    [safePrecios, value, onChange]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (disabled || !safePrecios.length) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        moveSelection(1);
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveSelection(-1);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        setHighlightIndex((prev) => (prev + 1 >= safePrecios.length ? 0 : prev + 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        setHighlightIndex((prev) => (prev - 1 < 0 ? safePrecios.length - 1 : prev - 1));
        return;
      }

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightIndex(selectedIndex >= 0 ? selectedIndex : 0);
          return;
        }
        const item = safePrecios[highlightIndex];
        if (item) onChange(item.value);
        setOpen(false);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [disabled, safePrecios, open, selectedIndex, highlightIndex, onChange, moveSelection]
  );

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((p) => !p)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        style={{
          width: "100%",
          background: disabled ? "var(--nv-surface2)" : "var(--nv-bg)",
          border: "1px solid var(--nv-border-md)",
          borderRadius: 6,
          padding: "4px 18px 4px 8px",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          lineHeight: 1.25,
          minHeight: 38,
          position: "relative",
          transition: "border-color 0.15s, background 0.15s",
          boxSizing: "border-box",
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.borderColor = "var(--nv-action)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--nv-border-md)";
        }}
      >
        {selected ? (
          <>
            <div
              style={{
                fontSize: 9,
                color: "var(--nv-muted)",
                textTransform: "uppercase",
                fontWeight: 700,
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {abreviarTipoPrecio(selected.tipo_precio)}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--nv-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {moneyARS(selected.monto)}
            </div>
          </>
        ) : (
          <span style={{ color: "var(--nv-placeholder)", fontSize: 12 }}>Precio</span>
        )}

        <span
          style={{
            position: "absolute",
            right: 7,
            top: "50%",
            transform: `translateY(-50%) rotate(${open ? "180deg" : "0deg"})`,
            transition: "transform 0.18s",
            fontSize: 10,
            color: "var(--nv-muted)",
            pointerEvents: "none",
            lineHeight: 1,
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 9999,
            background: "var(--nv-bg)",
            border: "1px solid var(--nv-border-md)",
            borderRadius: 8,
            boxShadow: "var(--nv-shadow-md)",
            minWidth: "100%",
            width: "max-content",
            maxWidth: 240,
            overflow: "hidden",
          }}
        >
          {safePrecios.map((p, idx) => {
            const isActive = String(p.value) === String(value);
            const isHighlighted = idx === highlightIndex;

            return (
              <div
                key={p.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(p.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setHighlightIndex(idx)}
                style={{
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: isHighlighted
                    ? "var(--nv-row-hover)"
                    : isActive
                    ? "var(--nv-action-10)"
                    : "transparent",
                  borderLeft: isActive ? "3px solid var(--nv-action)" : "3px solid transparent",
                  transition: "background 0.1s",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: isActive ? "var(--nv-action)" : "var(--nv-muted)",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    marginBottom: 1,
                  }}
                >
                  {abreviarTipoPrecio(p.tipo_precio)}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: isActive ? "var(--nv-action)" : "var(--nv-text)",
                  }}
                >
                  {moneyARS(p.monto)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   CHEQUE RESUMEN
================================================================ */
function ChequeResumen({ cheque, tipoCheque }) {
  if (!cheque) return null;
  const esEcheq = tipoCheque === "echeq";
  return (
    <div className="gm-checks-list">
      <div className={`gm-check-item gm-check-item--selected ${esEcheq ? "gm-check-item--echeq" : ""}`}>
        <div className="gm-check-main">
          <div className="gm-check-top">
            <span className="gm-check-number">N° {safeText(cheque?.numero_cheque)}</span>
            {esEcheq && <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>}
          </div>
          <div className="gm-check-meta">
            <span className="gm-check-issuer" title={safeText(cheque?.emisor)}>
              {safeText(cheque?.emisor)}
            </span>
            <span className="gm-check-separator">·</span>
            <span>Pago: {formatFechaDMY(cheque?.fecha_pago)}</span>
          </div>
        </div>
        <span className="gm-check-amount">{moneyARS(cheque?.importe || 0)}</span>
        <div
          aria-hidden="true"
          className={`gm-check-icon gm-check-icon--corner ${
            esEcheq ? "gm-check-icon--echeck" : "gm-check-icon--check"
          }`}
        >
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MP ROW
================================================================ */
function MpRowVenta({ row, mediosFilas = [], mediosPagoList, totalCompra, sumaMediosPago, onUpdate, onRemove, showToast }) {
  const [openChequeModal, setOpenChequeModal] = useState(false);

  const mpSeleccionado = useMemo(
    () =>
      mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(row.id_medio_pago ?? "")) ||
      null,
    [mediosPagoList, row.id_medio_pago]
  );

  const tipoCheque = useMemo(() => normalizeChequeTipoFromMedio(mpSeleccionado?.nombre || ""), [mpSeleccionado]);
  const esCheque = tipoCheque !== null;
  const montoActual = esCheque && row.cheque ? safeNumber(row.cheque?.importe) : safeNumber(row.monto);

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - montoActual);
    return Math.max(0, safeNumber(totalCompra) - sumaOtros);
  }, [sumaMediosPago, totalCompra, montoActual]);

  const puedeCompletarRestante = !esCheque && totalCompra > 0 && restanteParaEstaFila > 0.009;

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(val));
      const tipo = normalizeChequeTipoFromMedio(mp?.nombre || "");
      onUpdate(row.id, {
        id_medio_pago: val,
        monto: tipo === null ? safeNumber(row.monto) : safeNumber(row.cheque?.importe),
        montoDraft: "",
        montoFocused: false,
        cheque: tipo === null ? null : row.cheque,
      });
    },
    [mediosPagoList, onUpdate, row.id, row.monto, row.cheque]
  );

  const handleSaveCheque = useCallback(
    (datosCheque) => {
      const cheque = {
        ...datosCheque,
        tipo: tipoCheque || "cheque",
        archivo_nombre:
          datosCheque?.archivo_nombre ||
          (datosCheque?.archivo instanceof File ? datosCheque.archivo.name : ""),
      };
      onUpdate(row.id, {
        cheque,
        monto: safeNumber(cheque.importe),
        montoDraft: "",
        montoFocused: false,
      });
      setOpenChequeModal(false);
      showToast?.("exito", `${tipoCheque === "echeq" ? "eCheq" : "Cheque"} ${cheque.numero_cheque || ""} cargado.`, 2500);
    },
    [onUpdate, row.id, showToast, tipoCheque]
  );

  const verificarNumeroChequeVentas = useCallback(
    async ({ numero_cheque, tipoCheque, initialData }) => {
      const numeroCheque = onlyDigits(numero_cheque);
      if (!numeroCheque) {
        return {
          ok: false,
          tipo: "advertencia",
          mensaje: "Ingresá el número de cheque antes de confirmar.",
          duracion: 3200,
        };
      }

      const duplicadoEnFormulario = Array.isArray(mediosFilas) && mediosFilas.some((mp) => {
        if (!mp || String(mp.id) === String(row.id)) return false;
        const numero = onlyDigits(mp?.cheque?.numero_cheque);
        return numero && numero === numeroCheque;
      });

      if (duplicadoEnFormulario) {
        return {
          ok: false,
          tipo: "error",
          mensaje: `Ya cargaste otro cheque/eCheq con el número ${numeroCheque} en esta venta.`,
          duracion: 4600,
        };
      }

      const params = new URLSearchParams();
      params.set("numero_cheque", numeroCheque);
      params.set("tipo", String(tipoCheque || "cheque"));

      const idChequeActual = Number(initialData?.id_cheque || row?.cheque?.id_cheque || 0);
      if (Number.isFinite(idChequeActual) && idChequeActual > 0) {
        params.set("id_cheque", String(idChequeActual));
      }

      const res = await ventasFetch(`${API_CHECK_NUMERO}&${params.toString()}`, {
        method: "GET",
        headers: buildAuthHeaders(false),
      });
      const data = await parseJsonOrThrow(res);

      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo verificar el número del cheque.");
      if (data?.existe || data?.disponible === false) {
        return {
          ok: false,
          tipo: "error",
          mensaje: data?.mensaje || "Ese número de cheque ya existe.",
          duracion: 4600,
        };
      }
      return { ok: true };
    },
    [mediosFilas, row.id, row?.cheque?.id_cheque]
  );

  return (
    <div className="gm-payment-card">
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select
            className="gm-input gm-select"
            value={String(row.id_medio_pago || "")}
            onChange={(e) => handleChangeMedio(e.target.value)}
          >
            <option value={NULL_OPTION}>Seleccionar…</option>
            {mediosPagoList.map((x) => {
              const idMp = getMedioPagoId(x);
              return (
                <option key={idMp ?? x?.nombre ?? uid()} value={idMp != null ? String(idMp) : ""}>
                  {String(x?.nombre ?? "").trim() || "Medio"}
                </option>
              );
            })}
          </select>
          <label className={`gm-label${row.id_medio_pago && row.id_medio_pago !== "" ? " gm-label--up" : ""}`}>
            Medio de pago
          </label>
        </div>
      </div>

      <div className="gm-payment-row gm-payment-row--amount">
        <div className="gm-field gm-payment-amount-field" style={{ position: "relative" }}>
          <input
            className="gm-input gm-payment-amount-input"
            type="text"
            inputMode="decimal"
            value={row.montoFocused ? row.montoDraft ?? "" : formatMoneyInputARS(montoActual)}
            onFocus={(e) => {
              if (esCheque && row.cheque) return;
              onUpdate(row.id, { montoFocused: true, montoDraft: formatEditableMoney(montoActual) });
              setTimeout(() => e.target.select(), 0);
            }}
            onChange={(e) => {
              if (esCheque && row.cheque) return;
              const c = e.target.value.replace(/[^\d,\.\-]/g, "");
              onUpdate(row.id, { montoDraft: c, monto: parseMoneyInputARS(c) });
            }}
            onBlur={() => {
              if (esCheque && row.cheque) return;
              const p = parseMoneyInputARS(row.montoDraft);
              onUpdate(row.id, { monto: p, montoDraft: "", montoFocused: false });
            }}
            onKeyDown={(e) => {
              if (esCheque && row.cheque) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="$ 0,00"
            disabled={esCheque && !!row.cheque}
            style={{ height: 32, padding: "0 10px", fontSize: 13, textAlign: "right" }}
          />
          <label className="gm-label gm-label--up">Monto</label>
        </div>

        <div className="gm-payment-actions-col">
          {!esCheque && (
            <button
              type="button"
              className="gm-payment-complete"
              onClick={() => onUpdate(row.id, { monto: restanteParaEstaFila, montoDraft: "", montoFocused: false })}
              disabled={!puedeCompletarRestante}
              title="Completar importe restante"
            >
              ↓ Rest.
            </button>
          )}
          <button type="button" className="gm-payment-delete" onClick={() => onRemove(row.id)} title="Quitar">
            ×
          </button>
        </div>
      </div>

      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 12 }} />
            {tipoCheque === "echeq" ? "eCheq cargado" : "Cheque cargado"}
          </div>
          {row.cheque ? (
            <>
              <ChequeResumen cheque={row.cheque} tipoCheque={tipoCheque} />
              <button type="button" className="gm-payment-btn" onClick={() => setOpenChequeModal(true)}>
                Editar {tipoCheque === "echeq" ? "eCheq" : "cheque"}
              </button>
            </>
          ) : (
            <button type="button" className="gm-payment-btn" onClick={() => setOpenChequeModal(true)}>
              Cargar {tipoCheque === "echeq" ? "eCheq" : "cheque"}
            </button>
          )}
        </div>
      )}

      {openChequeModal && (
        <ModalNuevoCheque
          open={openChequeModal}
          onClose={() => setOpenChequeModal(false)}
          onSave={handleSaveCheque}
          initialData={
            row.cheque
              ? {
                  fecha_emision: row.cheque.fecha_emision,
                  emisor: row.cheque.emisor,
                  numero_cheque: row.cheque.numero_cheque,
                  importe: row.cheque.importe,
                  fecha_pago: row.cheque.fecha_pago,
                  observaciones: row.cheque.observaciones,
                  archivo: row.cheque.archivo,
                  archivo_nombre: row.cheque.archivo_nombre,
                }
              : undefined
          }
          tipoCheque={tipoCheque || "cheque"}
          saving={false}
          verificarNumeroCheque={verificarNumeroChequeVentas}
        />
      )}
    </div>
  );
}

/* ================================================================
   EXPORTED: PanelMediosPagoInlineVenta
================================================================ */
export function PanelMediosPagoInlineVenta({
  mediosFilas,
  mediosPagoList,
  totalCompra,
  onUpdate,
  onRemove,
  onAdd,
  showToast,
  saving = false,
}) {
  const filas = Array.isArray(mediosFilas) && mediosFilas.length ? mediosFilas : [buildEmptyMedioPagoVenta()];

  const sumaMediosPago = useMemo(
    () =>
      filas.reduce((a, r) => {
        const mpObj = mediosPagoList.find(
          (x) => String(getMedioPagoId(x) ?? "") === String(r.id_medio_pago ?? "")
        );
        const tipoCheque = normalizeChequeTipoFromMedio(String(mpObj?.nombre ?? "").trim());
        const monto = tipoCheque !== null && r.cheque ? safeNumber(r.cheque.importe) : safeNumber(r.monto);
        return a + monto;
      }, 0),
    [filas, mediosPagoList]
  );

  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(totalCompra) - sumaMediosPago),
    [totalCompra, sumaMediosPago]
  );

  return (
    <>
      {filas.map((mp) => (
        <MpRowVenta
          key={mp.id}
          row={mp}
          mediosFilas={filas}
          mediosPagoList={mediosPagoList}
          totalCompra={totalCompra}
          sumaMediosPago={sumaMediosPago}
          onUpdate={onUpdate}
          onRemove={onRemove}
          showToast={showToast}
        />
      ))}

      <div className="gm-payment-totals">
        <span className="gm-payment-totals-assigned">
          Asignado: <b>{moneyARS(sumaMediosPago)}</b>
        </span>
        {diferenciaRestante > 0.01 && (
          <span className="gm-payment-totals-missing">Falta: {moneyARS(diferenciaRestante)}</span>
        )}
        {diferenciaRestante <= 0.01 && sumaMediosPago > 0 && <span className="gm-payment-totals-ok">✓ Cubierto</span>}
      </div>

      <button type="button" className="gm-payment-btn" onClick={onAdd} disabled={saving}>
        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> Agregar otro medio
      </button>
    </>
  );
}

/* ================================================================
   MODAL PRINCIPAL
================================================================ */
export default function ModalNuevaVenta({ open, lists, onClose, onToast, onSaved }) {
  const API_BATCH = `${BASE_URL}/api.php?action=ventas_crear_batch`;
  const API_CATALOGO = `${BASE_URL}/api.php?action=catalogo_crear`;
  const API_GET_CLIENTE_FISCAL = `${BASE_URL}/api.php?action=cliente_fiscal_get`;
  const API_SAVE_CLIENTE_FISCAL = `${BASE_URL}/api.php?action=cliente_fiscal_upsert`;
  const API_SAVE_CLIENTE_DESDE_ARCA = `${BASE_URL}/api.php?action=cliente_fiscal_crear_desde_arca`;
  const API_PADRON_CUIT = `${BASE_URL}/api.php?action=padron_cuit&op=padron_cuit`;
  const API_CONFIG_FACTURACION = `${BASE_URL}/api.php?action=config_facturacion_get`;
  const API_VINCULAR_COMPROBANTE = `${BASE_URL}/api.php?action=ventas_comprobantes_vincular_movimiento`;
  const API_VINCULAR_COMPROBANTE_LOTE = `${BASE_URL}/api.php?action=ventas_comprobantes_vincular_movimientos_lote`;
  const API_CHEQUES_ACTUALIZAR = `${BASE_URL}/api.php?action=mov_global_cheques_actualizar`;

  const showToast = useCallback((tipo, mensaje, dur = 2800) => onToast?.(tipo, mensaje, dur), [onToast]);

  const [dark, setDark] = useState(isTemaOscuro);

  useEffect(() => {
    const update = () => setDark(isTemaOscuro());
    const o1 = new MutationObserver(update);
    o1.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const o2 = new MutationObserver(update);
    if (document.body) o2.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => {
      o1.disconnect();
      o2.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const p = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = p;
    };
  }, [open]);

  const [localLists, setLocalLists] = useState(() => ({ ...SAFE_LISTS, ...normalizeLists(lists) }));
  useEffect(() => setLocalLists({ ...SAFE_LISTS, ...normalizeLists(lists) }), [lists]);

  const mediosPagoList = useMemo(
    () => filtrarMediosPagoPorPlan(Array.isArray(localLists.medios_pago) ? localLists.medios_pago : []),
    [localLists.medios_pago]
  );
  const tiposVentaList = useMemo(
    () => (Array.isArray(localLists.tipos_venta) ? localLists.tipos_venta : []),
    [localLists.tipos_venta]
  );
  const detallesList = useMemo(
    () => (Array.isArray(localLists.detalles) ? localLists.detalles : []),
    [localLists.detalles]
  );
  const clientesList = useMemo(
    () => (Array.isArray(localLists.clientes) ? localLists.clientes : []),
    [localLists.clientes]
  );
  const clientesOptions = useMemo(() => [ADD_CLIENTE_OPTION, ...clientesList], [clientesList]);

  const [fecha, setFecha] = useState(todayISO);
  const usuarioBasicoVentas = useMemo(() => usuarioVentaEsBasico(), [open]);
  const [filters, setFilters] = useState({
    id_tipo_venta: NULL_OPTION,
    id_medio_pago: NULL_OPTION,
    id_cliente: NULL_OPTION,
    id_cuenta_corriente: NULL_OPTION,
  });
  const [accionContado, setAccionContado] = useState("guardar");
  const [cliInput, setCliInput] = useState("");
  const [rows, setRows] = useState(() => [buildEmptyRow()]);
  const [descuentoTipo, setDescuentoTipo] = useState("PORCENTAJE");
  const [descuentoValor, setDescuentoValor] = useState("");
  const [mediosFilas, setMediosFilas] = useState(() => [buildEmptyMedioPagoVenta()]);
  const [saving, setSaving] = useState(false);
  const [addUI, setAddUI] = useState({ open: false, kind: null, rowId: null, text: "", cuit: "", fiscalData: null, fiscalError: "", lookupLoading: false, saving: false });
  const [fiscalLoading, setFiscalLoading] = useState(false);
  const [fiscalError, setFiscalError] = useState("");
  const [clienteFiscalDb, setClienteFiscalDb] = useState(null);
  const [fiscalCuitInput, setFiscalCuitInput] = useState("");
  const [fiscalLookupLoading, setFiscalLookupLoading] = useState(false);
  const [fiscalArcaData, setFiscalArcaData] = useState(null);
  const [fiscalPanelOpen, setFiscalPanelOpen] = useState(false);
  const [configFacturacion, setConfigFacturacion] = useState(null);
  const [configsFacturacion, setConfigsFacturacion] = useState([]);
  const [openResumenFactura, setOpenResumenFactura] = useState(false);
  const [resumenFacturaData, setResumenFacturaData] = useState(null);
  const [arcaOperationKey, setArcaOperationKey] = useState("");

  const closeBtnRef = useRef(null);
  const prevOpenRef = useRef(false);
  const rowsContainerRef = useRef(null);
  const fechaInputRef = useRef(null);
  const pdfAssetsPreloadedRef = useRef(false);
  const totalVentaAnteriorRef = useRef(null);
  const [hasScroll, setHasScroll] = useState(false);

  useEffect(() => {
    if (!open || !usuarioBasicoVentas) return;
    const hoy = todayISO();
    if (fecha !== hoy) setFecha(hoy);
  }, [open, usuarioBasicoVentas, fecha]);

  const cerrarFlujoFacturacion = useCallback(() => {
    setOpenResumenFactura(false);
    setResumenFacturaData(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;

    if (!wasOpen && open) {
      setFecha(todayISO());
      setFilters({
        id_tipo_venta: NULL_OPTION,
        id_medio_pago: NULL_OPTION,
        id_cliente: NULL_OPTION,
        id_cuenta_corriente: NULL_OPTION,
      });
      setAccionContado("guardar");
      setCliInput("");
      setRows([buildEmptyRow()]);
      setDescuentoTipo("PORCENTAJE");
      setDescuentoValor("");
      setMediosFilas([buildEmptyMedioPagoVenta()]);
      setAddUI({ open: false, kind: null, rowId: null, text: "", cuit: "", fiscalData: null, fiscalError: "", lookupLoading: false, saving: false });
      setSaving(false);
      setFiscalLoading(false);
      setFiscalError("");
      setClienteFiscalDb(null);
      setFiscalCuitInput("");
      setFiscalLookupLoading(false);
      setFiscalArcaData(null);
      setFiscalPanelOpen(false);
      setConfigFacturacion(null);
      setOpenResumenFactura(false);
      setResumenFacturaData(null);
      totalVentaAnteriorRef.current = null;
      setArcaOperationKey(getOrCreateNuevaVentaArcaKey());
      setTimeout(() => closeBtnRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const el = rowsContainerRef.current;
    if (!el) return;
    const check = () => setHasScroll(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [open, rows]);

  const updateFilter = useCallback((k, v) => setFilters((p) => ({ ...p, [k]: v })), []);
  const addRow = useCallback(() => setRows((p) => [...p, buildEmptyRow()]), []);
  const removeRow = useCallback((id) => {
    setRows((p) => {
      const n = p.filter((r) => r.id !== id);
      return n.length ? n : p;
    });
  }, []);
  const updateRow = useCallback((id, patch) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const addMedioPago = useCallback(() => setMediosFilas((p) => [...p, buildEmptyMedioPagoVenta()]), []);
  const removeMedioPago = useCallback((id) => {
    setMediosFilas((p) => {
      const n = p.filter((r) => r.id !== id);
      return n.length ? n : [buildEmptyMedioPagoVenta()];
    });
  }, []);
  const updateMedioPago = useCallback((id, patch) => {
    setMediosFilas((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);


  const resetAddUIState = useCallback(() => {
    setAddUI({
      open: false,
      kind: null,
      rowId: null,
      text: "",
      cuit: "",
      fiscalData: null,
      fiscalError: "",
      lookupLoading: false,
      saving: false,
    });
  }, []);

  const registrarClienteLocal = useCallback(
    (clienteRaw, fiscalRaw = null) => {
      const cliente = normalizeClienteSimple(clienteRaw);
      if (!cliente.id_cliente) return cliente;

      setLocalLists((prev) => {
        const arr = Array.isArray(prev.clientes) ? prev.clientes.slice() : [];
        const idx = arr.findIndex((x) => Number(getClienteId(x)) === Number(cliente.id_cliente));
        const item = { id: Number(cliente.id_cliente), id_cliente: Number(cliente.id_cliente), nombre: cliente.nombre, activo: cliente.activo };
        if (idx >= 0) arr[idx] = { ...arr[idx], ...item };
        else arr.push(item);
        return { ...prev, clientes: arr };
      });

      updateFilter("id_cliente", String(cliente.id_cliente));
      setCliInput(cliente.nombre || "");

      if (fiscalRaw) {
        const fiscal = normalizeClienteFiscalDb(fiscalRaw);
        setClienteFiscalDb(fiscal);
        setFiscalArcaData(fiscal);
        setFiscalCuitInput(fiscal.cuit || fiscal.doc_nro || "");
      }

      return cliente;
    },
    [updateFilter]
  );

  const startAddCliente = useCallback(() => {
    if (saving) return;
    setAddUI({
      open: true,
      kind: "clientes",
      rowId: null,
      text: cliInput || "",
      cuit: "",
      fiscalData: null,
      fiscalError: "",
      lookupLoading: false,
      saving: false,
    });
  }, [saving, cliInput]);

  const closeAddMini = useCallback(() => {
    if (addUI.saving || addUI.lookupLoading) return;
    resetAddUIState();
  }, [addUI.saving, addUI.lookupLoading, resetAddUIState]);

  const consultarArcaAddCliente = useCallback(async () => {
    const cuit = onlyDigits(addUI.cuit);
    if (cuit.length !== 11) {
      setAddUI((p) => ({ ...p, fiscalError: "Ingresá un CUIT válido de 11 dígitos." }));
      return null;
    }

    setAddUI((p) => ({ ...p, lookupLoading: true, fiscalError: "", fiscalData: null }));
    try {
      const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${cuit}`);
      const summary = data?.data?.summary ?? data?.summary ?? null;
      if (!summary) throw new Error("ARCA no devolvió datos para ese CUIT.");
      const fiscal = normalizeArcaSummary(summary);
      if (!fiscal.cuit || !fiscal.razon_social) throw new Error("ARCA devolvió datos incompletos.");
      setAddUI((p) => ({
        ...p,
        lookupLoading: false,
        fiscalData: fiscal,
        fiscalError: "",
        text: fiscal.razon_social || p.text,
      }));
      return fiscal;
    } catch (e) {
      setAddUI((p) => ({
        ...p,
        lookupLoading: false,
        fiscalData: null,
        fiscalError: e?.message || "No se pudo consultar ARCA.",
      }));
      return null;
    }
  }, [API_PADRON_CUIT, addUI.cuit]);

  const guardarClienteDesdeArcaEnModal = useCallback(
    async (fiscalSource) => {
      const fiscal = normalizeClienteFiscalDb(fiscalSource || {});
      if (!fiscal.cuit || !fiscal.razon_social) {
        throw new Error("Primero consultá un CUIT válido en ARCA.");
      }

      const { idUsuario } = getAuthInfo();
      const saved = await apiPostJson(API_SAVE_CLIENTE_DESDE_ARCA, {
        idUsuario,
        id_cliente: null,
        doc_tipo: Number(fiscal.doc_tipo || 80),
        doc_nro: fiscal.doc_nro || fiscal.cuit,
        cuit: fiscal.cuit,
        razon_social: fiscal.razon_social,
        condicion_iva: fiscal.condicion_iva,
        domicilio: fiscal.domicilio,
        origen: fiscal.origen || "arca_cuit",
        actualizar_nombre_cliente: 1,
        activo: 1,
      });

      if (!saved?.exito || !saved?.cliente || !saved?.cliente_fiscal) {
        throw new Error(saved?.mensaje || "No se pudo guardar el cliente fiscal.");
      }

      const fiscalDb = normalizeClienteFiscalDb(saved.cliente_fiscal);
      const cliente = registrarClienteLocal(saved.cliente, fiscalDb);
      return {
        cliente,
        cliente_fiscal: fiscalDb,
        ya_existia: !!saved?.ya_existia,
        sin_cambios: !!saved?.sin_cambios,
        mensaje: saved?.mensaje || "",
      };
    },
    [API_SAVE_CLIENTE_DESDE_ARCA, registrarClienteLocal]
  );

  const guardarNuevoCatalogo = useCallback(async () => {
    const kind = addUI.kind;
    if (!kind) return;

    const nombre = String(addUI.text || "").trim();
    const cuit = onlyDigits(addUI.cuit);

    if (kind === "clientes") {
      if (cuit.length !== 11) {
        const msg = "Ingresá un CUIT válido de 11 dígitos, presioná Consultar ARCA y después confirmá.";
        setAddUI((p) => ({ ...p, fiscalError: msg }));
        showToast("advertencia", msg, 3600);
        return;
      }

      setAddUI((p) => ({ ...p, saving: true, fiscalError: "" }));
      showToast("cargando", "Consultando ARCA y creando cliente…", 12000);

      try {
        let fiscal = addUI.fiscalData;
        if (!fiscal || onlyDigits(fiscal.cuit) !== cuit) {
          const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${cuit}`);
          const summary = data?.data?.summary ?? data?.summary ?? null;
          if (!summary) throw new Error("ARCA no devolvió datos para ese CUIT.");
          fiscal = normalizeArcaSummary(summary);
        }

        const result = await guardarClienteDesdeArcaEnModal(fiscal);
        resetAddUIState();
        if (result?.ya_existia) {
          showToast(
            "exito",
            `El cliente ya existía. Se seleccionó "${result?.cliente?.nombre || fiscal.razon_social}" sin duplicarlo.`,
            3600
          );
        } else {
          showToast("exito", `Cliente fiscal creado: "${result?.cliente?.nombre || fiscal.razon_social}"`, 3200);
        }
        return;
      } catch (e) {
        setAddUI((p) => ({ ...p, saving: false, fiscalError: e?.message || "No se pudo guardar el cliente desde ARCA." }));
        showToast("error", e?.message || "No se pudo guardar el cliente desde ARCA.", 5200);
        return;
      }
    }

    if (!nombre) {
      showToast("advertencia", "Escribí un nombre antes de guardar.", 3200);
      return;
    }

    setAddUI((p) => ({ ...p, saving: true }));
    showToast("cargando", `Creando ${kind === "detalles" ? "detalle" : "cliente"}…`, 12000);

    try {
      const { idUsuario } = getAuthInfo();
      const data = await apiPostJson(API_CATALOGO, { catalogo: kind, nombre, idUsuario });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo crear.");

      const item = data?.item || {};
      const newId =
        kind === "detalles"
          ? getDetalleId(item) ?? Number(item?.id)
          : getClienteId(item) ?? Number(item?.id);
      const newNombre = String(item?.nombre ?? "").trim() || nombre;

      if (!Number.isFinite(Number(newId)) || Number(newId) <= 0) {
        throw new Error("El servidor no devolvió un ID válido.");
      }

      setLocalLists((prev) => {
        const next = { ...prev };
        const arr = Array.isArray(prev[kind]) ? prev[kind].slice() : [];
        const already = arr.some((x) => {
          const xid = kind === "detalles" ? getDetalleId(x) : getClienteId(x);
          return Number(xid) === Number(newId);
        });
        if (!already) arr.push({ id: Number(newId), id_cliente: kind === "clientes" ? Number(newId) : undefined, nombre: newNombre });
        next[kind] = arr;
        return next;
      });

      if (kind === "clientes") {
        updateFilter("id_cliente", String(newId));
        setCliInput(newNombre);
        setClienteFiscalDb(null);
        setFiscalArcaData(null);
        setFiscalCuitInput("");
        setFiscalError("");
      }

      resetAddUIState();
      showToast("exito", `${kind === "detalles" ? "Detalle" : "Cliente"} creado: "${newNombre}"`, 2600);
    } catch (e) {
      setAddUI((p) => ({ ...p, saving: false }));
      showToast("error", e?.message || "Error creando.", 4200);
    }
  }, [
    API_CATALOGO,
    API_PADRON_CUIT,
    addUI,
    guardarClienteDesdeArcaEnModal,
    resetAddUIState,
    showToast,
    updateFilter,
  ]);

  const clienteResolvedFromInput = useMemo(() => resolveClienteByInput(clientesList, cliInput), [clientesList, cliInput]);

  const selectedClienteId = useMemo(() => {
    const d = Number(filters.id_cliente);
    if (Number.isFinite(d) && d > 0) return d;
    return getClienteId(clienteResolvedFromInput) ?? 0;
  }, [filters.id_cliente, clienteResolvedFromInput]);

  const selectedClienteNombre = useMemo(
    () =>
      clienteResolvedFromInput?.nombre
        ? String(clienteResolvedFromInput.nombre).trim()
        : String(cliInput || "").trim(),
    [clienteResolvedFromInput, cliInput]
  );

  useEffect(() => {
    if (!open) return;
    const direct = Number(filters.id_cliente);
    const fallbackId = getClienteId(clienteResolvedFromInput);
    if ((!Number.isFinite(direct) || direct <= 0) && fallbackId) {
      setFilters((prev) =>
        String(prev.id_cliente) === String(fallbackId)
          ? prev
          : { ...prev, id_cliente: String(fallbackId) }
      );
    }
  }, [open, filters.id_cliente, clienteResolvedFromInput]);

  const handleClienteInputChange = useCallback((val) => {
    setCliInput(val);
    setFilters((p) => ({ ...p, id_cliente: NULL_OPTION }));
    setClienteFiscalDb(null);
    setFiscalArcaData(null);
    setFiscalCuitInput("");
    setFiscalError("");
  }, []);

  const handleSelectCliente = useCallback((cli) => {
    if (isAddClienteOption(cli)) {
      startAddCliente();
      return;
    }

    setCliInput(String(cli?.nombre ?? "").trim());
    setFilters((p) => ({
      ...p,
      id_cliente: getClienteId(cli) != null ? String(getClienteId(cli)) : NULL_OPTION,
    }));
    setClienteFiscalDb(null);
    setFiscalArcaData(null);
    setFiscalCuitInput("");
    setFiscalError("");
  }, [startAddCliente]);

  const handleSelectDetalle = useCallback(
    (detalle, rowId) => {
      const idStockProducto = getStockProductoId(detalle);
      const idStockVariante = getStockVarianteId(detalle);
      const preciosDisponibles = getDetallePreciosDisponibles(detalle);
      const precioInicial = pickDetallePrecioInicial(preciosDisponibles);
      const precio = Number(precioInicial?.monto ?? detalle?.precio ?? 0);
      const stockDisponible = getStockDisponible(detalle);
      const sinStock = isSinStock(stockDisponible);
      const nombreDetalle = getDetalleNombre(detalle);

      updateRow(rowId, {
        id_detalle: idStockProducto ? String(idStockProducto) : NULL_OPTION,
        id_stock_producto: idStockProducto ? String(idStockProducto) : NULL_OPTION,
        id_stock_variante: idStockVariante ? String(idStockVariante) : NULL_OPTION,
        detalleText: nombreDetalle,
        precio,
        id_tipo_precio_stock: String(precioInicial?.value ?? NULL_OPTION),
        precio_tipo_label: String(precioInicial?.tipo_precio ?? ""),
        precios_disponibles: preciosDisponibles,
        stock_disponible: stockDisponible,
        sinStock,
        cantidad: sinStock ? "" : 1,
      });

      if (sinStock) {
        showToast("advertencia", `El producto "${nombreDetalle}" no tiene stock disponible.`, 2500);
      }
    },
    [updateRow, showToast]
  );

  const barcodePendingRef = useRef(null);

  const handleBarcodeProductSelect = useCallback((producto) => {
    const target = rows.find((row) =>
      !Number(row?.id_stock_producto || 0) &&
      !Number(row?.id_stock_variante || 0) &&
      !String(row?.detalleText || "").trim()
    );

    if (target) {
      handleSelectDetalle(producto, target.id);
      showToast("exito", `Producto leído: ${getDetalleNombre(producto)}`, 1800);
      return;
    }

    const nextRow = buildEmptyRow();
    barcodePendingRef.current = { rowId: nextRow.id, producto };
    setRows((prev) => [...prev, nextRow]);
  }, [rows, handleSelectDetalle, showToast]);

  useEffect(() => {
    const pending = barcodePendingRef.current;
    if (!pending || !rows.some((row) => row.id === pending.rowId)) return;
    barcodePendingRef.current = null;
    handleSelectDetalle(pending.producto, pending.rowId);
    showToast("exito", `Producto leído: ${getDetalleNombre(pending.producto)}`, 1800);
  }, [rows, handleSelectDetalle, showToast]);

  useStockBarcodeScanner({
    enabled: open && !saving && !addUI.open && !openResumenFactura,
    options: detallesList,
    allowOutOfStock: false,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => showToast("advertencia", mensaje, 3200),
  });

  const handlePrecioTipoChange = useCallback(
    (rowId, selectedValue) => {
      const row = rows.find((x) => x.id === rowId);
      if (!row) return;
      const precios = Array.isArray(row.precios_disponibles) ? row.precios_disponibles : [];
      const selected = precios.find((p) => String(p?.value ?? "") === String(selectedValue ?? ""));
      if (!selected) return;

      updateRow(rowId, {
        id_tipo_precio_stock: String(selected.value ?? NULL_OPTION),
        precio_tipo_label: String(selected.tipo_precio ?? ""),
        precio: Number(selected.monto ?? 0),
      });
    },
    [rows, updateRow]
  );

  const handleCantidadChange = useCallback(
    (rowId, newCantidad) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;

      if (row.sinStock || isSinStock(row.stock_disponible)) {
        updateRow(rowId, { cantidad: "" });
        return;
      }

      const stockDisponible = row.stock_disponible;
      let cantidadFinal = newCantidad === "" ? "" : Number(newCantidad);

      if (typeof cantidadFinal === "number" && cantidadFinal < 0) cantidadFinal = 0;

      if (
        stockDisponible !== null &&
        stockDisponible !== undefined &&
        stockDisponible !== "" &&
        typeof cantidadFinal === "number" &&
        cantidadFinal > Number(stockDisponible)
      ) {
        cantidadFinal = Number(stockDisponible);
        showToast("advertencia", `Stock máximo disponible: ${stockDisponible}`, 2000);
      }

      updateRow(rowId, { cantidad: cantidadFinal });
    },
    [rows, updateRow, showToast]
  );

  useEffect(() => {
    if (!open) return;

    const h = (e) => {
      if (e.key !== "Escape") return;

      // Si está abierto el modal superior de Nuevo Cheque,
      // este modal de atrás NO debe cerrarse con Escape.
      if (document.body.classList.contains("modal-nuevo-cheque-open")) {
        return;
      }

      if (openResumenFactura || addUI.open || fiscalPanelOpen) return;

      e.preventDefault();
      e.stopPropagation();



      onClose?.();
    };

    document.addEventListener("keydown", h, true);

    return () => {
      document.removeEventListener("keydown", h, true);
    };
  }, [open, onClose, openResumenFactura, addUI.open, fiscalPanelOpen]);

  const rowsBaseCalc = useMemo(
    () =>
      rows.map((r) => {
        const tieneItemSeleccionado = getSelectedSaleItemId(r) !== null;
        const cantidad = Math.max(0, safeNumber(r.cantidad));
        const precioLista = Math.max(0, safeNumber(r.precio));
        const ivaPct = Math.max(0, safeNumber(r.ivaPct));
        const subtotalBruto = tieneItemSeleccionado ? roundMoney(cantidad * precioLista) : 0;
        const ivaMontoBruto = roundMoney(subtotalBruto * (ivaPct / 100));
        const totalBruto = roundMoney(subtotalBruto + ivaMontoBruto);
        return {
          ...r,
          precioLista,
          subtotalBruto,
          ivaMontoBruto,
          totalBruto,
        };
      }),
    [rows]
  );

  const descuentoResumen = useMemo(() => {
    const totalBruto = roundMoney(rowsBaseCalc.reduce((acc, r) => acc + safeNumber(r.totalBruto), 0));
    const tipo = descuentoTipo === "MONTO" ? "MONTO" : "PORCENTAJE";
    const valorIngresado = Math.max(0, safeNumber(descuentoValor));
    const valorNormalizado = tipo === "PORCENTAJE"
      ? roundMoney(Math.min(valorIngresado, 99.99))
      : roundMoney(valorIngresado);
    const maximoAplicable = Math.max(0, roundMoney(totalBruto - 0.01));
    const solicitado = tipo === "PORCENTAJE"
      ? roundMoney(totalBruto * (valorNormalizado / 100))
      : valorNormalizado;
    const monto = Math.min(maximoAplicable, solicitado);
    const totalFinal = roundMoney(totalBruto - monto);
    const porcentajeEfectivo = totalBruto > 0 ? (monto / totalBruto) * 100 : 0;

    return {
      tipo,
      valor: valorNormalizado,
      monto,
      totalBruto,
      totalFinal,
      porcentajeEfectivo,
      factor: totalBruto > 0 ? totalFinal / totalBruto : 1,
    };
  }, [rowsBaseCalc, descuentoTipo, descuentoValor]);

  const rowsCalc = useMemo(() => {
    const validIndexes = rowsBaseCalc
      .map((r, index) => (safeNumber(r.totalBruto) > 0 ? index : -1))
      .filter((index) => index >= 0);
    const lastValidIndex = validIndexes.length ? validIndexes[validIndexes.length - 1] : -1;
    let totalNetoAcumulado = 0;

    return rowsBaseCalc.map((r, index) => {
      const cantidad = Math.max(0, safeNumber(r.cantidad));
      const ivaPct = Math.max(0, safeNumber(r.ivaPct));
      const totalBruto = roundMoney(r.totalBruto);

      if (totalBruto <= 0 || descuentoResumen.monto <= 0) {
        return {
          ...r,
          precio: r.precioLista,
          subtotal: r.subtotalBruto,
          ivaMonto: r.ivaMontoBruto,
          total: r.totalBruto,
          descuentoMonto: 0,
          descuentoSubtotalMonto: 0,
          bonifPctAplicado: 0,
        };
      }

      const totalNeto = index === lastValidIndex
        ? roundMoney(descuentoResumen.totalFinal - totalNetoAcumulado)
        : roundMoney(totalBruto * descuentoResumen.factor);
      totalNetoAcumulado = roundMoney(totalNetoAcumulado + totalNeto);

      const divisorIva = 1 + ivaPct / 100;
      const subtotal = divisorIva > 0 ? roundMoney(totalNeto / divisorIva) : totalNeto;
      const ivaMonto = roundMoney(totalNeto - subtotal);
      const precioNeto = cantidad > 0 ? roundMoney(subtotal / cantidad) : 0;
      const descuentoMonto = roundMoney(totalBruto - totalNeto);
      const descuentoSubtotalMonto = roundMoney(r.subtotalBruto - subtotal);
      const bonifPctAplicado = r.subtotalBruto > 0
        ? (descuentoSubtotalMonto / r.subtotalBruto) * 100
        : 0;

      return {
        ...r,
        precio: precioNeto,
        subtotal,
        ivaMonto,
        total: totalNeto,
        descuentoMonto,
        descuentoSubtotalMonto,
        bonifPctAplicado,
      };
    });
  }, [rowsBaseCalc, descuentoResumen]);

  const resumen = useMemo(
    () => ({
      subtotal: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.subtotal), 0)),
      iva: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.ivaMonto), 0)),
      total: roundMoney(rowsCalc.reduce((a, r) => a + safeNumber(r.total), 0)),
      totalBruto: descuentoResumen.totalBruto,
      descuento: descuentoResumen.monto,
      descuentoTipo: descuentoResumen.tipo,
      descuentoValor: descuentoResumen.valor,
      descuentoPorcentajeEfectivo: descuentoResumen.porcentajeEfectivo,
    }),
    [rowsCalc, descuentoResumen]
  );

  const tipoVentaSelected = useMemo(() => {
    const id = Number(filters.id_tipo_venta);
    if (!Number.isFinite(id) || id <= 0) return null;
    return tiposVentaList.find((x) => Number(x?.id ?? x?.id_tipo_venta ?? 0) === id) || null;
  }, [filters.id_tipo_venta, tiposVentaList]);

  const isContado = useMemo(() => isContadoTipoVenta(tipoVentaSelected), [tipoVentaSelected]);
  const tipoVentaSeleccionado = tipoVentaSelected !== null;
  const isCuentaCorriente = tipoVentaSeleccionado && !isContado;

  useEffect(() => {
    if (isContado) return;
    setMediosFilas([buildEmptyMedioPagoVenta()]);
  }, [isContado]);

  const sumaMediosPago = useMemo(() => {
    return mediosFilas.reduce((acc, mp) => {
      const mpRow = mediosPagoList.find(
        (x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago ?? "")
      );
      const tipoCheque = normalizeChequeTipoFromMedio(getMedioPagoNombre(mpRow));
      return acc + (tipoCheque !== null ? safeNumber(mp.cheque?.importe) : safeNumber(mp.monto));
    }, 0);
  }, [mediosFilas, mediosPagoList]);

  useEffect(() => {
    const totalActual = roundMoney(resumen.total);
    const totalAnterior = totalVentaAnteriorRef.current;
    totalVentaAnteriorRef.current = totalActual;

    if (!open || !isContado || totalAnterior === null || Math.abs(totalActual - totalAnterior) <= 0.004) {
      return;
    }

    setMediosFilas((filasActuales) => {
      const filas = Array.isArray(filasActuales) ? filasActuales : [];
      const montoFila = (fila) => {
        const mpRow = mediosPagoList.find(
          (x) => String(getMedioPagoId(x) ?? "") === String(fila?.id_medio_pago ?? "")
        );
        const tipoCheque = normalizeChequeTipoFromMedio(getMedioPagoNombre(mpRow));
        return tipoCheque !== null && fila?.cheque
          ? roundMoney(safeNumber(fila.cheque?.importe))
          : roundMoney(safeNumber(fila?.monto));
      };

      const totalAsignado = roundMoney(filas.reduce((acc, fila) => acc + montoFila(fila), 0));

      // Sólo se reajusta automáticamente cuando los medios cubrían exactamente
      // el total anterior. Así un excedente cargado a propósito sigue intacto.
      if (Math.abs(totalAsignado - totalAnterior) > 0.05) return filasActuales;

      let diferencia = roundMoney(totalActual - totalAsignado);
      if (Math.abs(diferencia) <= 0.009) return filasActuales;

      const nuevasFilas = filas.map((fila) => ({
        ...fila,
        cheque: fila?.cheque ? { ...fila.cheque } : null,
      }));
      const candidatos = nuevasFilas
        .map((fila, index) => {
          const mpRow = mediosPagoList.find(
            (x) => String(getMedioPagoId(x) ?? "") === String(fila?.id_medio_pago ?? "")
          );
          const esCheque = normalizeChequeTipoFromMedio(getMedioPagoNombre(mpRow)) !== null;
          return {
            index,
            esCheque,
            seleccionado: Boolean(fila?.id_medio_pago),
            monto: montoFila(fila),
          };
        })
        .filter((item) => item.seleccionado)
        .sort((a, b) => Number(a.esCheque) - Number(b.esCheque) || b.index - a.index);

      if (!candidatos.length) return filasActuales;

      if (diferencia > 0) {
        const objetivo = candidatos[0];
        const fila = nuevasFilas[objetivo.index];
        const montoNuevo = roundMoney(objetivo.monto + diferencia);
        fila.monto = montoNuevo;
        fila.montoDraft = "";
        fila.montoFocused = false;
        if (fila.cheque) fila.cheque.importe = montoNuevo;
        return nuevasFilas;
      }

      let reduccionPendiente = Math.abs(diferencia);
      for (const candidato of candidatos) {
        if (reduccionPendiente <= 0.009) break;
        const fila = nuevasFilas[candidato.index];
        const montoAnterior = montoFila(fila);
        const reduccion = Math.min(montoAnterior, reduccionPendiente);
        const montoNuevo = roundMoney(montoAnterior - reduccion);
        fila.monto = montoNuevo;
        fila.montoDraft = "";
        fila.montoFocused = false;
        if (fila.cheque) fila.cheque.importe = montoNuevo;
        reduccionPendiente = roundMoney(reduccionPendiente - reduccion);
      }

      return nuevasFilas;
    });
  }, [open, isContado, resumen.total, mediosPagoList]);

  const fetchClienteFiscal = useCallback(
    async (idCliente) => {
      const id = Number(idCliente);
      if (!Number.isFinite(id) || id <= 0) return null;

      setFiscalLoading(true);
      setFiscalError("");
      setClienteFiscalDb(null);
      setFiscalArcaData(null);

      try {
        const data = await apiGetJson(`${API_GET_CLIENTE_FISCAL}&id_cliente=${id}`);
        if (data?.existe && data?.cliente_fiscal) {
          const n = normalizeClienteFiscalDb(data.cliente_fiscal);
          setClienteFiscalDb(n);
          setFiscalCuitInput(n.cuit || n.doc_nro || "");
          return n;
        }
        setClienteFiscalDb(null);
        return null;
      } catch (e) {
        setFiscalError(e?.message || "Error consultando datos fiscales.");
        return null;
      } finally {
        setFiscalLoading(false);
      }
    },
    [API_GET_CLIENTE_FISCAL]
  );

  const fetchConfigFacturacion = useCallback(async () => {
    const data = await apiGetJson(API_CONFIG_FACTURACION);
    const cfgDefault = data?.config || data?.data?.config || data?.data || data || null;
    const cuentas = mergeConfigsFacturacionList(
      extractConfigsFacturacionResponse(data),
      cfgDefault ? [cfgDefault] : [],
      configFacturacion ? [configFacturacion] : []
    );

    const cfg = cfgDefault || cuentas[0] || null;
    if (!cfg) throw new Error("No se pudo obtener config de facturación.");

    const cfgConCuentas = {
      ...cfg,
      _configs_facturacion: cuentas.length ? cuentas : [cfg],
    };

    setConfigFacturacion(cfgConCuentas);
    setConfigsFacturacion(cuentas.length ? cuentas : [cfg]);
    return cfgConCuentas;
  }, [API_CONFIG_FACTURACION, configFacturacion]);

  const buscarFiscalEnArcaPorCuit = useCallback(
    async (cuitRaw) => {
      const cuit = onlyDigits(cuitRaw);
      setFiscalError("");
      setFiscalArcaData(null);

      if (cuit.length !== 11) throw new Error("Ingresá un CUIT válido de 11 dígitos.");

      setFiscalLookupLoading(true);
      try {
        const data = await apiGetJson(`${API_PADRON_CUIT}&cuit=${cuit}`);
        const summary = data?.data?.summary ?? data?.summary ?? null;
        if (!summary) throw new Error("ARCA no devolvió datos para ese CUIT.");
        const norm = normalizeArcaSummary(summary);
        if (!norm.cuit || !norm.razon_social) throw new Error("ARCA devolvió datos incompletos.");
        setFiscalArcaData(norm);
        return norm;
      } catch (e) {
        setFiscalArcaData(null);
        setFiscalError(e?.message || "Error consultando ARCA.");
        throw e;
      } finally {
        setFiscalLookupLoading(false);
      }
    },
    [API_PADRON_CUIT]
  );

  const guardarClienteFiscalDesdeArca = useCallback(
    async (fiscalSource, opts = {}) => {
      const fiscal = normalizeClienteFiscalDb(fiscalSource || {});
      if (!fiscal.cuit || !fiscal.razon_social) throw new Error("Datos fiscales inválidos.");

      const idClienteObjetivo = Number(opts?.id_cliente ?? selectedClienteId ?? 0) || null;
      const { idUsuario } = getAuthInfo();
      const saved = await apiPostJson(API_SAVE_CLIENTE_DESDE_ARCA, {
        idUsuario,
        id_cliente: idClienteObjetivo,
        doc_tipo: Number(fiscal.doc_tipo || 80),
        doc_nro: fiscal.doc_nro || fiscal.cuit,
        cuit: fiscal.cuit,
        razon_social: fiscal.razon_social,
        condicion_iva: fiscal.condicion_iva,
        domicilio: fiscal.domicilio,
        origen: fiscal.origen || "arca_cuit",
        actualizar_nombre_cliente: opts?.actualizar_nombre_cliente === false ? 0 : 1,
        activo: 1,
      });

      if (!saved?.exito || !saved?.cliente_fiscal) {
        throw new Error(saved?.mensaje || "No se pudieron guardar los datos fiscales.");
      }

      const n = normalizeClienteFiscalDb(saved.cliente_fiscal);
      const cliente = saved?.cliente ? registrarClienteLocal(saved.cliente, n) : null;
      setClienteFiscalDb(n);
      setFiscalCuitInput(n.cuit || n.doc_nro || "");
      return {
        cliente,
        cliente_fiscal: n,
        ya_existia: !!saved?.ya_existia,
        sin_cambios: !!saved?.sin_cambios,
        mensaje: saved?.mensaje || "",
      };
    },
    [API_SAVE_CLIENTE_DESDE_ARCA, registrarClienteLocal, selectedClienteId]
  );

  const guardarClienteFiscal = useCallback(
    async (fiscalSource) => {
      const result = await guardarClienteFiscalDesdeArca(fiscalSource, {
        id_cliente: selectedClienteId || null,
        actualizar_nombre_cliente: true,
      });
      return result.cliente_fiscal;
    },
    [guardarClienteFiscalDesdeArca, selectedClienteId]
  );

  const resolveFiscalForFacturacion = useCallback(async () => {
    if (!selectedClienteId) throw new Error("Seleccioná un cliente antes de facturar.");
    const cuitIngresado = onlyDigits(fiscalCuitInput);

    if (clienteFiscalDb?.id_cliente === selectedClienteId && clienteFiscalDb?.cuit) return clienteFiscalDb;

    const fiscalDb = await fetchClienteFiscal(selectedClienteId);
    if (fiscalDb?.cuit) return fiscalDb;

    if (cuitIngresado.length !== 11) {
      throw new Error("Este cliente no tiene datos fiscales guardados. Ingresá el CUIT para continuar.");
    }

    const fiscalArca = await buscarFiscalEnArcaPorCuit(cuitIngresado);
    const fiscalGuardado = await guardarClienteFiscal(fiscalArca);
    showToast("exito", "Datos fiscales obtenidos y guardados correctamente.", 2600);
    return fiscalGuardado;
  }, [
    selectedClienteId,
    clienteFiscalDb,
    fiscalCuitInput,
    fetchClienteFiscal,
    buscarFiscalEnArcaPorCuit,
    guardarClienteFiscal,
    showToast,
  ]);

  const validate = useCallback((opts = {}) => {
    const skipCliente = Boolean(opts?.skipCliente);
    const cliTxt = String(cliInput || "").trim();
    if (!skipCliente && !(selectedClienteId > 0 || cliTxt.length > 0)) {
      return { ok: false, msg: "Falta seleccionar un Cliente (obligatorio)." };
    }

    const tv = Number(filters.id_tipo_venta);
    if (!Number.isFinite(tv) || tv <= 0) {
      return { ok: false, msg: "Falta seleccionar la Forma de venta." };
    }

    const descuentoIngresado = safeNumber(descuentoValor);
    if (descuentoIngresado < 0) {
      return { ok: false, msg: "El descuento no puede ser negativo." };
    }
    if (descuentoTipo === "PORCENTAJE" && descuentoIngresado >= 100) {
      return { ok: false, msg: "El descuento porcentual debe ser menor al 100 %." };
    }
    if (descuentoTipo === "MONTO" && descuentoIngresado > 0 && descuentoIngresado >= resumen.totalBruto) {
      return { ok: false, msg: "El descuento en pesos debe ser menor al total de la venta." };
    }

    if (isContado) {
      const filasPago = mediosFilas.filter((r) => r.id_medio_pago && r.id_medio_pago !== "");
      if (!filasPago.length) {
        return { ok: false, msg: "Venta contado: configurá al menos un medio de pago." };
      }

      for (let i = 0; i < filasPago.length; i++) {
        const mp = filasPago[i];
        const mpRow = mediosPagoList.find(
          (x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago ?? "")
        );
        const tipoCheque = normalizeChequeTipoFromMedio(getMedioPagoNombre(mpRow));

        if (!mp.id_medio_pago || mp.id_medio_pago === NULL_OPTION) {
          return { ok: false, msg: `Medio de pago ${i + 1}: falta seleccionar el medio.` };
        }

        if (tipoCheque !== null) {
          if (!mp.cheque) {
            return {
              ok: false,
              msg: `Medio de pago ${i + 1}: falta cargar el ${tipoCheque === "echeq" ? "eCheq" : "cheque"}.`,
            };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mp.cheque?.fecha_emision || "").slice(0, 10))) {
            return {
              ok: false,
              msg: `Medio de pago ${i + 1}: falta la fecha de emisión del cheque.`,
            };
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mp.cheque?.fecha_pago || "").slice(0, 10))) {
            return {
              ok: false,
              msg: `Medio de pago ${i + 1}: falta la fecha de pago del cheque.`,
            };
          }
          if (safeNumber(mp.cheque?.importe) <= 0) {
            return {
              ok: false,
              msg: `Medio de pago ${i + 1}: el importe del cheque debe ser mayor a 0.`,
            };
          }
        } else if (safeNumber(mp.monto) <= 0) {
          return { ok: false, msg: `Medio de pago ${i + 1}: el monto debe ser mayor a 0.` };
        }
      }

      if (sumaMediosPago < resumen.total - 0.05 && resumen.total > 0) {
        return {
          ok: false,
          msg: `La suma de los medios de pago (${moneyARS(sumaMediosPago)}) no cubre el total de la venta (${moneyARS(resumen.total)}).`,
        };
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) {
      return { ok: false, msg: "La fecha es obligatoria y debe ser la seleccionada en el modal." };
    }

    const periodoApi = fechaToYYYYMM(fecha);
    if (!/^\d{4}-\d{2}$/.test(periodoApi)) {
      return { ok: false, msg: "La fecha es inválida." };
    }
    
    const hoy = todayISO();
    if (usuarioBasicoVentas && fecha !== hoy) {
      return {
        ok: false,
        msg: "Tu usuario solo puede cargar ventas con fecha del día actual.",
      };
    }

    // Validación: no permitir fechas futuras
    if (fecha > hoy) {
      return {
        ok: false,
        msg: "La fecha no puede ser posterior al día actual.",
      };
    }

    const problems = [];
    rowsCalc.forEach((r, i) => {
      const p = describeLineProblem(r, i + 1);
      if (p) problems.push(p);
    });

    const usable = rowsCalc.filter(isUsableSaleRow);

    if (!usable.length) {
      if (problems.length) {
        const msg = problems.slice(0, 2).join(" ");
        const extra = problems.length > 2 ? ` (y ${problems.length - 2} más)` : "";
        return { ok: false, msg: `No hay filas válidas. ${msg}${extra}` };
      }
      return { ok: false, msg: "Cargá al menos 1 fila válida (Detalle + Cantidad + Precio)." };
    }

    return { ok: true, warn: problems.length > 0 };
  }, [cliInput, selectedClienteId, filters, isContado, fecha, usuarioBasicoVentas, rowsCalc, mediosFilas, mediosPagoList, resumen, sumaMediosPago, descuentoTipo, descuentoValor]);

  const buildResumenFacturaPayload = useCallback(
    (clienteFiscalResuelto, cfg, clienteOverride = null) => {
      const items = rowsCalc
        .filter(isUsableSaleRow)
        .map((r, i) => ({
          codigo: String(i + 1),
          descripcion: safeStr(r.detalleText),
          cantidad: Number(r.cantidad || 0),
          unidad: "u",
          precio_unitario: Number(r.precioLista ?? r.precio ?? 0),
          precio: Number(r.precioLista ?? r.precio ?? 0),
          bonif_pct: Number(r.bonifPctAplicado || 0),
          impBonif: Number(r.descuentoSubtotalMonto || 0),
          subtotal: Number(r.subtotal || 0),
          ars: Number(r.total || 0),
          iva_pct: Number(r.ivaPct || 0),
          iva_monto: Number(r.ivaMonto || 0),
          total: Number(r.total || 0),
        }));

      const puntoVenta = Number(String(cfg?.punto_venta || "2").replace(/\D/g, "")) || 2;
      const codigoCbte = Number(String(cfg?.codigo_comprobante || "11").replace(/\D/g, "")) || 11;
      const mediosPayload = buildMediosPagoPayload(mediosFilas, mediosPagoList);
      const primerMedioId = mediosPayload[0]?.id_medio_pago || null;
      const emisorPdf = normalizeConfigFacturacionPdf(cfg || {});
      const clienteFinal = clienteOverride ? normalizeClienteSimple(clienteOverride) : null;
      const labelClienteFinal = clienteFinal?.nombre || selectedClienteNombre || safeStr(clienteFiscalResuelto?.razon_social) || "Cliente";
      const idClienteFinal = Number(clienteFinal?.id_cliente || selectedClienteId || 0) || null;

      return {
        id_pago: null,
        id_sistema: null,
        labelCliente: labelClienteFinal,
        labelSistema: "Nueva venta",
        config_facturacion: cfg || {},
        ...emisorPdf,
        cliente_facturacion: {
          doc_tipo: Number(clienteFiscalResuelto?.doc_tipo || 80),
          doc_nro: safeStr(clienteFiscalResuelto?.doc_nro || clienteFiscalResuelto?.cuit),
          cuit: safeStr(clienteFiscalResuelto?.cuit),
          razon_social: safeStr(clienteFiscalResuelto?.razon_social),
          cond_iva: safeStr(clienteFiscalResuelto?.condicion_iva || clienteFiscalResuelto?.cond_iva),
          condicion_iva: safeStr(clienteFiscalResuelto?.condicion_iva || clienteFiscalResuelto?.cond_iva),
          domicilio: safeStr(clienteFiscalResuelto?.domicilio),
          origen: safeStr(clienteFiscalResuelto?.origen || "arca_cuit"),
        },
        id_cliente: idClienteFinal,
        id_tipo_venta: Number(filters.id_tipo_venta || 0) || null,
        id_medio_pago: isContado ? primerMedioId : null,
        id_clasificacion: null,
        fecha_cbte_iso: String(fecha).slice(0, 10),
        vto_pago_iso: plusDaysISOFrom(fecha, 10),
        cbte_tipo: codigoCbte,
        pto_vta: puntoVenta,
        items_facturacion: items,
        total_ars: Number(resumen.total || 0),
        monto: Number(resumen.total || 0),
        importe: Number(resumen.total || 0),
        descuento_tipo: resumen.descuento > 0 ? resumen.descuentoTipo : null,
        descuento_valor: resumen.descuento > 0 ? Number(resumen.descuentoValor || 0) : 0,
        descuento_monto: Number(resumen.descuento || 0),
        total_bruto: Number(resumen.totalBruto || resumen.total || 0),
        operacion_key: arcaOperationKey || getOrCreateNuevaVentaArcaKey(),
        operacion_contexto: "FACTURA_VENTA",
        operacion_id_origen: null,
        observaciones: resumen.descuento > 0
          ? `Descuento comercial aplicado: ${resumen.descuentoTipo === "PORCENTAJE" ? `${Number(resumen.descuentoValor || 0).toLocaleString("es-AR")}%` : moneyARS(resumen.descuento)}.`
          : "",
        emisor: emisorPdf.emisor,
      };
    },
    [rowsCalc, mediosFilas, mediosPagoList, selectedClienteNombre, selectedClienteId, filters.id_tipo_venta, fecha, isContado, resumen, arcaOperationKey]
  );

  const buildVentaNoFacturadaPayload = useCallback(
    (cfg = null, clienteFiscalOverride = null) => {
      const items = rowsCalc
        .filter(isUsableSaleRow)
        .map((r, i) => ({
          id: r.id,
          id_detalle: Number(getSelectedSaleItemId(r) || 0),
          codigo: String(i + 1),
          descripcion: safeStr(r.detalleText),
          cantidad: Number(r.cantidad || 0),
          unidad: "u",
          precio_unitario: Number(r.precioLista ?? r.precio ?? 0),
          precio: Number(r.precioLista ?? r.precio ?? 0),
          bonif_pct: Number(r.bonifPctAplicado || 0),
          impBonif: Number(r.descuentoSubtotalMonto || 0),
          subtotal: Number(r.subtotal || 0),
          ars: Number(r.total || 0),
          iva_pct: Number(r.ivaPct || 0),
          iva_monto: Number(r.ivaMonto || 0),
          total: Number(r.total || 0),
        }));

      const mediosPayload = buildMediosPagoPayload(mediosFilas, mediosPagoList);
      const primerMedioId = mediosPayload[0]?.id_medio_pago || null;
      const clienteFiscal = clienteFiscalOverride || clienteFiscalDb || fiscalArcaData || {};
      const emisorPdf = normalizeConfigFacturacionPdf(cfg || {});
      const nombreCliente =
        selectedClienteNombre || safeStr(cliInput) || safeStr(clienteFiscal?.razon_social) || "Cliente";

      return {
        id_pago: null,
        id_sistema: null,
        labelCliente: nombreCliente,
        labelSistema: "Nueva venta",
        cliente_facturacion: buildClienteFiscalPdf(clienteFiscal, clienteResolvedFromInput, nombreCliente),
        config_facturacion: cfg || {},
        ...emisorPdf,
        id_cliente: selectedClienteId || null,
        id_tipo_venta: Number(filters.id_tipo_venta || 0) || null,
        tipo_venta_nombre: safeStr(
          tipoVentaSelected?.nombre || tipoVentaSelected?.descripcion || tipoVentaSelected?.detalle || "Contado"
        ),
        id_medio_pago: isContado ? primerMedioId : null,
        id_clasificacion: null,
        fecha_cbte_iso: String(fecha).slice(0, 10),
        vto_pago_iso: plusDaysISOFrom(fecha, 10),
        cbte_tipo: null,
        pto_vta: null,
        items_facturacion: items,
        medios_pago: mediosPayload,
        total_ars: Number(resumen.total || 0),
        monto: Number(resumen.total || 0),
        importe: Number(resumen.total || 0),
        descuento_tipo: resumen.descuento > 0 ? resumen.descuentoTipo : null,
        descuento_valor: resumen.descuento > 0 ? Number(resumen.descuentoValor || 0) : 0,
        descuento_monto: Number(resumen.descuento || 0),
        total_bruto: Number(resumen.totalBruto || resumen.total || 0),
        observaciones: resumen.descuento > 0
          ? `Comprobante interno generado automáticamente por una venta no facturada. Descuento comercial aplicado: ${resumen.descuentoTipo === "PORCENTAJE" ? `${Number(resumen.descuentoValor || 0).toLocaleString("es-AR")}%` : moneyARS(resumen.descuento)}. Sin CAE, sin QR fiscal y sin validez fiscal.`
          : "Comprobante interno generado automáticamente por una venta no facturada. Sin CAE, sin QR fiscal y sin validez fiscal.",
        emisor: emisorPdf.emisor,
      };
    },
    [
      rowsCalc,
      mediosFilas,
      mediosPagoList,
      clienteFiscalDb,
      fiscalArcaData,
      clienteResolvedFromInput,
      selectedClienteNombre,
      cliInput,
      selectedClienteId,
      filters.id_tipo_venta,
      tipoVentaSelected,
      isContado,
      fecha,
      resumen,
    ]
  );

  useEffect(() => {
    if (!open) {
      pdfAssetsPreloadedRef.current = false;
      return undefined;
    }

    if (pdfAssetsPreloadedRef.current) return undefined;
    pdfAssetsPreloadedRef.current = true;

    const timer = window.setTimeout(() => {
      try {
        preloadVentaNoFacturadaPdfAssets(buildVentaNoFacturadaPayload(configFacturacion || {}));
      } catch {
        preloadVentaNoFacturadaPdfAssets({});
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [open, configFacturacion, buildVentaNoFacturadaPayload]);

  const actualizarChequeConArchivo = useCallback(
    async ({ idCheque, idMovimiento, cheque }) => {
      if (!(cheque?.archivo instanceof File)) return null;

      const fd = new FormData();
      const { idUsuario } = getAuthInfo();

      fd.append("id_cheque", String(idCheque));
      fd.append("id_movimiento", String(idMovimiento));
      fd.append("idUsuario", String(idUsuario || 0));
      fd.append("tipo", String(cheque?.tipo || "cheque"));
      fd.append("tipo_cheque", String(cheque?.tipo || "cheque"));

      const fechaEmisionCheque = String(cheque?.fecha_emision || "").slice(0, 10);
      const fechaPagoCheque = String(cheque?.fecha_pago || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEmisionCheque)) {
        throw new Error("El cheque no tiene fecha de emisión válida cargada desde el modal.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPagoCheque)) {
        throw new Error("El cheque no tiene fecha de pago válida cargada desde el modal.");
      }

      fd.append("fecha_emision", fechaEmisionCheque);
      fd.append("emisor", String(cheque?.emisor || "").trim().toUpperCase());
      fd.append("numero_cheque", String(cheque?.numero_cheque || "").trim());
      fd.append("importe", String(safeNumber(cheque?.importe || 0)));
      fd.append("fecha_pago", fechaPagoCheque);
      fd.append("observaciones", String(cheque?.observaciones || "").trim());
      fd.append("archivo", cheque.archivo, cheque.archivo_nombre || cheque.archivo.name || "adjunto");

      const res = await ventasFetch(API_CHEQUES_ACTUALIZAR, {
        method: "POST",
        headers: buildAuthHeaders(false),
        body: fd,
      });
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo adjuntar el archivo del cheque.");
      return data;
    },
    [API_CHEQUES_ACTUALIZAR]
  );

  const subirArchivosChequesCreados = useCallback(
    async (info) => {
      const warnings = [];
      const creados = Array.isArray(info?.cheques_creados) ? info.cheques_creados : [];
      if (!creados.length) return warnings;

      const filasCheque = mediosFilas.filter((mp) => mp?.cheque && mp.cheque.archivo instanceof File);

      for (const mp of filasCheque) {
        const backendCheque = creados.find((x) => String(x?.frontend_row_uid || "") === String(mp.id));
        if (!backendCheque?.id_cheque || !backendCheque?.id_movimiento) {
          warnings.push(`No se pudo vincular el archivo del cheque ${mp?.cheque?.numero_cheque || ""}.`);
          continue;
        }
        try {
          await actualizarChequeConArchivo({
            idCheque: backendCheque.id_cheque,
            idMovimiento: backendCheque.id_movimiento,
            cheque: mp.cheque,
          });
        } catch (e) {
          warnings.push(e?.message || `No se pudo adjuntar el archivo del cheque ${mp?.cheque?.numero_cheque || ""}.`);
        }
      }

      return warnings;
    },
    [mediosFilas, actualizarChequeConArchivo]
  );

  const guardarVentaBatch = useCallback(
    async ({
      clienteFiscalResuelto = null,
      clienteOverride = null,
      accionFinal = "guardar",
      esFacturadaFinal = false,
      facturaArca = null,
    }) => {
      const { idUsuario } = getAuthInfo();
      const periodoApi = fechaToYYYYMM(fecha);
      const mediosPayload = buildMediosPagoPayload(mediosFilas, mediosPagoList);
      const primerMedioId = isContado ? mediosPayload[0]?.id_medio_pago || null : null;
      const clienteFinal = clienteOverride ? normalizeClienteSimple(clienteOverride) : null;
      const idClienteParaGuardar = Number(clienteFinal?.id_cliente || selectedClienteId || 0) || null;
      const nombreClienteParaGuardar = clienteFinal?.nombre || selectedClienteNombre || safeStr(clienteFiscalResuelto?.razon_social) || null;

      const payloads = rowsCalc
        .filter((r) => {
          const stockId = Number(r.id_stock_producto || r.id_detalle);
          return Number.isFinite(stockId) && stockId > 0 && Number(r.total || 0) > 0;
        })
        .map((r) => {
          const stockId = Number(r.id_stock_producto || r.id_detalle);
          const varianteId = Number(r.id_stock_variante || 0);
          return {
          idUsuario,
          fecha,
          periodo: periodoApi,
          id_cliente: idClienteParaGuardar,
          cliente_nombre: nombreClienteParaGuardar,
          id_tipo_venta: Number(filters.id_tipo_venta),
          id_medio_pago: primerMedioId,
          id_cuenta_corriente: null,
          id_detalle: null,
          id_stock_producto: stockId,
          id_stock_variante: Number.isFinite(varianteId) && varianteId > 0 ? varianteId : null,
          cantidad: Math.round(Number(r.cantidad) * 100) / 100,
          precio: Math.round(Number(r.precio) * 100) / 100,
          precio_lista: Math.round(Number(r.precioLista ?? r.precio) * 100) / 100,
          descuento_monto: Math.round(Number(r.descuentoMonto || 0) * 100) / 100,
          descuento_pct: Number(r.bonifPctAplicado || 0),
          iva_pct: Math.round(Number(r.ivaPct) * 100) / 100,
          subtotal: Math.round(Number(r.subtotal) * 100) / 100,
          iva_monto: Math.round(Number(r.ivaMonto) * 100) / 100,
          total: Math.round(Number(r.total) * 100) / 100,
          monto_total: Math.round(Number(r.total) * 100) / 100,
          accion_venta: accionFinal,
          es_facturada: esFacturadaFinal,
          cliente_fiscal: esFacturadaFinal ? clienteFiscalResuelto : null,
        };
        });

      if (!payloads.length) throw new Error("No hay filas válidas para guardar.");

      const operacionFiscalKey = esFacturadaFinal
        ? safeStr(
            facturaArca?.operacion_arca?.key ||
              facturaArca?.operacion_key ||
              resumenFacturaData?.operacion_key ||
              arcaOperationKey
          )
        : "";
      const operacionFiscalContexto = esFacturadaFinal
        ? safeStr(
            facturaArca?.operacion_arca?.contexto ||
              facturaArca?.operacion_contexto ||
              resumenFacturaData?.operacion_contexto ||
              "FACTURA_VENTA"
          )
        : "";

      // Para ventas facturadas este POST es idempotente por operacion_key. El
      // backend vincula CAE + venta en la misma transacción; por eso es seguro
      // reintentar si se pierde la respuesta por un corte de conexión.
      const postVenta = esFacturadaFinal ? apiPostJsonConReintentoSeguro : apiPostJson;
      const data = await postVenta(API_BATCH, {
        idUsuario,
        items: payloads,
        medios_pago: isContado ? mediosPayload : [],
        descuento_tipo: resumen.descuento > 0 ? resumen.descuentoTipo : null,
        descuento_valor: resumen.descuento > 0 ? Number(resumen.descuentoValor || 0) : 0,
        descuento_monto: Number(resumen.descuento || 0),
        total_bruto: Number(resumen.totalBruto || resumen.total || 0),
        operacion_key: operacionFiscalKey || undefined,
        operacion_contexto: operacionFiscalContexto || undefined,
      });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo guardar el batch de ventas.");

      return {
        ...data,
        periodoApi,
        fecha,
        cliente_fiscal: clienteFiscalResuelto,
        cliente_id: idClienteParaGuardar,
        cliente_nombre: nombreClienteParaGuardar,
        accion_venta: accionFinal,
        es_facturada: esFacturadaFinal,
      };
    },
    [
      API_BATCH,
      fecha,
      mediosFilas,
      mediosPagoList,
      rowsCalc,
      selectedClienteId,
      selectedClienteNombre,
      filters,
      isContado,
      resumen,
      resumenFacturaData,
      arcaOperationKey,
    ]
  );

  const subirComprobanteYVincularPrimerMovimiento = useCallback(
    async ({ idMovimiento, blob, filename, facturaMeta }) => {
      if (!idMovimiento || !blob) throw new Error("Faltan datos para subir el comprobante.");

      const fd = new FormData();
      fd.append("tipo", "FACTURA");
      fd.append("id_movimiento", String(idMovimiento));
      fd.append(
        "pdf",
        blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }),
        filename || "factura.pdf"
      );

      const emitidoEnArca = Number(facturaMeta?.emitido_en_arca || 0) === 1;
      const meta = {
        tipo: "FACTURA",
        estado: emitidoEnArca ? "emitida" : "solo_pdf",
        emitido_en_arca: emitidoEnArca ? 1 : 0,
        operacion_key: safeStr(
          facturaMeta?.operacion_arca?.key ||
            facturaMeta?.operacion_key ||
            resumenFacturaData?.operacion_key ||
            arcaOperationKey
        ) || null,
        operacion_contexto: safeStr(
          facturaMeta?.operacion_arca?.contexto ||
            facturaMeta?.operacion_contexto ||
            resumenFacturaData?.operacion_contexto ||
            "FACTURA_VENTA"
        ),
        id_pago: facturaMeta?.id_pago ?? null,
        id_sistema: facturaMeta?.id_sistema ?? null,
        anio: Number(facturaMeta?.anio || 0),
        id_mes: Number(facturaMeta?.id_mes || 0),
        monto_ars: Number(facturaMeta?.imp_total ?? facturaMeta?.importe ?? resumen.total ?? 0),
        doc_tipo: Number(facturaMeta?.doc_tipo ?? resumenFacturaData?.cliente_facturacion?.doc_tipo ?? 80),
        doc_nro: safeStr(
          facturaMeta?.doc_nro ??
            resumenFacturaData?.cliente_facturacion?.doc_nro ??
            resumenFacturaData?.cliente_facturacion?.cuit ??
            ""
        ),
        cbte_tipo: Number(facturaMeta?.cbte_tipo || resumenFacturaData?.cbte_tipo || 11),
        pto_vta: Number(facturaMeta?.pto_vta || resumenFacturaData?.pto_vta || 2),
        cbte_nro: facturaMeta?.cbte_nro ?? null,
        razon_social: resumenFacturaData?.cliente_facturacion?.razon_social || null,
        cond_iva:
          resumenFacturaData?.cliente_facturacion?.cond_iva ||
          resumenFacturaData?.cliente_facturacion?.condicion_iva ||
          null,
        domicilio: resumenFacturaData?.cliente_facturacion?.domicilio || null,
        cae: emitidoEnArca ? facturaMeta?.cae ?? null : null,
        cae_vto: emitidoEnArca ? facturaMeta?.cae_vto ?? null : null,
        fecha_cbte: facturaMeta?.fecha_cbte ?? resumenFacturaData?.fecha_cbte_iso ?? null,
        resultado: facturaMeta?.resultado ?? (emitidoEnArca ? null : "P"),
        qr_url: emitidoEnArca ? facturaMeta?.qr_url ?? null : null,
        qr_base64: emitidoEnArca ? facturaMeta?.qr_base64 ?? null : null,
        qr_payload: emitidoEnArca ? facturaMeta?.qr_payload ?? null : null,
        json_arca: emitidoEnArca
          ? facturaMeta?.json_arca ?? facturaMeta?.raw_min ?? facturaMeta ?? null
          : facturaMeta ?? null,
        resumen_facturacion: {
          ...resumenFacturaData,
          items_facturacion: Array.isArray(resumenFacturaData?.items_facturacion)
            ? resumenFacturaData.items_facturacion
            : [],
        },
      };

      fd.append("meta", JSON.stringify(meta));

      // La subida también es reintentable: el backend reutiliza el mismo
      // comprobante fiscal por CAE si el primer intento llegó a completarse.
      const j = await fetchFormDataConReintentoSeguro(API_VINCULAR_COMPROBANTE, fd, 3);
      if (!j?.exito) throw new Error(j?.mensaje || "No se pudo subir el comprobante.");
      return j;
    },
    [API_VINCULAR_COMPROBANTE, resumen.total, resumenFacturaData, arcaOperationKey]
  );

  const subirVentaNoFacturadaPdfYVincular = useCallback(
    async ({ idMovimiento, blob, filename, ventaMeta }) => {
      if (!idMovimiento || !blob) throw new Error("Faltan datos para subir el comprobante interno.");

      const fd = new FormData();
      fd.append("tipo", "VENTA_NO_FACTURADA");
      fd.append("id_movimiento", String(idMovimiento));

      const idsMovimientoPdf = Array.isArray(ventaMeta?.ids_movimiento)
        ? ventaMeta.ids_movimiento.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
        : [];

      if (idsMovimientoPdf.length > 0) {
        fd.append("ids_movimiento", JSON.stringify(idsMovimientoPdf));
      }

      fd.append(
        "pdf",
        blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }),
        filename || "venta_no_facturada.pdf"
      );

      const meta = {
        tipo: "VENTA_NO_FACTURADA",
        estado: "venta_no_facturada",
        emitido_en_arca: 0,
        id_pago: ventaMeta?.id_pago ?? null,
        id_sistema: ventaMeta?.id_sistema ?? null,
        id_cliente: ventaMeta?.id_cliente ?? null,
        ids_movimiento: Array.isArray(ventaMeta?.ids_movimiento) ? ventaMeta.ids_movimiento : [],
        monto_ars: Number(ventaMeta?.total_ars ?? ventaMeta?.importe ?? resumen.total ?? 0),
        fecha_cbte: ventaMeta?.fecha_cbte_iso ?? fecha ?? null,
        razon_social: ventaMeta?.cliente_facturacion?.razon_social || ventaMeta?.labelCliente || null,
        cond_iva:
          ventaMeta?.cliente_facturacion?.cond_iva || ventaMeta?.cliente_facturacion?.condicion_iva || null,
        domicilio: ventaMeta?.cliente_facturacion?.domicilio || null,
        cliente_facturacion: ventaMeta?.cliente_facturacion || null,
        emisor: ventaMeta?.emisor || null,
        config_facturacion: ventaMeta?.config_facturacion || null,
        resultado: "P",
        json_arca: null,
        resumen_facturacion: {
          ...ventaMeta,
          items_facturacion: Array.isArray(ventaMeta?.items_facturacion) ? ventaMeta.items_facturacion : [],
        },
      };

      fd.append("meta", JSON.stringify(meta));

      const res = await ventasFetch(API_VINCULAR_COMPROBANTE, {
        method: "POST",
        body: fd,
        headers: buildAuthHeaders(false),
      });
      const j = await parseJsonOrThrow(res);
      if (!j?.exito) throw new Error(j?.mensaje || "No se pudo subir el comprobante interno.");
      return j;
    },
    [API_VINCULAR_COMPROBANTE, fecha, resumen.total]
  );

  const subirRemitoPdfYVincular = useCallback(
    async ({ idMovimiento, blob, filename, remitoMeta }) => {
      if (!idMovimiento || !blob) throw new Error("Faltan datos para subir el remito.");

      const fd = new FormData();
      fd.append("tipo", "REMITO");
      fd.append("id_movimiento", String(idMovimiento));

      const idsMovimientoPdf = Array.isArray(remitoMeta?.ids_movimiento)
        ? remitoMeta.ids_movimiento.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
        : [];

      if (idsMovimientoPdf.length > 0) {
        fd.append("ids_movimiento", JSON.stringify(idsMovimientoPdf));
      }

      fd.append(
        "pdf",
        blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }),
        filename || "remito.pdf"
      );

      const meta = {
        tipo: "REMITO",
        estado: "remito",
        emitido_en_arca: 0,
        id_pago: remitoMeta?.id_pago ?? null,
        id_sistema: remitoMeta?.id_sistema ?? null,
        id_cliente: remitoMeta?.id_cliente ?? null,
        ids_movimiento: Array.isArray(remitoMeta?.ids_movimiento) ? remitoMeta.ids_movimiento : [],
        monto_ars: Number(remitoMeta?.total_ars ?? remitoMeta?.importe ?? resumen.total ?? 0),
        fecha_cbte: remitoMeta?.fecha_cbte_iso ?? fecha ?? null,
        razon_social: remitoMeta?.cliente_facturacion?.razon_social || remitoMeta?.labelCliente || null,
        cond_iva:
          remitoMeta?.cliente_facturacion?.cond_iva || remitoMeta?.cliente_facturacion?.condicion_iva || null,
        domicilio: remitoMeta?.cliente_facturacion?.domicilio || null,
        cliente_facturacion: remitoMeta?.cliente_facturacion || null,
        emisor: remitoMeta?.emisor || null,
        config_facturacion: remitoMeta?.config_facturacion || null,
        resultado: "P",
        json_arca: null,
        resumen_facturacion: {
          ...remitoMeta,
          tipo: "REMITO",
          items_facturacion: Array.isArray(remitoMeta?.items_facturacion) ? remitoMeta.items_facturacion : [],
        },
      };

      fd.append("meta", JSON.stringify(meta));

      const res = await ventasFetch(API_VINCULAR_COMPROBANTE, {
        method: "POST",
        body: fd,
        headers: buildAuthHeaders(false),
      });
      const j = await parseJsonOrThrow(res);
      if (!j?.exito) throw new Error(j?.mensaje || "No se pudo subir el remito.");
      return j;
    },
    [API_VINCULAR_COMPROBANTE, fecha, resumen.total]
  );

  const resolveClienteFiscalForPdf = useCallback(async () => {
    const id = Number(selectedClienteId || 0);
    if (clienteFiscalDb && (!id || Number(clienteFiscalDb.id_cliente || 0) === id)) {
      return clienteFiscalDb;
    }
    if (fiscalArcaData && (fiscalArcaData.cuit || fiscalArcaData.razon_social)) {
      return normalizeClienteFiscalDb(fiscalArcaData);
    }
    if (!id) return null;

    try {
      const data = await apiGetJson(`${API_GET_CLIENTE_FISCAL}&id_cliente=${id}`);
      if (data?.existe && data?.cliente_fiscal) {
        return normalizeClienteFiscalDb(data.cliente_fiscal);
      }
    } catch {
      // Si no hay datos fiscales o falla la consulta puntual, el PDF se completa con nombre y guiones.
    }

    return null;
  }, [API_GET_CLIENTE_FISCAL, selectedClienteId, clienteFiscalDb, fiscalArcaData]);

  const vincularComprobanteAMovimientosLote = useCallback(
    async (idsMovimiento, idComprobante) => {
      if (!idComprobante || !Array.isArray(idsMovimiento) || !idsMovimiento.length) return;

      const data = await apiPostJson(API_VINCULAR_COMPROBANTE_LOTE, {
        id_comprobante: Number(idComprobante),
        ids_movimiento: idsMovimiento.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0),
        force: false,
      });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo vincular el comprobante al lote.");
      return data;
    },
    [API_VINCULAR_COMPROBANTE_LOTE]
  );

  const generarYVincularVentaNoFacturadaPdf = useCallback(
    async (info) => {
      const idsOk = (
        Array.isArray(info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? [])
          ? info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? []
          : info?.id_movimiento
          ? [info.id_movimiento]
          : []
      )
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0);

      if (!idsOk.length) {
        throw new Error("La venta se guardó, pero el backend no devolvió movimientos para vincular el comprobante interno.");
      }

      let cfg = configFacturacion;
      if (!cfg) {
        try {
          cfg = await fetchConfigFacturacion();
        } catch {
          cfg = null;
        }
      }

      const clienteFiscalPdf = await resolveClienteFiscalForPdf();

      const ventaMeta = {
        ...buildVentaNoFacturadaPayload(cfg || {}, clienteFiscalPdf),
        ids_movimiento: idsOk,
      };

      const { blob, filename } = await saveVentaNoFacturadaPdf({
        data: ventaMeta,
        download: false,
      });

      const subida = await subirVentaNoFacturadaPdfYVincular({
        idMovimiento: idsOk[0],
        blob,
        filename,
        ventaMeta,
      });

      const idComprobante =
        Number(subida?.id_comprobante ?? subida?.comprobante?.id_comprobante ?? 0) || null;
      if (!idComprobante) {
        throw new Error("El backend no devolvió un id_comprobante válido para el comprobante interno.");
      }

      const idsVinculadosBackend = Array.isArray(subida?.ids_movimiento_vinculados)
        ? subida.ids_movimiento_vinculados.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
        : [];
      const setVinculadosBackend = new Set(idsVinculadosBackend);
      const idsPendientes = idsOk.filter((id) => !setVinculadosBackend.has(id));

      // Compatibilidad: si el backend viejo no devuelve ids_movimiento_vinculados,
      // se vincula el resto con el endpoint anterior. Con el backend nuevo no hace
      // esta segunda llamada, por eso guardar queda más rápido.
      if (idsPendientes.length > 0) {
        const pendientesSinPrincipal = idsPendientes.filter((id) => id !== idsOk[0]);
        if (pendientesSinPrincipal.length > 0) {
          await vincularComprobanteAMovimientosLote(pendientesSinPrincipal, idComprobante);
        }
      }

      return {
        id_comprobante: idComprobante,
        pdf_filename: filename,
        ids_movimiento: idsOk,
      };
    },
    [
      configFacturacion,
      fetchConfigFacturacion,
      buildVentaNoFacturadaPayload,
      resolveClienteFiscalForPdf,
      subirVentaNoFacturadaPdfYVincular,
      vincularComprobanteAMovimientosLote,
    ]
  );

  const generarYVincularRemitoPdf = useCallback(
    async (info, baseData = null) => {
      const idsOk = (
        Array.isArray(info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? [])
          ? info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? []
          : info?.id_movimiento
          ? [info.id_movimiento]
          : []
      )
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0);

      if (!idsOk.length) {
        throw new Error("La venta se guardó, pero el backend no devolvió movimientos para vincular el remito.");
      }

      let cfg = configFacturacion;
      if (!cfg) {
        try {
          cfg = await fetchConfigFacturacion();
        } catch {
          cfg = null;
        }
      }

      const clienteFiscalPdf = await resolveClienteFiscalForPdf();
      const sourceData = baseData && typeof baseData === "object"
        ? {
            ...baseData,
            config_facturacion: baseData.config_facturacion || cfg || {},
            ...normalizeConfigFacturacionPdf(baseData.config_facturacion || cfg || {}),
            cliente_facturacion: buildClienteFiscalPdf(
              baseData.cliente_facturacion || clienteFiscalPdf,
              clienteResolvedFromInput,
              baseData.labelCliente || selectedClienteNombre || cliInput
            ),
          }
        : buildVentaNoFacturadaPayload(cfg || {}, clienteFiscalPdf);
      const remitoMeta = {
        ...sourceData,
        tipo: "REMITO",
        estado: "remito",
        ids_movimiento: idsOk,
        observaciones_remito:
          "Remito generado automáticamente desde la venta. Lista de productos sin precios ni importes.",
      };

      const { blob, filename } = await saveRemitoPdf({
        data: remitoMeta,
        download: false,
      });

      const subida = await subirRemitoPdfYVincular({
        idMovimiento: idsOk[0],
        blob,
        filename,
        remitoMeta,
      });

      const idComprobante =
        Number(subida?.id_comprobante ?? subida?.comprobante?.id_comprobante ?? 0) || null;
      if (!idComprobante) {
        throw new Error("El backend no devolvió un id_comprobante válido para el remito.");
      }

      return {
        id_comprobante: idComprobante,
        pdf_filename: filename,
        ids_movimiento: idsOk,
      };
    },
    [
      configFacturacion,
      fetchConfigFacturacion,
      buildVentaNoFacturadaPayload,
      resolveClienteFiscalForPdf,
      clienteResolvedFromInput,
      selectedClienteNombre,
      cliInput,
      subirRemitoPdfYVincular,
    ]
  );

  const abrirResumenFactura = useCallback(
    async (clienteFiscalOverride = null, clienteOverride = null) => {
      const v = validate({ skipCliente: !!clienteOverride });
      if (!v.ok) {
        showToast("advertencia", v.msg || "Faltan datos.", 4200);
        return;
      }
      if (v.warn) showToast("advertencia", "Hay filas incompletas: se mostrarán solo las válidas.", 3200);

      setSaving(true);
      try {
        const cf = clienteFiscalOverride
          ? normalizeClienteFiscalDb(clienteFiscalOverride)
          : await resolveFiscalForFacturacion();
        const cfg = configFacturacion || (await fetchConfigFacturacion());
        const cuentasDisponibles = Array.isArray(cfg?._configs_facturacion) && cfg._configs_facturacion.length
          ? cfg._configs_facturacion
          : (configsFacturacion.length ? configsFacturacion : [cfg]);
        setResumenFacturaData({
          ...buildResumenFacturaPayload(cf, cfg, clienteOverride),
          configs_facturacion: cuentasDisponibles,
        });
        setConfigsFacturacion(cuentasDisponibles);
        setOpenResumenFactura(true);
      } catch (e) {
        showToast("error", e?.message || "No se pudo preparar la factura.", 4500);
      } finally {
        setSaving(false);
      }
    },
    [validate, showToast, resolveFiscalForFacturacion, configFacturacion, configsFacturacion, fetchConfigFacturacion, buildResumenFacturaPayload]
  );

  const finalizarFacturacionYGuardarVenta = useCallback(
    async (factEmitida) => {
      try {
        setSaving(true);

        const cf = normalizeClienteFiscalDb(
          resumenFacturaData?.cliente_facturacion || clienteFiscalDb || fiscalArcaData || {}
        );

        const clienteParaVenta = normalizeClienteSimple({
          id_cliente: resumenFacturaData?.id_cliente,
          nombre: resumenFacturaData?.labelCliente,
        });

        const info = await guardarVentaBatch({
          clienteFiscalResuelto: cf,
          clienteOverride: clienteParaVenta,
          accionFinal: "facturar",
          esFacturadaFinal: true,
          facturaArca: factEmitida,
        });

        const idsOk = (
          Array.isArray(info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? [])
            ? info?.ids ?? info?.ids_movimiento ?? info?.ids_movimientos ?? []
            : info?.id_movimiento
            ? [info.id_movimiento]
            : []
        )
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0);

        if (!idsOk.length) {
          throw new Error("La venta se emitió pero no se devolvieron movimientos para vincular la factura.");
        }
        if (!factEmitida?.pdf_blob) {
          throw new Error("La venta se emitió pero no se recibió el PDF para guardarlo.");
        }

        const subida = await subirComprobanteYVincularPrimerMovimiento({
          idMovimiento: idsOk[0],
          blob: factEmitida.pdf_blob,
          filename: factEmitida.pdf_filename || "factura.pdf",
          facturaMeta: factEmitida,
        });

        const idComprobante =
          Number(subida?.id_comprobante ?? subida?.comprobante?.id_comprobante ?? 0) || null;
        if (!idComprobante) {
          throw new Error("El backend no devolvió un id_comprobante válido al subir la factura.");
        }

        const restoIds = idsOk.slice(1);
        if (restoIds.length > 0) {
          await vincularComprobanteAMovimientosLote(restoIds, idComprobante);
        }

        let remito = null;
        const remitoWarnings = [];
        try {
          remito = await generarYVincularRemitoPdf(info, resumenFacturaData);
        } catch (remitoError) {
          remitoWarnings.push(remitoError?.message || "La venta se guardó, pero no se pudo generar el remito.");
        }

        const chequeWarnings = await subirArchivosChequesCreados(info);
        const warnings = [...remitoWarnings, ...chequeWarnings];

        const completedOperationKey = safeStr(
          factEmitida?.operacion_arca?.key ||
            factEmitida?.operacion_key ||
            resumenFacturaData?.operacion_key ||
            arcaOperationKey
        );
        clearNuevaVentaArcaKey(completedOperationKey);
        setArcaOperationKey("");

        showToast("exito", "Venta agregada correctamente.", 3000);
        if (warnings.length) showToast("advertencia", warnings.join(" "), 6200);

        onSaved?.({
          ...info,
          factura_emitida: factEmitida || null,
          remito,
          id_comprobante: idComprobante,
        });
      } catch (e) {
        showToast(
          "error",
          e?.message || "La factura se emitió pero no se pudo completar el guardado. Podés reintentar: no se volverá a emitir en ARCA.",
          6200
        );
        // Es fundamental propagar el error. El modal fiscal debe quedar abierto y
        // NO cerrar como si todo hubiera terminado. Al reintentar usa la misma
        // operacion_key y recupera el CAE ya autorizado.
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [
      showToast,
      guardarVentaBatch,
      resumenFacturaData,
      clienteFiscalDb,
      fiscalArcaData,
      onSaved,
      subirComprobanteYVincularPrimerMovimiento,
      vincularComprobanteAMovimientosLote,
      generarYVincularRemitoPdf,
      subirArchivosChequesCreados,
      arcaOperationKey,
    ]
  );

  const submit = useCallback(async () => {
    if (saving) return;

    // El boton Guardar venta siempre debe ejecutar el flujo sin facturacion.
    // Si antes se abrio y cerro el modal fiscal, no reutilizamos la accion "facturar".
    setAccionContado("guardar");

    const { sessionKey } = getAuthInfo();
    if (!sessionKey) {
      showToast("error", "No hay sesión activa (Falta X-Session).", 5200);
      return;
    }

    if (addUI.open) {
      showToast("advertencia", "Terminá de crear (o cancelá) antes de guardar.", 3200);
      return;
    }

    const v = validate();
    if (!v.ok) {
      showToast("advertencia", v.msg || "Faltan datos.", 4200);
      return;
    }

    setSaving(true);
    showToast("exito", "Guardando venta y generando PDF...", 5200);
    if (v.warn) showToast("advertencia", "Hay filas incompletas: se guardarán solo las válidas.", 3600);

    try {
      const info = await guardarVentaBatch({
        clienteFiscalResuelto: null,
        accionFinal: "guardar",
        esFacturadaFinal: false,
      });

      let comprobanteInterno = null;
      let remito = null;
      const pdfWarnings = [];
      try {
        comprobanteInterno = await generarYVincularVentaNoFacturadaPdf(info);
      } catch (pdfError) {
        pdfWarnings.push(
          pdfError?.message || "La venta se guardó, pero no se pudo generar el comprobante interno."
        );
      }

      try {
        remito = await generarYVincularRemitoPdf(info);
      } catch (remitoError) {
        pdfWarnings.push(remitoError?.message || "La venta se guardó, pero no se pudo generar el remito.");
      }

      const chequeWarnings = await subirArchivosChequesCreados(info);
      const warnings = [...pdfWarnings, ...chequeWarnings];

      showToast("exito", "Venta agregada correctamente.", 3000);
      if (warnings.length) showToast("advertencia", warnings.join(" "), 6200);
      onSaved?.({
        ...info,
        comprobante_interno: comprobanteInterno,
        remito,
        id_comprobante: comprobanteInterno?.id_comprobante ?? info?.id_comprobante ?? null,
      });
    } catch (e) {
      showToast("error", e?.message || "Error guardando.", 4500);
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    addUI.open,
    validate,
    showToast,
    guardarVentaBatch,
    generarYVincularVentaNoFacturadaPdf,
    generarYVincularRemitoPdf,
    subirArchivosChequesCreados,
    onSaved,
  ]);

  const consultarArcaPanelFiscal = useCallback(async () => {
    const cuit = onlyDigits(fiscalCuitInput);
    if (cuit.length !== 11) {
      setFiscalError("Ingresá un CUIT válido de 11 dígitos.");
      return null;
    }
    try {
      return await buscarFiscalEnArcaPorCuit(cuit);
    } catch {
      return null;
    }
  }, [fiscalCuitInput, buscarFiscalEnArcaPorCuit]);

  const confirmarFiscalPanelYFacturar = useCallback(async () => {
    const cuit = onlyDigits(fiscalCuitInput);
    if (cuit.length !== 11) {
      setFiscalError("Ingresá un CUIT válido de 11 dígitos.");
      return;
    }

    const v = validate({ skipCliente: true });
    if (!v.ok) {
      showToast("advertencia", v.msg || "Faltan datos.", 4200);
      return;
    }

    setSaving(true);
    try {
      let fiscal = fiscalArcaData;
      if (!fiscal || onlyDigits(fiscal.cuit) !== cuit) {
        fiscal = await buscarFiscalEnArcaPorCuit(cuit);
      }

      const result = await guardarClienteFiscalDesdeArca(fiscal, {
        id_cliente: selectedClienteId || null,
        actualizar_nombre_cliente: true,
      });

      setFiscalPanelOpen(false);
      if (result?.ya_existia) {
        showToast("exito", "El CUIT ya estaba cargado. Se usaron los datos fiscales existentes.", 3200);
      } else {
        showToast("exito", "Datos fiscales obtenidos y guardados correctamente.", 2600);
      }
      await abrirResumenFactura(result.cliente_fiscal, result.cliente);
    } catch (e) {
      setFiscalError(e?.message || "No se pudo resolver el cliente fiscal.");
      showToast("error", e?.message || "No se pudo resolver el cliente fiscal.", 5200);
    } finally {
      setSaving(false);
    }
  }, [
    fiscalCuitInput,
    fiscalArcaData,
    validate,
    showToast,
    buscarFiscalEnArcaPorCuit,
    guardarClienteFiscalDesdeArca,
    selectedClienteId,
    abrirResumenFactura,
  ]);

  const onClickFacturar = useCallback(async () => {
    if (isBaltoDemoMode()) {
      showToast("advertencia", DEMO_BLOCK_MESSAGE, 5200);
      return;
    }

    setAccionContado("facturar");
    setFiscalError("");

    const v = validate({ skipCliente: !selectedClienteId });
    if (!v.ok) {
      showToast("advertencia", v.msg || "Faltan datos.", 4200);
      return;
    }

    if (!selectedClienteId) {
      setFiscalPanelOpen(true);
      return;
    }

    try {
      setSaving(true);
      const fiscal = clienteFiscalDb || (await fetchClienteFiscal(selectedClienteId));
      if (fiscal?.cuit) {
        await abrirResumenFactura();
        return;
      }

      setFiscalPanelOpen(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo iniciar la facturación.", 4200);
    } finally {
      setSaving(false);
    }
  }, [selectedClienteId, clienteFiscalDb, fetchClienteFiscal, abrirResumenFactura, showToast, validate]);

  const shouldNeedFiscalPanel = false;

  if (!open) return null;

  return createPortal(
    <>
      <div className="gm-modal-overlay">
        <div
          className="gm-modal-container gm-modal-container--movement gm-modal-v2 nv-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faFileInvoiceDollar} />
            </div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">Nueva Venta</h2>
            </div>
            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={() => (!saving ? onClose?.() : null)}
              aria-label="Cerrar"
              disabled={saving}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="gm-modal-content">
            <div className="gm-movement-layout">
              <section className="gm-table gm-table--movement gm-movement-main nv-table">
                <div className={`gm-table-head ${hasScroll ? "gm-table-head--body-scroll" : ""}`}>
                  <div className="gm-table-th" style={{ paddingLeft: 10 }}>Detalle</div>
                  <div className="gm-table-th">Cant.</div>
                  <div className="gm-table-th right">Precio</div>
                  <div className="gm-table-th">IVA %</div>
                  <div className="gm-table-th right">IVA $</div>
                  <div className="gm-table-th right">Total</div>
                  <div className="gm-table-th" />
                </div>

                <div ref={rowsContainerRef} className={`gm-table-body ${hasScroll ? "has-scroll gm-table-body--scroll" : ""}`}>
                  {rowsCalc.map((r) => {
                    const stockNum =
                      r.stock_disponible !== null && r.stock_disponible !== undefined
                        ? Number(r.stock_disponible)
                        : null;
                    const rowSinStock = r.sinStock || isSinStock(stockNum);

                    return (
                      <div key={r.id} className={`gm-table-row ${rowSinStock ? "nv-row--sin-stock" : ""}`}>
                        <div className="gm-table-cell gm-table-cell--detail">
                          <ProductStockAutocomplete
                            value={r.detalleText}
                            onChange={(val) =>
                              updateRow(r.id, {
                                detalleText: val,
                                id_detalle: NULL_OPTION,
                                id_stock_producto: NULL_OPTION,
                                id_stock_variante: NULL_OPTION,
                                precio: 0,
                                id_tipo_precio_stock: NULL_OPTION,
                                precio_tipo_label: "",
                                precios_disponibles: [],
                                stock_disponible: null,
                                sinStock: false,
                              })
                            }
                            onSelect={(d) => handleSelectDetalle(d, r.id)}
                            options={detallesList}
                            placeholder="Escribí o buscá un producto…"
                            disabled={saving || addUI.open}
                            showAllOnFocus={false}
                            maxItems={18}
                            inputClassName="gm-cell-input"
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--center stock_cant">
                          <input
                            className="gm-cell-input gm-cell-input--center"
                            type="number"
                            min={rowSinStock ? undefined : "1"}
                            step="1"
                            value={rowSinStock ? "" : r.cantidad}
                            onChange={(e) =>
                              handleCantidadChange(r.id, e.target.value === "" ? "" : Number(e.target.value))
                            }
                            disabled={saving || rowSinStock}
                            placeholder={rowSinStock ? "0" : ""}
                            title={rowSinStock ? "No podés ingresar cantidad porque el stock es 0" : ""}
                            style={{
                              width: "100%",
                              background: rowSinStock ? "#f3f4f6" : undefined,
                              color: rowSinStock ? "#b91c1c" : undefined,
                              borderColor: rowSinStock ? "#fca5a5" : undefined,
                              cursor: rowSinStock ? "not-allowed" : undefined,
                              opacity: rowSinStock ? 0.9 : 1,
                            }}
                          />
                          {r.stock_disponible !== null && r.stock_disponible !== undefined && (
                            <div className={`gm-stock-hint ${rowSinStock ? "gm-stock-hint--danger" : ""}`}>
                              {rowSinStock ? "Sin stock" : `Stock: ${r.stock_disponible}`}
                            </div>
                          )}
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          {Array.isArray(r.precios_disponibles) && r.precios_disponibles.length > 0 ? (
                            <PrecioDropdown
                              precios={r.precios_disponibles}
                              value={String(r.id_tipo_precio_stock || r.precios_disponibles?.[0]?.value || NULL_OPTION)}
                              onChange={(val) => handlePrecioTipoChange(r.id, val)}
                              disabled={saving || !r.id_detalle}
                            />
                          ) : (
                            <input
                              className="gm-cell-input gm-cell-input--right"
                              type="text"
                              value={moneyARS(r.precio)}
                              readOnly
                              tabIndex={-1}
                              style={{
                                width: "100%",
                                padding: 0,
                                pointerEvents: "none",
                                background: "transparent",
                                cursor: "default",
                              }}
                            />
                          )}
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          <select
                            className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                            value={String(r.ivaPct)}
                            onChange={(e) => updateRow(r.id, { ivaPct: Number(e.target.value) })}
                            disabled={saving}
                            style={{ width: "100%" }}
                          >
                            {IVA_OPTIONS.map((x) => (
                              <option key={x.value} value={x.value}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                          {moneyARS(r.ivaMonto)}
                        </div>
                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                          {moneyARS(r.total)}
                        </div>
                        <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                          <button
                            type="button"
                            className="gm-row-delete"
                            onClick={() => removeRow(r.id)}
                            disabled={saving}
                            title="Eliminar fila"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="gm-table-foot">
                  <div className="gm-foot-actions">
                    <button type="button" className="gm-foot-btn" onClick={addRow} disabled={saving}>
                      <span className="gm-foot-btn__icon">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 1.5V8.5M1.5 5H8.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                      Agregar fila
                    </button>
                    <div className="gm-foot-sep" />
                  </div>
                  <div className="gm-summary-chips">
                    <div className="gm-summary-chip gm-summary-chip--sub">
                      <span>Subtotal</span>
                      <b>{moneyARS(resumen.subtotal)}</b>
                    </div>
                    <div className="gm-summary-chip gm-summary-chip--iva">
                      <span>IVA</span>
                      <b>{moneyARS(resumen.iva)}</b>
                    </div>
                    {resumen.descuento > 0 && (
                      <div className="gm-summary-chip nv-summary-chip--discount">
                        <span>Descuento</span>
                        <b>- {moneyARS(resumen.descuento)}</b>
                      </div>
                    )}
                    <div className="gm-summary-chip gm-summary-chip--total">
                      <span>Total</span>
                      <b>{moneyARS(resumen.total)}</b>
                    </div>
                  </div>
                </div>
              </section>

              <div className="gm-movement-side">
                <aside className="gm-aside">
                  <div className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Datos de venta</span>
                    </div>

                    <div className="gm-section-body">
                      <div
                        className="gm-field"
                        onClick={() => {
                          if (!saving && !usuarioBasicoVentas) fechaInputRef.current?.showPicker?.();
                        }}
                      >
                        <input
                          ref={fechaInputRef}
                          id="nv-fecha-input"
                          className="gm-input"
                          type="date"
                          placeholder=" "
                          value={fecha}
                          min={usuarioBasicoVentas ? todayISO() : undefined}
                          max={todayISO()}
                          onChange={(e) => {
                            const hoy = todayISO();
                            if (usuarioBasicoVentas) {
                              setFecha(hoy);
                              showToast?.("advertencia", "Tu usuario solo puede cargar ventas con fecha de hoy.", 3000);
                              return;
                            }

                            const nuevaFecha = e.target.value;
                            if (nuevaFecha > hoy) {
                              setFecha(hoy);
                              showToast?.("advertencia", "No podés seleccionar una fecha posterior al día actual.", 3000);
                              return;
                            }
                            setFecha(nuevaFecha);
                          }}
                          disabled={saving || usuarioBasicoVentas}
                          title={usuarioBasicoVentas ? "Usuario básico: las ventas se cargan solamente con fecha de hoy." : undefined}
                        />
                        <label className="gm-label">Fecha</label>
                      </div>

                      <div className="nc-prov-wrap">
                        <GlobalAutocomplete
                          value={cliInput}
                          onChange={handleClienteInputChange}
                          onSelect={handleSelectCliente}
                          options={clientesOptions}
                          getOptionLabel={(c) => isAddClienteOption(c) ? "➕ Agregar cliente" : String(c?.nombre ?? "").trim()}
                          getOptionValue={(c) => isAddClienteOption(c) ? "__add_cliente__" : String(getClienteId(c) ?? c?.nombre ?? "")}
                          label="Cliente *"
                          placeholder=" "
                          disabled={saving || addUI.open}
                          showAllOnFocus={true}
                          maxItems={25}
                          inputClassName="gm-input"
                        />
                      </div>

                      <div className="gm-field">
                        <select
                          className="gm-input gm-select"
                          value={filters.id_tipo_venta}
                          onChange={(e) => updateFilter("id_tipo_venta", e.target.value)}
                          disabled={saving}
                        >
                          <option value="">Seleccionar.</option>
                          {tiposVentaList.map((x) => {
                            const id = String(x.id ?? x.id_tipo_venta);
                            return (
                              <option key={id} value={id}>
                                {x.nombre}
                              </option>
                            );
                          })}
                        </select>
                        <label className={`gm-label${filters.id_tipo_venta ? " gm-label--up" : ""}`}>
                          Forma de venta *
                        </label>
                      </div>

                      <div className="nv-discount-box">
                        <div className="nv-discount-box__head">
                          <div>
                            <strong>Descuento manual</strong>
                            <span>No modifica el precio del producto ni Tienda Nube.</span>
                          </div>
                        </div>
                        <div className="nv-discount-box__controls">
                          <select
                            className="gm-input gm-select nv-discount-box__type"
                            value={descuentoTipo}
                            onChange={(e) => {
                              setDescuentoTipo(e.target.value === "MONTO" ? "MONTO" : "PORCENTAJE");
                              setDescuentoValor("");
                            }}
                            disabled={saving}
                            aria-label="Tipo de descuento"
                          >
                            <option value="PORCENTAJE">Porcentaje (%)</option>
                            <option value="MONTO">Importe ($)</option>
                          </select>
                          <div className="nv-discount-box__input-wrap">
                            <span>{descuentoTipo === "PORCENTAJE" ? "%" : "$"}</span>
                            <input
                              className="gm-input nv-discount-box__input"
                              type="number"
                              min="0"
                              max={descuentoTipo === "PORCENTAJE" ? "99.99" : undefined}
                              step="0.01"
                              value={descuentoValor}
                              onChange={(e) => setDescuentoValor(e.target.value)}
                              placeholder="0"
                              disabled={saving}
                              aria-label="Valor del descuento"
                            />
                          </div>
                        </div>
                        <div className="nv-discount-box__summary">
                          <span>Total sin descuento: <b>{moneyARS(resumen.totalBruto)}</b></span>
                          {resumen.descuento > 0 ? (
                            <span className="is-applied">Se descuentan <b>{moneyARS(resumen.descuento)}</b></span>
                          ) : (
                            <span>Sin descuento aplicado</span>
                          )}
                        </div>
                      </div>

                      {isContado && (
                        <PanelMediosPagoInlineVenta
                          mediosFilas={mediosFilas}
                          mediosPagoList={mediosPagoList}
                          totalCompra={resumen.total}
                          onUpdate={updateMedioPago}
                          onRemove={removeMedioPago}
                          onAdd={addMedioPago}
                          showToast={showToast}
                          saving={saving}
                        />
                      )}

                      {isCuentaCorriente && (
                        <div className="nc-cc-info">
                          Quedará registrada como <b>pendiente de cobro</b> en la cuenta corriente del cliente.
                        </div>
                      )}

                      {shouldNeedFiscalPanel && (
                        <>
                          <div className="gm-section-divider" />
                          {fiscalLoading ? (
                            <div className="gm-payment-checks-loading">Consultando datos fiscales…</div>
                          ) : (
                            <>
                              <div className="gm-field">
                                <input
                                  className="gm-input"
                                  placeholder=" "
                                  value={fiscalCuitInput}
                                  onChange={(e) => {
                                    setFiscalCuitInput(onlyDigits(e.target.value));
                                    setFiscalArcaData(null);
                                    setFiscalError("");
                                  }}
                                  inputMode="numeric"
                                  disabled={saving || fiscalLookupLoading}
                                  maxLength={11}
                                />
                                <label className="gm-label">CUIT *</label>
                              </div>

                              {fiscalArcaData && (
                                <div className="arca-alert arca-alert--info">
                                  <div className="arca-alert__title">Datos encontrados</div>
                                  <div className="arca-resumen">
                                    <div className="arca-row">
                                      <b>CUIT:</b>
                                      <span>{fiscalArcaData.cuit || "—"}</span>
                                    </div>
                                    <div className="arca-row">
                                      <b>IVA:</b>
                                      <span>{fiscalArcaData.condicion_iva || "—"}</span>
                                    </div>
                                    <div className="arca-row arca-row--full">
                                      <b>Razón social:</b>
                                      <span>{fiscalArcaData.razon_social || "—"}</span>
                                    </div>
                                    <div className="arca-row arca-row--full">
                                      <b>Domicilio:</b>
                                      <span>{fiscalArcaData.domicilio || "—"}</span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {fiscalError && <div className="arca-alert arca-alert--error">{fiscalError}</div>}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </aside>

                <div className="gm-actions gm-actions--sticky nv-actions">
                  <button
                    type="button"
                    onClick={submit}
                    disabled={saving}
                    className="gm-action-btn gm-action-btn--save"
                  >
                    {saving && accionContado === "guardar" ? "Guardando..." : "Guardar venta"}
                  </button>
                  <button
                    type="button"
                    onClick={onClickFacturar}
                    disabled={saving}
                    className="gm-action-btn gm-action-btn--invoice"
                  >
                    {saving && accionContado === "facturar" ? "Procesando..." : "Facturar"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {openResumenFactura && resumenFacturaData && (
        <ModalFacturaBaltoResumen
          open={openResumenFactura}
          onClose={() => setOpenResumenFactura(false)}
          onBack={() => setOpenResumenFactura(false)}
          onCloseAll={cerrarFlujoFacturacion}
          apiBase={`${BASE_URL}/api.php`}
          action="movimientos"
          data={resumenFacturaData}
          docTipo={Number(resumenFacturaData?.cliente_facturacion?.doc_tipo || 80)}
          docNro={safeStr(
            resumenFacturaData?.cliente_facturacion?.doc_nro || resumenFacturaData?.cliente_facturacion?.cuit
          )}
          cbteTipo={Number(resumenFacturaData?.cbte_tipo || 11)}
          ptoVta={String(resumenFacturaData?.pto_vta || 2)}
          onFacturada={async (fact) => await finalizarFacturacionYGuardarVenta(fact)}
          onDone={async (fact) => await finalizarFacturacionYGuardarVenta(fact)}
          configsFacturacionInicial={resumenFacturaData?.configs_facturacion || configsFacturacion}
          forceTestAmount={false}
          testAmount={null}
          skipMovimientoAutocreacion={true}
        />
      )}

      <ModalClienteFiscalArca
        open={fiscalPanelOpen}
        dark={dark}
        title="Datos fiscales para facturar"
        infoTitle="Factura por CUIT"
        description={
          selectedClienteNombre ? (
            <>
              Cliente seleccionado: <b>{selectedClienteNombre}</b>. Al confirmar, se actualizará con la razón social obtenida.
            </>
          ) : (
            <>
              No hace falta cargar todos los datos a mano: ingresá el CUIT, consultamos ARCA y creamos el cliente automáticamente.
            </>
          )
        }
        cuit={fiscalCuitInput}
        fiscalData={fiscalArcaData}
        error={fiscalError}
        loading={fiscalLookupLoading}
        saving={saving}
        confirmText="Confirmar y facturar"
        requireFiscalData={false}
        onCuitChange={(v) => {
          setFiscalCuitInput(v);
          setFiscalArcaData(null);
          setFiscalError("");
        }}
        onLookup={consultarArcaPanelFiscal}
        onClose={() => {
          if (!saving && !fiscalLookupLoading) {
            setFiscalPanelOpen(false);
            setAccionContado("guardar");
            setFiscalError("");
          }
        }}
        onConfirm={confirmarFiscalPanelYFacturar}
      />

      <ModalClienteFiscalArca
        open={addUI.open && addUI.kind === "clientes"}
        dark={dark}
        title="Agregar cliente por CUIT"
        infoTitle="Alta rápida por CUIT"
        description={
          <>
            Ingresá el CUIT, consultamos ARCA, guardamos la razón social en <b>Clientes</b> y los datos completos en <b>Clientes fiscales</b>.
          </>
        }
        cuit={addUI.cuit}
        fiscalData={addUI.fiscalData}
        error={addUI.fiscalError}
        loading={addUI.lookupLoading}
        saving={addUI.saving}
        confirmText="Confirmar y cargar cliente"
        footerHelp="Primero buscá el CUIT. Cuando aparezcan los datos, confirmá para guardar la razón social en clientes y los datos completos en clientes fiscales."
        requireFiscalData={true}
        onCuitChange={(v) => setAddUI((p) => ({ ...p, cuit: v, fiscalData: null, fiscalError: "" }))}
        onLookup={consultarArcaAddCliente}
        onClose={closeAddMini}
        onConfirm={guardarNuevoCatalogo}
      />
    </>,
    document.body
  );
}
