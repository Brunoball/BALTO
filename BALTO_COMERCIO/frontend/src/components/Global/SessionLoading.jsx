import React, { useState } from "react";
import "./SessionLoading.css";

export default function SessionLoading({ text = "Iniciando sesión…" }) {
  const [gifOk, setGifOk] = useState(true);
  const publicBase = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const gifSrc = process.env.REACT_APP_SESSION_LOADING_GIF || `${publicBase}/balto_carga_gif.gif`;

  return (
    <div className="balto-session-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="balto-session-loading__box">
        {gifOk ? (
          <img
            className="balto-session-loading__gif"
            src={gifSrc}
            alt=""
            aria-hidden="true"
            onError={() => setGifOk(false)}
          />
        ) : (
          <span className="balto-session-loading__spinner" aria-hidden="true" />
        )}
        <div className="balto-session-loading__text">{text}</div>
      </div>
    </div>
  );
}
