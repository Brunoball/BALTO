// src/components/Global/Gif_Carga.jsx
import React from "react";
import "./gif_carga.css";
import balto from "../../imagenes/Balto_Carga.gif";

export default function GifCarga({ visible = false }) {
  return (
    <div className={`balto-loading-overlay ${visible ? "is-visible" : "is-hidden"}`}>
      <div className="balto-loading-container">
        <img src={balto} alt="Cargando..." className="balto-loading-img" />
        <p className="balto-loading-text">Cargando información</p>
      </div>
    </div>
  );
}
