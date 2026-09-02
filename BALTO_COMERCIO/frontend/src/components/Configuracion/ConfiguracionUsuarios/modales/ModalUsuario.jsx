import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTimes,
  faFloppyDisk,
  faUserPlus,
  faUserPen,
  faUser,
  faEnvelope,
  faLock,
  faShield,
  faPalette,
  faToggleOn,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";

import "./ModalUsuario.css";

function getPasswordStrength(pass) {
  if (!pass) return null;

  let score = 0;

  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;

  if (score <= 1) {
    return {
      label: "Débil",
      color: "#ef4444",
      width: "25%",
      className: "is-weak",
    };
  }

  if (score === 2) {
    return {
      label: "Regular",
      color: "#f59e0b",
      width: "50%",
      className: "is-regular",
    };
  }

  if (score === 3) {
    return {
      label: "Buena",
      color: "#3b82f6",
      width: "75%",
      className: "is-good",
    };
  }

  return {
    label: "Fuerte",
    color: "#22c55e",
    width: "100%",
    className: "is-strong",
  };
}

export default function ModalUsuario({
  abierto,
  form,
  setForm,
  roles,
  saving,
  esEdicion,
  editandoUsuarioActual,
  hasChanges = true,
  saveDisabled = false,
  onSubmit,
  onClose,
}) {
  const [showPassword, setShowPassword] = useState(false);

  const passwordStrength = useMemo(() => {
    return getPasswordStrength(form.contrasena || "");
  }, [form.contrasena]);

  useEffect(() => {
    if (!abierto) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !saving) {
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [abierto, saving, onClose]);

  useEffect(() => {
    if (!abierto) return;

    setShowPassword(false);

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
    };
  }, [abierto]);

  if (!abierto) return null;

  return createPortal(
    <div
      className="mu-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose?.();
      }}
    >
      <div
        className="mu-modal"
        role="dialog"
        aria-modal="true"
        aria-label={esEdicion ? "Editar usuario" : "Agregar usuario"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mu-header">
          <div className="mu-header__icon">
            <FontAwesomeIcon icon={esEdicion ? faUserPen : faUserPlus} />
          </div>

          <div className="mu-header__texts">
            <h2 className="mu-header__title">
              {esEdicion ? "Editar usuario" : "Agregar usuario"}
            </h2>

            <p className="mu-header__subtitle">
              {esEdicion
                ? editandoUsuarioActual
                  ? "Estás editando tu propio usuario."
                  : "Modificá los datos del usuario seleccionado."
                : "Creá un nuevo usuario para este sistema."}
            </p>
          </div>

          <button
            type="button"
            className="mu-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="mu-body">
          {editandoUsuarioActual && (
            <div className="mu-self-note">
              <div className="mu-self-note__icon">
                <FontAwesomeIcon icon={faShield} />
              </div>

              <span>
                Solo podés modificar usuario, email y contraseña de tu propio
                usuario.
              </span>
            </div>
          )}

          <form id="mu-form" onSubmit={onSubmit}>
            <div className="mu-section mu-section--spaced">
              <div className="mu-section__head">
                <div className="mu-section__dot" />
                <span className="mu-section__label">Datos del usuario</span>
              </div>

              <div className="mu-section__body">
                <div className="mu-grid-2">
                  <div className="mu-field mu-col-full">
                    <span className="mu-field__icon">
                      <FontAwesomeIcon icon={faUser} />
                    </span>

                    <input
                      className="mu-input"
                      type="text"
                      placeholder=" "
                      value={form.usuario}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, usuario: e.target.value }))
                      }
                      disabled={saving}
                      autoComplete="off"
                    />

                    <label className="mu-label">Usuario *</label>
                  </div>

                  <div className="mu-field mu-col-full">
                    <span className="mu-field__icon">
                      <FontAwesomeIcon icon={faEnvelope} />
                    </span>

                    <input
                      className="mu-input"
                      type="email"
                      placeholder=" "
                      value={form.email_recuperacion}
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          email_recuperacion: e.target.value,
                        }))
                      }
                      disabled={saving}
                      autoComplete="off"
                    />

                    <label className="mu-label">Email de recuperación</label>
                  </div>

                  <div className="mu-col-full">
                    <div className="mu-field mu-field--password">
                      <span className="mu-field__icon">
                        <FontAwesomeIcon icon={faLock} />
                      </span>

                      <input
                        className="mu-input mu-input--password"
                        type={showPassword ? "text" : "password"}
                        placeholder=" "
                        value={form.contrasena}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            contrasena: e.target.value,
                          }))
                        }
                        disabled={saving}
                        autoComplete="new-password"
                      />

                      <label className="mu-label">
                        {esEdicion
                          ? "Nueva contraseña (opcional)"
                          : "Contraseña *"}
                      </label>

                      <button
                        type="button"
                        className="mu-password-eye"
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={saving}
                        aria-label={
                          showPassword
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                        title={
                          showPassword
                            ? "Ocultar contraseña"
                            : "Mostrar contraseña"
                        }
                      >
                        <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                      </button>
                    </div>

                    {form.contrasena && passwordStrength && (
                      <div className="mu-password-strength">
                        <div className="mu-password-strength__top">
                          <span>Seguridad de la contraseña</span>
                          <strong className={passwordStrength.className}>
                            {passwordStrength.label}
                          </strong>
                        </div>

                        <div className="mu-password-strength__bar">
                          <div
                            className={`mu-password-strength__fill ${passwordStrength.className}`}
                            style={{
                              width: passwordStrength.width,
                              backgroundColor: passwordStrength.color,
                            }}
                          />
                        </div>

                        <p className="mu-password-strength__hint">
                          Usá al menos 8 caracteres, una mayúscula, un número y
                          un símbolo para que sea más segura.
                        </p>
                      </div>
                    )}

                    {esEdicion && (
                      <p className="mu-hint">
                        Dejá el campo vacío para no cambiar la contraseña actual.
                        Si ingresás una nueva, debe tener al menos 6 caracteres.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {!editandoUsuarioActual && (
              <div className="mu-section">
                <div className="mu-section__head">
                  <div className="mu-section__dot mu-section__dot--gray" />
                  <span className="mu-section__label">Configuración</span>
                </div>

                <div className="mu-section__body">
                  <div className="mu-grid-2">
                    <div className="mu-field">
                      <span className="mu-field__icon">
                        <FontAwesomeIcon icon={faShield} />
                      </span>

                      <select
                        className="mu-select"
                        value={form.idRolMaster}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            idRolMaster: e.target.value,
                          }))
                        }
                        disabled={saving || roles.length === 0}
                      >
                        {roles.length === 0 ? (
                          <option value="">Sin roles</option>
                        ) : (
                          roles.map((r) => {
                            const id = r.idRolMaster || r.id_rol;

                            return (
                              <option key={id} value={id}>
                                {r.nombre || r.tipo_rol}
                              </option>
                            );
                          })
                        )}
                      </select>

                      <label className="mu-label">Rol</label>
                    </div>

                    <div className="mu-field">
                      <span className="mu-field__icon">
                        <FontAwesomeIcon icon={faPalette} />
                      </span>

                      <select
                        className="mu-select"
                        value={form.tema}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, tema: e.target.value }))
                        }
                        disabled={saving}
                      >
                        <option value="claro">Claro</option>
                        <option value="oscuro">Oscuro</option>
                      </select>

                      <label className="mu-label">Tema inicial</label>
                    </div>

                    <div className="mu-field">
                      <span className="mu-field__icon">
                        <FontAwesomeIcon icon={faToggleOn} />
                      </span>

                      <select
                        className="mu-select"
                        value={form.activo}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            activo: Number(e.target.value),
                          }))
                        }
                        disabled={saving}
                      >
                        <option value={1}>Activo</option>
                        <option value={0}>Inactivo</option>
                      </select>

                      <label className="mu-label">Estado</label>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>
        </div>

        <div className="mu-footer">
          <span className={`mu-saveHint ${hasChanges ? "is-pending" : ""}`}>
            {hasChanges
              ? "Hay cambios pendientes por guardar."
              : "No hay cambios pendientes."}
          </span>

          <button
            type="button"
            className="mu-btn-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>

          <button
            type="submit"
            form="mu-form"
            className="mu-btn-submit"
            disabled={saveDisabled}
          >
            <FontAwesomeIcon icon={esEdicion ? faFloppyDisk : faUserPlus} />
            {saving
              ? "Guardando..."
              : esEdicion
              ? "Guardar cambios"
              : "Crear usuario"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}