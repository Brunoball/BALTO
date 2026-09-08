import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearClientSession,
  consumeDashboardAfterLogin,
  getSessionKey,
  isDefinitiveSessionFailure,
  redirectToCentralAccess,
  storeValidatedUser,
  validateServicesSession,
} from "./sessionClient";

/*
 * La validación MASTER se hace una sola vez por documento/sesión.
 * Las navegaciones internas no deben desmontar el panel ni mostrar
 * nuevamente el skeleton global de autenticación.
 */
let validatedSessionKey = "";

export default function GlobalSessionGate({ children }) {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  const verifyingRef = useRef(false);

  const currentSessionKey = getSessionKey();
  const [state, setState] = useState(() => ({
    status:
      currentSessionKey && validatedSessionKey === currentSessionKey
        ? "ready"
        : "checking",
    message: "",
  }));

  /*
   * useNavigate puede cambiar de identidad cuando cambia la ubicación.
   * Guardarlo en un ref evita que eso vuelva a disparar verify() en cada
   * navegación interna.
   */
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const leaveServices = useCallback(() => {
    validatedSessionKey = "";
    clearClientSession();
    redirectToCentralAccess();
  }, []);

  const verify = useCallback(async () => {
    const sessionKey = getSessionKey();

    if (!sessionKey) {
      leaveServices();
      return;
    }

    /*
     * Si esta sesión ya fue validada en este documento, mantenemos el panel
     * visible. Cada módulo conserva su propio estado/skeleton de carga.
     */
    if (validatedSessionKey === sessionKey) {
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "ready", message: "" }
      );
      return;
    }

    if (verifyingRef.current) return;
    verifyingRef.current = true;

    setState({ status: "checking", message: "" });

    try {
      const result = await validateServicesSession();

      if (!result.ok) {
        if (isDefinitiveSessionFailure(result.status, result.data)) {
          leaveServices();
          return;
        }

        const message =
          result.data?.mensaje ||
          result.data?.error ||
          `No se pudo validar la sesión (HTTP ${result.status || 0}).`;

        setState({ status: "error", message });
        return;
      }

      storeValidatedUser(result.data?.usuario);
      validatedSessionKey = sessionKey;

      const goToDashboard = consumeDashboardAfterLogin();
      const browserPath = String(window.location.pathname || "").replace(/\/+$/, "");
      if (goToDashboard && !browserPath.endsWith("/panel/dashboard")) {
        navigateRef.current("/panel/dashboard", { replace: true });
      }

      setState({ status: "ready", message: "" });
    } catch {
      setState({
        status: "error",
        message:
          "No se pudo contactar la API de BALTO_SERVICIOS para validar la sesión. Revisá la conexión e intentá nuevamente.",
      });
    } finally {
      verifyingRef.current = false;
    }
  }, [leaveServices]);

  useEffect(() => {
    verify();
  }, [verify]);

  useEffect(() => {
    const onUnauthorized = (event) => {
      const status = Number(event?.detail?.status || 0);
      if (status !== 401) return;

      try {
        event.stopImmediatePropagation();
      } catch {}

      leaveServices();
    };

    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, [leaveServices]);

  if (state.status === "ready") return children;

  if (state.status === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#f4f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: "min(560px, 100%)",
            background: "white",
            border: "1px solid #dbe2ea",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 12px 32px rgba(15, 23, 42, .08)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>No se pudo validar la sesión</h2>
          <p>{state.message}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={verify}>
              Reintentar
            </button>
            <button type="button" onClick={leaveServices}>
              Volver al acceso BALTO
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Cargando BALTO Servicios"
      style={{
        minHeight: "100vh",
        padding: "24px",
        background: "#f4f7fb",
        fontFamily: "sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "min(1180px, 100%)",
          margin: "0 auto",
          display: "grid",
          gap: 18,
        }}
      >
        <div
          style={{
            width: "min(320px, 46%)",
            height: 34,
            borderRadius: 10,
            background: "#e5eaf0",
          }}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 14,
          }}
        >
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              style={{
                height: 112,
                borderRadius: 14,
                background: "#e5eaf0",
              }}
            />
          ))}
        </div>

        <div
          style={{
            height: "min(420px, 48vh)",
            minHeight: 250,
            borderRadius: 14,
            background: "#e5eaf0",
          }}
        />
      </div>
    </div>
  );
}
