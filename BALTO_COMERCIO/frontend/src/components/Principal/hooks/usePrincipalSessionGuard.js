import { useEffect } from "react";
import {
  isSessionExpiredResponse,
  looksLikeUnauthorizedPayload,
} from "../utils/principalUtils";

export default function usePrincipalSessionGuard(doLogout) {
  useEffect(() => {
    const onUnauthorized = () => doLogout({ silent: true });

    window.addEventListener("auth:unauthorized", onUnauthorized);

    return () => {
      window.removeEventListener("auth:unauthorized", onUnauthorized);
    };
  }, [doLogout]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      try {
        const clone = response.clone();
        const ct = clone.headers.get("content-type") || "";
        let txt = "";

        if (ct.includes("application/json") || ct.includes("text/plain")) {
          txt = await clone.text();
        }

        if (isSessionExpiredResponse(response.status, txt, ct)) {
          try {
            window.dispatchEvent(
              new CustomEvent("auth:unauthorized", {
                detail: { status: response.status, reason: "http-status" },
              })
            );
          } catch {}

          return response;
        }

        if (ct.includes("application/json") || ct.includes("text/plain")) {
          if (looksLikeUnauthorizedPayload(txt, ct)) {
            try {
              window.dispatchEvent(
                new CustomEvent("auth:unauthorized", {
                  detail: { status: 401, reason: "body-message" },
                })
              );
            } catch {}

            return new Response(
              JSON.stringify({ exito: false, mensaje: "Sesión expirada." }),
              {
                status: 401,
                headers: { "Content-Type": "application/json; charset=utf-8" },
              }
            );
          }
        }
      } catch {}

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);
}
