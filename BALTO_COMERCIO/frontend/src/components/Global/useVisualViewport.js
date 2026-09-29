import { useLayoutEffect } from "react";
import "./Global_css/GlobalViewport.css";

/**
 * Publica el viewport REAL visible para todo BALTO.
 *
 * - visualViewport descuenta las barras dinámicas del navegador móvil.
 * - la escala inicial del navegador puede ser distinta de 1; eso NO significa
 *   necesariamente que el usuario esté haciendo pinch-zoom.
 * - .pp-content es el único scroll vertical del layout responsive.
 * - las secciones pueden escuchar `balto:visualviewportchange` si necesitan
 *   medir un área interna concreta (por ejemplo, una tabla).
 */
export default function useVisualViewport() {
  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const vv = window.visualViewport;
    const previous = new Map();
    const classes = ["balto-visual-viewport-ready", "balto-mobile-visual-viewport"];
    const previousClasses = classes.map((name) => root.classList.contains(name));

    let frame = 0;
    let settleTimer = 0;
    let lastSignature = "";
    let baselineScale = null;
    let lastStableViewport = null;

    const set = (name, value) => {
      if (!previous.has(name)) {
        previous.set(name, [
          root.style.getPropertyValue(name),
          root.style.getPropertyPriority(name),
        ]);
      }

      if (root.style.getPropertyValue(name) !== value) {
        root.style.setProperty(name, value);
      }
    };

    const px = (value) => `${Math.max(0, Math.round(Number(value || 0) * 100) / 100)}px`;

    const isMobileLayout = () => {
      const narrow = window.matchMedia?.("(max-width: 980px)")?.matches;
      const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
      const screenMin = Math.min(
        Number(window.screen?.width || Infinity),
        Number(window.screen?.height || Infinity)
      );

      return Boolean(narrow || (coarse && screenMin <= 980));
    };

    const readViewport = () => {
      const currentScale = Number(vv?.scale || 1) || 1;
      if (baselineScale == null) baselineScale = currentScale;

      const relativeScale = baselineScale > 0 ? currentScale / baselineScale : 1;
      const pinchZoomed = Math.abs(relativeScale - 1) > 0.025;

      // Durante pinch-zoom conservamos la última geometría estable. Así el zoom
      // amplía el contenido sin recalcular toda la aplicación. La escala inicial,
      // aunque no sea 1, sí se acepta como referencia válida.
      if (pinchZoomed && lastStableViewport) {
        return { ...lastStableViewport, scale: currentScale, pinchZoomed: true };
      }

      const width = Number(vv?.width || window.innerWidth || root.clientWidth || 0);
      const height = Number(vv?.height || window.innerHeight || root.clientHeight || 0);
      const top = Number(vv?.offsetTop || 0);
      const left = Number(vv?.offsetLeft || 0);

      if (!(width > 0 && height > 0)) return null;

      const viewport = {
        width,
        height,
        top: Math.max(0, top),
        left: Math.max(0, left),
        scale: currentScale,
        pinchZoomed: false,
      };

      lastStableViewport = viewport;
      return viewport;
    };

    const update = () => {
      frame = 0;

      const viewport = readViewport();
      if (!viewport) return;

      const header = document.querySelector(".mov-topbar");
      const content = document.querySelector(".pp-content");
      const headerHeight = Number(header?.getBoundingClientRect?.().height || 0);
      const viewportBottom = viewport.top + viewport.height;

      // Medimos desde el comienzo REAL del contenido hasta el borde visible.
      // Esto evita restas fijas que fallan cuando Chrome/Safari muestran u ocultan
      // sus barras de navegación.
      const contentRect = content?.getBoundingClientRect?.();
      const contentTop = Number(contentRect?.top);
      const visibleContentTop = Number.isFinite(contentTop)
        ? Math.max(contentTop, viewport.top)
        : viewport.top + headerHeight;
      const contentHeight = Math.max(0, viewportBottom - visibleContentTop);

      const mobile = isMobileLayout();
      const values = {
        width: viewport.width,
        height: viewport.height,
        top: viewport.top,
        left: viewport.left,
        bottom: viewportBottom,
        right: viewport.left + viewport.width,
        contentHeight,
        headerHeight,
        mobile,
      };

      const signature = JSON.stringify(values);
      if (signature === lastSignature) return;
      lastSignature = signature;

      set("--balto-visual-viewport-width", px(values.width));
      set("--balto-visual-viewport-height", px(values.height));
      set("--balto-visual-viewport-top", px(values.top));
      set("--balto-visual-viewport-left", px(values.left));
      set("--balto-visual-viewport-bottom", px(values.bottom));
      set("--balto-visual-viewport-right", px(values.right));

      if (headerHeight > 0) set("--balto-topbar-height", px(headerHeight));
      if (contentHeight > 0) set("--balto-content-viewport-height", px(contentHeight));

      root.classList.toggle("balto-mobile-visual-viewport", mobile);
      root.classList.add("balto-visual-viewport-ready");

      window.dispatchEvent(
        new CustomEvent("balto:visualviewportchange", {
          detail: values,
        })
      );
    };

    const sync = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    const settle = () => {
      sync();
      window.clearTimeout(settleTimer);
      // Android/iOS pueden terminar la animación de sus barras después del primer
      // resize. Una segunda lectura corrige el último píxel sin usar alturas fijas.
      settleTimer = window.setTimeout(sync, 320);
    };

    const visible = () => {
      if (!document.hidden) settle();
    };

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;

    const header = document.querySelector(".mov-topbar");
    const content = document.querySelector(".pp-content");
    if (header) observer?.observe(header);
    if (content) observer?.observe(content);

    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("orientationchange", settle);
    window.addEventListener("pageshow", settle);
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    vv?.addEventListener("resize", sync, { passive: true });
    vv?.addEventListener("scroll", sync, { passive: true });
    vv?.addEventListener?.("scrollend", settle, { passive: true });

    update();

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer?.disconnect();

      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", settle);
      window.removeEventListener("pageshow", settle);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      vv?.removeEventListener?.("scrollend", settle);

      classes.forEach((name, index) =>
        root.classList.toggle(name, previousClasses[index])
      );

      previous.forEach(([value, priority], name) => {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      });
    };
  }, []);
}
