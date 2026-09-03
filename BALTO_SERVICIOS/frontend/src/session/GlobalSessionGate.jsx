import React, { useCallback, useEffect, useState } from "react";
import BaltoCargaGif from "../imagenes/Balto_Carga.gif";
import {
  clearClientSession,
  getSessionKey,
  isDefinitiveSessionFailure,
  redirectToCentralAccess,
  storeValidatedUser,
  validateServicesSession,
} from "./sessionClient";

export default function GlobalSessionGate({ children }) {
  const [state, setState] = useState({ status: "checking", message: "" });

  const leaveServices = useCallback(() => {
    clearClientSession();
    redirectToCentralAccess();
  }, []);

  const verify = useCallback(async () => {
    if (!getSessionKey()) {
      leaveServices();
      return;
    }

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
      setState({ status: "ready", message: "" });
    } catch {
      setState({
        status: "error",
        message:
          "No se pudo contactar la API de BALTO_SERVICIOS para validar la sesión. Revisá la conexión e intentá nuevamente.",
      });
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
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#fff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ textAlign: "center", padding: 24 }}>
        <img
          src={BaltoCargaGif}
          alt=""
          aria-hidden="true"
          style={{ display: "block", width: "min(180px, 42vw)", height: "auto", margin: "0 auto 14px" }}
        />
        <div style={{ fontWeight: 600 }}>Abriendo BALTO Servicios…</div>
      </div>
    </div>
  );
}
