import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBolt,
  faBuilding,
  faFileInvoiceDollar,
  faFloppyDisk,
  faIdCard,
  faReceipt,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../../Global/Toast";
import { apiFetch, safeJsonParse } from "../api/configuracionApi";
import "./ConfiguracionDatosLegales.css";


const emptyForm = {
  idConfigFacturacion: 0,
  razon_social: "",
  nombre_fantasia: "",
  cuit: "",
  ingresos_brutos: "",
  condicion_iva: "RESPONSABLE MONOTRIBUTO",
  domicilio_comercial: "",
  fecha_inicio_actividades: "",
  punto_venta: "00001",
  tipo_comprobante_default: "FACTURA C",
  codigo_comprobante: "011",
  activo: 1,
};

const condicionesIva = [
  "RESPONSABLE MONOTRIBUTO",
  "RESPONSABLE INSCRIPTO",
  "IVA EXENTO",
  "CONSUMIDOR FINAL",
  "NO RESPONSABLE",
];

const comprobantes = [
  { tipo: "FACTURA A", codigo: "001" },
  { tipo: "FACTURA B", codigo: "006" },
  { tipo: "FACTURA C", codigo: "011" },
  { tipo: "RECIBO A", codigo: "004" },
  { tipo: "RECIBO B", codigo: "009" },
  { tipo: "RECIBO C", codigo: "015" },
];

function toMayus(value) {
  return String(value || "").toLocaleUpperCase("es-AR");
}

