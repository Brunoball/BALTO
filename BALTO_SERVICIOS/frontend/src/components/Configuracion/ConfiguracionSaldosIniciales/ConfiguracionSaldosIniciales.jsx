import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBuildingColumns,
  faCircleInfo,
  faFloppyDisk,
  faMoneyCheckDollar,
  faEye,
  faXmark,
  faPlus,
  faTrash,
  faUsers,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../../Global/Toast";
import ModalNuevoCheque from "../../Global/Modales/ModalNuevoCheque";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import ModalVerComprobante from "../../Global/Ver_Comprobantes/ModalVerComprobante";
import {
  apiFetchActionJson as apiFetch,
  buildConfiguracionApiUrl,
  getConfiguracionSessionKey,
  subirArchivoChequeConfiguracion,
  obtenerArchivoConfiguracion,
} from "../api/configuracionApi";
import { todayISO } from "../utils/configuracionUtils";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "./ConfiguracionSaldosIniciales.css";
import "./ConfiguracionSaldosInicialesVolver.css";
import "../ConfiguracionResponsiveScroll.css";


function parseMoney(value) {
  let s = String(value ?? "").trim().replace(/\$/g, "").replace(/\s+/g, "");
  if (!s) return 0;

  if (!/^[+-]?[0-9.,]+$/.test(s)) return null;

  const sign = s.startsWith("-") ? -1 : 1;
  s = s.replace(/^[+-]/, "");
  if (!s || !/[0-9]/.test(s)) return null;

  const commaCount = (s.match(/,/g) || []).length;
  const dotCount = (s.match(/\./g) || []).length;
  let normalized = s;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    if (s.split(decimalSep).length - 1 !== 1) return null;
    const [integerPart, decimalPart = ""] = s.split(decimalSep);
    if (decimalPart.length > 2 || !/^\d{0,2}$/.test(decimalPart)) return null;
    const integerGroups = integerPart.split(thousandSep);
    if (integerGroups.length > 1) {
      if (!/^\d{1,3}$/.test(integerGroups[0]) || integerGroups.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
    }
    normalized = integerGroups.join("") + (decimalPart !== "" ? `.${decimalPart}` : "");
  } else if (commaCount > 0) {
    if (commaCount !== 1) return null;
    const [integerPart, decimalPart = ""] = s.split(",");
    if (!/^\d+$/.test(integerPart) || decimalPart.length > 2 || !/^\d{0,2}$/.test(decimalPart)) return null;
    normalized = integerPart + (decimalPart !== "" ? `.${decimalPart}` : "");
  } else if (dotCount > 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      normalized = s.replace(/\./g, "");
    } else {
      if (dotCount !== 1) return null;
      const [integerPart, decimalPart = ""] = s.split(".");
      if (!/^\d+$/.test(integerPart) || decimalPart.length > 2 || !/^\d{0,2}$/.test(decimalPart)) return null;
      normalized = integerPart + (decimalPart !== "" ? `.${decimalPart}` : "");
    }
  } else if (!/^\d+$/.test(s)) {
    return null;
  }

  const n = Number(normalized) * sign;
  return Number.isFinite(n) ? n : null;
}

