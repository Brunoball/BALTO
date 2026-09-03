import React from "react";

export default function LogoBalto({ className = "" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 200"
      role="img"
      aria-labelledby="balto-logo-title balto-logo-description"
    >
      <title id="balto-logo-title">BALTO</title>
      <desc id="balto-logo-description">Sistema de gestión empresarial</desc>

      <g transform="translate(162 6)">
        <path
          d="M18 49 7 15l34 18M78 49l11-34-34 18"
          fill="#0a2540"
          stroke="#0a2540"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        <path
          d="M18 40c0-19 13-32 30-32s30 13 30 32v23c0 22-13 38-30 38S18 85 18 63V40Z"
          fill="#0a2540"
        />
        <path
          d="M31 61c5-7 11-10 17-10s12 3 17 10v17c-4 9-10 14-17 14s-13-5-17-14V61Z"
          fill="#ffffff"
        />
        <circle cx="35" cy="44" r="3.5" fill="#ffffff" />
        <circle cx="61" cy="44" r="3.5" fill="#ffffff" />
        <path
          d="M42 65h12l-6 7-6-7Zm6 7v8"
          fill="#0055bb"
          stroke="#0055bb"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <text
        x="210"
        y="146"
        textAnchor="middle"
        fill="#0a2540"
        fontFamily="Inter, Arial, sans-serif"
        fontSize="49"
        fontWeight="800"
        letterSpacing="8"
      >
        BALTO
      </text>
      <text
        x="210"
        y="174"
        textAnchor="middle"
        fill="#425466"
        fontFamily="Inter, Arial, sans-serif"
        fontSize="12"
        fontWeight="600"
        letterSpacing="4"
      >
        GESTIÓN EMPRESARIAL
      </text>
    </svg>
  );
}
