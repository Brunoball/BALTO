import React, { useEffect, useMemo, useRef, useState } from "react";
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
        <label>
          <span>Mes base</span>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            disabled={disabled || loading || !configReady}
          />
        </label>
        <label>
          <span>Utilidad deseada sobre costo (%)</span>
          <input
            type="text"
            inputMode="decimal"
            value={utilidadPct}
            onChange={(e) => setUtilidadPct(e.target.value.replace(/[^\d,.]/g, ""))}
            disabled={disabled || loading || !configReady}
            aria-label="Utilidad deseada sobre costo"
          />
        </label>
      </div>

      {configError ? <div className="stock-coef__warning">{configError}</div> : null}
      {error ? <div className="stock-coef__warning">{error}</div> : null}
      {!error && result?.advertencia ? (
        <div className="stock-coef__warning">{result.advertencia}</div>
      ) : null}

      <div className="stock-coef__metrics">
        <div><span>Compras netas</span><strong>{formatMoney(result?.compras_mercaderia)}</strong></div>
        <div><span>Gastos fijos</span><strong>{formatMoney(result?.gastos_fijos)}</strong></div>
        <div><span>Gastos variables</span><strong>{formatMoney(result?.gastos_variables)}</strong></div>
        <div><span>Incidencia estructura</span><strong>{formatPercent(result?.incidencia_estructura_pct)}</strong></div>
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
