import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { facturacionFetch } from "./api/facturacionApi.js";
import { FaSearch, FaCheck, FaTimes } from "react-icons/fa";
import "./ModalFacturaBalto.css";
import ModalFacturaDatos from "./ModalFacturaDatos.jsx";
import ModalFacturaBaltoResumen from "./ModalFacturaBaltoResumen.jsx";
import BASE_URL from "../../../config/config";
import { safeStr, safeJsonParse, todayISO } from "./utils/facturacionUtils.js";

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

function configFacturacionId(cfg) {
  return Number(cfg?.id_config_facturacion || cfg?.idConfigFacturacion || 0) || 0;
}

function normalizeConfigFacturacionRow(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const id = configFacturacionId(c);
  const cuit = onlyDigits(c?.cuit || c?.cuit_emisor || "");
  const pv = onlyDigits(c?.punto_venta || c?.pto_vta || "") || "2";
  const cbte = onlyDigits(c?.codigo_comprobante || c?.cbte_tipo || "") || "11";
  const razon = safeStr(c?.razon_social || c?.nombre_fantasia || c?.emisor_nombre || c?.nombre || "BALTO");

  return {
    ...c,
    idConfigFacturacion: id,
    id_config_facturacion: id,
    razon_social: razon,
    nombre_fantasia: safeStr(c?.nombre_fantasia) || razon,
    cuit,
    cuit_emisor: cuit,
    punto_venta: String(pv).padStart(5, "0"),
    pto_vta: Number(pv) || 2,
    codigo_comprobante: String(cbte).padStart(3, "0"),
    cbte_tipo: Number(cbte) || 11,
    domicilio_comercial: safeStr(c?.domicilio_comercial || c?.domicilio || c?.domicilio_fiscal),
    condicion_iva: safeStr(c?.condicion_iva || c?.cond_iva),
    cond_iva: safeStr(c?.condicion_iva || c?.cond_iva),
    ingresos_brutos: safeStr(c?.ingresos_brutos),
    fecha_inicio_actividades: safeStr(c?.fecha_inicio_actividades || c?.inicio_actividades),
    activo: Number(c?.activo ?? 1) === 0 ? 0 : 1,
  };
}

