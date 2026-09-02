import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faPlus,
  faPen,
  faTrash,
  faPowerOff,
  faRotateLeft,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

import Toast from "../../Global/Toast";
import { apiFetch, safeJsonParse } from "../api/configuracionApi";
import useConfiguracionToast from "../hooks/useConfiguracionToast";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import ModalUsuario from "./modales/ModalUsuario";
import "./ConfiguracionUsuarios.css";


function normalizarMensajeError(mensaje) {
  const msg = String(mensaje || "").trim();

  if (!msg) return "Ocurrió un error inesperado.";

  const lower = msg.toLowerCase();

  if (
    lower.includes("ya existe un usuario con ese nombre en este tenant") ||
    lower.includes("ya existe un usuario con ese nombre en este sistema") ||
    lower.includes("usuario con ese nombre en este tenant") ||
    lower.includes("usuario con ese nombre en este sistema") ||
    lower.includes("nombre en este tenant") ||
    lower.includes("duplicate entry") ||
    lower.includes("uq_usuario_por_tenant")
  ) {
    return "Ya existe un usuario con ese nombre en este sistema.";
  }

  if (lower.includes("tenant") && lower.includes("usuario") && lower.includes("existe")) {
    return "Ya existe un usuario con ese nombre en este sistema.";
  }

  if (lower.includes("tenant")) {
    return msg.replaceAll("tenant", "sistema").replaceAll("Tenant", "Sistema");
  }

  return msg;
}

function normalizeRolCodigo(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");

  if (["1", "admin", "administrador", "administrator", "superadmin"].includes(v)) {
    return "admin";
  }

  if (["2", "empleado_basico", "empleado", "basico"].includes(v)) {
    return "empleado_basico";
  }

  return v || "empleado_basico";
}

function resolverRolIdDesdeUsuario(usuario, roles = []) {
  const directo =
    usuario?.idRolMaster ||
    usuario?.id_rol ||
    usuario?.rol_id ||
    usuario?.idRol ||
    "";

  if (directo) return String(directo);

  const rolTexto = String(
    usuario?.rol_nombre ||
      usuario?.tipo_rol ||
      usuario?.rol ||
      ""
  )
    .trim()
    .toLowerCase();

  if (!rolTexto) return "";

  const encontrado = roles.find((r) => {
    const id = String(r.idRolMaster || r.id_rol || "");
    const nombre = String(r.nombre || r.tipo_rol || r.codigo || "")
      .trim()
      .toLowerCase();

    return id === rolTexto || nombre === rolTexto;
  });

  return encontrado ? String(encontrado.idRolMaster || encontrado.id_rol) : "";
}

function getStoredCurrentUser() {
  const posiblesKeys = [
    "usuario",
    "user",
    "usuario_master",
    "auth_user",
    "current_user",
    "userData",
    "datos_usuario",
  ];

  const current = {
    idUsuarioMaster: 0,
    usuario: "",
    email_recuperacion: "",
  };

  for (const key of posiblesKeys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    const parsed = safeJsonParse(raw);

    if (parsed && typeof parsed === "object") {
      current.idUsuarioMaster =
        Number(
          parsed.idUsuarioMaster ||
            parsed.id_usuario_master ||
            parsed.idUsuario ||
            parsed.id_usuario ||
            parsed.id
        ) || current.idUsuarioMaster;

      current.usuario = String(
        parsed.usuario ||
          parsed.username ||
          parsed.nombre_usuario ||
          current.usuario ||
          ""
      ).trim();

      current.email_recuperacion = String(
        parsed.email_recuperacion ||
          parsed.email ||
          parsed.correo ||
          current.email_recuperacion ||
          ""
      ).trim();

      continue;
    }

    if (!current.usuario && key === "usuario") {
      current.usuario = String(raw || "").trim();
    }
  }

  current.idUsuarioMaster =
    current.idUsuarioMaster ||
    Number(localStorage.getItem("idUsuarioMaster") || localStorage.getItem("id_usuario_master") || 0) ||
    0;

  return current;
}

const emptyForm = {
  idUsuarioMaster: 0,
  usuario: "",
  email_recuperacion: "",
  contrasena: "",
  idRolMaster: "",
  tema: "claro",
  activo: 1,
};