function moneyARS(value) {
  const n = Number(value || 0);
  try {
    return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function moneyDraft(value) {
  const n = Number(value || 0);
  return n === 0 ? "" : String(n).replace(".", ",");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isAllowedChequeFile(file) {
  if (!(file instanceof File)) return false;
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const validType = mime === "application/pdf" || mime.startsWith("image/") || /\.(pdf|jpg|jpeg|png|webp|gif|heic|heif)$/i.test(name);
  return validType && Number(file.size || 0) > 0 && Number(file.size || 0) <= 15 * 1024 * 1024;
}

function fmtDate(value) {
  const [y, m, d] = String(value || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

function openNativeDatePicker(event) {
  const input = event?.currentTarget;
  if (!input || input.disabled || input.readOnly) return;

  input.focus();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch {
      // El focus mantiene el fallback nativo en navegadores sin showPicker habilitado.
    }
  }
}

function FloatingField({ label, value, className = "", children }) {
  const hasValue = value !== undefined && value !== null && String(value) !== "";
  return (
    <label className={`cfg-si-field ${hasValue ? "is-filled" : ""} ${className}`.trim()}>
      {children}
      <span className="cfg-si-floatLabel">{label}</span>
    </label>
  );
}

export default function ConfiguracionSaldosIniciales() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("tesoreria");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [data, setData] = useState({ medios_pago: [], tesoreria: [], clientes: [], proveedores: [], cheques: [] });
  const [tesoreriaRows, setTesoreriaRows] = useState([]);
  const [ccTipo, setCcTipo] = useState("CLIENTE");
  const [ccSearch, setCcSearch] = useState("");
  const [ccEditor, setCcEditor] = useState(null);
  const [ccAEliminar, setCcAEliminar] = useState(null);
  const [chequeAEliminar, setChequeAEliminar] = useState(null);
  const [nuevoChequeOpen, setNuevoChequeOpen] = useState(false);
  const [chequePreview, setChequePreview] = useState({
    open: false,
    url: "",
    mime: "",
    fileName: "",
    loading: false,
    error: "",
  });
  // Los adjuntos de cheques se precargan al entrar a Saldos iniciales.
  // Así el botón del ojo sólo abre un recurso que ya está resuelto/cargado.
  const chequeAttachmentCacheRef = useRef(new Map());
  const chequeAttachmentLoadsRef = useRef(new Map());

  const notify = useCallback((tipo, mensaje, duracion = 3300) => {
    setToast({ tipo, mensaje, duracion, key: Date.now() });
  }, []);

  const hydrate = useCallback((payload) => {
    const next = {
      medios_pago: Array.isArray(payload?.medios_pago) ? payload.medios_pago : [],
      tesoreria: Array.isArray(payload?.tesoreria) ? payload.tesoreria : [],
      clientes: Array.isArray(payload?.clientes) ? payload.clientes : [],
      proveedores: Array.isArray(payload?.proveedores) ? payload.proveedores : [],
      cheques: Array.isArray(payload?.cheques) ? payload.cheques : [],
    };
    setData(next);
    const byId = new Map(next.tesoreria.map((r) => [Number(r.id_medio_pago), r]));
    setTesoreriaRows(next.medios_pago.map((medio) => {
      const current = byId.get(Number(medio.id_medio_pago));
      return {
        id_medio_pago: Number(medio.id_medio_pago),
        nombre: String(medio.nombre || "MEDIO DE PAGO"),
        fecha_saldo: current?.fecha_saldo || todayISO(),
        saldo: current ? moneyDraft(current.saldo) : "",
        observaciones: current?.observaciones || "",
        configured: Boolean(current),
      };
    }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiFetch("config_saldos_iniciales_get");
      hydrate(payload);
    } catch (e) {
      notify("error", e?.message || "No se pudieron cargar los saldos iniciales.", 4500);
    } finally {
      setLoading(false);
    }
  }, [hydrate, notify]);

  useEffect(() => { load(); }, [load]);

  const preloadChequeAttachment = useCallback((row) => {
    const idArchivo = Number(row?.id_archivo || 0);
    if (!(idArchivo > 0)) return Promise.resolve(null);

    const cached = chequeAttachmentCacheRef.current.get(idArchivo);
    if (cached) return Promise.resolve(cached);

    const inFlight = chequeAttachmentLoadsRef.current.get(idArchivo);
    if (inFlight) return inFlight;

    const fallbackName = normalizeText(row?.numero_cheque)
      ? `Cheque ${normalizeText(row.numero_cheque)}`
      : "Cheque / eCheq";

    const request = (async () => {
      const info = await obtenerArchivoConfiguracion(idArchivo);
      const sourceUrl = String(info?.url || info?.download_url || info?.archivo_url || "").trim();
      if (!sourceUrl) throw new Error("No se recibió la URL del archivo.");

      let mime = String(info?.mime || info?.mime_type || info?.tipo_mime || info?.content_type || "").trim();
      const fileName = String(
        info?.nombre_archivo ||
        info?.nombre_original ||
        info?.file_name ||
        info?.filename ||
        fallbackName
      ).trim();

      let previewUrl = sourceUrl;
      let objectUrl = false;

      // Además de resolver la URL antes del clic, intentamos descargar el archivo
      // ahora para dejarlo en memoria como blob:. Si el origen externo no permite
      // fetch por CORS, las imágenes se precargan igualmente con Image().
      try {
        const absoluteUrl = new URL(sourceUrl, window.location.href);
        const backendOrigin = new URL(buildConfiguracionApiUrl()).origin;
        const pageOrigin = window.location.origin;
        const headers = new Headers();

        if (absoluteUrl.origin === backendOrigin || absoluteUrl.origin === pageOrigin) {
          const sessionKey = getConfiguracionSessionKey();
          if (sessionKey) headers.set("X-Session", sessionKey);
        }

        const response = await fetch(absoluteUrl.toString(), {
          method: "GET",
          headers,
        });

        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 0) {
            if (!mime) mime = String(blob.type || "").trim();
            previewUrl = URL.createObjectURL(blob);
            objectUrl = true;
          }
        }
      } catch {
        const isImage = String(mime || "").toLowerCase().startsWith("image/") ||
          /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif)(?:$|[?#])/i.test(sourceUrl);

        if (isImage) {
          await new Promise((resolve) => {
            const image = new Image();
            image.onload = resolve;
            image.onerror = resolve;
            image.src = sourceUrl;
          });
        }
      }

      const entry = {
        idArchivo,
        url: previewUrl,
        sourceUrl,
        mime,
        fileName,
        objectUrl,
      };

      chequeAttachmentCacheRef.current.set(idArchivo, entry);
      return entry;
    })().finally(() => {
      chequeAttachmentLoadsRef.current.delete(idArchivo);
    });

    chequeAttachmentLoadsRef.current.set(idArchivo, request);
    return request;
  }, []);

  useEffect(() => {
    const rows = (data.cheques || []).filter(
      (row) => Number(row?.tiene_archivo || 0) === 1 && Number(row?.id_archivo || 0) > 0
    );
    const validIds = new Set(rows.map((row) => Number(row.id_archivo)));

    // Liberar blobs de archivos que ya no forman parte de la lista.
    chequeAttachmentCacheRef.current.forEach((entry, idArchivo) => {
      if (validIds.has(Number(idArchivo))) return;
      if (entry?.objectUrl && String(entry?.url || "").startsWith("blob:")) {
        URL.revokeObjectURL(entry.url);
      }
      chequeAttachmentCacheRef.current.delete(idArchivo);
    });

    let cancelled = false;
    const queue = rows.filter((row) => !chequeAttachmentCacheRef.current.has(Number(row.id_archivo)));

    // Dos descargas en paralelo evitan saturar la carga inicial de la pantalla.
    const worker = async () => {
      while (!cancelled && queue.length) {
        const row = queue.shift();
        try {
          await preloadChequeAttachment(row);
        } catch {
          // La precarga es silenciosa: si falla, el clic del ojo volverá a intentarlo.
        }
      }
    };

    worker();
    worker();

    return () => {
      cancelled = true;
    };
  }, [data.cheques, preloadChequeAttachment]);

  useEffect(() => () => {
    chequeAttachmentCacheRef.current.forEach((entry) => {
      if (entry?.objectUrl && String(entry?.url || "").startsWith("blob:")) {
        URL.revokeObjectURL(entry.url);
      }
    });
    chequeAttachmentCacheRef.current.clear();
    chequeAttachmentLoadsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!ccEditor || ccAEliminar) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        setCcEditor(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ccEditor, ccAEliminar, saving]);

  const saveTreasury = useCallback(async () => {
    const rowsToSave = tesoreriaRows.filter(
      (r) => r.configured || normalizeText(r.saldo) !== "" || normalizeText(r.observaciones) !== ""
    );
    if (!rowsToSave.length) {
      notify("advertencia", "Ingresá al menos un saldo inicial para guardar.");
      return;
    }
    const invalidRow = rowsToSave.find((r) => parseMoney(r.saldo) === null);
    if (invalidRow) {
      notify("advertencia", `Revisá el saldo inicial de ${invalidRow.nombre}: el importe no es válido.`);
      return;
    }
    setSaving(true);
    try {
      const payload = await apiFetch("config_saldos_iniciales_tesoreria_guardar", {
        method: "POST",
        body: JSON.stringify({
          saldos: rowsToSave.map((r) => ({
            id_medio_pago: r.id_medio_pago,
            fecha_saldo: r.fecha_saldo,
            saldo: parseMoney(r.saldo),
            observaciones: normalizeText(r.observaciones),
          })),
        }),
      });
      hydrate(payload);
      notify("exito", payload.mensaje || "Saldos iniciales guardados correctamente.");
    } catch (e) {
      notify("error", e?.message || "No se pudieron guardar los saldos.", 4500);
    } finally {
      setSaving(false);
    }
  }, [tesoreriaRows, hydrate, notify]);

  const ccRows = ccTipo === "CLIENTE" ? data.clientes : data.proveedores;
  const filteredCcRows = useMemo(() => {
    const q = normalizeText(ccSearch).toLocaleUpperCase("es-AR");
    if (!q) return ccRows;
    return ccRows.filter((r) => String(r.nombre || "").toLocaleUpperCase("es-AR").includes(q));
  }, [ccRows, ccSearch]);

  const openCcEditor = useCallback((row) => {
    const stored = row?.saldo;
    const hasStored = row?.id_saldo_inicial != null;
    setCcEditor({
      tipo_entidad: ccTipo,
      id_entidad: Number(ccTipo === "CLIENTE" ? row.id_cliente : row.id_proveedor),
      nombre: String(row.nombre || ""),
      fecha_saldo: row.fecha_saldo || todayISO(),
      sentido: hasStored && Number(stored) < 0 ? "FAVOR" : "DEUDA",
      importe: hasStored ? moneyDraft(Math.abs(Number(stored || 0))) : "",
      observaciones: row.observaciones || "",
      exists: hasStored,
    });
  }, [ccTipo]);

  const saveCc = useCallback(async () => {
    if (!ccEditor) return;
    const parsedImporte = parseMoney(ccEditor.importe);
    if (parsedImporte === null) {
      notify("advertencia", "Ingresá un importe válido para el saldo inicial.");
      return;
    }
    if (!(Math.abs(parsedImporte) > 0)) {
      notify("advertencia", "Ingresá un importe mayor a cero. Si querés dejar la cuenta sin saldo inicial, eliminá el saldo existente.");
      return;
    }
    setSaving(true);
    try {
      const payload = await apiFetch("config_saldos_iniciales_cc_guardar", {
        method: "POST",
        body: JSON.stringify({
          tipo_entidad: ccEditor.tipo_entidad,
          id_entidad: ccEditor.id_entidad,
          fecha_saldo: ccEditor.fecha_saldo,
          sentido: ccEditor.sentido,
          importe: Math.abs(parsedImporte),
          observaciones: normalizeText(ccEditor.observaciones),
        }),
      });
      hydrate(payload);
      setCcEditor(null);
      notify("exito", payload.mensaje || "Saldo inicial guardado correctamente.");
    } catch (e) {
      notify("error", e?.message || "No se pudo guardar el saldo inicial.", 4500);
    } finally {
      setSaving(false);
    }
  }, [ccEditor, hydrate, notify]);

  const deleteCc = useCallback(async () => {
    if (!ccAEliminar?.exists) return;
    setSaving(true);
    try {
      const payload = await apiFetch("config_saldos_iniciales_cc_eliminar", {
        method: "POST",
        body: JSON.stringify({ tipo_entidad: ccAEliminar.tipo_entidad, id_entidad: ccAEliminar.id_entidad }),
      });
      hydrate(payload);
      setCcAEliminar(null);
      setCcEditor(null);
    } catch (e) {
      throw e;
    } finally {
      setSaving(false);
    }
  }, [ccAEliminar, hydrate]);

  const openChequeAttachment = useCallback(async (row) => {
    const idArchivo = Number(row?.id_archivo || 0);
    if (!(idArchivo > 0)) return;

    const fallbackName = normalizeText(row?.numero_cheque)
      ? `Cheque ${normalizeText(row.numero_cheque)}`
      : "Cheque / eCheq";

    const cached = chequeAttachmentCacheRef.current.get(idArchivo);
    if (cached) {
      setChequePreview({
        open: true,
        url: cached.url,
        mime: cached.mime,
        fileName: cached.fileName || fallbackName,
        loading: false,
        error: "",
      });
      return;
    }

    // Si la precarga todavía está terminando, reutilizamos la misma promesa
    // en lugar de iniciar una segunda descarga.
    setChequePreview({
      open: true,
      url: "",
      mime: "",
      fileName: fallbackName,
      loading: true,
      error: "",
    });

    try {
      const attachment = await preloadChequeAttachment(row);
      if (!attachment) throw new Error("No se pudo preparar el archivo del cheque.");

      setChequePreview({
        open: true,
        url: attachment.url,
        mime: attachment.mime,
        fileName: attachment.fileName || fallbackName,
        loading: false,
        error: "",
      });
    } catch (error) {
      setChequePreview((prev) => ({
        ...prev,
        loading: false,
        error: error?.message || "No se pudo cargar el archivo del cheque.",
      }));
    }
  }, [preloadChequeAttachment]);

  const saveCheque = useCallback(async (form) => {
    if (saving) return;
    const chequeForm = { ...form, tipo: String(form.tipo).toUpperCase() };
    if (form.archivo && !isAllowedChequeFile(form.archivo)) return notify("advertencia", "Subí una imagen o PDF válido de hasta 15 MB.", 4200);
    if (!normalizeText(chequeForm.emisor)) return notify("advertencia", "Ingresá el emisor del cheque/eCheq.");
    if (!normalizeText(chequeForm.numero_cheque)) return notify("advertencia", "Ingresá el número del cheque/eCheq.");
    const parsedImporte = Number(chequeForm.importe);
    if (!Number.isFinite(parsedImporte)) return notify("advertencia", "Ingresá un importe válido.");
    if (!(Math.abs(parsedImporte) > 0)) return notify("advertencia", "Ingresá un importe mayor a cero.");
    if (chequeForm.fecha_emision && chequeForm.fecha_saldo && chequeForm.fecha_emision > chequeForm.fecha_saldo) {
      return notify("advertencia", "La fecha de emisión no puede ser posterior a la fecha de apertura.");
    }
    if (chequeForm.fecha_emision && chequeForm.fecha_pago && chequeForm.fecha_pago < chequeForm.fecha_emision) {
      return notify("advertencia", "La fecha de pago/vencimiento no puede ser anterior a la fecha de emisión.");
    }
    setSaving(true);
    try {
      const { archivo } = chequeForm;
      const payload = await apiFetch("config_saldos_iniciales_cheque_crear", {
        method: "POST",
        body: JSON.stringify({
          tipo: chequeForm.tipo,
          fecha_saldo: chequeForm.fecha_saldo,
          fecha_emision: chequeForm.fecha_emision,
          fecha_pago: chequeForm.fecha_pago,
          importe: Math.abs(parsedImporte),
          emisor: normalizeText(chequeForm.emisor),
          numero_cheque: normalizeText(chequeForm.numero_cheque),
          observaciones: normalizeText(chequeForm.observaciones),
        }),
      });

      let archivoWarning = "";
      if (archivo instanceof File) {
        const idChequeCreado = Number(payload?.id_cheque_creado || (payload?.cheques || []).find((row) => String(row?.numero_cheque || "") === normalizeText(chequeForm.numero_cheque))?.id_cheque || 0);
        if (idChequeCreado > 0) {
          try {
            await subirArchivoChequeConfiguracion(idChequeCreado, chequeForm.tipo, archivo);
          } catch (error) {
            archivoWarning = error?.message || "No se pudo adjuntar la imagen/PDF del cheque.";
          }
        } else {
          archivoWarning = "El cheque se cargó, pero no se pudo identificar para vincular el archivo.";
        }
      }

      hydrate(payload);
      setNuevoChequeOpen(false);
      try {
        hydrate(await apiFetch("config_saldos_iniciales_get"));
      } catch {
        notify("advertencia", "El cheque se guardó. No se pudo actualizar la lista; volvé a ingresar a la sección.", 6000);
        return;
      }
      if (archivoWarning) {
        notify("advertencia", `Cheque/eCheq cargado, pero el archivo no quedó vinculado: ${archivoWarning}`, 6000);
      } else {
        notify("exito", payload.mensaje || "Cheque/eCheq inicial cargado.");
      }
    } catch (e) {
      notify("error", e?.message || "No se pudo cargar el cheque/eCheq.", 4500);
    } finally {
      setSaving(false);
    }
  }, [saving, hydrate, notify]);

  const deleteCheque = useCallback(async () => {
    if (!chequeAEliminar?.id_cheque) return;
    setSaving(true);
    try {
      const payload = await apiFetch("config_saldos_iniciales_cheque_eliminar", {
        method: "POST",
        body: JSON.stringify({ id_cheque: chequeAEliminar.id_cheque }),
      });
      hydrate(payload);
      setChequeAEliminar(null);
    } catch (e) {
      throw e;
    } finally {
      setSaving(false);
    }
  }, [chequeAEliminar, hydrate]);

  const configuredCount = useMemo(() => ({
    tesoreria: data.tesoreria.length,
    cc: [...data.clientes, ...data.proveedores].filter((r) => r.id_saldo_inicial != null).length,
    cheques: data.cheques.length,
  }), [data]);

  return (
    <>
      {toast && <Toast key={toast.key} tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={() => setToast(null)} />}
      <section className="cfg-si-page">
        <header className="cfg-si-hero">
          <div className="cfg-si-heroText">
            <span className="cfg-si-eyebrow">Puesta en marcha</span>
            <h1>Saldos iniciales</h1>
            <p>Registrá la situación existente antes de comenzar a operar en Balto. Estos valores no generan ventas, compras, ingresos ni egresos ficticios.</p>
          </div>
          <button className="mov-btn mov-btn--primary" type="button" onClick={() => navigate("/panel/configuracion")}>
            <FontAwesomeIcon icon={faArrowLeft} />
            Volver
          </button>
        </header>

        <div className="cfg-si-tabs" role="tablist">
            <button className={tab === "tesoreria" ? "is-active" : ""} onClick={() => setTab("tesoreria")} type="button">
              <FontAwesomeIcon icon={faWallet} /> Caja y cuentas <span>{configuredCount.tesoreria}</span>
            </button>
            <button className={tab === "cheques" ? "is-active" : ""} onClick={() => setTab("cheques")} type="button">
              <FontAwesomeIcon icon={faMoneyCheckDollar} /> Cheques <span>{configuredCount.cheques}</span>
            </button>
            <button className={tab === "cc" ? "is-active" : ""} onClick={() => setTab("cc")} type="button">
              <FontAwesomeIcon icon={faUsers} /> Cuentas corrientes <span>{configuredCount.cc}</span>
            </button>
          </div>

        <div className="cfg-si-scroll">
          {loading ? (
            <div className="cfg-si-empty">Cargando configuración de saldos iniciales…</div>
          ) : tab === "tesoreria" ? (
            <div className="cfg-si-panel">
              <div className="cfg-si-panelHead">
                <div><h2>Caja, banco y billeteras</h2><p>El importe representa el saldo disponible al inicio de la fecha indicada.</p></div>
                <button type="button" className="cfg-si-primaryBtn" onClick={saveTreasury} disabled={saving || !tesoreriaRows.length}>
                  <FontAwesomeIcon icon={faFloppyDisk} /> Guardar saldos
                </button>
              </div>
              <div className="cfg-si-warning">No incluyas cheques dentro de Banco o Efectivo. Los cheques se cargan individualmente en su pestaña. Si modificás un saldo ya configurado, Balto recalculará todos los saldos posteriores.</div>
              <div className="cfg-si-accountGrid">
                {tesoreriaRows.map((row, index) => (
                  <article className="cfg-si-accountCard" key={row.id_medio_pago}>
                    <div className="cfg-si-accountTop">
                      <span className="cfg-si-accountIcon"><FontAwesomeIcon icon={row.nombre.toUpperCase().includes("BANCO") ? faBuildingColumns : faWallet} /></span>
                      <div><strong>{row.nombre}</strong><small>{row.configured ? "Saldo configurado" : "Sin saldo inicial"}</small></div>
                    </div>
                    <FloatingField label="Fecha de apertura" value={row.fecha_saldo}>
                      <input className="cfg-si-control cfg-si-dateControl" type="date" max={todayISO()} value={row.fecha_saldo} onClick={openNativeDatePicker} onChange={(e) => setTesoreriaRows((prev) => prev.map((x, i) => i === index ? { ...x, fecha_saldo: e.target.value } : x))} />
                    </FloatingField>
                    <FloatingField label="Saldo inicial" value={row.saldo} className="cfg-si-field--money">
                      <div className="cfg-si-moneyInput"><span>$</span><input className="cfg-si-control" inputMode="decimal" placeholder=" " value={row.saldo} onChange={(e) => setTesoreriaRows((prev) => prev.map((x, i) => i === index ? { ...x, saldo: e.target.value } : x))} /></div>
                    </FloatingField>
                    <FloatingField label="Observación" value={row.observaciones}>
                      <input className="cfg-si-control" type="text" maxLength={500} placeholder=" " value={row.observaciones} onChange={(e) => setTesoreriaRows((prev) => prev.map((x, i) => i === index ? { ...x, observaciones: e.target.value } : x))} />
                    </FloatingField>
                  </article>
                ))}
              </div>
            </div>
          ) : tab === "cheques" ? (
            <div className="cfg-si-panel">
              <div className="cfg-si-panelHead">
                <div><h2>Cheques y eCheq en cartera</h2><p>Documentos que el negocio ya poseía al comenzar a usar Balto.</p></div>
                <button type="button" className="cfg-si-primaryBtn" onClick={() => setNuevoChequeOpen(true)} disabled={saving}>
                  <FontAwesomeIcon icon={faPlus} /> Cargar nuevo cheque
                </button>
              </div>
              <div className="cfg-si-tableWrap">
                <table className="cfg-si-table"><thead><tr><th className="is-center">Tipo</th><th className="is-center">Número</th><th>Emisor</th><th>Apertura</th><th className="is-center">Vencimiento</th><th className="is-right">Importe</th><th className="is-center">Estado</th><th className="is-center">Acciones</th></tr></thead>
                  <tbody>{data.cheques.length ? data.cheques.map((r) => (
                    <tr key={r.id_cheque}>
                      <td className="is-center" data-label="Tipo">{r.tipo}</td>
                      <td className="is-center" data-label="Número">{r.numero_cheque}</td>
                      <td data-label="Emisor">{r.emisor}</td>
                      <td data-label="Apertura">{fmtDate(r.fecha_saldo)}</td>
                      <td className="is-center" data-label="Vencimiento">{fmtDate(r.fecha_pago)}</td>
                      <td className="is-right is-strong" data-label="Importe">{moneyARS(r.importe)}</td>
                      <td className="is-center" data-label="Estado"><span className={`cfg-si-state ${r.estado === "EN_CARTERA" ? "is-ok" : ""}`}>{String(r.estado || "").replaceAll("_", " ")}</span></td>
                      <td className="is-center cfg-si-tableActionsCell" data-label="Acciones"><div className="cfg-si-chequeActions"><button type="button" className="cfg-si-fileView" title={Number(r.tiene_archivo || 0) === 1 && Number(r.id_archivo) > 0 ? "Ver archivo del cheque" : "Sin archivo adjunto"} aria-label="Ver archivo del cheque" disabled={Number(r.tiene_archivo || 0) !== 1 || !(Number(r.id_archivo) > 0)} onClick={() => openChequeAttachment(r)}><FontAwesomeIcon icon={faEye} /></button><button type="button" className="cfg-si-dangerIcon" title="Eliminar carga inicial" onClick={() => setChequeAEliminar(r)} disabled={saving}><FontAwesomeIcon icon={faTrash} /></button></div></td>
                    </tr>
                  )) : <tr><td colSpan="8" className="cfg-si-tableEmpty">No hay cheques iniciales cargados.</td></tr>}</tbody></table>
              </div>
            </div>
          ) : (
            <div className="cfg-si-panel">
              <div className="cfg-si-panelHead"><div><h2>Cuentas corrientes</h2><p>Definí cuánto debía cada cliente o cuánto se debía a cada proveedor antes de Balto.</p></div></div>
              <div className="cfg-si-ccToolbar">
                <div className="cfg-si-segmented"><button type="button" className={ccTipo === "CLIENTE" ? "is-active" : ""} onClick={() => { setCcTipo("CLIENTE"); setCcEditor(null); }}>Clientes</button><button type="button" className={ccTipo === "PROVEEDOR" ? "is-active" : ""} onClick={() => { setCcTipo("PROVEEDOR"); setCcEditor(null); }}>Proveedores</button></div>
                <FloatingField label={`Buscar ${ccTipo === "CLIENTE" ? "cliente" : "proveedor"}`} value={ccSearch} className="cfg-si-searchField">
                  <input className="cfg-si-control cfg-si-search" type="search" placeholder=" " value={ccSearch} onChange={(e) => setCcSearch(e.target.value)} />
                </FloatingField>
              </div>
              <div className="cfg-si-ccList">
                {filteredCcRows.map((r) => {
                  const exists = r.id_saldo_inicial != null;
                  const saldo = Number(r.saldo || 0);
                  return <button type="button" className="cfg-si-ccRow" key={ccTipo === "CLIENTE" ? r.id_cliente : r.id_proveedor} onClick={() => openCcEditor(r)}>
                    <div><strong>{r.nombre}</strong><small>{exists ? `Desde ${fmtDate(r.fecha_saldo)}` : "Sin saldo inicial"}</small></div>
                    <div className={exists ? (saldo < 0 ? "cfg-si-saldo is-favor" : "cfg-si-saldo") : "cfg-si-saldo is-empty"}>{exists ? moneyARS(saldo) : "Cargar"}</div>
                  </button>;
                })}
                {!filteredCcRows.length && <div className="cfg-si-empty">No se encontraron resultados.</div>}
              </div>
            </div>
          )}
        </div>

        <ModalNuevoCheque
          open={nuevoChequeOpen}
          onClose={() => { if (!saving) setNuevoChequeOpen(false); }}
          onSave={saveCheque}
          saldoInicial
          saving={saving}
          onToast={notify}
          dark={document.body.classList.contains("dark") || ["dark", "oscuro"].includes(document.documentElement.getAttribute("data-theme"))}
        />

        <ModalVerComprobante
          open={chequePreview.open}
          url={chequePreview.url}
          mime={chequePreview.mime}
          fileName={chequePreview.fileName}
          title="Archivo de cheque / eCheq"
          loading={chequePreview.loading}
          error={chequePreview.error}
          onClose={() => setChequePreview((prev) => ({ ...prev, open: false }))}
        />

        {ccEditor && createPortal(
          <div className="gm-modal-overlay" role="presentation" onMouseDown={(e) => e.stopPropagation()}>
            <div className="gm-modal-container gm-modal-v2 cfg-si-serviceModal cfg-si-ccModal" role="dialog" aria-modal="true" aria-labelledby="cfg-si-cc-modal-title">
              <header className="gm-modal-header">
                <div className="gm-modal-head-icon" aria-hidden="true"><FontAwesomeIcon icon={faUsers} /></div>
                <div className="gm-modal-head-left">
                  <h2 className="gm-modal-title" id="cfg-si-cc-modal-title">{ccEditor.nombre}</h2>
                  <p className="gm-modal-subtitle">{ccEditor.tipo_entidad === "CLIENTE" ? "Saldo inicial de cliente" : "Saldo inicial de proveedor"}</p>
                </div>
                <button type="button" className="gm-modal-close" onClick={() => setCcEditor(null)} disabled={saving} aria-label="Cerrar">✕</button>
              </header>

              <div className="gm-modal-content cfg-si-serviceModal__content">
                {ccEditor.exists && (
                  <div className="gm-info-box cfg-si-serviceModal__notice">
                    <FontAwesomeIcon icon={faCircleInfo} />
                    <span>Al modificar este saldo inicial también cambiarán los saldos posteriores de esta cuenta corriente.</span>
                  </div>
                )}

                <section className="gm-section cfg-si-serviceModal__panel">
                  <div className="gm-section-head cfg-si-serviceModal__sectionHead">
                    <span className="cfg-si-serviceModal__sectionIcon"><FontAwesomeIcon icon={faWallet} /></span>
                    <span className="cfg-si-serviceModal__sectionCopy">
                      <strong>Datos del saldo inicial</strong>
                      <small>Definí la fecha, situación e importe con el que comienza la cuenta.</small>
                    </span>
                  </div>
                  <div className="gm-section-body cfg-si-serviceModal__sectionBody">
                    <div className="cfg-si-ccModalGrid">
                      <label className="gm-field">
                        <input className="gm-input" type="date" max={todayISO()} value={ccEditor.fecha_saldo} placeholder=" " onClick={openNativeDatePicker} onChange={(e) => setCcEditor((p) => ({ ...p, fecha_saldo: e.target.value }))} />
                        <span className="gm-label gm-label--up">Fecha de apertura</span>
                      </label>

                      <label className="gm-field">
                        <select className="gm-input gm-select" value={ccEditor.sentido} onChange={(e) => setCcEditor((p) => ({ ...p, sentido: e.target.value }))}>
                          {ccEditor.tipo_entidad === "CLIENTE" ? <><option value="DEUDA">El cliente nos debe</option><option value="FAVOR">El cliente tiene saldo a favor</option></> : <><option value="DEUDA">Le debemos al proveedor</option><option value="FAVOR">Tenemos saldo a favor</option></>}
                        </select>
                        <span className="gm-label gm-label--up">Situación</span>
                      </label>

                      <label className="gm-field cfg-si-ccModalMoneyField cfg-si-ccModalWide">
                        <input className="gm-input cfg-si-ccModalMoneyInput" autoFocus inputMode="decimal" placeholder=" " value={ccEditor.importe} onChange={(e) => setCcEditor((p) => ({ ...p, importe: e.target.value }))} />
                        <span className="gm-label">Importe</span>
                      </label>
                    </div>
                  </div>
                </section>

                <section className="gm-section cfg-si-serviceModal__panel cfg-si-serviceModal__panel--notes">
                  <div className="gm-section-head cfg-si-serviceModal__sectionHead">
                    <span className="cfg-si-serviceModal__sectionIcon"><FontAwesomeIcon icon={faCircleInfo} /></span>
                    <span className="cfg-si-serviceModal__sectionCopy">
                      <strong>Observación</strong>
                      <small>Agregá una referencia opcional para identificar el origen del saldo.</small>
                    </span>
                  </div>
                  <div className="gm-section-body cfg-si-serviceModal__sectionBody">
                    <label className="gm-field cfg-si-ccModalObservation">
                      <textarea className="gm-input cfg-si-ccModalTextarea" rows="3" maxLength={500} placeholder=" " value={ccEditor.observaciones} onChange={(e) => setCcEditor((p) => ({ ...p, observaciones: e.target.value }))} />
                      <span className={`gm-label ${ccEditor.observaciones !== "" ? "gm-label--up" : ""}`.trim()}>Observación</span>
                    </label>
                  </div>
                </section>
              </div>

              <footer className="gm-modal-footer gm-view-footer-actions cfg-si-ccModalFooter">
                {ccEditor.exists && <button className="gm-action-btn gm-action-btn--danger cfg-si-ccModalDelete" type="button" onClick={() => setCcAEliminar({ ...ccEditor })} disabled={saving}><span className="gm-action-btn__icon"><FontAwesomeIcon icon={faTrash} /></span>Eliminar saldo</button>}
                <div className="cfg-si-ccModalFooterRight">
                  <button className="gm-action-btn gm-action-btn--cancel" type="button" onClick={() => setCcEditor(null)} disabled={saving}>Cancelar</button>
                  <button className="gm-action-btn gm-action-btn--save" type="button" onClick={saveCc} disabled={saving}><span className="gm-action-btn__icon"><FontAwesomeIcon icon={faFloppyDisk} /></span>{saving ? "Guardando..." : "Guardar"}</button>
                </div>
              </footer>
            </div>
          </div>,
          document.body
        )}

        <ModalEliminar
          open={Boolean(ccAEliminar)}
          row={ccAEliminar}
          loading={saving}
          onClose={() => setCcAEliminar(null)}
          onConfirm={deleteCc}
          onToast={notify}
          title="Eliminar saldo inicial"
          message="¿Seguro que querés eliminar este saldo inicial?"
          warning="Esta acción no se puede deshacer."
          loadingMessage="Eliminando saldo inicial…"
          successMessage="Saldo inicial eliminado correctamente."
          errorMessage="No se pudo eliminar el saldo inicial."
          details={ccAEliminar ? [
            { label: ccAEliminar.tipo_entidad === "CLIENTE" ? "Cliente" : "Proveedor", value: ccAEliminar.nombre || "—" },
            { label: "Fecha de apertura", value: fmtDate(ccAEliminar.fecha_saldo) },
            { label: "Situación", value: ccAEliminar.sentido === "FAVOR" ? "Saldo a favor" : "Deuda" },
            { label: "Importe", value: moneyARS(Math.abs(parseMoney(ccAEliminar.importe) || 0)) },
          ] : []}
        />

        <ModalEliminar
          open={Boolean(chequeAEliminar)}
          row={chequeAEliminar}
          loading={saving}
          onClose={() => setChequeAEliminar(null)}
          onConfirm={deleteCheque}
          onToast={notify}
          title="Eliminar cheque/eCheq"
          message="¿Seguro que querés eliminar este documento de los saldos iniciales?"
          warning="Esta acción no se puede deshacer."
          loadingMessage="Eliminando cheque/eCheq…"
          successMessage="Cheque/eCheq inicial eliminado correctamente."
          errorMessage="No se pudo eliminar el cheque/eCheq inicial."
          details={chequeAEliminar ? [
            { label: "Tipo", value: chequeAEliminar.tipo === "ECHEQ" ? "eCheq" : "Cheque" },
            { label: "Número", value: chequeAEliminar.numero_cheque || "—" },
            { label: "Emisor", value: chequeAEliminar.emisor || "—" },
            { label: "Vencimiento", value: fmtDate(chequeAEliminar.fecha_pago) },
            { label: "Importe", value: moneyARS(chequeAEliminar.importe) },
          ] : []}
        />
      </section>
    </>
  );
}
