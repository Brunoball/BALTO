import { useEffect } from "react";
import "./Global_css/GlobalViewport.css";

/** Una sola fuente de altura para las secciones, navegación y modales.
 * Las barras del navegador/SO ya están descontadas del viewport visible.
 * No restar screen.height - innerHeight: incluye zonas ajenas a la página.
 */
export default function useVisualViewport() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const header = document.querySelector(".mov-topbar");
    const previous = new Map();
    const classes = ["balto-visual-viewport-ready", "balto-mobile-visual-viewport"];
    const previousClasses = classes.map((name) => root.classList.contains(name));
    let frame = 0;
    let settleTimer = 0;
    let lastSignature = "";

    const set = (name, value) => {
      if (!previous.has(name)) previous.set(name, [root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
      if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
    };
    const update = () => {
      frame = 0;
      // El zoom debe ampliar el contenido, no redistribuir toda la aplicación.
      if (vv && Math.abs((vv.scale || 1) - 1) > 0.02) return;
      const width = vv?.width || window.innerWidth || root.clientWidth;
      const height = vv?.height || window.innerHeight || root.clientHeight;
      if (!(width > 0 && height > 0)) return;
      const top = Math.max(0, vv?.offsetTop || 0);
      const left = Math.max(0, vv?.offsetLeft || 0);
      const headerHeight = header?.getBoundingClientRect().height || 0;
      const mobile = window.matchMedia("(max-width: 980px)").matches;
      const values = { width, height, top, left, bottom: top + height, right: left + width };
      const signature = JSON.stringify([values, headerHeight, mobile]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      Object.entries(values).forEach(([key, value]) => set(`--balto-visual-viewport-${key}`, `${value}px`));
      if (headerHeight > 0) set("--balto-topbar-height", `${headerHeight}px`);
      root.classList.toggle("balto-mobile-visual-viewport", mobile);
      root.classList.add("balto-visual-viewport-ready");
      window.dispatchEvent(new CustomEvent("balto:visualviewportchange", { detail: values }));
    };
    const sync = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const settle = () => {
      sync();
      window.clearTimeout(settleTimer);
      // Algunos navegadores notifican orientación/foco antes de acabar la animación.
      settleTimer = window.setTimeout(sync, 300);
    };
    const visible = () => { if (!document.hidden) settle(); };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    if (header) observer?.observe(header);
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", settle);
    window.addEventListener("pageshow", settle);
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    vv?.addEventListener("resize", sync, { passive: true });
    vv?.addEventListener("scroll", sync, { passive: true });
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", settle);
      window.removeEventListener("pageshow", settle);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      classes.forEach((name, index) => root.classList.toggle(name, previousClasses[index]));
      previous.forEach(([value, priority], name) => {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      });
    };
  }, []);
}
