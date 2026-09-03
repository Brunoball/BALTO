import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faGear } from "@fortawesome/free-solid-svg-icons";
import "./ModalPerfil.css";

function normalizeRolLabel(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "admin" ? "Administrador" : "Vista";
}

function planLabelFromBackend(u) {
  const planNombre = String(u?.plan_nombre ?? "").trim();
  if (planNombre) {
    const clean = planNombre
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return `Plan ${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
  }

  const n = Number(u?.plan_nivel ?? u?.planNivel ?? u?.plan_nivel ?? 1);
  if (n === 2) return "Plan Intermedio";
  if (Number(u?.idPlan ?? u?.id_plan) === 10) return "Plan Demo";
  if (n === 3) return "Plan Pro";
  return "Plan Básico";
}

function formatMySQLDateOnly(value) {
  if (!value) return "-";
  try {
    const raw = String(value).trim();
    if (!raw) return "-";

    const datePart = raw.includes(" ") ? raw.split(" ")[0] : raw;
    const [yyyy, mm, dd] = datePart.split("-").map((x) => Number(x));
    if (!yyyy || !mm || !dd) return datePart;

    const ddStr = String(dd).padStart(2, "0");
    const mmStr = String(mm).padStart(2, "0");
    return `${ddStr}/${mmStr}/${yyyy}`;
  } catch {
    return String(value);
  }
}

export default function ModalPerfil({
  open,
  onClose,
  usuario,
  logoSrc,
  rolUsuario,
  onConfigRequest,
  onLogoutRequest,
}) {
  const closeBtnRef = useRef(null);
  const [logoError, setLogoError] = useState(false);

  const isAdmin =
    String(rolUsuario ?? "").trim().toLowerCase() === "admin";

  useEffect(() => {
    if (!open) return;

    setTimeout(() => closeBtnRef.current?.focus(), 0);

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    setLogoError(false);
  }, [logoSrc, open]);

  const view = useMemo(() => {
    if (!usuario) return null;

    const nombre =
      usuario.Nombre_Completo ||
      usuario.nombre ||
      usuario.user ||
      usuario.usuario ||
      "Usuario";

    const tenantNombre =
      usuario.tenant_nombre ||
      usuario.nombre_empresa ||
      usuario.empresa ||
      "Cliente";

    return {
      nombre,
      tenantNombre,
      idUsuario: usuario.idUsuario ?? "-",
      rol: normalizeRolLabel(usuario.rol),
      plan: planLabelFromBackend(usuario),
      fechaCreacion: formatMySQLDateOnly(usuario.Fecha_Creacion),
    };
  }, [usuario]);

  if (!open || !view) return null;

  const cerrar = () => onClose?.();
  const showLogo = Boolean(logoSrc) && !logoError;

  return (
    <div className="mi-modal__overlay">
      <div
        className="mi-modal__container mi-modal__container--perfil"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perfil-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mi-modal__header">
          <div className="mi-modal__head-left">
            <h2 id="perfil-modal-title" className="mi-modal__title">
              Perfil de usuario
            </h2>
            <p className="mi-modal__subtitle">
              {view.rol} • {view.plan}
            </p>
          </div>

          <button
            ref={closeBtnRef}
            className="mi-modal__close"
            onClick={cerrar}
            aria-label="Cerrar"
            type="button"
            title="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="perfil-body">
          <div className="perfil-inner">
            <div className="perfil-card">
              <div
                className="perfil-logoWrap"
                aria-hidden="true"
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  margin: "0 auto 14px auto",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {showLogo ? (
                  <img
                    src={logoSrc}
                    alt={`Logo principal de ${view.tenantNombre}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      display: "block",
                      padding: "10px",
                    }}
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 22,
                      background: "rgba(255,255,255,0.08)",
                    }}
                  >
                    {String(view.tenantNombre || "C").trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="perfil-who">
                <div className="perfil-name">{view.nombre}</div>
                <div className="perfil-meta">
                  ID Usuario: <b>{view.idUsuario}</b>
                </div>
                <div className="perfil-meta" style={{ marginTop: 6 }}>
                  Empresa: <b>{view.tenantNombre}</b>
                </div>
              </div>
            </div>

            <div className="perfil-grid">
              <div className="perfil-field">
                <div className="perfil-field__label">Rol</div>
                <div className="perfil-field__value">{view.rol}</div>
              </div>

              <div className="perfil-field">
                <div className="perfil-field__label">Plan</div>
                <div className="perfil-field__value">{view.plan}</div>
              </div>

              <div className="perfil-field perfil-field--full">
                <div className="perfil-field__label">Fecha de creación</div>
                <div className="perfil-field__value">{view.fechaCreacion}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mit-actions">
          {isAdmin && (
            <button
              type="button"
              className="mit-btn mit-btn--primary"
              onClick={() => onConfigRequest?.()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <FontAwesomeIcon icon={faGear} />
              Configuración
            </button>
          )}
          <div className="mit-help" />
          <button
            type="button"
            className="mit-btn mit-btn--ghost"
            onClick={cerrar}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
