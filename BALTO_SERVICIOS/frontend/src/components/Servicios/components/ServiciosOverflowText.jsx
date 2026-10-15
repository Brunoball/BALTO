import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Texto de una celda de Servicios: conserva el recorte con puntos suspensivos
 * y muestra el valor completo únicamente cuando realmente está truncado.
 *
 * El cartel vive en document.body para no quedar cortado por el overflow de
 * la tabla, el modal ni la barra de desplazamiento.
 */
export default function ServiciosOverflowText({ value, as: Element = "span", className = "" }) {
  const anchorRef = useRef(null);
  const timerRef = useRef(null);
  const [position, setPosition] = useState(null);
  const text = String(value ?? "—");

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setPosition(null);
  }, [clearTimer]);

  const isTruncated = useCallback(() => {
    const el = anchorRef.current;
    return Boolean(el && (
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
    ));
  }, []);

  const getPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || !anchor.isConnected) return null;

    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const tooltipWidth = Math.min(420, Math.max(0, viewportWidth - 24));
    const padding = 12;
    const left = Math.max(
      viewportLeft + padding,
      Math.min(rect.left, viewportLeft + viewportWidth - padding - tooltipWidth)
    );
    const above = rect.bottom + 100 > viewportTop + viewportHeight && rect.top > viewportTop + 100;

    return { left, top: above ? rect.top - 7 : rect.bottom + 7, above };
  }, []);

  const reveal = useCallback((delay = 170) => {
    clearTimer();
    if (!isTruncated()) {
      setPosition(null);
      return;
    }
    if (delay === 0) {
      setPosition(getPosition());
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isTruncated()) setPosition(getPosition());
    }, delay);
  }, [clearTimer, getPosition, isTruncated]);

  useEffect(() => dismiss, [dismiss]);

  useEffect(() => {
    if (!position) return undefined;
    const update = () => {
      if (!isTruncated()) {
        setPosition(null);
      } else {
        const next = getPosition();
        setPosition((previous) => previous && next &&
          previous.left === next.left && previous.top === next.top && previous.above === next.above
          ? previous : next
        );
      }
    };

    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [position !== null, getPosition, isTruncated]);

  return (
    <>
      <Element
        ref={anchorRef}
        className={`servicios-overflowText ${className}`.trim()}
        onMouseEnter={() => reveal()}
        onMouseLeave={dismiss}
        onFocus={() => reveal(0)}
        onBlur={dismiss}
        aria-label={text}
      >
        {text}
      </Element>
      {position && typeof document !== "undefined" && createPortal(
        <div
          className="servicios-overflowTooltip"
          role="tooltip"
          style={{ left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
