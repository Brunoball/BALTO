import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../OrdenesPagoModals.css";
import "../../../Global/Global_css/Global_responsive.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faListCheck,
  faMoneyBill1Wave,
  faCircleNotch,
  faMoneyCheckDollar,
  faPlus,
  faInfoCircle,
} from "@fortawesome/free-solid-svg-icons";

import ModalOrdenPagoGenerada from "./ModalOrdenPagoGenerada";
import ModalDetalleMovimiento from "../../../Global/Modales/ModalDetalleMovimiento.jsx";
import { buildOrdenPagoHTML } from "../../../../utils/ordenPagoTemplate";
import { getResumenProductosMovimiento } from "../../_shared/detalleMovimiento.js";
import { ordenesPagoFetch } from "../api/ordenesPagoApi.js";


/* =========================
   Helpers
========================= */
function moneyARS(v) {
  const n = Number(v || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

function productosLabel(row) {
  return getResumenProductosMovimiento(row);
}

function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m1) {
    const yyyy = m1[1];
    const mm = String(Number(m1[2])).padStart(2, "0");
    const dd = String(Number(m1[3])).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

function todayISO() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}


function getAuthInfo() {
  const sessionKey = (
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("X-Session") ||
    localStorage.getItem("x_session") ||
    ""
  ).trim();

  const token = (localStorage.getItem("token") || "").trim();

  let idUsuario = 0;
  let idUsuarioMaster = 0;

  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const candMaster = u?.idUsuarioMaster ?? 0;
    const candNormal =
      u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;

    if (Number.isFinite(Number(candMaster)) && Number(candMaster) > 0) {
      idUsuarioMaster = Number(candMaster);
      idUsuario = Number(candMaster);
    } else if (Number.isFinite(Number(candNormal)) && Number(candNormal) > 0) {
      idUsuario = Number(candNormal);
      idUsuarioMaster = Number(candNormal);
    }
  } catch {}

  return { sessionKey, token, idUsuario, idUsuarioMaster };
}