function limpiarTexto(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function limpiarTextoMayus(value) {
  return toMayus(limpiarTexto(value));
}

function normalizarCuit(value) {
  return String(value || "")
    .replace(/[^0-9-]/g, "")
    .slice(0, 20);
}

function normalizarPuntoVenta(value) {
  const soloNumeros = String(value || "").replace(/\D/g, "").slice(0, 5);
  if (!soloNumeros) return "";
  return soloNumeros.padStart(5, "0");
}

function normalizarCodigoComprobante(value) {
  const soloNumeros = String(value || "").replace(/\D/g, "").slice(0, 3);
  if (!soloNumeros) return "";
  return soloNumeros.padStart(3, "0");
}

function normalizarConfigDesdeApi(config = {}) {
  return {
    ...emptyForm,
    ...config,
    razon_social: limpiarTextoMayus(config.razon_social || ""),
    nombre_fantasia: limpiarTextoMayus(config.nombre_fantasia || ""),
    cuit: normalizarCuit(config.cuit || ""),
    ingresos_brutos: limpiarTextoMayus(config.ingresos_brutos || ""),
    condicion_iva: limpiarTextoMayus(
      config.condicion_iva || emptyForm.condicion_iva
    ),
    domicilio_comercial: limpiarTextoMayus(config.domicilio_comercial || ""),
    fecha_inicio_actividades: config.fecha_inicio_actividades || "",
    punto_venta: normalizarPuntoVenta(config.punto_venta || "00001") || "00001",
    tipo_comprobante_default: limpiarTextoMayus(
      config.tipo_comprobante_default || "FACTURA C"
    ),
    codigo_comprobante:
      normalizarCodigoComprobante(config.codigo_comprobante || "011") || "011",
    activo: Number(config.activo) === 0 ? 0 : 1,
  };
}

function normalizarConfigParaComparar(config = {}) {
  const normalizada = normalizarConfigDesdeApi(config);

  return {
    idConfigFacturacion: Number(normalizada.idConfigFacturacion || 0),
    razon_social: normalizada.razon_social,
    nombre_fantasia: normalizada.nombre_fantasia,
    cuit: normalizada.cuit,
    ingresos_brutos: normalizada.ingresos_brutos,
    condicion_iva: normalizada.condicion_iva,
    domicilio_comercial: normalizada.domicilio_comercial,
    fecha_inicio_actividades: normalizada.fecha_inicio_actividades || "",
    punto_venta: normalizada.punto_venta,
    tipo_comprobante_default: normalizada.tipo_comprobante_default,
    codigo_comprobante: normalizada.codigo_comprobante,
    activo: Number(normalizada.activo) === 0 ? 0 : 1,
  };
}

export default function ConfiguracionDatosLegales() {
  const navigate = useNavigate();
  const fechaInputRef = useRef(null);

  const [configs, setConfigs] = useState([]);
  const [selectedConfigId, setSelectedConfigId] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [formInicial, setFormInicial] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const mostrarToast = useCallback((tipo, mensaje, duracion = 3000) => {
    setToast({ tipo, mensaje, duracion, key: Date.now() });
  }, []);

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const abrirCalendarioFecha = useCallback(() => {
    const input = fechaInputRef.current;
    if (!input || saving) return;

    input.focus();

    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // Algunos navegadores pueden bloquear showPicker si no viene directo del click.
      }
    }
  }, [saving]);

  const cargar = useCallback(async () => {
    setLoading(true);

    try {
      const res = await apiFetch({ action: "config_facturacion_get" });
      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(
          data?.mensaje || "No se pudieron cargar los datos legales."
        );
      }

      const configsNormalizadas = Array.isArray(data.configs)
        ? data.configs.map((cfg) => normalizarConfigDesdeApi(cfg))
        : [];

      const configNormalizada = normalizarConfigDesdeApi(
        data.config || configsNormalizadas[0] || {}
      );

      const listado = configsNormalizadas.length
        ? configsNormalizadas
        : configNormalizada.idConfigFacturacion
          ? [configNormalizada]
          : [];

      setConfigs(listado);
      setSelectedConfigId(Number(configNormalizada.idConfigFacturacion || 0));
      setForm(configNormalizada);
      setFormInicial(configNormalizada);
    } catch (err) {
      console.error("Error cargando datos legales:", err);
      mostrarToast(
        "error",
        err?.message || "Error cargando datos legales.",
        4200
      );
    } finally {
      setLoading(false);
    }
  }, [mostrarToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const resumen = useMemo(() => {
    const razon = limpiarTexto(form.razon_social) || "SIN RAZÓN SOCIAL";
    const fantasia = limpiarTexto(form.nombre_fantasia) || "SIN NOMBRE FANTASÍA";
    const cuit = limpiarTexto(form.cuit) || "CUIT SIN CARGAR";

    return { razon, fantasia, cuit };
  }, [form]);

  const hasChanges = useMemo(() => {
    return (
      JSON.stringify(normalizarConfigParaComparar(form)) !==
      JSON.stringify(normalizarConfigParaComparar(formInicial))
    );
  }, [form, formInicial]);

  const guardar = async (e) => {
    e.preventDefault();
    if (saving || !hasChanges) return;

    const payload = {
      ...form,
      idConfigFacturacion: Number(form.idConfigFacturacion || selectedConfigId || 0),
      razon_social: limpiarTextoMayus(form.razon_social),
      nombre_fantasia: limpiarTextoMayus(form.nombre_fantasia),
      cuit: limpiarTexto(form.cuit),
      ingresos_brutos: limpiarTextoMayus(form.ingresos_brutos),
      condicion_iva: limpiarTextoMayus(form.condicion_iva),
      domicilio_comercial: limpiarTextoMayus(form.domicilio_comercial),
      fecha_inicio_actividades: form.fecha_inicio_actividades || "",
      punto_venta: normalizarPuntoVenta(form.punto_venta) || "00001",
      tipo_comprobante_default:
        limpiarTextoMayus(form.tipo_comprobante_default) || "FACTURA C",
      codigo_comprobante:
        normalizarCodigoComprobante(form.codigo_comprobante) || "011",
      activo: 1,
    };

    if (!payload.razon_social) {
      mostrarToast("advertencia", "Ingresá la razón social.");
      return;
    }

    if (!payload.cuit) {
      mostrarToast("advertencia", "Ingresá el CUIT.");
      return;
    }

    if (!payload.condicion_iva) {
      mostrarToast("advertencia", "Seleccioná la condición frente al IVA.");
      return;
    }

    if (!payload.domicilio_comercial) {
      mostrarToast("advertencia", "Ingresá el domicilio comercial.");
      return;
    }

    setSaving(true);

    try {
      const res = await apiFetch(
        { action: "config_facturacion_guardar" },
        { method: "POST", body: JSON.stringify(payload) }
      );

      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(
          data?.mensaje || "No se pudieron guardar los datos legales."
        );
      }

      const configGuardada = normalizarConfigDesdeApi(data.config || payload);
      const configsActualizadas = Array.isArray(data.configs)
        ? data.configs.map((cfg) => normalizarConfigDesdeApi(cfg))
        : [];

      setForm(configGuardada);
      setFormInicial(configGuardada);
      setSelectedConfigId(Number(configGuardada.idConfigFacturacion || 0));
      setConfigs((prev) => {
        if (configsActualizadas.length) return configsActualizadas;

        const idGuardado = Number(configGuardada.idConfigFacturacion || 0);
        const existe = prev.some(
          (cfg) => Number(cfg.idConfigFacturacion || 0) === idGuardado
        );

        if (existe) {
          return prev.map((cfg) =>
            Number(cfg.idConfigFacturacion || 0) === idGuardado
              ? configGuardada
              : cfg
          );
        }

        return idGuardado ? [...prev, configGuardada] : prev;
      });
      mostrarToast(
        "exito",
        data?.mensaje || "Datos legales guardados correctamente."
      );
    } catch (err) {
      console.error("Error guardando datos legales:", err);
      mostrarToast(
        "error",
        err?.message || "Error guardando datos legales.",
        4400
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTipoComprobante = (tipo) => {
    const tipoMayus = limpiarTextoMayus(tipo);
    const encontrado = comprobantes.find((c) => c.tipo === tipoMayus);

    setForm((prev) => ({
      ...prev,
      tipo_comprobante_default: tipoMayus,
      codigo_comprobante: encontrado?.codigo || prev.codigo_comprobante,
    }));
  };

  const seleccionarConfig = useCallback(
    (config) => {
      if (saving || loading) return;

      const configNormalizada = normalizarConfigDesdeApi(config || {});
      const id = Number(configNormalizada.idConfigFacturacion || 0);
      if (!id || id === Number(selectedConfigId || 0)) return;

      if (
        hasChanges &&
        typeof window !== "undefined" &&
        !window.confirm(
          "Tenés cambios sin guardar en esta cuenta. Si cambiás de pestaña se van a descartar. ¿Querés continuar?"
        )
      ) {
        return;
      }

      setSelectedConfigId(id);
      setForm(configNormalizada);
      setFormInicial(configNormalizada);
    },
    [hasChanges, loading, saving, selectedConfigId]
  );

  const cuentasFacturacionLabel = useMemo(() => {
    const total = configs.length;
    if (total <= 1) return "Cuenta de facturación";
    return `${total} cuentas de facturación`;
  }, [configs.length]);

  return (
    <section className="cfg-legal-page">
      {toast && (
        <Toast
          key={toast.key}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <div className="cfg-legal-hero">
        <div className="cfg-users-hero__icon">
          <FontAwesomeIcon icon={faFileInvoiceDollar} />
        </div>

        <div className="cfg-legal-hero__content">
          <div className="cfg-legal-hero__eyebrow">CONFIGURACIÓN GLOBAL</div>
          <h1 className="cfg-legal-title">Datos legales</h1>
          <p className="cfg-legal-subtitle">
            Editá la información fiscal usada para comprobantes y configuración
            de facturación.
          </p>
        </div>

        <div className="cfg-legal-hero__side">
          <button
            className="cfg-legal-btn cfg-legal-btn--primary"
            type="button"
            onClick={() => navigate("/panel/configuracion")}
            disabled={saving}
          >
            <FontAwesomeIcon icon={faArrowLeft} />
            Volver
          </button>
        </div>
      </div>

      <div className="cfg-legal-contentScroll">
        <div className="cfg-legal-grid">
        <aside className="cfg-legal-summary">
          <div className="cfg-legal-summary__icon">
            <FontAwesomeIcon icon={faBuilding} />
          </div>

          <span className="cfg-legal-summary__kicker">Vista previa fiscal</span>
          <h2>{resumen.razon}</h2>
          <p>{resumen.fantasia}</p>

          <div className="cfg-legal-summary__line">
            <span>CUIT</span>
            <strong>{resumen.cuit}</strong>
          </div>

          <div className="cfg-legal-summary__line">
            <span>Condición IVA</span>
            <strong>{form.condicion_iva || "—"}</strong>
          </div>

          <div className="cfg-legal-summary__line">
            <span>Punto de venta</span>
            <strong>{form.punto_venta || "00001"}</strong>
          </div>

          {configs.length > 1 && (
            <div className="cfg-legal-summary__line">
              <span>Cuenta seleccionada</span>
              <strong>#{form.idConfigFacturacion || selectedConfigId || "—"}</strong>
            </div>
          )}
        </aside>

        <div className="cfg-legal-card">
          <div className="cfg-legal-card__top">
            <div className="cfg-legal-card__icon">
              <FontAwesomeIcon icon={faIdCard} />
            </div>
            <div>
              <h2>Información fiscal</h2>
              <p>
                {configs.length > 1
                  ? "Seleccioná una cuenta y editá sus datos legales sin pisar la otra."
                  : "Estos datos se guardan en la tabla config_facturacion del tenant actual."}
              </p>
            </div>
          </div>

          {!loading && configs.length > 1 && (
            <div className="cfg-legal-tabsWrap" aria-label="Cuentas de facturación">
              <div className="cfg-legal-tabsHeader">
                <span>{cuentasFacturacionLabel}</span>
                <strong>Editá una cuenta por vez</strong>
              </div>

              <div className="cfg-legal-tabs" role="tablist">
                {configs.map((cfg, index) => {
                  const id = Number(cfg.idConfigFacturacion || 0);
                  const active = id === Number(selectedConfigId || 0);
                  const label =
                    limpiarTexto(cfg.nombre_fantasia) ||
                    limpiarTexto(cfg.razon_social) ||
                    `CUENTA ${index + 1}`;
                  const cuit = limpiarTexto(cfg.cuit) || "CUIT SIN CARGAR";

                  return (
                    <button
                      key={id || `cfg-${index}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`cfg-legal-tab ${active ? "is-active" : ""}`}
                      onClick={() => seleccionarConfig(cfg)}
                      disabled={saving}
                      title={`${label} - ${cuit}`}
                      aria-label={`Seleccionar ${label}. ${cuit}${active ? ", cuenta activa" : ""}`}
                    >
                      <div className="cfg-legal-tab__top">
                        
                      <div className="cfg-legal-tab__main">
                        <span className="cfg-legal-tab__icon" aria-hidden="true">
                          <FontAwesomeIcon icon={faFileInvoiceDollar} />
                        </span>

                        <span className="cfg-legal-tab__text">
                          <span>{label}</span>
                          <small>{cuit}</small>
                        </span>
                      </div>
                        {active && (
                          <strong className="cfg-legal-tab__badge">Activa</strong>
                        )}
                      </div>

                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <>
              <div className="cfg-legal-empty">Cargando datos legales...</div>
              <div className="cfg-legal-saveCard">
                <div className="cfg-legal-saveCard__top">
                  <div className="cfg-legal-saveCard__icon">
                    <FontAwesomeIcon icon={faBolt} />
                  </div>
                  <div className="cfg-legal-saveCard__head">
                    <h2>Guardar configuración</h2>
                    <p>Aplicá los cambios a todas las vistas del sistema.</p>
                  </div>
                </div>

                <div className="cfg-legal-saveCard__body">
                  <div className="cfg-legal-actions">
                    <span className="cfg-legal-saveHint">No hay cambios pendientes.</span>
                    <button
                      type="button"
                      className="cfg-legal-btn cfg-legal-btn--save"
                      disabled
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} />
                      Guardar configuración
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <form className="cfg-legal-form" onSubmit={guardar} noValidate>
              <div className="cfg-legal-section-title">
                <FontAwesomeIcon icon={faBuilding} />
                Datos principales
              </div>

              <div className="cfg-legal-form-grid">
                <label className="cfg-legal-floatingField cfg-legal-floatingField--full is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.razon_social || ""}
                    onChange={(e) =>
                      setField("razon_social", toMayus(e.target.value))
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Razón social *</span>
                </label>

                <label className="cfg-legal-floatingField cfg-legal-floatingField--full is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.nombre_fantasia || ""}
                    onChange={(e) =>
                      setField("nombre_fantasia", toMayus(e.target.value))
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Nombre fantasía</span>
                </label>

                <label className="cfg-legal-floatingField is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.cuit || ""}
                    onChange={(e) =>
                      setField("cuit", normalizarCuit(e.target.value))
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>CUIT *</span>
                </label>

                <label className="cfg-legal-floatingField is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.ingresos_brutos || ""}
                    onChange={(e) =>
                      setField("ingresos_brutos", toMayus(e.target.value))
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Ingresos brutos</span>
                </label>

                <label className="cfg-legal-floatingField cfg-legal-floatingField--select is-active">
                  <select
                    className="cfg-legal-control cfg-legal-control--floating"
                    value={form.condicion_iva || ""}
                    onChange={(e) =>
                      setField("condicion_iva", toMayus(e.target.value))
                    }
                    disabled={saving}
                  >
                    {condicionesIva.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span>Condición frente al IVA *</span>
                </label>

                <label
                  className="cfg-legal-floatingField cfg-legal-floatingField--date is-active"
                  onClick={abrirCalendarioFecha}
                >
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    ref={fechaInputRef}
                    type="date"
                    value={form.fecha_inicio_actividades || ""}
                    onClick={abrirCalendarioFecha}
                    onFocus={abrirCalendarioFecha}
                    onChange={(e) =>
                      setField("fecha_inicio_actividades", e.target.value)
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Inicio de actividades</span>
                </label>

                <label className="cfg-legal-floatingField cfg-legal-floatingField--full is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.domicilio_comercial || ""}
                    onChange={(e) =>
                      setField("domicilio_comercial", toMayus(e.target.value))
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Domicilio comercial *</span>
                </label>
              </div>

              <div className="cfg-legal-section-title cfg-legal-section-title--spaced">
                <FontAwesomeIcon icon={faReceipt} />
                Comprobante por defecto
              </div>

              <div className="cfg-legal-form-grid">
                <label className="cfg-legal-floatingField is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.punto_venta || ""}
                    onChange={(e) =>
                      setField(
                        "punto_venta",
                        e.target.value.replace(/\D/g, "").slice(0, 5)
                      )
                    }
                    onBlur={() =>
                      setField(
                        "punto_venta",
                        normalizarPuntoVenta(form.punto_venta) || "00001"
                      )
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Punto de venta</span>
                </label>

                <label className="cfg-legal-floatingField cfg-legal-floatingField--select is-active">
                  <select
                    className="cfg-legal-control cfg-legal-control--floating"
                    value={form.tipo_comprobante_default || "FACTURA C"}
                    onChange={(e) => handleTipoComprobante(e.target.value)}
                    disabled={saving}
                  >
                    {comprobantes.map((c) => (
                      <option key={c.tipo} value={c.tipo}>
                        {c.tipo}
                      </option>
                    ))}
                  </select>
                  <span>Tipo de comprobante</span>
                </label>

                <label className="cfg-legal-floatingField is-active">
                  <input
                    className="cfg-legal-control cfg-legal-control--floating"
                    type="text"
                    value={form.codigo_comprobante || ""}
                    onChange={(e) =>
                      setField(
                        "codigo_comprobante",
                        e.target.value.replace(/\D/g, "").slice(0, 3)
                      )
                    }
                    onBlur={() =>
                      setField(
                        "codigo_comprobante",
                        normalizarCodigoComprobante(form.codigo_comprobante) ||
                          "011"
                      )
                    }
                    placeholder=" "
                    disabled={saving}
                  />
                  <span>Código comprobante</span>
                </label>
              </div>

              <div className="cfg-legal-saveCard">
                <div className="cfg-legal-saveCard__top">
                  <div className="cfg-legal-saveCard__icon">
                    <FontAwesomeIcon icon={faBolt} />
                  </div>
                  <div className="cfg-legal-saveCard__head">
                    <h2>Guardar configuración</h2>
                    <p>Aplicá los cambios a todas las vistas del sistema.</p>
                  </div>
                </div>

                <div className="cfg-legal-saveCard__body">
                  <div className="cfg-legal-actions">
                    <span className={`cfg-legal-saveHint ${hasChanges ? "is-pending" : ""}`}>
                      {hasChanges
                        ? "Hay cambios pendientes por guardar."
                        : "No hay cambios pendientes."}
                    </span>

                    <button
                      type="submit"
                      className="cfg-legal-btn cfg-legal-btn--save"
                      disabled={saving || !hasChanges}
                    >
                      <FontAwesomeIcon icon={faFloppyDisk} />
                      {saving ? "Guardando..." : "Guardar configuración"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}
