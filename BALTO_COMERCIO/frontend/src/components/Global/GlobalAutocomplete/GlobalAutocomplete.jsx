import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import "./GlobalAutocomplete.css";

function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export default function GlobalAutocomplete({
  value = "",
  onChange,
  onSelect,
  options = [],
  getOptionLabel = (opt) => String(opt?.nombre ?? ""),
  getOptionValue = (opt) => String(opt?.id ?? getOptionLabel(opt)),
  placeholder = " ",
  label = "",
  disabled = false,
  showAllOnFocus = true,
  maxItems = 18,
  className = "",
  inputClassName = "",
  listClassName = "",
  itemClassName = "",
  labelClassName = "fl-label",
  emptyMessage = "Sin resultados",
  name,
  id,
}) {
  const wrapRef       = useRef(null);
  const inputRef      = useRef(null);
  const blurTimerRef  = useRef(null);
  const rafRef        = useRef(null);

  const [open,        setOpen]        = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
const [listPos, setListPos] = useState(null);

  const normalizedValue = normalizeText(value);

  const filteredOptions = useMemo(() => {
    const arr = Array.isArray(options) ? options : [];
    if (!normalizedValue) {
      return showAllOnFocus ? arr.slice(0, maxItems) : [];
    }
    return arr
      .filter((opt) => normalizeText(getOptionLabel(opt)).includes(normalizedValue))
      .slice(0, maxItems);
  }, [options, normalizedValue, getOptionLabel, showAllOnFocus, maxItems]);

  const safeActiveIndex =
    activeIndex >= filteredOptions.length ? 0 : activeIndex;

  /* Recalcular posición del dropdown en cada apertura y en scroll/resize */
const getCurrentPos = useCallback(() => {
  const el = inputRef.current;
  if (!el) return null;

  const rect = el.getBoundingClientRect();

  return {
    top: rect.bottom + window.scrollY + 4,
    left: rect.left + window.scrollX,
    width: rect.width,
  };
}, []);

const updatePos = useCallback(() => {
  const nextPos = getCurrentPos();
  if (!nextPos) return;
  setListPos(nextPos);
}, [getCurrentPos]);

  useEffect(() => {
    if (!open) return;
    updatePos();

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePos);
    };
    window.addEventListener("scroll",  onScroll, true);
    window.addEventListener("resize",  onScroll);
    return () => {
      window.removeEventListener("scroll",  onScroll, true);
      window.removeEventListener("resize",  onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, updatePos]);

  useEffect(() => { setActiveIndex(0); }, [value]);

  /* Cerrar al hacer click fuera */
  useEffect(() => {
    const handleOutside = (e) => {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target)) return;
      /* también ignorar clicks dentro del portal */
      const portalList = document.getElementById("ga-portal-list");
      if (portalList && portalList.contains(e.target)) return;
      setOpen(false);
      setActiveIndex(0);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const closeList = () => { setOpen(false); setActiveIndex(0); };

const openList = () => {
  if (disabled) return;
  if (!(showAllOnFocus || normalizedValue)) return;

  const nextPos = getCurrentPos();

  if (!nextPos) return;

  setListPos(nextPos);
  setOpen(true);
};

  const selectOption = (opt) => {
    onSelect?.(opt);
    closeList();
  };

  const handleFocus = () => { openList(); };

  const handleBlur = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => { closeList(); }, 150);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      if (filteredOptions.length > 0) { e.preventDefault(); setOpen(true); }
    }
    if (e.key === "ArrowDown") {
      if (!filteredOptions.length) return;
      e.preventDefault();
      setActiveIndex((p) => (p >= filteredOptions.length - 1 ? 0 : p + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      if (!filteredOptions.length) return;
      e.preventDefault();
      setActiveIndex((p) => (p <= 0 ? filteredOptions.length - 1 : p - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open || !filteredOptions.length) return;
      e.preventDefault();
      selectOption(filteredOptions[safeActiveIndex]);
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); closeList(); }
  };

  /* ── Portal dropdown ── */
const dropdown = open && listPos ? createPortal(
    <ul
      id="ga-portal-list"
      className={["ga-list", listClassName].filter(Boolean).join(" ")}
      style={{
        position: "absolute",
        top:      listPos.top,
        left:     listPos.left,
        width:    listPos.width,
        zIndex:   9999999999,
        margin:   0,
      }}
      /* Evitar que el blur del input cierre la lista antes del click */
      onMouseDown={(e) => e.preventDefault()}
    >
      {filteredOptions.length > 0
        ? filteredOptions.map((opt, idx) => {
            const active = idx === safeActiveIndex;
            const optionLabel = getOptionLabel(opt);
            const optionValue = getOptionValue(opt);
            return (
              <li
                key={`${optionValue}-${idx}`}
                className={["ga-item", active ? "is-active" : "", itemClassName]
                  .filter(Boolean).join(" ")}
                onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
              >
                {optionLabel}
              </li>
            );
          })
        : (
          <li className={["ga-item", "is-empty", itemClassName].filter(Boolean).join(" ")}>
            {emptyMessage}
          </li>
        )
      }
    </ul>,
    document.body
  ) : null;

  return (
    <div
      ref={wrapRef}
      className={["ga-wrap", className].filter(Boolean).join(" ")}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={["ga-input", inputClassName].filter(Boolean).join(" ")}
        type="text"
        value={value}
        placeholder={placeholder || " "}
        autoComplete="off"
        disabled={disabled}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
onChange={(e) => {
  onChange?.(e.target.value);

  const nextPos = getCurrentPos();
  if (nextPos) {
    setListPos(nextPos);
    setOpen(true);
  }

  setActiveIndex(0);
}}
      />

      {label ? (
        <label htmlFor={id} className={labelClassName}>
          {label}
        </label>
      ) : null}

      {dropdown}
    </div>
  );
}