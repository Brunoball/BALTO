import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { facturacionFetch } from "./api/facturacionApi.js";
import { FaCheck } from "react-icons/fa";
import "./ModalFacturaBaltoResumen.css";
import "../../Global/Global_css/Global_oscuro.css";
import { DEMO_BLOCK_MESSAGE, isBaltoDemoMode } from "../../../utils/demoMode";

import { buildBaltoInvoicePdf, saveBaltoInvoicePdf } from "../../../utils/FacturaPdfBuilder";
import { buildNotaCreditoPdf, saveNotaCreditoPdf } from "../../../utils/NotaCreditoPdfBuilder";

const DOC_TIPOS = [ 
  { id: 80, label: "CUIT (80)" },
  { id: 96, label: "DNI (96)" },
];

// IMPORTANTE:
// No usar [] directamente como valor default en props.
// En React, ese array se recrea en cada render y rompe los useEffect que
// dependen de configsFacturacionInicial, generando un bucle de setState.
const EMPTY_CONFIGS_FACTURACION = Object.freeze([]);

function isoToYmd8(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  if (/^\d{8}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replaceAll("-", "");
  return "";
}


function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ymdToHuman(ymd) {
  if (!ymd) return "";
  const s = String(ymd);
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  if (s.length >= 10 && s.includes("-")) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }
  return s;
}

