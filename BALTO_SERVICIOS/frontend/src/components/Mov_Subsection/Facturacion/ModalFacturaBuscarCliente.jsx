import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { facturacionFetch } from "./api/facturacionApi.js";
import { FaSearch, FaCheck, FaTimes } from "react-icons/fa";
import BASE_URL from "../../../config/config";

const DOC_TIPOS = [
  { id: 80, label: "CUIT (80)" },
  { id: 96, label: "DNI (96)" },
];

const IVA_OPTIONS = [
  "Consumidor Final",
  "IVA Responsable Inscripto",
  "IVA Exento",
  "Monotributista",
  "No Responsable",
  "Sujeto No Categorizado",
  "Proveedor del Exterior",
  "Cliente del Exterior",
  "IVA Liberado - Ley 19.640",
  "Monotributo Social",
  "IVA No Alcanzado",
];

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}
function safeStr(x) {
  return String(x ?? "").trim();
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function normalizeApiBase(apiBaseProp) {
  const raw = String(apiBaseProp || BASE_URL || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}
function buildApiUrl(apiBaseProp, params = {}) {
  const base = normalizeApiBase(apiBaseProp);
  if (!base) return "";

  let finalUrl = "";
  if (/\/routes$/i.test(base)) finalUrl = `${base}/api.php`;
  else if (/\/api\.php$/i.test(base)) finalUrl = base;
  else finalUrl = `${base}/routes/api.php`;

  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    usp.set(k, String(v));
  });

  return `${finalUrl}?${usp.toString()}`;
}
function getAuthHeaders() {
  const headers = new Headers({ Accept: "application/json" });
  const sessionKey = String(localStorage.getItem("session_key") || "").trim();
  if (sessionKey) headers.set("X-Session", sessionKey);
  return headers;
}
function humanizeFetchError(err) {
  const msg = String(err?.message || err || "").trim();
  if (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    msg.includes("ERR_FAILED")
  ) {
    return "No se pudo conectar con el backend o la petición fue bloqueada por CORS.";
  }
  return msg || "No se pudo consultar ARCA.";
}
function renderValue(v) {
  const s = safeStr(v);
  return s || "—";
}

