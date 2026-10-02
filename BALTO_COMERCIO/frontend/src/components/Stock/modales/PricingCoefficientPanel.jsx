import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCartShopping, faBuilding, faChartLine, faPercent } from "@fortawesome/free-solid-svg-icons";
import {
  guardarConfiguracionPreciosStock,
  obtenerCoeficientePonderadoStock,
  obtenerConfiguracionPreciosStock,
} from "../api/stockApi";
import "./PricingCoefficientPanel.css";

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim().replace(/\s+/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const number = Number(normalized.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function formatCoefficient(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("es-AR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default function PricingCoefficientPanel({
  cost,
  disabled = false,
  onApplySuggestedPrice,
  costField = null,
  costHint = "",
}) {
  const [periodo, setPeriodo] = useState(currentMonth);
  const [utilidadPct, setUtilidadPct] = useState("");
  const [configReady, setConfigReady] = useState(false);
  const [configError, setConfigError] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);
  const lastSavedUtility = useRef(null);
  const monthInputRef = useRef(null);

  const openMonthPicker = () => {
    const input = monthInputRef.current;
    if (!input || disabled || loading || !configReady) return;

    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
      } else {
        input.focus();
      }
    } catch (_error) {
      input.focus();
    }
  };

  const utilidadNumber = parseDecimal(utilidadPct);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setConfigError("");
        const response = await obtenerConfiguracionPreciosStock({ _: Date.now() });
        if (!active) return;
        const config = response?.configuracion || response?.data?.configuracion || null;
        const utilidad = parseDecimal(config?.utilidad_deseada_pct);
        const resolved = utilidad !== null && utilidad >= 0 ? utilidad : 10;
        lastSavedUtility.current = resolved;
        setUtilidadPct(String(resolved).replace(".", ","));
      } catch (err) {
        if (!active) return;
        // El cálculo puede seguir mostrándose con 10%, pero avisamos si la
        // configuración persistente todavía no está disponible.
        lastSavedUtility.current = 10;
        setUtilidadPct("10");
        setConfigError(err?.message || "No se pudo cargar la utilidad deseada guardada.");
      } finally {
        if (active) setConfigReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!configReady || utilidadNumber === null || utilidadNumber < 0) return undefined;
    if (lastSavedUtility.current !== null && Math.abs(lastSavedUtility.current - utilidadNumber) < 0.0001) {
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await guardarConfiguracionPreciosStock({ utilidad_deseada_pct: utilidadNumber });
        const config = response?.configuracion || response?.data?.configuracion || null;
        const saved = parseDecimal(config?.utilidad_deseada_pct);
        lastSavedUtility.current = saved !== null ? saved : utilidadNumber;
        setConfigError("");
      } catch (err) {
        setConfigError(err?.message || "No se pudo guardar la utilidad deseada.");
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [configReady, utilidadNumber]);

  useEffect(() => {
    if (!configReady || !periodo || utilidadNumber === null || utilidadNumber < 0) {
      setResult(null);
      return undefined;
    }

    const seq = ++requestSeq.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await obtenerCoeficientePonderadoStock({
          periodo,
          utilidad_pct: utilidadNumber,
          _: Date.now(),
        });
        if (seq !== requestSeq.current) return;
        setResult(response?.data || response || null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setResult(null);
        setError(err?.message || "No se pudo calcular el coeficiente ponderado.");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [configReady, periodo, utilidadNumber]);

  const suggestedPrice = useMemo(() => {
    const costNumber = parseDecimal(cost);
    const coefficient = Number(result?.coeficiente_ponderado);
    if (
      !result?.disponible ||
      costNumber === null ||
      costNumber < 0 ||
      !Number.isFinite(coefficient) ||
      coefficient <= 0
    ) {
      return null;
    }
    return Number((costNumber * coefficient).toFixed(2));
  }, [cost, result]);

  const applySuggested = () => {
    if (disabled || suggestedPrice === null || typeof onApplySuggestedPrice !== "function") return;
    onApplySuggestedPrice(suggestedPrice.toFixed(2).replace(".", ","));
  };

  const metrics = [
    {
      key: "compras",
      className: "stock-coef__metricCard stock-coef__metricCard--compras",
      icon: faCartShopping,
      label: "Compras netas",
      value: formatMoney(result?.compras_mercaderia),
    },
    {
      key: "fijos",
      className: "stock-coef__metricCard stock-coef__metricCard--fijos",
      icon: faBuilding,
      label: "Gastos fijos",
      value: formatMoney(result?.gastos_fijos),
    },
    {
      key: "variables",
      className: "stock-coef__metricCard stock-coef__metricCard--variables",
      icon: faChartLine,
      label: "Gastos variables",
      value: formatMoney(result?.gastos_variables),
    },
    {
      key: "incidencia",
      className: "stock-coef__metricCard stock-coef__metricCard--incidencia",
      icon: faPercent,
      label: "Incidencia estructura",
      value: formatPercent(result?.incidencia_estructura_pct),
    },
  ];

  return (
    <div className="stock-coef" data-testid="stock-coeficiente-ponderado">
      <div className="stock-coef__head">
        <div>
          <strong>Coeficiente ponderado</strong>
          <span>Precio sugerido según estructura mensual y utilidad deseada.</span>
        </div>
        <div className="stock-coef__value" data-testid="stock-coeficiente-valor">
          {loading ? "Calculando…" : formatCoefficient(result?.coeficiente_ponderado)}
        </div>
      </div>

      <div className="stock-coef__controls">
        {costField ? (
          <div className="stock-coef__costField">
            {costField}
            {costHint ? <small className="stock-coef__costHint">{costHint}</small> : null}
          </div>
        ) : null}

        <label className={`stock-coef__field stock-coef__field--month ${periodo ? "stock-coef__field--filled" : ""}`}>
          <input
            ref={monthInputRef}
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            onClick={openMonthPicker}
            disabled={disabled || loading || !configReady}
          />
          <span className="stock-coef__fieldLabel">Mes base</span>
        </label>

        <label className={`stock-coef__field ${utilidadPct ? "stock-coef__field--filled" : ""}`}>
          <input
            type="text"
            inputMode="decimal"
            value={utilidadPct}
            onChange={(e) => setUtilidadPct(e.target.value.replace(/[^\d,.]/g, ""))}
            disabled={disabled || loading || !configReady}
            aria-label="Utilidad deseada sobre costo"
            placeholder=" "
          />
          <span className="stock-coef__fieldLabel">Utilidad deseada sobre costo (%)</span>
        </label>
      </div>

      {configError ? <div className="stock-coef__warning">{configError}</div> : null}
      {error ? <div className="stock-coef__warning">{error}</div> : null}
      {!error && result?.advertencia ? (
        <div className="stock-coef__warning">{result.advertencia}</div>
      ) : null}

      <div className="stock-coef__metrics">
        {metrics.map((metric) => (
          <div key={metric.key} className={metric.className}>
            <div className="stock-coef__metricTop">
              <span className="stock-coef__metricIcon" aria-hidden="true">
                <FontAwesomeIcon icon={metric.icon} />
              </span>
              <span>{metric.label}</span>
            </div>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className="stock-coef__suggested">
        <div>
          <span>Precio sugerido</span>
          <strong data-testid="stock-precio-sugerido">{formatMoney(suggestedPrice)}</strong>
        </div>
        <button
          type="button"
          className="mit-btn mit-btn--ghost"
          onClick={applySuggested}
          disabled={disabled || suggestedPrice === null || loading}
        >
          Aplicar al precio de venta
        </button>
      </div>

      <small>
        Margen real: (precio de venta − costo de adquisición) ÷ precio de venta.
      </small>
    </div>
  );
}
