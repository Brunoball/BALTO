import { useEffect } from "react";

/**
 * Publica el viewport visual real del navegador como variables CSS globales.
 *
 * En mobile, 100vh/100dvh puede no acompañar exactamente las barras dinámicas
 * del navegador, la navegación del sistema, el teclado o los cambios de
 * orientación. window.visualViewport sí representa el área que el usuario ve.
 *
 * Variables disponibles en toda la app:
 * --balto-visual-viewport-height
 * --balto-visual-viewport-width
 * --balto-visual-viewport-top
 * --balto-visual-viewport-left
 * --balto-visual-viewport-bottom
 * --balto-visual-viewport-right
 * --balto-panel-viewport-height
 */
export default function useVisualViewport() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    let frame = 0;

    const sync = () => {
      if (frame) window.cancelAnimationFrame(frame);

      frame = window.requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const fallbackWidth = window.innerWidth || root.clientWidth || 0;
        const fallbackHeight = window.innerHeight || root.clientHeight || 0;

        const width = Math.max(0, Math.round(vv?.width || fallbackWidth));
        const height = Math.max(0, Math.round(vv?.height || fallbackHeight));
        const top = Math.max(0, Math.round(vv?.offsetTop || 0));
        const left = Math.max(0, Math.round(vv?.offsetLeft || 0));
        const bottom = top + height;
        const right = left + width;

        if (height > 0) {
          root.style.setProperty("--balto-visual-viewport-height", `${height}px`);
          root.style.setProperty("--balto-visual-viewport-bottom", `${bottom}px`);
        }

        if (width > 0) {
          root.style.setProperty("--balto-visual-viewport-width", `${width}px`);
          root.style.setProperty("--balto-visual-viewport-right", `${right}px`);
        }

        root.style.setProperty("--balto-visual-viewport-top", `${top}px`);
        root.style.setProperty("--balto-visual-viewport-left", `${left}px`);

        root.classList.toggle(
          "balto-mobile-visual-viewport",
          window.matchMedia?.("(max-width: 980px)")?.matches ?? fallbackWidth <= 980
        );
        root.classList.add("balto-visual-viewport-ready");

        window.dispatchEvent(
          new CustomEvent("balto:visualviewportchange", {
            detail: { width, height, top, left, bottom, right },
          })
        );
      });
    };

    sync();

    const vv = window.visualViewport;
    const onVisibilityChange = () => {
      if (!document.hidden) sync();
    };

    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisibilityChange);
    vv?.addEventListener("resize", sync, { passive: true });
    vv?.addEventListener("scroll", sync, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      root.classList.remove("balto-mobile-visual-viewport");
      root.classList.remove("balto-visual-viewport-ready");
      [
        "--balto-visual-viewport-height",
        "--balto-visual-viewport-width",
        "--balto-visual-viewport-top",
        "--balto-visual-viewport-left",
        "--balto-visual-viewport-bottom",
        "--balto-visual-viewport-right",
      ].forEach((name) => root.style.removeProperty(name));
    };
  }, []);
}
