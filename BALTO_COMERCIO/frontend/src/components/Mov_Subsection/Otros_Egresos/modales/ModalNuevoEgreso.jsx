import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faFileInvoiceDollar,
  faMoneyCheckDollar,
  faCircleNotch,
  faTrash,
  faEye,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import ModalNuevaDescripcion from "./ModalNuevaDescripcion.jsx";
import BASE_URL from "../../../../config/config.jsx";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";

// ── Estilos base + CSS propio de Egreso ──
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
// Estilos específicos compartidos por Nuevo Egreso y Editar Egreso
import "./ModalEgreso.css";
import { otrosEgresosFetch } from "../api/otrosEgresosApi.js";

/* ─────────────────────────────────────────
   CONSTANTES Y HELPERS  (idénticos a NuevaCompra)
───────────────────────────────────────── */
const NULL_OPTION = "";
const NOMBRE_COMPROBANTE_GENERICO = "Comprobante adjunto";

function isAllowedComprobanteFile(file) {
  if (!file) return false;

  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  const isImageMime = mime.startsWith("image/");
  const isPdfMime = mime === "application/pdf";

  const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(name);
  const isPdfExt = /\.pdf$/i.test(name);

  return isImageMime || isPdfMime || isImageExt || isPdfExt;
}

const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safeStr(v) {
  return String(v ?? "").trim();
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
function uid() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeName(v) {
  return String(v ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizeChequeTipoFromMedio(nombre) {
  const s = normalizeText(nombre);
  if (!s) return null;
  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) return "echeq";
  if (s.includes("cheque")) return "cheque";
  return null;
}
function optionLabel(x) {
  return safeStr(x?.nombre ?? x?.categoria ?? x?.descripcion ?? x?.detalle ?? "");
}

/* IDs */
function getDetalleId(d) {
  const c =
    d?.id ??
    d?.id_detalle ??
    d?.idDetalle ??
    d?.detalle_id ??
    d?.id_categoria_egreso ??
    d?.idCategoriaEgreso ??
    null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getMedioPagoId(c) {
  const cand = c?.id ?? c?.id_medio_pago ?? c?.idMedioPago ?? c?.medio_pago_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getClasificacionId(c) {
  const cand = c?.id ?? c?.id_clasificacion ?? c?.idClasificacion ?? c?.clasificacion_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getMovimientoId(r) {
  const c = r?.id_movimiento ?? r?.idMovimiento ?? r?.id_mov ?? r?.id ?? r?.id_egreso ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getSavedMovimientoIdFromResponse(data, init = null) {
  for (const c of [
    data?.id_movimiento,
    data?.movimiento_id,
    data?.id,
    data?.egreso?.id_movimiento,
    data?.egreso?.id,
    init?.id_movimiento,
    init?.id,
  ]) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
function getChequeIdsArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v == null || v === "") return [];
  return [String(v)];
}

/* Listas */
function normalizeLists(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src?.listas && typeof src.listas === "object" ? src.listas : src;
  const pick = (k) => (Array.isArray(l?.[k]) ? l[k] : []);
  const pickExplicitArray = (keys) => {
    for (const k of keys) {
      if (Array.isArray(l?.[k])) return l[k];
    }
    return [];
  };

  const mediosPago = pick("medios_pago").length
    ? pick("medios_pago")
    : pick("mediosPago").length
      ? pick("mediosPago")
      : pick("medios").length
        ? pick("medios")
        : [];

  // `detalles` global es stock (`stock_productos`). Otros egresos debe usar
  // solamente la tabla `detalles` expuesta por claves específicas. Si está
  // vacía, el autocompletado queda vacío y permite crear una descripción.
  const detallesEgresos = pickExplicitArray([
    "detalles_egresos",
    "detallesEgresos",
    "detalles_egreso",
    "detallesEgreso",
    "detalles_ingresos",
    "detallesIngresos",
    "detalles_ingreso",
    "detallesIngreso",
  ]);

  const clasificaciones = pick("clasificaciones").length
    ? pick("clasificaciones")
    : pick("clasificacion").length
      ? pick("clasificacion")
      : [];
  return {
    medios_pago: Array.isArray(mediosPago) ? mediosPago : [],
    detalles: Array.isArray(detallesEgresos) ? detallesEgresos : [],
    clasificaciones: Array.isArray(clasificaciones) ? clasificaciones : [],
  };
}
function resolveClasificacionesConfig(arr = []) {
  const parsed = arr
    .map((x) => ({ id: getClasificacionId(x), nombre: normalizeName(optionLabel(x)) }))
    .filter((x) => Number.isFinite(Number(x.id)) && Number(x.id) > 0);
  const fijo = parsed.find((x) => x.nombre === "COSTO FIJO") || parsed.find((x) => x.nombre.includes("COSTO FIJO")) || null;
  const noFijo =
    parsed.find(
      (x) =>
        x.id !== fijo?.id &&
        (x.nombre === "COSTO VARIABLE" || x.nombre.includes("VARIABLE") || x.nombre.includes("NO ES COSTO FIJO"))
    ) || parsed.find((x) => x.id !== fijo?.id) || null;
  return {
    idCostoFijo: String(fijo?.id ?? 1),
    idNoCostoFijo: String(noFijo?.id ?? 2),
    labelCostoFijo: "COSTO FIJO",
    labelNoCostoFijo: "COSTO VARIABLE",
  };
}

/* Auth */
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
    const c = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(c))) idUsuario = Number(c);
  } catch {}
  return { sessionKey, token, idUsuario };
}
function buildAuthHeaders(isJson = true) {
  const { sessionKey, token } = getAuthInfo();
  const h = {};
  if (isJson) h["Content-Type"] = "application/json";
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Respuesta inválida del servidor.`);
  }
  if (!res.ok || data?.exito === false) throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  return data;
}
async function apiGet(url) {
  const r = await otrosEgresosFetch(url, { method: "GET", headers: buildAuthHeaders(false) });
  return await parseJsonOrThrow(r);
}
async function apiPostForm(url, fd) {
  const r = await otrosEgresosFetch(url, { method: "POST", headers: buildAuthHeaders(false), body: fd });
  return await parseJsonOrThrow(r);
}

/* Filas */
function buildEmptyRow() {
  return {
    id: uid(),
    id_detalle: NULL_OPTION,
    detalle: "",
    cantidad: 1,
    precio: 0,
    precioDraft: "",
    precioFocused: false,
    ivaPct: 0,
    stock_disponible: null,
    sinStock: false,
  };
}
function buildRowFromData(r) {
  return {
    id: uid(),
    id_detalle: String(getDetalleId(r) ?? ""),
    detalle: safeStr(r?.detalle ?? r?.descripcion ?? r?.concepto),
    cantidad: Math.max(1, safeNumber(r?.cantidad || 1)),
    precio: safeNumber(r?.precio ?? r?.importe ?? r?.monto ?? 0),
    precioDraft: "",
    precioFocused: false,
    ivaPct: safeNumber(r?.iva_pct ?? r?.ivaPct ?? 0),
    stock_disponible: null,
    sinStock: false,
  };
}
function buildRowsFromInitial(data) {
  const items =
    Array.isArray(data?.items) && data.items.length
      ? data.items
      : Array.isArray(data?.detalles) && data.detalles.length
        ? data.detalles
        : null;
  if (items?.length) {
    return items.map((x) => ({
      id: uid(),
      id_detalle: String(getDetalleId(x) ?? ""),
      detalle: safeStr(x?.detalle ?? x?.descripcion ?? x?.concepto ?? x?.detalle_nombre ?? ""),
      cantidad: Math.max(1, safeNumber(x?.cantidad || 1)),
      precio: safeNumber(x?.precio ?? x?.importe ?? x?.monto ?? 0),
      precioDraft: "",
      precioFocused: false,
      ivaPct: safeNumber(x?.iva_pct ?? x?.ivaPct ?? 0),
      stock_disponible: null,
      sinStock: false,
    }));
  }
  return [buildRowFromData(data)];
}
function describeLineProblem(r, idx) {
  const detalle = safeStr(r.detalle),
    qty = safeNumber(r.cantidad),
    price = safeNumber(r.precio),
    total = safeNumber(r.total);
  const touched = detalle !== "" || String(r.id_detalle || "").trim() !== "" || qty !== 0 || price !== 0;
  if (!touched) return null;
  const issues = [];
  if (!detalle) issues.push("falta la descripción");
  if (!(Number.isFinite(qty) && qty > 0)) issues.push("la cantidad debe ser > 0");
  if (!(Number.isFinite(price) && price > 0)) issues.push("el importe debe ser > 0");
  if (!(Number.isFinite(total) && total > 0)) issues.push("el total queda en 0");
  if (!issues.length) return null;
  return `Fila ${idx}: ${issues.join(", ")}.`;
}

/* Medios de pago */
function buildEmptyMedioPago() {
  return {
    id: uid(),
    id_medio_pago: NULL_OPTION,
    monto: 0,
    montoDraft: "",
    montoFocused: false,
    id_cheque: [],
    chequesDisponibles: [],
    loadingCheques: false,
    chequesMaxKey: null,
    chequesTipoCargado: null,
  };
}

function isMedioPagoRowTouched(mp) {
  const idMedio = String(mp?.id_medio_pago ?? "").trim();
  const montoDraft = String(mp?.montoDraft ?? "").trim();
  const monto = safeNumber(mp?.monto);
  const cheques = Array.isArray(mp?.id_cheque) ? mp.id_cheque : (mp?.id_cheque ? [mp.id_cheque] : []);
  return idMedio !== NULL_OPTION || monto > 0 || montoDraft !== "" || cheques.length > 0;
}
function buildMediosPagoFromInitial(data) {
  const detalle = Array.isArray(data?.medios_pago_detalle) ? data.medios_pago_detalle : [];
  if (detalle.length) {
    const rows = [];
    let currentChequeRow = null;
    detalle.forEach((mp) => {
      const idMedio = String(mp?.id_medio_pago ?? ""),
        idCheque = Number(mp?.id_cheque ?? 0),
        chequeTipo = safeStr(mp?.cheque_tipo).toLowerCase();
      if (idCheque > 0) {
        const canMerge =
          currentChequeRow &&
          String(currentChequeRow.id_medio_pago) === idMedio &&
          String(currentChequeRow._chequeTipo || "") === chequeTipo;
        if (!canMerge) {
          currentChequeRow = {
            ...buildEmptyMedioPago(),
            id_medio_pago: idMedio,
            monto: 0,
            id_cheque: [],
            chequesDisponibles: [],
            _chequeTipo: chequeTipo,
          };
          rows.push(currentChequeRow);
        }
        currentChequeRow.id_cheque.push(String(idCheque));
        currentChequeRow.monto += safeNumber(mp?.monto ?? mp?.cheque_importe ?? 0);
        currentChequeRow.chequesDisponibles.push({
          id_cheque: idCheque,
          tipo: chequeTipo,
          emisor: safeStr(mp?.emisor),
          numero_cheque: safeStr(mp?.numero_cheque),
          fecha_emision: safeStr(mp?.fecha_emision),
          fecha_pago: safeStr(mp?.fecha_pago),
          importe: safeNumber(mp?.cheque_importe ?? mp?.monto),
        });
      } else {
        rows.push({ ...buildEmptyMedioPago(), id_medio_pago: idMedio, monto: safeNumber(mp?.monto) });
        currentChequeRow = null;
      }
    });
    return rows.map(({ _chequeTipo, ...rest }) => rest);
  }
  const legacyId = Number(data?.id_medio_pago ?? data?.medio_pago_id ?? 0),
    legacyMonto = safeNumber(data?.monto_total ?? data?.total ?? 0);
  if (legacyId > 0) return [{ ...buildEmptyMedioPago(), id_medio_pago: String(legacyId), monto: legacyMonto }];
  return [buildEmptyMedioPago()];
}

/* ─────────────────────────────────────────
   SUB-COMPONENTES
───────────────────────────────────────── */

function ChequesCarteraCards({ cheques, idsSeleccionados, onToggle, esEcheq = false }) {
  if (!Array.isArray(cheques) || cheques.length === 0) return null;

  return (
    <div className="gm-checks-list">
      {cheques.map((ch, idx) => {
        const checked = idsSeleccionados.includes(String(ch?.id_cheque));
        return (
          <div
            key={ch?.id_cheque || idx}
            className={`gm-check-item ${checked ? "gm-check-item--selected" : ""} ${esEcheq ? "gm-check-item--echeck" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onToggle(String(ch?.id_cheque || ""))}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") onToggle(String(ch?.id_cheque || ""));
            }}
          >
            <div className="gm-check-main">
              <div className="gm-check-top">
                <span className="gm-check-number">N° {safeText(ch?.numero_cheque)}</span>
                {esEcheq && <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>}
              </div>
              <div className="gm-check-meta">
                <span className="gm-check-issuer" title={safeText(ch?.emisor)}>{safeText(ch?.emisor)}</span>
                <span className="gm-check-separator">·</span>
                <span>Pago: {formatFechaDMY(ch?.fecha_pago)}</span>
              </div>
            </div>
            <span className="gm-check-amount">{moneyARS(ch?.importe || 0)}</span>

            <div className="gm-check-icon gm-check-icon--corner gm-check-icon--echeck gm-check-icon--check">
              {checked && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MedioPagoRow({ row, mediosPagoList, totalEgreso, sumaMediosPago, onUpdate, onRemove, onLoadCheques, saving }) {
  const mpSeleccionado = useMemo(
    () => mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(row.id_medio_pago ?? "")) || null,
    [mediosPagoList, row.id_medio_pago]
  );

  const tipoCheque = useMemo(
    () => normalizeChequeTipoFromMedio(mpSeleccionado?.nombre || ""),
    [mpSeleccionado]
  );
  const esCheque = tipoCheque !== null;
  const esEcheq = tipoCheque === "echeq";
  const chequesSeleccionados = useMemo(() => getChequeIdsArray(row.id_cheque), [row.id_cheque]);

  const importeCheques = useMemo(() => {
    if (!esCheque || !chequesSeleccionados.length) return 0;
    return chequesSeleccionados.reduce((acc, idStr) => {
      const ch = Array.isArray(row.chequesDisponibles)
        ? row.chequesDisponibles.find((x) => String(x?.id_cheque) === idStr)
        : null;
      return acc + (ch ? safeNumber(ch?.importe) : 0);
    }, 0);
  }, [esCheque, chequesSeleccionados, row.chequesDisponibles]);

  const montoActual = esCheque ? importeCheques : safeNumber(row.monto);

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - montoActual);
    return Math.max(0, safeNumber(totalEgreso) - sumaOtros);
  }, [sumaMediosPago, totalEgreso, montoActual]);

  const puedeCompletarRestante = !esCheque && totalEgreso > 0 && restanteParaEstaFila > 0.009;

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(val));
      const tipo = normalizeChequeTipoFromMedio(mp?.nombre || "");

      onUpdate(row.id, {
        id_medio_pago: val,
        id_cheque: [],
        chequesDisponibles: [],
        loadingCheques: false,
        chequesMaxKey: null,
        chequesTipoCargado: tipo || null,
        monto: tipo !== null ? 0 : safeNumber(row.monto),
        montoDraft: "",
        montoFocused: false,
      });
    },
    [mediosPagoList, onUpdate, row.id, row.monto]
  );

  useEffect(() => {
    if (!esCheque || !tipoCheque) return;

    const maxImporte = Math.max(0, safeNumber(restanteParaEstaFila));
    const maxKey = `${tipoCheque}:${Math.round(maxImporte * 100) / 100}`;

    if (maxImporte <= 0.009) {
      if (row.chequesMaxKey !== maxKey || row.loadingCheques || chequesSeleccionados.length > 0 || (Array.isArray(row.chequesDisponibles) && row.chequesDisponibles.length > 0)) {
        onUpdate(row.id, {
          id_cheque: [],
          chequesDisponibles: [],
          loadingCheques: false,
          chequesMaxKey: maxKey,
          chequesTipoCargado: tipoCheque,
          monto: 0,
          montoDraft: "",
          montoFocused: false,
        });
      }
      return;
    }

    if (row.loadingCheques || row.chequesMaxKey === maxKey) return;

    onUpdate(row.id, { loadingCheques: true, chequesTipoCargado: tipoCheque });
    onLoadCheques?.(row.id, tipoCheque, { maxImporte, maxKey });
  }, [
    esCheque,
    tipoCheque,
    restanteParaEstaFila,
    row.id,
    row.loadingCheques,
    row.chequesMaxKey,
    row.chequesDisponibles,
    row.id_cheque,
    onLoadCheques,
    onUpdate,
    chequesSeleccionados.length,
  ]);

  const handleToggleCheque = useCallback(
    (idChequeStr) => {
      const current = getChequeIdsArray(row.id_cheque);
      const next = current.includes(idChequeStr)
        ? current.filter((x) => x !== idChequeStr)
        : [...current, idChequeStr];
      onUpdate(row.id, { id_cheque: next });
    },
    [row.id, row.id_cheque, onUpdate]
  );

  useEffect(() => {
    if (esCheque && chequesSeleccionados.length > 0) {
      onUpdate(row.id, { monto: importeCheques, montoDraft: "", montoFocused: false });
    }
  }, [esCheque, chequesSeleccionados.length, importeCheques, onUpdate, row.id]);

  return (
    <div className="gm-payment-card">
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select
            className="gm-input gm-select"
            value={String(row.id_medio_pago || "")}
            onChange={(e) => handleChangeMedio(e.target.value)}
            disabled={saving}
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
          <label className={`gm-label${row.id_medio_pago ? " gm-label--up" : ""}`}>Medio de pago</label>
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
              if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
              onUpdate(row.id, { montoFocused: true, montoDraft: formatEditableMoney(montoActual) });
              setTimeout(() => e.target.select(), 0);
            }}
            onChange={(e) => {
              if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
              const c = e.target.value.replace(/[^\d,.\-]/g, "");
              onUpdate(row.id, { montoDraft: c, monto: parseMoneyInputARS(c) });
            }}
            onBlur={() => {
              if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
              const p = parseMoneyInputARS(row.montoDraft);
              onUpdate(row.id, { monto: p, montoDraft: "", montoFocused: false });
            }}
            onKeyDown={(e) => {
              if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            placeholder="$ 0,00"
            disabled={saving || (esCheque && chequesSeleccionados.length > 0)}
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
              disabled={!puedeCompletarRestante || saving}
              title="Completar importe restante"
            >
              ↓ Rest.
            </button>
          )}
          <button type="button" className="gm-payment-delete" onClick={() => onRemove(row.id)} title="Quitar" disabled={saving}>
            ×
          </button>
        </div>
      </div>

      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 12 }} />
            {esEcheq ? "eCheqs en cartera" : "Cheques en cartera"}
          </div>

          {row.loadingCheques ? (
            <div className="gm-payment-checks-loading">
              <FontAwesomeIcon icon={faCircleNotch} spin style={{ marginRight: 6 }} />
              Cargando...
            </div>
          ) : !Array.isArray(row.chequesDisponibles) || row.chequesDisponibles.length === 0 ? (
            <div className="gm-payment-checks-empty">No hay {esEcheq ? "eCheqs" : "cheques"} activos en cartera.</div>
          ) : (
            <ChequesCarteraCards
              cheques={row.chequesDisponibles}
              idsSeleccionados={chequesSeleccionados}
              onToggle={handleToggleCheque}
              esEcheq={esEcheq}
            />
          )}

          {chequesSeleccionados.length > 0 && (
            <div className="gm-upload-card__sub">
              ✓ {chequesSeleccionados.length} cheque(s) — {moneyARS(importeCheques)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanelMediosPagoInlineCompraGlobal({
  mediosFilas,
  mediosPagoList,
  totalCompra,
  onUpdate,
  onRemove,
  onAdd,
  showToast,
  saving = false,
  apiGet,
  BASE_URL: baseUrlCompra,
  chequesAction = "mov_global_cheques_cartera_listar",
}) {
  const filas = Array.isArray(mediosFilas) && mediosFilas.length ? mediosFilas : [buildEmptyMedioPago()];

  const handleLoadCheques = useCallback(
    async (rowId, tipo, options = {}) => {
      try {
        const sp = new URLSearchParams();
        sp.set("action", chequesAction);
        sp.set("tipo", tipo);
        const maxImporte = safeNumber(options?.maxImporte ?? totalCompra);
        if (maxImporte > 0) sp.set("max_importe", String(maxImporte));
        const data = await apiGet(`${baseUrlCompra}/api.php?${sp.toString()}`);
        const rowActual = filas.find((x) => x.id === rowId) || null;
        const cheques = Array.isArray(data?.cheques) ? data.cheques : [];
        const idsDisponibles = new Set(cheques.map((ch) => String(ch?.id_cheque || "")).filter(Boolean));
        const idsActuales = getChequeIdsArray(rowActual?.id_cheque);
        const idsValidos = idsActuales.filter((id) => idsDisponibles.has(String(id)));

        onUpdate(rowId, {
          id_cheque: idsValidos,
          chequesDisponibles: cheques,
          loadingCheques: false,
          chequesMaxKey: options?.maxKey || `${tipo}:${Math.round(maxImporte * 100) / 100}`,
          chequesTipoCargado: tipo,
          ...(idsValidos.length === 0 ? { monto: 0, montoDraft: "", montoFocused: false } : {}),
        });
      } catch (e) {
        const maxImporte = safeNumber(options?.maxImporte ?? totalCompra);
        onUpdate(rowId, {
          id_cheque: [],
          chequesDisponibles: [],
          loadingCheques: false,
          chequesMaxKey: options?.maxKey || `${tipo}:${Math.round(maxImporte * 100) / 100}`,
          chequesTipoCargado: tipo,
          monto: 0,
          montoDraft: "",
          montoFocused: false,
        });
        showToast?.("error", e?.message || "No se pudieron cargar los cheques.", 4000);
      }
    },
    [apiGet, baseUrlCompra, chequesAction, filas, onUpdate, showToast, totalCompra]
  );

  const sumaMediosPago = useMemo(
    () => filas.reduce((a, r) => a + safeNumber(r?.monto), 0),
    [filas]
  );
  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(totalCompra) - sumaMediosPago),
    [totalCompra, sumaMediosPago]
  );

  return (
    <>
      {filas.map((mp) => (
        <MedioPagoRow
          key={mp.id}
          row={mp}
          mediosPagoList={mediosPagoList}
          totalEgreso={totalCompra}
          sumaMediosPago={sumaMediosPago}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onLoadCheques={handleLoadCheques}
          saving={saving}
        />
      ))}

      <div className="gm-payment-totals">
        <span className="gm-payment-totals-assigned">Asignado: <b>{moneyARS(sumaMediosPago)}</b></span>
        {diferenciaRestante > 0.01 && <span className="gm-payment-totals-missing">Falta: {moneyARS(diferenciaRestante)}</span>}
        {diferenciaRestante <= 0.01 && safeNumber(totalCompra) > 0 && <span className="gm-payment-totals-ok">✓ Cubierto</span>}
      </div>

      <button type="button" className="gm-payment-btn" onClick={onAdd} disabled={saving}>
        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> Agregar otro medio
      </button>
    </>
  );
}

export default function ModalNuevoEgreso({
  open,
  mode = "create",
  initialData = null,
  lists,
  onClose,
  onToast,
  onSubmit,
  onSaved,
}) {
  const API_UPLOAD = `${BASE_URL}/api.php?action=otros_egresos_comprobantes_vincular_movimiento_upload`;
  const API_DETALLES_CREAR = `${BASE_URL}/api.php?action=otros_egresos_detalles_crear`;

  const showToast = useCallback((tipo, mensaje, dur = 2800) => onToast?.(tipo, mensaje, dur), [onToast]);

  const [saving, setSaving] = useState(false);
  const [fecha, setFecha] = useState(todayISO);
  const [filters, setFilters] = useState({ id_clasificacion: "" });
  const [rows, setRows] = useState(() => [buildEmptyRow()]);
  const [archivoAdjunto, setArchivoAdjunto] = useState(null);
  const [openVerComp, setOpenVerComp] = useState(false);
  const [compUrl, setCompUrl] = useState("");
  const [mediosFilas, setMediosFilas] = useState(() => [buildEmptyMedioPago()]);
  const [openNuevaDescModal, setOpenNuevaDescModal] = useState(false);
  const [currentRowIdForNewDesc, setCurrentRowIdForNewDesc] = useState(null);

  const rowsContainerRef = useRef(null);
  const [hasScroll, setHasScroll] = useState(false);
  const closeBtnRef = useRef(null);
  const prevOpenRef = useRef(false);
  const fechaInputRef = useRef(null);
  const fileInputRef = useRef(null);

  const localLists = useMemo(() => normalizeLists(lists), [lists]);
  const mediosPagoList = useMemo(
    () => filtrarMediosPagoPorPlan(Array.isArray(localLists.medios_pago) ? localLists.medios_pago : []),
    [localLists.medios_pago]
  );
  const detallesList = useMemo(() => (Array.isArray(localLists.detalles) ? localLists.detalles : []), [localLists.detalles]);
  const clasificacionesList = useMemo(
    () => (Array.isArray(localLists.clasificaciones) ? localLists.clasificaciones : []),
    [localLists.clasificaciones]
  );
  const clasificacionConfig = useMemo(() => resolveClasificacionesConfig(clasificacionesList), [clasificacionesList]);

  const enhancedDetallesList = useMemo(
    () => [{ id: "new_option", __isNewOption: true, nombre: "+ Agregar nueva descripción" }, ...detallesList],
    [detallesList]
  );

  const isCostoFijoChecked = String(filters.id_clasificacion) === String(clasificacionConfig.idCostoFijo);
  const isNoCostoFijoChecked = String(filters.id_clasificacion) === String(clasificacionConfig.idNoCostoFijo);

  useEffect(() => {
    if (!open) return;
    const p = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = p;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      // Si hay un modal hijo abierto, el Escape debe cerrar primero ese modal hijo
      // y no el modal completo de Nuevo egreso.
      if (e.key === "Escape" && !saving && !openVerComp && !openNuevaDescModal) onClose?.();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose, saving, openVerComp, openNuevaDescModal]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;
    if (!wasOpen && open) {
      const isEdit = mode === "edit";
      setFecha(safeStr(initialData?.fecha).slice(0, 10) || todayISO());
      setFilters({ id_clasificacion: String(initialData?.id_clasificacion ?? initialData?.clasificacion_id ?? "") });
      setRows(isEdit && (getMovimientoId(initialData) || initialData) ? buildRowsFromInitial(initialData) : [buildEmptyRow()]);
      setMediosFilas(
        isEdit && (getMovimientoId(initialData) || initialData) ? buildMediosPagoFromInitial(initialData) : [buildEmptyMedioPago()]
      );
      setArchivoAdjunto(null);
      setOpenVerComp(false);
      if (compUrl) URL.revokeObjectURL(compUrl);
      setCompUrl("");
      setSaving(false);
      setTimeout(() => closeBtnRef.current?.focus(), 0);
    }
  }, [open, mode, initialData, compUrl]);

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

  useEffect(() => {
    return () => {
      if (compUrl) URL.revokeObjectURL(compUrl);
    };
  }, [compUrl]);

  const handleOpenFilePicker = useCallback(() => {
    if (!saving) fileInputRef.current?.click();
  }, [saving]);

  const handleFileSelected = useCallback((e) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      setArchivoAdjunto(null);
      setOpenVerComp(false);
      if (compUrl) URL.revokeObjectURL(compUrl);
      setCompUrl("");
      return;
    }

    if (!isAllowedComprobanteFile(file)) {
      showToast(
        "advertencia",
        "Archivo inválido. Solo se permiten imágenes o archivos PDF.",
        4200
      );
      setArchivoAdjunto(null);
      setOpenVerComp(false);
      if (compUrl) URL.revokeObjectURL(compUrl);
      setCompUrl("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setArchivoAdjunto(file);
    setOpenVerComp(false);
    if (compUrl) URL.revokeObjectURL(compUrl);
    setCompUrl("");
  }, [compUrl, showToast]);

  const handleOpenVerComprobante = useCallback(() => {
    if (!archivoAdjunto) return;
    if (compUrl) URL.revokeObjectURL(compUrl);
    const url = URL.createObjectURL(archivoAdjunto);
    setCompUrl(url);
    setOpenVerComp(true);
  }, [archivoAdjunto, compUrl]);

  const handleCloseVerComprobante = useCallback(() => {
    setOpenVerComp(false);
    if (compUrl) {
      URL.revokeObjectURL(compUrl);
      setCompUrl("");
    }
  }, [compUrl]);

  const addRow = useCallback(() => setRows((p) => [...p, buildEmptyRow()]), []);
  const removeRow = useCallback((id) => setRows((p) => {
    const n = p.filter((r) => r.id !== id);
    return n.length ? n : [buildEmptyRow()];
  }), []);
  const updateRow = useCallback((id, patch) => setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);

  const addMedioPago = useCallback(() => setMediosFilas((p) => [...p, buildEmptyMedioPago()]), []);
  const removeMedioPago = useCallback((id) => setMediosFilas((p) => {
    const n = p.filter((r) => r.id !== id);
    return n.length ? n : [buildEmptyMedioPago()];
  }), []);
  const updateMedioPago = useCallback((id, patch) => setMediosFilas((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);

  const handleCrearNuevaDescripcion = useCallback((rowId) => {
    setCurrentRowIdForNewDesc(rowId);
    setOpenNuevaDescModal(true);
  }, []);

  const handleGuardarNuevaDescripcion = useCallback(
    async (nombreDescripcion) => {
      try {
        const { sessionKey, token, idUsuario } = getAuthInfo();
        const h = { "Content-Type": "application/json" };
        if (sessionKey) h["X-Session"] = sessionKey;
        if (token) h.Authorization = `Bearer ${token}`;
        const response = await otrosEgresosFetch(API_DETALLES_CREAR, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ nombre: nombreDescripcion, idUsuario }),
        });
        const data = await parseJsonOrThrow(response);
        const detalleCreado = data?.detalle || data?.item;
        if (data.exito && detalleCreado) {
          const precio = safeNumber(detalleCreado?.precio || 0);
          updateRow(currentRowIdForNewDesc, {
            id_detalle: String(detalleCreado.id_detalle || detalleCreado.id || ""),
            detalle: detalleCreado.nombre || nombreDescripcion,
            precio,
            stock_disponible: null,
            sinStock: false,
            cantidad: 1,
          });
          showToast("exito", "Descripción creada y seleccionada correctamente.", 2500);
          return true;
        }
        throw new Error(data.mensaje || "Error al crear la descripción");
      } catch (error) {
        showToast("error", error.message || "No se pudo crear la descripción.", 3000);
        return false;
      }
    },
    [API_DETALLES_CREAR, currentRowIdForNewDesc, updateRow, showToast]
  );

  const handleSelectDetalle = useCallback(
    (item, rowId) => {
      if (item && item.__isNewOption) {
        handleCrearNuevaDescripcion(rowId);
        return;
      }
      const precio = safeNumber(item?.precio || 0);
      updateRow(rowId, {
        id_detalle: String(getDetalleId(item) ?? ""),
        detalle: optionLabel(item),
        precio,
        stock_disponible: null,
        sinStock: false,
        cantidad: 1,
      });
    },
    [updateRow, showToast, handleCrearNuevaDescripcion]
  );

  const handleCantidadChange = useCallback(
    (rowId, newCantidad) => {
      const row = rows.find((r) => r.id === rowId);
      if (!row) return;
      let cantidadFinal = newCantidad === "" ? "" : Number(newCantidad);
      if (typeof cantidadFinal === "number" && cantidadFinal < 0) cantidadFinal = 0;
      updateRow(rowId, { cantidad: cantidadFinal });
    },
    [rows, updateRow, showToast]
  );

  const handleOpenDate = useCallback(
    (e) => {
      if (saving) return;
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const input = fechaInputRef.current;
      if (!input) return;
      input.focus();
      try {
        if (typeof input.showPicker === "function") input.showPicker();
        else input.click();
      } catch {
        input.click();
      }
    },
    [saving]
  );

  const handleFechaChange = useCallback((e) => {
    const nuevaFecha = String(e.target.value || "").trim();

    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.", 3000);
      return;
    }

    setFecha(nuevaFecha);
  }, [showToast]);

  const rowsCalc = useMemo(
    () =>
      rows.map((r) => {
        const cantidad = Math.max(0, safeNumber(r.cantidad)),
          precio = Math.max(0, safeNumber(r.precio)),
          ivaPct = Math.max(0, safeNumber(r.ivaPct));
        const subtotal = cantidad * precio,
          ivaMonto = subtotal * (ivaPct / 100),
          total = subtotal + ivaMonto;
        return { ...r, subtotal, ivaMonto, total };
      }),
    [rows]
  );

  const resumen = useMemo(
    () => ({
      subtotal: rowsCalc.reduce((a, r) => a + safeNumber(r.subtotal), 0),
      iva: rowsCalc.reduce((a, r) => a + safeNumber(r.ivaMonto), 0),
      total: rowsCalc.reduce((a, r) => a + safeNumber(r.total), 0),
    }),
    [rowsCalc]
  );

  const mediosFilasActivas = useMemo(() => mediosFilas.filter(isMedioPagoRowTouched), [mediosFilas]);
  const sumaMediosPago = useMemo(() => mediosFilasActivas.reduce((a, r) => a + safeNumber(r.monto), 0), [mediosFilasActivas]);

  const validate = useCallback(() => {
    const clas = Number(filters.id_clasificacion);
    if (!Number.isFinite(clas) || clas <= 0) return { ok: false, msg: "Debés indicar si el egreso es costo fijo o costo variable." };
    if (!safeStr(fecha)) return { ok: false, msg: "Falta la fecha." };

    if (fecha > todayISO()) {
      return { ok: false, msg: "La fecha no puede ser posterior al día actual." };
    }

    for (let i = 0; i < mediosFilasActivas.length; i++) {
      const mp = mediosFilasActivas[i];
      if (!mp.id_medio_pago || mp.id_medio_pago === NULL_OPTION)
        return { ok: false, msg: `Medio de pago ${i + 1}: falta seleccionar el medio.` };
      if (safeNumber(mp.monto) <= 0) return { ok: false, msg: `Medio de pago ${i + 1}: el monto debe ser mayor a 0.` };
      const mpRow = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago));
      const tipoCheque = normalizeChequeTipoFromMedio(mpRow?.nombre || "");
      if (tipoCheque !== null) {
        const sel = Array.isArray(mp.id_cheque) ? mp.id_cheque : [];
        if (!sel.length)
          return {
            ok: false,
            msg: `Medio de pago ${i + 1}: debés seleccionar al menos un ${tipoCheque === "echeq" ? "eCheq" : "cheque"} en cartera.`,
          };
      }
    }
    // Otros egresos es contado: debe quedar pagado como mínimo por el total.
    // Se permite superar el total cuando el usuario usa un cheque/eCheq de mayor importe.
    if (sumaMediosPago + 0.05 < resumen.total && resumen.total > 0)
      return {
        ok: false,
        msg: `La suma de los medios de pago (${moneyARS(sumaMediosPago)}) debe cubrir el total del egreso (${moneyARS(resumen.total)}).`,
      };
    const problems = [];
    rowsCalc.forEach((r, i) => {
      const p = describeLineProblem(r, i + 1);
      if (p) problems.push(p);
    });
    const usable = rowsCalc.filter(
      (r) => safeStr(r.detalle) !== "" && Number(r.id_detalle || 0) > 0 && safeNumber(r.cantidad) > 0 && safeNumber(r.precio) > 0 && safeNumber(r.total) > 0
    );
    if (!usable.length) {
      if (problems.length) {
        const msg = problems.slice(0, 2).join(" ");
        const extra = problems.length > 2 ? ` (y ${problems.length - 2} más)` : "";
        return { ok: false, msg: `No hay filas válidas. ${msg}${extra}` };
      }
      return { ok: false, msg: "Cargá al menos 1 fila válida (Descripción + Cantidad + Importe)." };
    }
    if (problems.length) {
      const msg = problems.slice(0, 2).join(" ");
      const extra = problems.length > 2 ? ` (y ${problems.length - 2} más)` : "";
      return {
        ok: false,
        msg: `Completá o eliminá las filas incompletas antes de guardar. ${msg}${extra}`,
      };
    }
    return { ok: true, usable };
  }, [filters, fecha, rowsCalc, mediosFilasActivas, mediosPagoList, resumen.total, sumaMediosPago]);

  const buildPayload = useCallback(() => {
    const usableRows = rowsCalc.filter(
      (r) => safeStr(r.detalle) !== "" && Number(r.id_detalle || 0) > 0 && safeNumber(r.cantidad) > 0 && safeNumber(r.precio) > 0 && safeNumber(r.total) > 0
    );
    const detalleFinal =
      usableRows.length === 1 ? safeStr(usableRows[0].detalle) : usableRows.map((x) => safeStr(x.detalle)).filter(Boolean).join(" | ");
    const subtotalFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.subtotal), 0);
    const ivaFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.ivaMonto), 0);
    const totalFinal = usableRows.reduce((acc, x) => acc + safeNumber(x.total), 0);
    const movId = getMovimientoId(initialData);
    const mediosPagoPayload = mediosFilasActivas.flatMap((mp) => {
      const chequesSeleccionados = Array.isArray(mp.id_cheque) ? mp.id_cheque : [];
      const mpRow = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago));
      const tipoCheque = normalizeChequeTipoFromMedio(mpRow?.nombre || "");
      if (tipoCheque !== null && chequesSeleccionados.length > 0) {
        return chequesSeleccionados.map((idChequeStr) => {
          const ch = mp.chequesDisponibles.find((x) => String(x.id_cheque) === idChequeStr);
          return {
            id_medio_pago: Number(mp.id_medio_pago),
            monto: Number(ch?.importe || 0),
            id_cheque: Number(idChequeStr),
            cheque_tipo: tipoCheque,
          };
        });
      }
      return [{ id_medio_pago: Number(mp.id_medio_pago), monto: safeNumber(mp.monto) }];
    });
    const primerMedio = mediosPagoPayload[0] || null;
    const medioLegacy =
      primerMedio && Number(primerMedio.id_medio_pago) > 0
        ? mediosPagoList.find((x) => Number(getMedioPagoId(x)) === Number(primerMedio.id_medio_pago))
        : null;
    return {
      ...(movId ? { id_movimiento: movId, id_egreso: movId, id: movId } : {}),
      fecha: safeStr(fecha).slice(0, 10),
      id_medio_pago: primerMedio ? Number(primerMedio.id_medio_pago) : null,
      medio_pago_nombre: optionLabel(medioLegacy),
      medios_pago: mediosPagoPayload,
      id_clasificacion: Number(filters.id_clasificacion),
      clasificacion_nombre: isCostoFijoChecked
        ? clasificacionConfig.labelCostoFijo.toUpperCase()
        : isNoCostoFijoChecked
          ? clasificacionConfig.labelNoCostoFijo.toUpperCase()
          : "",
      detalle: detalleFinal,
      descripcion: detalleFinal,
      concepto: detalleFinal,
      cantidad: usableRows.length === 1 ? safeNumber(usableRows[0].cantidad) : 1,
      precio: usableRows.length === 1 ? safeNumber(usableRows[0].precio) : safeNumber(subtotalFinal),
      subtotal: safeNumber(subtotalFinal),
      iva_monto: safeNumber(ivaFinal),
      monto_total: safeNumber(totalFinal),
      total: safeNumber(totalFinal),
      total_general: safeNumber(totalFinal),
      items: usableRows.map((x, idx) => ({
        orden: idx + 1,
        id_detalle: Number(x.id_detalle || 0) || null,
        id_stock_producto: null,
        detalle: safeStr(x.detalle),
        descripcion: safeStr(x.detalle),
        concepto: safeStr(x.detalle),
        cantidad: safeNumber(x.cantidad),
        precio: safeNumber(x.precio),
        iva_pct: safeNumber(x.ivaPct),
        subtotal: safeNumber(x.subtotal),
        iva_monto: safeNumber(x.ivaMonto),
        total: safeNumber(x.total),
      })),
    };
  }, [rowsCalc, initialData, fecha, filters, mediosFilasActivas, mediosPagoList, clasificacionConfig, isCostoFijoChecked, isNoCostoFijoChecked]);

  const subirArchivo = useCallback(
    async (idMovimiento, archivo) => {
      if (!archivo || !idMovimiento) return null;
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("tipo", "OTRO_EGRESO");
      fd.append("id_movimiento", String(idMovimiento));
      fd.append("force_replace", "1");
      return await apiPostForm(API_UPLOAD, fd);
    },
    [API_UPLOAD]
  );

  const submit = useCallback(async () => {
    if (saving) return;
    if (typeof onSubmit !== "function") {
      showToast("error", "Falta la función de guardado del modal.", 4200);
      return;
    }
    const v = validate();
    if (!v.ok) {
      showToast("advertencia", v.msg || "Faltan datos.", 4200);
      return;
    }
    if (archivoAdjunto && !isAllowedComprobanteFile(archivoAdjunto)) {
      showToast("advertencia", "Archivo inválido. Solo se permiten imágenes o archivos PDF.", 4200);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      const data = await onSubmit(payload, mode === "edit");
      const idMovimientoFinal = getSavedMovimientoIdFromResponse(data, initialData);
      if (!idMovimientoFinal) throw new Error("El backend no devolvió un id_movimiento válido.");
      let warningArchivo = "";
      if (archivoAdjunto) {
        try {
          const r = await subirArchivo(idMovimientoFinal, archivoAdjunto);
          if (!r?.exito) warningArchivo = r?.mensaje || "No se pudo vincular el archivo.";
        } catch (e) {
          warningArchivo = e?.message || "No se pudo vincular el archivo.";
        }
      }
      if (warningArchivo) showToast("advertencia", `Egreso guardado, pero el archivo no se pudo vincular: ${warningArchivo}`, 7000);
      await onSaved?.({ ...(data || {}), id_movimiento: idMovimientoFinal });
    } catch (e) {
      showToast("error", e?.message || "No se pudo guardar el egreso.", 4500);
    } finally {
      setSaving(false);
    }
  }, [saving, onSubmit, validate, buildPayload, mode, onSaved, showToast, initialData, archivoAdjunto, subirArchivo]);

  if (!open) return null;

  const btnLabel = saving ? "Procesando..." : mode === "edit" ? "Guardar cambios" : "Guardar egreso";

  return createPortal(
    <>
      <div className="gm-modal-overlay">
        <div
          className="gm-modal-container gm-modal-container--movement gm-modal-v2 oe-modal"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faPlus} />
            </div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">{mode === "edit" ? "Editar Egreso" : "Nuevo Egreso"}</h2>
            </div>
            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={() => !saving && onClose?.()}
              aria-label="Cerrar"
              disabled={saving}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="gm-modal-content">
            <div className="gm-movement-layout">
              <section className="gm-movement-main gm-table gm-table--movement oe-table">
                <div className={`gm-table-head${hasScroll ? " gm-table-head--body-scroll" : ""}`}>
                  <div className="gm-table-th" style={{ paddingLeft: 10 }}>Descripción</div>
                  <div className="gm-table-th">Cant.</div>
                  <div className="gm-table-th right">Importe</div>
                  <div className="gm-table-th">IVA %</div>
                  <div className="gm-table-th right">IVA $</div>
                  <div className="gm-table-th right">Total</div>
                  <div className="gm-table-th" />
                </div>

                <div ref={rowsContainerRef} className={`gm-table-body${hasScroll ? " has-scroll" : ""}`}>
                  {rowsCalc.map((r) => {
                    return (
                      <div key={r.id} className="gm-table-row">
                        <div className="gm-table-cell gm-table-cell--detail">
                          <GlobalAutocomplete
                            value={r.detalle}
                            onChange={(val) => updateRow(r.id, { detalle: val, id_detalle: NULL_OPTION, stock_disponible: null, sinStock: false })}
                            onSelect={(item) => handleSelectDetalle(item, r.id)}
                            options={enhancedDetallesList}
                            getOptionLabel={(d) => {
                              if (d && d.__isNewOption) return d.nombre;
                              return optionLabel(d);
                            }}
                            getOptionValue={(d) => {
                              if (d && d.__isNewOption) return "__new_option__";
                              return String(getDetalleId(d) ?? optionLabel(d));
                            }}
                            placeholder="Escribí o buscá una descripción…"
                            disabled={saving}
                            showAllOnFocus={true}
                            maxItems={18}
                            inputClassName="gm-cell-input"
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--center stock_cant">
                          <input
                            className="gm-cell-input gm-cell-input--center"
                            type="number"
                            min="1"
                            step="1"
                            value={r.cantidad}
                            onChange={(e) => handleCantidadChange(r.id, e.target.value === "" ? "" : Number(e.target.value))}
                            disabled={saving}
                            placeholder=""
                            title=""
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          <input
                            className="gm-cell-input gm-cell-input--right"
                            type="text"
                            inputMode="decimal"
                            value={r.precioFocused ? r.precioDraft ?? "" : formatMoneyInputARS(r.precio)}
                            onFocus={(e) => {
                              updateRow(r.id, {
                                precioFocused: true,
                                precioDraft: formatEditableMoney(r.precio),
                              });
                              setTimeout(() => e.target.select(), 0);
                            }}
                            onChange={(e) => {
                              const c = e.target.value.replace(/[^\d,.\-]/g, "");
                              updateRow(r.id, {
                                precioDraft: c,
                                precio: parseMoneyInputARS(c),
                              });
                            }}
                            onBlur={() => {
                              const p = parseMoneyInputARS(r.precioDraft);
                              updateRow(r.id, {
                                precio: p,
                                precioDraft: "",
                                precioFocused: false,
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const p = parseMoneyInputARS(r.precioDraft);
                                updateRow(r.id, {
                                  precio: p,
                                  precioDraft: "",
                                  precioFocused: false,
                                });
                                e.currentTarget.blur();
                              }
                            }}
                            placeholder="$ 0,00"
                            disabled={saving}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div className="gm-table-cell gm-table-cell--center">
                          <select
                            className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                            value={String(r.ivaPct)}
                            onChange={(e) => updateRow(r.id, { ivaPct: Number(e.target.value) })}
                            onKeyDown={(e) => {
                              if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
                            }}
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

                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">{moneyARS(r.ivaMonto)}</div>
                        <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">{moneyARS(r.total)}</div>
                        <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                          <button type="button" className="gm-row-delete" onClick={() => removeRow(r.id)} disabled={saving} title="Eliminar fila">
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
                      </span>Agregar fila
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

              <div className="gm-movement-side">
                <aside className="gm-aside">
                  <div className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Datos del egreso</span>
                    </div>
                    <div className="gm-section-body">
                      <div className="gm-field" onClick={handleOpenDate}>
                        <input
                          ref={fechaInputRef}
                          className="gm-input"
                          type="date"
                          placeholder=" "
                          value={fecha}
                          max={todayISO()}
                          onChange={handleFechaChange}
                          disabled={saving}
                        />
                        <label className="gm-label" onClick={handleOpenDate}>
                          Fecha
                        </label>
                      </div>

                      <div className="gm-field">
                        <select
                          className="gm-input gm-select"
                          value={String(filters.id_clasificacion || "")}
                          onChange={(e) => setFilters((p) => ({ ...p, id_clasificacion: e.target.value }))}
                          disabled={saving}
                        >
                          <option value="">Seleccionar...</option>
                          <option value={String(clasificacionConfig.idCostoFijo)}>
                            {clasificacionConfig.labelCostoFijo}
                          </option>
                          <option value={String(clasificacionConfig.idNoCostoFijo)}>
                            {clasificacionConfig.labelNoCostoFijo}
                          </option>
                        </select>
                        <label className="gm-label" style={{ pointerEvents: "none" }}>
                          Clasificación *
                        </label>
                      </div>

                      <PanelMediosPagoInlineCompraGlobal
                        mediosFilas={mediosFilas}
                        mediosPagoList={mediosPagoList}
                        totalCompra={resumen.total}
                        onUpdate={updateMedioPago}
                        onRemove={removeMedioPago}
                        onAdd={addMedioPago}
                        showToast={showToast}
                        saving={saving}
                        apiGet={apiGet}
                        BASE_URL={BASE_URL}
                        chequesAction="mov_global_cheques_cartera_listar"
                      />
                      <div className="gm-upload-card">
                        <div className="gm-upload-card__head">
                          <div className="gm-upload-card__title">Comprobante</div>
                          <div className="gm-upload-card__sub">Seleccioná, visualizá o quitá el archivo antes de guardar</div>
                        </div>

                        <div className="gm-upload-card__body">
                          <div className={`gm-upload-file${archivoAdjunto ? " is-filled" : " is-empty"}`}>
                            {archivoAdjunto ? (
                              <>
                                <div className="gm-upload-file__icon">
                                  <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                </div>

                                <div className="gm-upload-file__meta">
                                  <div className="gm-upload-file__name" title={NOMBRE_COMPROBANTE_GENERICO}>
                                    {NOMBRE_COMPROBANTE_GENERICO}
                                  </div>
                                </div>

                                <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="gm-upload-btn gm-upload-btn--ghost"
                                    onClick={handleOpenVerComprobante}
                                    disabled={saving}
                                    title="Ver comprobante"
                                  >
                                    <FontAwesomeIcon icon={faEye} />
                                  </button>

                                  <button
                                    type="button"
                                    className="gm-upload-btn gm-upload-btn--ghost"
                                    onClick={() => {
                                      setArchivoAdjunto(null);
                                      if (fileInputRef.current) fileInputRef.current.value = "";
                                      setOpenVerComp(false);
                                      if (compUrl) URL.revokeObjectURL(compUrl);
                                      setCompUrl("");
                                    }}
                                    disabled={saving || openVerComp}
                                    title="Quitar archivo"
                                  >
                                    <FontAwesomeIcon icon={faTrash} />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="gm-upload-file__empty">No hay comprobante seleccionado</div>
                            )}
                          </div>

                          <div className="gm-upload-bar" style={{ marginTop: 10 }}>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*,application/pdf,.pdf"
                              className="gm-upload-bar__input"
                              onChange={handleFileSelected}
                              disabled={saving}
                              style={{ display: "none" }}
                            />

                            <button
                              type="button"
                              className="gm-upload-btn gm-upload-btn--primary"
                              onClick={handleOpenFilePicker}
                              disabled={saving}
                            >
                              <FontAwesomeIcon icon={faUpload} /> {archivoAdjunto ? "Reemplazar archivo" : "Seleccionar archivo"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
                <div className="gm-actions gm-actions--sticky">
                  <button type="button" className="gm-action-btn gm-action-btn--save" onClick={submit} disabled={saving}>
                    {btnLabel}
                  </button>
                  <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={() => !saving && onClose?.()} disabled={saving}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {openNuevaDescModal && (
        <ModalNuevaDescripcion
          open={openNuevaDescModal}
          onClose={() => setOpenNuevaDescModal(false)}
          onSave={handleGuardarNuevaDescripcion}
        />
      )}

      <ModalVerComprobante
        open={openVerComp}
        url={compUrl}
        mime={archivoAdjunto?.type || ""}
        fileName={NOMBRE_COMPROBANTE_GENERICO}
        onClose={handleCloseVerComprobante}
        title={NOMBRE_COMPROBANTE_GENERICO}
      />
    </>,
    document.body
  );
}
