// src/components/Global/Calendario/Calendario.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRightLong } from "@fortawesome/free-solid-svg-icons";
import "./calendario.css";
import "../Global_css/Global_oscuro.css";

/* =============================================
   Helpers
============================================= */
const DAYS_ES = ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sá"];
const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function sameDay(a, b) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** true si `date` está en el mismo mes que `ref` o en un mes posterior */
function sameMonthOrAfter(date, ref) {
  if (!ref) return false;
  return (
    date.getFullYear() > ref.getFullYear() ||
    (date.getFullYear() === ref.getFullYear() && date.getMonth() >= ref.getMonth())
  );
}

function startOfDay(d) {
  if (!d) return null;
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function startOfMonth(d) {
  if (!d) return null;
  const c = new Date(d);
  c.setDate(1);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isBefore(a, b) {
  return startOfDay(a) < startOfDay(b);
}

function isAfter(a, b) {
  return startOfDay(a) > startOfDay(b);
}

function inRange(day, start, end) {
  if (!start || !end) return false;
  const s = startOfDay(start < end ? start : end);
  const e = startOfDay(start < end ? end : start);
  const d = startOfDay(day);
  return d > s && d < e;
}

function formatDate(d) {
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startDow = first.getDay();
  const cells = [];

  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));

  return cells;
}

function resolveInitialViewDate(selectedFrom, maxDate) {
  const base = startOfMonth(selectedFrom || new Date());

  if (!maxDate) return base;

  const maxMonth = startOfMonth(maxDate);
  const rightStart = addMonths(base, 1);

  // Si el panel derecho ya cae en el mes actual o en uno posterior,
  // mostramos el mes actual a la derecha y el anterior a la izquierda.
  if (sameMonthOrAfter(rightStart, maxMonth)) {
    return addMonths(maxMonth, -1);
  }

  return base;
}

function clampViewDate(viewDate, maxDate) {
  const normalized = startOfMonth(viewDate);

  if (!maxDate) return normalized;

  const maxMonth = startOfMonth(maxDate);
  const rightStart = addMonths(normalized, 1);

  if (sameMonthOrAfter(rightStart, maxMonth)) {
    return addMonths(maxMonth, -1);
  }

  return normalized;
}

