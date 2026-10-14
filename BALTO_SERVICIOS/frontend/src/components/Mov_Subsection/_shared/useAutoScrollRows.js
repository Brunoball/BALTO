import { useCallback, useLayoutEffect, useRef } from "react";

/** Solicita el scroll solamente al agregar una fila, no al editar sus valores. */
export default function useAutoScrollRows(containerRef, rowCount) {
  const pendingScrollRef = useRef(false);
  const scrollToNewRow = useCallback(() => {
    pendingScrollRef.current = true;
  }, []);

  useLayoutEffect(() => {
    if (!pendingScrollRef.current) return undefined;
    pendingScrollRef.current = false;

    const scrollToBottom = () => {
      const container = containerRef.current;
      if (!container) return;
      const lastRow = container.lastElementChild;
      if (!lastRow) return;

      // En escritorio normalmente scrollea la tabla; en móvil puede
      // scrollear el contenido del modal (o su contenedor responsive).
      let scroller = container;
      while (scroller && scroller !== document.body) {
        const style = window.getComputedStyle(scroller);
        if (/auto|scroll|overlay/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller === document.body) return;
      if (scroller === container) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        const lastRect = lastRow.getBoundingClientRect();
        const scrollRect = scroller.getBoundingClientRect();
        const delta = lastRect.bottom - scrollRect.bottom + 12;
        if (delta > 0) scroller.scrollTop += delta;
      }
    };

    scrollToBottom();
    // Una segunda medición cubre los layouts que reajustan la altura al pintar.
    const frame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [containerRef, rowCount]);

  return scrollToNewRow;
}
