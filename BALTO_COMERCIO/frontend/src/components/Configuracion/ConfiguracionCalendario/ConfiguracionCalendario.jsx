// src/components/Configuracion/ConfiguracionCalendario/ConfiguracionCalendario.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDateRange } from "../../../context/DateRangeContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDays,
  faArrowLeft,
  faCheck,
  faSpinner,
  faCalendarWeek,
  faCircleInfo,
  faBolt,
  faFloppyDisk,
  faShieldHalved,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import Toast from "../../Global/Toast";
import { apiFetchJson as apiFetch } from "../api/configuracionApi";
import "./configuracion_calendario.css";

// ─── helpers ─────────────────────────────────────────────────────────────────

function getTenantId() {
  try {
    const u = JSON.parse(localStorage.getItem("usuario") || "null") || {};
    return (
      u?.idTenant ||
      u?.id_tenant ||
      u?.tenant_id ||
      u?.tenant?.idTenant ||
      ""
    );
  } catch {
    return "";
  }
}

function normalizeDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMaxDiasAtrasDelMesActual(date = new Date()) {
  const hoy = normalizeDay(date);
  return Math.max(0, hoy.getDate() - 1);
}

function clampDiasToMonth(value, maxDias = getMaxDiasAtrasDelMesActual()) {
  const n = Number(value);
  if (Number.isNaN(n)) return Math.min(10, maxDias);
  return Math.max(0, Math.min(Math.trunc(n), maxDias));
}

function getDefaultDiasInput(value, maxDias = getMaxDiasAtrasDelMesActual()) {
  return String(clampDiasToMonth(value ?? 10, maxDias));
}

