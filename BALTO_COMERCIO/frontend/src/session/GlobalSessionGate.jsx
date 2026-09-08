import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearClientSession,
  consumeDashboardAfterLogin,
  getSessionKey,
  isDefinitiveSessionFailure,
  redirectToCentralAccess,
  storeValidatedUser,
  validateCommerceSession,
} from "./sessionClient";

export default function GlobalSessionGate({ children }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: "checking", message: "" });

  const leaveCommerce = useCallback(() => {
    clearClientSession();
    redirectToCentralAccess();
  }, []);

  const verify = useCallback(async () => {
    if (!getSessionKey()) {
      leaveCommerce();
      return;
    }

    setState({ status: "checking", message: "" });

    try {
      const result = await validateCommerceSession();

      if (!result.ok) {
        if (isDefinitiveSessionFailure(result.status, result.data)) {
          leaveCommerce();
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

      const goToDashboard = consumeDashboardAfterLogin();
      if (goToDashboard) {
        navigate("/panel/dashboard", { replace: true });
      }

      setState({ status: "ready", message: "" });
    } catch {
      setState({
        status: "error",
        message:
          "No se pudo contactar la API de BALTO_COMERCIO para validar la sesión. Revisá la conexión e intentá nuevamente.",
      });
    }
  }, [leaveCommerce, navigate]);

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

      leaveCommerce();
    };

    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, [leaveCommerce]);

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
            <button type="button" onClick={leaveCommerce}>
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
        background: "#f4f7fb",
        fontFamily: "sans-serif",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "min(920px, calc(100vw - 48px))",
          display: "grid",
          gap: 18,
        }}
      >
        <div
          style={{
            height: 54,
            borderRadius: 12,
            background: "linear-gradient(90deg, #e8edf3 25%, #f5f7fa 50%, #e8edf3 75%)",
            backgroundSize: "200% 100%",
            animation: "baltoSessionSkeleton 1.25s ease-in-out infinite",
          }}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              style={{
                height: 108,
                borderRadius: 14,
                background: "linear-gradient(90deg, #e8edf3 25%, #f5f7fa 50%, #e8edf3 75%)",
                backgroundSize: "200% 100%",
                animation: "baltoSessionSkeleton 1.25s ease-in-out infinite",
              }}
            />
          ))}
        </div>
        <div
          style={{
            height: 330,
            borderRadius: 14,
            background: "linear-gradient(90deg, #e8edf3 25%, #f5f7fa 50%, #e8edf3 75%)",
            backgroundSize: "200% 100%",
            animation: "baltoSessionSkeleton 1.25s ease-in-out infinite",
          }}
        />
      </div>
      <style>{`
        @keyframes baltoSessionSkeleton {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @media (max-width: 720px) {
          [aria-busy="true"] > [aria-hidden="true"] > div:nth-child(2) {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
      `}</style>
    </div>
  );
}