function configFacturacionLabel(cfg) {
  const c = normalizeConfigFacturacionRow(cfg || {});
  const razon = safeStr(c.razon_social || c.nombre_fantasia) || "Cuenta fiscal";
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

function plusDaysISO(days = 10) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildInitialItem() {
  return {
    id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    descripcion: "",
    cantidad: "1",
    precio_unitario: "",
    bonif_pct: "0",
    subtotal: 0,
  };
}

export default function ModalFacturaBalto({
  open,
  onClose,
  apiBase,
  action = "movimientos",
  data,
  onFacturada,
  onDone,
  skipMovimientoAutocreacion = false,
}) {
  const [step, setStep] = useState(1);

  const [docTipo, setDocTipo] = useState(80);
  const [docNro, setDocNro] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [manualRazon, setManualRazon] = useState("");
  const [manualIva, setManualIva] = useState("Consumidor Final");
  const [manualDomicilio, setManualDomicilio] = useState("");

  const [clienteFact, setClienteFact] = useState(null);

  const [configsFacturacion, setConfigsFacturacion] = useState([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");

  const [formFactura, setFormFactura] = useState({
    fecha_cbte_iso: todayISO(),
    vto_pago_iso: plusDaysISO(10),
    cbte_tipo: 11,
    pto_vta: 2,
    items_facturacion: [buildInitialItem()],
    total_ars: 0,
    observaciones: "",
  });

  const firstRef = useRef(null);
  const apiRootResolved = useMemo(() => normalizeApiBase(apiBase), [apiBase]);

  const dataConfigInicial = useMemo(
    () => normalizeConfigFacturacionRow(data?.config_facturacion || data?.emisor || {}),
    [data]
  );

  const configSeleccionada = useMemo(() => {
    const byId = configsFacturacion.find((cfg) => String(configFacturacionId(cfg)) === String(selectedConfigId));
    if (byId) return normalizeConfigFacturacionRow(byId);
    if (configFacturacionId(dataConfigInicial)) return dataConfigInicial;
    if (configsFacturacion[0]) return normalizeConfigFacturacionRow(configsFacturacion[0]);
    return normalizeConfigFacturacionRow({});
  }, [configsFacturacion, selectedConfigId, dataConfigInicial]);

  const initialFacturaConCuenta = useMemo(() => ({
    ...formFactura,
    cbte_tipo: Number(configSeleccionada?.cbte_tipo || formFactura.cbte_tipo || 11),
    pto_vta: Number(configSeleccionada?.pto_vta || formFactura.pto_vta || 2),
  }), [formFactura, configSeleccionada]);

  const nombreCliente = useMemo(
    () => data?.labelCliente || data?.cliente || "",
    [data]
  );

  const nombreSistema = useMemo(
    () => data?.labelSistema || data?.sistema || "",
    [data]
  );

  const resetAll = useCallback(() => {
    const cf = data?.cliente_facturacion ?? null;
    const incomingItems = Array.isArray(data?.items_facturacion)
      ? data.items_facturacion
          .map((item, index) => ({
            id: item?.id || item?.codigo || `it_${index + 1}`,
            codigo: item?.codigo || String(index + 1),
            descripcion: safeStr(item?.descripcion ?? item?.detalle ?? item?.concepto),
            cantidad: Number(item?.cantidad || 0),
            precio_unitario: Number(item?.precio_unitario ?? item?.precio ?? 0),
            bonif_pct: Number(item?.bonif_pct || 0),
            subtotal: Number(item?.subtotal ?? item?.total ?? 0),
          }))
          .filter((item) => item.descripcion && item.cantidad > 0 && item.precio_unitario > 0)
      : [];
    const incomingTotal = Number(data?.total_ars ?? data?.monto ?? data?.importe ?? 0);

    setStep(1);
    setError("");
    setLoading(false);
    setResult(null);

    setClienteFact(cf || null);
    setConfigError("");
    setDocTipo(Number(cf?.doc_tipo || 80));
    setDocNro(onlyDigits(cf?.doc_nro || ""));

    setManualRazon(safeStr(cf?.razon_social));
    setManualIva(safeStr(cf?.cond_iva) || "Consumidor Final");
    setManualDomicilio(safeStr(cf?.domicilio));

    setFormFactura({
      fecha_cbte_iso: safeStr(data?.fecha_cbte_iso || data?.fecha)?.slice(0, 10) || todayISO(),
      vto_pago_iso: safeStr(data?.vto_pago_iso)?.slice(0, 10) || plusDaysISO(10),
      cbte_tipo: Number(data?.cbte_tipo || 11),
      pto_vta: Number(data?.pto_vta || 2),
      items_facturacion: incomingItems.length ? incomingItems : [buildInitialItem()],
      total_ars: Number.isFinite(incomingTotal) ? incomingTotal : 0,
      observaciones: safeStr(data?.observaciones),
    });
  }, [data]);

  useEffect(() => {
    if (!open) return;
    resetAll();
    setTimeout(() => firstRef.current?.focus?.(), 0);
  }, [open, resetAll]);

  useEffect(() => {
    if (!open || step !== 1) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

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

  useEffect(() => {
    if (!open) return;

    const idInicial = configFacturacionId(data?.config_facturacion || data?.emisor || {});
    if (idInicial > 0) setSelectedConfigId(String(idInicial));

    let cancelled = false;

    async function cargarCuentasFiscales() {
      setConfigLoading(true);
      setConfigError("");

      try {
        const url = buildApiUrl(apiRootResolved, { action: "config_facturacion_get" });
        const json = await fetchJSON(url, { method: "GET" });
        if (cancelled) return;

        const cfgDefault = normalizeConfigFacturacionRow(json?.config || json?.data?.config || {});
        const finalList = mergeConfigsFacturacion(
          extractConfigsFacturacionFromResponse(json),
          cfgDefault,
          dataConfigInicial
        );

        setConfigsFacturacion(finalList);

        const currentId = idInicial > 0
          ? idInicial
          : (configFacturacionId(cfgDefault) || configFacturacionId(finalList[0]));
        if (currentId > 0) setSelectedConfigId(String(currentId));
      } catch (e) {
        if (cancelled) return;
        setConfigError(humanizeFetchError(e) || "No se pudieron cargar las cuentas fiscales.");
        const fallback = configFacturacionId(dataConfigInicial) ? [dataConfigInicial] : [];
        setConfigsFacturacion(fallback);
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    }

    cargarCuentasFiscales();

    return () => {
      cancelled = true;
    };
  }, [open, apiRootResolved, fetchJSON, data, dataConfigInicial]);

  useEffect(() => {
    if (!open) return;
    if (!configFacturacionId(configSeleccionada)) return;

    setFormFactura((prev) => ({
      ...prev,
      cbte_tipo: Number(configSeleccionada?.cbte_tipo || prev.cbte_tipo || 11),
      pto_vta: Number(configSeleccionada?.pto_vta || prev.pto_vta || 2),
    }));
  }, [open, selectedConfigId, configSeleccionada]);

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
        // Padrón A5 consulta siempre con la cuenta principal del tenant.
        // La cuenta fiscal seleccionada se usa recién para emitir la factura.
      });

      const j = await fetchJSON(url, { method: "GET" });
      const responseData = j?.data ?? j;
      const summary = responseData?.summary ?? null;

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

    if (!safeStr(configSeleccionada?.cuit)) {
      setError("Seleccioná una cuenta fiscal emisora antes de continuar.");
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

    setClienteFact(payload);
    setDocTipo(payload.doc_tipo);
    setDocNro(payload.doc_nro);
    setStep(2);
  }, [
    docNro,
    docTipo,
    result,
    validar,
    validarManualDni,
    manualRazon,
    manualIva,
    manualDomicilio,
    configSeleccionada,
  ]);
  const handleGuardarDatosFactura = useCallback((payload) => {
    setFormFactura({
      fecha_cbte_iso: payload?.fecha_cbte_iso || todayISO(),
      vto_pago_iso: payload?.vto_pago_iso || plusDaysISO(10),
      cbte_tipo: Number(payload?.cbte_tipo || 11),
      pto_vta: Number(payload?.pto_vta || 2),
      items_facturacion: Array.isArray(payload?.items_facturacion)
        ? payload.items_facturacion
        : [buildInitialItem()],
      total_ars: Number(payload?.total_ars || 0),
      observaciones: safeStr(payload?.observaciones),
    });
    setStep(3);
  }, []);

  if (!open) return null;

  // ── Step 2: Datos de la factura ──────────────────────────────────────────
  if (step === 2) {
    return (
      <ModalFacturaDatos
        open={true}
        onClose={onClose}
        onBack={() => setStep(1)}
        data={data}
        clienteFact={clienteFact}
        docTipo={docTipo}
        docNro={docNro}
        initialData={initialFacturaConCuenta}
        nombreCliente={nombreCliente}
        nombreSistema={nombreSistema}
        onNext={handleGuardarDatosFactura}
      />
    );
  }

  // ── Step 3: Resumen y emisión ─────────────────────────────────────────────
  if (step === 3) {
    return (
      <ModalFacturaBaltoResumen
        open={true}
        onClose={() => setStep(2)}
        onBack={() => setStep(2)}
        onCloseAll={onClose}
        apiBase={apiBase}
        action={action}
        data={{
          ...data,
          cliente_facturacion: clienteFact,
          labelCliente: nombreCliente,
          labelSistema: nombreSistema,
          fecha_cbte_iso: formFactura.fecha_cbte_iso,
          vto_pago_iso: formFactura.vto_pago_iso,
          cbte_tipo: Number(configSeleccionada?.cbte_tipo || formFactura.cbte_tipo || 11),
          pto_vta: Number(configSeleccionada?.pto_vta || formFactura.pto_vta || 2),
          id_config_facturacion: configFacturacionId(configSeleccionada) || null,
          idConfigFacturacion: configFacturacionId(configSeleccionada) || null,
          cuit_emisor: configSeleccionada?.cuit || null,
          config_facturacion: configSeleccionada || null,
          emisor: configSeleccionada || null,
          items_facturacion: formFactura.items_facturacion,
          total_ars: formFactura.total_ars,
          monto: formFactura.total_ars,
          importe: formFactura.total_ars,
          observaciones: formFactura.observaciones,
        }}
        docTipo={docTipo}
        docNro={docNro}
        cbteTipo={Number(configSeleccionada?.cbte_tipo || formFactura.cbte_tipo || 11)}
        ptoVta={String(configSeleccionada?.pto_vta || formFactura.pto_vta || 2)}
        configsFacturacionInicial={configsFacturacion}
        onFacturada={
          typeof onFacturada === "function"
            ? async (fact) =>
                await onFacturada({
                  ...fact,
                  cliente_facturacion: fact?.cliente_facturacion || clienteFact || null,
                  config_facturacion:
                    fact?.config_facturacion || configSeleccionada || null,
                  resumen_facturacion: {
                    ...(data || {}),
                    cliente_facturacion: clienteFact || null,
                    labelCliente: nombreCliente,
                    labelSistema: nombreSistema,
                    fecha_cbte_iso: formFactura.fecha_cbte_iso,
                    vto_pago_iso: formFactura.vto_pago_iso,
                    cbte_tipo: Number(
                      configSeleccionada?.cbte_tipo || formFactura.cbte_tipo || 11
                    ),
                    pto_vta: Number(
                      configSeleccionada?.pto_vta || formFactura.pto_vta || 2
                    ),
                    id_config_facturacion:
                      configFacturacionId(configSeleccionada) || null,
                    config_facturacion: configSeleccionada || null,
                    items_facturacion: formFactura.items_facturacion,
                    total_ars: formFactura.total_ars,
                    monto: formFactura.total_ars,
                    importe: formFactura.total_ars,
                    observaciones: formFactura.observaciones,
                  },
                })
            : undefined
        }
        onDone={
          typeof onDone === "function"
            ? async (fact) =>
                await onDone({
                  ...fact,
                  cliente_facturacion: fact?.cliente_facturacion || clienteFact || null,
                  config_facturacion:
                    fact?.config_facturacion || configSeleccionada || null,
                  resumen_facturacion: {
                    ...(data || {}),
                    cliente_facturacion: clienteFact || null,
                    labelCliente: nombreCliente,
                    labelSistema: nombreSistema,
                    fecha_cbte_iso: formFactura.fecha_cbte_iso,
                    vto_pago_iso: formFactura.vto_pago_iso,
                    cbte_tipo: Number(
                      configSeleccionada?.cbte_tipo || formFactura.cbte_tipo || 11
                    ),
                    pto_vta: Number(
                      configSeleccionada?.pto_vta || formFactura.pto_vta || 2
                    ),
                    id_config_facturacion:
                      configFacturacionId(configSeleccionada) || null,
                    config_facturacion: configSeleccionada || null,
                    items_facturacion: formFactura.items_facturacion,
                    total_ars: formFactura.total_ars,
                    monto: formFactura.total_ars,
                    importe: formFactura.total_ars,
                    observaciones: formFactura.observaciones,
                  },
                })
            : undefined
        }
        forceTestAmount={false}
        testAmount={null}
        skipMovimientoAutocreacion={skipMovimientoAutocreacion}
      />
    );
  }

  // ── Step 1: Búsqueda / carga de cliente ───────────────────────────────────
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
              Paso 1 de 3. Si usás CUIT consulta ARCA. Si usás DNI, completás los datos manualmente.
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
              <h3 className="mi-card__title">Cuenta fiscal emisora</h3>

              <div className="fl-grid">
                <div className="fl-field fl-col-full">
                  <select
                    className="fl-input fl-select"
                    value={selectedConfigId}
                    onChange={(e) => {
                      setSelectedConfigId(e.target.value);
                      setError("");
                      setResult(null);
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
                  <label className="fl-label">Facturar desde *</label>
                </div>
              </div>

              {configLoading && (
                <div className="arca-mini" style={{ marginTop: 10 }}>
                  Cargando cuentas fiscales...
                </div>
              )}

              {configError && (
                <div className="arca-alert arca-alert--error" style={{ marginTop: 10 }} role="alert">
                  {configError}
                </div>
              )}
            </article>

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
                    Con <b>DNI</b> la factura se completa a mano. Estos datos se usarán después en la factura.
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
                    <strong>Datos encontrados</strong>
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
              disabled={loading || !onlyDigits(docNro) || !safeStr(configSeleccionada?.cuit)}
            >
              Usar estos datos <FaCheck style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
