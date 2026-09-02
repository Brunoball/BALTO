import { useEffect, useRef, useState } from "react";
import { toFiniteNumber } from "../utils/dashboardUtils";

export default function useCountUp(value, { duration = 850 } = {}) {
  const target = toFiniteNumber(value);
  const [displayValue, setDisplayValue] = useState(0);
  const displayRef = useRef(0);
  const frameRef = useRef(null);

  useEffect(() => {
    const getNow = () =>
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    const requestFrame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(() => callback(getNow()), 16);

    const cancelFrame =
      typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (frameRef.current) cancelFrame(frameRef.current);

    const startValue = displayRef.current;
    const endValue = target;

    if (reduceMotion || startValue === endValue) {
      displayRef.current = endValue;
      setDisplayValue(endValue);
      return undefined;
    }

    const startedAt = getNow();
    const distance = endValue - startValue;

    const tick = (now) => {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = startValue + distance * eased;

      displayRef.current = nextValue;
      setDisplayValue(nextValue);

      if (progress < 1) {
        frameRef.current = requestFrame(tick);
      } else {
        displayRef.current = endValue;
        setDisplayValue(endValue);
      }
    };

    frameRef.current = requestFrame(tick);

    return () => {
      if (frameRef.current) cancelFrame(frameRef.current);
    };
  }, [target, duration]);

  return displayValue;
}
