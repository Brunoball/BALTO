import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../OrdenesPagoModals.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faPrint,
  faFilePdf,
  faCheck,
  faCircleNotch,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

import html2pdf from "html2pdf.js/dist/html2pdf.min";
import { ordenesPagoFetch } from "../api/ordenesPagoApi.js";


/* =========================
   Helpers
========================= */
function sanitizeFileName(name) {
  return String(name || "Orden de Pago")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureFullHtmlDocument(html, title) {
  const s = String(html || "").trim();
  const hasHtmlTag = /<html[\s>]/i.test(s);
  const hasBodyTag = /<body[\s>]/i.test(s);

  const printCss = `
    <style>
      @page { size: A4; margin: 10mm; }
      html, body { background: #fff; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  `;

  if (hasHtmlTag && hasBodyTag) {
    if (/<head[\s>]/i.test(s) && /<\/head>/i.test(s)) {
      return s.replace(/<\/head>/i, `${printCss}</head>`);
    }
    return s;
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${String(title || "Orden de Pago")}</title>
  ${printCss}
</head>
<body>
  ${s}
</body>
</html>`;
}

function extractBodyWithStyles(fullHtml) {
  const s = String(fullHtml || "").trim();
  if (!s) return { styles: "", body: "" };

  try {
    const doc = new DOMParser().parseFromString(s, "text/html");
    const styles = Array.from(doc.querySelectorAll("style"))
      .map((x) => x.textContent || "")
      .join("\n");

    const body = doc.body ? doc.body.innerHTML : s;
    return { styles, body };
  } catch {
    return { styles: "", body: s };
  }
}

function getSessionKey() {
  const keys = [
    "session_key",
    "SESSION_KEY",
    "balto_session_key",
    "BALTO_SESSION_KEY",
    "x_session",
    "X_SESSION",
    "X-Session",
    "x-session",
  ];
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function getApiPhpUrl() {
  const base = String(BASE_URL || "").replace(/\/+$/, "");
  if (/\/api\.php$/i.test(base)) return base;
  return `${base}/api.php`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ordenesPagoFetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function parseJsonFromResponse(res) {
  const text = await res.text();
  if (!text) return { ok: false, data: null, text: "" };
  try {
    return { ok: true, data: JSON.parse(text), text };
  } catch {
    return { ok: false, data: null, text };
  }
}

function extractIdComprobante(data) {
  const cand =
    data?.id_comprobante ??
    data?.idComprobante ??
    data?.comprobante_id ??
    data?.data?.id_comprobante ??
    data?.data?.idComprobante ??
    data?.data?.comprobante_id ??
    data?.data?.id ??
    data?.id ??
    0;

  const n = Number(cand || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryAsync(fn, attempts = 4, baseDelay = 450) {
  let lastErr = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i + 1);
    } catch (e) {
      lastErr = e;
      if (i >= attempts - 1) break;
      const wait = baseDelay * Math.pow(2, i);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Falló la operación luego de varios reintentos.");
}

const mmToPx = (mm) => Math.round((mm * 96) / 25.4);

/* =========================
   Persistencia ligera local
========================= */
const LS_KEY = "balto_orden_pago_pending_v1";

function buildPendingKey({ idsMovs, idCobro, title }) {
  return JSON.stringify({
    ids: (Array.isArray(idsMovs) ? idsMovs : [])
      .map(Number)
      .filter(Boolean)
      .sort((a, b) => a - b),
    idCobro: Number(idCobro || 0),
    title: String(title || ""),
  });
}

function savePendingSnapshot(snapshot) {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        ...snapshot,
        ts: Date.now(),
      })
    );
  } catch {}
}

function clearPendingSnapshot(expectedKey) {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.pendingKey || parsed.pendingKey === expectedKey) {
      localStorage.removeItem(LS_KEY);
    }
  } catch {}
}

/* =========================
   PDF perf config
========================= */
const PDF_SCALE_SAVE = 1.25;
const PDF_SCALE_EXPORT = 1.8;
const PDF_SAVE_TIMEOUT = 60000;

export default function ModalOrdenPagoGenerada({
  open,
  onClose,
  onFinalizar,
  html,
  title = "Orden de Pago",
  onToast,
  idsMovimientos = [],
  idsPagos = [],
  idCobro = null,
}) {
  const firstFocusRef = useRef(null);
  const previewRef = useRef(null);
  const exportHostRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const savedRef = useRef(null);
  const savingRef = useRef(false);
  const closingAndSavingRef = useRef(false);
  const savePromiseRef = useRef(null);
  const pdfBlobRef = useRef(null);
  const warmupStartedRef = useRef(false);
  const warmupTimerRef = useRef(null);

  const fullHtml = useMemo(() => ensureFullHtmlDocument(html, title), [html, title]);
  const extracted = useMemo(() => extractBodyWithStyles(fullHtml), [fullHtml]);

  const previewMarkup = useMemo(() => {
    const stylesTag = extracted.styles ? `<style>${extracted.styles}</style>` : "";
    return `${stylesTag}${extracted.body || ""}`;
  }, [extracted.styles, extracted.body]);

  const idsMovs = useMemo(() => {
    const arr = Array.isArray(idsMovimientos) ? idsMovimientos : [idsMovimientos];
    return arr
      .map((x) => Number(x || 0))
      .filter((x) => Number.isFinite(x) && x > 0);
  }, [idsMovimientos]);

  const idsPagosOk = useMemo(() => {
    const arr = Array.isArray(idsPagos) ? idsPagos : [idsPagos];
    return arr
      .map((x) => Number(x || 0))
      .filter((x) => Number.isFinite(x) && x > 0);
  }, [idsPagos]);

  const pendingKey = useMemo(
    () => buildPendingKey({ idsMovs, idCobro, title }),
    [idsMovs, idCobro, title]
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => firstFocusRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    savePendingSnapshot({
      pendingKey,
      title,
      html,
      idsMovimientos: idsMovs,
      idsPago: idsPagosOk,
      idCobro: Number(idCobro || 0),
      status: "pending",
    });
  }, [open, pendingKey, title, html, idsMovs, idsPagosOk, idCobro]);

  useEffect(() => {
    if (!open) {
      if (warmupTimerRef.current) clearTimeout(warmupTimerRef.current);
      warmupTimerRef.current = null;
      warmupStartedRef.current = false;
      pdfBlobRef.current = null;
      savePromiseRef.current = null;
      savedRef.current = null;
      savingRef.current = false;
      closingAndSavingRef.current = false;
      setAutoSaving(false);
      setBusy(false);
      setSaveError("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onBeforeUnload = (e) => {
      if (savingRef.current || autoSaving || busy) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
      return undefined;
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [open, autoSaving, busy]);

  const buildWrapperForPdf = useCallback(async () => {
    if (!previewRef.current) throw new Error("No hay vista previa para exportar.");

    const host = exportHostRef.current;
    if (!host) throw new Error("No se pudo preparar el área de exportación.");

    host.innerHTML = "";

    const src = previewRef.current;
    const clone = src.cloneNode(true);

    const A4_W = 794;
    const pad = mmToPx(10);

    const wrapper = document.createElement("div");
    wrapper.style.width = `${A4_W}px`;
    wrapper.style.background = "#ffffff";
    wrapper.style.margin = "0";
    wrapper.style.padding = `${pad}px`;
    wrapper.style.boxSizing = "border-box";
    wrapper.style.display = "block";
    wrapper.style.height = "auto";
    wrapper.style.overflow = "hidden";

    clone.style.marginLeft = "auto";
    clone.style.marginRight = "auto";
    clone.style.width = "100%";
    clone.style.maxWidth = `${A4_W - pad * 2}px`;

    wrapper.appendChild(clone);
    host.appendChild(wrapper);

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return wrapper;
  }, []);

  const generatePdfBlob = useCallback(
    async (quality = "save") => {
      if (pdfBlobRef.current) return pdfBlobRef.current;

      const wrapper = await buildWrapperForPdf();
      const contentH = Math.ceil(wrapper.scrollHeight || 0);

      const scale = quality === "export" ? PDF_SCALE_EXPORT : PDF_SCALE_SAVE;

      const opt = {
        margin: 0,
        image: { type: "jpeg", quality: quality === "export" ? 0.96 : 0.9 },
        html2canvas: {
          scale,
          useCORS: true,
          backgroundColor: "#ffffff",
          logging: false,
          scrollX: 0,
          scrollY: 0,
          windowWidth: 794,
          windowHeight: contentH > 0 ? contentH : undefined,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };

      const worker = html2pdf().set(opt).from(wrapper).toPdf();
      const blob = await worker.output("blob");
      if (!blob) throw new Error("No se pudo generar el PDF.");
      pdfBlobRef.current = blob;
      return blob;
    },
    [buildWrapperForPdf]
  );

  const handlePrint = useCallback(() => {
    try {
      if (!fullHtml) throw new Error("No hay HTML para imprimir.");

      const w = window.open("", "_blank");
      if (!w) throw new Error("El navegador bloqueó el popup de impresión.");

      w.document.open();
      w.document.write(fullHtml);
      w.document.close();
      w.focus();
      w.print();

      onToast?.("exito", "Panel de impresión abierto.");
    } catch (e) {
      onToast?.("error", e?.message || "No se pudo imprimir.");
    }
  }, [fullHtml, onToast]);

  const handleExportPdf = useCallback(async () => {
    try {
      setBusy(true);

      const blob = await generatePdfBlob("export");
      const filename = `${sanitizeFileName(title)}.pdf`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      onToast?.("exito", "PDF exportado");
    } catch (e) {
      onToast?.("error", e?.message || "No se pudo exportar el PDF.");
    } finally {
      setBusy(false);
    }
  }, [generatePdfBlob, title, onToast]);

  const uploadAndLinkPdfToServer = useCallback(
    async (pdfBlob) => {
      const sessionKey = getSessionKey();
      if (!sessionKey) throw new Error("Sesión inválida (no hay X-Session).");

      if (!idsMovs.length) {
        throw new Error("Faltan idsMovimientos válidos para guardar la orden de pago.");
      }

      const safeName = sanitizeFileName(title);
      const file = new File([pdfBlob], `${safeName}.pdf`, {
        type: "application/pdf",
      });

      const fd = new FormData();
      fd.append("action", "ordenes_pago_comprobante_subir_y_vincular");
      fd.append("tipo", "ORDEN_PAGO");
      fd.append("titulo", String(title || "Orden de Pago"));
      fd.append("force", "0");
      idsMovs.forEach((id) => fd.append("ids_movimiento[]", String(id)));
      const cob = Number(idCobro);
      if (Number.isFinite(cob) && cob > 0) {
        fd.append("id_pago", String(cob));
        fd.append("id_cobro", String(cob));
      }
      idsPagosOk.forEach((id) => {
        fd.append("ids_pago[]", String(id));
        fd.append("ids_cobro[]", String(id));
        fd.append("ids_movimiento_medio_pago[]", String(id));
      });
      fd.append("archivo", file);

      const url = `${getApiPhpUrl()}?action=ordenes_pago_comprobante_subir_y_vincular`;

      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "X-Session": sessionKey },
          body: fd,
        },
        PDF_SAVE_TIMEOUT
      );

      const { ok, data, text } = await parseJsonFromResponse(res);

      if (!res.ok || !ok || !data?.exito) {
        const msg =
          data?.mensaje ||
          `No se pudo guardar la orden de pago (HTTP ${res.status}).` +
            (text ? ` Respuesta: ${text.slice(0, 250)}` : "");
        throw new Error(msg);
      }

      const errores = Array.isArray(data?.errores)
        ? data.errores
        : Array.isArray(data?.result?.errores)
        ? data.result.errores
        : [];

      if (errores.length > 0) {
        const detalle = errores
          .map((x) =>
            `mov ${x?.id_movimiento ?? "?"}: ${x?.mensaje ?? "error de asociación"}`
          )
          .join(" | ");

        throw new Error(`Se guardó el archivo, pero hubo errores de asociación. ${detalle}`);
      }

      const idComp = extractIdComprobante(data);
      if (!idComp) {
        throw new Error("El backend guardó la orden de pago pero no devolvió id_comprobante.");
      }

      return { ...data, id_comprobante: idComp };
    },
    [idsMovs, idsPagosOk, idCobro, title]
  );

  const ensureSaved = useCallback(async () => {
    if (savedRef.current) return savedRef.current;
    if (savePromiseRef.current) return await savePromiseRef.current;

    if (!idsMovs.length) {
      throw new Error("Faltan idsMovimientos válidos para vincular la orden de pago.");
    }

    setSaveError("");

    const task = (async () => {
      savingRef.current = true;
      try {
        const pdfBlob = await retryAsync(() => generatePdfBlob("save"), 3, 250);

        const saved = await retryAsync(async () => {
          const up = await uploadAndLinkPdfToServer(pdfBlob);

          const finalSaved = {
            ...up,
            id_comprobante: Number(up?.id_comprobante || 0),
            ids_movimiento: idsMovs,
            ids_pago: idsPagosOk,
          };

          return finalSaved;
        }, 4, 500);

        savedRef.current = saved;

        clearPendingSnapshot(pendingKey);
        return saved;
      } catch (e) {
        const msg = e?.message || "No se pudo guardar el comprobante.";
        setSaveError(msg);

        savePendingSnapshot({
          pendingKey,
          title,
          html,
          idsMovimientos: idsMovs,
          idsPago: idsPagosOk,
          idCobro: Number(idCobro || 0),
          status: "error",
          error: msg,
        });

        throw e;
      } finally {
        savingRef.current = false;
      }
    })();

    savePromiseRef.current = task;
    return await task;
  }, [
    idsMovs,
    generatePdfBlob,
    uploadAndLinkPdfToServer,
    pendingKey,
    title,
    html,
    idCobro,
  ]);

  const startWarmupSave = useCallback(() => {
    if (!open) return;
    if (warmupStartedRef.current) return;
    if (!idsMovs.length) return;

    warmupStartedRef.current = true;
    setAutoSaving(true);

    const runner = async () => {
      try {
        await ensureSaved();
      } catch {
        // se informa sólo si el usuario finaliza o cierra
      } finally {
        setAutoSaving(false);
      }
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => {
        void runner();
      }, { timeout: 350 });
    } else {
      warmupTimerRef.current = setTimeout(() => {
        void runner();
      }, 120);
    }
  }, [open, idsMovs.length, ensureSaved]);

  useEffect(() => {
    if (!open) return;
    startWarmupSave();
  }, [open, startWarmupSave]);

  const finalizeAndCloseAll = useCallback(async () => {
    if (busy || closingAndSavingRef.current) return;

    try {
      closingAndSavingRef.current = true;
      setBusy(true);

      const saved = await ensureSaved();
      onFinalizar?.(saved);
    } catch (e) {
      onToast?.(
        "error",
        e?.message || "No se pudo finalizar la orden de pago. Reintentá.");
    } finally {
      closingAndSavingRef.current = false;
      setBusy(false);
    }
  }, [busy, ensureSaved, onFinalizar, onToast]);

  const handleCloseOnly = useCallback(async () => {
    await finalizeAndCloseAll();
  }, [finalizeAndCloseAll]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void finalizeAndCloseAll();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, finalizeAndCloseAll]);

  const handleFinalizar = useCallback(async () => {
    await finalizeAndCloseAll();
  }, [finalizeAndCloseAll]);

  if (!open) return null;

  const overlayClass = "gm-modal-overlay";
  const modalClass = "gm-modal-container gm-modal-container--movement gm-modal-v2";

  return createPortal(
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Orden de Pago"}
    >
      <div
        className={modalClass}
        style={{ width: "min(980px, 96vw)", maxWidth: "980px" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gm-modal-header gm-view-header">
          <div className="gm-view-head-left">
            <h2 className="gm-modal-title gm-view-title">{title}</h2>
            <p className="gm-modal-subtitle gm-view-subtitle">
              Vista previa · X / ESC / Finalizar guardan y cierran todo igual
              {autoSaving ? " · guardando en segundo plano…" : ""}
            </p>
          </div>

          <button
            ref={firstFocusRef}
            type="button"
            className="gm-modal-close"
            onClick={handleCloseOnly}
            title="Guardar y cerrar"
            disabled={busy}
          >
            <FontAwesomeIcon icon={busy ? faCircleNotch : faXmark} spin={busy} />
          </button>
        </div>

        <div className="gm-modal-content gm-view-body">
          <div className="gm-view-content">
            {saveError ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(245, 158, 11, .35)",
                  background: "rgba(245, 158, 11, .08)",
                  color: "var(--text-color, #111)",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  <span>No se pudo guardar automáticamente todavía</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 14, opacity: 0.9 }}>
                  {saveError}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                  Podés tocar <b>Finalizar</b> otra vez y reintentará automáticamente.
                </div>
              </div>
            ) : null}

            <div className="gm-view-card">
              <div className="gm-view-preview gm-view-preview--html">
                <div
                  ref={previewRef}
                  style={{ background: "#fff", padding: 12, borderRadius: 10 }}
                  dangerouslySetInnerHTML={{
                    __html:
                      previewMarkup ||
                      "<div style='padding:12px'>Sin vista previa</div>",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="gm-view-footer">
          <div className="gm-view-footer-actions">
          <button
            type="button"
            className="gm-action-btn gm-action-btn--secondary"
            id="maxBTN"
            onClick={handlePrint}
            disabled={busy}
          >
            <FontAwesomeIcon icon={busy ? faCircleNotch : faPrint} spin={busy} />{" "}
            Imprimir
          </button>

          <button
            type="button"
            className="gm-action-btn gm-action-btn--secondary"
            id="maxBTN"
            onClick={handleExportPdf}
            disabled={busy}
          >
            <FontAwesomeIcon icon={busy ? faCircleNotch : faFilePdf} spin={busy} />{" "}
             PDF
          </button>

          <button
            type="button"
            className="gm-action-btn gm-action-btn--save"
            id="maxBTN"
            onClick={handleFinalizar}
            disabled={busy}
          >
            <FontAwesomeIcon icon={busy ? faCircleNotch : faCheck} spin={busy} />{" "}
            {busy ? "Guardando…" : "Finalizar"}
          </button>
          </div>
        </div>

        <div
          ref={exportHostRef}
          style={{
            position: "fixed",
            left: "0",
            top: "0",
            width: "794px",
            opacity: 0,
            pointerEvents: "none",
            zIndex: -1,
            background: "#fff",
          }}
        />
      </div>
    </div>,
    document.body
  );
}
