import React, { useEffect, useMemo, useRef, useState } from "react";
import { obtenerCoeficientePonderadoStock } from "../api/stockApi";
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

function utilityStorageKey() {
  try {
    const user = JSON.parse(localStorage.getItem("usuario") || "null");
    const tenant = user?.idTenant ?? user?.id_tenant ?? user?.tenant_id ?? "default";
    return `balto:stock:utilidad-deseada:${tenant}`;
  } catch {
    return "balto:stock:utilidad-deseada:default";
  }
}

function initialUtility() {
  try {
    const saved = localStorage.getItem(utilityStorageKey());
    const parsed = parseDecimal(saved);
    return parsed !== null && parsed >= 0 ? String(parsed).replace(".", ",") : "10";
  } catch {
    return "10";
  }
}

export default function PricingCoefficientPanel({
  cost,
  disabled = false,
  onApplySuggestedPrice,
}) {
  const [periodo, setPeriodo] = useState(currentMonth);
  const [utilidadPct, setUtilidadPct] = useState(initialUtility);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);

  const utilidadNumber = parseDecimal(utilidadPct);

  useEffect(() => {
    if (!periodo || utilidadNumber === null || utilidadNumber < 0) {
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
        try {
          localStorage.setItem(utilityStorageKey(), String(utilidadNumber));
        } catch {}
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setResult(null);
        setError(err?.message || "No se pudo calcular el coeficiente ponderado.");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [periodo, utilidadNumber]);

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
            disabled={disabled || loading}
          />
        </label>
        <label>
          <span>Utilidad deseada sobre costo (%)</span>
          <input
            type="text"
            inputMode="decimal"
            value={utilidadPct}
            onChange={(e) => setUtilidadPct(e.target.value.replace(/[^\d,.]/g, ""))}
            disabled={disabled || loading}
            aria-label="Utilidad deseada sobre costo"
          />
        </label>
      </div>

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
