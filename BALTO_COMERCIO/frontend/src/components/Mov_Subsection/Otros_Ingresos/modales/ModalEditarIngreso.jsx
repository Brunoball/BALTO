import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPenToSquare,
  faFileLines,
  faEye,
  faTrashCan,
  faPlus,
  faUpload,
  faMoneyCheckDollar,
} from "@fortawesome/free-solid-svg-icons";
import BASE_URL from "../../../../config/config.jsx";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalIngreso.css";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import ProductStockAutocomplete from "../../_shared/ProductStockAutocomplete.jsx";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import ModalNuevaDescripcion from "./ModalNuevaDescripcion.jsx";
import { otrosIngresosFetch } from "../api/otrosIngresosApi.js";

// ─── Constantes ────────────────────────────────────────────────────────────────
const NULL_OPTION = "";
const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

// ─── Helpers generales ─────────────────────────────────────────────────────────
function safeNumber(v) {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function safeText(v) {
  return String(v ?? "").trim();
}

function isAllowedComprobanteFile(file) {
  if (!file) return false;

  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  const isImageMime = mime.startsWith("image/");
  const isPdfMime = mime === "application/pdf";
  const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif|avif|tif|tiff)$/i.test(name);
  const isPdfExt = /\.pdf$/i.test(name);

  return isImageMime || isPdfMime || isImageExt || isPdfExt;
}
function uid() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
function formatMoneyInputARS(v) {
  return moneyARS(v);
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
  return n === 0 ? "" : String(n).replace(".", ",");
}
function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m)
    return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return s;
}
function calcItemTotals(cantidad, precio, ivaPct) {
  const c = Math.max(0, safeNumber(cantidad));
  const p = Math.max(0, safeNumber(precio));
  const iva = Math.max(0, safeNumber(ivaPct));
  const subtotal = c * p;
  const iva_monto = subtotal * (iva / 100);
  const total = subtotal + iva_monto;
  return { subtotal: round2(subtotal), iva_monto: round2(iva_monto), total: round2(total) };
}
function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    Boolean(document.body?.classList?.contains("dark"))
  );
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Helpers de listas ─────────────────────────────────────────────────────────
function getDetalleId(d) {
  const cand =
    d?.id ?? d?.id_detalle ?? d?.idDetalle ?? d?.detalle_id ?? d?.iddetalle ??
    d?.id_categoria_ingreso ?? d?.idCategoriaIngreso ?? d?.categoria_ingreso_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockProductoId(d) {
  const cand = d?.id_stock_producto ?? d?.idStockProducto ?? d?.stock_producto_id ??
    d?.id_producto ?? d?.idProducto ?? d?.producto_id ?? d?.idProductoStock ??
    d?.producto_stock_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockVarianteId(d) {
  const cand = d?.id_stock_variante ?? d?.idStockVariante ?? d?.stock_variante_id ??
    d?.id_variante ?? d?.idVariante ?? d?.variante_id ?? d?.idStockProductoVariante ??
    d?.stock_producto_variante_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getStockDisponible(d) {
  const raw = d?.stock ?? d?.stock_disponible ?? d?.stockDisponible ?? d?.cantidad_stock ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function getProductoNombre(d) {
  return safeText(d?.nombre ?? d?.producto_nombre ?? d?.stock_producto_nombre ?? d?.descripcion ?? d?.label ?? "");
}
function getPrecioVenta(d) {
  const precios = Array.isArray(d?.precios) ? d.precios : [];
  const venta = precios.find((p) => {
    const nombre = normalizeText(p?.tipo_precio ?? p?.nombre ?? "");
    return nombre === "precio de venta" || nombre === "precio venta" || nombre === "venta";
  }) || precios.find((p) => Number(p?.id_tipo_precio_stock || 0) === 2) || precios[0];
  const n = Number(venta?.monto ?? venta?.precio ?? d?.precio_venta ?? d?.precio ?? d?.precio_promocional ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function getMedioPagoId(c) {
  const cand = c?.id ?? c?.id_medio_pago ?? c?.idMedioPago ?? c?.medio_pago_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function optionLabel(x) {
  return safeText(x?.nombre ?? x?.categoria ?? x?.descripcion ?? x?.detalle ?? "");
}
function getComprobanteDownloadUrl(idMovimiento) {
  return `${BASE_URL}/api.php?action=otros_ingresos_comprobantes_descargar&id_movimiento=${Number(idMovimiento || 0)}`;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
function getAuthInfo() {
  const token = safeText(localStorage.getItem("token"));
  const sessionKey =
    safeText(localStorage.getItem("session_key")) ||
    safeText(localStorage.getItem("sessionKey")) ||
    safeText(localStorage.getItem("X-Session")) ||
    safeText(localStorage.getItem("x_session"));
  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand =
      u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}
  return { token, sessionKey, idUsuario };
}
function buildHeadersGET() {
  const { token, sessionKey } = getAuthInfo();
  const h = {};
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
function buildHeadersJSON() {
  const { token, sessionKey } = getAuthInfo();
  const h = { "Content-Type": "application/json" };
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
function buildHeadersFormData() {
  const { token, sessionKey } = getAuthInfo();
  const h = {};
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Respuesta inválida del servidor. HTTP ${res.status}. ${text.slice(0, 400)}`
    );
  }
}

// ─── Detección de tipo de cheque ───────────────────────────────────────────────
function detectChequeTipo(nombre) {
  const s = normalizeText(nombre);
  if (!s) return null;
  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) return "echeq";
  if (s.includes("cheque")) return "cheque";
  return null;
}

// ─── Normalización de listas ───────────────────────────────────────────────────
function normalizeDetalles(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src?.listas && typeof src.listas === "object" ? src.listas : src;

  // `detalles` en las listas globales es stock (`stock_productos`).
  // Este modal debe usar solamente la tabla `detalles`, expuesta en claves
  // específicas de otros ingresos. Si viene vacía, no debe hacer fallback a stock.
  for (const key of [
    "detalles_ingresos",
    "detallesIngresos",
    "detalles_ingreso",
    "detallesIngreso",
  ]) {
    if (Array.isArray(l?.[key])) return l[key];
  }

  return [];
}
function normalizeMediosPago(lists) {
  const raw = Array.isArray(lists?.medios_pago)
    ? lists.medios_pago
    : Array.isArray(lists?.mediosPago)
    ? lists.mediosPago
    : [];
  return raw.map((x) => ({
    id: Number(x?.id ?? x?.id_medio_pago ?? 0),
    nombre: String(x?.nombre ?? x?.descripcion ?? x?.detalle ?? "").trim(),
  }));
}
function normalizeProductos(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src?.listas && typeof src.listas === "object" ? src.listas : src;
  if (Array.isArray(l?.detalles)) return l.detalles;
  if (Array.isArray(l?.stock_productos)) return l.stock_productos;
  if (Array.isArray(l?.productos_stock)) return l.productos_stock;
  return [];
}

// ─── Builders de entidades ─────────────────────────────────────────────────────
function makeItem(it = {}) {
  const cantidad = Number(it?.cantidad ?? 1) || 1;
  const precio = Number(it?.precio ?? it?.importe ?? it?.monto ?? it?.total ?? 0) || 0;
  const iva_pct = Number(it?.iva_pct ?? it?.ivaPct ?? 0) || 0;
  const calc = calcItemTotals(cantidad, precio, iva_pct);
  const idStockProducto = getStockProductoId(it);
  const idStockVariante = getStockVarianteId(it);
  const tipoDeclarado = normalizeText(it?.tipo_item ?? it?.tipoItem ?? "");
  const esProducto = tipoDeclarado === "producto" || Number(it?.mueve_stock ?? it?.mueveStock ?? 0) === 1 || Boolean(idStockProducto || idStockVariante);
  const producto = safeText(it?.stock_producto_nombre ?? it?.producto_nombre ?? "");
  const variante = safeText(it?.stock_variante_nombre ?? it?.variante_nombre ?? "");
  return {
    uid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    id_detalle: String(Number(it?.id_detalle ?? 0) || ""),
    tipo_item: esProducto ? "producto" : "servicio",
    id_stock_producto: idStockProducto ? String(idStockProducto) : "",
    id_stock_variante: idStockVariante ? String(idStockVariante) : "",
    detalle: String(
      it?.descripcion ?? it?.detalle ?? it?.concepto ?? it?.detalle_nombre ??
      [producto, variante].filter(Boolean).join(" - ")
    ).trim(),
    cantidad,
    precio,
    iva_pct,
    subtotal: round2(it?.subtotal ?? calc.subtotal),
    iva_monto: round2(it?.iva_monto ?? calc.iva_monto),
    total: round2(it?.total ?? calc.total),
    stock_disponible: getStockDisponible(it),
    sinStock: false,
    precioDraft: "",
    precioFocused: false,
  };
}
function makeMedioPagoRow(mp = {}) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    id_medio_pago: String(Number(mp?.id_medio_pago ?? 0) || ""),
    monto: Number(mp?.monto ?? mp?.cheque_importe ?? 0) || 0,
    montoDraft: "",
    montoFocused: false,
    id_movimiento_medio_pago: Number(mp?.id_movimiento_medio_pago ?? 0) || null,
    id_cheque: Number(mp?.id_cheque ?? 0) || null,
    cheque:
      Number(mp?.id_cheque ?? 0) > 0
        ? {
            id_cheque: Number(mp?.id_cheque ?? 0),
            tipo_cheque: safeText(
              mp?.cheque_tipo ||
                detectChequeTipo(mp?.medio_pago_nombre || "") ||
                "cheque"
            ),
            emisor: safeText(mp?.emisor),
            numero_cheque: safeText(mp?.numero_cheque),
            fecha_emision: safeText(mp?.fecha_emision),
            fecha_pago: safeText(mp?.fecha_pago),
            importe: Number(mp?.cheque_importe ?? mp?.monto ?? 0) || 0,
          }
        : null,
  };
}
function buildInitialState(data) {
  const src = data && typeof data === "object" ? data : {};
  const rawItems =
    Array.isArray(src.items_detalle) && src.items_detalle.length
      ? src.items_detalle
      : Array.isArray(src.items) && src.items.length
      ? src.items
      : Array.isArray(src.detalles) && src.detalles.length
      ? src.detalles
      : [src];
  const items = rawItems
    .map((it) => makeItem(it))
    .filter(
      (it) =>
        Number(it.cantidad) > 0 &&
        (Number(it.precio) > 0 || Number(it.total) > 0 || Number(it.id_detalle) > 0)
    );
  const medios =
    Array.isArray(src.medios_pago_detalle) && src.medios_pago_detalle.length
      ? src.medios_pago_detalle.map((mp) => makeMedioPagoRow(mp))
      : [
          makeMedioPagoRow({
            id_medio_pago: src?.id_medio_pago,
            monto: src?.monto_total ?? src?.total ?? src?.total_general ?? 0,
          }),
        ];
  return {
    id_movimiento: Number(src?.id_movimiento ?? src?.id ?? 0) || 0,
    fecha: String(src?.fecha ?? "").slice(0, 10),
    items: items.length
      ? items
      : [makeItem({ cantidad: 1, precio: Number(src?.monto_total ?? 0) || 0 })],
    medios,
  };
}
function sumTotalItems(items) {
  return round2(
    (Array.isArray(items) ? items : []).reduce((acc, it) => acc + safeNumber(it?.total), 0)
  );
}

// ─── Subcomponente: resumen visual de cheque ───────────────────────────────────
function ChequeResumen({ cheque, tipoCheque }) {
  if (!cheque) return null;
  const esEcheq = tipoCheque === "echeq";
  const label = safeText(cheque?.numero_cheque) || "-";
  const emisor = safeText(cheque?.emisor) || "-";
  return (
    <div className="gm-checks-list">
      <div
        className={`gm-check-item gm-check-item--selected${esEcheq ? " gm-check-item--echeck" : ""}`}
      >
        <div className="gm-check-main">
          <div className="gm-check-top">
            <span className="gm-check-number">N° {label}</span>
            {esEcheq && (
              <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>
            )}
          </div>
          <div className="gm-check-meta">
            <span className="gm-check-issuer" title={emisor}>{emisor}</span>
            <span className="gm-check-separator">·</span>
            <span>Pago: {formatFechaDMY(cheque?.fecha_pago)}</span>
          </div>
        </div>
        <span className="gm-check-amount">{moneyARS(cheque?.importe || 0)}</span>
        <div
          aria-hidden="true"
          className={`gm-check-icon gm-check-icon--corner${
            esEcheq
              ? " gm-check-icon--echeck"
              : " gm-check-icon--check"
          }`}
        >
          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
            <path
              d="M1 3.5L3.5 6L8 1"
              stroke="#fff"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponente: fila de medio de pago ──────────────────────────────────────
function MedioPagoRow({
  row,
  mediosPago,
  totalIngreso,
  sumaMediosPago,
  onUpdate,
  onRemove,
  saving,
}) {
  const medio = useMemo(
    () => mediosPago.find((x) => String(x.id) === String(row.id_medio_pago)) || null,
    [mediosPago, row.id_medio_pago]
  );
  const tipoCheque = useMemo(() => detectChequeTipo(medio?.nombre || ""), [medio]);
  const esCheque = tipoCheque !== null;
  const esEcheq = tipoCheque === "echeq";

  const montoActual = esCheque && row.cheque
    ? safeNumber(row.cheque?.importe)
    : safeNumber(row.monto);

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - montoActual);
    return Math.max(0, safeNumber(totalIngreso) - sumaOtros);
  }, [sumaMediosPago, totalIngreso, montoActual]);

  // `restanteParaEstaFila` es el importe objetivo de la fila, no la diferencia
  // que falta agregar. Al cambiar un cheque por otro medio el monto ya puede
  // coincidir con ese objetivo; en ese caso "Rest." debe quedar deshabilitado.
  const puedeCompletarRestante =
    !saving &&
    !esCheque &&
    safeNumber(totalIngreso) > 0 &&
    restanteParaEstaFila - montoActual > 0.009;

  // Sincronizar el monto visual cuando el medio tiene un cheque/eCheq vinculado.
  useEffect(() => {
    if (
      esCheque &&
      row.cheque?.importe > 0 &&
      Number(row.monto) !== Number(row.cheque.importe)
    ) {
      onUpdate(row.id, {
        monto: Number(row.cheque.importe),
        montoDraft: "",
        montoFocused: false,
      });
    }
  }, [esCheque, row.cheque, row.id, row.monto, onUpdate]);

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPago.find((x) => String(x.id) === String(val));
      const tipo = detectChequeTipo(mp?.nombre || "");
      onUpdate(row.id, {
        id_medio_pago: val,
        monto: tipo === null ? safeNumber(row.monto) : safeNumber(row.cheque?.importe),
        montoDraft: "",
        montoFocused: false,
        cheque: tipo === null ? null : row.cheque,
        id_cheque: tipo === null ? null : row.id_cheque,
      });
    },
    [mediosPago, onUpdate, row.id, row.monto, row.cheque, row.id_cheque]
  );

  return (
    <div className="gm-payment-card">
      {/* Selector de medio */}
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select
            className="gm-input gm-select"
            value={String(row.id_medio_pago || "")}
            onChange={(e) => handleChangeMedio(e.target.value)}
            disabled={saving}
          >
            <option value={NULL_OPTION}>Seleccionar…</option>
            {mediosPago.map((x) => (
              <option key={x.id} value={String(x.id)}>
                {x.nombre}
              </option>
            ))}
          </select>
          <label
            className={`gm-label${
              row.id_medio_pago && row.id_medio_pago !== "" ? " gm-label--up" : ""
            }`}
          >
            Medio de pago
          </label>
        </div>
      </div>

      {/* Monto */}
      <div className="gm-payment-row gm-payment-row--amount">
        <div className="gm-field gm-payment-amount-field" style={{ position: "relative" }}>
          <input
            className={`gm-input gm-payment-amount-input${
              esCheque && row.cheque ? " gm-payment-amount-input--locked" : ""
            }`}
            type="text"
            inputMode="decimal"
            value={
              row.montoFocused
                ? row.montoDraft ?? ""
                : formatMoneyInputARS(montoActual)
            }
            onFocus={(e) => {
              if (saving || (esCheque && row.cheque)) return;
              onUpdate(row.id, {
                montoFocused: true,
                montoDraft: formatEditableMoney(montoActual),
              });
              setTimeout(() => e.target.select(), 0);
            }}
            onChange={(e) => {
              if (saving || (esCheque && row.cheque)) return;
              const c = e.target.value.replace(/[^\d,.\-]/g, "");
              onUpdate(row.id, { montoDraft: c, monto: parseMoneyInputARS(c) });
            }}
            onBlur={() => {
              if (saving || (esCheque && row.cheque)) return;
              const p = parseMoneyInputARS(row.montoDraft);
              onUpdate(row.id, { monto: p, montoDraft: "", montoFocused: false });
            }}
            onKeyDown={(e) => {
              if (saving || (esCheque && row.cheque)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="$ 0,00"
            disabled={saving || (esCheque && !!row.cheque)}
            style={{ height: 32, padding: "0 10px", fontSize: 13, textAlign: "right" }}
          />
          <label className="gm-label gm-label--up">Monto</label>
        </div>

        <div className="gm-payment-actions-col">
          {!esCheque && (
            <button
              type="button"
              className="gm-payment-complete"
              onClick={() =>
                onUpdate(row.id, {
                  monto: restanteParaEstaFila,
                  montoDraft: "",
                  montoFocused: false,
                })
              }
              disabled={!puedeCompletarRestante}
              title="Completar importe restante"
            >
              ↓ Rest.
            </button>
          )}
          <button
            type="button"
            className="gm-payment-delete"
            onClick={() => onRemove(row)}
            disabled={saving}
            title="Quitar"
          >
            ×
          </button>
        </div>
      </div>

      {/* Sección cheque/eCheq: solo lectura en edición */}
      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 12 }} />
            {esEcheq ? "eCheqs en cartera" : "Cheques en cartera"}
          </div>

          {row.cheque ? (
            <>
              <ChequeResumen cheque={row.cheque} tipoCheque={tipoCheque} />
              <div className="gm-upload-card__sub">
                ✓ 1 cheque(s) — {moneyARS(row.cheque?.importe || row.monto || 0)}
              </div>
            </>
          ) : (
            <div className="gm-payment-checks-empty">
              No hay {esEcheq ? "eCheq" : "cheque"} vinculado a este medio de pago.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ─── Panel inline de medios de pago ───────────────────────────────────────────
function PanelMediosPago({
  mediosFilas,
  mediosPago,
  totalIngreso,
  onUpdate,
  onRemove,
  onAdd,
  saving,
}) {
  const filas =
    Array.isArray(mediosFilas) && mediosFilas.length
      ? mediosFilas
      : [makeMedioPagoRow()];

  const sumaMediosPago = useMemo(
    () =>
      filas.reduce((a, r) => {
        const mp = mediosPago.find((x) => String(x.id) === String(r.id_medio_pago ?? ""));
        const tipoCheque = detectChequeTipo(String(mp?.nombre ?? "").trim());
        const monto =
          tipoCheque !== null && r.cheque
            ? safeNumber(r.cheque.importe)
            : safeNumber(r.monto);
        return a + monto;
      }, 0),
    [filas, mediosPago]
  );

  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(totalIngreso) - sumaMediosPago),
    [totalIngreso, sumaMediosPago]
  );

  return (
    <>
      {filas.map((mp) => (
        <MedioPagoRow
          key={mp.id}
          row={mp}
          mediosPago={mediosPago}
          totalIngreso={totalIngreso}
          sumaMediosPago={sumaMediosPago}
          onUpdate={onUpdate}
          onRemove={onRemove}
          saving={saving}
        />
      ))}

      <div className="gm-payment-totals">
        <span className="gm-payment-totals-assigned">
          Asignado: <b>{moneyARS(sumaMediosPago)}</b>
        </span>
        {diferenciaRestante > 0.01 && (
          <span className="gm-payment-totals-missing">Pendiente: {moneyARS(diferenciaRestante)}</span>
        )}
        {diferenciaRestante <= 0.01 && sumaMediosPago > 0 && (
          <span className="gm-payment-totals-ok">✓ Cobro completo</span>
        )}
      </div>

      <button
        type="button"
        className="gm-payment-btn"
        onClick={onAdd}
        disabled={saving}
      >
        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> Agregar otro medio
      </button>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MODAL PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function ModalEditarIngreso({
  open,
  initialData,
  lists,
  onClose,
  onToast,
  onSubmit,
  onSaved,
  dark: darkProp,
}) {
  const API = `${BASE_URL}/api.php`;

  const showToast = useCallback(
    (tipo, mensaje) => onToast?.(tipo, mensaje),
    [onToast]
  );

  const [darkAuto, setDarkAuto] = useState(isTemaOscuro);
  const [saving, setSaving] = useState(false);
  const [loadingComprobante, setLoadingComprobante] = useState(false);
  const [form, setForm] = useState(() => buildInitialState(initialData));
  const [comprobanteActual, setComprobanteActual] = useState(null);
  const [archivoNuevo, setArchivoNuevo] = useState(null);
  const [marcarEliminarComprobante, setMarcarEliminarComprobante] = useState(false);
  const [openViewer, setOpenViewer] = useState(false);
  const [viewerData, setViewerData] = useState({ url: "", mime: "", title: "Comprobante" });
  const [openNuevaDescripcionModal, setOpenNuevaDescripcionModal] = useState(false);
  const [currentRowIdForNewDesc, setCurrentRowIdForNewDesc] = useState(null);

  const closeBtnRef = useRef(null);
  const inputFileRef = useRef(null);
  const fechaRef = useRef(null);

  // Tema oscuro
  useEffect(() => {
    const update = () => setDarkAuto(isTemaOscuro());
    const obsHtml = new MutationObserver(update);
    obsHtml.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const obsBody = new MutationObserver(update);
    if (document.body)
      obsBody.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => { obsHtml.disconnect(); obsBody.disconnect(); };
  }, []);

  const dark = typeof darkProp === "boolean" ? darkProp : darkAuto;
  const detalles = useMemo(() => normalizeDetalles(lists), [lists]);
  const productos = useMemo(() => normalizeProductos(lists), [lists]);
  const mediosPago = useMemo(() => filtrarMediosPagoPorPlan(normalizeMediosPago(lists)), [lists]);

  // Bloqueo scroll body
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset al abrir
  useEffect(() => {
    if (!open) return;
    setSaving(false);
    const initial = buildInitialState(initialData);
    setForm(initial);
    setArchivoNuevo(null);
    setMarcarEliminarComprobante(false);
    setComprobanteActual(null);
    setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open, initialData]);

  // Escape key
  useEffect(() => {
    if (!open) return;

    const h = (e) => {
      if (e.key !== "Escape" || saving) return;

      // Si está abierto el modal superior de cheque,
      // este modal padre NO debe cerrarse con Escape.
      if (document.body.classList.contains("modal-nuevo-cheque-open")) {
        return;
      }

      if (openViewer || openNuevaDescripcionModal) return;

      e.preventDefault();
      e.stopPropagation();



      onClose?.();
    };

    document.addEventListener("keydown", h, true);

    return () => {
      document.removeEventListener("keydown", h, true);
    };
  }, [open, saving, openViewer, openNuevaDescripcionModal, onClose]);

  // Carga info comprobante existente
  const cargarInfoComprobante = useCallback(async () => {
    const idMovimiento = Number(initialData?.id_movimiento ?? initialData?.id ?? 0);
    if (!open || !(idMovimiento > 0)) { setComprobanteActual(null); return; }
    setLoadingComprobante(true);
    try {
      const res = await otrosIngresosFetch(
        `${API}?action=otros_ingresos_comprobantes_info&id_movimiento=${idMovimiento}`,
        { method: "GET", headers: buildHeadersGET() }
      );
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      setComprobanteActual(data?.comprobante ?? null);
    } catch (err) {
      setComprobanteActual(null);
      showToast("error", err?.message || "No se pudo obtener el comprobante.");
    } finally {
      setLoadingComprobante(false);
    }
  }, [API, initialData, open, showToast]);

  useEffect(() => { if (open) cargarInfoComprobante(); }, [open, cargarInfoComprobante]);

  // Enriquecer ítems con nombre desde la tabla `detalles` sin aplicar reglas de stock.
  useEffect(() => {
    if (!open || !Array.isArray(detalles) || !detalles.length) return;
    setForm((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        const detalleObj =
          detalles.find(
            (d) => String(getDetalleId(d) ?? "") === String(it.id_detalle || "")
          ) || null;
        if (!detalleObj) return it;
        return {
          ...it,
          detalle: it.detalle || optionLabel(detalleObj),
          stock_disponible: null,
          sinStock: false,
        };
      }),
    }));
  }, [open, detalles]);

  // ─── Handlers de ítems ───────────────────────────────────────────────────────
  const updateItem = useCallback(
    (uid, patch) =>
      setForm((prev) => ({
        ...prev,
        items: prev.items.map((it) => {
          if (it.uid !== uid) return it;
          const next = { ...it, ...patch };
          const cantidad = next.cantidad === "" ? "" : safeNumber(next.cantidad);
          const precio = round2(safeNumber(next.precio));
          const iva_pct = round2(safeNumber(next.iva_pct));
          const calc = calcItemTotals(
            cantidad === "" ? 0 : cantidad,
            precio,
            iva_pct
          );
          return { ...next, cantidad, precio, iva_pct, ...calc };
        }),
      })),
    []
  );

  const handleSelectDetalle = useCallback(
    (item, uid) => {
      if (item?.__isNewOption) {
        setCurrentRowIdForNewDesc(uid);
        setOpenNuevaDescripcionModal(true);
        return;
      }
      const precio = safeNumber(item?.precio || 0);
      updateItem(uid, {
        tipo_item: "servicio",
        id_detalle: String(getDetalleId(item) ?? ""),
        id_stock_producto: NULL_OPTION,
        id_stock_variante: NULL_OPTION,
        detalle: optionLabel(item),
        precio,
        stock_disponible: null,
        sinStock: false,
        cantidad: 1,
      });
    },
    [updateItem, showToast]
  );

  const handleSelectProducto = useCallback((producto, uid) => {
    // En `detalles` el catálogo global entrega el producto base con la clave
    // genérica `id`; las variantes sí exponen id_stock_producto explícito.
    const idStockProducto = getStockProductoId(producto) || (
      Number(producto?.id || 0) > 0 ? Number(producto.id) : null
    );
    const idStockVariante = getStockVarianteId(producto);
    const stockDisponible = getStockDisponible(producto);
    updateItem(uid, {
      tipo_item: "producto",
      id_detalle: NULL_OPTION,
      id_stock_producto: idStockProducto ? String(idStockProducto) : NULL_OPTION,
      id_stock_variante: idStockVariante ? String(idStockVariante) : NULL_OPTION,
      detalle: getProductoNombre(producto),
      precio: getPrecioVenta(producto),
      stock_disponible: stockDisponible,
      sinStock: stockDisponible !== null && stockDisponible <= 0,
      cantidad: stockDisponible !== null && stockDisponible <= 0 ? "" : 1,
    });
  }, [updateItem]);

  const barcodePendingRef = useRef(null);

  const handleBarcodeProductSelect = useCallback((producto) => {
    const target = (form.items || []).find((item) =>
      !Number(item?.id_stock_producto || 0) &&
      !Number(item?.id_stock_variante || 0) &&
      !String(item?.detalle || "").trim()
    );

    if (target) {
      handleSelectProducto(producto, target.uid);
      showToast("exito", `Producto leído: ${getProductoNombre(producto)}`);
      return;
    }

    const nextItem = makeItem({ tipo_item: "producto", cantidad: 1, precio: 0, iva_pct: 0 });
    barcodePendingRef.current = { uid: nextItem.uid, producto };
    setForm((prev) => ({ ...prev, items: [...(prev.items || []), nextItem] }));
  }, [form.items, handleSelectProducto, showToast]);

  useEffect(() => {
    const pending = barcodePendingRef.current;
    if (!pending || !(form.items || []).some((item) => item.uid === pending.uid)) return;
    barcodePendingRef.current = null;
    handleSelectProducto(pending.producto, pending.uid);
    showToast("exito", `Producto leído: ${getProductoNombre(pending.producto)}`);
  }, [form.items, handleSelectProducto, showToast]);

  useStockBarcodeScanner({
    enabled: open && !saving && !openViewer && !openNuevaDescripcionModal,
    options: productos,
    allowOutOfStock: false,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => showToast("advertencia", mensaje),
  });

  const handleTipoItemChange = useCallback(
    (uid, tipoItem) => {
      const tipo = tipoItem === "producto" ? "producto" : "servicio";
      updateItem(uid, {
        tipo_item: tipo,
        id_detalle: NULL_OPTION,
        id_stock_producto: NULL_OPTION,
        id_stock_variante: NULL_OPTION,
        detalle: "",
        cantidad: 1,
        precio: 0,
        precioDraft: "",
        precioFocused: false,
        stock_disponible: null,
        sinStock: false,
      });
    },
    [updateItem]
  );

  const handleCantidadChange = useCallback(
    (uid, newCantidad) => {
      const row = form.items.find((r) => r.uid === uid);
      if (!row) return;
      let cantidadFinal = newCantidad === "" ? "" : Number(newCantidad);
      if (typeof cantidadFinal === "number" && cantidadFinal < 0) cantidadFinal = 0;
      if (
        row.tipo_item === "producto" &&
        cantidadFinal !== "" &&
        row.stock_disponible !== null &&
        Number(cantidadFinal) > Number(row.stock_disponible)
      ) {
        showToast("advertencia", `Stock disponible: ${row.stock_disponible}.`);
        cantidadFinal = Number(row.stock_disponible);
      }
      updateItem(uid, { cantidad: cantidadFinal });
    },
    [form.items, updateItem, showToast]
  );

  const addItem = useCallback(
    (tipoItem = "servicio") =>
      setForm((p) => ({
        ...p,
        items: [...p.items, makeItem({
          tipo_item: tipoItem === "producto" ? "producto" : "servicio",
          cantidad: 1,
          precio: 0,
          iva_pct: 0,
        })],
      })),
    []
  );

  const removeItem = useCallback(
    (uid) =>
      setForm((p) =>
        (p.items || []).length <= 1
          ? p
          : { ...p, items: p.items.filter((it) => it.uid !== uid) }
      ),
    []
  );

  // ─── Handlers de medios de pago ──────────────────────────────────────────────
  const updateMedioPago = useCallback(
    (id, patch) =>
      setForm((prev) => ({
        ...prev,
        medios: prev.medios.map((mp) => (mp.id === id ? { ...mp, ...patch } : mp)),
      })),
    []
  );

  const addMedioPago = useCallback(
    () =>
      setForm((prev) => ({
        ...prev,
        medios: [...prev.medios, makeMedioPagoRow()],
      })),
    []
  );

  // onRemove recibe el objeto row completo para poder capturar id_cheque
  const removeMedioPago = useCallback((row) => {
    setForm((prev) => {
      const next = prev.medios.filter((x) => x.id !== row.id);
      return { ...prev, medios: next.length ? next : [makeMedioPagoRow()] };
    });
  }, []);

  // ─── Cálculos ────────────────────────────────────────────────────────────────
  const totalGeneral = useMemo(() => sumTotalItems(form.items), [form.items]);
  const sumaMediosPago = useMemo(
    () => (form.medios || []).reduce((acc, mp) => acc + safeNumber(mp?.monto), 0),
    [form.medios]
  );
  const resumen = {
    subtotal: round2(
      (form.items || []).reduce((a, it) => a + safeNumber(it?.subtotal), 0)
    ),
    iva: round2((form.items || []).reduce((a, it) => a + safeNumber(it?.iva_monto), 0)),
    total: totalGeneral,
  };

  // ─── Comprobante ─────────────────────────────────────────────────────────────
  const mostrarArchivoActual = Boolean(
    (comprobanteActual?.archivo_url || comprobanteActual) &&
      !marcarEliminarComprobante &&
      !archivoNuevo
  );

  const nombreComprobanteVisible = useMemo(() => {
    if (marcarEliminarComprobante) return "";
    if (archivoNuevo || comprobanteActual) return "Comprobante adjunto";
    return "";
  }, [archivoNuevo, marcarEliminarComprobante, comprobanteActual]);

  const abrirViewer = useCallback(async () => {
    const idMovimiento = Number(form.id_movimiento || 0);
    if (!(idMovimiento > 0)) return;

    if (archivoNuevo) {
      setViewerData({
        url: URL.createObjectURL(archivoNuevo),
        mime: archivoNuevo.type || "application/octet-stream",
        title: "Comprobante adjunto",
      });
      setOpenViewer(true);
      return;
    }

    if (!comprobanteActual || marcarEliminarComprobante) return;

    setLoadingComprobante(true);
    try {
      const idComprobante = Number(
        comprobanteActual?.id_comprobante ??
          comprobanteActual?.comprobante_id ??
          comprobanteActual?.id_archivo ??
          0
      );

      const sp = new URLSearchParams();
      sp.set("action", "otros_ingresos_comprobantes_descargar");
      if (idComprobante > 0) sp.set("id_comprobante", String(idComprobante));
      sp.set("id_movimiento", String(idMovimiento));

      const res = await otrosIngresosFetch(`${API}?${sp.toString()}`, {
        method: "GET",
        headers: buildHeadersGET(),
      });
      const data = await parseJsonOrThrow(res);

      if (!data?.exito) {
        throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      }

      const signedUrl = String(data?.url || data?.archivo_url || "").trim();
      if (!signedUrl) {
        throw new Error("El backend no devolvió la URL del comprobante.");
      }

      setViewerData({
        url: signedUrl,
        mime: safeText(comprobanteActual?.archivo_mime) || safeText(data?.mime) || "application/octet-stream",
        title: "Comprobante del ingreso",
      });
      setOpenViewer(true);
    } catch (err) {
      showToast("error", err?.message || "No se pudo abrir el comprobante.");
    } finally {
      setLoadingComprobante(false);
    }
  }, [API, form.id_movimiento, archivoNuevo, comprobanteActual, marcarEliminarComprobante, showToast]);

  const cerrarViewer = useCallback(() => {
    if (viewerData?.url?.startsWith("blob:")) URL.revokeObjectURL(viewerData.url);
    setOpenViewer(false);
    setViewerData({ url: "", mime: "", title: "Comprobante" });
  }, [viewerData]);

  const seleccionarArchivo = useCallback((e) => {
    const file = e.target.files?.[0] || null;

    if (!file) return;

    if (!isAllowedComprobanteFile(file)) {
      showToast("advertencia", "Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      setArchivoNuevo(null);

      if (inputFileRef.current) inputFileRef.current.value = "";

      return;
    }

    setArchivoNuevo(file);
    setMarcarEliminarComprobante(false);
  }, [showToast]);

  const quitarArchivoNuevo = useCallback(() => {
    setArchivoNuevo(null);
    if (inputFileRef.current) inputFileRef.current.value = "";
  }, []);

  const marcarEliminar = useCallback(() => {
    setArchivoNuevo(null);
    if (inputFileRef.current) inputFileRef.current.value = "";
    setMarcarEliminarComprobante(true);
  }, []);

  const restaurarComprobanteActual = useCallback(() => {
    setMarcarEliminarComprobante(false);
    setArchivoNuevo(null);
    if (inputFileRef.current) inputFileRef.current.value = "";
  }, []);

  const openDatePicker = useCallback(() => {
    const el = fechaRef.current;
    if (!el || saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch { el.focus(); }
  }, [saving]);

  // ⭐ FUNCIÓN PARA VALIDAR Y ACTUALIZAR LA FECHA ⭐
  const handleFechaChange = useCallback((e) => {
    const nuevaFecha = e.target.value;

    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.");
      return;
    }

    setForm((p) => ({ ...p, fecha: nuevaFecha }));
  }, [showToast]);

  const cerrar = useCallback(() => { if (!saving) onClose?.(); }, [saving, onClose]);

  // ─── Operaciones de API sobre comprobante y cheques ───────────────────────────
  const eliminarComprobanteExistente = useCallback(
    async (idMovimiento) => {
      const { idUsuario } = getAuthInfo();
      const res = await otrosIngresosFetch(`${API}?action=otros_ingresos_comprobantes_eliminar`, {
        method: "POST",
        headers: buildHeadersJSON(),
        body: JSON.stringify({
          id_movimiento: idMovimiento,
          idUsuario,
          idUsuarioMaster: idUsuario,
        }),
      });
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar el comprobante.");
      return data;
    },
    [API]
  );

  const subirComprobanteNuevo = useCallback(
    async (idMovimiento, archivo) => {
      const { idUsuario } = getAuthInfo();
      const fd = new FormData();
      fd.append("id_movimiento", String(idMovimiento));
      fd.append("archivo", archivo);
      fd.append("idUsuario", String(idUsuario || 0));
      fd.append("idUsuarioMaster", String(idUsuario || 0));
      const res = await otrosIngresosFetch(
        `${API}?action=otros_ingresos_comprobantes_vincular_movimiento_upload`,
        { method: "POST", headers: buildHeadersFormData(), body: fd }
      );
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo subir el comprobante.");
      return data;
    },
    [API]
  );



  // ─── Validación ──────────────────────────────────────────────────────────────
  const validate = useCallback(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.fecha || "").trim()))
      return { ok: false, msg: "La fecha es obligatoria." };

    // ⭐ VALIDACIÓN DE FECHA FUTURA ⭐
    if (form.fecha > todayISO()) {
      return { ok: false, msg: "La fecha no puede ser posterior al día actual." };
    }

    const mediosValidables = Array.isArray(form.medios) ? form.medios : [];

    for (let i = 0; i < mediosValidables.length; i++) {
      const mp = mediosValidables[i];
      const tieneMedio = Number(mp.id_medio_pago || 0) > 0;
      const tieneMonto = safeNumber(mp.monto) > 0 || safeNumber(mp.cheque?.importe) > 0;
      const tieneCheque = !!mp.cheque;
      if (!tieneMedio && !tieneMonto && !tieneCheque) continue;
      if (!tieneMedio)
        return { ok: false, msg: `Medio de pago ${i + 1}: falta seleccionar el medio.` };
      const medio = mediosPago.find((x) => String(x.id) === String(mp.id_medio_pago));
      const tipoCheque = detectChequeTipo(medio?.nombre || "");
      if (tipoCheque) {
        if (!mp.cheque)
          return {
            ok: false,
            msg: `Medio de pago ${i + 1}: debés cargar el ${tipoCheque === "echeq" ? "eCheq" : "cheque"}.`,
          };
      } else if (!(safeNumber(mp.monto) > 0)) {
        return { ok: false, msg: `Medio de pago ${i + 1}: el monto debe ser mayor a 0.` };
      }
    }

    // Otros ingresos es contado: debe quedar cobrado como mínimo por el total.
    // Se permite superar el total cuando el usuario usa un cheque/eCheq de mayor importe.
    if (sumaMediosPago + 0.05 < totalGeneral && totalGeneral > 0)
      return {
        ok: false,
        msg: `La suma de los medios de pago (${moneyARS(sumaMediosPago)}) debe cubrir el total del ingreso (${moneyARS(totalGeneral)}).`,
      };

    const items = (form.items || [])
      .map((it) => ({
        ...it,
        id_detalle: Number(it.id_detalle || 0),
        id_stock_producto: Number(it.id_stock_producto || 0),
        id_stock_variante: Number(it.id_stock_variante || 0),
        cantidad: safeNumber(it.cantidad),
        precio: round2(safeNumber(it.precio)),
        iva_pct: round2(safeNumber(it.iva_pct)),
      }))
      .filter(
        (it) =>
          safeText(it.detalle) !== "" &&
          (it.tipo_item !== "producto" || it.id_stock_producto > 0) &&
          it.cantidad > 0 &&
          (it.tipo_item !== "producto" || it.stock_disponible === null || it.cantidad <= Number(it.stock_disponible) + 0.0001) &&
          it.precio > 0 &&
          safeNumber(it.total) > 0
      );

    if (!items.length) {
      return {
        ok: false,
        msg: "Debés cargar al menos un detalle o producto con cantidad e importe válidos.",
      };
    }
    return { ok: true, items };
  }, [form, mediosPago, sumaMediosPago, totalGeneral]);

  // ─── Submit ───────────────────────────────────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    try {
      setSaving(true);
      showToast("cargando", "Actualizando ingreso…");

      const v = validate();
      if (!v.ok) throw new Error(v.msg);

      if (archivoNuevo && !isAllowedComprobanteFile(archivoNuevo)) {
        throw new Error("Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      }

      const items = v.items.map((it) => ({
        tipo_item: it.tipo_item === "producto" ? "producto" : "servicio",
        mueve_stock: it.tipo_item === "producto" ? 1 : 0,
        id_detalle: it.tipo_item === "producto" ? null : (it.id_detalle || null),
        id_stock_producto: it.tipo_item === "producto" ? (it.id_stock_producto || null) : null,
        id_stock_variante: it.tipo_item === "producto" ? (it.id_stock_variante || null) : null,
        detalle: safeText(it.detalle),
        cantidad: safeNumber(it.cantidad),
        precio: round2(safeNumber(it.precio)),
        iva_pct: round2(safeNumber(it.iva_pct)),
        ...calcItemTotals(it.cantidad, it.precio, it.iva_pct),
      }));

      const payload = {
        id_movimiento: Number(form.id_movimiento || 0),
        fecha: String(form.fecha || "").trim(),
        id_medio_pago: Number(form.medios?.[0]?.id_medio_pago || 0),
        id_detalle: items[0]?.id_detalle ?? null,
        monto_total: sumTotalItems(items),
        medios_pago: (form.medios || [])
          .filter((mp) => Number(mp.id_medio_pago || 0) > 0 && safeNumber(mp.cheque?.importe ?? mp.monto) > 0)
          .map((mp) => {
            const cheque = mp.cheque && !Number(mp.id_cheque || mp.cheque?.id_cheque || 0)
              ? {
                  tipo: mp.cheque.tipo || mp.cheque.tipo_cheque || mp.cheque.cheque_tipo || null,
                  fecha_emision: mp.cheque.fecha_emision || null,
                  emisor: mp.cheque.emisor || "",
                  numero_cheque: mp.cheque.numero_cheque || "",
                  importe: safeNumber(mp.cheque.importe),
                  fecha_pago: mp.cheque.fecha_pago || null,
                  observaciones: mp.cheque.observaciones || "",
                  archivo_nombre:
                    mp.cheque.archivo_nombre ||
                    (mp.cheque.archivo instanceof File ? mp.cheque.archivo.name : ""),
                }
              : null;
            return {
              frontend_row_uid: mp.id,
              id_movimiento_medio_pago: mp.id_movimiento_medio_pago || null,
              id_medio_pago: Number(mp.id_medio_pago || 0),
              monto: safeNumber(mp.cheque?.importe ?? mp.monto),
              id_cheque: mp.id_cheque || mp.cheque?.id_cheque || null,
              cheque_tipo: mp.cheque?.tipo || mp.cheque?.tipo_cheque || mp.cheque?.cheque_tipo || null,
              ...(cheque ? { cheque } : {}),
            };
          }),
        items,
      };

      if (!(payload.id_movimiento > 0))
        throw new Error("Falta el ID del ingreso a editar.");

      const resp = await onSubmit?.(payload, true);
      const idMovimientoFinal = Number(
        resp?.id_movimiento ?? resp?.id ?? payload.id_movimiento ?? 0
      );
      if (!(idMovimientoFinal > 0))
        throw new Error("No se pudo determinar el ID del ingreso actualizado.");

      // Comprobante
      if (marcarEliminarComprobante && comprobanteActual && !archivoNuevo) {
        await eliminarComprobanteExistente(idMovimientoFinal);
      }
      if (archivoNuevo) {
        await subirComprobanteNuevo(idMovimientoFinal, archivoNuevo);
      }


      await onSaved?.(resp);
    } catch (err) {
      showToast("error", err?.message || "Error actualizando ingreso.");
      setSaving(false);
    }
  };

  // ─── Descripción nueva ───────────────────────────────────────────────────────
  const handleGuardarNuevaDescripcion = useCallback(
    async (nombre) => {
      try {
        const { token, sessionKey, idUsuario } = getAuthInfo();
        const headers = { "Content-Type": "application/json" };
        if (sessionKey) headers["X-Session"] = sessionKey;
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await otrosIngresosFetch(`${API}?action=otros_ingresos_detalles_crear`, {
          method: "POST",
          headers,
          body: JSON.stringify({ nombre, idUsuario, idUsuarioMaster: idUsuario }),
        });
        const data = await parseJsonOrThrow(res);
        const detalleCreado = data?.detalle || data?.item;
        if (!data?.exito || !detalleCreado)
          throw new Error(data?.mensaje || "No se pudo crear la descripción.");
        const item = detalleCreado;
        const precio = safeNumber(item?.precio || 0);
        updateItem(currentRowIdForNewDesc, {
          tipo_item: "servicio",
          id_detalle: String(item.id_detalle || item.id || ""),
          id_stock_producto: NULL_OPTION,
          id_stock_variante: NULL_OPTION,
          detalle: item.nombre || nombre,
          precio,
          stock_disponible: null,
          sinStock: false,
          cantidad: 1,
        });
        showToast("exito", "Descripción creada y seleccionada correctamente.");
        return true;
      } catch (e) {
        showToast("error", e?.message || "No se pudo crear la descripción.");
        return false;
      }
    },
    [API, currentRowIdForNewDesc, updateItem, showToast]
  );

  // Lista de detalles con opción de nueva descripción
  const enhancedDetalles = useMemo(
    () => [
      { id: "new_option", __isNewOption: true, nombre: "+ Agregar nueva descripción" },
      ...detalles,
    ],
    [detalles]
  );

  if (!open) return null;
  return createPortal(
    <>
      <div className="gm-modal-overlay gm-modal-overlay--movement">
        <div
          className={`gm-modal-container gm-modal-container--movement gm-modal-v2 oi-modal${dark ? " gm-modal-container--dark" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-editar-ingreso-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faPenToSquare} />
            </div>
            <div className="gm-modal-head-left">
              <h2 id="modal-editar-ingreso-title" className="gm-modal-title">
                Editar ingreso
              </h2>
              <p className="gm-modal-subtitle">
                Modificá fecha, medios de pago, ítems y comprobante
              </p>
            </div>
            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={cerrar}
              aria-label="Cerrar"
              disabled={saving}
              type="button"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="gm-modal-content">
            <form
              onSubmit={submit}
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              <div className="gm-movement-layout">
                {/* Tabla de ítems */}
                <section className="gm-movement-main gm-table gm-table--movement oi-table">
                  <div
                    className="gm-table-head"
                    style={{
                      gridTemplateColumns: "2.4fr 0.8fr 1.1fr 0.9fr 1fr 1.1fr 0.45fr",
                    }}
                  >
                    <div className="gm-table-th" style={{ paddingLeft: 10 }}>
                      Tipo / detalle o producto
                    </div>
                    <div className="gm-table-th">Cant.</div>
                    <div className="gm-table-th right">Importe</div>
                    <div className="gm-table-th">IVA %</div>
                    <div className="gm-table-th right">IVA $</div>
                    <div className="gm-table-th right">Total</div>
                    <div className="gm-table-th" />
                  </div>

                  <div className="gm-table-body">
                    {(form.items || []).map((it, itemIndex) => {
                      return (
                        <div
                          key={it.uid}
                          className="gm-table-row"
                          style={{
                            gridTemplateColumns:
                              "2.4fr 0.8fr 1.1fr 0.9fr 1fr 1.1fr 0.45fr",
                          }}
                        >
                          {/* Descripción */}
                          <div className="gm-table-cell gm-table-cell--detail">
                            <select
                              className="oi-item-kind"
                              value={it.tipo_item === "producto" ? "producto" : "servicio"}
                              onChange={(e) => handleTipoItemChange(it.uid, e.target.value)}
                              disabled={saving}
                              aria-label={`Tipo de ítem fila ${itemIndex + 1}`}
                            >
                              <option value="servicio">Detalle / servicio (sin stock)</option>
                              <option value="producto">Producto (mueve stock)</option>
                            </select>
                            {it.tipo_item === "producto" ? (
                              <ProductStockAutocomplete
                                value={it.detalle}
                                onChange={(val) =>
                                  updateItem(it.uid, {
                                    detalle: val,
                                    id_detalle: NULL_OPTION,
                                    id_stock_producto: NULL_OPTION,
                                    id_stock_variante: NULL_OPTION,
                                    precio: 0,
                                    stock_disponible: null,
                                    sinStock: false,
                                  })
                                }
                                onSelect={(item) => handleSelectProducto(item, it.uid)}
                                options={productos}
                                placeholder="Escribí o buscá un producto…"
                                disabled={saving}
                                showAllOnFocus={true}
                                maxItems={18}
                                inputClassName="gm-cell-input"
                                emptyMessage="No hay productos con stock"
                              />
                            ) : (
                              <GlobalAutocomplete
                                value={it.detalle}
                                onChange={(val) =>
                                  updateItem(it.uid, {
                                    detalle: val,
                                    id_detalle: NULL_OPTION,
                                    id_stock_producto: NULL_OPTION,
                                    id_stock_variante: NULL_OPTION,
                                    stock_disponible: null,
                                    sinStock: false,
                                  })
                                }
                                onSelect={(item) => handleSelectDetalle(item, it.uid)}
                                options={enhancedDetalles}
                                getOptionLabel={(d) => optionLabel(d)}
                                getOptionValue={(d) => String(getDetalleId(d) ?? optionLabel(d))}
                                placeholder="Escribí o buscá un detalle…"
                                disabled={saving}
                                showAllOnFocus={false}
                                maxItems={18}
                                inputClassName="gm-cell-input"
                              />
                            )}
                            {it.tipo_item === "producto" && it.stock_disponible !== null && (
                              <small className="oi-stock-hint">Stock disponible: {it.stock_disponible}</small>
                            )}
                          </div>

                          {/* Cantidad */}
                          <div className="gm-table-cell gm-table-cell--center">
                            <input
                              className="gm-cell-input gm-cell-input--center"
                              type="number"
                              min="0.01"
                              max={it.tipo_item === "producto" && it.stock_disponible !== null ? it.stock_disponible : undefined}
                              step="0.01"
                              style={{ width: "100%" }}
                              value={it.cantidad}
                              onChange={(e) =>
                                handleCantidadChange(
                                  it.uid,
                                  e.target.value === "" ? "" : Number(e.target.value)
                                )
                              }
                              disabled={saving || Boolean(it.tipo_item === "producto" && it.sinStock)}
                              placeholder=""
                              title=""
                            />
                          </div>

                          {/* Precio */}
                          <div className="gm-table-cell gm-table-cell--center">
                            <input
                              className="gm-cell-input gm-cell-input--right"
                              type="text"
                              inputMode="decimal"
                              value={
                                it.precioFocused
                                  ? it.precioDraft ?? ""
                                  : formatMoneyInputARS(it.precio)
                              }
                              onFocus={(e) => {
                                updateItem(it.uid, {
                                  precioFocused: true,
                                  precioDraft: formatEditableMoney(it.precio),
                                });
                                setTimeout(() => e.target.select(), 0);
                              }}
                              onChange={(e) => {
                                const cleaned = e.target.value.replace(/[^\d,.\-]/g, "");
                                updateItem(it.uid, {
                                  precioDraft: cleaned,
                                  precio: parseMoneyInputARS(cleaned),
                                });
                              }}
                              onBlur={() => {
                                const parsed = parseMoneyInputARS(it.precioDraft);
                                updateItem(it.uid, {
                                  precio: parsed,
                                  precioDraft: "",
                                  precioFocused: false,
                                });
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                              placeholder="$ 0,00"
                              disabled={saving}
                              style={{ width: "100%", padding: "0" }}
                            />
                          </div>

                          {/* IVA % */}
                          <div className="gm-table-cell gm-table-cell--center">
                            <select
                              className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                              style={{ width: "100%" }}
                              value={String(it.iva_pct)}
                              onChange={(e) =>
                                updateItem(it.uid, { iva_pct: Number(e.target.value) })
                              }
                              disabled={saving}
                            >
                              {IVA_OPTIONS.map((x) => (
                                <option key={x.value} value={x.value}>
                                  {x.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* IVA $ */}
                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                            {moneyARS(it.iva_monto)}
                          </div>

                          {/* Total */}
                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                            {moneyARS(it.total)}
                          </div>

                          {/* Eliminar */}
                          <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                            <button
                              type="button"
                              className="gm-row-delete"
                              onClick={() => removeItem(it.uid)}
                              disabled={saving}
                              title="Eliminar ítem"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer de tabla */}
                  <div className="gm-table-foot">
                    <div className="gm-foot-actions">
                      <button
                        type="button"
                        className="gm-foot-btn"
                        onClick={() => addItem("servicio")}
                        disabled={saving}
                      >
                        <span className="gm-foot-btn__icon">
                          <FontAwesomeIcon icon={faPlus} />
                        </span>
                        Agregar detalle
                      </button>
                      <button
                        type="button"
                        className="gm-foot-btn"
                        onClick={() => addItem("producto")}
                        disabled={saving}
                      >
                        <span className="gm-foot-btn__icon">
                          <FontAwesomeIcon icon={faPlus} />
                        </span>
                        Agregar producto
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
                      <div className="gm-summary-chip gm-summary-chip--total">
                        <span>Total</span>
                        <b>{moneyARS(resumen.total)}</b>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Sidebar */}
                <div className="gm-movement-side">
                  <aside className="gm-aside">
                    <div className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>Datos del ingreso</span>
                      </div>

                      <div className="gm-section-body">
                        {/* ⭐ FECHA CON VALIDACIONES ⭐ */}
                        <div className="gm-field" onClick={openDatePicker}>
                          <input
                            ref={fechaRef}
                            className="gm-input"
                            type="date"
                            placeholder=" "
                            value={form.fecha}
                            max={todayISO()}
                            onChange={handleFechaChange}
                            disabled={saving}
                          />
                          <label className="gm-label" onClick={openDatePicker}>
                            Fecha
                          </label>
                        </div>

                        {/* Medios de pago integrados */}
                        <PanelMediosPago
                          mediosFilas={form.medios || []}
                          mediosPago={mediosPago}
                          totalIngreso={resumen.total}
                          onUpdate={updateMedioPago}
                          onRemove={removeMedioPago}
                          onAdd={addMedioPago}
                          saving={saving}
                        />

                        {/* Comprobante */}
                        <div className="gm-upload-card">
                          <div className="gm-upload-card__head">
                            <div className="gm-upload-card__title">Comprobante</div>
                            <div className="gm-upload-card__sub">
                              Seleccioná, visualizá o quitá el archivo antes de guardar
                            </div>
                          </div>

                          <div className="gm-upload-card__body">
                            {loadingComprobante ? (
                              <div style={{ fontSize: 13, opacity: 0.75, padding: "8px 0" }}>
                                Cargando comprobante…
                              </div>
                            ) : (
                              <>
                                {/* Archivo ya vinculado */}
                                {mostrarArchivoActual && (
                                  <div className="gm-upload-file is-filled">
                                    <div className="gm-upload-file__icon">
                                      <FontAwesomeIcon icon={faFileLines} />
                                    </div>
                                    <div className="gm-upload-file__meta">
                                      <div
                                        className="gm-upload-file__name"
                                        title={nombreComprobanteVisible}
                                      >
                                        {nombreComprobanteVisible}
                                      </div>

                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        marginLeft: "auto",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={abrirViewer}
                                        disabled={saving}
                                      >
                                        <FontAwesomeIcon icon={faEye} />
                                      </button>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={marcarEliminar}
                                        disabled={saving}
                                      >
                                        <FontAwesomeIcon icon={faTrashCan} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Archivo nuevo seleccionado */}
                                {archivoNuevo && (
                                  <div
                                    className="gm-upload-file is-filled"
                                    style={{ marginTop: mostrarArchivoActual ? 10 : 0 }}
                                  >
                                    <div className="gm-upload-file__icon">
                                      <FontAwesomeIcon icon={faFileLines} />
                                    </div>
                                    <div className="gm-upload-file__meta">
                                      <div
                                        className="gm-upload-file__name"
                                        title="Comprobante adjunto"
                                      >
                                        Comprobante adjunto
                                      </div>

                                    </div>
                                    <div
                                      style={{
                                        display: "flex",
                                        gap: 8,
                                        marginLeft: "auto",
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={abrirViewer}
                                        disabled={saving}
                                      >
                                        <FontAwesomeIcon icon={faEye} />
                                      </button>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={quitarArchivoNuevo}
                                        disabled={saving}
                                      >
                                        <FontAwesomeIcon icon={faTrashCan} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {/* Sin comprobante */}
                                {!mostrarArchivoActual && !archivoNuevo && (
                                  <div className="gm-upload-file is-empty">
                                    <div className="gm-upload-file__meta">
                                      <div className="gm-upload-file__size">
                                        No hay comprobante seleccionado
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {/* Restaurar comprobante */}
                                {marcarEliminarComprobante && !archivoNuevo && (
                                  <div
                                    style={{
                                      marginTop: 10,
                                      display: "flex",
                                      gap: 8,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="gm-upload-btn gm-upload-btn--ghost"
                                      onClick={restaurarComprobanteActual}
                                      disabled={saving}
                                    >
                                      Restaurar comprobante actual
                                    </button>
                                  </div>
                                )}

                                {/* Seleccionar / reemplazar */}
                                <div className="gm-upload-bar" style={{ marginTop: 12 }}>
                                  <input
                                    ref={inputFileRef}
                                    type="file"
                                    accept="image/*,application/pdf,.pdf"
                                    className="gm-upload-bar__input"
                                    onChange={seleccionarArchivo}
                                    disabled={saving}
                                    style={{ display: "none" }}
                                  />
                                  <button
                                    type="button"
                                    className="gm-upload-btn gm-upload-btn--primary"
                                    onClick={() => inputFileRef.current?.click()}
                                    disabled={saving}
                                  >
                                    <FontAwesomeIcon icon={faUpload} />{" "}
                                    {archivoNuevo || mostrarArchivoActual
                                      ? "Reemplazar archivo"
                                      : "Seleccionar archivo"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>

                  {/* Acciones */}
                  <div className="gm-actions gm-actions--sticky">
                    <button
                      type="submit"
                      disabled={saving}
                      className="gm-action-btn gm-action-btn--save"
                    >
                      {saving ? "Guardando..." : "Guardar cambios"}
                    </button>
                    <button
                      type="button"
                      onClick={cerrar}
                      disabled={saving}
                      className="gm-action-btn gm-action-btn--cancel"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Modal nueva descripción */}
      {openNuevaDescripcionModal && (
        <ModalNuevaDescripcion
          open={openNuevaDescripcionModal}
          onClose={() => setOpenNuevaDescripcionModal(false)}
          onSave={handleGuardarNuevaDescripcion}
          dark={dark}
        />
      )}

      {/* Viewer de comprobante */}
      <ModalVerComprobante
        open={openViewer}
        url={viewerData.url}
        mime={viewerData.mime}
        title={viewerData.title}
        onClose={cerrarViewer}
      />
    </>,
    document.body
  );
}
