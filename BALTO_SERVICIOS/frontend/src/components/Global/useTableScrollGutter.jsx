import { useCallback, useEffect, useState } from "react";

/**
 * Detecta si el contenedor de filas tiene scroll vertical real.
 *
 * Devuelve un callback ref para que la medición también se active cuando la
 * tabla se monta de forma condicional (por ejemplo, después de seleccionar un
 * cliente).
 */
export default function useTableScrollGutter() {
  const [scrollElement, setScrollElement] = useState(null);
  const [hasVerticalScroll, setHasVerticalScroll] = useState(false);

  const scrollRef = useCallback((node) => {
    setScrollElement(node);
  }, []);

  useEffect(() => {
    if (!scrollElement) {
      setHasVerticalScroll(false);
      return undefined;
    }

    let animationFrame = 0;

    const measure = () => {
      animationFrame = 0;
      const nextValue =
        scrollElement.scrollHeight > scrollElement.clientHeight + 1;

      setHasVerticalScroll((currentValue) =>
        currentValue === nextValue ? currentValue : nextValue
      );
    };

    const scheduleMeasure = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleMeasure)
        : null;

    resizeObserver?.observe(scrollElement);
    if (scrollElement.firstElementChild) {
      resizeObserver?.observe(scrollElement.firstElementChild);
    }

    const mutationObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(scheduleMeasure)
        : null;

    mutationObserver?.observe(scrollElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scrollElement]);

  return [scrollRef, hasVerticalScroll];
}
