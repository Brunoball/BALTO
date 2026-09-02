import { useEffect } from "react";
import {
  getLastActivityTs,
  IDLE_MS,
  setLastActivityNow,
} from "../utils/principalUtils";

export default function usePrincipalIdleLogout({ doLogout, idleTimerRef }) {
  useEffect(() => {
    const resetIdle = () => {
      setLastActivityNow();

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      idleTimerRef.current = setTimeout(
        () => doLogout({ silent: true }),
        IDLE_MS
      );
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    events.forEach((ev) =>
      window.addEventListener(ev, resetIdle, { passive: true })
    );

    resetIdle();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      events.forEach((ev) => window.removeEventListener(ev, resetIdle));
    };
  }, [doLogout, idleTimerRef]);

  useEffect(() => {
    const checkExpiredOnWake = () => {
      const last = getLastActivityTs();

      if (!last) return;

      if (Date.now() - last >= IDLE_MS) {
        doLogout({ silent: true });
      }
    };

    const onFocus = () => checkExpiredOnWake();

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkExpiredOnWake();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [doLogout]);
}
