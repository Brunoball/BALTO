import { useEffect } from "react";
import { renovarSesionPorActividad } from "../api/principalApi";
import {
  getLastActivityTs,
  IDLE_MS,
  LAST_ACTIVITY_KEY,
  setLastActivityNow,
} from "../utils/principalUtils";

// El usuario se desconecta luego de 60 minutos SIN interacción, aunque la
// pestaña haya dormido. Todas las pestañas de la misma sesión suman actividad.
const TOUCH_THROTTLE_MS = 30 * 1000;
const TOUCH_TRAILING_MS = 2000;

export default function usePrincipalIdleLogout({ doLogout, idleTimerRef }) {
  useEffect(() => {
    let closed = false;
    let touchInFlight = false;
    let lastTouchAttempt = 0;
    let lastActivityWrite = 0;
    let pendingTouchTimer = null;

    const cancelTimers = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (pendingTouchTimer) clearTimeout(pendingTouchTimer);
      idleTimerRef.current = null;
      pendingTouchTimer = null;
    };

    const expire = () => {
      if (closed) return;
      closed = true;
      cancelTimers();
      doLogout({ silent: true });
    };

    const scheduleIdleCheck = () => {
      if (closed) return;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      const last = getLastActivityTs();
      if (last > 0 && Date.now() - last >= IDLE_MS) {
        expire();
        return;
      }
      idleTimerRef.current = setTimeout(
        scheduleIdleCheck,
        last > 0 ? Math.max(100, IDLE_MS - (Date.now() - last)) : IDLE_MS
      );
    };

    const touch = async () => {
      if (closed || touchInFlight) return;
      const last = getLastActivityTs();
      if (!last || Date.now() - last >= IDLE_MS) {
        expire();
        return;
      }

      touchInFlight = true;
      lastTouchAttempt = Date.now();
      try {
        await renovarSesionPorActividad();
      } catch {
        // Cortes transitorios: no cerrar la sesión; un nuevo uso reintenta.
      } finally {
        touchInFlight = false;
      }
    };

    const queueTouch = () => {
      if (closed) return;
      const elapsed = Date.now() - lastTouchAttempt;
      if (!lastTouchAttempt || elapsed >= TOUCH_THROTTLE_MS) {
        if (pendingTouchTimer) clearTimeout(pendingTouchTimer);
        pendingTouchTimer = null;
        void touch();
        return;
      }
      // Refrescamos también cerca de la última interacción para que el backend
      // no venza antes que el contador exacto de 60 minutos del navegador.
      if (pendingTouchTimer) clearTimeout(pendingTouchTimer);
      pendingTouchTimer = setTimeout(() => {
        pendingTouchTimer = null;
        if (Date.now() - lastTouchAttempt >= TOUCH_TRAILING_MS) void touch();
      }, TOUCH_TRAILING_MS);
    };

    const onActivity = (event) => {
      // Eventos sintéticos de componentes/automatizaciones no representan uso humano.
      if (event && event.isTrusted === false) return;
      if (closed) return;
      // No permitir que una interacción tardía reactive una sesión ya vencida.
      const last = getLastActivityTs();
      if (last && Date.now() - last >= IDLE_MS) {
        expire();
        return;
      }

      // Evita escrituras a localStorage por cada pixel del movimiento del mouse.
      if (Date.now() - lastActivityWrite < 1000) return;
      lastActivityWrite = Date.now();
      setLastActivityNow();
      scheduleIdleCheck();
      queueTouch();
    };

    const onWake = () => {
      if (closed) return;
      scheduleIdleCheck(); // foco / visibilidad NO cuentan como actividad.
    };

    const onStorage = (event) => {
      if (event.key === "session_key" && !event.newValue) {
        // Un logout explícito en otra pestaña también invalida ésta.
        expire();
      } else if (event.key === LAST_ACTIVITY_KEY) {
        scheduleIdleCheck();
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "scroll", "wheel", "touchstart", "pointerdown", "input", "popstate"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("storage", onStorage);

    // Carga inicial/navegación: no se revive una sesión con 60 min ya cumplidos.
    const existing = getLastActivityTs();
    if (existing && Date.now() - existing >= IDLE_MS) {
      expire();
    } else {
      onActivity();
    }

    return () => {
      closed = true;
      cancelTimers();
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("storage", onStorage);
    };
  }, [doLogout, idleTimerRef]);
}
