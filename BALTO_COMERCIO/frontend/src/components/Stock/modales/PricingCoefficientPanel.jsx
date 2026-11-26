import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCartShopping, faBuilding, faChartLine, faPercent } from "@fortawesome/free-solid-svg-icons";
import {
  guardarConfiguracionPreciosStock,
  obtenerCoeficientePonderadoStock,
  obtenerConfiguracionPreciosStock,
} from "../api/stockApi";
import { parseMoneyInput } from "../utils/moneyInput";
import "./PricingCoefficientPanel.css";

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  return monthKey(new Date());
}

/**
 * Mes base predeterminado: el último mes calendario COMPLETO, el mismo criterio
 * que CoeficientePonderadoService::resolverPeriodo(). Con el mes en curso las
 * compras todavía son parciales mientras los gastos fijos suelen estar cargados
 * completos, y el coeficiente (y el precio sugerido) quedaba inflado.
 * Sólo se usa hasta que responde el backend, que informa el período real.
 */
function lastCompleteMonth() {
  const now = new Date();
  return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

// Misma interpretación de comas, puntos y centavos que los formularios de Stock.
const parseDecimal = parseMoneyInput;

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
  // "" = mes base predeterminado del backend (último mes completo). Sólo se
  // envía `periodo` cuando el usuario elige un mes explícitamente.
  const [periodoManual, setPeriodoManual] = useState("");
  const [utilidadPct, setUtilidadPct] = useState("");
  const [configReady, setConfigReady] = useState(false);
  const [configError, setConfigError] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSeq = useRef(0);
  const lastSavedUtility = useRef(null);
  const monthInputRef = useRef(null);

  const periodo = periodoManual || result?.periodo || lastCompleteMonth();
  const mesActual = currentMonth();
  const periodoEnCurso = periodo === mesActual;

  const openMonthPicker = () => {
    const input = monthInputRef.current;
    if (!input || disabled || !configReady) return;

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

  // La utilidad deseada es una configuración de TODO el tenant (también la usa
  // la revisión de precios). Antes se guardaba 700 ms después de cada tecla, así
  // que un valor intermedio ("1" mientras se escribía "15") podía quedar
  // persistido. Ahora se guarda sólo al confirmar (blur o Enter) un valor válido
  // y distinto del guardado; el precio sugerido se sigue recalculando en vivo.
  const persistirUtilidad = async () => {
    if (!configReady || disabled || utilidadNumber === null || utilidadNumber < 0) return;
    if (lastSavedUtility.current !== null && Math.abs(lastSavedUtility.current - utilidadNumber) < 0.0001) {
      return;
    }
    const valor = utilidadNumber;
    try {
      const response = await guardarConfiguracionPreciosStock({ utilidad_deseada_pct: valor });
      const config = response?.configuracion || response?.data?.configuracion || null;
      const saved = parseDecimal(config?.utilidad_deseada_pct);
      lastSavedUtility.current = saved !== null ? saved : valor;
      setConfigError("");
    } catch (err) {
      setConfigError(err?.message || "No se pudo guardar la utilidad deseada.");
    }
  };

  useEffect(() => {
    // Cada cambio invalida cualquier respuesta anterior todavía en vuelo, incluso
    // si el nuevo estado no dispara un cálculo (por ejemplo utilidad vacía).
    const seq = ++requestSeq.current;

    if (!configReady || utilidadNumber === null || utilidadNumber < 0) {
      setResult(null);
      setLoading(false);
      return undefined;
    }

    // Desde este instante el resultado anterior ya no corresponde a los datos
    // ingresados: no se ofrece "Aplicar" con un coeficiente viejo.
    setLoading(true);
    const timer = window.setTimeout(async () => {
      setError("");
      try {
        const response = await obtenerCoeficientePonderadoStock({
          ...(periodoManual ? { periodo: periodoManual } : {}),
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
  }, [configReady, periodoManual, utilidadNumber]);

  const suggestedPrice = useMemo(() => {
    const costNumber = parseDecimal(cost);
    const coefficient = Number(result?.coeficiente_ponderado);
    if (
      loading ||
      !result?.disponible ||
      costNumber === null ||
      costNumber < 0 ||
      !Number.isFinite(coefficient) ||
      coefficient <= 0
    ) {
      return null;
    }
    return Number((costNumber * coefficient).toFixed(2));
  }, [cost, result, loading]);

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
            max={mesActual}
            onChange={(e) => {
              const value = String(e.target.value || "");
              // Vaciar el selector vuelve al mes base predeterminado.
              if (!value) {
                setPeriodoManual("");
                return;
              }
              // No se calcula sobre meses futuros: no tienen compras.
              setPeriodoManual(value > mesActual ? mesActual : value);
            }}
            onClick={openMonthPicker}
            disabled={disabled || !configReady}
            aria-label="Mes base del coeficiente"
            data-testid="stock-coeficiente-mes"
          />
          <span className="stock-coef__fieldLabel">Mes base</span>
        </label>

        <label className={`stock-coef__field ${utilidadPct ? "stock-coef__field--filled" : ""}`}>
          <input
            type="text"
            inputMode="decimal"
            value={utilidadPct}
            onChange={(e) => setUtilidadPct(e.target.value.replace(/[^\d,.]/g, ""))}
            onBlur={persistirUtilidad}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                persistirUtilidad();
              }
            }}
            // No se deshabilita durante el cálculo: deshabilitar un input con foco
            // lo desenfoca y se perdían las teclas siguientes al escribir.
            disabled={disabled || !configReady}
            data-testid="stock-coeficiente-utilidad"
            aria-label="Utilidad deseada sobre costo"
            placeholder=" "
          />
          <span className="stock-coef__fieldLabel">Utilidad deseada sobre costo (%)</span>
        </label>
      </div>

      {configError ? <div className="stock-coef__warning">{configError}</div> : null}
      {error ? <div className="stock-coef__warning">{error}</div> : null}
      {!error && result?.advertencia ? (
        <div className="stock-coef__warning" data-testid="stock-coeficiente-advertencia">{result.advertencia}</div>
      ) : null}
      {!error && !result?.advertencia && periodoEnCurso && result?.disponible ? (
        <div className="stock-coef__warning" data-testid="stock-coeficiente-advertencia">
          El mes base todavía está en curso: compras y gastos son parciales y el precio sugerido puede quedar distorsionado.
        </div>
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
