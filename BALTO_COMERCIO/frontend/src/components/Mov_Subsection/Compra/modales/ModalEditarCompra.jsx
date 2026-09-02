import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { comprasFetch } from "../api/comprasApi.js";
import { filtrarMediosPagoPorPlan } from "../../_shared/planMediosPago";
import useStockBarcodeScanner from "../../_shared/useStockBarcodeScanner.js";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "./ModalCompra.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileInvoiceDollar,
  faUpload,
  faTrashCan,
  faEye,
  faXmark,
  faMoneyCheckDollar,
  faCircleNotch,
  faPlus,
  faTrash,
  faBackspace,
  faBasketShopping,
} from "@fortawesome/free-solid-svg-icons";
import ModalVerComprobante from "../../../Global/Ver_Comprobantes/ModalVerComprobante.jsx";

const NULL_OPTION = "";
const ADD_OPTION = "__ADD__";
const NOMBRE_COMPROBANTE_GENERICO = "Comprobante adjunto";

const IVA_OPTIONS = [
  { label: "0 %", value: 0 },
  { label: "10,5 %", value: 10.5 },
  { label: "21 %", value: 21 },
  { label: "27 %", value: 27 },
];

/* =========================
   Helpers base
========================= */
function uid() {
  return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function safeNumber(v) {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatFechaDMY(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${String(Number(m[3])).padStart(2, "0")}/${String(Number(m[2])).padStart(2, "0")}/${m[1]}`;
  return s;
}
function calcItemTotals(cantidad, precio, ivaPct) {
  const c = Math.max(0, safeNumber(cantidad));
  const p = Math.max(0, safeNumber(precio));
  const iva = Math.max(0, safeNumber(ivaPct));
  const subtotal = c * p;
  const iva_monto = subtotal * (iva / 100);
  const total = subtotal + iva_monto;
  const r2 = (n) => Math.round(n * 100) / 100;
  return { subtotal: r2(subtotal), iva_monto: r2(iva_monto), total: r2(total) };
}

function formatMoneyInputARS(v) {
  const n = safeNumber(v);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function isAllowedComprobanteFile(file) {
  if (!file) return false;

  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();

  const isImageMime = mime.startsWith("image/");
  const isPdfMime = mime === "application/pdf";

  const isImageExt = /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif)$/i.test(name);
  const isPdfExt = /\.pdf$/i.test(name);

  return isImageMime || isPdfMime || isImageExt || isPdfExt;
}
function getChequeIdsArray(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
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
    chequesCarteraCargados: false,
    // En edición, cuando la compra ya tiene cheque/eCheq vinculado,
    // se muestra solamente ese cheque y no se vuelve a listar toda la cartera.
    soloChequeVinculado: false,
  };
}

function ChequesCarteraCardsCompra({
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
            className={`gm-check-item ${checked ? "gm-check-item--selected" : ""} ${esEcheq ? "gm-check-item--echeq" : ""}`}
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
                <span className="gm-check-issuer" title={safeText(ch?.emisor) || "-"}>{safeText(ch?.emisor) || "-"}</span>
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

function MedioPagoInlineCompraRow({
  row,
  mediosPagoList,
  onUpdate,
  onRemove,
  saving,
  showToast,
  canRemove,
  totalSeleccionado,
  sumaMediosPago,
  apiGet,
  BASE_URL,
}) {
  const mpSeleccionado = useMemo(
    () => mediosPagoList.find((x) => String(getMedioPagoId(x)) === String(row.id_medio_pago)) || null,
    [mediosPagoList, row.id_medio_pago]
  );
  const tipoCheque = useMemo(() => normalizeChequeTipoFromMedio(mpSeleccionado?.nombre || ""), [mpSeleccionado]);
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
      const ch = row.chequesDisponibles.find((x) => String(x.id_cheque) === idStr);
      return acc + (ch ? Number(ch.importe || 0) : 0);
    }, 0);
  }, [esCheque, chequesSeleccionados, row.chequesDisponibles]);

  const restanteParaEstaFila = useMemo(() => {
    const sumaOtros = Math.max(0, safeNumber(sumaMediosPago) - safeNumber(row.monto));
    return Math.max(0, safeNumber(totalSeleccionado) - sumaOtros);
  }, [sumaMediosPago, totalSeleccionado, row.monto]);

  const puedeCompletarRestante = !saving && !esCheque && totalSeleccionado > 0 && restanteParaEstaFila > 0.009;
  const chequesFetchSeqRef = useRef(0);

  const handleChangeMedio = useCallback(
    (val) => {
      const mp = mediosPagoList.find((x) => String(getMedioPagoId(x)) === String(val));
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
        monto: tipo !== null ? 0 : row.monto,
        montoDraft: "",
        montoFocused: false,
      });
    },
    [row.id, row.monto, mediosPagoList, onUpdate]
  );

  useEffect(() => {
    if (!esCheque || !tipoCheque || soloChequeVinculado) return;

    const maxImporte = Math.max(0, safeNumber(restanteParaEstaFila));
    const maxKey = `${tipoCheque}:${Math.round(maxImporte * 100) / 100}`;

    if (maxImporte <= 0.009) {
      if (row.chequesMaxKey !== maxKey || row.loadingCheques || chequesSeleccionados.length > 0 || (Array.isArray(row.chequesDisponibles) && row.chequesDisponibles.length > 0)) {
        chequesFetchSeqRef.current += 1;
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

    const seq = ++chequesFetchSeqRef.current;
    onUpdate(row.id, { loadingCheques: true, chequesCarteraCargados: false, chequesTipoCargado: tipoCheque });

    (async () => {
      try {
        const sp = new URLSearchParams();
        sp.set("action", "mov_global_cheques_cartera_listar");
        sp.set("tipo", tipoCheque);
        sp.set("max_importe", String(maxImporte));
        const data = await apiGet(`${BASE_URL}/api.php?${sp.toString()}`);
        if (chequesFetchSeqRef.current !== seq) return;

        const cheques = Array.isArray(data?.cheques) ? data.cheques : [];
        const idsDisponibles = new Set(cheques.map((ch) => String(ch?.id_cheque || "")).filter(Boolean));
        const idsActuales = getChequeIdsArray(row.id_cheque);
        const idsValidos = idsActuales.filter((id) => idsDisponibles.has(String(id)));

        onUpdate(row.id, {
          id_cheque: idsValidos,
          chequesDisponibles: cheques,
          loadingCheques: false,
          chequesCarteraCargados: true,
          soloChequeVinculado: false,
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
          chequesCarteraCargados: true,
          soloChequeVinculado: false,
          chequesMaxKey: maxKey,
          chequesTipoCargado: tipoCheque,
          monto: 0,
          montoDraft: "",
          montoFocused: false,
        });
        showToast("error", e?.message || "No se pudieron cargar los cheques.", 4000);
      }
    })();
  }, [
    esCheque,
    tipoCheque,
    soloChequeVinculado,
    restanteParaEstaFila,
    row.id,
    row.id_cheque,
    row.loadingCheques,
    row.chequesMaxKey,
    row.chequesDisponibles,
    apiGet,
    BASE_URL,
    onUpdate,
    showToast,
    chequesSeleccionados.length,
  ]);

  const handleToggleCheque = useCallback(
    (idChequeStr) => {
      if (soloChequeVinculado) return;

      const current = getChequeIdsArray(row.id_cheque);
      const next = current.includes(idChequeStr) ? current.filter((x) => x !== idChequeStr) : [...current, idChequeStr];
      onUpdate(row.id, { id_cheque: next });
    },
    [row.id, row.id_cheque, onUpdate, soloChequeVinculado]
  );

  useEffect(() => {
    if (esCheque && chequesSeleccionados.length > 0) {
      onUpdate(row.id, { monto: importeCheques, montoDraft: "", montoFocused: false });
    }
  }, [importeCheques, esCheque, chequesSeleccionados.length, onUpdate, row.id]);

  return (
    <div className="gm-payment-card">
      <div className="gm-payment-row gm-payment-row--method">
        <div className="gm-field" style={{ position: "relative" }}>
          <select className="gm-input gm-select" value={String(row.id_medio_pago || "")} onChange={(e) => handleChangeMedio(e.target.value)} disabled={saving}>
            <option value="">Seleccionar…</option>
            {mediosPagoList.map((x) => (
              <option key={getMedioPagoId(x) || x?.nombre} value={String(getMedioPagoId(x) || "")}>
                {x.nombre}
              </option>
            ))}
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
            value={row.montoFocused ? row.montoDraft ?? "" : formatMoneyInputARS(esCheque ? importeCheques : row.monto)}
            onFocus={(e) => {
              if (saving || (esCheque && chequesSeleccionados.length > 0)) return;
              onUpdate(row.id, {
                montoFocused: true,
                montoDraft: formatEditableMoney(esCheque ? importeCheques : row.monto),
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
              background: esCheque && chequesSeleccionados.length > 0 ? "rgba(0,0,0,.03)" : undefined,
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
              onClick={() => onUpdate(row.id, { monto: restanteParaEstaFila, montoDraft: "", montoFocused: false })}
              disabled={!puedeCompletarRestante}
              title="Completar importe restante"
            >
              ↓ Rest.
            </button>
          )}
          {canRemove && (
            <button type="button" className="gm-payment-delete" onClick={() => onRemove(row.id)} disabled={saving} title="Quitar medio de pago">
              ×
            </button>
          )}
        </div>
      </div>

      {esCheque && (
        <div className="gm-payment-checks">
          <div className="gm-payment-checks-title">
            <FontAwesomeIcon icon={faMoneyCheckDollar} style={{ fontSize: 11 }} />
            {soloChequeVinculado
              ? esEcheq ? "eCheq vinculado" : "Cheque vinculado"
              : esEcheq ? "eCheqs en cartera" : "Cheques en cartera"}
          </div>
          {row.loadingCheques ? (
            <div className="gm-payment-checks-loading">
              <FontAwesomeIcon icon={faCircleNotch} spin style={{ marginRight: 6 }} />
              Cargando…
            </div>
          ) : !Array.isArray(chequesAMostrar) || chequesAMostrar.length === 0 ? (
            <div className="gm-payment-checks-empty">
              {soloChequeVinculado
                ? `No se encontró el ${esEcheq ? "eCheq" : "cheque"} vinculado.`
                : `No hay ${esEcheq ? "eCheqs" : "cheques"} activos en cartera.`}
            </div>
          ) : (
            <ChequesCarteraCardsCompra
              cheques={chequesAMostrar}
              idsSeleccionados={chequesSeleccionados}
              onToggle={handleToggleCheque}
              esEcheq={esEcheq}
              soloLectura={soloChequeVinculado}
            />
          )}
          {chequesSeleccionados.length > 0 && <div className="gm-upload-card__sub">✓ {chequesSeleccionados.length} cheque(s) — {moneyARS(importeCheques)}</div>}
        </div>
      )}
    </div>
  );
}

function PanelMediosPagoCompraLocal({
  mediosFilas,
  mediosPagoList,
  totalCompra,
  onUpdate,
  onRemove,
  onAdd,
  apiGet,
  BASE_URL,
  showToast,
  saving,
}) {
  const sumaMediosPago = useMemo(
    () => (Array.isArray(mediosFilas) ? mediosFilas : []).reduce((acc, mp) => acc + safeNumber(mp?.monto), 0),
    [mediosFilas]
  );
  const diferenciaRestante = Math.max(0, safeNumber(totalCompra) - safeNumber(sumaMediosPago));

  return (
    <>
      {(Array.isArray(mediosFilas) ? mediosFilas : []).map((mp) => (
        <MedioPagoInlineCompraRow
          key={mp.id}
          row={mp}
          mediosPagoList={mediosPagoList}
          onUpdate={onUpdate}
          onRemove={onRemove}
          saving={saving}
          showToast={showToast}
          canRemove={mediosFilas.length > 1}
          totalSeleccionado={totalCompra}
          sumaMediosPago={sumaMediosPago}
          apiGet={apiGet}
          BASE_URL={BASE_URL}
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

/* =========================
   IDs tolerantes
========================= */
function getGenericId(x) {
  const cand =
    x?.id ??
    x?.ID ??
    x?.id_item ??
    x?.idCatalogo ??
    x?.id_cuenta_corriente ??
    x?.id_medio_pago ??
    x?.id_cliente ??
    x?.id_proveedor ??
    x?.id_stock_producto ??
    x?.idStockProducto ??
    x?.stock_producto_id ??
    x?.id_detalle ??
    x?.idDetalle ??
    x?.detalle_id ??
    x?.id_tipo_venta ??
    x?.id_tipo_movimiento ??
    x?.id_comprobante ??
    x?.id_cheque ??
    null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getMedioPagoId(mp) {
  const c = mp?.id ?? mp?.id_medio_pago ?? mp?.medio_pago_id ?? mp?.idMedioPago ?? null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function isPositiveId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/* =========================
   Normalización
========================= */
function normalizeText(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}
function getTipoVentaObj(tiposVentaArr, idTipoVenta) {
  const sid = String(idTipoVenta ?? "").trim();
  if (!sid || sid === NULL_OPTION) return null;
  return (
    (Array.isArray(tiposVentaArr) ? tiposVentaArr : []).find(
      (x) => String(getGenericId(x) ?? x?.id) === sid
    ) || null
  );
}
function isTipoVentaContado(tipoVentaObj) {
  const n = normalizeText(tipoVentaObj?.nombre ?? "");
  if (!n) return true;
  return n.includes("contado") || n.includes("efectivo") || n.includes("cash");
}
function normalizeChequeTipoFromMedio(nombre) {
  const s = normalizeText(nombre);
  if (!s) return null;
  if (s.includes("echeq") || s.includes("e-cheq") || s.includes("e cheq")) return "echeq";
  if (s.includes("cheque")) return "cheque";
  return null;
}
function buildSingleCuentaCorrienteOption(arrRaw) {
  const arr = Array.isArray(arrRaw) ? arrRaw : [];
  if (!arr.length) return { list: [], pickedId: null };
  const hit = arr.find((x) => normalizeText(x?.nombre).includes("cuenta corriente")) || arr[0];
  const pickedId = getGenericId(hit);
  if (!pickedId) return { list: [], pickedId: null };
  return { list: [{ id: pickedId, nombre: "Cuenta Corriente" }], pickedId };
}

/* =========================
   Auth + API
========================= */
function getAuthInfo() {
  const token = localStorage.getItem("token") || "";
  const sessionKey =
    localStorage.getItem("session_key") ||
    localStorage.getItem("sessionKey") ||
    localStorage.getItem("x_session") ||
    localStorage.getItem("X-Session") ||
    "";
  let idUsuario = 0;
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null");
    const cand = u?.idUsuario ?? u?.id_usuario ?? u?.id ?? u?.user_id ?? 0;
    if (Number.isFinite(Number(cand))) idUsuario = Number(cand);
  } catch {}
  return { token, sessionKey, idUsuario };
}
async function parseJsonOrThrow(res) {
  const text = await res.text();
  if (!text) throw new Error("Respuesta vacía del servidor.");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
    throw new Error(`Respuesta inválida del servidor (no es JSON). HTTP ${res.status}\n${preview}`);
  }
  if (!res.ok) {
    const msg = data?.mensaje || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
function buildAuthHeaders(isJson = true) {
  const { token, sessionKey } = getAuthInfo();
  const headers = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (sessionKey) headers["X-Session"] = sessionKey;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
async function apiGet(url) {
  const res = await comprasFetch(url, { method: "GET", headers: buildAuthHeaders(false) });
  return await parseJsonOrThrow(res);
}

async function fetchComprasListasFresh() {
  const base = String(BASE_URL || "").replace(/\/+$/, "");
  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}/api.php${sep}action=global_obtener_listas&contexto=compras&include_sin_stock=1&_=${Date.now()}`;
  const res = await comprasFetch(url, {
    method: "GET",
    headers: buildAuthHeaders(false),
    cache: "no-store",
  });
  return await parseJsonOrThrow(res);
}

async function apiPostJson(url, payload) {
  const res = await comprasFetch(url, {
    method: "POST",
    headers: buildAuthHeaders(true),
    body: JSON.stringify(payload ?? {}),
  });
  return await parseJsonOrThrow(res);
}
async function apiPostForm(url, formData) {
  const res = await comprasFetch(url, {
    method: "POST",
    headers: buildAuthHeaders(false),
    body: formData,
  });
  return await parseJsonOrThrow(res);
}

/* =========================
   Helpers comprobante
========================= */
function extractIdComprobanteFromUrlLike(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m1 = s.match(/[?&]id_comprobante=(\d+)/i);
  if (m1) {
    const n = Number(m1[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m2 = s.match(/[?&]id=(\d+)/i);
  if (m2) {
    const n = Number(m2[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}
function getComprobanteIdFromRow(row) {
  const directCandidates = [
    row?.id_comprobante_principal,
    row?.id_comprobante,
    row?.comprobante_id,
    row?.factura_id_comprobante,
    row?.idFacturaComprobante,
  ];
  for (const cand of directCandidates) {
    const n = Number(cand);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const urlCandidates = [
    row?.factura_url, row?.factura, row?.comprobante_url, row?.comprobante,
    row?.archivo_url, row?.url_factura, row?.path_factura, row?.factura_path,
  ];
  for (const u of urlCandidates) {
    const n = extractIdComprobanteFromUrlLike(u);
    if (n) return n;
  }
  return null;
}
function getComprobanteUrl(row) {
  const idComp = getComprobanteIdFromRow(row);
  if (idComp) {
    const sp = new URLSearchParams();
    sp.set("action", "compras_comprobantes_descargar");
    sp.set("id_comprobante", String(idComp));
    return `${BASE_URL}/api.php?${sp.toString()}`;
  }
  const candidates = [
    row?.factura_url, row?.factura, row?.comprobante_url, row?.comprobante,
    row?.archivo_url, row?.url_factura, row?.path_factura, row?.factura_path,
  ];
  const raw = candidates.find((x) => typeof x === "string" && x.trim() !== "");
  if (!raw) return "";
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(BASE_URL || "").replace(/\/$/, "");
  const rel = s.replace(/^\//, "");
  return `${base}/${rel}`;
}
function guessExtensionFromValue(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  const clean = s.split("?")[0].split("#")[0];
  if (clean.endsWith(".pdf")) return ".pdf";
  if (clean.endsWith(".jpg")) return ".jpg";
  if (clean.endsWith(".jpeg")) return ".jpeg";
  if (clean.endsWith(".png")) return ".png";
  if (clean.endsWith(".webp")) return ".webp";
  return "";
}
function sanitizeDisplayName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const onlyName = raw.split("/").pop()?.split("\\").pop()?.split("?")[0]?.trim() || "";
  if (!onlyName) return "";
  const lowered = onlyName.toLowerCase();
  if (
    lowered.includes("api.php") ||
    lowered.includes("action=") ||
    (lowered.includes("comprobante") && lowered.includes("="))
  ) return "";
  return onlyName;
}
function getFriendlyComprobanteName() {
  return NOMBRE_COMPROBANTE_GENERICO;
}

/* =========================
   Safe lists + normalización
========================= */
const SAFE_LISTS = {
  tiposVenta: [],
  cuentasCorrientes: [],
  tiposMovimiento: [],
  proveedores: [],
  detalles: [],
  mediosPago: [],
};
function normalizeIncomingLists(lists) {
  const l = lists && typeof lists === "object" ? lists : {};
  const src = l.listas && typeof l.listas === "object" ? l.listas : l;

  const tiposMov =
    Array.isArray(src.tiposMovimiento) && src.tiposMovimiento.length
      ? src.tiposMovimiento
      : Array.isArray(src.tipos_movimiento) ? src.tipos_movimiento : [];

  const tiposVenta =
    Array.isArray(src.tiposVenta) && src.tiposVenta.length
      ? src.tiposVenta
      : Array.isArray(src.tipos_venta) ? src.tipos_venta : [];

  const cuentas =
    Array.isArray(src.cuentasCorrientes) && src.cuentasCorrientes.length
      ? src.cuentasCorrientes
      : Array.isArray(src.cuentas_corrientes) ? src.cuentas_corrientes
      : Array.isArray(src.cuenta_corriente) ? src.cuenta_corriente : [];

  const medios =
    Array.isArray(src.mediosPago) && src.mediosPago.length
      ? src.mediosPago
      : Array.isArray(src.medios_pago) ? src.medios_pago
      : Array.isArray(src.medios) ? src.medios : [];

  const proveedores =
    Array.isArray(src.proveedores) && src.proveedores.length
      ? src.proveedores
      : Array.isArray(src.proveedor) ? src.proveedor : [];

  const detallesCompras = Array.isArray(src.detalles_compras) && src.detalles_compras.length
    ? src.detalles_compras
    : Array.isArray(src.detallesCompras) && src.detallesCompras.length
    ? src.detallesCompras
    : Array.isArray(src.detalles_todos) && src.detalles_todos.length
    ? src.detalles_todos
    : Array.isArray(src.detallesTodos) ? src.detallesTodos : [];

  return {
    tiposVenta: Array.isArray(tiposVenta) ? tiposVenta : [],
    cuentasCorrientes: Array.isArray(cuentas) ? cuentas : [],
    tiposMovimiento: Array.isArray(tiposMov) ? tiposMov : [],
    proveedores,
    detalles: detallesCompras.length ? detallesCompras : Array.isArray(src.detalles) ? src.detalles : [],
    mediosPago: Array.isArray(medios) ? medios : [],
  };
}
function findIdByIncludes(arr, includesText) {
  const inc = normalizeText(includesText);
  const a = Array.isArray(arr) ? arr : [];
  const hit = a.find((x) => normalizeText(x?.nombre).includes(inc));
  const id = getGenericId(hit);
  return id ? String(id) : NULL_OPTION;
}
function nameById(arr, id) {
  const sid = String(id ?? "").trim();
  if (!sid || sid === NULL_OPTION || sid === ADD_OPTION) return "";
  const found = (Array.isArray(arr) ? arr : []).find(
    (x) => String(getGenericId(x) ?? x?.id) === sid
  );
  return String(found?.nombre ?? "").trim();
}

function getCompraItemsDetalle(row) {
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

function getPrimerItemCompra(row) {
  const items = getCompraItemsDetalle(row);
  return items.length ? items[0] : null;
}

function getProductoIdFromCompra(row) {
  const item = getPrimerItemCompra(row);
  const cand =
    item?.id_stock_producto ??
    item?.idStockProducto ??
    item?.stock_producto_id ??
    item?.id_detalle ??
    item?.idDetalle ??
    row?.id_stock_producto ??
    row?.idStockProducto ??
    row?.stock_producto_id ??
    row?.id_detalle ??
    row?.idDetalle ??
    null;

  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? String(n) : NULL_OPTION;
}
function getVarianteIdFromCompra(row) {
  const item = getPrimerItemCompra(row);
  const cand =
    item?.id_stock_variante ??
    item?.idStockVariante ??
    item?.stock_variante_id ??
    row?.id_stock_variante ??
    row?.idStockVariante ??
    row?.stock_variante_id ??
    null;

  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? String(n) : NULL_OPTION;
}

function getStockProductoIdFromSelection(item) {
  const cand =
    item?.id_stock_producto ??
    item?.idStockProducto ??
    item?.stock_producto_id ??
    item?.id_producto ??
    item?.id ??
    null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getStockVarianteIdFromSelection(item) {
  const cand =
    item?.id_stock_variante ??
    item?.idStockVariante ??
    item?.stock_variante_id ??
    item?.id_variante ??
    null;
  const n = Number(cand);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isResumenProductosLabel(value) {
  const s = normalizeText(value);
  return (
    s === "sin productos" ||
    /^\d+\s+producto(s)?$/.test(s) ||
    /^producto(s)?\s*:\s*\d+$/.test(s)
  );
}

function getProductoNombreFromCompra(row) {
  const item = getPrimerItemCompra(row);
  const producto = String(
    item?.producto_nombre ??
    item?.stock_producto_nombre ??
    item?.detalle_nombre ??
    item?.nombre ??
    item?.descripcion ??
    ""
  ).trim();
  const variante = String(
    item?.variante_nombre ??
    item?.stock_variante_nombre ??
    item?.nombre_variante ??
    ""
  ).trim();
  if (producto) return [producto, variante].filter(Boolean).join(" - ");

  const original = String(row?.detalle_original ?? row?.producto_nombre ?? row?.stock_producto_nombre ?? "").trim();
  if (original) return original.split("|")[0].trim();

  const detalle = String(row?.detalle ?? "").trim();
  return detalle && !isResumenProductosLabel(detalle) ? detalle : "";
}

function getNumeroFromItemOCompra(row, item, keys, fallback) {
  for (const key of keys) {
    const value = item?.[key] ?? row?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

/* =========================
   Build form + medios
========================= */
function buildFormFromRowCompra(row, fixedLocal) {
  const r = row || {};
  const item = getPrimerItemCompra(r);
  const nOrNull = (v) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? String(Number(v)) : NULL_OPTION;

  const cantidad = Math.max(
    0,
    getNumeroFromItemOCompra(r, item, ["cantidad"], 1)
  );
  const precio = Math.max(
    0,
    getNumeroFromItemOCompra(r, item, ["precio"], safeNumber(r.monto_total))
  );
  const iva_pct = Math.max(
    0,
    getNumeroFromItemOCompra(r, item, ["iva_pct", "ivaPct"], 0)
  );

  const totals = calcItemTotals(cantidad, precio, iva_pct);
  const subtotal = getNumeroFromItemOCompra(r, item, ["subtotal"], totals.subtotal);
  const iva_monto = getNumeroFromItemOCompra(r, item, ["iva_monto", "ivaMonto"], totals.iva_monto);
  const total = getNumeroFromItemOCompra(r, item, ["total"], totals.total);
  const monto_total = r.monto_total != null ? safeNumber(r.monto_total) : total;

  const fallbackTipoVenta = isPositiveId(r?.id_tipo_venta)
    ? String(Number(r.id_tipo_venta))
    : normalizeText(r?.cuenta_corriente).includes("cuenta corriente") ? "2" : "1";

  return {
    id_movimiento: safeNumber(r.id_movimiento ?? r.id ?? r.id_compra) || null,
    fecha: String(r.fecha || "").slice(0, 10) || "",
    id_tipo_venta: nOrNull(r.id_tipo_venta) || fallbackTipoVenta,
    id_tipo_movimiento: fixedLocal?.idEntrada ?? NULL_OPTION,
    id_proveedor: nOrNull(r.id_proveedor),
    // En la tabla se muestra "1 PRODUCTO" como resumen. Para editar, se usa el producto real
    // guardado en movimientos_items.id_stock_producto. El backend de compras lo recibe como id_detalle
    // por compatibilidad, pero representa un producto de stock.
    id_detalle: getProductoIdFromCompra(r),
    id_stock_variante: getVarianteIdFromCompra(r),
    monto_total: Math.max(0, Math.round(monto_total * 100) / 100),
    cantidad: Math.max(0, Math.round(cantidad * 1000) / 1000),
    precio: Math.max(0, Math.round(precio * 100) / 100),
    iva_pct: Math.max(0, Math.round(iva_pct * 100) / 100),
    subtotal: Math.max(0, Math.round(subtotal * 100) / 100),
    iva_monto: Math.max(0, Math.round(iva_monto * 100) / 100),
    total: Math.max(0, Math.round(total * 100) / 100),
  };
}

function compraPayloadCoincideConRow(payload, row) {
  if (!payload || !row) return false;
  const original = buildFormFromRowCompra(row, {});
  const id = (v) => {
    if (v === NULL_OPTION || v === ADD_OPTION || v == null || v === "") return 0;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const moneyEq = (a, b, tolerance = 0.01) => Math.abs(safeNumber(a) - safeNumber(b)) <= tolerance;
  const qtyEq = (a, b) => Math.abs(safeNumber(a) - safeNumber(b)) <= 0.001;

  const payloadProductoId = id(payload.id_stock_producto ?? payload.id_detalle);
  const payloadVarianteId = id(payload.id_stock_variante);

  return (
    String(payload.fecha || "").slice(0, 10) === String(original.fecha || "").slice(0, 10) &&
    id(payload.id_tipo_venta) === id(original.id_tipo_venta) &&
    id(payload.id_proveedor) === id(original.id_proveedor) &&
    payloadProductoId === id(original.id_detalle) &&
    payloadVarianteId === id(original.id_stock_variante) &&
    qtyEq(payload.cantidad, original.cantidad) &&
    moneyEq(payload.precio, original.precio) &&
    moneyEq(payload.iva_pct, original.iva_pct) &&
    moneyEq(payload.subtotal, original.subtotal) &&
    moneyEq(payload.iva_monto, original.iva_monto) &&
    moneyEq(payload.total ?? payload.monto_total, original.total)
  );
}
function buildMediosFromRowCompra(row, mediosPagoList) {
  const list = Array.isArray(row?.medios_pago_detalle) ? row.medios_pago_detalle : [];
  const out = [];
  const groupedCheque = new Map();

  if (list.length) {
    for (const mp of list) {
      const idMedio = Number(mp?.id_medio_pago || 0);
      if (!(idMedio > 0)) continue;
      const medioObj = (Array.isArray(mediosPagoList) ? mediosPagoList : []).find(
        (x) => String(getGenericId(x) ?? x?.id_medio_pago) === String(idMedio)
      );
      const tipoCheque =
        normalizeChequeTipoFromMedio(medioObj?.nombre || "") ||
        normalizeText(mp?.cheque_tipo || "");
      const idCheque = Number(mp?.id_cheque || 0);

      if ((tipoCheque === "cheque" || tipoCheque === "echeq") && idCheque > 0) {
        const key = `${idMedio}|${tipoCheque}`;
        if (!groupedCheque.has(key)) {
          groupedCheque.set(key, {
            id: uid(),
            id_medio_pago: String(idMedio),
            monto: 0,
            montoDraft: "",
            montoFocused: false,
            id_cheque: [],
            chequesDisponibles: [],
            loadingCheques: false,
            // CLAVE: ya tenemos el cheque de la compra. En editar no hay que traer toda la cartera.
            chequesCarteraCargados: true,
            soloChequeVinculado: true,
          });
        }
        const rowMp = groupedCheque.get(key);
        rowMp.id_cheque.push(String(idCheque));
        rowMp.chequesDisponibles.push({
          id_cheque: idCheque,
          tipo: tipoCheque,
          emisor: safeText(mp?.emisor ?? mp?.cheque_emisor ?? ""),
          numero_cheque: safeText(mp?.numero_cheque ?? mp?.cheque_numero ?? ""),
          fecha_emision: safeText(mp?.fecha_emision ?? mp?.cheque_fecha_emision ?? ""),
          fecha_pago: safeText(mp?.fecha_pago ?? mp?.cheque_fecha_pago ?? ""),
          importe: safeNumber(mp?.cheque_importe || mp?.monto || 0),
        });
        rowMp.monto =
          Math.round(
            (safeNumber(rowMp.monto) + safeNumber(mp?.cheque_importe || mp?.monto || 0)) * 100
          ) / 100;
      } else {
        out.push({
          id: uid(),
          id_medio_pago: String(idMedio),
          monto: Math.round(safeNumber(mp?.monto) * 100) / 100,
          montoDraft: "",
          montoFocused: false,
          id_cheque: [],
          chequesDisponibles: [],
          loadingCheques: false,
          chequesCarteraCargados: false,
          soloChequeVinculado: false,
        });
      }
    }
  } else if (isPositiveId(row?.id_medio_pago)) {
    out.push({
      id: uid(),
      id_medio_pago: String(Number(row.id_medio_pago)),
      monto: Math.round(safeNumber(row?.monto_total) * 100) / 100,
      montoDraft: "",
      montoFocused: false,
      id_cheque: [],
      chequesDisponibles: [],
      loadingCheques: false,
      soloChequeVinculado: false,
    });
  }

  groupedCheque.forEach((value) => out.push(value));
  return out.length ? out : [buildEmptyMedioPago()];
}

/* =========================
   Mini modal reutilizable (agregar catálogo)
========================= */
function AddCatalogMiniModal({
  open, title, label = "Nombre", value, saving,
  onChange, onCancel, onSave, dark = false,
}) {
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
    <div className="gm-mini-overlay" onMouseDown={onCancel}>
      <div
        className="gm-mini-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gm-mini-head">
          <h4 className="gm-mini-title">{title}</h4>
          <button type="button" className="gm-mini-close" onClick={onCancel} disabled={saving} aria-label="Cerrar">✕</button>
        </div>
        <div className="gm-mini-body">
          <div className="gm-field">
            <input
              ref={inputRef}
              className="gm-input"
              placeholder=" "
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              disabled={saving}
              autoComplete="off"
            />
            <label className={`gm-label${value ? " gm-label--up" : ""}`}>{label}</label>
          </div>
          <div className="gm-mini-actions">
            <button type="button" className="gm-action-btn gm-action-btn--cancel" onClick={onCancel} disabled={saving}>Cancelar</button>
            <button type="button" className="gm-action-btn gm-action-btn--save" onClick={onSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ============================================================
   MODAL PRINCIPAL — ModalEditarCompra
============================================================ */
export default function ModalEditarCompra({
  open,
  lists,
  row,
  onClose,
  onSave,
  onSaved,
  onToast,
  onCatalogCreated,
  dark: darkProp,
}) {
  const ENDPOINT_BASE = `${BASE_URL}/api.php`;
  const ENDPOINT_UPLOAD_LINK = `${BASE_URL}/api.php?action=compras_comprobantes_vincular_movimientos_lote_upload`;
  const ENDPOINT_DELETE_COMP = `${BASE_URL}/api.php?action=compras_eliminar_comprobante`;

  const showToast = useCallback(
    (tipo, mensaje, duracion = 2800) => onToast?.(tipo, mensaje, duracion),
    [onToast]
  );

  const [darkAuto, setDarkAuto] = useState(isTemaOscuro());
  useEffect(() => {
    const update = () => setDarkAuto(isTemaOscuro());
    const obsHtml = new MutationObserver(update);
    obsHtml.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const obsBody = new MutationObserver(update);
    if (document.body) obsBody.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    update();
    return () => {
      obsHtml.disconnect();
      obsBody.disconnect();
    };
  }, []);
  const dark = typeof darkProp === "boolean" ? darkProp : darkAuto;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const listsRef = useRef(lists);
  const rowRef = useRef(row);
  useEffect(() => void (listsRef.current = lists), [lists]);
  useEffect(() => void (rowRef.current = row), [row]);

  const [localLists, setLocalLists] = useState(() => ({
    ...SAFE_LISTS, ...normalizeIncomingLists(lists),
  }));
  useEffect(() => {
    setLocalLists({ ...SAFE_LISTS, ...normalizeIncomingLists(lists) });
  }, [lists]);

  useEffect(() => {
    if (!open) return undefined;

    let alive = true;
    (async () => {
      try {
        const data = await fetchComprasListasFresh();
        if (!alive || !data?.exito) return;

        const fresh = normalizeIncomingLists(data);
        setLocalLists((prev) => ({
          ...SAFE_LISTS,
          ...prev,
          ...fresh,
          // En compras, la lista completa de productos debe pisar cualquier cache filtrado por stock.
          detalles: Array.isArray(fresh.detalles) ? fresh.detalles : [],
        }));
      } catch {
        // Si falla el refresco puntual, queda la lista recibida por contexto.
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  const safeLists = useMemo(
    () => ({
      ...localLists,
      mediosPago: filtrarMediosPagoPorPlan(localLists.mediosPago),
    }),
    [localLists]
  );

  const refreshBarcodeCatalog = useCallback(async () => {
    const data = await fetchComprasListasFresh();
    if (!data?.exito) return [];

    const fresh = normalizeIncomingLists(data);
    const detalles = Array.isArray(fresh.detalles) ? fresh.detalles : [];
    setLocalLists((prev) => ({
      ...SAFE_LISTS,
      ...prev,
      ...fresh,
      detalles,
    }));
    return detalles;
  }, []);
  const tiposVentaUI = useMemo(() => {
    if (Array.isArray(safeLists.tiposVenta) && safeLists.tiposVenta.length) return safeLists.tiposVenta;
    return [{ id: 1, nombre: "CONTADO" }, { id: 2, nombre: "CUENTA CORRIENTE" }];
  }, [safeLists.tiposVenta]);

  const ccNormalized = useMemo(
    () => buildSingleCuentaCorrienteOption(safeLists.cuentasCorrientes),
    [safeLists.cuentasCorrientes]
  );

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => {
    const merged = { ...SAFE_LISTS, ...normalizeIncomingLists(lists) };
    const fixedLocal = { idEntrada: findIdByIncludes(merged.tiposMovimiento, "entrada") };
    return buildFormFromRowCompra(row, fixedLocal);
  });
  const [proveedorInput, setProveedorInput] = useState("");
  const [proveedorFocus, setProveedorFocus] = useState(false);
  const [detalleInput, setDetalleInput] = useState("");
  const [detalleFocus, setDetalleFocus] = useState(false);
  const [mediosFilas, setMediosFilas] = useState(() => [buildEmptyMedioPago()]);

  const [archivoNuevo, setArchivoNuevo] = useState(null);
  const [archivoActualUrl, setArchivoActualUrl] = useState("");
  const [archivoActualNombre, setArchivoActualNombre] = useState("");
  const [archivoActualId, setArchivoActualId] = useState(null);
  const [quitarArchivoActual, setQuitarArchivoActual] = useState(false);

  const [openVerComp, setOpenVerComp] = useState(false);
  const [compUrl, setCompUrl] = useState("");

  const closeBtnRef = useRef(null);
  const fechaRef = useRef(null);
  const proveedorInputRef = useRef(null);
  const detalleInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const rowsContainerRef = useRef(null);
  const [hasScroll, setHasScroll] = useState(false);

  const [addUI, setAddUI] = useState({ open: false, catalogo: null, text: "", saving: false });

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
  }, [open, form]);

  const tipoVentaObj = useMemo(
    () => getTipoVentaObj(tiposVentaUI, form.id_tipo_venta),
    [tiposVentaUI, form.id_tipo_venta]
  );
  const esContado = useMemo(() => isTipoVentaContado(tipoVentaObj), [tipoVentaObj]);

  const resumen = useMemo(() => ({
    subtotal: safeNumber(form.subtotal),
    iva: safeNumber(form.iva_monto),
    total: safeNumber(form.total),
  }), [form.subtotal, form.iva_monto, form.total]);

  const sumaMediosPago = useMemo(
    () => mediosFilas.reduce((acc, mp) => acc + safeNumber(mp.monto), 0),
    [mediosFilas]
  );
  const diferenciaRestante = useMemo(
    () => Math.max(0, safeNumber(resumen.total) - safeNumber(sumaMediosPago)),
    [resumen.total, sumaMediosPago]
  );

  useEffect(() => {
    if (!esContado) {
    }
  }, [esContado]);

  const closeAddMini = useCallback(() => {
    if (addUI.saving) return;
    setAddUI({ open: false, catalogo: null, text: "", saving: false });
  }, [addUI.saving]);

  const updateMedioPago = useCallback((id, patch) => {
    setMediosFilas((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);
  const addMedioPago = useCallback(() => {
    setMediosFilas((prev) => [...prev, buildEmptyMedioPago()]);
  }, []);
  const removeMedioPago = useCallback((id) => {
    setMediosFilas((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length ? next : [buildEmptyMedioPago()];
    });
  }, []);

  const cargarChequesParaFila = useCallback(
    async (rowId, idMedioPago, includeIds = []) => {
      const medioObj = (Array.isArray(safeLists.mediosPago) ? safeLists.mediosPago : []).find(
        (x) => String(getGenericId(x) ?? x?.id_medio_pago ?? "") === String(idMedioPago ?? "")
      );
      const tipoCheque = normalizeChequeTipoFromMedio(medioObj?.nombre || "");
      if (!tipoCheque) {
        updateMedioPago(rowId, {
          chequesDisponibles: [],
          loadingCheques: false,
          chequesCarteraCargados: false,
          id_cheque: [],
        });
        return;
      }

      updateMedioPago(rowId, { loadingCheques: true });
      try {
        const sp = new URLSearchParams();
        sp.set("action", "mov_global_cheques_cartera_listar");
        sp.set("tipo", tipoCheque);
        if (Array.isArray(includeIds) && includeIds.length) {
          sp.set("include_ids", includeIds.join(","));
        }
        const data = await apiGet(`${BASE_URL}/api.php?${sp.toString()}`);
        const recibidos = Array.isArray(data?.cheques) ? data.cheques : [];

        setMediosFilas((prev) =>
          prev.map((fila) => {
            if (fila.id !== rowId) return fila;
            const byId = new Map();
            [...(Array.isArray(fila.chequesDisponibles) ? fila.chequesDisponibles : []), ...recibidos].forEach((ch) => {
              const id = Number(ch?.id_cheque || 0);
              if (id > 0) byId.set(id, ch);
            });
            return {
              ...fila,
              chequesDisponibles: Array.from(byId.values()),
              loadingCheques: false,
              chequesCarteraCargados: true,
            };
          })
        );
      } catch (e) {
        updateMedioPago(rowId, { loadingCheques: false, chequesCarteraCargados: true });
        showToast("error", e?.message || "No se pudieron cargar los cheques.", 4200);
      }
    },
    [safeLists.mediosPago, showToast, updateMedioPago]
  );

  const startAddProveedor = useCallback(() => {
    if (saving) return;
    setProveedorFocus(false);
    setAddUI({ open: true, catalogo: "proveedores", text: proveedorInput.trim() || "", saving: false });
    setForm((p) => ({ ...p, id_proveedor: ADD_OPTION }));
  }, [saving, proveedorInput]);

  const startAddDetalle = useCallback(() => {
    if (saving) return;
    setDetalleFocus(false);
    setAddUI({ open: true, catalogo: "detalles", text: detalleInput.trim() || "", saving: false });
    setForm((p) => ({ ...p, id_detalle: ADD_OPTION }));
  }, [saving, detalleInput]);

  const guardarNuevoCatalogo = useCallback(async () => {
    const catalogo = addUI.catalogo;
    const nombre = String(addUI.text || "").trim();
    if (!catalogo) return;
    if (!nombre) {
      showToast("advertencia", "Escribí un nombre antes de guardar.", 2600);
      return;
    }
    const { sessionKey, idUsuario } = getAuthInfo();
    if (!sessionKey) {
      showToast("error", "No hay sesión activa (Falta X-Session).", 5200);
      return;
    }
    setAddUI((p) => ({ ...p, saving: true }));
    showToast("cargando", `Creando ${catalogo === "proveedores" ? "proveedor" : "detalle"}…`, 12000);
    try {
      const data = await apiPostJson(`${ENDPOINT_BASE}?action=catalogo_crear`, { catalogo, nombre, idUsuario });
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo crear el ítem.");
      const item = data?.item || {};
      const newId = getGenericId(item);
      const newNombre = String(item?.nombre ?? "").trim() || nombre;
      if (!newId) throw new Error("El servidor no devolvió un ID válido.");

      setLocalLists((prev) => {
        const next = { ...prev };
        const key = catalogo === "proveedores" ? "proveedores" : "detalles";
        const arr = Array.isArray(prev[key]) ? prev[key].slice() : [];
        if (!arr.some((x) => Number(getGenericId(x) ?? x?.id) === Number(newId))) {
          arr.push({ id: Number(newId), nombre: newNombre });
        }
        next[key] = arr;
        return next;
      });

      try {
        onCatalogCreated?.({ catalogo, item: { id: Number(newId), nombre: newNombre } });
      } catch {}

      if (catalogo === "proveedores") {
        setForm((p) => ({ ...p, id_proveedor: String(Number(newId)) }));
        setProveedorInput(newNombre);
        setProveedorFocus(false);
        setTimeout(() => proveedorInputRef.current?.focus(), 0);
      } else {
        setForm((p) => ({ ...p, id_detalle: String(Number(newId)) }));
        setDetalleInput(newNombre);
        setDetalleFocus(false);
        setTimeout(() => detalleInputRef.current?.focus(), 0);
      }

      setAddUI({ open: false, catalogo: null, text: "", saving: false });
      showToast("exito", `${catalogo === "proveedores" ? "Proveedor" : "Detalle"} creado: "${newNombre}"`, 2600);
    } catch (e) {
      setAddUI((p) => ({ ...p, saving: false }));
      showToast("error", e?.message || "Error creando el ítem.", 4200);
    }
  }, [ENDPOINT_BASE, addUI.catalogo, addUI.text, showToast, onCatalogCreated]);

  const resolveIdByExactName = useCallback(
    (kind) => {
      const norm = (s) => String(s ?? "").trim().toLowerCase();
      if (kind === "proveedor") {
        const name = norm(proveedorInput);
        if (!name) return null;
        const hit = (Array.isArray(safeLists.proveedores) ? safeLists.proveedores : []).find(
          (p) => norm(p?.nombre) === name
        );
        return hit ? getGenericId(hit) : null;
      }
      if (kind === "detalle") {
        const name = norm(detalleInput);
        if (!name) return null;
        const hit = (Array.isArray(safeLists.detalles) ? safeLists.detalles : []).find(
          (d) => norm(d?.nombre) === name
        );
        return hit ? getGenericId(hit) : null;
      }
      return null;
    },
    [proveedorInput, detalleInput, safeLists.proveedores, safeLists.detalles]
  );

  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;

    setSaving(false);
    setAddUI({ open: false, catalogo: null, text: "", saving: false });
    setOpenVerComp(false);
    setCompUrl("");

    const merged = { ...SAFE_LISTS, ...normalizeIncomingLists(listsRef.current) };
    setLocalLists(merged);

    const fixedLocal = { idEntrada: findIdByIncludes(merged.tiposMovimiento, "entrada") };
    const built = buildFormFromRowCompra(rowRef.current, fixedLocal);
    setForm(built);
    setProveedorInput(
      nameById(merged.proveedores, built.id_proveedor) || String(rowRef.current?.proveedor || "").trim()
    );
    setProveedorFocus(false);
    setDetalleInput(
      built.id_stock_variante && built.id_stock_variante !== NULL_OPTION
        ? getProductoNombreFromCompra(rowRef.current)
        : (nameById(merged.detalles, built.id_detalle) || getProductoNombreFromCompra(rowRef.current))
    );
    setDetalleFocus(false);

    const mediosIniciales = buildMediosFromRowCompra(rowRef.current, merged.mediosPago);
    setMediosFilas(mediosIniciales);

    mediosIniciales.forEach((mp) => {
      const medioObj = (Array.isArray(merged.mediosPago) ? merged.mediosPago : []).find(
        (x) => String(getGenericId(x) ?? x?.id_medio_pago ?? "") === String(mp.id_medio_pago ?? "")
      );
      const tipoCheque = normalizeChequeTipoFromMedio(medioObj?.nombre || "");
      if (tipoCheque && !mp.soloChequeVinculado) {
        const includeIds = Array.isArray(mp.id_cheque) ? mp.id_cheque : [];
        setTimeout(() => {
          cargarChequesParaFila(mp.id, mp.id_medio_pago, includeIds);
        }, 0);
      }
    });

    const url = getComprobanteUrl(rowRef.current);
    setArchivoActualUrl(url || "");
    setArchivoActualNombre(getFriendlyComprobanteName(rowRef.current, url));
    setArchivoActualId(getComprobanteIdFromRow(rowRef.current));
    setArchivoNuevo(null);
    setQuitarArchivoActual(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setTimeout(() => closeBtnRef.current?.focus(), 0);
  }, [open, cargarChequesParaFila]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (openVerComp) {
        setOpenVerComp(false);
        return;
      }
      if (saving || addUI.open) return;
      onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, saving, addUI.open, onClose, openVerComp]);

  const cerrar = useCallback(() => {
    if (saving || addUI.open || openVerComp) return;
    onClose?.();
  }, [saving, addUI.open, openVerComp, onClose]);

  const openDatePicker = useCallback(() => {
    const el = fechaRef.current;
    if (!el || saving || el.disabled) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }, [saving]);

  // ⭐ FUNCIÓN PARA VALIDAR Y ACTUALIZAR LA FECHA ⭐
  const onFechaChange = useCallback((iso) => {
    const nuevaFecha = String(iso || "").trim();
    
    if (nuevaFecha && nuevaFecha > todayISO()) {
      showToast("advertencia", "No podés seleccionar una fecha posterior al día actual.", 3000);
      return;
    }
    
    setForm((p) => ({ ...p, fecha: nuevaFecha }));
  }, [showToast]);

  const recalcFromItem = useCallback((nextPartial) => {
    setForm((p) => {
      const next = { ...p, ...nextPartial };
      const t = calcItemTotals(safeNumber(next.cantidad), safeNumber(next.precio), safeNumber(next.iva_pct));
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

  const findExactCatalogItem = useCallback((arr, value) => {
    const q = normalizeText(value);
    if (!q) return null;

    return (Array.isArray(arr) ? arr : []).find(
      (item) => normalizeText(item?.nombre) === q
    ) || null;
  }, []);

  const filteredProveedores = useMemo(() => {
    const all = Array.isArray(safeLists.proveedores) ? safeLists.proveedores : [];
    const q = normalizeText(proveedorInput);
    if (!proveedorFocus || q.length < 1) return [];
    return all.filter((p) => normalizeText(p?.nombre).includes(q)).slice(0, 25);
  }, [safeLists.proveedores, proveedorInput, proveedorFocus]);

  const filteredDetalles = useMemo(() => {
    const all = Array.isArray(safeLists.detalles) ? safeLists.detalles : [];
    const q = normalizeText(detalleInput);
    if (!detalleFocus || q.length < 1) return [];
    return all.filter((d) => normalizeText(d?.nombre).includes(q)).slice(0, 25);
  }, [safeLists.detalles, detalleInput, detalleFocus]);

  const proveedorExacto = useMemo(
    () => findExactCatalogItem(safeLists.proveedores, proveedorInput),
    [findExactCatalogItem, safeLists.proveedores, proveedorInput]
  );

  const detalleExacto = useMemo(
    () => findExactCatalogItem(safeLists.detalles, detalleInput),
    [findExactCatalogItem, safeLists.detalles, detalleInput]
  );

  const puedeAgregarProveedor = useMemo(() => {
    const q = normalizeText(proveedorInput);
    return proveedorFocus && q.length >= 2 && !proveedorExacto && filteredProveedores.length === 0;
  }, [proveedorFocus, proveedorInput, proveedorExacto, filteredProveedores.length]);

  const puedeAgregarDetalle = useMemo(() => {
    const q = normalizeText(detalleInput);
    return detalleFocus && q.length >= 2 && !detalleExacto && filteredDetalles.length === 0;
  }, [detalleFocus, detalleInput, detalleExacto, filteredDetalles.length]);

  const mostrarSugerenciasProveedor = proveedorFocus && (filteredProveedores.length > 0 || puedeAgregarProveedor);
  const mostrarSugerenciasDetalle = detalleFocus && (filteredDetalles.length > 0 || puedeAgregarDetalle);

  const handleProveedorInputChange = useCallback((e) => {
    const value = e.target.value;
    const exact = findExactCatalogItem(safeLists.proveedores, value);

    setProveedorInput(value);
    setForm((prev) => ({
      ...prev,
      id_proveedor: exact ? String(getGenericId(exact)) : NULL_OPTION,
    }));
  }, [findExactCatalogItem, safeLists.proveedores]);
  const handleSelectProveedor = useCallback((proveedor) => {
    const nombre = String(proveedor?.nombre ?? "").trim();
    const pid = getGenericId(proveedor);
    setProveedorInput(nombre);
    setForm((prev) => ({ ...prev, id_proveedor: pid != null ? String(pid) : NULL_OPTION }));
    setProveedorFocus(false);
  }, []);
  const handleDetalleInputChange = useCallback((e) => {
    const value = e.target.value;
    const exact = findExactCatalogItem(safeLists.detalles, value);

    setDetalleInput(value);
    setForm((prev) => ({
      ...prev,
      id_detalle: exact ? String(getGenericId(exact)) : NULL_OPTION,
      id_stock_variante: NULL_OPTION,
    }));
  }, [findExactCatalogItem, safeLists.detalles]);
  const handleSelectDetalle = useCallback((det) => {
    const idProducto = getStockProductoIdFromSelection(det) || getGenericId(det);
    const idVariante = getStockVarianteIdFromSelection(det);
    const productoNombre = String(det?.producto_nombre ?? det?.stock_producto_nombre ?? det?.nombre ?? "").trim();
    const varianteNombre = String(det?.nombre_variante ?? det?.variante_nombre ?? det?.stock_variante_nombre ?? "").trim();
    const nombre = String(det?.label ?? [productoNombre, varianteNombre].filter(Boolean).join(" - ") ?? "").trim();

    setDetalleInput(nombre || productoNombre);
    setForm((prev) => ({
      ...prev,
      id_detalle: idProducto != null ? String(idProducto) : NULL_OPTION,
      id_stock_variante: idVariante != null ? String(idVariante) : NULL_OPTION,
    }));
    setDetalleFocus(false);
  }, []);

  const handleBarcodeProductSelect = useCallback((producto) => {
    handleSelectDetalle(producto);
    const nombre = String(producto?.label ?? producto?.nombre ?? producto?.producto_nombre ?? "Producto").trim();
    showToast("exito", `Producto leído: ${nombre}`, 1800);
  }, [handleSelectDetalle, showToast]);

  useStockBarcodeScanner({
    enabled: open && !saving && !addUI.open && !openVerComp,
    options: safeLists.detalles,
    allowOutOfStock: true,
    refreshOptions: refreshBarcodeCatalog,
    onSelect: handleBarcodeProductSelect,
    onError: (mensaje) => showToast("advertencia", mensaje, 3200),
  });

  const payload = useMemo(() => {
    const toNullableId = (v) => {
      if (v === NULL_OPTION || v === "" || v == null || v === ADD_OPTION) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const cantidad = Math.max(0, safeNumber(form.cantidad));
    const precio = Math.max(0, safeNumber(form.precio));
    const iva_pct = Math.max(0, safeNumber(form.iva_pct));
    const t = calcItemTotals(cantidad, precio, iva_pct);

    const mediosPagoPayload = esContado
      ? mediosFilas.flatMap((mp) => {
          const idMp = Number(mp.id_medio_pago || 0);
          if (!(idMp > 0)) return [];
          const medioObj = (Array.isArray(safeLists.mediosPago) ? safeLists.mediosPago : []).find(
            (x) => String(getMedioPagoId(x) ?? "") === String(idMp)
          );
          const tipoCheque = normalizeChequeTipoFromMedio(medioObj?.nombre || "");
          const seleccionados = Array.isArray(mp.id_cheque) ? mp.id_cheque : [];
          if (tipoCheque && seleccionados.length) {
            return seleccionados.map((idChequeStr) => {
              const ch = (Array.isArray(mp.chequesDisponibles) ? mp.chequesDisponibles : []).find(
                (x) => String(x.id_cheque) === String(idChequeStr)
              );
              return {
                id_medio_pago: idMp,
                monto: Math.round(safeNumber(ch?.importe || 0) * 100) / 100,
                id_cheque: Number(idChequeStr),
              };
            });
          }
          return [{ id_medio_pago: idMp, monto: Math.round(safeNumber(mp.monto) * 100) / 100 }];
        })
      : [];

    return {
      id_movimiento: form.id_movimiento,
      fecha: form.fecha,
      id_tipo_venta: toNullableId(form.id_tipo_venta),
      id_tipo_movimiento: toNullableId(form.id_tipo_movimiento),
      id_proveedor: toNullableId(form.id_proveedor),
      id_cliente: null,
      id_detalle: toNullableId(form.id_detalle),
      id_stock_producto: toNullableId(form.id_detalle),
      id_stock_variante: toNullableId(form.id_stock_variante),
      cantidad: Math.round(cantidad * 1000) / 1000,
      precio: Math.round(precio * 100) / 100,
      iva_pct: Math.round(iva_pct * 100) / 100,
      subtotal: t.subtotal,
      iva_monto: t.iva_monto,
      total: t.total,
      monto_total: Math.max(0, Math.round(t.total * 100) / 100),
      accion_compra: esContado ? "pagar" : "guardar",
      es_pagada: esContado,
      id_medio_pago: null,
      medios_pago: mediosPagoPayload,
    };
  }, [form, esContado, mediosFilas, safeLists.mediosPago]);

  const eliminarComprobanteActual = useCallback(async () => {
    if (!form.id_movimiento) throw new Error("Falta id_movimiento para eliminar el comprobante.");
    const body = {
      action: "compras_eliminar_comprobante",
      id_movimiento: Number(form.id_movimiento),
      ...(archivoActualId ? { id_comprobante: Number(archivoActualId) } : {}),
    };
    const data = await apiPostJson(ENDPOINT_DELETE_COMP, body);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo eliminar el comprobante actual.");
    setArchivoActualUrl("");
    setArchivoActualNombre("");
    setArchivoActualId(null);
    setQuitarArchivoActual(false);
    setOpenVerComp(false);
    setCompUrl("");
    return data;
  }, [ENDPOINT_DELETE_COMP, form.id_movimiento, archivoActualId]);

  const subirNuevoComprobante = useCallback(async (idMovimiento, archivo) => {
    if (!idMovimiento || !archivo) return null;
    const fd = new FormData();
    fd.append("archivo", archivo);
    fd.append("tipo", "COMPRA");
    fd.append("force", "0");
    fd.append("ids_movimiento", JSON.stringify([Number(idMovimiento)]));
    const data = await apiPostForm(ENDPOINT_UPLOAD_LINK, fd);
    if (!data?.exito) throw new Error(data?.mensaje || "No se pudo subir y vincular el nuevo archivo.");
    setArchivoNuevo(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    return data;
  }, [ENDPOINT_UPLOAD_LINK]);

  const archivoMostrado = archivoNuevo
    ? { tipo: "nuevo", nombre: NOMBRE_COMPROBANTE_GENERICO, size: archivoNuevo.size, file: archivoNuevo }
    : (!quitarArchivoActual && (archivoActualUrl || archivoActualId))
      ? { tipo: "actual", nombre: NOMBRE_COMPROBANTE_GENERICO, url: archivoActualUrl }
      : null;

  const obtenerUrlFirmadaComprobanteActual = useCallback(async () => {
    const idComp = Number(archivoActualId || getComprobanteIdFromRow(rowRef.current) || 0);

    if (idComp > 0) {
      const sp = new URLSearchParams();
      sp.set("action", "compras_comprobantes_descargar");
      sp.set("id_comprobante", String(idComp));

      const data = await apiGet(`${BASE_URL}/api.php?${sp.toString()}`);
      if (!data?.exito) {
        throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
      }

      const finalUrl = String(data?.url || "").trim();
      if (!finalUrl) {
        throw new Error("El backend no devolvió la URL del comprobante.");
      }

      return finalUrl;
    }

    const rawUrl = String(archivoActualUrl || "").trim();
    if (!rawUrl) return "";

    // Si ya viene una URL firmada externa (R2/S3) o un blob, se puede usar directo.
    if (/^(blob:|data:)/i.test(rawUrl)) return rawUrl;
    if (/^https?:\/\//i.test(rawUrl)) {
      try {
        const u = new URL(rawUrl);
        const hasAwsSignature =
          u.searchParams.has("X-Amz-Signature") ||
          u.searchParams.has("X-Amz-Algorithm") ||
          u.searchParams.has("X-Amz-Credential");

        if (hasAwsSignature || !u.pathname.toLowerCase().includes("api.php")) {
          return rawUrl;
        }
      } catch {
        return rawUrl;
      }
    }

    // Si por compatibilidad quedó guardado un endpoint api.php, lo resolvemos con fetch
    // y headers de sesión. No se lo pasamos directo al visor porque ahí se pierden los headers.
    const data = await apiGet(rawUrl);
    if (!data?.exito) {
      throw new Error(data?.mensaje || "No se pudo obtener el comprobante.");
    }

    const finalUrl = String(data?.url || "").trim();
    if (!finalUrl) {
      throw new Error("El backend no devolvió la URL del comprobante.");
    }

    return finalUrl;
  }, [archivoActualId, archivoActualUrl]);

  const handleOpenVerComprobante = useCallback(async () => {
    if (!archivoMostrado) return;

    if (archivoMostrado.tipo === "nuevo") {
      const url = URL.createObjectURL(archivoMostrado.file);
      setCompUrl(url);
      setOpenVerComp(true);
      return;
    }

    try {
      const finalUrl = await obtenerUrlFirmadaComprobanteActual();
      if (!finalUrl) {
        showToast("advertencia", "No hay comprobante para visualizar.", 2600);
        return;
      }

      setCompUrl(finalUrl);
      setOpenVerComp(true);
    } catch (e) {
      showToast("error", e?.message || "No se pudo abrir el comprobante.", 4200);
    }
  }, [archivoMostrado, obtenerUrlFirmadaComprobanteActual, showToast]);

  const handleCloseVerComprobante = useCallback(() => {
    setOpenVerComp(false);
    if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
    setCompUrl("");
  }, [compUrl]);

  useEffect(() => {
    return () => {
      if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
    };
  }, [compUrl]);

  const handleQuitarArchivo = useCallback(() => {
    if (archivoNuevo) {
      setArchivoNuevo(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } else {
      setQuitarArchivoActual(true);
    }
    setOpenVerComp(false);
    if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
    setCompUrl("");
  }, [archivoNuevo, compUrl]);

  const handleOpenFilePicker = useCallback(() => {
    if (saving || addUI.open || openVerComp) return;
    fileInputRef.current?.click();
  }, [saving, addUI.open, openVerComp]);

  const handleFileSelected = useCallback((e) => {
    const file = e.target.files?.[0] || null;

    if (!file) {
      setArchivoNuevo(null);
      setOpenVerComp(false);
      if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
      setCompUrl("");
      return;
    }

    if (!isAllowedComprobanteFile(file)) {
      showToast(
        "advertencia",
        "Archivo inválido. Solo se permiten imágenes o archivos PDF.",
        4200
      );

      setArchivoNuevo(null);
      setOpenVerComp(false);
      if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
      setCompUrl("");

      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setArchivoNuevo(file);
    setQuitarArchivoActual(false);
    setOpenVerComp(false);
    if (compUrl && compUrl.startsWith("blob:")) URL.revokeObjectURL(compUrl);
    setCompUrl("");
  }, [compUrl, showToast]);

  // ⭐ SUBMIT CON VALIDACIÓN DE FECHA ⭐
  const submit = async (e) => {
    e.preventDefault();
    if (addUI.open) {
      showToast("advertencia", "Terminá de crear el registro (o cancelá) antes de guardar.", 3200);
      return;
    }
    setSaving(true);
    showToast("cargando", "Guardando cambios…", 12000);
    try {
      if (!form.id_movimiento) throw new Error("Falta id_movimiento (no puedo actualizar).");
      
      // ⭐ VALIDACIÓN DE FECHA ⭐
      if (!form.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) throw new Error("La fecha es inválida.");
      if (form.fecha > todayISO()) throw new Error("La fecha no puede ser posterior al día actual.");
      
      if (!form.id_tipo_venta || String(form.id_tipo_venta) === NULL_OPTION) throw new Error("Tipo de compra es obligatorio.");

      let proveedorId = form.id_proveedor;
      if (!proveedorId || proveedorId === NULL_OPTION || proveedorId === ADD_OPTION) {
        const resolved = resolveIdByExactName("proveedor");
        if (resolved) proveedorId = String(resolved);
      }
      let detalleId = form.id_detalle;
      if (!detalleId || detalleId === NULL_OPTION || detalleId === ADD_OPTION) {
        const resolved = resolveIdByExactName("detalle");
        if (resolved) detalleId = String(resolved);
      }

      if (!proveedorId || proveedorId === NULL_OPTION || proveedorId === ADD_OPTION) {
        throw new Error("Seleccioná un proveedor o crealo con Agregar nuevo proveedor.");
      }
      if (!detalleId || detalleId === NULL_OPTION || detalleId === ADD_OPTION) {
        throw new Error("Seleccioná un detalle o crealo con Agregar nuevo detalle.");
      }

      const cantidad = Math.max(0, safeNumber(form.cantidad));
      const precio = Math.max(0, safeNumber(form.precio));
      if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor a 0.");
      if (!(precio > 0)) throw new Error("El precio debe ser mayor a 0.");

      if (esContado) {
        if (!payload.medios_pago.length) throw new Error("En compras al contado debés cargar al menos un medio de pago.");
        for (let i = 0; i < mediosFilas.length; i++) {
          const mp = mediosFilas[i];
          if (!mp.id_medio_pago || mp.id_medio_pago === NULL_OPTION) {
            throw new Error(`Medio de pago ${i + 1}: falta seleccionar el medio.`);
          }
          const medioObj = (Array.isArray(safeLists.mediosPago) ? safeLists.mediosPago : []).find(
            (x) => String(getMedioPagoId(x) ?? "") === String(mp.id_medio_pago ?? "")
          );
          const tipoCheque = normalizeChequeTipoFromMedio(medioObj?.nombre || "");
          const seleccionados = Array.isArray(mp.id_cheque) ? mp.id_cheque : [];
          if (tipoCheque) {
            if (!seleccionados.length) {
              throw new Error(`Medio de pago ${i + 1}: debés seleccionar al menos un ${tipoCheque === "echeq" ? "eCheq" : "cheque"}.`);
            }
          } else if (!(safeNumber(mp.monto) > 0)) {
            throw new Error(`Medio de pago ${i + 1}: el monto debe ser mayor a 0.`);
          }
        }
        if (sumaMediosPago < safeNumber(resumen.total) - 0.05) {
          throw new Error(`La suma de los medios de pago (${moneyARS(sumaMediosPago)}) no cubre el total (${moneyARS(resumen.total)}).`);
        }
      }

      const payloadFinal = {
        ...payload,
        id_proveedor: Number(proveedorId),
        id_detalle: Number(detalleId),
        id_stock_producto: Number(detalleId),
      };

      const habiaArchivo = Boolean(archivoActualUrl || archivoActualId);
      const quiereQuitar = Boolean(quitarArchivoActual);
      const quiereSubirNuevo = Boolean(archivoNuevo);
      const soloCambioArchivo =
        (quiereQuitar || quiereSubirNuevo) &&
        compraPayloadCoincideConRow(payloadFinal, rowRef.current);

      if (archivoNuevo && !isAllowedComprobanteFile(archivoNuevo)) {
        throw new Error("Archivo inválido. Solo se permiten imágenes o archivos PDF.");
      }

      // Si el usuario sólo adjunta/reemplaza/quita comprobante, NO se toca la compra.
      // Antes esto disparaba compras_actualizar y podía borrar pagos ya imputados por Órdenes de Pago.
      if (!soloCambioArchivo) {
        await onSave?.(payloadFinal);
      }

      if (habiaArchivo && (quiereQuitar || quiereSubirNuevo)) {
        showToast("cargando", quiereSubirNuevo ? "Reemplazando archivo…" : "Quitando archivo…", 12000);
        await eliminarComprobanteActual();
      }
      if (quiereSubirNuevo) {
        showToast("cargando", "Subiendo archivo…", 12000);
        await subirNuevoComprobante(form.id_movimiento, archivoNuevo);
      }

      if (typeof onSaved === "function") await Promise.resolve(onSaved());
      showToast("exito", "Compra actualizada correctamente.", 2400);
      onClose?.();
    } catch (err) {
      showToast("error", err?.message || "Error guardando compra.", 4200);
      setSaving(false);
    }
  };

  if (!open) return null;

  const overlayClass = "gm-modal-overlay";
  const containerClass = "gm-modal-container gm-modal-container--movement gm-modal-v2 nc-modal";
  const miniTitle = addUI.catalogo === "proveedores" ? "Nuevo proveedor" : addUI.catalogo === "detalles" ? "Nuevo detalle" : "Nuevo";

  return createPortal(
    <>
      <div className={overlayClass}>
        <div
          className={containerClass}
          id="gm-modal-container"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="gm-modal-header">
            <div className="gm-modal-head-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faBasketShopping} />
            </div>
            <div className="gm-modal-head-left">
              <h2 className="gm-modal-title">Editar compra</h2>
            </div>
            <button
              ref={closeBtnRef}
              className="gm-modal-close"
              onClick={cerrar}
              aria-label="Cerrar"
              disabled={saving || addUI.open || openVerComp}
              type="button"
            >
              ✕
            </button>
          </div>

          <div className="gm-modal-content">
            <div className="gm-movement-layout">
              <section className="gm-movement-main gm-table gm-table--movement cmp-table">
                <div className={`gm-table-head ${hasScroll ? "gm-table-head--body-scroll" : ""}`}>
                  <div className="gm-table-th" style={{ paddingLeft: 10 }}>Detalle</div>
                  <div className="gm-table-th">Cant.</div>
                  <div className="gm-table-th right">Precio</div>
                  <div className="gm-table-th">IVA %</div>
                  <div className="gm-table-th right">IVA $</div>
                  <div className="gm-table-th right">Total</div>
                  <div className="gm-table-th" />
                </div>

                <div ref={rowsContainerRef} className={`gm-table-body ${hasScroll ? "has-scroll" : ""}`}>
                  <div className="gm-table-row">
                    <div className="gm-table-cell gm-table-cell--detail">
                      <div className="cmp-autocomplete" style={{ width: "100%" }}>
                        <input
                          ref={detalleInputRef}
                          className="gm-cell-input"
                          placeholder=" "
                          value={detalleInput}
                          onChange={handleDetalleInputChange}
                          onFocus={() => setDetalleFocus(true)}
                          onBlur={() => setTimeout(() => setDetalleFocus(false), 120)}
                          disabled={saving || addUI.open || openVerComp}
                          autoComplete="off"
                        />
                        {mostrarSugerenciasDetalle && (
                          <ul className="cmp-suggest">
                            {puedeAgregarDetalle && (
                              <li
                                className="cmp-suggest__item cmp-suggest__item--add"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  startAddDetalle();
                                }}
                              >
                                <span>+ Agregar "{detalleInput}"</span>
                              </li>
                            )}
                            {filteredDetalles.map((d) => {
                              const did = getGenericId(d);
                              return (
                                <li
                                  key={did ?? d?.nombre}
                                  className="cmp-suggest__item"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleSelectDetalle(d);
                                  }}
                                >
                                  <span className="cmp-suggest-text">{d.nombre}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="gm-table-cell gm-table-cell--center stock_cant">
                      <input
                        className="gm-cell-input gm-cell-input--center"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={form.cantidad}
                        onChange={(e) => onCantidadChange(e.target.value)}
                        disabled={saving}
                      />
                    </div>

                    <div className="gm-table-cell gm-table-cell--center">
                      <input
                        className="gm-cell-input gm-cell-input--right"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.precio}
                        onChange={(e) => onPrecioChange(e.target.value)}
                        disabled={saving}
                      />
                    </div>

                    <div className="gm-table-cell gm-table-cell--center">
                      <select
                        className="gm-cell-input gm-cell-input--center gm-cell-input--select"
                        value={String(form.iva_pct)}
                        onChange={(e) => onIvaPctChange(e.target.value)}
                        disabled={saving}
                      >
                        {IVA_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                      </select>
                    </div>

                    <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--soft">
                      {moneyARS(form.iva_monto)}
                    </div>
                    <div className="gm-table-cell gm-table-cell--right gm-table-cell--mono gm-table-cell--total">
                      {moneyARS(form.total)}
                    </div>
                    <div className="gm-table-cell gm-table-cell--center" id="delete_cell" />
                  </div>
                </div>

                <div className="gm-table-foot">
                  <div className="gm-foot-actions">
                    <div className="gm-foot-sep" />
                  </div>
                  <div className="gm-summary-chips">
                    <div className="gm-summary-chip gm-summary-chip--sub">
                      <span>Subtotal</span><b>{moneyARS(resumen.subtotal)}</b>
                    </div>
                    <div className="gm-summary-chip gm-summary-chip--iva">
                      <span>IVA</span><b>{moneyARS(resumen.iva)}</b>
                    </div>
                    <div className="gm-summary-chip gm-summary-chip--total">
                      <span>Total</span><b>{moneyARS(resumen.total)}</b>
                    </div>
                  </div>
                </div>
              </section>

              <div className="gm-movement-side">
                <aside className="gm-aside">
                  <div className="gm-section">
                    <div className="gm-section-head">
                      <div className="gm-section-dot" />
                      <span>Datos de compra</span>
                    </div>

                    <div className="gm-section-body">
                      {/* ⭐ INPUT DE FECHA CON VALIDACIONES ⭐ */}
                      <div className="gm-field" onClick={openDatePicker}>
                        <input
                          ref={fechaRef}
                          className="gm-input"
                          type="date"
                          placeholder=" "
                          value={form.fecha}
                          max={todayISO()}
                          onChange={(e) => onFechaChange(e.target.value)}
                          disabled={saving}
                        />
                        <label className="gm-label">Fecha</label>
                      </div>

                      <div className="nc-prov-wrap">
                        <div className="gm-field cmp-autocomplete">
                          <input
                            ref={proveedorInputRef}
                            className="gm-input"
                            placeholder=" "
                            value={proveedorInput}
                            onChange={handleProveedorInputChange}
                            onFocus={() => setProveedorFocus(true)}
                            onBlur={() => setTimeout(() => setProveedorFocus(false), 120)}
                            disabled={saving || addUI.open}
                            autoComplete="off"
                          />
                          <label className={`gm-label${proveedorInput ? " gm-label--up" : ""}`}>Proveedor *</label>
                          {mostrarSugerenciasProveedor && (
                            <ul className="cmp-suggest">
                              {puedeAgregarProveedor && (
                                <li
                                  className="cmp-suggest__item cmp-suggest__item--add"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    startAddProveedor();
                                  }}
                                >
                                  <span>+ Agregar "{proveedorInput}"</span>
                                </li>
                              )}
                              {filteredProveedores.map((p) => {
                                const pid = getGenericId(p);
                                return (
                                  <li
                                    key={pid ?? p?.nombre}
                                    className="cmp-suggest__item"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleSelectProveedor(p);
                                    }}
                                  >
                                    <span className="cmp-suggest-text">{p.nombre}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>

                      <div className="gm-field">
                        <select
                          className="gm-input gm-select"
                          value={String(form.id_tipo_venta ?? "")}
                          onChange={(e) => setForm((p) => ({ ...p, id_tipo_venta: String(e.target.value || "") }))}
                          disabled={saving}
                        >
                          <option value="">Seleccionar.</option>
                          {tiposVentaUI.map((x) => {
                            const id = String(x.id ?? x.id_tipo_venta ?? "");
                            const nombre = String(x.nombre ?? "");
                            return (
                              <option key={id} value={id}>
                                {nombre}
                              </option>
                            );
                          })}
                        </select>
                        <label className={`gm-label${form.id_tipo_venta ? " gm-label--up" : ""}`}>
                          Forma de compra *
                        </label>
                      </div>

                      {esContado && (
                        <PanelMediosPagoCompraLocal
                          mediosFilas={mediosFilas}
                          mediosPagoList={safeLists.mediosPago || []}
                          totalCompra={resumen.total}
                          onUpdate={updateMedioPago}
                          onRemove={removeMedioPago}
                          onAdd={addMedioPago}
                          apiGet={apiGet}
                          BASE_URL={BASE_URL}
                          showToast={showToast}
                          saving={saving}
                        />
                      )}

                      {!esContado && (
                        <div className="nc-cc-info">
                          Quedará registrada como <b>pendiente de pago</b>.
                        </div>
                      )}
                      <div className="gm-upload-card">
                        <div className="gm-upload-card__head">
                          <div className="gm-upload-card__title">Comprobante adjunto</div>
                          <div className="gm-upload-card__sub">Seleccioná, visualizá o quitá el archivo antes de guardar</div>
                        </div>
                        <div className="gm-upload-card__body">
                          <div className={`gm-upload-file${archivoMostrado ? " is-filled" : " is-empty"}`}>
                            {archivoMostrado ? (
                              <>
                                <div className="gm-upload-file__icon">
                                  <FontAwesomeIcon icon={faFileInvoiceDollar} />
                                </div>
                                <div className="gm-upload-file__meta">
                                  <div className="gm-upload-file__name" title={archivoMostrado.nombre}>
                                    {archivoMostrado.nombre}
                                  </div>
                                  {archivoMostrado.tipo === "nuevo" && (
                                    <div className="gm-upload-file__size">
                                      {Math.max(1, Math.round((archivoMostrado.size || 0) / 1024))} KB
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 8, marginLeft: "auto"}}>
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
                                    onClick={handleQuitarArchivo}
                                    disabled={saving || openVerComp}
                                    title="Quitar archivo"
                                  >
                                    <FontAwesomeIcon icon={faTrash} />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="gm-upload-file__empty">
                                {quitarArchivoActual
                                  ? "El comprobante actual será eliminado al guardar"
                                  : "No hay comprobante seleccionado"}
                              </div>
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
                              <FontAwesomeIcon icon={faUpload} />{" "}
                              {archivoMostrado ? "Reemplazar archivo" : "Seleccionar archivo"}
                            </button>
                            {quitarArchivoActual && !archivoNuevo && (
                              <button
                                type="button"
                                className="gm-upload-btn gm-upload-btn--ghost"
                                onClick={() => setQuitarArchivoActual(false)}
                                disabled={saving}
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="gm-section-divider" />

                  </div>


                </aside>
                <div className="gm-actions gm-actions--sticky">
                  <button
                    type="button"
                    className="gm-action-btn gm-action-btn--save"
                    onClick={submit}
                    disabled={saving}
                  >
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>
                  <button
                    type="button"
                    className="gm-action-btn gm-action-btn--cancel"
                    onClick={cerrar}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>

          <AddCatalogMiniModal
            open={addUI.open}
            title={miniTitle}
            label="Nombre"
            value={addUI.text}
            saving={addUI.saving}
            onChange={(txt) => setAddUI((p) => ({ ...p, text: txt }))}
            onCancel={() => {
              setForm((p) => ({
                ...p,
                id_proveedor: addUI.catalogo === "proveedores" ? NULL_OPTION : p.id_proveedor,
                id_detalle: addUI.catalogo === "detalles" ? NULL_OPTION : p.id_detalle,
              }));
              closeAddMini();
            }}
            onSave={guardarNuevoCatalogo}
          />
        </div>
      </div>

      <ModalVerComprobante
        open={openVerComp}
        url={compUrl}
        mime={archivoNuevo?.type || ""}
        fileName={archivoMostrado ? NOMBRE_COMPROBANTE_GENERICO : ""}
        onClose={handleCloseVerComprobante}
        title={NOMBRE_COMPROBANTE_GENERICO}
      />
    </>,
    document.body
  );
}