function buildAuthHeaders(includeJson = false) {
  const { sessionKey, token } = getAuthInfo();
  const headers = {};
  if (includeJson) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function normalizeMediosPago(raw) {
  const root = raw && typeof raw === "object" ? raw : {};
  const src = root.listas && typeof root.listas === "object" ? root.listas : root;
  const arr = Array.isArray(src.medios_pago)
    ? src.medios_pago
    : Array.isArray(src.mediosPago)
    ? src.mediosPago
    : [];
  return arr
    .map((x) => ({
      id: Number(x?.id ?? x?.id_medio_pago ?? 0) || 0,
      nombre: String(x?.nombre ?? x?.medio_pago ?? "").trim(),
    }))
    .filter((x) => x.id > 0 && x.nombre);
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

function getMontoTotalRow(row) {
  const n = Number(row?.monto_total ?? row?.total ?? 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getCobradoTotalRow(row) {
  const n = Number(
    row?.cobrado_total ??
      row?.monto_cobrado ??
      row?.total_cobrado ??
      row?.pagado_total ??
      0
  );
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function getSaldoPendienteRow(row) {
  const explicitKeys = [
    "saldo_pendiente",
    "saldo_restante",
    "monto_pendiente",
    "pendiente",
    "saldo",
  ];

  for (const key of explicitKeys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return Math.max(0, n);
    }
  }

  const total = getMontoTotalRow(row);
  const cobrado = getCobradoTotalRow(row);
  if (total > 0 || cobrado > 0) return Math.max(0, total - cobrado);
  if (row?.pagado === true || Number(row?.pagado ?? 0) === 1) return 0;
  return total;
}

function isPagadoRow(row) {
  return getSaldoPendienteRow(row) <= 0.009;
}

function isParcialRow(row) {
  return !isPagadoRow(row) && getCobradoTotalRow(row) > 0.009;
}

async function fetchJsonOrThrow(url, opts = {}) {
  const res = await ordenesPagoFetch(url, opts);
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.length > 700 ? text.slice(0, 700) + "..." : text;
    throw new Error(`Respuesta inválida (no es JSON). HTTP ${res.status}\n${preview}`);
  }
  if (!res.ok) throw new Error(data?.mensaje || `HTTP ${res.status}`);
  if (data?.exito === false) throw new Error(data?.mensaje || "Operación fallida.");
  return data;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildEmptyMedioPago() {
  return {
    id: uid(),
    id_medio_pago: "",
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

function getChequeIdsArray(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

/* =========================
   UI helpers
========================= */
function EstadoChip({ row, pagado }) {
  const parcial = !pagado && isParcialRow(row);
  return (
    <span className={`gm-status-chip ${pagado ? "gm-status-chip--ok" : "gm-status-chip--warn"}`}>
      {pagado ? "PAGADO" : parcial ? "PENDIENTE PARCIAL" : "PENDIENTE"}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────
   TARJETAS DE CHEQUES
───────────────────────────────────────────────────────── */
function ChequesCarteraCards({ cheques, idsSeleccionados, onToggle, esEcheq = false }) {
  if (!cheques.length) return null;

  return (
    <div className="gm-checks-list">
      {cheques.map((ch, idx) => {
        const checked = idsSeleccionados.includes(String(ch?.id_cheque));

        return (
          <div
            key={ch?.id_cheque || idx}
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            className={`gm-check-item ${checked ? "gm-check-item--selected" : ""} ${esEcheq ? "gm-check-item--echeck" : ""}`}
            onClick={() => onToggle(String(ch?.id_cheque || ""))}
            onKeyDown={(e) =>
              (e.key === " " || e.key === "Enter") &&
              onToggle(String(ch?.id_cheque || ""))
            }
          >
            <div
              className={`gm-check-icon gm-check-icon--corner ${
                esEcheq ? "gm-check-icon--echeck" : "gm-check-icon--check"
              }`}
            >
              {checked && (
                <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                  <path
                    d="M1 3.5L3.5 6L8 1"
                    stroke="#fff"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            <div className="gm-check-main">
              <div className="gm-check-top">
                <span className="gm-check-number">N° {safeText(ch?.numero_cheque)}</span>
                {esEcheq && <span className="gm-check-badge gm-check-badge--echeck">eCheq</span>}
              </div>

              <div className="gm-check-meta">
                <span className="gm-check-issuer" title={safeText(ch?.emisor)}>
                  {safeText(ch?.emisor)}
                </span>
                <span className="gm-check-separator">·</span>
                <span>Pago: {safeText(formatFechaDMY(ch?.fecha_pago))}</span>
              </div>
            </div>

            <span className="gm-check-amount">{moneyARS(ch?.importe || 0)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   FILA MEDIO DE PAGO
───────────────────────────────────────────────────────── */
function MedioPagoRow({
  row,
  mediosPagoList,
  onUpdate,
  onRemove,
  saving,
  showToast,
  canRemove,
  totalSeleccionado,
  sumaMediosPago,
}) {
  const mpSeleccionado = useMemo(
    () => mediosPagoList.find((x) => String(x.id) === String(row.id_medio_pago)) || null,
    [mediosPagoList, row.id_medio_pago]
  );

  const tipoCheque = useMemo(
    () => normalizeChequeTipoFromMedio(mpSeleccionado?.nombre || ""),
    [mpSeleccionado]
  );

  const esCheque = tipoCheque !== null;
  const esEcheq = tipoCheque === "echeq";

  const chequesSeleccionados = useMemo(
    () => getChequeIdsArray(row.id_cheque),
    [row.id_cheque]
  );

  const importeCheques = useMemo(() => {
    if (!esCheque || !chequesSeleccionados.length) return 0;
    return chequesSeleccionados.reduce((acc, idStr) => {
      const ch = row.chequesDisponibles.find((x) => String(x.id_cheque) === idStr);
      return acc + (ch ? Number(ch.importe || 0) : 0);
    }, 0);
  }, [esCheque, chequesSeleccionados, row.chequesDisponibles]);

  const montoVisible = esCheque ? importeCheques : row.monto;

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - safeNumber(montoVisible));
    return Math.max(0, safeNumber(totalSeleccionado) - sumaOtros);
  }, [sumaMediosPago, totalSeleccionado, montoVisible]);

  const puedeCompletarRestante =
    !saving && !esCheque && totalSeleccionado > 0 && restanteParaEstaFila > 0.009;
  const chequesFetchSeqRef = useRef(0);

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(x.id) === String(val));
      const tipo = normalizeChequeTipoFromMedio(mp?.nombre || "");
      onUpdate(row.id, {
        id_medio_pago: val,
        id_cheque: [],
        chequesDisponibles: [],
        loadingCheques: false,
        chequesMaxKey: null,
        chequesTipoCargado: tipo || null,
        monto: tipo !== null ? 0 : row.monto,
        montoDraft: "",
        montoFocused: false,
      });
    },
    [row.id, row.monto, mediosPagoList, onUpdate]
  );

  useEffect(() => {
    if (!esCheque || !tipoCheque) return;

    const maxImporte = Math.max(0, safeNumber(restanteParaEstaFila));
    const maxKey = `${tipoCheque}:${Math.round(maxImporte * 100) / 100}`;

    if (maxImporte <= 0.009) {
      if (row.chequesMaxKey !== maxKey || row.loadingCheques || chequesSeleccionados.length > 0 || (Array.isArray(row.chequesDisponibles) && row.chequesDisponibles.length > 0)) {
        chequesFetchSeqRef.current += 1;
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

    const seq = ++chequesFetchSeqRef.current;
    onUpdate(row.id, { loadingCheques: true, chequesTipoCargado: tipoCheque });

    (async () => {
      try {
        const sp = new URLSearchParams();
        sp.set("action", "mov_global_cheques_cartera_listar");
        sp.set("tipo", tipoCheque);
        sp.set("max_importe", String(maxImporte));
        const data = await fetchJsonOrThrow(`${BASE_URL}/api.php?${sp.toString()}`, {
          method: "GET",
          headers: buildAuthHeaders(false),
        });
        if (chequesFetchSeqRef.current !== seq) return;

        const cheques = Array.isArray(data?.cheques) ? data.cheques : [];
        const idsDisponibles = new Set(cheques.map((ch) => String(ch?.id_cheque || "")).filter(Boolean));
        const idsActuales = getChequeIdsArray(row.id_cheque);
        const idsValidos = idsActuales.filter((id) => idsDisponibles.has(String(id)));

        onUpdate(row.id, {
          id_cheque: idsValidos,
          chequesDisponibles: cheques,
          loadingCheques: false,
          chequesMaxKey: maxKey,
          chequesTipoCargado: tipoCheque,
          ...(idsValidos.length === 0 ? { monto: 0, montoDraft: "", montoFocused: false } : {}),
        });
      } catch (e) {
        if (chequesFetchSeqRef.current !== seq) return;
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
        showToast("error", e?.message || "No se pudieron cargar los cheques.");
      }
    })();
  }, [
    esCheque,
    tipoCheque,
    restanteParaEstaFila,
    row.id,
    row.id_cheque,
    row.loadingCheques,
    row.chequesMaxKey,
    row.chequesDisponibles,
    onUpdate,
    showToast,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importeCheques, esCheque]);

  return (
    <div className="gm-payment-card">
      {/* Fila: selector de medio */}
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select
            className="gm-input gm-select"
            value={String(row.id_medio_pago || "")}
            onChange={(e) => handleChangeMedio(e.target.value)}
            disabled={saving}
          >
            <option value="">Seleccionar…</option>
            {mediosPagoList.map((x) => (
              <option key={x.id} value={String(x.id)}>
                {x.nombre}
              </option>
            ))}
          </select>
          <label className={`gm-label${row.id_medio_pago ? " gm-label--up" : ""}`}>
            Medio de pago
          </label>
        </div>
      </div>

      {/* Fila: monto + acciones */}
      <div className="gm-payment-row gm-payment-row--amount">
        <div className="gm-field gm-payment-amount-field" style={{ position: "relative" }}>
<input
  className={`gm-input gm-payment-amount-input${esCheque ? " gm-payment-amount-input--locked" : ""}`}
  type="text"
  inputMode="decimal"
  value={
    row.montoFocused
      ? row.montoDraft ?? ""
      : formatMoneyInputARS(montoVisible)
  }
  onFocus={(e) => {
    if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
    onUpdate(row.id, {
      montoFocused: true,
      montoDraft: formatEditableMoney(montoVisible),
    });
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
  style={{
    background:
      esCheque && chequesSeleccionados.length > 0
        ? "rgba(0,0,0,.03)"
        : undefined,
    height: 32,
    padding: "0 10px",
    fontSize: 13,
    textAlign: "right",
  }}
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
          {canRemove && (
            <button
              type="button"
              className="gm-payment-delete"
              onClick={() => onRemove(row.id)}
              disabled={saving}
              title="Quitar medio de pago"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Sección cheques de cartera */}
      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 11 }} />
            {esEcheq ? "eCheqs en cartera" : "Cheques en cartera"}
          </div>

          {row.loadingCheques ? (
            <div className="gm-payment-checks-loading">
              <FontAwesomeIcon icon={faCircleNotch} spin style={{ marginRight: 6 }} />
              Cargando…
            </div>
          ) : row.chequesDisponibles.length === 0 ? (
            <div className="gm-payment-checks-empty">
              No hay {esEcheq ? "eCheqs" : "cheques"} activos en cartera.
            </div>
          ) : (
            <ChequesCarteraCards
              cheques={row.chequesDisponibles}
              idsSeleccionados={chequesSeleccionados}
              onToggle={handleToggleCheque}
              esEcheq={esEcheq}
            />
          )}

          {chequesSeleccionados.length > 0 && (
            <div className="mi-uploadCard__sub">
              ✓ {chequesSeleccionados.length} cheque(s) — {moneyARS(importeCheques)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   PANEL MEDIOS DE PAGO (igual a PanelMediosPagoReciboLocal)
───────────────────────────────────────────────────────── */
function PanelMediosPago({
  mediosFilas,
  mediosPagoList,
  totalSeleccionado,
  onUpdate,
  onRemove,
  onAdd,
  saving,
  loadingMedios,
  sumaMediosPago,
  diferenciaRestante,
  showToast,
}) {
  return (
    <>
      {loadingMedios && (
        <div
          style={{
            padding: "4px 0",
            fontSize: 12,
            color: "var(--nv-muted)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 11 }} />
          Cargando medios de pago…
        </div>
      )}

      {mediosFilas.map((mp) => (
        <MedioPagoRow
          key={mp.id}
          row={mp}
          mediosPagoList={mediosPagoList}
          onUpdate={onUpdate}
          onRemove={onRemove}
          saving={saving}
          showToast={showToast}
          canRemove={mediosFilas.length > 1}
          totalSeleccionado={totalSeleccionado}
          sumaMediosPago={sumaMediosPago}
        />
      ))}

      <div className="gm-payment-totals">
        <span className="gm-payment-totals-assigned">
          Asignado: <b>{moneyARS(sumaMediosPago)}</b>
        </span>
        {diferenciaRestante > 0.01 && (
          <span className="gm-payment-totals-missing">
            Saldo restante: {moneyARS(diferenciaRestante)}
          </span>
        )}
        {diferenciaRestante <= 0.01 && totalSeleccionado > 0 && (
          <span className="gm-payment-totals-ok">✓ Cubierto</span>
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

/* =========================
   COMPONENTE PRINCIPAL
========================= */
export default function ModalPagarOrdenesPago({
  open,
  onClose,
  onConfirm,
  onToast,
  proveedor,
  deudas = [],
  onOrdenPagoFinalizado,
  onAfterPaid,
  lists,
}) {
  const dialogRef = useRef(null);
  const firstFocusRef = useRef(null);
  const tbodyRef = useRef(null);
  const [tbodyHasScroll, setTbodyHasScroll] = useState(false);

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [pagaTodo, setPagaTodo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(() => []);
  const [openDetalleDeuda, setOpenDetalleDeuda] = useState(false);
  const [detalleDeudaRow, setDetalleDeudaRow] = useState(null);

  const mediosPagoFromContext = useMemo(
    () => filtrarMediosPagoPorPlan(normalizeMediosPago(lists || {})),
    [lists]
  );
  const [mediosPago, setMediosPago] = useState([]);
  const [loadingMedios, setLoadingMedios] = useState(false);

  const [mediosFilas, setMediosFilas] = useState(() => [buildEmptyMedioPago()]);

  const addMedioPago = useCallback(() => {
    setMediosFilas((p) => [...p, buildEmptyMedioPago()]);
  }, []);

  const removeMedioPago = useCallback((id) => {
    setMediosFilas((p) => {
      const next = p.filter((r) => r.id !== id);
      return next.length ? next : p;
    });
  }, []);

  const updateMedioPago = useCallback((id, patch) => {
    setMediosFilas((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const abrirDetalleDeuda = useCallback((row) => {
    setDetalleDeudaRow(row || null);
    setOpenDetalleDeuda(true);
  }, []);

  const cerrarDetalleDeuda = useCallback(() => {
    setOpenDetalleDeuda(false);
    setDetalleDeudaRow(null);
  }, []);

  const sumaMediosPago = useMemo(
    () => mediosFilas.reduce((a, r) => a + safeNumber(r.monto), 0),
    [mediosFilas]
  );

  const [openOrden, setOpenOrden] = useState(false);
  const [ordenHtml, setOrdenHtml] = useState("");
  const [ordenTitle, setOrdenTitle] = useState("Orden de Pago");
  const [idsMovimientosPagados, setIdsMovimientosPagados] = useState([]);
  const [ultimoCobroId, setUltimoCobroId] = useState(null);
  const [idsPagosGenerados, setIdsPagosGenerados] = useState([]);

  const showToast = useCallback(
    (tipo, mensaje) => onToast?.(tipo, mensaje),
    [onToast]
  );

  const fetchMediosPagoFallback = useCallback(async () => {
    try {
      setLoadingMedios(true);
      const data = await fetchJsonOrThrow(
        `${BASE_URL}/api.php?action=global_obtener_listas`,
        { method: "GET", headers: buildAuthHeaders(false) }
      );
      setMediosPago(filtrarMediosPagoPorPlan(normalizeMediosPago(data)));
    } catch (e) {
      showToast("error", e?.message || "No se pudieron cargar los medios de pago.");
      setMediosPago([]);
    } finally {
      setLoadingMedios(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setPagaTodo(false);
    setLoading(false);
    setRows(Array.isArray(deudas) ? [...deudas] : []);
    setOpenDetalleDeuda(false);
    setDetalleDeudaRow(null);
    setOpenOrden(false);
    setOrdenHtml("");
    setOrdenTitle("Orden de Pago");
    setIdsMovimientosPagados([]);
    setUltimoCobroId(null);
    setIdsPagosGenerados([]);
    setMediosFilas([buildEmptyMedioPago()]);

    if (mediosPagoFromContext.length > 0) {
      setMediosPago(mediosPagoFromContext);
      setLoadingMedios(false);
    } else {
      setMediosPago([]);
      fetchMediosPagoFallback();
    }

    setTimeout(() => firstFocusRef.current?.focus(), 50);
  }, [open, deudas, mediosPagoFromContext, fetchMediosPagoFallback]);

  useEffect(() => {
    if (!open || openOrden || openDetalleDeuda) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!loading) onClose?.();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, openOrden, openDetalleDeuda, onClose, loading]);

  const deudasOrdenadas = useMemo(() => {
    const arr = Array.isArray(rows) ? [...rows] : [];
    arr.sort((a, b) => {
      const fa = String(a?.fecha || "");
      const fb = String(b?.fecha || "");
      if (fa === fb) return Number(b?.id_movimiento || 0) - Number(a?.id_movimiento || 0);
      return fb.localeCompare(fa);
    });
    return arr;
  }, [rows]);

  const totalSeleccionado = useMemo(() => {
    let sum = 0;
    for (const r of deudasOrdenadas) {
      const id = Number(r?.id_movimiento || 0);
      if (!id) continue;
      if (selectedIds.has(id)) sum += getSaldoPendienteRow(r);
    }
    return sum;
  }, [deudasOrdenadas, selectedIds]);

  const diferenciaRestante = useMemo(
    () => Math.max(0, totalSeleccionado - sumaMediosPago),
    [totalSeleccionado, sumaMediosPago]
  );

  const cantSeleccionadas = useMemo(() => selectedIds.size, [selectedIds]);

  const recomputeTbodyScroll = useCallback(() => {
    const el = tbodyRef.current;
    if (!el) return;
    setTbodyHasScroll(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    if (!open || openOrden || openDetalleDeuda) return;
    const t = setTimeout(recomputeTbodyScroll, 0);
    const el = tbodyRef.current;
    if (!el) return () => clearTimeout(t);

    const ro = new ResizeObserver(() => recomputeTbodyScroll());
    ro.observe(el);
    const mo = new MutationObserver(() => recomputeTbodyScroll());
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", recomputeTbodyScroll);

    return () => {
      clearTimeout(t);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", recomputeTbodyScroll);
    };
  }, [open, openOrden, recomputeTbodyScroll, deudasOrdenadas.length]);

  const toggleOne = (id, row) => {
    if (!id || loading || isPagadoRow(row)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const pendientes = deudasOrdenadas.filter((x) => !isPagadoRow(x));
      setPagaTodo(next.size === pendientes.length && pendientes.length > 0);
      return next;
    });
  };

  const toggleAll = () => {
    if (loading) return;
    const pendientes = deudasOrdenadas
      .filter((r) => !isPagadoRow(r))
      .map((r) => Number(r?.id_movimiento || 0))
      .filter(Boolean);

    setSelectedIds((prev) => {
      const next = new Set();
      const shouldSelectAll = prev.size !== pendientes.length;
      if (shouldSelectAll) pendientes.forEach((id) => next.add(id));
      setPagaTodo(shouldSelectAll);
      return next;
    });
  };

  const buildMediosPagoPayload = useCallback(() => {
    return mediosFilas.flatMap((mp) => {
      const idsCheques = getChequeIdsArray(mp.id_cheque);
      const mpData = mediosPago.find((x) => String(x.id) === String(mp.id_medio_pago));
      const tipoCheque = normalizeChequeTipoFromMedio(mpData?.nombre || "");

      if (tipoCheque !== null && idsCheques.length > 0) {
        return idsCheques.map((idChequeStr) => {
          const ch = mp.chequesDisponibles.find(
            (x) => String(x.id_cheque) === String(idChequeStr)
          );
          return {
            id_medio_pago: Number(mp.id_medio_pago),
            monto: Number(ch?.importe || 0),
            id_cheque: Number(idChequeStr),
          };
        });
      }

      return [
        {
          id_medio_pago: Number(mp.id_medio_pago),
          monto: safeNumber(mp.monto),
          id_cheque: null,
        },
      ];
    });
  }, [mediosFilas, mediosPago]);

  const confirmPagoDefault = async ({ ids_movimiento, medios_pago }) => {
    const { idUsuario, idUsuarioMaster } = getAuthInfo();
    return await fetchJsonOrThrow(
      `${BASE_URL}/api.php?action=ordenes_pago_confirmar_pago`,
      {
        method: "POST",
        headers: buildAuthHeaders(true),
        body: JSON.stringify({
          ids_movimiento,
          medios_pago,
          fecha_cobro: todayISO(),
          fecha_pago: todayISO(),
          fecha: todayISO(),
          idUsuario,
          idUsuarioMaster: idUsuarioMaster || idUsuario,
        }),
      }
    );
  };

  const buildOrdenFromSeleccion = useCallback(
    ({ proveedorInfo, mediosPagoInfo, seleccion, montoPagado }) => {
      const total = safeNumber(montoPagado);
      const mpNombre =
        mediosPagoInfo.length === 1
          ? mediosPagoInfo[0].nombre
          : mediosPagoInfo.map((x) => x.nombre).join(" + ");

      let restante = Math.max(0, total);
      const seleccionLista = Array.isArray(seleccion) ? seleccion : [];
      const ultimoIdx = seleccionLista.length - 1;
      const seleccionConImportes = seleccionLista
        .map((r, idx) => {
          const saldo = getSaldoPendienteRow(r);
          const aplicado = idx === ultimoIdx ? restante : Math.min(saldo, restante);
          restante = Math.max(0, restante - aplicado);

          return {
            ...r,
            monto_aplicado: aplicado,
            importe_aplicado: aplicado,
          };
        })
        .filter((it) => Number(it.monto_aplicado || 0) > 0.009);

      const html = buildOrdenPagoHTML({
        proveedorNombre: proveedorInfo?.nombre ?? proveedor?.proveedor ?? "",
        proveedorId: proveedorInfo?.id_proveedor ?? proveedor?.id_proveedor ?? "",
        medioPagoNombre: mpNombre,
        total,
        seleccion: seleccionConImportes,
        fechaPago: new Date(),
      });

      return {
        html,
        title: `Orden de Pago - ${proveedorInfo?.nombre || proveedor?.proveedor || "Proveedor"}`,
      };
    },
    [proveedor]
  );

  const validate = useCallback(() => {
    const seleccion = deudasOrdenadas.filter((r) => {
      const id = Number(r?.id_movimiento || 0);
      return id && selectedIds.has(id) && !isPagadoRow(r);
    });

    if (seleccion.length === 0) {
      return { ok: false, msg: "Seleccioná al menos una deuda PENDIENTE para pagar." };
    }

    const chequesRepetidos = new Set();

    for (let i = 0; i < mediosFilas.length; i++) {
      const mp = mediosFilas[i];

      if (!mp.id_medio_pago) {
        return { ok: false, msg: `Medio de pago ${i + 1}: falta seleccionar el medio.` };
      }

      const mpData = mediosPago.find((x) => String(x.id) === String(mp.id_medio_pago));
      const tipoCheque = normalizeChequeTipoFromMedio(mpData?.nombre || "");
      const idsCheques = getChequeIdsArray(mp.id_cheque);

      if (tipoCheque !== null) {
        if (!idsCheques.length) {
          return {
            ok: false,
            msg: `Medio de pago ${i + 1}: debés seleccionar al menos un ${
              tipoCheque === "echeq" ? "eCheq" : "cheque"
            } de cartera.`,
          };
        }
        for (const idCh of idsCheques) {
          if (chequesRepetidos.has(idCh)) {
            return {
              ok: false,
              msg: `El cheque/eCheq ID ${idCh} está repetido en más de un medio de pago.`,
            };
          }
          chequesRepetidos.add(idCh);
        }
      } else {
        if (safeNumber(mp.monto) <= 0) {
          return { ok: false, msg: `Medio de pago ${i + 1}: el monto debe ser mayor a 0.` };
        }
      }
    }

    if (sumaMediosPago <= 0.009) {
      return {
        ok: false,
        msg: "El importe a pagar debe ser mayor a 0.",
      };
    }

    // Permitimos que el importe del medio de pago supere el saldo seleccionado.
    // Ejemplo: cheque/eCheq de $2.000 para cancelar un saldo de $1.500.
    // El backend registra el importe completo y aplica el excedente a la última deuda seleccionada.

    return { ok: true };
  }, [deudasOrdenadas, selectedIds, mediosFilas, mediosPago, sumaMediosPago, totalSeleccionado]);

  const handleConfirm = async () => {
    if (!deudasOrdenadas.length) {
      showToast("error", "Este proveedor no tiene deudas.");
      return;
    }

    const v = validate();
    if (!v.ok) {
      showToast("error", v.msg);
      return;
    }

    const seleccion = deudasOrdenadas.filter((r) => {
      const id = Number(r?.id_movimiento || 0);
      return id && selectedIds.has(id) && !isPagadoRow(r);
    });

    const ids = seleccion.map((r) => Number(r?.id_movimiento || 0)).filter(Boolean);
    const mediosPagoPayload = buildMediosPagoPayload();

    const mediosPagoInfo = mediosFilas.map((mp) => {
      const mpData = mediosPago.find((x) => String(x.id) === String(mp.id_medio_pago));
      const idsCheques = getChequeIdsArray(mp.id_cheque);
      if (idsCheques.length > 1) {
        return { nombre: `${mpData?.nombre || "Medio de pago"} x${idsCheques.length}` };
      }
      return { nombre: mpData?.nombre || "Medio de pago" };
    });

    try {
      setLoading(true);

      let resp;
      if (typeof onConfirm === "function") {
        resp = await Promise.resolve(
          onConfirm({
            proveedor: {
              id_proveedor: proveedor?.id_proveedor ?? null,
              nombre: proveedor?.proveedor ?? "",
            },
            seleccion,
            totalSeleccionado,
            medios_pago: mediosPagoPayload,
            fecha_cobro: todayISO(),
            fecha_pago: todayISO(),
            fecha: todayISO(),
            ids_movimiento: ids,
          })
        );
      } else {
        resp = await confirmPagoDefault({
          ids_movimiento: ids,
          medios_pago: mediosPagoPayload,
        });
      }

      const idsPagoResp = Array.isArray(resp?.ids_pago)
        ? resp.ids_pago.map((x) => Number(x || 0)).filter(Boolean)
        : [];
      const idsCobroResp = Array.isArray(resp?.ids_cobro)
        ? resp.ids_cobro.map((x) => Number(x || 0)).filter(Boolean)
        : [];
      const idsPagoFinales = idsPagoResp.length ? idsPagoResp : idsCobroResp;

      setIdsMovimientosPagados(ids);
      setIdsPagosGenerados(idsPagoFinales);
      setUltimoCobroId(Number(idsPagoFinales?.[0] || resp?.id_pago || resp?.id_cobro || 0) || null);

      const montoAplicadoFinal = safeNumber(
        resp?.total_pagado ?? resp?.monto_pagado ?? resp?.monto_cobrado ?? sumaMediosPago
      );

      let restantePagoLocal = Math.max(0, montoAplicadoFinal);
      const ultimoIdSeleccionado = ids[ids.length - 1] || null;
      setRows((prev) =>
        (Array.isArray(prev) ? prev : []).map((r) => {
          const id = Number(r?.id_movimiento || 0);
          if (!id || !ids.includes(id) || restantePagoLocal <= 0) return r;

          const saldoAntes = getSaldoPendienteRow(r);
          const aplicado = id === ultimoIdSeleccionado ? restantePagoLocal : Math.min(saldoAntes, restantePagoLocal);
          restantePagoLocal = Math.max(0, restantePagoLocal - aplicado);

          const nuevoCobrado = getCobradoTotalRow(r) + aplicado;
          const nuevoSaldo = Math.max(0, getMontoTotalRow(r) - nuevoCobrado);

          return {
            ...r,
            cobrado_total: nuevoCobrado,
            saldo_pendiente: nuevoSaldo,
            pagado: nuevoSaldo <= 0.009,
          };
        })
      );

      onAfterPaid?.(ids, {
        seleccion,
        montoPagado: montoAplicadoFinal,
      });

      const built = buildOrdenFromSeleccion({
        proveedorInfo: {
          id_proveedor: proveedor?.id_proveedor ?? null,
          nombre: proveedor?.proveedor ?? "",
        },
        mediosPagoInfo,
        seleccion,
        montoPagado: montoAplicadoFinal,
      });

      setOrdenHtml(built.html);
      setOrdenTitle(built.title);
      setOpenOrden(true);
      setSelectedIds(new Set());
      setPagaTodo(false);
      setMediosFilas([buildEmptyMedioPago()]);

      showToast("exito", "Pago realizado correctamente.");
      setTimeout(recomputeTbodyScroll, 0);
    } catch (e) {
      showToast("error", e?.message || "No se pudo registrar el pago.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const canConfirm =
    !loading && selectedIds.size > 0 && !loadingMedios && mediosFilas.every((mp) => mp.id_medio_pago);

  const modalClass = "gm-modal-container gm-modal-container--movement gm-modal-v2 gm-order-pay-modal";
  const overlayClass = "gm-modal-overlay";

  return createPortal(
    <>
      {!openOrden && (
        <div className={overlayClass} role="dialog" aria-modal="true">
          <div
            className={modalClass}
            ref={dialogRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="gm-modal-header">
              <div className="gm-modal-head-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faMoneyBill1Wave} />
              </div>
              <div className="gm-modal-head-left">
                <h2 className="gm-modal-title">Pagar orden</h2>
                <p className="gm-modal-subtitle">
                  {safeText(proveedor?.proveedor)}
                  {proveedor?.id_proveedor ? ` · ID ${String(proveedor.id_proveedor)}` : ""}
                </p>
              </div>
              <button
                ref={firstFocusRef}
                type="button"
                className="gm-modal-close"
                onClick={onClose}
                title="Cerrar"
                disabled={loading}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            {/* ── Contenido ── */}
            <div className="gm-modal-content">
              <div className="gm-movement-layout">

                {/* Tabla de deudas */}
                <section className="gm-movement-main gm-table gm-order-table">
                  <div className={`gm-order-table-head gm-table-head ${tbodyHasScroll ? "gm-table-head--body-scroll" : ""}`}>
                    <div className="gm-order-th gm-table-th gm-order-th--sel gm-table-cell--center">Sel</div>
                    <div className="gm-order-th gm-table-th">Fecha</div>
                    <div className="gm-order-th gm-table-th gm-order-th--desc">Descripción</div>
                    <div className="gm-order-th gm-table-th gm-order-th--center gm-table-cell--center">Estado</div>
                    <div className="gm-order-th gm-table-th gm-order-th--right gm-table-cell--right">Monto</div>
                    <div className="gm-order-th gm-table-th gm-order-th--info gm-table-cell--center">Info</div>
                  </div>

                  <div
                    ref={tbodyRef}
                    className={`gm-order-table-body gm-table-body ${tbodyHasScroll ? "gm-order-table-body--scroll gm-table-body--scroll" : ""}`}
                  >
                    {!deudasOrdenadas.length && (
                      <div className="gm-table-empty">
                        No hay deudas para este proveedor.
                      </div>
                    )}

                    {deudasOrdenadas.map((r, idx) => {
                      const id = Number(r?.id_movimiento || 0);
                      const pagado = isPagadoRow(r);
                      const checked = selectedIds.has(id);
                      const saldoPendiente = getSaldoPendienteRow(r);

                      return (
                        <div
                          key={id || `${r?.fecha}-${idx}`}
                          className={`gm-order-row gm-table-row ${checked ? "is-checked" : ""} ${pagado ? "is-paid" : ""}`}
                          role="row"
                          data-movement-id={id || undefined}
                          onClick={() => id && toggleOne(id, r)}
                          title={pagado ? "Este registro ya está PAGADO" : undefined}
                        >
                          <div
                            className="gm-order-td gm-table-cell gm-order-td--sel gm-table-cell--center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <label
                              className={`gm-inline-check ${!id || loading || pagado ? "is-disabled" : ""}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleOne(id, r)}
                                disabled={!id || loading || pagado}
                              />
                              <span className="gm-inline-check__box" aria-hidden="true" />
                            </label>
                          </div>

                          <div className="gm-order-td gm-table-cell">
                            {safeText(formatFechaDMY(r?.fecha))}
                          </div>

                          <div
                            className="gm-order-td gm-table-cell gm-order-td--desc"
                            title={safeText(r?.detalle ?? r?.descripcion ?? r?.concepto)}
                          >
                            {productosLabel(r)}
                          </div>

                          <div className="gm-order-td gm-table-cell gm-order-td--center gm-table-cell--center">
                            <EstadoChip row={r} pagado={pagado} />
                          </div>

                          <div className="gm-order-td gm-table-cell gm-order-td--right gm-table-cell--right gm-order-td--mono gm-table-cell--mono">
                            {moneyARS(saldoPendiente)}
                          </div>

                          <div className="gm-order-td gm-table-cell gm-order-td--info gm-table-cell--center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="gm-info-btn"
                              onClick={() => abrirDetalleDeuda(r)}
                              title="Ver detalle de la deuda"
                              aria-label="Ver detalle de la deuda"
                            >
                              <FontAwesomeIcon icon={faInfoCircle} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="gm-order-table-foot gm-table-foot">
                    <div className="gm-order-table-foot-stats">
                      <span className="gm-table-stat">
                        Total <b>{deudasOrdenadas.length}</b>
                      </span>
                      <span className="gm-table-stat-sep" />
                      <span className="gm-table-stat">
                        Seleccionadas <b>{cantSeleccionadas}</b>
                      </span>
                    </div>
                    <div className="gm-order-table-foot-totals">
                      <div className="gm-summary-chip gm-summary-chip--total gm-order-total-pill">
                        <span>Saldo seleccionado</span>
                        <b>{moneyARS(totalSeleccionado)}</b>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Aside de pago */}
                <div className="gm-movement-side">
                  <aside className="gm-aside">
                    <div className="gm-section">
                      <div className="gm-section-head">
                        <div className="gm-section-dot" />
                        <span>Datos del pago</span>
                      </div>

                      <div className="gm-section-body">
                        <button
                          type="button"
                          className="gm-action-btn gm-action-btn--soft gm-action-btn--block gm-order-select-all-btn"
                          onClick={toggleAll}
                          disabled={!deudasOrdenadas.length || loading}
                        >
                          <span className="gm-action-btn__icon">
                            <FontAwesomeIcon icon={faListCheck} style={{ fontSize: 10 }} />
                          </span>
                          {pagaTodo ? "Deseleccionar todas" : "Seleccionar todas"}
                        </button>

                        <div className="gm-section-divider" />

                        <PanelMediosPago
                          mediosFilas={mediosFilas}
                          mediosPagoList={mediosPago}
                          totalSeleccionado={totalSeleccionado}
                          onUpdate={updateMedioPago}
                          onRemove={removeMedioPago}
                          onAdd={addMedioPago}
                          saving={loading}
                          loadingMedios={loadingMedios}
                          sumaMediosPago={sumaMediosPago}
                          diferenciaRestante={diferenciaRestante}
                          showToast={showToast}
                        />
                      </div>
                    </div>
                  </aside>

                  <div className="gm-actions">
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--pay"
                      onClick={handleConfirm}
                      disabled={!canConfirm}
                    >
                      {loading ? (
                        <>
                          <FontAwesomeIcon icon={faCircleNotch} spin style={{ marginRight: 6 }} />
                          Procesando…
                        </>
                      ) : (
                        "Confirmar pago"
                      )}
                    </button>
                    <button
                      type="button"
                      className="gm-action-btn gm-action-btn--cancel"
                      onClick={onClose}
                      disabled={loading}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      <ModalDetalleMovimiento
        open={openDetalleDeuda}
        row={detalleDeudaRow}
        title="Detalle de deuda a pagar"
        hideMediosPago
        onClose={cerrarDetalleDeuda}
      />

      <ModalOrdenPagoGenerada
        open={openOrden}
        html={ordenHtml}
        title={ordenTitle}
        onToast={onToast}
        onClose={() => {
          setOpenOrden(false);
          onClose?.();
        }}
        idsMovimientos={idsMovimientosPagados}
        idsPagos={idsPagosGenerados}
        idCobro={ultimoCobroId}
        onFinalizar={(saved) => {
          onOrdenPagoFinalizado?.(saved, {
            idsMovimiento: idsMovimientosPagados,
            idCobro: ultimoCobroId,
            idsPago: idsPagosGenerados,
          });
          setOpenOrden(false);
          onClose?.();
        }}
      />
    </>,
    document.body
  );
}