export default function ModalFacturaBuscarCliente({
  open,
  onClose,
  apiBase,
  initialDocTipo = 80,
  initialDocNro = "",
  initialManualData = null,
  onSelect,
}) {
  const [docTipo, setDocTipo] = useState(Number(initialDocTipo) || 80);
  const [docNro, setDocNro] = useState(onlyDigits(initialDocNro));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [manualRazon, setManualRazon] = useState("");
  const [manualIva, setManualIva] = useState("Consumidor Final");
  const [manualDomicilio, setManualDomicilio] = useState("");

  const firstRef = useRef(null);

  const apiRootResolved = useMemo(() => normalizeApiBase(apiBase), [apiBase]);

  useEffect(() => {
    if (!open) return;

    setError("");
    setLoading(false);
    setResult(null);

    setDocTipo(Number(initialDocTipo) || 80);
    setDocNro(onlyDigits(initialDocNro));

    setManualRazon(safeStr(initialManualData?.razon_social));
    setManualIva(safeStr(initialManualData?.cond_iva) || "Consumidor Final");
    setManualDomicilio(safeStr(initialManualData?.domicilio));

    setTimeout(() => firstRef.current?.focus?.(), 0);
  }, [open, initialDocTipo, initialDocNro, initialManualData]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const fetchJSON = useCallback(async (url, opts = {}) => {
    if (!url) {
      throw new Error("No se pudo resolver la URL del backend. Revisá BASE_URL.");
    }

    const headers = getAuthHeaders();
    const incoming = new Headers(opts.headers || {});
    incoming.forEach((v, k) => headers.set(k, v));

    const res = await facturacionFetch(url, { ...opts, headers });
    const raw = await res.text();
    const trimmed = (raw || "").trim();

    if (
      trimmed.startsWith("<!DOCTYPE html") ||
      trimmed.startsWith("<html") ||
      (trimmed.startsWith("<") && !trimmed.startsWith('{"') && !trimmed.startsWith("["))
    ) {
      throw new Error("El backend devolvió HTML en lugar de JSON. Revisá la URL o el CORS.");
    }

    const j = safeJsonParse(trimmed);
    const pickErr = () =>
      j?.mensaje || j?.error || j?.message || j?.detail || j?.detalle || j?.extra?.error || "";

    if (!res.ok) throw new Error(pickErr() || `HTTP ${res.status}`);
    if (j && typeof j === "object" && j.ok === false) throw new Error(pickErr() || "Error del servidor.");
    if (j && typeof j === "object" && j.exito === false) throw new Error(pickErr() || "Error del servidor.");
    if (j == null) throw new Error("Respuesta inválida (no JSON).");

    return j;
  }, []);

  const validar = useCallback(() => {
    const doc = onlyDigits(docNro);

    if (!doc) return { ok: false, msg: "Ingresá documento (solo números)." };

    if (Number(docTipo) === 96) {
      if (!(doc.length === 7 || doc.length === 8)) {
        return { ok: false, msg: "DNI inválido (7 u 8 dígitos)." };
      }
      return { ok: true, mode: "dni", doc };
    }

    if (Number(docTipo) === 80) {
      if (doc.length !== 11) {
        return { ok: false, msg: "CUIT inválido (11 dígitos, sin guiones)." };
      }
      return { ok: true, mode: "cuit", doc };
    }

    return { ok: false, msg: "Tipo de documento inválido." };
  }, [docNro, docTipo]);

  const validarManualDni = useCallback(() => {
    if (Number(docTipo) !== 96) return { ok: true };

    if (!safeStr(manualRazon)) {
      return { ok: false, msg: "Para facturar con DNI tenés que completar Apellido y Nombre / Razón Social." };
    }
    if (!safeStr(manualIva)) {
      return { ok: false, msg: "Para facturar con DNI tenés que completar la condición frente al IVA." };
    }
    if (!safeStr(manualDomicilio)) {
      return { ok: false, msg: "Para facturar con DNI tenés que completar el domicilio." };
    }

    return { ok: true };
  }, [docTipo, manualRazon, manualIva, manualDomicilio]);

  const buscar = useCallback(async () => {
    setError("");
    setResult(null);

    const v = validar();
    if (!v.ok) {
      setError(v.msg);
      return;
    }

    if (v.mode === "dni") {
      setResult({
        summary: {
          cuit: null,
          iva: safeStr(manualIva) || null,
          razon_social: safeStr(manualRazon) || null,
          domicilio: safeStr(manualDomicilio) || null,
          nota: "Con DNI no se consulta ARCA. Completá manualmente los datos que irán a la factura.",
        },
      });
      return;
    }

    setLoading(true);
    try {
      const url = buildApiUrl(apiRootResolved, {
        action: "padron_cuit",
        op: "padron_cuit",
        cuit: v.doc,
      });

      const j = await fetchJSON(url, { method: "GET" });
      const data = j?.data ?? j;
      const summary = data?.summary ?? null;

      if (!summary) {
        throw new Error("ARCA no devolvió datos del cliente.");
      }

      setResult({ summary });
    } catch (e) {
      setError(humanizeFetchError(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [apiRootResolved, validar, fetchJSON, manualIva, manualRazon, manualDomicilio]);

  const usarDatos = useCallback(() => {
    setError("");

    const v = validar();
    if (!v.ok) {
      setError(v.msg);
      return;
    }

    const manualCheck = validarManualDni();
    if (!manualCheck.ok) {
      setError(manualCheck.msg);
      return;
    }

    const doc = onlyDigits(docNro);
    const s = result?.summary || {};

    const payload = {
      doc_tipo: Number(docTipo),
      doc_nro: doc,
      cuit: safeStr(s?.cuit) || (Number(docTipo) === 80 ? doc : null),
      razon_social:
        Number(docTipo) === 96
          ? safeStr(manualRazon) || null
          : safeStr(s?.razon_social) || null,
      cond_iva:
        Number(docTipo) === 96
          ? safeStr(manualIva) || null
          : safeStr(s?.iva) || null,
      domicilio:
        Number(docTipo) === 96
          ? safeStr(manualDomicilio) || null
          : safeStr(s?.domicilio) || null,
      origen: Number(docTipo) === 96 ? "manual_dni" : "arca_cuit",
    };

    onSelect?.(payload);
  }, [
    docNro,
    docTipo,
    onSelect,
    result,
    validar,
    validarManualDni,
    manualRazon,
    manualIva,
    manualDomicilio,
  ]);

  if (!open) return null;

  const s = result?.summary || null;
  const isDni = Number(docTipo) === 96;

  return (
    <div
      className="mi-modal__overlay"
      onClick={(e) => e.target.classList.contains("mi-modal__overlay") && onClose?.()}
    >
      <div
        className="mi-modal__container"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">Buscar / completar cliente</h2>
            <p className="mi-modal__subtitle">
              Si usás CUIT consulta ARCA. Si usás DNI, completás los datos manualmente.
            </p>
          </div>

          <button
            className="mi-modal__close"
            onClick={onClose}
            aria-label="Cerrar"
            type="button"
          >
            <FaTimes />
          </button>
        </div>

        <div className="mit-modal__body">
          {error && (
            <div className="arca-alert arca-alert--error" role="alert">
              {error}
            </div>
          )}

          <div className="mi-grid">
            <article className="mi-card mi-card--full">
              <h3 className="mi-card__title">Cliente</h3>

              <div className="fl-grid">
                <div className="fl-field">
                  <select
                    className="fl-input fl-select"
                    value={docTipo}
                    onChange={(e) => {
                      setDocTipo(Number(e.target.value));
                      setError("");
                      setResult(null);
                    }}
                    ref={firstRef}
                    disabled={loading}
                  >
                    {DOC_TIPOS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <label className="fl-label">Tipo doc</label>
                </div>

                <div className="fl-field">
                  <input
                    className="fl-input"
                    placeholder=" "
                    value={docNro}
                    onChange={(e) => {
                      setDocNro(onlyDigits(e.target.value));
                      setError("");
                      setResult(null);
                    }}
                    inputMode="numeric"
                    disabled={loading}
                  />
                  <label className="fl-label">Nro doc *</label>
                </div>

                <div className="fl-field fl-col-full">
                  <button
                    type="button"
                    className="mit-btn mit-btn--solid"
                    onClick={buscar}
                    disabled={loading}
                  >
                    {loading ? "Buscando..." : <>Buscar <FaSearch style={{ marginLeft: 8 }} /></>}
                  </button>
                </div>
              </div>

              {isDni && (
                <div style={{ marginTop: 16 }}>
                  <div className="arca-alert arca-alert--info" style={{ marginBottom: 12 }}>
                    Con <b>DNI</b> la factura se completa a mano. Estos datos se usarán en el PDF y al emitir.
                  </div>

                  <div className="fl-grid">
                    <div className="fl-field fl-col-full">
                      <input
                        className="fl-input"
                        placeholder=" "
                        value={manualRazon}
                        onChange={(e) => {
                          setManualRazon(e.target.value);
                          setError("");
                          setResult((prev) => ({
                            summary: {
                              ...(prev?.summary || {}),
                              razon_social: e.target.value,
                              iva: manualIva,
                              domicilio: manualDomicilio,
                              nota: "Con DNI no se consulta ARCA. Completá manualmente los datos que irán a la factura.",
                            },
                          }));
                        }}
                      />
                      <label className="fl-label">Apellido y Nombre / Razón Social *</label>
                    </div>

                    <div className="fl-field">
                      <select
                        className="fl-input fl-select"
                        value={manualIva}
                        onChange={(e) => {
                          setManualIva(e.target.value);
                          setError("");
                          setResult((prev) => ({
                            summary: {
                              ...(prev?.summary || {}),
                              razon_social: manualRazon,
                              iva: e.target.value,
                              domicilio: manualDomicilio,
                              nota: "Con DNI no se consulta ARCA. Completá manualmente los datos que irán a la factura.",
                            },
                          }));
                        }}
                      >
                        {IVA_OPTIONS.map((it) => (
                          <option key={it} value={it}>
                            {it}
                          </option>
                        ))}
                      </select>
                      <label className="fl-label">Condición frente al IVA *</label>
                    </div>

                    <div className="fl-field">
                      <input
                        className="fl-input"
                        placeholder=" "
                        value={manualDomicilio}
                        onChange={(e) => {
                          setManualDomicilio(e.target.value);
                          setError("");
                          setResult((prev) => ({
                            summary: {
                              ...(prev?.summary || {}),
                              razon_social: manualRazon,
                              iva: manualIva,
                              domicilio: e.target.value,
                              nota: "Con DNI no se consulta ARCA. Completá manualmente los datos que irán a la factura.",
                            },
                          }));
                        }}
                      />
                      <label className="fl-label">Domicilio *</label>
                    </div>
                  </div>
                </div>
              )}

              {s ? (
                <div className="arca-alert arca-alert--info" style={{ marginTop: 12 }}>
                  <div className="arca-alert__title">
                    <strong>Datos para la factura</strong>
                  </div>

                  {s?.nota ? (
                    <div className="arca-mini" style={{ marginBottom: 8 }}>
                      {s.nota}
                    </div>
                  ) : null}

                  <div className="arca-resumen arca-resumen--2col">
                    <div className="arca-row">
                      <b>CUIT:</b>
                      <span>{renderValue(s.cuit || (Number(docTipo) === 80 ? onlyDigits(docNro) : null))}</span>
                    </div>

                    <div className="arca-row">
                      <b>Condición frente al IVA:</b>
                      <span>{renderValue(s.iva)}</span>
                    </div>

                    <div className="arca-row arca-row--full">
                      <b>Apellido y Nombre / Razón Social:</b>
                      <span>{renderValue(s.razon_social)}</span>
                    </div>

                    <div className="arca-row arca-row--full">
                      <b>Domicilio:</b>
                      <span>{renderValue(s.domicilio)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="arca-mini" style={{ marginTop: 10 }}>
                  Tip: con <b>CUIT</b> trae datos desde ARCA. Con <b>DNI</b> completás todo manualmente.
                </div>
              )}
            </article>
          </div>

          <div className="mit-actions">
            <button
              type="button"
              className="mit-btn mit-btn--ghost"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="mit-btn mit-btn--solid"
              onClick={usarDatos}
              disabled={loading || !onlyDigits(docNro)}
            >
              Usar estos datos <FaCheck style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
