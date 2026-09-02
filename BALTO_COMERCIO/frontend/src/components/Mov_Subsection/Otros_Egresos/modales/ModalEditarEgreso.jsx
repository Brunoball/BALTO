import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import BASE_URL from "../../../../config/config.jsx";
import GlobalAutocomplete from "../../../Global/GlobalAutocomplete/GlobalAutocomplete.jsx";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import "./ModalEgreso.css";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileInvoiceDollar,
  faEye,
  faTrash,
  faUpload,
  faUndo,
  faPenToSquare,
  faPlus,
  faMoneyCheckDollar,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";
import { otrosEgresosFetch } from "../api/otrosEgresosApi.js";

/* ─── IVA options ─── */
const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

const NOMBRE_COMPROBANTE_GENERICO = "Comprobante adjunto";
const NULL_OPTION = "";

/* ─── Pure helpers ─── */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function safeNumber(v) {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function round3(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;
}
function safeText(v) {
  return String(v ?? "").trim();
}
function upperText(v) {
  return String(v ?? "").toUpperCase();
}
function upperSafeText(v) {
  return safeText(v).toUpperCase();
}
function normalizeName(v) {
  return String(v ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }

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
    .replace(/[̀-ͯ]/g, "")
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
function getChequeIdsArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v == null || v === "") return [];
  return [String(v)];
}
function getDetalleId(d) {
  const c =
    d?.id ?? d?.id_detalle ?? d?.idDetalle ?? d?.detalle_id ??
    d?.id_categoria_egreso ?? d?.idCategoriaEgreso ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getMedioPagoId(c) {
  const cand = c?.id ?? c?.id_medio_pago ?? c?.idMedioPago ?? c?.medio_pago_id ?? null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function optionLabel(x) {
  return String(x?.nombre ?? x?.categoria ?? x?.descripcion ?? x?.detalle ?? "").trim();
}
function calcItemTotals(cantidad, precio, ivaPct) {
  const c = Math.max(0, safeNumber(cantidad));
  const p = Math.max(0, safeNumber(precio));
  const iva = Math.max(0, safeNumber(ivaPct));
  const subtotal = c * p;
  const iva_monto = subtotal * (iva / 100);
  const total = subtotal + iva_monto;
  return {
    subtotal: round2(subtotal),
    iva_monto: round2(iva_monto),
    total: round2(total),
  };
}
function normalizeDetalles(lists) {
  const src = lists && typeof lists === "object" ? lists : {};
  const l = src?.listas && typeof src.listas === "object" ? src.listas : src;

  // `detalles` global es stock (`stock_productos`). Otros egresos debe usar
  // solamente la tabla `detalles` expuesta por claves específicas.
  let raw = [];
  for (const key of [
    "detalles_egresos",
    "detallesEgresos",
    "detalles_egreso",
    "detallesEgreso",
    "detalles_ingresos",
    "detallesIngresos",
    "detalles_ingreso",
    "detallesIngreso",
  ]) {
    if (Array.isArray(l?.[key])) {
      raw = l[key];
      break;
    }
  }

  return raw.map((x) => ({
    id: Number(x?.id ?? x?.id_detalle ?? 0),
    nombre: String(x?.nombre ?? x?.descripcion ?? x?.detalle ?? "").trim(),
  }));
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
function normalizeClasificaciones(lists) {
  const raw = Array.isArray(lists?.clasificaciones)
    ? lists.clasificaciones
    : Array.isArray(lists?.clasificacion)
      ? lists.clasificacion
      : [];
  return raw.map((x) => ({
    id: Number(x?.id ?? x?.id_clasificacion ?? 0),
    nombre: String(x?.nombre ?? x?.descripcion ?? x?.detalle ?? "").trim(),
  }));
}
function resolveCostoFijoConfig(clasificaciones = []) {
  const arr = Array.isArray(clasificaciones) ? clasificaciones : [];
  const fijo =
    arr.find((x) => normalizeName(x?.nombre) === "COSTO FIJO") ||
    arr.find((x) => normalizeName(x?.nombre).includes("COSTO FIJO")) ||
    null;
  const noFijo =
    arr.find(
      (x) =>
        x.id !== fijo?.id &&
        (normalizeName(x?.nombre) === "COSTO VARIABLE" ||
          normalizeName(x?.nombre).includes("VARIABLE") ||
          normalizeName(x?.nombre).includes("NO ES COSTO FIJO"))
    ) ||
    arr.find((x) => x.id !== fijo?.id) ||
    null;
  return {
    idCostoFijo: String(Number(fijo?.id ?? 1) || 1),
    idNoCostoFijo: String(Number(noFijo?.id ?? 2) || 2),
    labelCostoFijo: "COSTO FIJO",
    labelNoCostoFijo: "COSTO VARIABLE",
  };
}
function normalizeDateISO(...values) {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const ar = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
    if (ar) return `${ar[3]}-${ar[2]}-${ar[1]}`;
  }
  return "";
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
    chequesCarteraCargados: false,
    chequesMaxKey: null,
    chequesTipoCargado: null,
    // En edición, cuando el movimiento ya tiene cheque/eCheq vinculado,
    // se muestra solamente ese cheque y NO se vuelve a listar toda la cartera.
    soloChequeVinculado: false,
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
    const chequeRows = new Map();

    detalle.forEach((mp) => {
      const idMedio = String(mp?.id_medio_pago ?? "");
      const idCheque = Number(mp?.id_cheque ?? 0);
      const chequeTipo = safeText(mp?.cheque_tipo || mp?.tipo_cheque || mp?.tipo || "").toLowerCase();
      const idMovimientoMedioPago = Number(mp?.id_movimiento_medio_pago ?? mp?.id_movimiento_medio ?? mp?.id ?? 0) || null;

      if (idCheque > 0) {
        const key = `${idMedio}|${chequeTipo || "cheque"}`;

        if (!chequeRows.has(key)) {
          const chequeRow = {
            ...buildEmptyMedioPago(),
            id_medio_pago: idMedio,
            monto: 0,
            id_cheque: [],
            chequesDisponibles: [],
            loadingCheques: false,
            // CLAVE: ya tenemos el cheque del movimiento. En editar no hay que traer toda la cartera.
            chequesCarteraCargados: true,
            soloChequeVinculado: true,
            id_movimiento_medio_pago: idMovimientoMedioPago,
          };
          chequeRows.set(key, chequeRow);
          rows.push(chequeRow);
        }

        const currentChequeRow = chequeRows.get(key);
        const idChequeStr = String(idCheque);

        if (!currentChequeRow.id_cheque.includes(idChequeStr)) {
          currentChequeRow.id_cheque.push(idChequeStr);
        }

        const importeCheque = safeNumber(mp?.cheque_importe ?? mp?.importe ?? mp?.monto);
        currentChequeRow.monto = round2(safeNumber(currentChequeRow.monto) + importeCheque);

        if (!currentChequeRow.chequesDisponibles.some((ch) => String(ch?.id_cheque) === idChequeStr)) {
          currentChequeRow.chequesDisponibles.push({
            id_cheque: idCheque,
            tipo: chequeTipo,
            emisor: safeText(mp?.emisor ?? mp?.cheque_emisor),
            numero_cheque: safeText(mp?.numero_cheque ?? mp?.cheque_numero),
            fecha_emision: normalizeDateISO(mp?.fecha_emision ?? mp?.cheque_fecha_emision),
            fecha_pago: normalizeDateISO(mp?.fecha_pago ?? mp?.cheque_fecha_pago),
            importe: importeCheque,
          });
        }
      } else {
        rows.push({
          ...buildEmptyMedioPago(),
          id_medio_pago: idMedio,
          monto: safeNumber(mp?.monto),
          id_movimiento_medio_pago: idMovimientoMedioPago,
        });
      }
    });

    return rows;
  }

  const legacyId = Number(data?.id_medio_pago ?? data?.medio_pago_id ?? 0);
  const legacyMonto = safeNumber(data?.monto_total ?? data?.total ?? 0);
  if (legacyId > 0) {
    return [{ ...buildEmptyMedioPago(), id_medio_pago: String(legacyId), monto: legacyMonto }];
  }

  return [buildEmptyMedioPago()];
}

function normalizeChequeData(src = {}) {
  const cheque = src?.cheque && typeof src.cheque === "object" ? src.cheque : src;
  return {
    id_cheque: Number(cheque?.id_cheque ?? cheque?.cheque_id ?? src?.id_cheque ?? src?.cheque_id ?? 0) || 0,
    tipo: String(cheque?.tipo ?? cheque?.cheque_tipo ?? src?.cheque_tipo ?? "").trim().toLowerCase(),
    fecha_emision: normalizeDateISO(
      cheque?.fecha_emision,
      cheque?.cheque_fecha_emision,
      src?.cheque_fecha_emision,
      src?.fecha_emision
    ),
    emisor: upperSafeText(cheque?.emisor ?? cheque?.cheque_emisor ?? src?.cheque_emisor ?? ""),
    numero_cheque: upperSafeText(cheque?.numero_cheque ?? cheque?.cheque_numero ?? src?.cheque_numero ?? ""),
    importe: round2(safeNumber(cheque?.importe ?? cheque?.cheque_importe ?? src?.cheque_importe ?? src?.monto_total ?? 0)),
    fecha_pago: normalizeDateISO(
      cheque?.fecha_pago,
      cheque?.cheque_fecha_pago,
      src?.cheque_fecha_pago,
      src?.fecha_pago
    ),
  };
}
function makeItem(it = {}) {
  const cantidad = round3(it?.cantidad ?? 1);
  const precio = round2(it?.precio ?? it?.total ?? 0);
  const iva_pct = round2(it?.iva_pct ?? 0);
  const calc = calcItemTotals(cantidad, precio, iva_pct);
  return {
    uid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    id_detalle: String(Number(it?.id_detalle ?? 0) || ""),
    detalle: upperSafeText(it?.detalle ?? it?.descripcion ?? it?.concepto ?? it?.detalle_nombre ?? ""),
    cantidad,
    precio,
    precioDraft: "",
    precioFocused: false,
    iva_pct,
    stock_disponible: null,
    sinStock: false,
    subtotal: round2(it?.subtotal ?? calc.subtotal),
    iva_monto: round2(it?.iva_monto ?? calc.iva_monto),
    total: round2(it?.total ?? calc.total),
  };
}
function buildInitialState(data, clasificaciones = []) {
  const src = data && typeof data === "object" ? data : {};
  const cheque = normalizeChequeData(src);
  const esMovimientoCheque = cheque.id_cheque > 0;
  const rawItems = Array.isArray(src.items) && src.items.length ? src.items : [src];
  const items = rawItems
    .map((it) => makeItem(it))
    .filter((it) => Number(it.cantidad) > 0 && (Number(it.precio) > 0 || Number(it.total) > 0));
  const { idCostoFijo } = resolveCostoFijoConfig(clasificaciones);
  const idClasifActual = String(Number(src?.id_clasificacion ?? src?.clasificacion_id ?? 0) || "");
  const esCostoFijoInicial =
    !!src?.es_costo_fijo || (!!idClasifActual && idClasifActual === String(idCostoFijo));
  return {
    id_movimiento: Number(src?.id_movimiento ?? src?.id ?? 0) || 0,
    fecha: String(src?.fecha ?? "").slice(0, 10),
    id_medio_pago: String(Number(src?.id_medio_pago ?? 0) || ""),
    id_clasificacion: esCostoFijoInicial ? String(idCostoFijo) : "",
    es_costo_fijo: esCostoFijoInicial,
    es_movimiento_cheque: esMovimientoCheque,
    cheque,
    items: items.length
      ? items
      : [makeItem({ cantidad: 1, precio: Number(src?.monto_total ?? 0) || 0 })],
    medios: buildMediosPagoFromInitial(src),
  };
}
function sumTotalItems(items) {
  return round2(
    (Array.isArray(items) ? items : []).reduce((acc, it) => acc + safeNumber(it?.total), 0)
  );
}
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
    const cand = u?.idUsuarioMaster ?? u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
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
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}. ${text.slice(0, 300)}`);
  }
}

// Nombre visual genérico para no mostrar el nombre real del archivo al usuario.
function resolveNombreComprobante() {
  return NOMBRE_COMPROBANTE_GENERICO;
}

function fileAcceptText() {
  return "image/*,application/pdf,.pdf";
}

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

/* ─────────────────────────────────────────
   CHEQUE TABLE — estética de tabla
───────────────────────────────────────── */
function ChequeFields({ cheque, saving, onUpdate }) {
  const fechaEmisionRef = useRef(null);
  const fechaPagoRef = useRef(null);

  const openPicker = useCallback((ref) => {
    const el = ref?.current;
    if (!el || saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }, [saving]);

  const tipoActual =
    cheque?.tipo === "echeq"
      ? "ECHEQ"
      : cheque?.tipo === "cheque"
        ? "CHEQUE"
        : "";

  return (
    <div className="gm-table-body" style={{ overflowX: "auto", overflowY: "hidden" }}>
      <div
        className="gm-table-head--cheque"
        style={{
          display: "grid",
          gridTemplateColumns: "110px 120px 1.2fr 1.2fr 150px 150px 140px",
        }}
      >
        <div>ID</div>
        <div>Tipo</div>
        <div>Emisor</div>
        <div>N° cheque</div>
        <div>F. emisión</div>
        <div>F. pago</div>
        <div className="right">Importe</div>
      </div>

      <div
        className="gm-table-row--cheque"
        style={{
          display: "grid",
          gridTemplateColumns: "110px 120px 1.2fr 1.2fr 150px 150px 140px",
        }}
      >
        <div className="gm-table-cell">
          <input
            className="gm-cell-input"
            value={String(cheque?.id_cheque || "")}
            disabled
          />
        </div>

        <div className="gm-table-cell">
          <input
            className="gm-cell-input"
            value={tipoActual}
            disabled
          />
        </div>

        <div className="gm-table-cell">
          <input
            className="gm-cell-input"
            type="text"
            value={cheque?.emisor || ""}
            onChange={(e) => onUpdate("emisor", upperText(e.target.value))}
            disabled={saving}
            placeholder="Emisor"
            style={{ textTransform: "uppercase" }}
          />
        </div>

        <div className="gm-table-cell">
          <input
            className="gm-cell-input"
            type="text"
            value={cheque?.numero_cheque || ""}
            onChange={(e) => onUpdate("numero_cheque", upperText(e.target.value))}
            disabled={saving}
            placeholder="Número"
            style={{ textTransform: "uppercase" }}
          />
        </div>

        <div
          className="gm-table-cell"
          onClick={() => openPicker(fechaEmisionRef)}
          style={{ cursor: saving ? "not-allowed" : "pointer" }}
        >
          <input
            ref={fechaEmisionRef}
            className="gm-cell-input"
            type="date"
            value={cheque?.fecha_emision || ""}
            max={todayISO()}
            onChange={(e) => {
              const nuevaFecha = e.target.value;
              if (nuevaFecha && nuevaFecha > todayISO()) return;
              onUpdate("fecha_emision", nuevaFecha);
            }}
            disabled={saving}
            onClick={(e) => {
              e.stopPropagation();
              openPicker(fechaEmisionRef);
            }}
          />
        </div>

        <div
          className="gm-table-cell"
          onClick={() => openPicker(fechaPagoRef)}
          style={{ cursor: saving ? "not-allowed" : "pointer" }}
        >
          <input
            ref={fechaPagoRef}
            className="gm-cell-input"
            type="date"
            value={cheque?.fecha_pago || ""}
            onChange={(e) => {
              onUpdate("fecha_pago", e.target.value);
            }}
            disabled={saving}
            onClick={(e) => {
              e.stopPropagation();
              openPicker(fechaPagoRef);
            }}
          />
        </div>

        <div className="gm-table-cell gm-table-cell--right">
          <input
            className="gm-cell-input gm-cell-input--right"
            type="number"
            min="0"
            step="0.01"
            value={cheque?.importe ?? 0}
            onChange={(e) => onUpdate("importe", e.target.value)}
            disabled={saving}
            placeholder="0,00"
          />
        </div>
      </div>
    </div>
  );
}

function ChequesCarteraCards({
  cheques,
  idsSeleccionados,
  onToggle,
  esEcheq = false,
  soloLectura = false,
}) {
  if (!Array.isArray(cheques) || cheques.length === 0) return null;

  return (
    <div className="gm-checks-list">
      {cheques.map((ch, idx) => {
        const idChequeStr = String(ch?.id_cheque || "");
        const checked = idsSeleccionados.includes(idChequeStr);

        const handleSelect = () => {
          if (soloLectura) return;
          onToggle?.(idChequeStr);
        };

        return (
          <div
            key={ch?.id_cheque || idx}
            className={`gm-check-item ${checked ? "gm-check-item--selected" : ""} ${esEcheq ? "gm-check-item--echeck" : ""}`}
            role={soloLectura ? undefined : "button"}
            tabIndex={soloLectura ? undefined : 0}
            onClick={handleSelect}
            onKeyDown={(e) => {
              if (soloLectura) return;
              if (e.key === " " || e.key === "Enter") handleSelect();
            }}
            style={soloLectura ? { cursor: "default" } : undefined}
          >
            <div className="gm-check-main">
              <div className="gm-check-top">
                <span className="gm-check-number">N° {safeText(ch?.numero_cheque) || "-"}</span>
                {esEcheq && <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>}
              </div>
              <div className="gm-check-meta">
                <span className="gm-check-issuer" title={safeText(ch?.emisor) || "-"}>
                  {safeText(ch?.emisor) || "-"}
                </span>
                <span className="gm-check-separator">·</span>
                <span>Pago: {formatFechaDMY(ch?.fecha_pago)}</span>
              </div>
            </div>

            <span className="gm-check-amount">{moneyARS(ch?.importe || 0)}</span>

            {!soloLectura && (
              <div className="gm-check-icon gm-check-icon--corner gm-check-icon--echeck gm-check-icon--check">
                {checked && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            )}
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
  const soloChequeVinculado = !!row.soloChequeVinculado;
  const chequesSeleccionados = useMemo(() => getChequeIdsArray(row.id_cheque), [row.id_cheque]);

  const chequesAMostrar = useMemo(() => {
    const disponibles = Array.isArray(row.chequesDisponibles) ? row.chequesDisponibles : [];
    if (!soloChequeVinculado) return disponibles;

    const ids = new Set(chequesSeleccionados.map(String));
    return disponibles.filter((ch) => ids.has(String(ch?.id_cheque)));
  }, [row.chequesDisponibles, soloChequeVinculado, chequesSeleccionados]);

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

  // `restanteParaEstaFila` representa el importe objetivo de esta fila, no
  // cuánto falta sumar. Al reemplazar un cheque por otro medio, el monto
  // actual puede cubrir ya ese objetivo y "Rest." debe quedar deshabilitado.
  const puedeCompletarRestante =
    !esCheque &&
    safeNumber(totalEgreso) > 0 &&
    restanteParaEstaFila - montoActual > 0.009;

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(getMedioPagoId(x) ?? "") === String(val));
      const tipo = normalizeChequeTipoFromMedio(mp?.nombre || "");

      onUpdate(row.id, {
        id_medio_pago: val,
        id_cheque: [],
        chequesDisponibles: [],
        loadingCheques: false,
        chequesCarteraCargados: false,
        soloChequeVinculado: false,
        chequesMaxKey: null,
        chequesTipoCargado: tipo || null,
        monto: tipo !== null ? 0 : safeNumber(row.monto),
        montoDraft: "",
        montoFocused: false,
      });
    },
    [mediosPagoList, onUpdate, row.id, row.monto]
  );

  const handleToggleCheque = useCallback(
    (idChequeStr) => {
      if (soloChequeVinculado) return;

      const current = getChequeIdsArray(row.id_cheque);
      const next = current.includes(idChequeStr)
        ? current.filter((x) => x !== idChequeStr)
        : [...current, idChequeStr];

      onUpdate(row.id, { id_cheque: next });
    },
    [row.id, row.id_cheque, onUpdate, soloChequeVinculado]
  );

  useEffect(() => {
    if (esCheque && chequesSeleccionados.length > 0) {
      onUpdate(row.id, { monto: importeCheques, montoDraft: "", montoFocused: false });
    }
  }, [esCheque, chequesSeleccionados.length, importeCheques, onUpdate, row.id]);

  useEffect(() => {
    if (!esCheque || !tipoCheque) return;

    const disponibles = Array.isArray(row.chequesDisponibles) ? row.chequesDisponibles : [];
    const idsSeleccionados = getChequeIdsArray(row.id_cheque);
    const tieneChequePrecargado =
      idsSeleccionados.length > 0 &&
      idsSeleccionados.every((id) => disponibles.some((ch) => String(ch?.id_cheque) === String(id)));

    // Si el egreso viene de edición y ya trae el cheque vinculado dentro de medios_pago_detalle,
    // se muestra solo ese cheque. Si el usuario cambia el medio de pago, soloChequeVinculado vuelve a false.
    if (tieneChequePrecargado && !row.chequesMaxKey && !row.chequesCarteraCargados) {
      onUpdate(row.id, {
        loadingCheques: false,
        chequesCarteraCargados: true,
        soloChequeVinculado: true,
      });
      return;
    }

    if (soloChequeVinculado) return;

    const maxImporte = Math.max(0, safeNumber(restanteParaEstaFila));
    const maxKey = `${tipoCheque}:${Math.round(maxImporte * 100) / 100}`;

    if (maxImporte <= 0.009) {
      if (row.chequesMaxKey !== maxKey || row.loadingCheques || idsSeleccionados.length > 0 || disponibles.length > 0) {
        onUpdate(row.id, {
          id_cheque: [],
          chequesDisponibles: [],
          loadingCheques: false,
          chequesCarteraCargados: true,
          soloChequeVinculado: false,
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

    onUpdate(row.id, { loadingCheques: true, chequesCarteraCargados: false, chequesTipoCargado: tipoCheque });
    onLoadCheques?.(row.id, tipoCheque, {
      includeIds: idsSeleccionados,
      onlySelected: false,
      maxImporte,
      maxKey,
    });
  }, [
    esCheque,
    tipoCheque,
    soloChequeVinculado,
    row.loadingCheques,
    row.chequesCarteraCargados,
    row.chequesMaxKey,
    row.chequesDisponibles,
    row.id,
    row.id_cheque,
    restanteParaEstaFila,
    onLoadCheques,
    onUpdate,
  ]);

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
            {soloChequeVinculado
              ? esEcheq ? "eCheq vinculado" : "Cheque vinculado"
              : esEcheq ? "eCheqs en cartera" : "Cheques en cartera"}
          </div>

          {row.loadingCheques ? (
            <div className="gm-payment-checks-loading">
              <FontAwesomeIcon icon={faCircleNotch} spin style={{ marginRight: 6 }} />
              Cargando...
            </div>
          ) : !Array.isArray(chequesAMostrar) || chequesAMostrar.length === 0 ? (
            <div className="gm-payment-checks-empty">
              {soloChequeVinculado
                ? `No se encontró el ${esEcheq ? "eCheq" : "cheque"} vinculado.`
                : `No hay ${esEcheq ? "eCheqs" : "cheques"} activos en cartera.`}
            </div>
          ) : (
            <ChequesCarteraCards
              cheques={chequesAMostrar}
              idsSeleccionados={chequesSeleccionados}
              onToggle={handleToggleCheque}
              esEcheq={esEcheq}
              soloLectura={soloChequeVinculado}
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

function PanelMediosPagoInlineEgreso({
  mediosFilas,
  mediosPagoList,
  totalEgreso,
  onUpdate,
  onRemove,
  onAdd,
  showToast,
  saving = false,
  apiGet,
  baseUrl,
  chequesAction = "mov_global_cheques_cartera_listar",
}) {
  const filas = Array.isArray(mediosFilas) && mediosFilas.length ? mediosFilas : [buildEmptyMedioPago()];

  const handleLoadCheques = useCallback(
    async (rowId, tipo, options = {}) => {
      const includeIds = getChequeIdsArray(options?.includeIds);
      const onlySelected = !!options?.onlySelected && includeIds.length > 0;

      try {
        const sp = new URLSearchParams();
        sp.set("action", chequesAction);
        sp.set("tipo", tipo);
        const maxImporte = safeNumber(options?.maxImporte ?? totalEgreso);
        if (maxImporte > 0) sp.set("max_importe", String(maxImporte));

        // Cuando el movimiento ya viene con cheque elegido en edición,
        // pedimos solo ese/estos IDs. Si el backend ignora include_ids, igual filtramos abajo.
        if (includeIds.length) sp.set("include_ids", includeIds.join(","));

        const data = await apiGet(`${baseUrl}/api.php?${sp.toString()}`);
        const rowActual = filas.find((x) => x.id === rowId) || null;
        const actuales = Array.isArray(rowActual?.chequesDisponibles) ? rowActual.chequesDisponibles : [];
        const recibidosRaw = Array.isArray(data?.cheques) ? data.cheques : [];
        const idsPermitidos = new Set(includeIds.map(String));

        const actualesFiltrados = onlySelected
          ? actuales.filter((ch) => idsPermitidos.has(String(ch?.id_cheque)))
          : actuales;

        const recibidos = onlySelected
          ? recibidosRaw.filter((ch) => idsPermitidos.has(String(ch?.id_cheque)))
          : recibidosRaw;

        const byId = new Map();
        [...actualesFiltrados, ...recibidos].forEach((ch) => {
          const id = Number(ch?.id_cheque || 0);
          if (id > 0) byId.set(id, ch);
        });

        const cheques = Array.from(byId.values());
        const idsDisponibles = new Set(cheques.map((ch) => String(ch?.id_cheque || "")).filter(Boolean));
        const idsActuales = getChequeIdsArray(rowActual?.id_cheque);
        const idsValidos = idsActuales.filter((id) => idsDisponibles.has(String(id)));

        onUpdate(rowId, {
          id_cheque: idsValidos,
          chequesDisponibles: cheques,
          loadingCheques: false,
          chequesCarteraCargados: true,
          soloChequeVinculado: onlySelected,
          chequesMaxKey: options?.maxKey || `${tipo}:${Math.round(maxImporte * 100) / 100}`,
          chequesTipoCargado: tipo,
          ...(idsValidos.length === 0 && !onlySelected ? { monto: 0, montoDraft: "", montoFocused: false } : {}),
        });
      } catch (e) {
        const rowActual = filas.find((x) => x.id === rowId) || null;
        const actuales = Array.isArray(rowActual?.chequesDisponibles) ? rowActual.chequesDisponibles : [];
        const idsPermitidos = new Set(includeIds.map(String));

        const maxImporte = safeNumber(options?.maxImporte ?? totalEgreso);
        const cheques = onlySelected
          ? actuales.filter((ch) => idsPermitidos.has(String(ch?.id_cheque)))
          : actuales;
        const idsDisponibles = new Set(cheques.map((ch) => String(ch?.id_cheque || "")).filter(Boolean));
        const idsActuales = getChequeIdsArray(rowActual?.id_cheque);
        const idsValidos = idsActuales.filter((id) => idsDisponibles.has(String(id)));

        onUpdate(rowId, {
          id_cheque: idsValidos,
          chequesDisponibles: cheques,
          loadingCheques: false,
          chequesCarteraCargados: true,
          soloChequeVinculado: onlySelected || !!rowActual?.soloChequeVinculado,
          chequesMaxKey: options?.maxKey || `${tipo}:${Math.round(maxImporte * 100) / 100}`,
          chequesTipoCargado: tipo,
          ...(idsValidos.length === 0 && !onlySelected ? { monto: 0, montoDraft: "", montoFocused: false } : {}),
        });

        if (!onlySelected) {
          showToast?.("error", e?.message || "No se pudieron cargar los cheques.", 4000);
        }
      }
    },
    [apiGet, baseUrl, chequesAction, filas, onUpdate, showToast, totalEgreso]
  );

  const sumaMediosPago = useMemo(
    () => filas.reduce((a, r) => a + safeNumber(r?.monto), 0),
    [filas]
  );

  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(totalEgreso) - sumaMediosPago),
    [totalEgreso, sumaMediosPago]
  );

  return (
    <>
      {filas.map((mp) => (
        <MedioPagoRow
          key={mp.id}
          row={mp}
          mediosPagoList={mediosPagoList}
          totalEgreso={totalEgreso}
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
        {diferenciaRestante <= 0.01 && safeNumber(totalEgreso) > 0 && <span className="gm-payment-totals-ok">✓ Cubierto</span>}
      </div>

      <button type="button" className="gm-payment-btn" onClick={onAdd} disabled={saving}>
        <FontAwesomeIcon icon={faPlus} style={{ fontSize: 11 }} /> Agregar otro medio
      </button>
    </>
  );
}

/* ─────────────────────────────────────────
   COMPONENTE PRINCIPAL
───────────────────────────────────────── */
export default function ModalEditarEgreso({
  open,
  initialData,
  lists,
  onClose,
  onToast,
  onSubmit,
  onSaved,
}) {
  const API = `${BASE_URL}/api.php`;
  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => onToast?.(tipo, mensaje, duracion),
    [onToast]
  );

  const [saving, setSaving] = useState(false);
  const [loadingComprobante, setLoadingComprobante] = useState(false);
  const [loadingViewer, setLoadingViewer] = useState(false);

  const clasificaciones = useMemo(() => normalizeClasificaciones(lists), [lists]);
  const clasificacionConfig = useMemo(() => resolveCostoFijoConfig(clasificaciones), [clasificaciones]);
  const detalles = useMemo(() => normalizeDetalles(lists), [lists]);
  const mediosPago = useMemo(() => filtrarMediosPagoPorPlan(normalizeMediosPago(lists)), [lists]);

  const enhancedDetallesList = useMemo(
    () => [{ id: "new_option", __isNewOption: true, nombre: "+ Agregar nueva descripción" }, ...detalles],
    [detalles]
  );

  const [form, setForm] = useState(() => buildInitialState(initialData, clasificaciones));
  const [comprobanteActual, setComprobanteActual] = useState(null);
  const [archivoNuevo, setArchivoNuevo] = useState(null);
  const [marcarEliminarComprobante, setMarcarEliminarComprobante] = useState(false);
  const [openViewer, setOpenViewer] = useState(false);
  const [viewerData, setViewerData] = useState({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });

  const closeBtnRef = useRef(null);
  const inputFileRef = useRef(null);
  const fechaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !saving && !openViewer) onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, saving, onClose, openViewer]);

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setForm(buildInitialState(initialData, clasificaciones));
    setArchivoNuevo(null);
    setMarcarEliminarComprobante(false);
    setComprobanteActual(null);
    setOpenViewer(false);
    setViewerData({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });
    setLoadingViewer(false);
    setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open, initialData, clasificaciones]);

  const cargarInfoComprobante = useCallback(async () => {
    const idMovimiento = Number(initialData?.id_movimiento ?? initialData?.id ?? 0);
    if (!open || !(idMovimiento > 0)) { setComprobanteActual(null); return; }
    setLoadingComprobante(true);
    try {
      const res = await otrosEgresosFetch(
        `${API}?action=otros_egresos_comprobantes_info&id_movimiento=${idMovimiento}`,
        { method: "GET", headers: buildHeadersGET() }
      );
      const data = await parseJsonOrThrow(res);
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      setComprobanteActual(data?.comprobante ?? null);
    } catch (err) {
      setComprobanteActual(null);
      showToast("error", err?.message || "No se pudo obtener el comprobante.", 3500);
    } finally {
      setLoadingComprobante(false);
    }
  }, [API, initialData, open, showToast]);

  useEffect(() => { if (open) cargarInfoComprobante(); }, [open, cargarInfoComprobante]);

  const apiGet = useCallback(async (url) => {
    const res = await otrosEgresosFetch(url, { method: "GET", headers: buildHeadersGET() });
    const data = await parseJsonOrThrow(res);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo obtener la información.");
    return data;
  }, []);

  const updateItem = useCallback((uid, patch) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it) => {
        if (it.uid !== uid) return it;
        const next = { ...it, ...patch };
        const cantidad = round3(safeNumber(next.cantidad));
        const precio = round2(safeNumber(next.precio));
        const iva_pct = round2(safeNumber(next.iva_pct));
        const calc = calcItemTotals(cantidad, precio, iva_pct);
        return {
          ...next,
          cantidad,
          precio,
          iva_pct,
          ...calc,
          detalle: next.detalle ?? it.detalle ?? "",
          id_detalle: next.id_detalle ?? it.id_detalle ?? "",
          stock_disponible: next.stock_disponible !== undefined ? next.stock_disponible : it.stock_disponible,
          sinStock: next.sinStock ?? it.sinStock ?? false,
          precioDraft: next.precioDraft ?? it.precioDraft ?? "",
          precioFocused: next.precioFocused ?? it.precioFocused ?? false,
        };
      }),
    }));
  }, []);

  const handleSelectDetalle = useCallback(
    (item, itemUid) => {
      if (item?.__isNewOption) return;
      const precio = safeNumber(item?.precio || 0);
      updateItem(itemUid, {
        id_detalle: String(getDetalleId(item) ?? ""),
        detalle: upperSafeText(optionLabel(item)),
        precio,
        stock_disponible: null,
        sinStock: false,
        cantidad: 1,
      });
    },
    [updateItem]
  );

  const handleCantidadChange = useCallback(
    (itemUid, newCantidad) => {
      let val = newCantidad === "" ? "" : Number(newCantidad);
      if (typeof val === "number" && val < 0) val = 0;
      updateItem(itemUid, { cantidad: val });
    },
    [updateItem]
  );

  const addItem = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, makeItem({ cantidad: 1, precio: 0, iva_pct: 0 })],
    }));
  }, []);

  const removeItem = useCallback((uid) => {
    setForm((prev) => {
      if ((prev.items || []).length <= 1) return prev;
      return { ...prev, items: prev.items.filter((it) => it.uid !== uid) };
    });
  }, []);

  const updateMedioPago = useCallback((id, patch) => {
    setForm((prev) => ({
      ...prev,
      medios: (prev.medios || []).map((mp) => (mp.id === id ? { ...mp, ...patch } : mp)),
    }));
  }, []);

  const addMedioPago = useCallback(() => {
    setForm((prev) => ({ ...prev, medios: [...(prev.medios || []), buildEmptyMedioPago()] }));
  }, []);

  const removeMedioPago = useCallback((id) => {
    setForm((prev) => {
      const next = (prev.medios || []).filter((mp) => mp.id !== id);
      return { ...prev, medios: next.length ? next : [buildEmptyMedioPago()] };
    });
  }, []);

  const totalGeneral = useMemo(() => {
    if (form.es_movimiento_cheque) return round2(safeNumber(form?.cheque?.importe));
    return sumTotalItems(form.items);
  }, [form]);

  const updateChequeField = useCallback((field, value) => {
    if (field === "fecha_emision" && value && value > todayISO()) {
      showToast("advertencia", "La fecha de emisión no puede ser posterior al día actual.", 3000);
      return;
    }
    setForm((prev) => ({
      ...prev,
      cheque: {
        ...prev.cheque,
        [field]: field === "importe"
          ? round2(safeNumber(value))
          : ["emisor", "numero_cheque"].includes(field)
            ? upperText(value)
            : value,
      },
    }));
  }, [showToast]);

  const openDatePicker = useCallback(() => {
    const el = fechaRef.current;
    if (!el || saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch { el.focus(); }
  }, [saving]);

  const handleFechaChange = useCallback((e) => {
    const nuevaFecha = e.target.value;
    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.", 3000);
      return;
    }
    setForm((p) => ({ ...p, fecha: nuevaFecha }));
  }, [showToast]);

  const mostrarArchivoActual = Boolean(
    (comprobanteActual?.archivo_url || comprobanteActual) &&
      !marcarEliminarComprobante &&
      !archivoNuevo
  );

  const nombreComprobanteVisible = useMemo(() => {
    if (archivoNuevo) return NOMBRE_COMPROBANTE_GENERICO;
    if (marcarEliminarComprobante) return "";
    if (comprobanteActual) return resolveNombreComprobante(comprobanteActual);
    return "";
  }, [archivoNuevo, marcarEliminarComprobante, comprobanteActual]);

  const abrirViewer = useCallback(async () => {
    if (archivoNuevo) {
      setViewerData({
        url: URL.createObjectURL(archivoNuevo),
        mime: archivoNuevo.type || "application/octet-stream",
        title: NOMBRE_COMPROBANTE_GENERICO,
      });
      setOpenViewer(true);
      return;
    }

    if (!comprobanteActual || marcarEliminarComprobante) return;

    const idMovimiento = Number(form.id_movimiento || 0);
    const idComprobante = Number(comprobanteActual?.id_comprobante ?? 0);

    if (!idMovimiento && !idComprobante) return;

    setLoadingViewer(true);
    try {
      const sp = new URLSearchParams();
      sp.set("action", "otros_egresos_comprobantes_descargar");

      if (idComprobante > 0) {
        sp.set("id_comprobante", String(idComprobante));
      } else {
        sp.set("id_movimiento", String(idMovimiento));
      }

      const res = await otrosEgresosFetch(`${API}?${sp.toString()}`, {
        method: "GET",
        headers: buildHeadersGET(),
      });

      const data = await parseJsonOrThrow(res);

      if (!data?.exito) {
        throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      }

      const signedUrl = String(data?.url || "").trim();
      if (!signedUrl) {
        throw new Error("El backend no devolvió la URL del comprobante.");
      }

      setViewerData({
        url: signedUrl,
        mime: safeText(comprobanteActual?.archivo_mime) || "application/octet-stream",
        title: NOMBRE_COMPROBANTE_GENERICO,
      });
      setOpenViewer(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo abrir el comprobante.", 3200);
    } finally {
      setLoadingViewer(false);
    }
  }, [
    API,
    form.id_movimiento,
    archivoNuevo,
    comprobanteActual,
    marcarEliminarComprobante,
    showToast,
  ]);

  const cerrarViewer = useCallback(() => {
    if (viewerData?.url?.startsWith("blob:")) URL.revokeObjectURL(viewerData.url);
    setOpenViewer(false);
    setViewerData({ url: "", mime: "", title: NOMBRE_COMPROBANTE_GENERICO });
  }, [viewerData]);

  const seleccionarArchivo = useCallback((e) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      setArchivoNuevo(null);
      return;
    }

    if (!isAllowedComprobanteFile(file)) {
      showToast(
        "advertencia",
        "Archivo inválido. Solo se permiten imágenes o archivos PDF.",
        4200
      );
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

  const eliminarComprobanteExistente = useCallback(async (idMovimiento) => {
    const res = await otrosEgresosFetch(`${API}?action=otros_egresos_comprobantes_eliminar`, {
      method: "POST",
      headers: buildHeadersJSON(),
      body: JSON.stringify({ id_movimiento: idMovimiento }),
    });
    const data = await parseJsonOrThrow(res);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar el comprobante.");
    return data;
  }, [API]);

  const subirComprobanteNuevo = useCallback(async (idMovimiento, archivo) => {
    const fd = new FormData();
    fd.append("id_movimiento", String(idMovimiento));
    fd.append("archivo", archivo);
    const res = await otrosEgresosFetch(`${API}?action=otros_egresos_comprobantes_vincular_movimiento_upload`, {
      method: "POST",
      headers: buildHeadersFormData(),
      body: fd,
    });
    const data = await parseJsonOrThrow(res);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo subir el comprobante.");
    return data;
  }, [API]);

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    try {
      setSaving(true);
      showToast("cargando", "Actualizando egreso…", 12000);
      const fecha = String(form.fecha || "").trim();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("La fecha es obligatoria.");
      if (fecha > todayISO()) throw new Error("La fecha no puede ser posterior al día actual.");
      if (archivoNuevo && !isAllowedComprobanteFile(archivoNuevo)) {
        throw new Error("Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      }

      let payload;
      if (form.es_movimiento_cheque) {
        const id_cheque = Number(form?.cheque?.id_cheque || 0);
        const fecha_emision = String(form?.cheque?.fecha_emision || "").trim();
        const fecha_pago = String(form?.cheque?.fecha_pago || "").trim();
        const emisor = upperSafeText(form?.cheque?.emisor);
        const numero_cheque = upperSafeText(form?.cheque?.numero_cheque);
        const importe = round2(safeNumber(form?.cheque?.importe));
        if (!(id_cheque > 0)) throw new Error("No se encontró el cheque vinculado.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_emision)) throw new Error("La fecha de emisión del cheque es obligatoria.");
        if (fecha_emision > todayISO()) throw new Error("La fecha de emisión del cheque no puede ser posterior al día actual.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_pago)) throw new Error("La fecha de pago del cheque es obligatoria.");
        if (!emisor) throw new Error("El emisor del cheque es obligatorio.");
        if (!numero_cheque) throw new Error("El número de cheque es obligatorio.");
        if (!(importe > 0)) throw new Error("El importe debe ser mayor a 0.");
        payload = {
          id_movimiento: Number(form.id_movimiento || 0),
          fecha,
          id_cheque,
          cheque_id: id_cheque,
          es_edicion_cheque: true,
          fecha_emision,
          emisor,
          numero_cheque,
          importe,
          fecha_pago,
          monto_total: importe,
        };
      } else {
        const items = (form.items || [])
          .map((it) => {
            const id_detalle = Number(it.id_detalle || 0);
            const detalle = upperSafeText(it.detalle);
            const cantidad = round3(safeNumber(it.cantidad));
            const precio = round2(safeNumber(it.precio));
            const iva_pct = round2(safeNumber(it.iva_pct));
            const calc = calcItemTotals(cantidad, precio, iva_pct);
            return { id_detalle, detalle, cantidad, precio, iva_pct, ...calc };
          })
          .filter((it) => it.id_detalle > 0 && it.cantidad > 0 && it.precio > 0 && it.total > 0);
        if (!items.length) throw new Error("Debés cargar al menos un ítem válido.");

        const mediosEditables = (form.medios || []).filter(isMedioPagoRowTouched);
        const mediosPagoPayload = mediosEditables.flatMap((mp, idx) => {
          const idMedioPago = Number(mp.id_medio_pago || 0);
          const medioRow = mediosPago.find((x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago));
          const tipoCheque = normalizeChequeTipoFromMedio(medioRow?.nombre || "");
          if (!(idMedioPago > 0)) throw new Error(`Medio de pago ${idx + 1}: falta seleccionar el medio.`);

          if (tipoCheque !== null) {
            const chequesSeleccionados = getChequeIdsArray(mp.id_cheque);
            if (!chequesSeleccionados.length) {
              throw new Error(`Medio de pago ${idx + 1}: debés seleccionar al menos un ${tipoCheque === "echeq" ? "eCheq" : "cheque"} en cartera.`);
            }
            return chequesSeleccionados.map((idChequeStr) => {
              const ch = Array.isArray(mp.chequesDisponibles)
                ? mp.chequesDisponibles.find((x) => String(x.id_cheque) === String(idChequeStr))
                : null;
              return {
                id_medio_pago: idMedioPago,
                id_movimiento_medio_pago: mp.id_movimiento_medio_pago || null,
                id_cheque: Number(idChequeStr),
                cheque_tipo: tipoCheque,
                monto: safeNumber(ch?.importe ?? mp.monto),
              };
            });
          }

          const monto = safeNumber(mp.monto);
          if (!(monto > 0)) throw new Error(`Medio de pago ${idx + 1}: el monto debe ser mayor a 0.`);
          return [{
            id_medio_pago: idMedioPago,
            id_movimiento_medio_pago: mp.id_movimiento_medio_pago || null,
            monto,
          }];
        });

        const totalMedios = mediosPagoPayload.reduce((acc, mp) => acc + safeNumber(mp.monto), 0);
        const totalItems = sumTotalItems(items);
        // Otros egresos es contado: debe quedar pagado como mínimo por el total.
        // Se permite superar el total cuando el usuario usa un cheque/eCheq de mayor importe.
        if (totalMedios + 0.05 < totalItems) {
          throw new Error(`La suma de los medios de pago (${moneyARS(totalMedios)}) debe cubrir el total del egreso (${moneyARS(totalItems)}).`);
        }

        const primerMedio = mediosPagoPayload[0] || null;
        payload = {
          id_movimiento: Number(form.id_movimiento || 0),
          fecha,
          id_medio_pago: primerMedio ? Number(primerMedio.id_medio_pago) : null,
          id_clasificacion: form.es_costo_fijo ? Number(clasificacionConfig.idCostoFijo) : null,
          es_costo_fijo: !!form.es_costo_fijo,
          id_detalle: items[0]?.id_detalle ?? null,
          monto_total: totalItems,
          medios_pago: mediosPagoPayload,
          items,
        };
      }

      if (!(payload.id_movimiento > 0)) throw new Error("Falta el ID del egreso a editar.");

      const resp = await onSubmit?.(payload, true);
      const idMovimientoFinal = Number(resp?.id_movimiento ?? resp?.id ?? payload.id_movimiento ?? 0);
      if (!(idMovimientoFinal > 0)) throw new Error("No se pudo determinar el ID del egreso actualizado.");

      if (marcarEliminarComprobante && comprobanteActual && !archivoNuevo) {
        await eliminarComprobanteExistente(idMovimientoFinal);
      }
      if (archivoNuevo) {
        await subirComprobanteNuevo(idMovimientoFinal, archivoNuevo);
      }
      await onSaved?.(resp);
    } catch (err) {
      showToast("error", err?.message || "Error actualizando egreso.", 4200);
      setSaving(false);
    }
  };

  if (!open) return null;

  const esMovCheque = form.es_movimiento_cheque;
  const chequeTitulo = form?.cheque?.tipo === "echeq" ? "Datos del eCheq" : "Datos del cheque";

  const totalIva = (form.items || []).reduce((a, it) => a + safeNumber(it.iva_monto), 0);
  const totalSubtotal = sumTotalItems(form.items) - totalIva;

  const viewerBtnDisabled = saving || loadingViewer;

  return createPortal(
    <>
      <div className="gm-modal-overlay">
        <div
          className="gm-modal-container gm-modal-container--movement gm-modal-v2 oe-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mi-ee-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faPenToSquare} />
            </div>
            <div className="gm-modal-head-left">
              <h2 id="mi-ee-title" className="gm-modal-title">
                {esMovCheque ? "Editar cheque / eCheq" : "Editar egreso"}
              </h2>
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
            <form
              onSubmit={submit}
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              <div className="gm-movement-layout">
                {!esMovCheque ? (
                  <section className="gm-movement-main gm-table gm-table--movement oe-table">
                    <div className="gm-table-head">
                      <div className="gm-table-th" style={{ paddingLeft: 10 }}>Descripción</div>
                      <div className="gm-table-th">Cant.</div>
                      <div className="gm-table-th right">Importe</div>
                      <div className="gm-table-th">IVA %</div>
                      <div className="gm-table-th right">IVA $</div>
                      <div className="gm-table-th right">Total</div>
                      <div className="gm-table-th" />
                    </div>

                    <div className="gm-table-body">
                      {(form.items || []).map((it) => (
                        <div key={it.uid} className="gm-table-row">
                          <div className="gm-table-cell gm-table-cell--detail">
                            <GlobalAutocomplete
                              value={it.detalle}
                              onChange={(val) =>
                                updateItem(it.uid, {
                                  detalle: upperText(val),
                                  id_detalle: "",
                                  stock_disponible: null,
                                  sinStock: false,
                                })
                              }
                              onSelect={(item) => handleSelectDetalle(item, it.uid)}
                              options={enhancedDetallesList}
                              getOptionLabel={(d) => {
                                if (d?.__isNewOption) return d.nombre;
                                return optionLabel(d);
                              }}
                              getOptionValue={(d) => {
                                if (d?.__isNewOption) return "__new_option__";
                                return String(getDetalleId(d) ?? optionLabel(d));
                              }}
                              placeholder="Escribí o buscá una descripción…"
                              disabled={saving}
                              showAllOnFocus={false}
                              maxItems={18}
                              inputClassName="gm-cell-input"
                            />
                          </div>

                          <div className="gm-table-cell gm-table-cell--center stock_cant">
                            <input
                              className="gm-cell-input gm-cell-input--center"
                              type="text"
                              inputMode="decimal"
                              value={it.cantidad}
                              onChange={(e) => handleCantidadChange(it.uid, e.target.value)}
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
                              value={it.precioFocused ? it.precioDraft ?? "" : formatMoneyInputARS(it.precio)}
                              onFocus={(e) => {
                                updateItem(it.uid, {
                                  precioFocused: true,
                                  precioDraft: formatEditableMoney(it.precio),
                                });
                                setTimeout(() => e.target.select(), 0);
                              }}
                              onChange={(e) => {
                                const c = e.target.value.replace(/[^\d,.-]/g, "");
                                updateItem(it.uid, {
                                  precioDraft: c,
                                  precio: parseMoneyInputARS(c),
                                });
                              }}
                              onBlur={() => {
                                const p = parseMoneyInputARS(it.precioDraft);
                                updateItem(it.uid, {
                                  precio: p,
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
                            />
                          </div>

                          <div className="gm-table-cell gm-table-cell--center">
                            <select
                              className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                              value={String(it.iva_pct)}
                              onChange={(e) => updateItem(it.uid, { iva_pct: e.target.value })}
                              onKeyDown={(e) => {
                                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
                                  e.preventDefault();
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

                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                            {moneyARS(it.iva_monto)}
                          </div>

                          <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                            {moneyARS(it.total)}
                          </div>

                          <div className="gm-table-cell gm-table-cell--center" id="delete_cell">
                            <button
                              type="button"
                              className="gm-row-delete"
                              onClick={() => removeItem(it.uid)}
                              disabled={saving || (form.items || []).length <= 1}
                              title="Eliminar ítem"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="gm-table-foot">
                      <div className="gm-foot-actions">
                        <button
                          type="button"
                          className="gm-foot-btn"
                          onClick={addItem}
                          disabled={saving}
                        >
                          <span className="gm-foot-btn__icon">+</span>Agregar ítem
                        </button>
                        <div className="gm-foot-sep" />
                      </div>
                      <div className="gm-summary-chips">
                        <div className="gm-summary-chip gm-summary-chip--sub">
                          <span>Subtotal</span>
                          <b>{moneyARS(totalSubtotal)}</b>
                        </div>
                        <div className="gm-summary-chip gm-summary-chip--iva">
                          <span>IVA</span>
                          <b>{moneyARS(totalIva)}</b>
                        </div>
                        <div className="gm-summary-chip gm-summary-chip--total">
                          <span>Total</span>
                          <b>{moneyARS(totalGeneral)}</b>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="gm-movement-main gm-table gm-table--movement oe-table" style={{ overflow: "hidden" }}>
                    <div className="gm-table-head">
                      <div style={{ paddingLeft: 10 }}>{chequeTitulo}</div>
                    </div>

                    <ChequeFields
                      cheque={form.cheque}
                      saving={saving}
                      onUpdate={updateChequeField}
                    />

                    <div className="gm-table-foot" style={{ justifyContent: "flex-end" }}>
                      <div className="gm-summary-chips">
                        <div className="gm-summary-chip gm-summary-chip--total">
                          <span>Importe del cheque</span>
                          <b>{moneyARS(totalGeneral)}</b>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <div className="gm-movement-side">
                  <aside className="gm-aside">
                    <div className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>{esMovCheque ? "Datos del movimiento" : "Datos del egreso"}</span>
                      </div>
                      <div className="gm-section-body">
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

                        {!esMovCheque && (
                          <PanelMediosPagoInlineEgreso
                            mediosFilas={form.medios || []}
                            mediosPagoList={mediosPago}
                            totalEgreso={totalGeneral}
                            onUpdate={updateMedioPago}
                            onRemove={removeMedioPago}
                            onAdd={addMedioPago}
                            showToast={showToast}
                            saving={saving}
                            apiGet={apiGet}
                            baseUrl={BASE_URL}
                            chequesAction="mov_global_cheques_cartera_listar"
                          />
                        )}

                        {!esMovCheque && (
                          <div className="gm-field">
                            <select
                              className="gm-input gm-select"
                              value={String(form.id_clasificacion || "")}
                              onChange={(e) => setForm((p) => ({ ...p, id_clasificacion: e.target.value }))}
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
                        )}

                        <div className="gm-upload-card">
                          <div className="gm-upload-card__head">
                            <div className="gm-upload-card__title">Comprobante</div>
                            <div className="gm-upload-card__sub">
                              Seleccioná, visualizá o quitá el archivo antes de guardar
                            </div>
                          </div>

                          <div className="gm-upload-card__body">
                            {loadingComprobante ? (
                              <div style={{ fontSize: 12, opacity: 0.75, padding: "6px 0" }}>
                                Cargando comprobante…
                              </div>
                            ) : (
                              <>
                                {mostrarArchivoActual && (
                                  <div className="gm-upload-file is-filled">
                                    <div className="gm-upload-file__icon">
                                      <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                    </div>
                                    <div className="gm-upload-file__meta">
                                      <div className="gm-upload-file__name" title={nombreComprobanteVisible}>
                                        {nombreComprobanteVisible}
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={abrirViewer}
                                        disabled={viewerBtnDisabled}
                                        title={loadingViewer ? "Cargando comprobante…" : "Ver comprobante"}
                                      >
                                        {loadingViewer
                                          ? <span style={{ fontSize: 11 }}>…</span>
                                          : <FontAwesomeIcon icon={faEye} />
                                        }
                                      </button>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={marcarEliminar}
                                        disabled={saving}
                                        title="Quitar comprobante"
                                      >
                                        <FontAwesomeIcon icon={faTrash} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {archivoNuevo && (
                                  <div className="gm-upload-file is-filled">
                                    <div className="gm-upload-file__icon">
                                      <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                    </div>
                                    <div className="gm-upload-file__meta">
                                      <div className="gm-upload-file__name" title={NOMBRE_COMPROBANTE_GENERICO}>
                                        {NOMBRE_COMPROBANTE_GENERICO}
                                      </div>
                                      <div className="gm-upload-file__size">
                                        {Math.max(1, Math.round((archivoNuevo.size || 0) / 1024))} KB
                                      </div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={abrirViewer}
                                        disabled={viewerBtnDisabled}
                                        title="Ver comprobante"
                                      >
                                        <FontAwesomeIcon icon={faEye} />
                                      </button>
                                      <button
                                        type="button"
                                        className="gm-upload-btn gm-upload-btn--ghost"
                                        onClick={quitarArchivoNuevo}
                                        disabled={saving}
                                        title="Quitar archivo"
                                      >
                                        <FontAwesomeIcon icon={faTrash} />
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {!mostrarArchivoActual && !archivoNuevo && (
                                  <div className="gm-upload-file is-empty">
                                    <div className="gm-upload-file__empty">
                                      {marcarEliminarComprobante
                                        ? "El comprobante actual será eliminado al guardar"
                                        : "No hay comprobante seleccionado"}
                                    </div>
                                  </div>
                                )}

                                <div className="gm-upload-bar" style={{ marginTop: 10 }}>
                                  {marcarEliminarComprobante && !archivoNuevo && (
                                    <button
                                      type="button"
                                      className="gm-upload-btn gm-upload-btn--ghost"
                                      onClick={restaurarComprobanteActual}
                                      disabled={saving}
                                    >
                                      <FontAwesomeIcon icon={faUndo} /> Cancelar
                                    </button>
                                  )}
                                  <input
                                    ref={inputFileRef}
                                    type="file"
                                    accept={fileAcceptText()}
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
                                    {mostrarArchivoActual || archivoNuevo
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
                      onClick={() => !saving && onClose?.()}
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