function moneyARS(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "$0,00";
  try {
    return n.toLocaleString("es-AR", {
      style: "currency",
      currency: "ARS",
    });
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeText(v) {
  return String(v ?? "").trim();
}

function pickText(...values) {
  for (const value of values) {
    const txt = safeText(value);
    if (txt) return txt;
  }
  return "";
}

function normalizeEmisorPdfInfo(data = {}, fact = {}) {
  const cfg = data?.config_facturacion || fact?.config_facturacion || data?.emisor || fact?.emisor || data?.facturacion || {};
  const nombre = pickText(data?.emisor_nombre, fact?.emisor_nombre, cfg?.razon_social, cfg?.nombre_fantasia, cfg?.nombre, "BALTO");
  const domicilio = pickText(data?.emisor_domicilio, fact?.emisor_domicilio, cfg?.domicilio_comercial, cfg?.domicilio, cfg?.domicilio_fiscal);
  const cuit = pickText(data?.cuit_emisor, fact?.cuit_emisor, cfg?.cuit);
  const iva = pickText(data?.cond_iva_emisor, fact?.cond_iva_emisor, cfg?.condicion_iva, cfg?.cond_iva);
  const iibb = pickText(data?.ingresos_brutos_emisor, fact?.ingresos_brutos_emisor, cfg?.ingresos_brutos);
  const inicio = pickText(data?.fecha_inicio_actividades_emisor, fact?.fecha_inicio_actividades_emisor, cfg?.fecha_inicio_actividades, cfg?.inicio_actividades);

  return {
    emisor_nombre: nombre,
    emisor_domicilio: domicilio,
    cuit_emisor: cuit,
    cond_iva_emisor: iva,
    ingresos_brutos_emisor: iibb,
    fecha_inicio_actividades_emisor: inicio,
    emisor: {
      razon_social: nombre,
      nombre_fantasia: pickText(cfg?.nombre_fantasia),
      domicilio_comercial: domicilio,
      domicilio,
      cuit,
      condicion_iva: iva,
      cond_iva: iva,
      ingresos_brutos: iibb,
      fecha_inicio_actividades: inicio,
      inicio_actividades: inicio,
      punto_venta: pickText(cfg?.punto_venta, data?.pto_vta, fact?.pto_vta),
      tipo_comprobante_default: pickText(cfg?.tipo_comprobante_default),
      codigo_comprobante: pickText(cfg?.codigo_comprobante),
    },
  };
}

function normalizeClienteFacturacionPdfInfo(data = {}, fallback = {}) {
  const cf = data?.cliente_facturacion || data?.cliente || {};
  const docNro = pickText(cf?.doc_nro, cf?.cuit, cf?.dni, fallback?.doc_nro, data?.doc_nro).replace(/\D/g, "");
  const cuit = pickText(cf?.cuit, Number(cf?.doc_tipo || fallback?.doc_tipo) === 80 ? docNro : "", data?.cliente_cuit);
  const condicion = pickText(cf?.cond_iva, cf?.condicion_iva, data?.cond_iva_receptor, data?.cliente_condicion_iva);

  return {
    doc_tipo: Number(cf?.doc_tipo || fallback?.doc_tipo || (cuit ? 80 : 96)) || null,
    doc_nro: docNro,
    cuit,
    razon_social: pickText(cf?.razon_social, cf?.nombre, data?.receptor_nombre, data?.labelCliente, data?.cliente),
    cond_iva: condicion,
    condicion_iva: condicion,
    domicilio: pickText(cf?.domicilio, data?.receptor_domicilio, data?.cliente_domicilio),
    origen: pickText(cf?.origen),
  };
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getAuthHeaders(extra = {}) {
  const headers = new Headers({
    Accept: "application/json",
    ...extra,
  });
  const sessionKey = String(
    localStorage.getItem("session_key") ||
      localStorage.getItem("sessionKey") ||
      ""
  ).trim();
  if (sessionKey) headers.set("X-Session", sessionKey);

  const token = String(localStorage.getItem("token") || "").trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return headers;
}

function normalizeApiBase(apiBaseProp) {
  const raw = String(apiBaseProp || "").trim();
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

  const qs = usp.toString();
  return qs ? `${finalUrl}?${qs}` : finalUrl;
}

async function parseJsonSafe(res) {
  const raw = await res.text();
  const trimmed = String(raw || "").trim();

  if (trimmed.startsWith("<")) {
    const preview = trimmed.slice(0, 500);
    throw new Error(`Backend devolvió HTML en vez de JSON:\n${preview}`);
  }

  let data = null;

  try {
    data = trimmed ? JSON.parse(trimmed) : null;
  } catch {
    throw new Error(`Respuesta inválida (no es JSON): ${trimmed.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(data?.mensaje || data?.error || `HTTP ${res.status}`);
  }

  if (data && typeof data === "object" && data.exito === false) {
    throw new Error(data?.mensaje || "Error de API");
  }

  return data || {};
}

function normalizeFacturaEmitida(resp, fallback = {}) {
  const root = resp && typeof resp === "object" ? resp : {};
  const factura = root?.data?.factura || root?.factura || root?.data || root;
  const operacionArca =
    root?.operacion_arca ||
    root?.data?.operacion_arca ||
    factura?.operacion_arca ||
    fallback?.operacion_arca ||
    null;

  return {
    modo: safeText(factura?.modo || fallback?.modo || "prod"),
    cuit_emisor: safeText(factura?.cuit_emisor || fallback?.cuit_emisor),
    pto_vta: Number(factura?.pto_vta || fallback?.pto_vta || 0) || 0,
    cbte_tipo: Number(factura?.cbte_tipo || fallback?.cbte_tipo || 0) || 0,
    cbte_nro: Number(factura?.cbte_nro || fallback?.cbte_nro || 0) || 0,
    fecha_cbte: safeText(factura?.fecha_cbte || fallback?.fecha_cbte),
    resultado: safeText(factura?.resultado || fallback?.resultado),
    cae: safeText(factura?.cae || fallback?.cae),
    cae_vto: safeText(factura?.cae_vto || fallback?.cae_vto),
    imp_total: Number(factura?.imp_total || fallback?.imp_total || 0) || 0,
    imp_neto: Number(factura?.imp_neto || fallback?.imp_neto || 0) || 0,
    imp_iva: Number(factura?.imp_iva || fallback?.imp_iva || 0) || 0,
    doc_tipo: Number(factura?.doc_tipo || fallback?.doc_tipo || 0) || 0,
    doc_nro: safeText(factura?.doc_nro || fallback?.doc_nro),
    qr_url: factura?.qr_url || factura?.qr?.url || "",
    qr_base64: factura?.qr_base64 || factura?.qr?.base64 || "",
    qr_payload: factura?.qr_payload || factura?.qr?.payload || null,
    observaciones: Array.isArray(factura?.observaciones) ? factura.observaciones : [],
    eventos: Array.isArray(factura?.eventos) ? factura.eventos : [],
    errores: Array.isArray(factura?.errores) ? factura.errores : [],
    raw_min: factura?.raw_min || {},
    operacion_arca: operacionArca && typeof operacionArca === "object" ? operacionArca : null,
    operacion_key: safeText(operacionArca?.key || fallback?.operacion_key),
    operacion_contexto: safeText(operacionArca?.contexto || fallback?.operacion_contexto),
    id_comprobante:
      factura?.id_comprobante ??
      root?.id_comprobante ??
      root?.data?.id_comprobante ??
      null,
  };
}

function resolveMovimientoCreateAction(actionProp) {
  const a = String(actionProp || "").trim().toLowerCase();
  if (!a || a === "movimientos" || a === "ventas" || a === "venta") {
    return "ventas_crear";
  }
  return a;
}

function getCbteLabel(cbteTipo) {
  const n = Number(cbteTipo || 0);
  const cod = String(n || 0).padStart(3, "0");

  if (n === 3) return `Nota de Crédito A (${cod})`;
  if (n === 8) return `Nota de Crédito B (${cod})`;
  if (n === 13) return `Nota de Crédito C (${cod})`;

  if (n === 1) return `Factura A (${cod})`;
  if (n === 6) return `Factura B (${cod})`;
  if (n === 11) return `Factura C (${cod})`;

  return `Comprobante (${cod})`;
}


function onlyDigits(v) {
  return String(v ?? "").replace(/\D/g, "");
}


function normalizeCbtesAsocFrontend(items, facturaOriginal = null) {
  const source = Array.isArray(items) && items.length ? items : facturaOriginal ? [facturaOriginal] : [];
  const out = [];
  const seen = new Set();

  source.forEach((row) => {
    if (!row || typeof row !== "object") return;

    const tipo = Number(
      row.tipo ??
        row.Tipo ??
        row.cbte_tipo ??
        row.CbteTipo ??
        row.comprobante_tipo ??
        0
    );
    const ptoVta = Number(
      row.pto_vta ??
        row.PtoVta ??
        row.ptoVta ??
        row.punto_venta ??
        row.PuntoVenta ??
        0
    );
    const nro = Number(
      row.nro ??
        row.Nro ??
        row.cbte_nro ??
        row.CbteNro ??
        row.numero ??
        row.CbteDesde ??
        0
    );

    if (!tipo || !ptoVta || !nro) return;

    const item = { tipo, pto_vta: ptoVta, nro };
    const cuit = onlyDigits(row.cuit ?? row.Cuit ?? row.cuit_emisor ?? row.CuitEmisor ?? "");
    const fecha = isoToYmd8(row.fecha ?? row.cbte_fch ?? row.CbteFch ?? row.fecha_cbte ?? "");

    if (cuit) item.cuit = cuit;
    if (fecha) item.fecha = fecha;

    const key = `${item.tipo}-${item.pto_vta}-${item.nro}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });

  return out;
}

function configFacturacionId(cfg) {
  return Number(cfg?.id_config_facturacion || cfg?.idConfigFacturacion || 0) || 0;
}

function normalizeConfigFacturacionRow(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const id = configFacturacionId(c);
  const cuit = onlyDigits(c?.cuit || c?.cuit_emisor || "");
  const puntoVenta = onlyDigits(c?.punto_venta || c?.pto_vta || "") || "2";
  const codigoComprobante = onlyDigits(c?.codigo_comprobante || c?.cbte_tipo || "") || "11";
  const razon = pickText(c?.razon_social, c?.nombre_fantasia, c?.emisor_nombre, c?.nombre);
  const domicilio = pickText(c?.domicilio_comercial, c?.domicilio, c?.domicilio_fiscal, c?.emisor_domicilio);
  const condicionIva = pickText(c?.condicion_iva, c?.cond_iva, c?.cond_iva_emisor);
  const inicio = pickText(c?.fecha_inicio_actividades, c?.inicio_actividades, c?.fecha_inicio_actividades_emisor);

  return {
    ...c,
    idConfigFacturacion: id,
    id_config_facturacion: id,
    razon_social: razon,
    nombre_fantasia: pickText(c?.nombre_fantasia, razon),
    cuit,
    cuit_emisor: cuit,
    ingresos_brutos: pickText(c?.ingresos_brutos, c?.ingresos_brutos_emisor),
    condicion_iva: condicionIva,
    cond_iva: condicionIva,
    domicilio_comercial: domicilio,
    domicilio,
    domicilio_fiscal: domicilio,
    fecha_inicio_actividades: inicio,
    inicio_actividades: inicio,
    punto_venta: String(puntoVenta).padStart(5, "0"),
    pto_vta: Number(puntoVenta) || 2,
    codigo_comprobante: String(codigoComprobante).padStart(3, "0"),
    cbte_tipo: Number(codigoComprobante) || 11,
    activo: Number(c?.activo ?? 1) === 0 ? 0 : 1,
  };
}

function configFacturacionLabel(cfg) {
  const c = normalizeConfigFacturacionRow(cfg || {});
  const razon = pickText(c.razon_social, c.nombre_fantasia, "Cuenta fiscal");
  const cuit = c.cuit ? `CUIT ${c.cuit}` : "sin CUIT";
  const pv = onlyDigits(c.punto_venta || c.pto_vta || "") || "—";
  return `${razon} — ${cuit} — PV ${pv}`;
}

function extractConfigsFacturacionFromResponse(json) {
  const candidates = [
    json?.configs,
    json?.data?.configs,
    json?.cuentas_fiscales,
    json?.data?.cuentas_fiscales,
    json?.cuentas,
    json?.data?.cuentas,
    json?.configuraciones,
    json?.data?.configuraciones,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function mergeConfigsFacturacion(...lists) {
  const out = [];
  const seen = new Set();

  lists.flat().forEach((cfg) => {
    const normalized = normalizeConfigFacturacionRow(cfg || {});
    if (normalized.activo === 0) return;

    const id = configFacturacionId(normalized);
    const cuit = onlyDigits(normalized?.cuit || normalized?.cuit_emisor || "");
    const key = id > 0 ? `id:${id}` : (cuit ? `cuit:${cuit}` : JSON.stringify(normalized));

    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });

  return out;
}

export default function ModalFacturaBaltoResumen({
  open,
  onClose,
  onBack,
  onCloseAll,
  apiBase,
  action = "movimientos",
  data,
  docTipo,
  docNro,
  cbteTipo,
  ptoVta,
  onFacturada,
  onDone,
  forceTestAmount = false,
  testAmount = 1000,
  skipMovimientoAutocreacion = false,
  pdfMode = "factura",
  configsFacturacionInicial = EMPTY_CONFIGS_FACTURACION,
}) {
  const [loading, setLoading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [tabActiva, setTabActiva] = useState("resumen");
  const firstRef = useRef(null);

  const movimientoIdRef = useRef(0);
  const cbteNoEmitidoRef = useRef(null);

  const apiUrl = useCallback(
    (params = {}) => buildApiUrl(apiBase, params),
    [apiBase]
  );

  const esNotaCredito = pdfMode === "nota_credito";
  const esCbteNC = [3, 8, 13].includes(Number(cbteTipo || 0));
  const usarModoNC = esNotaCredito || esCbteNC;

  const [configsFacturacion, setConfigsFacturacion] = useState([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");

  const dataConfigInicial = useMemo(
    () => normalizeConfigFacturacionRow(data?.config_facturacion || data?.emisor || {}),
    [data]
  );

  useEffect(() => {
    if (!open) return;

    const idInicial = configFacturacionId(data?.config_facturacion || data?.emisor || {});
    if (idInicial > 0) setSelectedConfigId(String(idInicial));

    const iniciales = mergeConfigsFacturacion(configsFacturacionInicial, dataConfigInicial);

    if (usarModoNC) {
      const cuitInicial = onlyDigits(
        data?.cuit_emisor ||
        data?.config_facturacion?.cuit ||
        data?.emisor?.cuit ||
        data?.factura_original?.cuit_emisor ||
        data?.factura_original?.cuit ||
        ""
      );

      const matchLocal = iniciales.find((cfg) => {
        const cfgId = configFacturacionId(cfg);
        const cfgCuit = onlyDigits(cfg?.cuit || cfg?.cuit_emisor || "");
        return (idInicial > 0 && cfgId === idInicial) || (cuitInicial && cfgCuit === cuitInicial);
      });

      const listaLocal = mergeConfigsFacturacion(matchLocal || null, iniciales, dataConfigInicial);
      setConfigsFacturacion(listaLocal);

      const selectedLocal = configFacturacionId(matchLocal || dataConfigInicial || listaLocal[0]);
      if (selectedLocal > 0) setSelectedConfigId(String(selectedLocal));

      const nombreLocal = pickText(matchLocal?.razon_social, matchLocal?.nombre_fantasia, dataConfigInicial?.razon_social);
      const tieneNombreReal = nombreLocal && nombreLocal.toUpperCase() !== "BALTO";
      if (tieneNombreReal || !apiUrl({ action: "config_facturacion_get" })) {
        setConfigError("");
        setConfigLoading(false);
        return;
      }

      let cancelled = false;
      async function cargarConfigNC() {
        setConfigLoading(true);
        setConfigError("");
        try {
          const res = await facturacionFetch(apiUrl({ action: "config_facturacion_get" }), {
            method: "GET",
            headers: getAuthHeaders(),
          });
          const json = await parseJsonSafe(res);
          if (cancelled) return;

          const all = mergeConfigsFacturacion(
            extractConfigsFacturacionFromResponse(json),
            normalizeConfigFacturacionRow(json?.config || json?.data?.config || {}),
            listaLocal
          );

          const matchApi = all.find((cfg) => {
            const cfgId = configFacturacionId(cfg);
            const cfgCuit = onlyDigits(cfg?.cuit || cfg?.cuit_emisor || "");
            return (idInicial > 0 && cfgId === idInicial) || (cuitInicial && cfgCuit === cuitInicial);
          });

          const finalList = mergeConfigsFacturacion(matchApi || null, all);
          setConfigsFacturacion(finalList);

          const selectedApi = configFacturacionId(matchApi || finalList[0]);
          if (selectedApi > 0) setSelectedConfigId(String(selectedApi));
        } catch (e) {
          if (cancelled) return;
          setConfigError(e?.message || "No se pudo resolver la cuenta fiscal de la nota de crédito.");
          setConfigsFacturacion(listaLocal);
        } finally {
          if (!cancelled) setConfigLoading(false);
        }
      }

      cargarConfigNC();
      return () => {
        cancelled = true;
      };
    }

    if (iniciales.length) {
      setConfigsFacturacion(iniciales);
      const initialSelected = idInicial > 0 ? idInicial : configFacturacionId(iniciales[0]);
      if (initialSelected > 0) setSelectedConfigId(String(initialSelected));
    }

    // Si el modal padre ya trajo más de una cuenta fiscal, no volvemos a consultar
    // el endpoint al abrir el resumen. Esto evita que una falla momentánea de red/CORS
    // deje el selector bloqueado o muestre el aviso global de "Sin conexión".
    if (iniciales.length > 1) {
      setConfigLoading(false);
      setConfigError("");
      return;
    }

    let cancelled = false;
    async function cargarConfigs() {
      setConfigLoading(true);
      setConfigError("");
      try {
        const url = apiUrl({ action: "config_facturacion_get" });
        const res = await facturacionFetch(url, {
          method: "GET",
          headers: getAuthHeaders(),
        });
        const json = await parseJsonSafe(res);
        if (cancelled) return;

        const cfgDefault = normalizeConfigFacturacionRow(json?.config || json?.data?.config || {});
        const finalList = mergeConfigsFacturacion(
          extractConfigsFacturacionFromResponse(json),
          cfgDefault,
          iniciales
        );

        setConfigsFacturacion(finalList);

        const currentId = idInicial > 0
          ? idInicial
          : (configFacturacionId(cfgDefault) || configFacturacionId(finalList[0]));
        if (currentId > 0) setSelectedConfigId(String(currentId));
      } catch (e) {
        if (cancelled) return;
        setConfigError(e?.message || "No se pudieron cargar las cuentas fiscales.");
        setConfigsFacturacion(iniciales);
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    }

    cargarConfigs();
    return () => {
      cancelled = true;
    };
  }, [open, apiUrl, usarModoNC, data, dataConfigInicial, configsFacturacionInicial]);

  const configSeleccionada = useMemo(() => {
    const byId = configsFacturacion.find((cfg) => String(configFacturacionId(cfg)) === String(selectedConfigId));
    if (byId) return normalizeConfigFacturacionRow(byId);
    if (configFacturacionId(dataConfigInicial)) return dataConfigInicial;
    if (configsFacturacion[0]) return normalizeConfigFacturacionRow(configsFacturacion[0]);
    return normalizeConfigFacturacionRow({});
  }, [configsFacturacion, selectedConfigId, dataConfigInicial]);

  const cbteTipoEfectivo = useMemo(() => {
    if (usarModoNC) return Number(cbteTipo || 13) || 13;
    return Number(configSeleccionada?.cbte_tipo || onlyDigits(configSeleccionada?.codigo_comprobante) || cbteTipo || 11) || 11;
  }, [usarModoNC, cbteTipo, configSeleccionada]);

  const ptoVtaEfectivo = useMemo(() => {
    if (usarModoNC) return Number(ptoVta || data?.pto_vta || 2) || 2;
    return Number(configSeleccionada?.pto_vta || onlyDigits(configSeleccionada?.punto_venta) || ptoVta || 2) || 2;
  }, [usarModoNC, ptoVta, data?.pto_vta, configSeleccionada]);

  const dataFacturacion = useMemo(() => ({
    ...(data || {}),
    config_facturacion: configSeleccionada,
    id_config_facturacion: configFacturacionId(configSeleccionada) || null,
    idConfigFacturacion: configFacturacionId(configSeleccionada) || null,
    cbte_tipo: cbteTipoEfectivo,
    pto_vta: ptoVtaEfectivo,
    cbtes_asoc: normalizeCbtesAsocFrontend(data?.cbtes_asoc || data?.CbtesAsoc || data?.cbtesAsoc || [], data?.factura_original || null),
    emisor_nombre: pickText(configSeleccionada?.razon_social, data?.emisor_nombre),
    emisor_domicilio: pickText(configSeleccionada?.domicilio_comercial, data?.emisor_domicilio),
    cuit_emisor: pickText(configSeleccionada?.cuit, data?.cuit_emisor),
    cond_iva_emisor: pickText(configSeleccionada?.condicion_iva, data?.cond_iva_emisor),
    ingresos_brutos_emisor: pickText(configSeleccionada?.ingresos_brutos, data?.ingresos_brutos_emisor),
    fecha_inicio_actividades_emisor: pickText(configSeleccionada?.fecha_inicio_actividades, data?.fecha_inicio_actividades_emisor),
  }), [data, configSeleccionada, cbteTipoEfectivo, ptoVtaEfectivo]);

  const docLabel = useMemo(() => {
    const it = DOC_TIPOS.find((x) => x.id === Number(docTipo));
    return it?.label || String(docTipo ?? "");
  }, [docTipo]);

  const idPago = dataFacturacion?.id_pago ?? null;
  const idSistema = dataFacturacion?.id_sistema ?? null;

  const emisorInfo = useMemo(() => normalizeEmisorPdfInfo(dataFacturacion || {}), [dataFacturacion]);
  const clienteFacturaInfo = useMemo(
    () => normalizeClienteFacturacionPdfInfo(dataFacturacion || {}, { doc_tipo: docTipo, doc_nro: docNro }),
    [dataFacturacion, docTipo, docNro]
  );

  const nombreCliente =
    clienteFacturaInfo?.razon_social ||
    dataFacturacion?.labelCliente ||
    dataFacturacion?.cliente ||
    "—";

  const nombreSistema = dataFacturacion?.labelSistema || dataFacturacion?.sistema || "—";

  const items = useMemo(
    () => (Array.isArray(dataFacturacion?.items_facturacion) ? dataFacturacion.items_facturacion : []),
    [dataFacturacion]
  );

  const primerItem = useMemo(() => items?.[0] || {}, [items]);

  const montoReal = Number(dataFacturacion?.total_ars ?? dataFacturacion?.monto ?? dataFacturacion?.importe ?? 0);
  const monto = forceTestAmount ? Number(testAmount) : montoReal;

  const fechaCbteISO = String(dataFacturacion?.fecha_cbte_iso ?? "").slice(0, 10);
  const vtoPagoISO = String(dataFacturacion?.vto_pago_iso ?? "").slice(0, 10);

  const emisorNombre = emisorInfo.emisor_nombre;
  const emisorDomicilio = emisorInfo.emisor_domicilio;
  const emisorCuit = emisorInfo.cuit_emisor;
  const emisorCondIva = emisorInfo.cond_iva_emisor;
  const emisorIibb = emisorInfo.ingresos_brutos_emisor;
  const emisorFechaInicio = emisorInfo.fecha_inicio_actividades_emisor;

  const resumen = useMemo(() => {
    const doc = String(docNro ?? "").replace(/\D/g, "");
    const pv = String(ptoVtaEfectivo ?? "").replace(/\D/g, "");
    return {
      pago: idPago ? String(idPago) : "—",
      sistemaId: idSistema ? String(idSistema) : "—",
      cliente: nombreCliente,
      sistema: nombreSistema,
      fechaISO: fechaCbteISO,
      vtoISO: vtoPagoISO,
      montoTxt: moneyARS(monto),
      comprobante: getCbteLabel(cbteTipoEfectivo),
      receptorTxt: doc ? `${docLabel}: ${doc}` : "—",
      pvTxt: pv || "—",
      iva: clienteFacturaInfo?.cond_iva || clienteFacturaInfo?.condicion_iva || "—",
      domicilio: clienteFacturaInfo?.domicilio || "—",
      observaciones: safeText(dataFacturacion?.observaciones),
    };
  }, [
    idPago,
    idSistema,
    nombreCliente,
    nombreSistema,
    fechaCbteISO,
    vtoPagoISO,
    monto,
    docNro,
    ptoVtaEfectivo,
    docLabel,
    clienteFacturaInfo,
    dataFacturacion,
    cbteTipoEfectivo,
  ]);

  const obtenerCbteNoEmitido = useCallback(async () => {
    if (usarModoNC) return 0;

    if (Number(cbteNoEmitidoRef.current || 0) > 0) {
      return Number(cbteNoEmitidoRef.current || 0);
    }

    const res = await facturacionFetch(
      apiUrl({ action: "comprobantes_proximo_numero_no_emitido", tipo: "FACTURA" }),
      {
        method: "GET",
        headers: getAuthHeaders(),
      }
    );

    const j = await parseJsonSafe(res);
    const nro = Number(j?.cbte_nro || 0);

    if (nro <= 0) {
      throw new Error("No se pudo obtener el próximo número de factura no emitida.");
    }

    cbteNoEmitidoRef.current = nro;
    return nro;
  }, [apiUrl, usarModoNC]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirm(false);
    setTabActiva("resumen");
    movimientoIdRef.current = Number(dataFacturacion?.id_movimiento || 0) || 0;
    cbteNoEmitidoRef.current = null;
    setTimeout(() => firstRef.current?.focus?.(), 0);
  }, [open, dataFacturacion]);

useEffect(() => {
  if (!open) return;

  const onKey = (e) => {
    if (e.key !== "Escape") return;

    e.preventDefault();
    e.stopPropagation();

    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }

    if (!loading) {
      onClose?.();
    }
  };

  document.addEventListener("keydown", onKey, true);

  return () => {
    document.removeEventListener("keydown", onKey, true);
  };
}, [open, loading, onClose]);

  useEffect(() => {
    let revokeUrl = "";

    async function generarPreview() {
      if (!open) return;
      setLoadingPreview(true);
      setPreviewUrl("");

      try {
        if (usarModoNC) {
          const built = await buildNotaCreditoPdf({
            ...dataFacturacion,
            labelCliente: nombreCliente,
            labelSistema: nombreSistema,
            fecha_cbte_iso: fechaCbteISO || todayLocalISO(),
            fecha_cbte: fechaCbteISO || todayLocalISO(),
            vto_pago_iso: vtoPagoISO || todayLocalISO(),
            total_ars: monto,
            monto,
            importe: monto,
            cbte_tipo: Number(cbteTipoEfectivo) || 13,
            pto_vta: Number(ptoVtaEfectivo) || 2,
            cliente_facturacion: clienteFacturaInfo || dataFacturacion?.cliente_facturacion || {},
            config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || {},
            items_facturacion: items,
            emisor_nombre: emisorNombre || "BALTO",
            emisor_domicilio: emisorDomicilio || "",
            cuit_emisor: emisorCuit || "",
            cond_iva_emisor: emisorCondIva || "",
            ingresos_brutos_emisor: emisorIibb || "",
            fecha_inicio_actividades_emisor: emisorFechaInicio || "",
            emisor: emisorInfo?.emisor || null,
            observaciones: dataFacturacion?.observaciones || "",
            factura_original: dataFacturacion?.factura_original || null,
            cae: "",
            cae_vto: "",
            resultado: "P",
            cbte_nro: 0,
            qr_url: "",
            qr_base64: "",
            qr_payload: null,
          });

          const blob = built?.blob instanceof Blob ? built.blob : null;
          if (!blob) throw new Error("No se pudo generar preview de NC.");

          revokeUrl = URL.createObjectURL(blob);
          setPreviewUrl(revokeUrl);
        } else {
          const cbteNroLocal = await obtenerCbteNoEmitido();

          const factMock = {
            pto_vta: Number(ptoVtaEfectivo) || 2,
            cbte_tipo: Number(cbteTipoEfectivo) || 11,
            cbte_nro: cbteNroLocal,
            fecha_cbte: isoToYmd8(
              fechaCbteISO || todayLocalISO()
            ),
            imp_total: Number(monto) || 0,
            importe: Number(monto) || 0,
            cae: "00000000000000",
            cae_vto: isoToYmd8(vtoPagoISO || todayLocalISO()),
            resultado: "P",
            qr_url: "",
            qr_base64: "",
            qr_payload: null,
            emisor_nombre: emisorNombre || "BALTO",
            emisor_domicilio: emisorDomicilio || "",
            cuit_emisor: emisorCuit || "",
            cond_iva_emisor: emisorCondIva || "",
            ingresos_brutos_emisor: emisorIibb || "",
            fecha_inicio_actividades_emisor: emisorFechaInicio || "",
            receptor_nombre:
              clienteFacturaInfo?.razon_social || nombreCliente,
            receptor_domicilio:
              clienteFacturaInfo?.domicilio || dataFacturacion?.cliente_domicilio || "",
            cond_iva_receptor:
              clienteFacturaInfo?.cond_iva || clienteFacturaInfo?.condicion_iva || "",
            doc_tipo: Number(docTipo),
            doc_nro: String(docNro || "").replace(/\D/g, ""),
          };

          const doc = await buildBaltoInvoicePdf({
            fact: factMock,
            data: {
              ...dataFacturacion,
              labelCliente: nombreCliente,
              labelSistema: nombreSistema,
              fecha_cbte: isoToYmd8(fechaCbteISO),
              vto_pago: isoToYmd8(vtoPagoISO),
              total_ars: monto,
              monto,
              importe: monto,
              cliente_facturacion: clienteFacturaInfo || dataFacturacion?.cliente_facturacion || {},
              config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || {},
              emisor: emisorInfo?.emisor || null,
              items_facturacion: items,
            },
            forceTestAmount,
            testAmount,
          });

          const blob = doc.output("blob");
          revokeUrl = URL.createObjectURL(blob);
          setPreviewUrl(revokeUrl);
        }
      } catch (e) {
        console.warn("Preview PDF:", e?.message || e);
        setPreviewUrl("");
      } finally {
        setLoadingPreview(false);
      }
    }

    generarPreview();

    return () => {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [
    open,
    dataFacturacion,
    docTipo,
    docNro,
    cbteTipoEfectivo,
    ptoVtaEfectivo,
    nombreCliente,
    nombreSistema,
    monto,
    forceTestAmount,
    testAmount,
    fechaCbteISO,
    vtoPagoISO,
    items,
    clienteFacturaInfo,
    emisorInfo,
    emisorNombre,
    emisorDomicilio,
    emisorCuit,
    emisorCondIva,
    emisorIibb,
    emisorFechaInicio,
    usarModoNC,
    obtenerCbteNoEmitido,
    configSeleccionada,
  ]);

  const toText = useCallback((v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }, []);

  const fetchJSON = useCallback(
    async (url, opts) => {
      const headers = getAuthHeaders(opts?.headers || {});
      const res = await facturacionFetch(url, { ...opts, headers });
      const raw = await res.text();
      const trimmed = (raw || "").trim();

      if (trimmed.startsWith("<")) {
        const err = new Error("Backend devolvió HTML (error PHP/gateway).");
        err.httpStatus = res.status;
        throw err;
      }

      let j = null;
      try {
        j = trimmed ? JSON.parse(trimmed) : null;
      } catch {
        j = null;
      }

      const pickErr = () =>
        toText(j?.mensaje) ||
        toText(j?.error) ||
        toText(j?.message) ||
        toText(j?.detail) ||
        "";

      if (!res.ok) {
        const err = new Error(pickErr() || `HTTP ${res.status}`);
        err.httpStatus = res.status;
        throw err;
      }
      if (j && typeof j === "object" && j.exito === false) {
        throw new Error(pickErr() || "Error servidor");
      }
      if (j == null) throw new Error("Respuesta inválida (no JSON)");
      return j;
    },
    [toText]
  );

  const fetchJSONArcaSeguro = useCallback(
    async (url, opts) => {
      let lastError = null;

      // Es seguro reintentar wsfe_emitir porque la misma operacion_key queda
      // persistida en backend antes de responder. Si ARCA ya otorgó CAE, el
      // reintento recupera esa autorización y NO emite otro comprobante.
      for (let intento = 1; intento <= 3; intento += 1) {
        try {
          return await fetchJSON(url, opts);
        } catch (e) {
          lastError = e;
          const status = Number(e?.httpStatus || 0);
          const msg = String(e?.message || "");
          const transitorio =
            e instanceof TypeError ||
            status === 408 ||
            status === 429 ||
            status >= 500 ||
            /failed to fetch|network|load failed|gateway|respuesta vacía/i.test(msg);

          if (!transitorio || intento >= 3) throw e;
          await new Promise((resolve) => window.setTimeout(resolve, 650 * intento));
        }
      }

      throw lastError || new Error("No se pudo completar la comunicación con ARCA.");
    },
    [fetchJSON]
  );

  const validar = useCallback(() => {
    const doc = String(docNro ?? "").replace(/\D/g, "");
    const pv = String(ptoVtaEfectivo ?? "").replace(/\D/g, "");

    if (!doc) return { ok: false, msg: "Falta documento." };
    if (!pv) return { ok: false, msg: "Falta punto de venta." };

    if (!usarModoNC && !safeText(configSeleccionada?.cuit)) {
      return { ok: false, msg: "Seleccioná una cuenta fiscal válida para emitir." };
    }

    if (Number(docTipo) === 96 && !(doc.length === 7 || doc.length === 8)) {
      return { ok: false, msg: "DNI inválido (7 u 8 dígitos)." };
    }

    if (Number(docTipo) === 80 && doc.length !== 11) {
      return { ok: false, msg: "CUIT inválido (11 dígitos)." };
    }

    if (!safeText(dataFacturacion?.cliente_facturacion?.razon_social)) {
      return { ok: false, msg: "Falta razón social / apellido y nombre del cliente." };
    }

    if (
      !safeText(dataFacturacion?.cliente_facturacion?.cond_iva) &&
      !safeText(dataFacturacion?.cliente_facturacion?.condicion_iva)
    ) {
      return { ok: false, msg: "Falta condición frente al IVA del cliente." };
    }

    if (!safeText(dataFacturacion?.cliente_facturacion?.domicilio)) {
      return { ok: false, msg: "Falta domicilio del cliente." };
    }

    if (!fechaCbteISO) {
      return { ok: false, msg: "Falta fecha del comprobante." };
    }

    if (!vtoPagoISO) {
      return { ok: false, msg: "Falta fecha de vencimiento." };
    }

    if (!Array.isArray(items) || !items.length) {
      return { ok: false, msg: "No hay ítems para facturar." };
    }

    if (!Number.isFinite(Number(monto)) || Number(monto) <= 0) {
      return { ok: false, msg: "El monto total es inválido." };
    }

    const fecha = new Date(fechaCbteISO);
    const anio = fecha.getFullYear();
    const id_mes = fecha.getMonth() + 1;

    return {
      ok: true,
      docN: Number(doc),
      pvN: Number(pv),
      anio,
      id_mes,
      id_pago: idPago ? Number(idPago) : null,
      id_sistema: idSistema ? Number(idSistema) : null,
    };
  }, [
    dataFacturacion,
    configSeleccionada,
    usarModoNC,
    docNro,
    ptoVtaEfectivo,
    docTipo,
    idPago,
    idSistema,
    fechaCbteISO,
    vtoPagoISO,
    items,
    monto,
  ]);

  const buildMovimientoPayload = useCallback(() => {
    const idDetalle =
      toNumberOrNull(dataFacturacion?.id_detalle) ??
      toNumberOrNull(primerItem?.id_detalle) ??
      toNumberOrNull(primerItem?.id) ??
      null;

    const cantidad = Number(primerItem?.cantidad ?? 1) || 1;
    const precioUnitario =
      Number(
        primerItem?.precio_unitario ??
          primerItem?.precio ??
          primerItem?.subtotal ??
          monto
      ) || Number(monto) || 0;

    const ivaPct = Number(primerItem?.iva_pct ?? 0) || 0;
    const subtotal =
      Number(primerItem?.subtotal ?? cantidad * precioUnitario) ||
      cantidad * precioUnitario;
    const ivaMonto = Number(primerItem?.iva_monto ?? 0) || 0;
    const total =
      Number(primerItem?.total ?? primerItem?.ars ?? monto) || Number(monto) || 0;

    return {
      fecha: fechaCbteISO,
      periodo: safeText(dataFacturacion?.periodo) || String(fechaCbteISO || "").slice(0, 7),
      id_clasificacion: toNumberOrNull(dataFacturacion?.id_clasificacion),
      id_tipo_venta: toNumberOrNull(dataFacturacion?.id_tipo_venta),
      id_medio_pago: toNumberOrNull(dataFacturacion?.id_medio_pago),
      id_cliente: toNumberOrNull(dataFacturacion?.id_cliente),
      id_detalle: idDetalle,
      monto_total: Number(monto) || total,
      cantidad,
      precio: precioUnitario,
      iva_pct: ivaPct,
      subtotal,
      iva_monto: ivaMonto,
      total,
    };
  }, [dataFacturacion, primerItem, monto, fechaCbteISO]);

  const ensureMovimientoGuardado = useCallback(async () => {
    if (skipMovimientoAutocreacion) return null;

    const ya = Number(movimientoIdRef.current || dataFacturacion?.id_movimiento || 0) || 0;
    if (ya > 0) return ya;

    const createAction = resolveMovimientoCreateAction(action);
    const payload = buildMovimientoPayload();

    if (!payload.id_cliente) {
      throw new Error("No se puede guardar la venta: falta id_cliente.");
    }
    if (!payload.id_tipo_venta) {
      throw new Error("No se puede guardar la venta: falta id_tipo_venta.");
    }
    if (!payload.id_detalle) {
      throw new Error("No se puede guardar la venta: falta id_detalle.");
    }

    const resp = await fetchJSON(apiUrl({ action: createAction }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const newId =
      Number(resp?.id_movimiento || 0) ||
      Number(resp?.data?.id_movimiento || 0) ||
      0;

    if (newId <= 0) {
      throw new Error("El backend creó la venta pero no devolvió id_movimiento.");
    }

    movimientoIdRef.current = newId;
    return newId;
  }, [
    skipMovimientoAutocreacion,
    dataFacturacion?.id_movimiento,
    action,
    buildMovimientoPayload,
    apiUrl,
    fetchJSON,
  ]);

  const guardarFacturaEnDB = useCallback(
    async ({
      blob,
      filename,
      fact,
      estado,
      emitidoEnArca = false,
      idMovimiento,
      tipo = "FACTURA",
    }) => {
      const idMovPrincipal = Number(idMovimiento || 0);
      if (idMovPrincipal <= 0) {
        throw new Error("No hay id_movimiento válido para vincular el comprobante.");
      }

      const fd = new FormData();
      fd.append("tipo", tipo);
      fd.append("id_movimiento", String(idMovPrincipal));
      fd.append(
        "pdf",
        blob instanceof Blob ? blob : new Blob([blob], { type: "application/pdf" }),
        filename || (tipo === "NOTA_CREDITO" ? "nota_credito.pdf" : "factura.pdf")
      );

      const meta = {
        tipo,
        estado: String(estado || "").trim() || "solo_pdf",
        emitido_en_arca: emitidoEnArca ? 1 : 0,

        id_pago: idPago ?? null,
        id_sistema: idSistema ?? null,

        razon_social: clienteFacturaInfo?.razon_social || null,
        cond_iva:
          clienteFacturaInfo?.cond_iva ||
          clienteFacturaInfo?.condicion_iva ||
          null,
        domicilio: clienteFacturaInfo?.domicilio || null,
        cliente_facturacion: clienteFacturaInfo || null,
        emisor: emisorInfo?.emisor || null,
        config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || null,
        id_config_facturacion: configFacturacionId(configSeleccionada) || dataFacturacion?.id_config_facturacion || null,
        cuit_emisor: emisorCuit || configSeleccionada?.cuit || null,

        items_facturacion: Array.isArray(dataFacturacion?.items_facturacion)
          ? dataFacturacion.items_facturacion
          : [],
        total_ars: emitidoEnArca
          ? Number(fact?.imp_total ?? fact?.importe ?? dataFacturacion?.total_ars ?? dataFacturacion?.monto ?? 0)
          : Number(dataFacturacion?.total_ars ?? dataFacturacion?.monto ?? dataFacturacion?.importe ?? 0),
        monto_ars: emitidoEnArca
          ? Number(fact?.imp_total ?? fact?.importe ?? dataFacturacion?.monto ?? 0)
          : Number(dataFacturacion?.monto ?? dataFacturacion?.total_ars ?? dataFacturacion?.importe ?? 0),
        observaciones: dataFacturacion?.observaciones ?? "",
        vto_pago: isoToYmd8(vtoPagoISO) || null,

        doc_tipo: Number(docTipo) || null,
        doc_nro: String(docNro || "").replace(/\D/g, "") || null,
        cbte_tipo: Number(cbteTipoEfectivo) || null,
        pto_vta: Number(ptoVtaEfectivo) || null,

        anio: emitidoEnArca ? Number(fact?.anio || 0) : null,
        id_mes: emitidoEnArca ? Number(fact?.id_mes || 0) : null,

        cbte_nro: fact?.cbte_nro ?? null,
        cae: emitidoEnArca ? (fact?.cae ?? null) : null,
        cae_vto: emitidoEnArca ? (fact?.cae_vto ?? null) : null,
        fecha_cbte: emitidoEnArca
          ? (fact?.fecha_cbte ?? null)
          : ((fact?.fecha_cbte ?? isoToYmd8(fechaCbteISO)) || null),
        resultado: fact?.resultado ?? null,

        qr_url: emitidoEnArca ? (fact?.qr_url ?? null) : null,
        qr_base64: emitidoEnArca ? (fact?.qr_base64 ?? null) : null,
        qr_payload: emitidoEnArca ? (fact?.qr_payload ?? null) : null,

        json_arca: emitidoEnArca
          ? (fact?.json_arca ?? fact?.raw_min ?? fact ?? null)
          : (fact?.json_arca ?? null),
      };

      fd.append("meta", JSON.stringify(meta));

      const res = await facturacionFetch(apiUrl({ action: "comprobantes_vincular_movimiento" }), {
        method: "POST",
        body: fd,
        headers: getAuthHeaders(),
      });

      const raw = await res.text();
      let j = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (!res.ok) {
        throw new Error(j?.mensaje || j?.error || `HTTP ${res.status}`);
      }
      if (j && typeof j === "object" && j.exito === false) {
        throw new Error(j?.mensaje || "Error guardando comprobante");
      }

      return j || {};
    },
    [
      apiUrl,
      dataFacturacion,
      configSeleccionada,
      clienteFacturaInfo,
      emisorInfo,
      emisorCuit,
      docTipo,
      docNro,
      cbteTipoEfectivo,
      ptoVtaEfectivo,
      vtoPagoISO,
      fechaCbteISO,
      idPago,
      idSistema,
    ]
  );

  const finalizarUnaSolaVez = useCallback(
    async (fact) => {
      // No ocultar nunca un error posterior al CAE. Si falla el guardado local
      // o la subida del PDF, el error vuelve a este modal, que queda abierto para
      // reintentar con la MISMA operacion_key y recuperar la autorización.
      if (typeof onDone === "function") {
        await Promise.resolve(onDone(fact));
        return;
      }

      if (typeof onFacturada === "function") {
        await Promise.resolve(onFacturada(fact));
      }
    },
    [onDone, onFacturada]
  );


  const emitir = useCallback(async () => {
    setError("");
    if (isBaltoDemoMode()) {
      setError(DEMO_BLOCK_MESSAGE);
      return;
    }
    const v = validar();
    if (!v.ok) return setError(v.msg);
    if (!confirm) return setError("Tenés que confirmar antes de emitir.");

    setLoading(true);
    try {
      const idMovimiento = skipMovimientoAutocreacion
        ? null
        : await ensureMovimientoGuardado();

      const url = apiUrl({ action: "wsfe_emitir" });

      const body = {
        data: {
          id_movimiento: idMovimiento,
          id_pago: v.id_pago,
          id_sistema: v.id_sistema,

          cliente_facturacion: {
            ...clienteFacturaInfo,
            doc_tipo: Number(docTipo),
            doc_nro: String(v.docN),
            cuit: Number(docTipo) === 80 ? String(v.docN) : clienteFacturaInfo?.cuit || "",
          },

          doc_tipo: Number(docTipo),
          doc_nro: v.docN,
          cbte_tipo: Number(cbteTipoEfectivo),
          pto_vta: v.pvN,

          razon_social: clienteFacturaInfo?.razon_social || null,
          cond_iva:
            clienteFacturaInfo?.cond_iva ||
            clienteFacturaInfo?.condicion_iva ||
            null,
          domicilio: clienteFacturaInfo?.domicilio || null,

          total_ars: forceTestAmount ? Number(testAmount) : Number(monto),
          monto: forceTestAmount ? Number(testAmount) : Number(monto),
          importe: forceTestAmount ? Number(testAmount) : Number(monto),

          anio: v.anio,
          id_mes: v.id_mes,

          fecha_cbte_iso: fechaCbteISO,
          vto_pago_iso: vtoPagoISO,
          fecha_cbte: isoToYmd8(fechaCbteISO),
          vto_pago: isoToYmd8(vtoPagoISO),

          items_facturacion: items,
          observaciones: dataFacturacion?.observaciones || "",
          concepto: dataFacturacion?.concepto ?? 1,
          id_config_facturacion: configFacturacionId(configSeleccionada) || null,
          idConfigFacturacion: configFacturacionId(configSeleccionada) || null,
          config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || null,
          emisor: emisorInfo?.emisor || null,

          // Clave persistente para recuperar una autorización si el navegador
          // pierde la respuesta después de que ARCA ya otorgó el CAE.
          operacion_key: safeText(
            dataFacturacion?.operacion_key || dataFacturacion?.operation_key
          ) || null,
          operacion_contexto: safeText(
            dataFacturacion?.operacion_contexto || dataFacturacion?.operation_context
          ) || null,
          operacion_id_origen: Number(
            dataFacturacion?.operacion_id_origen || dataFacturacion?.operation_origin_id || 0
          ) || null,

          cbtes_asoc: normalizeCbtesAsocFrontend(dataFacturacion?.cbtes_asoc || [], dataFacturacion?.factura_original || null),

          emisor_nombre: emisorNombre || null,
          emisor_domicilio: emisorDomicilio || null,
          cuit_emisor: emisorCuit || null,
          cond_iva_emisor: emisorCondIva || null,
          ingresos_brutos_emisor: emisorIibb || null,
          fecha_inicio_actividades_emisor: emisorFechaInicio || null,
        },
      };

      // Sólo reintentamos automáticamente cuando existe operacion_key. Sin esa
      // clave no podemos garantizar idempotencia y un reintento podría duplicar
      // una emisión fiscal.
      const emitirRequest = safeText(body?.data?.operacion_key)
        ? fetchJSONArcaSeguro
        : fetchJSON;
      const resp = await emitirRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const fact = normalizeFacturaEmitida(resp, {
        pto_vta: v.pvN,
        cbte_tipo: Number(cbteTipoEfectivo),
        fecha_cbte: fechaCbteISO,
        doc_tipo: Number(docTipo),
        doc_nro: String(v.docN),
      });

      if (!fact?.cae) {
        throw new Error("ARCA no devolvió CAE.");
      }

      if (usarModoNC) {
        const pdfData = {
          ...dataFacturacion,
          id_movimiento: idMovimiento,
          labelCliente: nombreCliente,
          labelSistema: nombreSistema,
          fecha_cbte_iso: fact?.fecha_cbte || fechaCbteISO,
          fecha_cbte: fact?.fecha_cbte || fechaCbteISO,
          vto_pago_iso: vtoPagoISO,
          total_ars: Number(fact?.imp_total || monto),
          monto: Number(fact?.imp_total || monto),
          importe: Number(fact?.imp_total || monto),
          cbte_tipo: Number(fact?.cbte_tipo || cbteTipoEfectivo || 13),
          pto_vta: Number(fact?.pto_vta || ptoVtaEfectivo || 2),
          cbte_nro: Number(fact?.cbte_nro || 0),
          cae: fact?.cae || "",
          cae_vto: fact?.cae_vto || "",
          resultado: fact?.resultado || "",
          qr_url: fact?.qr_url || "",
          qr_base64: fact?.qr_base64 || "",
          qr_payload: fact?.qr_payload || null,
          cliente_facturacion: clienteFacturaInfo || dataFacturacion?.cliente_facturacion || {},
          config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || {},
          id_config_facturacion: configFacturacionId(configSeleccionada) || dataFacturacion?.id_config_facturacion || null,
          items_facturacion: items,
          observaciones: dataFacturacion?.observaciones || "",
          emisor_nombre: emisorNombre || "BALTO",
          emisor_domicilio: emisorDomicilio || "",
          cuit_emisor: emisorCuit || "",
          cond_iva_emisor: emisorCondIva || "",
          ingresos_brutos_emisor: emisorIibb || "",
          fecha_inicio_actividades_emisor: emisorFechaInicio || "",
          emisor: emisorInfo?.emisor || null,
          factura_original: data?.factura_original || null,
        };

        const out = await saveNotaCreditoPdf(pdfData, { autoDownload: true });
        const blob = out?.pdfBlob instanceof Blob ? out.pdfBlob : null;
        const filename = out?.pdfFilename || "nota_credito.pdf";
        if (!blob) throw new Error("No se pudo generar el PDF de la nota de crédito.");

        let idComprobante = null;

        if (!skipMovimientoAutocreacion && idMovimiento) {
          const dbResp = await guardarFacturaEnDB({
            blob,
            filename,
            fact: {
              ...fact,
              json_arca: fact?.raw_min || fact || null,
              anio: v.anio,
              id_mes: v.id_mes,
              importe: Number(fact?.imp_total || monto),
              fecha_cbte: fact?.fecha_cbte || isoToYmd8(fechaCbteISO),
            },
            estado: "emitida",
            emitidoEnArca: true,
            idMovimiento,
            tipo: "NOTA_CREDITO",
          });

          idComprobante =
            dbResp?.id_comprobante ??
            dbResp?.comprobante?.id_comprobante ??
            null;
        }

        const factFinal = {
          ...fact,
          emitido_en_arca: 1,
          id_config_facturacion: configFacturacionId(configSeleccionada) || dataFacturacion?.id_config_facturacion || null,
          config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || null,
          cuit_emisor: emisorCuit || configSeleccionada?.cuit || fact?.cuit_emisor || null,
          json_arca: fact?.raw_min || fact || null,
          id_movimiento: idMovimiento,
          id_comprobante: idComprobante,
          pdf_blob: blob,
          pdf_filename: filename,
        };

        await finalizarUnaSolaVez(factFinal);
        onCloseAll?.();
      } else {
        const out = await saveBaltoInvoicePdf({
          fact: {
            ...fact,
            anio: v.anio,
            id_mes: v.id_mes,
            importe: Number(fact?.imp_total || monto),
            imp_total: Number(fact?.imp_total || monto),
            fecha_cbte: fact?.fecha_cbte || isoToYmd8(fechaCbteISO),
            cae_vto: fact?.cae_vto || isoToYmd8(vtoPagoISO),
            emisor_nombre: emisorNombre || fact?.emisor_nombre,
            emisor_domicilio: emisorDomicilio || fact?.emisor_domicilio,
            cuit_emisor: emisorCuit || fact?.cuit_emisor,
            cond_iva_emisor: emisorCondIva || fact?.cond_iva_emisor,
            ingresos_brutos_emisor: emisorIibb || fact?.ingresos_brutos_emisor,
            fecha_inicio_actividades_emisor:
              emisorFechaInicio || fact?.fecha_inicio_actividades_emisor,
            receptor_nombre:
              clienteFacturaInfo?.razon_social || fact?.receptor_nombre,
            receptor_domicilio:
              clienteFacturaInfo?.domicilio || fact?.receptor_domicilio,
            cond_iva_receptor:
              clienteFacturaInfo?.cond_iva ||
              clienteFacturaInfo?.condicion_iva ||
              fact?.cond_iva_receptor,
          },
          data: {
            ...dataFacturacion,
            id_movimiento: idMovimiento,
            labelCliente: nombreCliente,
            labelSistema: nombreSistema,
            fecha_cbte: isoToYmd8(fact?.fecha_cbte || fechaCbteISO),
            vto_pago: isoToYmd8(vtoPagoISO),
            cliente_facturacion: clienteFacturaInfo || dataFacturacion?.cliente_facturacion || {},
            config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || {},
            id_config_facturacion: configFacturacionId(configSeleccionada) || dataFacturacion?.id_config_facturacion || null,
            emisor: emisorInfo?.emisor || null,
            items_facturacion: items,
            total_ars: Number(fact?.imp_total || monto),
            monto: Number(fact?.imp_total || monto),
            importe: Number(fact?.imp_total || monto),
          },
          forceTestAmount,
          testAmount,
          download: true,
        });

        const blob =
          out?.blob instanceof Blob ? out.blob : out instanceof Blob ? out : null;
        const filename = out?.filename || "factura.pdf";
        if (!blob) throw new Error("No se pudo generar el PDF.");

        let idComprobante = null;

        if (!skipMovimientoAutocreacion && idMovimiento) {
          const dbResp = await guardarFacturaEnDB({
            blob,
            filename,
            fact: {
              ...fact,
              json_arca: fact?.raw_min || fact || null,
              anio: v.anio,
              id_mes: v.id_mes,
              importe: Number(fact?.imp_total || monto),
              fecha_cbte: fact?.fecha_cbte || isoToYmd8(fechaCbteISO),
            },
            estado: "emitida",
            emitidoEnArca: true,
            idMovimiento,
            tipo: "FACTURA",
          });

          idComprobante =
            dbResp?.id_comprobante ??
            dbResp?.comprobante?.id_comprobante ??
            null;
        }

        const factFinal = {
          ...fact,
          emitido_en_arca: 1,
          id_config_facturacion: configFacturacionId(configSeleccionada) || dataFacturacion?.id_config_facturacion || null,
          config_facturacion: configSeleccionada || dataFacturacion?.config_facturacion || null,
          cuit_emisor: emisorCuit || configSeleccionada?.cuit || fact?.cuit_emisor || null,
          json_arca: fact?.raw_min || fact || null,
          id_movimiento: idMovimiento,
          id_comprobante: idComprobante,
          pdf_blob: blob,
          pdf_filename: filename,
        };

        await finalizarUnaSolaVez(factFinal);
        onCloseAll?.();
      }
    } catch (e) {
      setError(e?.message || "No se pudo emitir el comprobante.");
    } finally {
      setLoading(false);
    }
  }, [
    validar,
    confirm,
    skipMovimientoAutocreacion,
    ensureMovimientoGuardado,
    apiUrl,
    docTipo,
    cbteTipoEfectivo,
    ptoVtaEfectivo,
    dataFacturacion,
    configSeleccionada,
    forceTestAmount,
    testAmount,
    monto,
    fechaCbteISO,
    vtoPagoISO,
    items,
    clienteFacturaInfo,
    emisorInfo,
    emisorNombre,
    emisorDomicilio,
    emisorCuit,
    emisorCondIva,
    emisorIibb,
    emisorFechaInicio,
    nombreCliente,
    nombreSistema,
    fetchJSON,
    fetchJSONArcaSeguro,
    guardarFacturaEnDB,
    finalizarUnaSolaVez,
    onCloseAll,
    usarModoNC,
  ]);

  if (!open) return null;

  const cerrar = () => {
    if (!loading) onClose?.();
  };

  return (
    <div
      className="mi-modal__overlay"
      onClick={(e) =>
        e.target.classList.contains("mi-modal__overlay") && cerrar()
      }
    >
      <div
        className="mi-modal__container mfr-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-left">
            <h2 className="mi-modal__title">
              {usarModoNC ? "Resumen antes de emitir nota de crédito" : "Resumen antes de emitir"}
            </h2>
            <p className="mi-modal__subtitle">
              Confirmá datos → Vista previa → Emitir y facturar
            </p>
          </div>

          <button
            className="mi-modal__close"
            onClick={cerrar}
            aria-label="Cerrar"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mit-modal__body mfr-body">
          <div className="mfr-tabs">
            <button
              type="button"
              className={`mfr-tab ${tabActiva === "resumen" ? "is-active" : ""}`}
              onClick={() => setTabActiva("resumen")}
            >
              <span className="mfr-tab__text">
                {usarModoNC
                  ? "Resumen de nota de crédito"
                  : "Resumen de facturación"}
              </span>
            </button>

            <button
              type="button"
              className={`mfr-tab ${tabActiva === "preview" ? "is-active" : ""}`}
              onClick={() => setTabActiva("preview")}
            >
              <span className="mfr-tab__text">
                Vista previa PDF
              </span>
            </button>
          </div>

          {error && (
            <div className="mov-mi-error mfr-error-top" role="alert">
              {error}
            </div>
          )}

          {tabActiva === "resumen" && (
            <div className="mi-tabpanel mfr-tabpanel">
              <div className="mi-card mfr-card">
                <div className="mfr-summary">
                  <div className="mfr-summary__head">
                    <h3 className="mfr-control-title">Control final</h3>
                  </div>

                  {!usarModoNC && (
                    <div className="fl-grid mfr-config-grid">
                      <div className="fl-field fl-col-full">
                        <select
                          className="fl-input fl-select"
                          value={selectedConfigId}
                          onChange={(e) => {
                            setSelectedConfigId(e.target.value);
                            setConfirm(false);
                            setError("");
                          }}
                          disabled={loading}
                        >
                          {!configsFacturacion.length && (
                            <option value="">Sin cuentas fiscales activas</option>
                          )}
                          {configsFacturacion.map((cfg) => {
                            const id = configFacturacionId(cfg);
                            return (
                              <option key={id || cfg.cuit || configFacturacionLabel(cfg)} value={String(id)}>
                                {configFacturacionLabel(cfg)}
                              </option>
                            );
                          })}
                        </select>
                        <label className="fl-label">Cuenta fiscal emisora *</label>
                      </div>

                      {configLoading && (
                        <div className="mfr-mini fl-col-full">Cargando cuentas fiscales...</div>
                      )}

                      {configError && (
                        <div className="mfr-alert mfr-alert--error fl-col-full" role="alert">
                          {configError}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mfr-summary-grid">
                    <section className="mfr-info-panel">
                      <h3 className="mfr-info-panel__title">Datos del cliente</h3>
                      <div className="mfr-info-list">
                        <div className="mfr-info-row"><b>Cliente</b><span>{resumen.cliente}</span></div>
                        <div className="mfr-info-row"><b>Sistema</b><span>{resumen.sistema}</span></div>
                        <div className="mfr-info-row"><b>Fecha</b><span>{ymdToHuman(resumen.fechaISO)}</span></div>
                        <div className="mfr-info-row"><b>Vencimiento</b><span>{ymdToHuman(resumen.vtoISO)}</span></div>
                        <div className="mfr-info-row"><b>Receptor</b><span>{resumen.receptorTxt}</span></div>
                        <div className="mfr-info-row"><b>Punto de venta</b><span>{resumen.pvTxt}</span></div>
                        <div className="mfr-info-row"><b>IVA cliente</b><span>{resumen.iva}</span></div>
                        <div className="mfr-info-row"><b>Domicilio cliente</b><span>{resumen.domicilio}</span></div>
                      </div>
                    </section>

                    <section className="mfr-info-panel">
                      <h3 className="mfr-info-panel__title">Datos del emisor</h3>
                      <div className="mfr-info-list">
                        <div className="mfr-info-row"><b>Emisor</b><span>{emisorNombre}</span></div>
                        <div className="mfr-info-row"><b>CUIT emisor</b><span>{emisorCuit}</span></div>
                        <div className="mfr-info-row"><b>IVA emisor</b><span>{emisorCondIva}</span></div>
                        <div className="mfr-info-row"><b>Domicilio comercial</b><span>{emisorDomicilio}</span></div>
                        <div className="mfr-info-row"><b>Ing. Brutos</b><span>{emisorIibb}</span></div>
                        <div className="mfr-info-row"><b>Inicio actividades</b><span>{emisorFechaInicio}</span></div>
                        <div className="mfr-info-row"><b>Comprobante</b><span>{resumen.comprobante}</span></div>
                      </div>
                    </section>
                  </div>

                  <div className="mfr-detail">
                    <div className="mfr-detail__head">
                      <strong>Detalle</strong>
                      <span>{(items || []).length} ítem{(items || []).length === 1 ? "" : "s"}</span>
                    </div>

                    <div className="mfr-detail__list">
                      {(items || []).map((it, idx) => (
                        <div
                          key={`${it?.id || idx}_${idx}`}
                          className="mfr-item"
                        >
                          <div className="mfr-item__main">
                            <span className="mfr-item__index">{idx + 1}</span>
                            <span className="mfr-item__desc">{it.descripcion}</span>
                          </div>

                          <div className="mfr-item__meta">
                            <span><b>Cant.</b>{it.cantidad}</span>
                            <span><b>P. Unit.</b>{moneyARS(it.precio_unitario || it.precio || 0)}</span>
                            <span><b>IVA</b>{moneyARS(it.iva_monto || 0)}</span>
                            <span className="mfr-item__total"><b>Total</b>{moneyARS(it.total || it.ars || it.subtotal || 0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mfr-confirm">
                    <label className="mfr-check">
                      <input
                        ref={firstRef}
                        type="checkbox"
                        checked={confirm}
                        onChange={(e) => setConfirm(e.target.checked)}
                        disabled={loading || (!usarModoNC && !safeText(configSeleccionada?.cuit))}
                        className="mfr-check__input"
                      />

                      <span className="mfr-check__box">
                        <FaCheck className="mfr-check__icon" />
                      </span>

                      <span className="mfr-check__text">
                        Confirmo que los <b>datos del cliente</b>, del <b>emisor</b>, el <b>detalle</b> y el <b>monto</b> son correctos.
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tabActiva === "preview" && (
            <div className="mfr-preview-panel">
              <div className="mi-card mfr-preview-card">
                {loadingPreview ? (
                  <div className="mfr-alert mfr-alert--info">
                    Generando vista previa...
                  </div>
                ) : previewUrl ? (
                  <iframe
                    title={usarModoNC ? "Vista previa nota de crédito PDF" : "Vista previa factura PDF"}
                    src={previewUrl}
                    className="mfr-preview"
                  />
                ) : (
                  <div className="mfr-alert mfr-alert--error">
                    No se pudo generar la vista previa del PDF.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mit-actions mfr-actions">
            <button
              type="button"
              className="mit-btn mit-btn--ghost mfr-btn"
              onClick={() => !loading && onBack?.()}
              disabled={loading}
            >
              Volver
            </button>

            <button
              type="button"
              className="mit-btn mit-btn--solid mfr-btn"
              onClick={emitir}
              disabled={loading || !confirm}
            >
              {loading ? (
                usarModoNC ? "Emitiendo nota de crédito..." : "Emitiendo..."
              ) : (
                <>
                  Emitir + facturar <FaCheck className="mfr-icon" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