function getDiasAtrasRangeWithinMonth(value) {
  const to = normalizeDay(new Date());
  const dias = clampDiasToMonth(value, getMaxDiasAtrasDelMesActual(to));
  const from = new Date(to);
  from.setDate(from.getDate() - dias);
  return { from, to, dias };
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(
    d.getMonth() + 1
  ).padStart(2, "0")}/${d.getFullYear()}`;
}

// ─── constantes de modo ───────────────────────────────────────────────────────

const MODOS = [
  {
    value: "mes_completo",
    label: "Mes completo",
    description: "Desde el primer día del mes hasta el último.",
    icon: faCalendarDays,
  },
  {
    value: "dias_atras",
    label: "Últimos N días",
    description: "Días hacia atrás dentro del mes actual, sin cruzar al anterior.",
    icon: faCalendarWeek,
  },
];

// ─── sub-componentes ──────────────────────────────────────────────────────────

function ItemDato({ label, value, full = false }) {
  return (
    <div className={`cal-metaItem ${full ? "cal-metaItem--full" : ""}`}>
      <span className="cal-metaItem__label">{label}</span>
      <span className="cal-metaItem__value">{value || "-"}</span>
    </div>
  );
}

function ModoPreviewBadge({ modo }) {
  const labels = {
    mes_completo: "Mes completo",
    dias_atras: "Últimos N días",
  };
  return (
    <span className={`cal-badge cal-badge--info`}>
      {labels[modo] || modo}
    </span>
  );
}

function DiaPreview({ dias }) {
  const { from, to } = getDiasAtrasRangeWithinMonth(dias);
  return (
    <div className="cal-preview">
      <span className="cal-preview__label">Vista previa del rango</span>
      <span className="cal-preview__range">
        {formatDate(from)}
        <span className="cal-preview__arrow">→</span>
        {formatDate(to)}
      </span>
    </div>
  );
}

function MesCompletoPreview() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return (
    <div className="cal-preview">
      <span className="cal-preview__label">Vista previa del rango</span>
      <span className="cal-preview__range">
        {formatDate(from)}
        <span className="cal-preview__arrow">→</span>
        {formatDate(to)}
      </span>
    </div>
  );
}

// ─── componente principal ─────────────────────────────────────────────────────

export default function ConfiguracionCalendario() {
  const navigate = useNavigate();
  const { calendarConfig, applyCalendarConfig } = useDateRange();
  const tenantId = getTenantId();

  const maxDiasAtrasPermitidos = useMemo(
    () => getMaxDiasAtrasDelMesActual(),
    []
  );

  const [modo, setModo] = useState(calendarConfig?.modo ?? "mes_completo");
  const [diasAtrasInput, setDiasAtrasInput] = useState(
    getDefaultDiasInput(calendarConfig?.dias_atras, maxDiasAtrasPermitidos)
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const diasAtrasNormalizado = useMemo(() => {
    const raw = String(diasAtrasInput ?? "").trim();
    if (raw === "") return Math.min(10, maxDiasAtrasPermitidos);
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return Math.min(10, maxDiasAtrasPermitidos);
    return clampDiasToMonth(n, maxDiasAtrasPermitidos);
  }, [diasAtrasInput, maxDiasAtrasPermitidos]);

  useEffect(() => {
    setModo(calendarConfig?.modo ?? "mes_completo");
    setDiasAtrasInput(
      getDefaultDiasInput(calendarConfig?.dias_atras, maxDiasAtrasPermitidos)
    );
  }, [calendarConfig, maxDiasAtrasPermitidos]);

  const hasChanges = useMemo(() => {
    const modoActual = calendarConfig?.modo ?? "mes_completo";
    const diasActuales = clampDiasToMonth(
      calendarConfig?.dias_atras ?? 10,
      maxDiasAtrasPermitidos
    );
    if (modo !== modoActual) return true;
    if (modo === "dias_atras" && diasAtrasNormalizado !== diasActuales) return true;
    return false;
  }, [modo, diasAtrasNormalizado, calendarConfig, maxDiasAtrasPermitidos]);

  const showToast = useCallback((tipo, mensaje, duracion = 2500) => {
    setToast({ id: Date.now(), tipo, mensaje, duracion });
  }, []);

  useEffect(() => {
    if (!tenantId) {
      showToast("error", "No se detectó el idTenant en la sesión del usuario.", 4200);
    }
  }, [tenantId, showToast]);

  const handleSave = useCallback(async () => {
    if (!tenantId) {
      showToast("error", "No se encontró el tenant. Volvé a iniciar sesión.", 4200);
      return;
    }
    const diasNum = diasAtrasNormalizado;
    const cfg = { modo, dias_atras: diasNum };
    setSaving(true);
    setToast(null);
    try {
      const data = await apiFetch(
        { action: "configuracion_calendario_set", idTenant: tenantId },
        { method: "POST", body: JSON.stringify(cfg) }
      );
      if (!data?.exito) throw new Error(data?.mensaje || "No se pudo guardar.");
      applyCalendarConfig(cfg);
      setDiasAtrasInput(String(diasNum));
      showToast("exito", "Configuración guardada correctamente.");
    } catch (e) {
      showToast("error", e.message || "Error guardando la configuración.", 4200);
    } finally {
      setSaving(false);
    }
  }, [modo, diasAtrasNormalizado, applyCalendarConfig, showToast, tenantId]);

  const handleDiasChange = useCallback(
    (e) => {
      const raw = e.target.value;
      if (!/^\d*$/.test(raw)) return;
      setToast(null);
      if (raw === "") { setDiasAtrasInput(""); return; }
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) return;
      if (n > maxDiasAtrasPermitidos) return;
      setDiasAtrasInput(String(n));
    },
    [maxDiasAtrasPermitidos]
  );

  const handleDiasBlur = useCallback(() => {
    setDiasAtrasInput(String(diasAtrasNormalizado));
  }, [diasAtrasNormalizado]);

  const handleModoChange = useCallback(
    (nuevoModo) => {
      setModo(nuevoModo);
      setToast(null);
      if (nuevoModo === "dias_atras") {
        const raw = String(diasAtrasInput ?? "").trim();
        if (raw === "") {
          setDiasAtrasInput(String(Math.min(10, maxDiasAtrasPermitidos)));
          return;
        }
        setDiasAtrasInput(String(clampDiasToMonth(raw, maxDiasAtrasPermitidos)));
      }
    },
    [diasAtrasInput, maxDiasAtrasPermitidos]
  );

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <>
      {toast && (
        <Toast
          key={toast.id}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <section className="cal-page">
        <div className="cal-topbar" />

        {/* HERO */}
        <div className="cal-hero">
          <div className="cal-hero__icon">
            <FontAwesomeIcon icon={faCalendarDays} />
          </div>

          <div className="cal-hero__content">
            <div className="cal-hero__eyebrow">Configuración global</div>
            <h1 className="cal-title">Calendario global</h1>
            <p className="cal-subtitle">
              Elegí cómo se carga el rango de fechas por defecto en todas las
              vistas de la aplicación.
            </p>
          </div>

          <div className="cal-hero__side">
            <button
              type="button"
              className="mov-btn mov-btn--primary"
              onClick={() => navigate("/panel/configuracion")}
            >
              <FontAwesomeIcon icon={faArrowLeft} />
              <span>Volver</span>
            </button>
          </div>
        </div>

        <div className="cal-contentScroll">
        {/* GRID */}
        <div className="cal-metaGrid">

          {/* Tarjeta 1 — Estado actual */}
          <div className="cal-metaCard">
            <div className="cal-metaCard__top">
              <div className="cal-metaCard__icon">
                <FontAwesomeIcon icon={faCircleInfo} />
              </div>
              <div className="cal-metaCard__head">
                <h2>Estado actual</h2>
                <p>Configuración aplicada en este momento.</p>
              </div>
            </div>

            <div className="cal-metaCard__body">
              <ItemDato label="Tenant" value={tenantId || "-"} />
              <ItemDato
                label="Modo activo"
                value={<ModoPreviewBadge modo={calendarConfig?.modo ?? "mes_completo"} />}
              />
              {(calendarConfig?.modo ?? "mes_completo") === "dias_atras" && (
                <ItemDato
                  label="Días configurados"
                  value={`${clampDiasToMonth(calendarConfig?.dias_atras ?? 10, maxDiasAtrasPermitidos)} días`}
                />
              )}
              <ItemDato
                label="Vista previa"
                value={
                  (calendarConfig?.modo ?? "mes_completo") === "dias_atras"
                    ? (() => {
                        const { from, to } = getDiasAtrasRangeWithinMonth(
                          calendarConfig?.dias_atras ?? 10
                        );
                        return `${formatDate(from)} → ${formatDate(to)}`;
                      })()
                    : (() => {
                        const now = new Date();
                        const from = new Date(now.getFullYear(), now.getMonth(), 1);
                        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                        return `${formatDate(from)} → ${formatDate(to)}`;
                      })()
                }
                full
              />
            </div>
          </div>

          {/* Tarjeta 2 — Modo de visualización */}
          <div className="cal-metaCard">
            <div className="cal-metaCard__top">
              <div className="cal-metaCard__icon">
                <FontAwesomeIcon icon={faShieldHalved} />
              </div>
              <div className="cal-metaCard__head">
                <h2>Modo de visualización</h2>
                <p>Elegí cómo se calcula el rango de fechas por defecto.</p>
              </div>
            </div>

            <div className="cal-metaCard__body cal-metaCard__body--stack">
              {MODOS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`cal-actionRow ${modo === m.value ? "cal-actionRow--active" : ""}`}
                  onClick={() => handleModoChange(m.value)}
                >
                  <div className="cal-actionRow__iconWrap">
                    <FontAwesomeIcon icon={m.icon} />
                  </div>
                  <div className="cal-actionRow__text">
                    <span className="cal-actionRow__title">{m.label}</span>
                    <span className="cal-actionRow__desc">{m.description}</span>
                  </div>
                  {modo === m.value
                    ? <FontAwesomeIcon icon={faCheck} className="cal-actionRow__check" />
                    : <FontAwesomeIcon icon={faChevronRight} className="cal-actionRow__chevron" />
                  }
                </button>
              ))}
            </div>
          </div>

          {/* Tarjeta 3 — Configuración de días (condicional) */}
          {modo === "dias_atras" && (
            <div className="cal-metaCard cal-metaCard--dias">
              <div className="cal-metaCard__top">
                <div className="cal-metaCard__icon">
                  <FontAwesomeIcon icon={faCalendarWeek} />
                </div>
                <div className="cal-metaCard__head">
                  <h2>Cantidad de días</h2>
                  <p>Definí cuántos días hacia atrás mostrar dentro del mes.</p>
                </div>
              </div>

              <div className="cal-metaCard__body cal-metaCard__body--stack">
                <div className="cal-diasRow">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="cal-diasInput"
                    value={diasAtrasInput}
                    onChange={handleDiasChange}
                    onBlur={handleDiasBlur}
                    onFocus={(e) => e.target.select()}
                    placeholder={String(Math.min(10, maxDiasAtrasPermitidos))}
                    aria-label="Cantidad de días hacia atrás"
                    autoComplete="off"
                  />
                  <span className="cal-diasLabel">días</span>
                </div>

                <p className="cal-diasHint">
                  Valores permitidos: <strong>0</strong> a{" "}
                  <strong>{maxDiasAtrasPermitidos}</strong>. <br/> No se permite cruzar
                  al mes anterior.
                </p>

                <DiaPreview dias={diasAtrasNormalizado} />
              </div>
            </div>
          )}

          {/* Tarjeta — Vista previa mes completo (condicional) */}
          {modo === "mes_completo" && (
            <div className="cal-metaCard">
              <div className="cal-metaCard__top">
                <div className="cal-metaCard__icon">
                  <FontAwesomeIcon icon={faCalendarDays} />
                </div>
                <div className="cal-metaCard__head">
                  <h2>Vista previa del rango</h2>
                  <p>Rango que se aplicará con el modo seleccionado.</p>
                </div>
              </div>

              <div className="cal-metaCard__body cal-metaCard__body--stack">
                <MesCompletoPreview />
              </div>
            </div>
          )}

          {/* Tarjeta 4 — Guardar */}
          <div className="cal-metaCard cal-metaCard--save">
            <div className="cal-metaCard__top">
              <div className="cal-metaCard__icon">
                <FontAwesomeIcon icon={faBolt} />
              </div>
              <div className="cal-metaCard__head">
                <h2>Guardar configuración</h2>
                <p>Aplicá los cambios a todas las vistas del sistema.</p>
              </div>
            </div>

            <div className="cal-metaCard__body cal-metaCard__body--stack">
              <div className="cal-saveActions">
                <span className={`cal-saveHint ${hasChanges ? "is-pending" : ""}`}>
                  {hasChanges
                    ? "Hay cambios pendientes por guardar."
                    : "No hay cambios pendientes."}
                </span>

                <button
                  type="button"
                  className="cal-btn cal-btn--save"
                  disabled={saving || !hasChanges}
                  onClick={handleSave}
                >
                  <FontAwesomeIcon
                    icon={saving ? faSpinner : faFloppyDisk}
                    spin={saving}
                  />
                  {saving ? "Guardando..." : "Guardar configuración"}
                </button>
              </div>
            </div>
          </div>

        </div>
        </div>
      </section>
    </>
  );
}