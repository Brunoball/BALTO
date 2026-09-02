import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import "../../../Global/Global_css/GlobalsModalsV2.css";
import "../RecibosModals.css";
import "../../../Global/Global_css/roots.css";
import BASE_URL from "../../../../config/config";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faPrint,
  faFilePdf,
  faCheck,
  faCircleNotch,
} from "@fortawesome/free-solid-svg-icons";

import html2pdf from "html2pdf.js/dist/html2pdf.min";
import { recibosFetch } from "../api/recibosApi.js";


/* =========================
   Helpers
========================= */
function sanitizeFileName(name) {
  return String(name || "Recibo")
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
  <title>${String(title || "Recibo")}</title>
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

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
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

    if (v && String(v).trim() !== "") {
      return String(v).trim();
    }
  }

  return "";
}

function getApiPhpUrl() {
  const base = String(BASE_URL || "").replace(/\/+$/, "");

  if (/\/api\.php$/i.test(base)) {
    return base;
  }

  return `${base}/api.php`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await recibosFetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
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

const EXTRA_RECIBO_CSS = `
.paper .rc-title{
  font-weight: 600 !important;
  letter-spacing: .2px !important;
}

.paper .rc-headRow{
  display:flex !important;
  align-items:center !important;
  gap:10px !important;
  flex-wrap: wrap !important;
}

.paper .rc-chip{
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  padding:6px 10px !important;
  border-radius:999px !important;
  background: rgba(241,245,249,.75) !important;
  border: 1px solid rgba(226,232,240,1) !important;
  font-weight: 600 !important;
  font-size: 12px !important;
  white-space: nowrap !important;
}

.paper .recibo-subtitle,
.paper .rc-subtitle{
  display:none !important;
}

.paper .totalBox .v,
.paper .totalBox .amount,
.paper .rc-totalValue,
.paper .total-amount{
  font-weight: 600 !important;
}
`;

function transformReciboBodyHtml(bodyHtml) {
  const s = String(bodyHtml || "").trim();

  if (!s) return s;

  try {
    const doc = new DOMParser().parseFromString(`<body>${s}</body>`, "text/html");
    const root = doc.body;

    const allEls = Array.from(root.querySelectorAll("*"));

    for (const el of allEls) {
      const t = normalizeText(el.textContent);

      if (
        t === "sistema contable · comprobante interno" ||
        t === "sistema contable · comprobante interno."
      ) {
        el.remove();
        break;
      }
    }

    let titleEl = null;

    for (const el of allEls) {
      const t = normalizeText(el.textContent);

      if (t === "recibo de cobro" || t.includes("recibo de cobro")) {
        if (String(el.textContent || "").trim().length <= 40) {
          titleEl = el;
          break;
        }
      }
    }

    let chipEl = null;
    const allEls2 = Array.from(root.querySelectorAll("*"));

    for (const el of allEls2) {
      const t = normalizeText(el.textContent);

      if (t.startsWith("medio:") || t.startsWith("medio de pago:")) {
        if (String(el.textContent || "").trim().length <= 60) {
          chipEl = el;
          break;
        }
      }
    }

    if (titleEl) {
      titleEl.classList.add("rc-title");

      if (chipEl) {
        chipEl.classList.add("rc-chip");

        const alreadyRow =
          titleEl.parentElement &&
          titleEl.parentElement.classList.contains("rc-headRow");

        if (!alreadyRow) {
          const row = doc.createElement("div");
          row.className = "rc-headRow";

          const parent = titleEl.parentElement;

          if (parent) {
            parent.insertBefore(row, titleEl);
            row.appendChild(titleEl);
            row.appendChild(chipEl);
          }
        }
      }
    }

    return root.innerHTML;
  } catch {
    return s;
  }
}

/* =========================
   Persistencia ligera local
========================= */
const LS_KEY = "balto_recibo_pending_v2";

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

export default function ModalReciboGenerado({
  open,
  onClose,
  onFinalizar,
  html,
  title = "Recibo",
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
  const lastSaveErrorToastRef = useRef("");

  const fullHtml = useMemo(() => ensureFullHtmlDocument(html, title), [html, title]);
  const extracted = useMemo(() => extractBodyWithStyles(fullHtml), [fullHtml]);

  const previewMarkup = useMemo(() => {
    const transformedBody = transformReciboBodyHtml(extracted.body || "");
    const mergedStyles = `${extracted.styles || ""}\n${EXTRA_RECIBO_CSS}`.trim();
    const stylesTag = mergedStyles ? `<style>${mergedStyles}</style>` : "";

    return `${stylesTag}${transformedBody || ""}`;
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
    () =>
      buildPendingKey({
        idsMovs,
        idCobro,
        title,
      }),
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
      if (warmupTimerRef.current) {
        clearTimeout(warmupTimerRef.current);
      }

      warmupTimerRef.current = null;
      warmupStartedRef.current = false;
      pdfBlobRef.current = null;
      savePromiseRef.current = null;
      savedRef.current = null;
      savingRef.current = false;
      closingAndSavingRef.current = false;
      lastSaveErrorToastRef.current = "";

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
    if (!previewRef.current) {
      throw new Error("No hay vista previa para exportar.");
    }

    const host = exportHostRef.current;

    if (!host) {
      throw new Error("No se pudo preparar el área de exportación.");
    }

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
        image: {
          type: "jpeg",
          quality: quality === "export" ? 0.96 : 0.9,
        },
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
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait",
        },
        pagebreak: {
          mode: ["avoid-all", "css", "legacy"],
        },
      };

      const worker = html2pdf().set(opt).from(wrapper).toPdf();
      const blob = await worker.output("blob");

      if (!blob) {
        throw new Error("No se pudo generar el PDF.");
      }

      pdfBlobRef.current = blob;

      return blob;
    },
    [buildWrapperForPdf]
  );

  const handlePrint = useCallback(() => {
    try {
      if (!fullHtml) {
        throw new Error("No hay HTML para imprimir.");
      }

      const w = window.open("", "_blank");

      if (!w) {
        throw new Error("El navegador bloqueó el popup de impresión.");
      }

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

  const uploadPdfToServer = useCallback(
    async (pdfBlob) => {
      const sessionKey = getSessionKey();

      if (!sessionKey) {
        throw new Error("Sesión inválida (no hay X-Session).");
      }

      const safeName = sanitizeFileName(title);
      const file = new File([pdfBlob], `${safeName}.pdf`, {
        type: "application/pdf",
      });

      const fd = new FormData();

      fd.append("titulo", String(title || "Recibo"));

      if (idsMovs[0]) {
        fd.append("id_movimiento", String(idsMovs[0]));
      }

      idsMovs.forEach((id) => {
        fd.append("ids_movimiento[]", String(id));
      });

      const cob = Number(idCobro);

      if (Number.isFinite(cob) && cob > 0) {
        fd.append("id_cobro", String(cob));
        fd.append("id_pago", String(cob));
      }

      idsPagosOk.forEach((id) => {
        fd.append("ids_pago[]", String(id));
        fd.append("ids_cobro[]", String(id));
        fd.append("ids_movimiento_medio_pago[]", String(id));
      });

      fd.append("archivo", file);

      const url = `${getApiPhpUrl()}?action=recibos_comprobantes_subir`;

      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "X-Session": sessionKey,
          },
          body: fd,
        },
        PDF_SAVE_TIMEOUT
      );

      const text = await res.text();

      if (!text) {
        throw new Error(`Respuesta vacía del servidor (HTTP ${res.status}).`);
      }

      let data = null;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Respuesta inválida al subir comprobante (HTTP ${res.status}). ${text.slice(
            0,
            300
          )}`
        );
      }

      if (!res.ok || !data?.exito) {
        throw new Error(
          data?.mensaje ||
            `No se pudo guardar el comprobante (HTTP ${res.status}). ${text.slice(
              0,
              300
            )}`
        );
      }

      const idComp = extractIdComprobante(data);

      if (!idComp) {
        throw new Error("El backend guardó el PDF pero no devolvió id_comprobante.");
      }

      return {
        ...data,
        id_comprobante: idComp,
      };
    },
    [title, idsMovs, idsPagosOk, idCobro]
  );

  const asociarComprobanteAMovimientos = useCallback(async (idComprobante, ids, idsPago = []) => {
    const sessionKey = getSessionKey();

    if (!sessionKey) {
      throw new Error("Sesión inválida (no hay X-Session).");
    }

    const idsOk = (Array.isArray(ids) ? ids : [])
      .map((x) => Number(x || 0))
      .filter(Boolean);
    const idsPagoOk = (Array.isArray(idsPago) ? idsPago : [])
      .map((x) => Number(x || 0))
      .filter(Boolean);

    if (!idsOk.length && !idsPagoOk.length) {
      return { exito: true };
    }

    const url = getApiPhpUrl();

    const res = await fetchWithTimeout(
      `${url}?action=recibos_comprobantes_asociar_movimientos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session": sessionKey,
        },
        body: JSON.stringify({
          id_comprobante: Number(idComprobante),
          ids_movimiento: idsOk,
          ids_pago: idsPagoOk,
          ids_cobro: idsPagoOk,
          ids_movimiento_medio_pago: idsPagoOk,
        }),
      },
      PDF_SAVE_TIMEOUT
    );

    const text = await res.text();

    if (!text) {
      throw new Error(`Respuesta vacía al asociar comprobante (HTTP ${res.status}).`);
    }

    let data = null;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Respuesta inválida al asociar comprobante (HTTP ${res.status}). ${text.slice(
          0,
          300
        )}`
      );
    }

    if (!res.ok || !data?.exito) {
      throw new Error(
        data?.mensaje ||
          `No se pudo asociar el comprobante (HTTP ${res.status}). ${text.slice(
            0,
            300
          )}`
      );
    }

    return data;
  }, []);

  const ensureSaved = useCallback(async () => {
    if (savedRef.current) return savedRef.current;

    if (savePromiseRef.current) {
      return await savePromiseRef.current;
    }

    if (!idsMovs.length) {
      throw new Error("Faltan idsMovimientos válidos para vincular el recibo.");
    }

    setSaveError("");

    const task = (async () => {
      savingRef.current = true;

      try {
        const pdfBlob = await retryAsync(() => generatePdfBlob("save"), 3, 250);

        const saved = await retryAsync(async () => {
          const up = await uploadPdfToServer(pdfBlob);
          const idComp = extractIdComprobante(up);

          const idsDevueltos = Array.isArray(up?.ids_movimiento_vinculados)
            ? up.ids_movimiento_vinculados.map((x) => Number(x || 0)).filter(Boolean)
            : Array.isArray(up?.ids_movimiento)
            ? up.ids_movimiento.map((x) => Number(x || 0)).filter(Boolean)
            : [];
          const idsPagoDevueltos = Array.isArray(up?.ids_pago_vinculados)
            ? up.ids_pago_vinculados.map((x) => Number(x || 0)).filter(Boolean)
            : Array.isArray(up?.ids_movimiento_medio_pago_vinculados)
            ? up.ids_movimiento_medio_pago_vinculados.map((x) => Number(x || 0)).filter(Boolean)
            : [];

          const yaAsocioMovimientos =
            idsMovs.length > 0 && idsMovs.every((id) => idsDevueltos.includes(Number(id)));
          const yaAsocioPagos =
            idsPagosOk.length === 0 || idsPagosOk.every((id) => idsPagoDevueltos.includes(Number(id)));

          if (!yaAsocioMovimientos || !yaAsocioPagos) {
            await asociarComprobanteAMovimientos(idComp, idsMovs, idsPagosOk);
          }

          const finalSaved = {
            ...up,
            id_comprobante: idComp,
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

        const toastKey = `autosave-error:${msg}`;

        if (lastSaveErrorToastRef.current !== toastKey) {
          lastSaveErrorToastRef.current = toastKey;

          onToast?.(
            "error",
            `No se pudo guardar automáticamente todavía. ${msg}`
          );
        }

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
    idsPagosOk,
    generatePdfBlob,
    uploadPdfToServer,
    asociarComprobanteAMovimientos,
    pendingKey,
    title,
    html,
    idCobro,
    onToast,
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
        // El error ya se informa por toast dentro de ensureSaved.
      } finally {
        setAutoSaving(false);
      }
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(
        () => {
          void runner();
        },
        {
          timeout: 350,
        }
      );
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
        e?.message || "No se pudo finalizar el recibo. Reintentá."
      );
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

  const overlayClass = "gm-modal-overlay gm-modal-overlay--movement";
  const modalClass = "gm-modal-container gm-modal-container--movement gm-modal-v2 gm-view-modal";

  return createPortal(
    <div
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Recibo"}
    >
      <div
        className={modalClass}
        style={{
          width: "min(980px, 96vw)",
          maxWidth: "980px",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="gm-modal-header gm-view-header">
          <div className="gm-view-head-left">
            <div className="gm-view-title">
              <span>{title}</span>
            </div>

            <div className="gm-view-subtitle">
              Vista previa · X / ESC / Finalizar guardan y cierran todo igual
              {autoSaving ? " · guardando en segundo plano…" : ""}
            </div>
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
            <div className="gm-view-card">
              <div className="gm-view-preview gm-view-preview--html">
                <div
                  ref={previewRef}
                  style={{
                    background: "#fff",
                    padding: 12,
                    borderRadius: 10,
                  }}
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

        <div className="gm-actions gm-view-footer gm-view-footer-actions">
          <button
            type="button"
            className="gm-action-btn gm-action-btn--save"
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