/* =============================================
   Props:
     value:    { from: Date|null, to: Date|null }
     onChange: ({ from, to }) => void
     minDate?: Date
     maxDate?: Date   ← opcional; si viene, limita la fecha máxima
     onClose?: () => void
============================================= */
export default function Calendario({
  value,
  onChange,
  minDate,
  maxDate: maxDateProp,
  onClose,
}) {
  // El límite máximo solo se aplica si una vista lo pasa explícitamente.
  // La configuración global es solo el rango inicial, no una restricción manual.
  const effectiveMaxDate = useMemo(() => maxDateProp || null, [maxDateProp]);

  const today = startOfDay(new Date());

  const [viewDate, setViewDate] = useState(() =>
    resolveInitialViewDate(value?.from, effectiveMaxDate)
  );

  const rightViewDate = useMemo(() => addMonths(viewDate, 1), [viewDate]);

  // Si cambia el modo o maxDate, reacomodamos automáticamente la vista
  useEffect(() => {
    setViewDate((prev) => clampViewDate(prev, effectiveMaxDate));
  }, [effectiveMaxDate]);

  // Si cambia mucho el rango desde afuera y no hay maxDate,
  // alineamos la vista al mes del "from"
  useEffect(() => {
    if (!value?.from) return;
    setViewDate((prev) => {
      const target = startOfMonth(value.from);
      if (sameDay(startOfMonth(prev), target)) return prev;
      return clampViewDate(target, effectiveMaxDate);
    });
  }, [value?.from, effectiveMaxDate]);

  // No permitir avanzar si el panel derecho ya está mostrando el mes de maxDate
  const canGoNext = useMemo(() => {
    if (!effectiveMaxDate) return true;
    return !sameMonthOrAfter(rightViewDate, effectiveMaxDate);
  }, [rightViewDate, effectiveMaxDate]);

  const [hovered, setHovered] = useState(null);
  const lastClickRef = useRef({ day: null, time: 0 });

  const from = value?.from ? startOfDay(value.from) : null;
  const to = value?.to ? startOfDay(value.to) : null;

  const prevMonth = () => setViewDate((v) => addMonths(v, -1));
  const nextMonth = () => {
    if (canGoNext) setViewDate((v) => addMonths(v, 1));
  };

  const isDisabledDay = useCallback((day) => {
    if (!day) return true;
    if (minDate && isBefore(day, minDate)) return true;
    if (effectiveMaxDate && isAfter(day, effectiveMaxDate)) return true;
    return false;
  }, [minDate, effectiveMaxDate]);

  const handleDayClick = useCallback((day) => {
    if (!day || isDisabledDay(day)) return;

    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick =
      last.day && sameDay(last.day, day) && now - last.time < 400;

    lastClickRef.current = { day, time: now };

    if (isDoubleClick) {
      onChange({ from: startOfDay(day), to: startOfDay(day) });
      return;
    }

    if (!from || (from && to)) {
      onChange({ from: startOfDay(day), to: null });
    } else {
      if (sameDay(day, from)) {
        onChange({ from: startOfDay(day), to: startOfDay(day) });
      } else if (isBefore(day, from)) {
        onChange({ from: startOfDay(day), to: from });
      } else {
        onChange({ from, to: startOfDay(day) });
      }
    }
  }, [from, to, onChange, isDisabledDay]);

  const previewEnd = from && !to ? hovered : null;

  const getDayClass = useCallback((day) => {
    if (!day) return "";

    const classes = ["cal-day"];
    const d = startOfDay(day);
    const isToday = sameDay(d, today);
    const isFrom = from && sameDay(d, from);
    const rangeEnd = to || previewEnd;
    const isTo = to ? sameDay(d, to) : (previewEnd && sameDay(d, previewEnd));
    const inR = rangeEnd ? inRange(d, from, rangeEnd) : false;

    if (isToday) classes.push("cal-day--today");
    if (isFrom) classes.push("cal-day--from");
    if (isTo) classes.push("cal-day--to");
    if (isFrom && isTo) classes.push("cal-day--single");
    if (inR) classes.push("cal-day--inrange");
    if (isFrom && rangeEnd && !sameDay(from, rangeEnd)) classes.push("cal-day--range-start");
    if (isTo && from && !sameDay(from, rangeEnd)) classes.push("cal-day--range-end");
    if (isDisabledDay(d)) classes.push("cal-day--disabled");

    return classes.join(" ");
  }, [from, to, previewEnd, today, isDisabledDay]);

  const wrapRef = useRef(null);

  useEffect(() => {
    if (!onClose) return;

    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose();
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const renderMonth = (baseDate) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const cells = buildMonthGrid(year, month);

    return (
      <div className="cal-month">
        <div className="cal-month__label">
          {MONTHS_ES[month]} {year}
        </div>

        <div className="cal-grid">
          {DAYS_ES.map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}

          {cells.map((day, idx) => (
            <button
              key={idx}
              type="button"
              className={getDayClass(day)}
              onClick={() => day && handleDayClick(day)}
              onMouseEnter={() => day && !isDisabledDay(day) && setHovered(startOfDay(day))}
              onMouseLeave={() => setHovered(null)}
              tabIndex={day ? 0 : -1}
              aria-label={day ? formatDate(day) : undefined}
              disabled={isDisabledDay(day)}
            >
              {day ? day.getDate() : ""}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const rangeEnd = to || (from && previewEnd ? previewEnd : null);
  const hasRange = from && rangeEnd && !sameDay(from, rangeEnd);

  return (
    <div className="cal-wrap" ref={wrapRef}>
      {/* Header */}
      <div className="cal-header">
        <div className="cal-header__slot">
          <span className="cal-header__label">Desde</span>
          <span className={`cal-header__date ${from ? "is-set" : "is-empty"}`}>
            {from ? formatDate(from) : "——/——/————"}
          </span>
        </div>

        <div className="cal-header__arrow">
          <FontAwesomeIcon icon={faArrowRightLong} />
        </div>

        <div className="cal-header__slot">
          <span className="cal-header__label">Hasta</span>
          <span className={`cal-header__date ${rangeEnd ? "is-set" : "is-empty"}`}>
            {rangeEnd ? formatDate(rangeEnd) : "——/——/————"}
          </span>
        </div>

<button
  type="button"
  className="cal-clear"
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  }}
  title="Cerrar calendario"
  aria-label="Cerrar calendario"
>
  ×
</button>
      </div>

      {/* Months */}
      <div className="cal-panels">
        <button
          type="button"
          className="cal-nav cal-nav--prev"
          onClick={prevMonth}
          aria-label="Mes anterior"
        >
          ‹
        </button>

        {renderMonth(viewDate)}
        {renderMonth(rightViewDate)}

        <button
          type="button"
          className={[
            "cal-nav",
            "cal-nav--next",
            !canGoNext ? "cal-nav--hidden" : "",
          ].filter(Boolean).join(" ")}
          onClick={nextMonth}
          disabled={!canGoNext}
          aria-label="Mes siguiente"
          aria-hidden={!canGoNext ? "true" : undefined}
        >
          ›
        </button>
      </div>

      {/* Footer */}
      <div className="cal-footer">
        {!from && <span>Seleccioná la fecha de inicio del período.</span>}
        {from && !to && <span>Seleccioná la fecha de fin, o doble clic para un día exacto.</span>}
        {from && to && hasRange && (
          <span>
            Período: <b>{formatDate(from)}</b> — <b>{formatDate(to)}</b>
          </span>
        )}
        {from && to && !hasRange && (
          <span>
            Fecha exacta: <b>{formatDate(from)}</b>
          </span>
        )}
      </div>
    </div>
  );
}