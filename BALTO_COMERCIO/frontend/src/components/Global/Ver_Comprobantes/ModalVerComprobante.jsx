import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../Global_css/Global_Modals.css";
import "../Global_css/Global_oscuro.css";
import "../Global_css/GlobalsModalsV2.css";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faUpRightFromSquare,
} from "@fortawesome/free-solid-svg-icons";

function safeText(v) {
  return String(v ?? "").trim();
}

function buildHeadersGET() {
  const sessionKey = safeText(localStorage.getItem("session_key"));
  const token = safeText(localStorage.getItem("token"));
  const h = {};
  if (sessionKey) h["X-Session"] = sessionKey;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function isBlobUrl(v = "") {
  return safeText(v).startsWith("blob:");
}

function isAbsoluteHttpUrl(v = "") {
  return /^https?:\/\//i.test(safeText(v));
}

function isSameOriginUrl(v = "") {
  const s = safeText(v);
  if (!s) return false;

  try {
    const u = new URL(s, window.location.origin);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

function shouldSendAuthHeaders(url = "") {
  if (!url) return false;
  if (isBlobUrl(url)) return false;
  return isSameOriginUrl(url);
}

function getExtensionFromUrl(url = "") {
  const clean = safeText(url).split("?")[0].split("#")[0].toLowerCase();
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m?.[1] || "";
}

function basenameFromPath(v = "") {
  const s = safeText(v);
  if (!s) return "";
  const clean = s.split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function getUrlParamFileName(url = "") {
  try {
    const u = new URL(url, window.location.origin);

    const possibleKeys = [
      "archivo",
      "file",
      "filename",
      "nombre",
      "name",
      "archivo_url",
      "archivo_path",
      "path",
      "response-content-disposition",
    ];

    for (const key of possibleKeys) {
      const value = safeText(u.searchParams.get(key));
      if (value) {
        const last = basenameFromPath(value);
        if (last) return last;
      }
    }
  } catch {}

  return "";
}

function removeDangerousExtension(name = "") {
  const n = safeText(name);
  if (!n) return "";

  return n
    .replace(/\.(php|phtml|php3|php4|php5|phar|cgi|pl|py|sh|exe|dll|bat|cmd)$/i, "")
    .trim();
}

function guessKindFromUrlOrMime(url, mime = "") {
  const u = safeText(url).toLowerCase();
  const m = safeText(mime).toLowerCase();
  const ext = getExtensionFromUrl(u);

  if (m.includes("pdf")) return "pdf";
  if (m.startsWith("image/")) return "img";

  if (m.includes("text/csv") || m.includes("application/csv")) return "csv";
  if (m.includes("application/json") || m.includes("text/json")) return "json";
  if (m.includes("text/plain")) return "text";
  if (m.includes("text/html")) return "html";

  if (
    m.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    m.includes("application/vnd.ms-excel") ||
    m.includes("spreadsheet")
  ) {
    return "excel";
  }

  if (
    m.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    m.includes("application/msword") ||
    m.includes("word")
  ) {
    return "word";
  }

  if (ext === "csv") return "csv";
  if (ext === "txt") return "text";
  if (ext === "json") return "json";
  if (ext === "html" || ext === "htm") return "html";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(ext)) return "img";
  if (ext === "pdf") return "pdf";
  if (["xlsx", "xls"].includes(ext)) return "excel";
  if (["docx", "doc"].includes(ext)) return "word";

  return "other";
}

function parseContentDispositionFileName(contentDisposition = "") {
  const cd = safeText(contentDisposition);
  if (!cd) return "";

  const utf8Match = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/["']/g, ""));
    } catch {
      return utf8Match[1].replace(/["']/g, "");
    }
  }

  const plainMatch =
    cd.match(/filename\s*=\s*"([^"]+)"/i) || cd.match(/filename\s*=\s*([^;]+)/i);

  if (plainMatch?.[1]) {
    return plainMatch[1].replace(/["']/g, "").trim();
  }

  return "";
}

function kindToPreferredExt(kind = "other", mime = "", url = "") {
  const m = safeText(mime).toLowerCase();
  const extUrl = getExtensionFromUrl(url);

  if (kind === "csv") return "csv";
  if (kind === "json") return "json";
  if (kind === "text") return "txt";
  if (kind === "html") return "html";
  if (kind === "pdf") return "pdf";

  if (kind === "excel") {
    if (m.includes("application/vnd.ms-excel")) return "xls";
    return "xlsx";
  }

  if (kind === "word") {
    if (m.includes("application/msword")) return "doc";
    return "docx";
  }

  if (kind === "img") {
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    if (m.includes("bmp")) return "bmp";
    if (m.includes("svg")) return "svg";
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";

    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extUrl)) {
      return extUrl === "jpeg" ? "jpg" : extUrl;
    }

    return "jpg";
  }

  if (m.includes("pdf")) return "pdf";
  if (m.includes("text/csv")) return "csv";
  if (m.includes("application/json") || m.includes("text/json")) return "json";
  if (m.includes("text/plain")) return "txt";
  if (m.includes("text/html")) return "html";

  if (extUrl) return extUrl;

  return "bin";
}

function normalizeBaseName(title = "") {
  const t = safeText(title)
    .toLowerCase()
    .replace(/^comprobante\s+de\s+/i, "")
    .replace(/^comprobante\s+/i, "")
    .replace(/[^\wáéíóúñü]+/gi, "_")
    .replace(/^_+|_+$/g, "");

  return t || "archivo";
}

function splitNameAndExt(name = "") {
  const n = safeText(name);
  if (!n) return { base: "", ext: "" };

  const clean = basenameFromPath(n);
  const m = clean.match(/^(.*?)(?:\.([a-z0-9]+))?$/i);

  return {
    base: safeText(m?.[1]),
    ext: safeText(m?.[2]).toLowerCase(),
  };
}

function buildSimpleDisplayName({
  explicitFileName = "",
  headerFileName = "",
  mime = "",
  kind = "other",
  title = "",
  url = "",
}) {
  const preferredExt = kindToPreferredExt(kind, mime, url);

  const fromExplicit = removeDangerousExtension(explicitFileName);
  const fromHeader = removeDangerousExtension(headerFileName);
  const fromUrlParam = removeDangerousExtension(getUrlParamFileName(url));

  const candidate = safeText(fromExplicit || fromHeader || fromUrlParam);
  const parsed = splitNameAndExt(candidate);

  let base = parsed.base;
  let ext = parsed.ext;

  if (!base) {
    const baseFromUrl = removeDangerousExtension(
      basenameFromPath(safeText(url).split("?")[0].split("#")[0])
    );
    const parsedUrl = splitNameAndExt(baseFromUrl);
    base = parsedUrl.base;
    ext = ext || parsedUrl.ext;
  }

  if (!base) {
    base = normalizeBaseName(title || "comprobante");
  }

  const finalExt = preferredExt || ext || "bin";
  return `${base}.${finalExt}`;
}

function resolveFixedModalTitle(title = "") {
  const t = safeText(title).toLowerCase();

  const plural = t.includes("comprobantes");

  if (t.includes("venta")) return plural ? "Comprobantes de Venta" : "Comprobante de Venta";
  if (t.includes("ingreso")) return plural ? "Comprobantes de Ingreso" : "Comprobante de Ingreso";
  if (t.includes("egreso")) return plural ? "Comprobantes de Egreso" : "Comprobante de Egreso";
  if (t.includes("compra")) return plural ? "Comprobantes de Compra" : "Comprobante de Compra";
  if (t.includes("cobro")) return plural ? "Comprobantes de Cobro" : "Comprobante de Cobro";
  if (t.includes("pago")) return plural ? "Comprobantes de Pago" : "Comprobante de Pago";

  return "Comprobante";
}

function looksBinaryGarbage(text = "") {
  if (!text) return false;
  let weird = 0;
  const max = Math.min(text.length, 1200);

  for (let i = 0; i < max; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    ) {
      weird += 1;
    }
  }

  return weird > 8;
}

function parseCsvLine(line = "", delimiter = ",") {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((x) => x.trim());
}

function parseCSV(text = "") {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const first = lines[0];
  const delimiter =
    (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";

  const rows = lines.map((line) => parseCsvLine(line, delimiter));
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);

  return { headers, rows: dataRows };
}

function normalizeDocumentsInput({ documents, url, mime = "", fileName = "", title = "Comprobante" }) {
  if (Array.isArray(documents) && documents.length > 0) {
    return documents
      .map((doc, index) => {
        const docUrl = safeText(doc?.url || doc?.archivo_url || doc?.href || "");
        if (!docUrl) return null;

        const label = safeText(doc?.label || doc?.tabLabel || doc?.title || `Archivo ${index + 1}`);
        const keyBase = safeText(doc?.key || doc?.id_comprobante || doc?.id || label || index);

        return {
          key: `${keyBase}-${index}`,
          label,
          title: safeText(doc?.title || label || title),
          url: docUrl,
          mime: safeText(doc?.mime || doc?.archivo_mime || mime),
          fileName: safeText(doc?.fileName || doc?.filename || doc?.nombre_archivo || fileName),
        };
      })
      .filter(Boolean);
  }

  const singleUrl = safeText(url);
  if (!singleUrl) return [];

  return [
    {
      key: "principal-0",
      label: safeText(title || "Comprobante"),
      title: safeText(title || "Comprobante"),
      url: singleUrl,
      mime: safeText(mime),
      fileName: safeText(fileName),
    },
  ];
}

export default function ModalVerComprobante({
  open,
  url,
  mime = "",
  fileName = "",
  documents = null,
  onClose,
  title = "Comprobante",
}) {
  const closeBtnRef = useRef(null);
  const overlayRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [blobUrl, setBlobUrl] = useState("");
  const [resolvedMime, setResolvedMime] = useState("");
  const [resolvedFileName, setResolvedFileName] = useState("");
  const [textPreview, setTextPreview] = useState("");
  const [htmlPreview, setHtmlPreview] = useState("");
  const [activeTabKey, setActiveTabKey] = useState("");
  const internalBlobRef = useRef("");

  const tabs = useMemo(
    () => normalizeDocumentsInput({ documents, url, mime, fileName, title }),
    [documents, url, mime, fileName, title]
  );

  useEffect(() => {
    if (!open) {
      setActiveTabKey("");
      return;
    }
    if (!tabs.length) return;
    if (!tabs.some((tab) => tab.key === activeTabKey)) {
      setActiveTabKey(tabs[0].key);
    }
  }, [open, tabs, activeTabKey]);

  const activeDoc = useMemo(() => {
    return tabs.find((tab) => tab.key === activeTabKey) || tabs[0] || null;
  }, [tabs, activeTabKey]);

  const activeUrl = activeDoc?.url || "";
  const activeMime = activeDoc?.mime || "";
  const activeFileName = activeDoc?.fileName || "";
  const activeTitle = activeDoc?.title || activeDoc?.label || title;

  const modalTitle = useMemo(() => resolveFixedModalTitle(title), [title]);

  const initialKind = useMemo(() => {
    return guessKindFromUrlOrMime(activeUrl, activeMime);
  }, [activeUrl, activeMime]);

  const isDirectPreviewKind = useMemo(() => {
    return initialKind === "pdf" || initialKind === "img";
  }, [initialKind]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;

      const overlays = Array.from(
        document.querySelectorAll('[data-stock-modal-overlay="true"], [data-modal-overlay="true"]')
      ).filter((element) => element?.isConnected);

      if (overlays.length && overlays[overlays.length - 1] !== overlayRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      if (typeof e.stopImmediatePropagation === "function") {
        e.stopImmediatePropagation();
      }

      onClose?.();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const revokeInternalBlob = () => {
      if (internalBlobRef.current) {
        URL.revokeObjectURL(internalBlobRef.current);
        internalBlobRef.current = "";
      }
    };

    if (!open || !activeUrl) {
      setLoading(false);
      setErrorMsg("");
      setResolvedMime("");
      setResolvedFileName("");
      setTextPreview("");
      setHtmlPreview("");
      setBlobUrl("");
      revokeInternalBlob();
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setErrorMsg("");
      setResolvedMime("");
      setResolvedFileName("");
      setTextPreview("");
      setHtmlPreview("");
      setBlobUrl("");
      revokeInternalBlob();

      try {
        if (isBlobUrl(activeUrl)) {
          if (cancelled) return;

          setResolvedMime(safeText(activeMime));
          setResolvedFileName("");
          setBlobUrl(activeUrl);
          return;
        }

        const inferredKind = guessKindFromUrlOrMime(activeUrl, activeMime);

        if (inferredKind === "pdf" || inferredKind === "img") {
          if (cancelled) return;

          setResolvedMime(safeText(activeMime));
          setResolvedFileName("");
          setBlobUrl("");
          return;
        }

        const fetchOptions = {
          method: "GET",
        };

        if (shouldSendAuthHeaders(activeUrl)) {
          fetchOptions.headers = buildHeadersGET();
        }

        const res = await fetch(activeUrl, fetchOptions);

        if (res.status === 401 || res.status === 403) {
          throw new Error("Sesión vencida o no autorizada para ver este comprobante.");
        }

        if (!res.ok) {
          throw new Error(`No se pudo cargar el comprobante. HTTP ${res.status}`);
        }

        const contentType = safeText(res.headers.get("Content-Type")) || safeText(activeMime);
        const headerFileName = parseContentDispositionFileName(
          res.headers.get("Content-Disposition") || ""
        );

        const finalKind = guessKindFromUrlOrMime(activeUrl, contentType);

        setResolvedMime(contentType);
        setResolvedFileName(headerFileName);

        if (
          finalKind === "text" ||
          finalKind === "csv" ||
          finalKind === "json" ||
          finalKind === "html"
        ) {
          const text = await res.text();

          if (cancelled) return;

          if (finalKind === "html") {
            setHtmlPreview(text);
          } else {
            setTextPreview(text);
          }

          return;
        }

        if (finalKind === "pdf" || finalKind === "img") {
          if (cancelled) return;
          return;
        }

        const blob = await res.blob();
        const localBlobUrl = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(localBlobUrl);
          return;
        }

        internalBlobRef.current = localBlobUrl;
        setBlobUrl(localBlobUrl);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e?.message || "No se pudo cargar el comprobante.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
      revokeInternalBlob();
    };
  }, [open, activeUrl, activeMime]);

  const previewUrl = useMemo(() => {
    if (blobUrl) return blobUrl;
    if (isDirectPreviewKind) return activeUrl || "";
    return "";
  }, [blobUrl, isDirectPreviewKind, activeUrl]);

  const kind = useMemo(() => {
    if (textPreview) {
      const textKind = guessKindFromUrlOrMime(activeUrl, resolvedMime || activeMime);
      if (textKind === "other") return "text";
      return textKind;
    }
    if (htmlPreview) return "html";
    return guessKindFromUrlOrMime(previewUrl || activeUrl, resolvedMime || activeMime);
  }, [previewUrl, resolvedMime, activeMime, textPreview, htmlPreview, activeUrl]);

  const displayFileName = useMemo(() => {
    return buildSimpleDisplayName({
      explicitFileName: activeFileName,
      headerFileName: resolvedFileName,
      mime: resolvedMime || activeMime,
      kind,
      title: activeTitle || modalTitle,
      url: activeUrl,
    });
  }, [activeFileName, resolvedFileName, resolvedMime, activeMime, kind, activeTitle, modalTitle, activeUrl]);

  const csvData = useMemo(() => {
    if (kind !== "csv" || !textPreview) return { headers: [], rows: [] };
    return parseCSV(textPreview);
  }, [kind, textPreview]);

  const canPreviewText = useMemo(() => {
    return ["text", "json", "csv", "html"].includes(kind);
  }, [kind]);


  function handleOpen() {
    const target = blobUrl || activeUrl;
    if (target) window.open(target, "_blank", "noopener,noreferrer");
  }

  if (!open) return null;

  const overlayClass = "mi-modal__overlay mi-modal__overlay--mov";
  const modalClass = "mi-modal__container mi-modal__container--mov gm-modal-v2 gm-view-modal";

  return createPortal(
    <div
      ref={overlayRef}
      data-modal-overlay="true"
      className={overlayClass}
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={modalClass}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100 }}
      >
        <div className="mi-modal__header gm-view-header">
          <div className="gm-view-head-left">
            <div className="mi-modal__title gm-view-title">
              <span>{modalTitle}</span>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            className="mi-modal__close"
            onClick={onClose}
            aria-label="Cerrar"
            title="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="gm-view-tabs" role="tablist" aria-label="Comprobantes vinculados">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={tab.key === activeTabKey}
                className={["gm-view-tab", tab.key === activeTabKey ? "is-active" : ""].filter(Boolean).join(" ")}
                onClick={() => setActiveTabKey(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="mi-modal__body gm-view-body">
          <div className="gm-view-content">
            <div className="gm-view-card">
              {!activeUrl && <div className="mov-emptyRow">No hay comprobante.</div>}

              {!!activeUrl && loading && (
                <div className="mov-emptyRow" style={{ padding: 18 }}>
                  Cargando {displayFileName}...
                </div>
              )}

              {!!activeUrl && !loading && !!errorMsg && (
                <div className="mov-emptyRow" style={{ padding: 18, color: "#b91c1c" }}>
                  {errorMsg}
                </div>
              )}

              {!!previewUrl && !loading && !errorMsg && kind === "pdf" && (
                <div className="gm-view-preview" aria-label="Vista previa PDF">
                  <iframe
                    title={displayFileName || "Comprobante PDF"}
                    src={previewUrl}
                    className="gm-view-pdf-frame"
                  />
                </div>
              )}

              {!!previewUrl && !loading && !errorMsg && kind === "img" && (
                <div className="gm-view-preview" aria-label="Vista previa imagen">
                  <div className="gm-view-img-wrap">
                    <img
                      src={previewUrl}
                      alt={displayFileName || "Comprobante"}
                      className="gm-view-img"
                    />
                  </div>
                </div>
              )}

              {!!activeUrl && !loading && !errorMsg && kind === "csv" && (
                <div
                  className="gm-view-preview"
                  aria-label="Vista previa CSV"
                  style={{ padding: 12 }}
                >
                  {csvData.headers.length > 0 ? (
                    <div style={{ width: "100%", overflow: "auto" }}>
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 14,
                        }}
                      >
                        <thead>
                          <tr>
                            {csvData.headers.map((h, i) => (
                              <th
                                key={`${h}-${i}`}
                                style={{
                                  textAlign: "left",
                                  padding: "10px 12px",
                                  borderBottom: "1px solid #d1d5db",
                                  background: "#f8fafc",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {h || "-"}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvData.rows.length ? (
                            csvData.rows.map((row, rowIdx) => (
                              <tr key={rowIdx}>
                                {csvData.headers.map((_, colIdx) => (
                                  <td
                                    key={`${rowIdx}-${colIdx}`}
                                    style={{
                                      padding: "10px 12px",
                                      borderBottom: "1px solid #e5e7eb",
                                      verticalAlign: "top",
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {safeText(row[colIdx]) || "-"}
                                  </td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={Math.max(csvData.headers.length, 1)}
                                style={{ padding: 16, textAlign: "center" }}
                              >
                                El CSV no tiene filas para mostrar.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 14,
                      }}
                    >
                      {textPreview || "No hay contenido para mostrar."}
                    </pre>
                  )}
                </div>
              )}

              {!!activeUrl && !loading && !errorMsg && kind === "json" && (
                <div
                  className="gm-view-preview"
                  aria-label="Vista previa JSON"
                  style={{ padding: 12 }}
                >
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 14,
                    }}
                  >
                    {(() => {
                      try {
                        const obj = JSON.parse(textPreview);
                        return JSON.stringify(obj, null, 2);
                      } catch {
                        return textPreview || "No hay contenido para mostrar.";
                      }
                    })()}
                  </pre>
                </div>
              )}

              {!!activeUrl && !loading && !errorMsg && kind === "text" && (
                <div
                  className="gm-view-preview"
                  aria-label="Vista previa texto"
                  style={{ padding: 12 }}
                >
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 14,
                    }}
                  >
                    {looksBinaryGarbage(textPreview)
                      ? "El archivo parece binario y no se puede mostrar como texto."
                      : textPreview || "No hay contenido para mostrar."}
                  </pre>
                </div>
              )}

              {!!activeUrl && !loading && !errorMsg && kind === "html" && (
                <div className="gm-view-preview" aria-label="Vista previa HTML">
                  <iframe
                    title={displayFileName || "Vista previa HTML"}
                    srcDoc={htmlPreview}
                    className="gm-view-pdf-frame"
                    sandbox=""
                  />
                </div>
              )}

              {!!activeUrl &&
                !loading &&
                !errorMsg &&
                !canPreviewText &&
                (kind === "excel" || kind === "word" || kind === "other") && (
                  <div className="mov-emptyRow" style={{ padding: 14, lineHeight: 1.5 }}>
                    {kind === "excel" &&
                      "Este archivo de Excel no se puede previsualizar directamente en el navegador."}
                    {kind === "word" &&
                      "Este archivo de Word no se puede previsualizar directamente en el navegador."}
                    {kind === "other" &&
                      "No se puede previsualizar este archivo en el navegador."}
                    <br />
                    Podés abrirlo desde abajo.
                  </div>
                )}
            </div>
          </div>
        </div>

        <div className="mi-modal__footer gm-view-footer">
          <div className="gm-view-footer-actions">
            <button
              type="button"
              className="mit-btn mit-btn--solid gm-view-action-btn gm-view-action-btn--open"
              onClick={handleOpen}
              disabled={!blobUrl && !activeUrl}
              title={`Abrir ${displayFileName} en nueva pestaña`}
            >
              <FontAwesomeIcon icon={faUpRightFromSquare} className="gm-view-action-btn__icon" />
              Abrir
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}