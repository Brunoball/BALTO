import { useCallback, useEffect, useRef, useState } from "react";

export default function useSmoothLoader({
  showDelayMs = 50,
  minVisibleMs = 450,
} = {}) {
  const [visible, setVisible] = useState(false);

  const showTmr = useRef(null);
  const hideTmr = useRef(null);
  const visibleAt = useRef(0);

  const clearTimers = useCallback(() => {
    if (showTmr.current) clearTimeout(showTmr.current);
    if (hideTmr.current) clearTimeout(hideTmr.current);
    showTmr.current = null;
    hideTmr.current = null;
  }, []);

  const begin = useCallback(() => {
    clearTimers();
    showTmr.current = setTimeout(() => {
      visibleAt.current = Date.now();
      setVisible(true);
    }, showDelayMs);
  }, [clearTimers, showDelayMs]);

  const end = useCallback(() => {
    // si todavía no apareció, cancelamos y listo
    if (!visible) {
      clearTimers();
      setVisible(false);
      return;
    }

    clearTimers();
    const elapsed = Date.now() - (visibleAt.current || Date.now());
    const remaining = Math.max(0, minVisibleMs - elapsed);

    hideTmr.current = setTimeout(() => {
      setVisible(false);
    }, remaining);
  }, [visible, clearTimers, minVisibleMs]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  return { visible, begin, end };
}