function crearFormUsuarioBase(rolEmpleadoDefault) {
  return {
    ...emptyForm,
    idRolMaster: rolEmpleadoDefault
      ? String(rolEmpleadoDefault.idRolMaster || rolEmpleadoDefault.id_rol)
      : "",
  };
}

function normalizarFormUsuarioParaComparar(form = {}) {
  return {
    idUsuarioMaster: Number(form.idUsuarioMaster || 0),
    usuario: String(form.usuario || "").trim(),
    email_recuperacion: String(form.email_recuperacion || "").trim(),
    contrasena: String(form.contrasena || ""),
    idRolMaster: String(form.idRolMaster || ""),
    tema: form.tema || "claro",
    activo: Number(form.activo) === 1 ? 1 : 0,
  };
}


function normalizarNombreUsuarioFront(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function claveUsuarioDuplicado(value) {
  return normalizarNombreUsuarioFront(value).toLocaleLowerCase("es-AR");
}

function buscarUsuarioDuplicadoLocal(usuarios = [], usuarioBuscado = "", idUsuarioActual = 0) {
  const claveBuscada = claveUsuarioDuplicado(usuarioBuscado);
  const idActual = Number(idUsuarioActual || 0);

  if (!claveBuscada) return null;

  return (
    usuarios.find((u) => {
      const idFila = Number(u?.idUsuarioMaster || u?.id_usuario_master || 0);
      return idFila !== idActual && claveUsuarioDuplicado(u?.usuario) === claveBuscada;
    }) || null
  );
}

function crearFormUsuarioDesdeRegistro(usuario, roles = []) {
  return {
    idUsuarioMaster: Number(usuario.idUsuarioMaster || usuario.id_usuario_master || 0),
    usuario: usuario.usuario || "",
    email_recuperacion: usuario.email_recuperacion || "",
    contrasena: "",
    idRolMaster: resolverRolIdDesdeUsuario(usuario, roles),
    tema: usuario.tema || "claro",
    activo: Number(usuario.activo) === 1 ? 1 : 0,
  };
}

export default function ConfiguracionUsuarios() {
  const navigate = useNavigate();

  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [usuarioActual, setUsuarioActual] = useState(getStoredCurrentUser());

  const [form, setForm] = useState(emptyForm);
  const [formInicial, setFormInicial] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const [modalUsuarioAbierto, setModalUsuarioAbierto] = useState(false);
  const [usuarioAEliminar, setUsuarioAEliminar] = useState(null);
  const [usuarioACambiarEstado, setUsuarioACambiarEstado] = useState(null);

  const [editandoUsuarioActualFijo, setEditandoUsuarioActualFijo] = useState(false);
  const { toast, setToast, mostrarToast } = useConfiguracionToast({
    defaultDuration: 2800,
    fallbackMessage: "Ocurrió un error inesperado.",
    normalizeMessage: normalizarMensajeError,
  });

  const esEdicion = Number(form.idUsuarioMaster || 0) > 0;

  const rolEmpleadoDefault = useMemo(() => {
    return roles.find((r) => normalizeRolCodigo(r.codigo || r.tipo_rol) === "empleado_basico") || roles[0] || null;
  }, [roles]);

  // El modal puede abrirse unas décimas antes de que termine `cargar()`. En ese
  // caso el <select> llega a mostrar visualmente el primer rol, pero el value
  // controlado sigue siendo "" y el botón Guardar queda deshabilitado para
  // siempre. Cuando los roles llegan, completamos únicamente un alta que todavía
  // no tenga rol elegido y mantenemos sincronizado el snapshot inicial.
  useEffect(() => {
    if (!modalUsuarioAbierto || esEdicion || !rolEmpleadoDefault) return;

    const defaultRoleId = String(
      rolEmpleadoDefault.idRolMaster || rolEmpleadoDefault.id_rol || ""
    );
    if (!defaultRoleId) return;

    setForm((prev) => (
      String(prev.idRolMaster || "")
        ? prev
        : { ...prev, idRolMaster: defaultRoleId }
    ));
    setFormInicial((prev) => (
      String(prev.idRolMaster || "")
        ? prev
        : { ...prev, idRolMaster: defaultRoleId }
    ));
  }, [modalUsuarioAbierto, esEdicion, rolEmpleadoDefault]);

  const cargar = useCallback(async () => {
    setLoading(true);

    try {
      const res = await apiFetch({ action: "configuracion_usuarios_listar" });
      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(normalizarMensajeError(data?.mensaje || "No se pudieron cargar los usuarios."));
      }

      const usuariosApi = Array.isArray(data.usuarios) ? data.usuarios : [];
      const rolesApi = Array.isArray(data.roles) ? data.roles : [];

      setUsuarios(usuariosApi);
      setRoles(rolesApi);

      const actualApi =
        data.usuario_actual ||
        data.usuarioActual ||
        data.current_user ||
        data.usuarioLogueado ||
        data.usuario_logueado ||
        null;

      if (actualApi && typeof actualApi === "object") {
        setUsuarioActual((prev) => ({
          idUsuarioMaster:
            Number(
              actualApi.idUsuarioMaster ||
                actualApi.id_usuario_master ||
                actualApi.idUsuario ||
                actualApi.id_usuario ||
                actualApi.id ||
                prev.idUsuarioMaster
            ) || 0,
          usuario: String(actualApi.usuario || actualApi.username || prev.usuario || "").trim(),
          email_recuperacion: String(
            actualApi.email_recuperacion ||
              actualApi.email ||
              actualApi.correo ||
              prev.email_recuperacion ||
              ""
          ).trim(),
        }));
      }
    } catch (e) {
      mostrarToast("error", e?.message || "Error cargando usuarios.", 4200);
    } finally {
      setLoading(false);
    }
  }, [mostrarToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const rolesById = useMemo(() => {
    const map = new Map();
    roles.forEach((r) => {
      map.set(Number(r.idRolMaster || r.id_rol), r);
    });
    return map;
  }, [roles]);

  const esUsuarioActualPorObjeto = useCallback(
    (u) => {
      const idFila = Number(
        u?.idUsuarioMaster ||
          u?.id_usuario_master ||
          u?.idUsuario ||
          u?.id_usuario ||
          0
      );
      const idActual = Number(usuarioActual.idUsuarioMaster || 0);
      return idActual > 0 && idFila > 0 && idActual === idFila;
    },
    [usuarioActual.idUsuarioMaster]
  );

  const editandoUsuarioActual = esEdicion && editandoUsuarioActualFijo;

  const modalHasChanges = useMemo(() => {
    return (
      JSON.stringify(normalizarFormUsuarioParaComparar(form)) !==
      JSON.stringify(normalizarFormUsuarioParaComparar(formInicial))
    );
  }, [form, formInicial]);

  const modalSaveDisabled = useMemo(() => {
    const usuario = normalizarNombreUsuarioFront(form.usuario);
    const contrasena = String(form.contrasena || "");
    const rolActual = Number(form.idRolMaster || 0);

    if (saving || !modalHasChanges) return true;
    if (!usuario) return true;
    if (!rolActual) return true;
    if (!esEdicion && contrasena.length < 6) return true;
    if (esEdicion && contrasena && contrasena.length < 6) return true;
    if (!editandoUsuarioActual && roles.length === 0) return true;

    return false;
  }, [form, saving, modalHasChanges, esEdicion, editandoUsuarioActual, roles.length]);

  const resetForm = useCallback(() => {
    const formBase = crearFormUsuarioBase(rolEmpleadoDefault);
    setForm(formBase);
    setFormInicial(formBase);
    setEditandoUsuarioActualFijo(false);
  }, [rolEmpleadoDefault]);

  const cerrarModalUsuario = useCallback(() => {
    if (saving) return;
    setModalUsuarioAbierto(false);
    resetForm();
  }, [saving, resetForm]);

  const abrirCrear = useCallback(() => {
    const formBase = crearFormUsuarioBase(rolEmpleadoDefault);
    setEditandoUsuarioActualFijo(false);
    setForm(formBase);
    setFormInicial(formBase);
    setModalUsuarioAbierto(true);
  }, [rolEmpleadoDefault]);

  const abrirEditar = useCallback(
    (u) => {
      const esActual = esUsuarioActualPorObjeto(u);
      const formEdicion = crearFormUsuarioDesdeRegistro(u, roles);
      setEditandoUsuarioActualFijo(esActual);
      setForm(formEdicion);
      setFormInicial(formEdicion);
      setModalUsuarioAbierto(true);
    },
    [esUsuarioActualPorObjeto, roles]
  );

  const guardar = async (e) => {
    e.preventDefault();
    if (modalSaveDisabled) return;

    setSaving(true);

    try {
      const usuario = normalizarNombreUsuarioFront(form.usuario);
      const email = String(form.email_recuperacion || "").trim();
      const contrasena = String(form.contrasena || "");
      const rolActual = Number(form.idRolMaster || 0);

      if (!usuario) throw new Error("Ingresá el nombre de usuario.");

      const duplicadoLocal = buscarUsuarioDuplicadoLocal(
        usuarios,
        usuario,
        Number(form.idUsuarioMaster || 0)
      );

      if (duplicadoLocal) {
        throw new Error("Ya existe un usuario con ese nombre en este sistema.");
      }

      if (!esEdicion && contrasena.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
      if (esEdicion && contrasena && contrasena.length < 6) throw new Error("La nueva contraseña debe tener al menos 6 caracteres.");
      if (!rolActual) throw new Error("No se pudo detectar el rol actual del usuario. Cerrá el modal y volvé a abrir la edición.");

      const payload = {
        idUsuarioMaster: Number(form.idUsuarioMaster || 0),
        usuario,
        email_recuperacion: email,
        id_rol: rolActual,
        idRolMaster: rolActual,
        tema: form.tema || "claro",
        activo: Number(form.activo) === 1 ? 1 : 0,
      };

      if (contrasena) payload.contrasena = contrasena;

      const res = await apiFetch(
        { action: "configuracion_usuarios_guardar" },
        { method: "POST", body: JSON.stringify(payload) }
      );

      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(normalizarMensajeError(data?.mensaje || "No se pudo guardar el usuario."));
      }

      mostrarToast("exito", data.mensaje || "Usuario guardado correctamente.", 2800);
      setModalUsuarioAbierto(false);
      resetForm();
      await cargar();
    } catch (e2) {
      mostrarToast("error", e2?.message || "Error guardando usuario.", 4200);
    } finally {
      setSaving(false);
    }
  };

  const pedirCambioEstado = (u) => {
    if (esUsuarioActualPorObjeto(u)) {
      mostrarToast("advertencia", "No podés cambiar el estado del usuario con el que estás conectado actualmente.", 4200);
      return;
    }
    setUsuarioACambiarEstado(u);
  };

  const confirmarCambioEstado = async () => {
    if (!usuarioACambiarEstado) return;
    setChangingStatus(true);

    try {
      const nuevo = Number(usuarioACambiarEstado.activo) === 1 ? 0 : 1;
      const res = await apiFetch(
        { action: "configuracion_usuarios_estado" },
        {
          method: "POST",
          body: JSON.stringify({
            idUsuarioMaster: usuarioACambiarEstado.idUsuarioMaster || usuarioACambiarEstado.id_usuario_master,
            activo: nuevo,
          }),
        }
      );
      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(normalizarMensajeError(data?.mensaje || "No se pudo cambiar el estado."));
      }

      setUsuarioACambiarEstado(null);
      await cargar();
    } finally {
      setChangingStatus(false);
    }
  };

  const pedirEliminar = (u) => {
    if (esUsuarioActualPorObjeto(u)) {
      mostrarToast("advertencia", "No podés eliminar el usuario con el que estás conectado actualmente.", 4200);
      return;
    }
    setUsuarioAEliminar(u);
  };

  const confirmarEliminar = async () => {
    if (!usuarioAEliminar) return;
    setDeleting(true);

    try {
      const res = await apiFetch(
        { action: "configuracion_usuarios_eliminar" },
        {
          method: "POST",
          body: JSON.stringify({
            idUsuarioMaster: usuarioAEliminar.idUsuarioMaster || usuarioAEliminar.id_usuario_master,
          }),
        }
      );
      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(normalizarMensajeError(data?.mensaje || "No se pudo eliminar el usuario."));
      }

      setUsuarioAEliminar(null);

      if (Number(form.idUsuarioMaster) === Number(usuarioAEliminar.idUsuarioMaster || usuarioAEliminar.id_usuario_master)) {
        resetForm();
        setModalUsuarioAbierto(false);
      }

      await cargar();
    } finally {
      setDeleting(false);
    }
  };

  const detallesEliminar = useMemo(() => {
    if (!usuarioAEliminar) return [];
    const rol = rolesById.get(Number(usuarioAEliminar.idRolMaster || usuarioAEliminar.id_rol));
    const activo = Number(usuarioAEliminar.activo) === 1;
    return [
      { label: "Usuario", value: usuarioAEliminar.usuario || "—" },
      { label: "Rol", value: rol?.nombre || rol?.tipo_rol || usuarioAEliminar.rol_nombre || usuarioAEliminar.tipo_rol || usuarioAEliminar.rol || "—" },
      { label: "Email", value: usuarioAEliminar.email_recuperacion || "—" },
      { label: "Estado", value: activo ? "Activo" : "Inactivo" },
    ];
  }, [usuarioAEliminar, rolesById]);

  const detallesCambioEstado = useMemo(() => {
    if (!usuarioACambiarEstado) return [];
    const rol = rolesById.get(Number(usuarioACambiarEstado.idRolMaster || usuarioACambiarEstado.id_rol));
    const activo = Number(usuarioACambiarEstado.activo) === 1;
    return [
      { label: "Usuario", value: usuarioACambiarEstado.usuario || "—" },
      { label: "Rol", value: rol?.nombre || rol?.tipo_rol || usuarioACambiarEstado.rol_nombre || usuarioACambiarEstado.tipo_rol || usuarioACambiarEstado.rol || "—" },
      { label: "Email", value: usuarioACambiarEstado.email_recuperacion || "—" },
      { label: "Estado actual", value: activo ? "Activo" : "Inactivo" },
      { label: "Nuevo estado", value: activo ? "Inactivo" : "Activo" },
    ];
  }, [usuarioACambiarEstado, rolesById]);

  const usuarioCambioActivo = Number(usuarioACambiarEstado?.activo) === 1;
  const tituloCambioEstado = usuarioCambioActivo ? "Dar de baja usuario" : "Activar usuario";
  const mensajeCambioEstado = usuarioCambioActivo
    ? `¿Seguro que querés dar de baja el usuario "${usuarioACambiarEstado?.usuario || ""}"?`
    : `¿Seguro que querés activar el usuario "${usuarioACambiarEstado?.usuario || ""}"?`;

  return (
    <section className="cfg-users-page">
      {toast && (
        <Toast
          key={toast.key}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      {/* ── HERO ── */}
      <div className="cfg-users-hero">
        <div className="cfg-users-hero__icon">
          <FontAwesomeIcon icon={faUsers} />
        </div>

        <div className="cfg-users-hero__content">
          <div className="cfg-users-hero__eyebrow">Configuración global</div>
          <h1 className="cfg-users-title">Usuarios del sistema</h1>
          <p className="cfg-users-subtitle">
            Gestioná los usuarios del sistema actual. Los roles se obtienen desde la base master.
          </p>
        </div>

        <div className="cfg-users-hero__side">
          <button className="cfg-users-hero-add" type="button" onClick={abrirCrear}>
            <span className="cfg-users-hero-add__iconWrap">
              <FontAwesomeIcon icon={faPlus} />
            </span>
            <span className="cfg-users-hero-add__text">Agregar usuario</span>
          </button>
          <button
            className="mov-btn mov-btn--primary"
            type="button"
            onClick={() => navigate("/panel/configuracion")}
          >
            <FontAwesomeIcon icon={faArrowLeft} />
            Volver
          </button>


        </div>
      </div>

      <div className="cfg-users-contentScroll">
        {/* ── GRID ── */}
        <div className="cfg-users-metaGrid">

        {/* Tarjeta — tabla de usuarios */}
        <div className="cfg-users-metaCard cfg-users-metaCard--full">
          <div className="cfg-users-metaCard__top">
            <div className="cfg-users-metaCard__icon">
              <FontAwesomeIcon icon={faUsers} />
            </div>
            <div className="cfg-users-metaCard__head">
              <h2>Usuarios creados</h2>
              <p>Listado de todos los usuarios registrados en este sistema.</p>
            </div>
            <span className="cfg-users-count" style={{ marginLeft: "auto" }}>
              {usuarios.length} usuario{usuarios.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <div className="cfg-users-empty">Cargando usuarios...</div>
          ) : usuarios.length === 0 ? (
            <div className="cfg-users-empty">Todavía no hay usuarios en este sistema.</div>
          ) : (
            <div className="cfg-users-tableWrap">
              <table className="cfg-users-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Email</th>
                    <th>Estado</th>
                    <th className="cfg-users-actions-th">Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {usuarios.map((u) => {
                    const idUsuario = Number(u.idUsuarioMaster || u.id_usuario_master || 0);
                    const rol = rolesById.get(Number(u.idRolMaster || u.id_rol));
                    const actual = esUsuarioActualPorObjeto(u);
                    const activo = Number(u.activo) === 1;

                    return (
                      <tr key={idUsuario || u.usuario} className={actual ? "cfg-users-current-row" : ""}>
                        <td>
                          <div className="cfg-users-userCell">
                            <span>{u.usuario}</span>
                            {actual && (
                              <span className="cfg-users-current-badge" title="Usuario actual">
                                Vos
                              </span>
                            )}
                          </div>
                        </td>

                        <td>{rol?.nombre || rol?.tipo_rol || u.rol_nombre || u.tipo_rol || u.rol || "-"}</td>

                        <td>{u.email_recuperacion || "-"}</td>

                        <td>
                          <span className={`cfg-users-pill ${activo ? "is-active" : "is-inactive"}`}>
                            {activo ? "Activo" : "Inactivo"}
                          </span>
                        </td>

                        <td className="cfg-users-rowActions">
                          <button
                            type="button"
                            className="cfg-users-icon-btn"
                            onClick={() => abrirEditar(u)}
                            title="Editar usuario"
                            aria-label="Editar usuario"
                          >
                            <FontAwesomeIcon icon={faPen} />
                          </button>

                          <button
                            type="button"
                            className="cfg-users-icon-btn"
                            onClick={() => pedirCambioEstado(u)}
                            disabled={actual}
                            title={actual ? "No podés cambiar el estado del usuario actual" : activo ? "Dar de baja" : "Activar"}
                            aria-label={activo ? "Dar de baja" : "Activar"}
                          >
                            <FontAwesomeIcon icon={activo ? faPowerOff : faRotateLeft} />
                          </button>

                          <button
                            type="button"
                            className="cfg-users-icon-btn cfg-users-icon-btn--danger"
                            onClick={() => pedirEliminar(u)}
                            disabled={actual}
                            title={actual ? "No podés eliminar el usuario actual" : "Eliminar usuario"}
                            aria-label="Eliminar usuario"
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── MODALES ── */}
      <ModalUsuario
        abierto={modalUsuarioAbierto}
        form={form}
        setForm={setForm}
        roles={roles}
        saving={saving}
        esEdicion={esEdicion}
        editandoUsuarioActual={editandoUsuarioActual}
        hasChanges={modalHasChanges}
        saveDisabled={modalSaveDisabled}
        onSubmit={guardar}
        onClose={cerrarModalUsuario}
      />

      <ModalEliminar
        open={!!usuarioACambiarEstado}
        row={usuarioACambiarEstado}
        loading={changingStatus}
        onClose={() => setUsuarioACambiarEstado(null)}
        onConfirm={confirmarCambioEstado}
        onToast={mostrarToast}
        title={tituloCambioEstado}
        message={mensajeCambioEstado}
        warning={
          usuarioCambioActivo
            ? "El usuario no podrá ingresar al sistema mientras esté inactivo."
            : "El usuario volverá a tener acceso al sistema."
        }
        loadingMessage={usuarioCambioActivo ? "Dando de baja usuario…" : "Activando usuario…"}
        successMessage={usuarioCambioActivo ? "Usuario dado de baja correctamente." : "Usuario activado correctamente."}
        errorMessage="No se pudo cambiar el estado del usuario."
        confirmLabel={usuarioCambioActivo ? "Dar de baja" : "Activar"}
        cancelLabel="Cancelar"
        confirmVariant={usuarioCambioActivo ? "danger" : "primary"}
        details={detallesCambioEstado}
      />

      <ModalEliminar
        open={!!usuarioAEliminar}
        row={usuarioAEliminar}
        loading={deleting}
        onClose={() => setUsuarioAEliminar(null)}
        onConfirm={confirmarEliminar}
        onToast={mostrarToast}
        title="Eliminar usuario"
        message={`¿Seguro que querés eliminar el usuario "${usuarioAEliminar?.usuario || ""}"?`}
        warning="Esta acción no se puede deshacer."
        loadingMessage="Eliminando usuario…"
        successMessage="Usuario eliminado correctamente."
        errorMessage="No se pudo eliminar el usuario."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        details={detallesEliminar}
      />
    </section>
  );
}