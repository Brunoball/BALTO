import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBan,
  faBoxOpen,
  faListCheck,
  faMagnifyingGlass,
  faPenToSquare,
  faPlus,
  faRotateLeft,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import "../../Global/Global_css/Global_Section.css";
import "../../Global/Global_css/Global_oscuro.css";
import "../../Global/Global_css/GlobalsModalsV2.css";
import "../../Servicios/Servicios.css";
import "./ConfiguracionListasCategorias.css";
import Toast from "../../Global/Toast";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import ModalUnidad from "../../Servicios/modales/ModalUnidad";
import ModalAgregarCategoria from "../../Servicios/modales/ModalAgregarCategoria";
import * as configuracionApi from "../api/configuracionApi";
import ModalDetalleLista from "./ModalDetalleLista";

const TABS = [
  { value: "detalles", label: "Detalles" },
  { value: "unidades", label: "Unidades" },
  { value: "categorias_servicios", label: "Cat. servicios", grupo: "SERVICIO", singular: "categoría de servicio" },
  { value: "categorias_materiales", label: "Cat. materiales", grupo: "MATERIAL", singular: "categoría de material" },
  { value: "categorias_insumos", label: "Cat. insumos", grupo: "INSUMO", singular: "categoría de insumo" },
];

const ESTADOS = [
  { value: "1", label: "Activos" },
  { value: "0", label: "Bajas" },
];

const isCategoriaTab = (value) => String(value || "").startsWith("categorias_");
const tabMeta = (value) => TABS.find((item) => item.value === value) || TABS[0];

function rowId(tab, row) {
  if (tab === "detalles") return row.id_detalle;
  if (tab === "unidades") return row.id_unidad;
  return row.id_categoria;
}

function cantidadUsosCategoria(tab, row) {
  if (tab === "categorias_servicios") return Number(row.cantidad_servicios || 0);
  return Number(row.cantidad_articulos || 0);
}

export default function ConfiguracionListasCategorias() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("detalles");
  const [estado, setEstado] = useState("1");
  const [buscar, setBuscar] = useState("");
  const [data, setData] = useState({
    detalles: [],
    unidades: [],
    categorias_servicios: [],
    categorias_materiales: [],
    categorias_insumos: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ kind: null, item: null });
  const [deleteModal, setDeleteModal] = useState({ kind: null, item: null });
  const [statusModal, setStatusModal] = useState({ kind: null, item: null });
  const [toast, setToast] = useState(null);

  const notify = useCallback((tipo, mensaje, duracion = 3800) => {
    setToast({ key: Date.now(), tipo, mensaje, duracion });
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // Una sola ida al backend: evita repetir autenticación/bootstrap del tenant
      // cinco veces cada vez que se abre esta pantalla.
      const resumen = await configuracionApi.listarResumenListasCategoriasConfiguracion({ activo: "todos" });

      setData({
        detalles: resumen?.detalles || [],
        unidades: resumen?.unidades || [],
        categorias_servicios: resumen?.categorias_servicios || [],
        categorias_materiales: resumen?.categorias_materiales || [],
        categorias_insumos: resumen?.categorias_insumos || [],
      });
    } catch (error) {
      notify("error", error?.message || "No se pudieron cargar las listas y categorías.", 5000);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const rows = useMemo(() => {
    const q = buscar.trim().toLocaleUpperCase("es-AR");
    return (data[tab] || []).filter((row) => {
      if (Number(row.activo) !== Number(estado)) return false;
      if (!q) return true;
      return [row.nombre, row.simbolo, row.descripcion]
        .some((value) => String(value || "").toLocaleUpperCase("es-AR").includes(q));
    });
  }, [buscar, data, estado, tab]);

  const actualizarFilaLocal = useCallback((kind, id, updater) => {
    setData((prev) => ({
      ...prev,
      [kind]: (prev[kind] || []).map((row) => (
        Number(rowId(kind, row)) === Number(id) ? updater(row) : row
      )),
    }));
  }, []);

  const guardarFilaLocal = useCallback((kind, row) => {
    if (!row) return;
    const id = rowId(kind, row);
    if (id === undefined || id === null || id === "") return;
    setData((prev) => {
      const current = prev[kind] || [];
      const existing = current.find((item) => Number(rowId(kind, item)) === Number(id));
      const merged = existing ? { ...existing, ...row } : row;
      const next = existing
        ? current.map((item) => Number(rowId(kind, item)) === Number(id) ? merged : item)
        : [...current, merged];

      next.sort((a, b) => {
        const activeDiff = Number(b.activo || 0) - Number(a.activo || 0);
        if (activeDiff !== 0) return activeDiff;
        return String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" });
      });

      return { ...prev, [kind]: next };
    });
  }, []);

  const eliminarFilaLocal = useCallback((kind, id) => {
    setData((prev) => ({
      ...prev,
      [kind]: (prev[kind] || []).filter((row) => Number(rowId(kind, row)) !== Number(id)),
    }));
  }, []);

  const ejecutar = async (operation, successMessage, applyResult) => {
    setSaving(true);
    try {
      const result = await operation();
      applyResult?.(result);
      if (successMessage) notify("exito", successMessage);
      return result;
    } catch (error) {
      notify("error", error?.message || "No se pudo completar la operación.", 5000);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const guardarDetalle = async (payload) => {
    const editing = Boolean(modal.item?.id_detalle);
    try {
      await ejecutar(
        () => editing
          ? configuracionApi.actualizarDetalleConfiguracion(payload)
          : configuracionApi.crearDetalleConfiguracion(payload),
        editing ? "Detalle actualizado correctamente." : "Detalle creado correctamente.",
        (result) => guardarFilaLocal("detalles", {
          ...(result?.detalle || {}),
          cantidad_usos: editing ? (modal.item?.cantidad_usos || 0) : 0,
        })
      );
      setModal({ kind: null, item: null });
    } catch {}
  };

  const guardarUnidad = async (payload) => {
    const editing = Boolean(modal.item?.id_unidad);
    try {
      await ejecutar(
        () => editing
          ? configuracionApi.actualizarUnidadConfiguracion(payload)
          : configuracionApi.crearUnidadConfiguracion(payload),
        editing ? "Unidad actualizada correctamente." : "Unidad creada correctamente.",
        (result) => guardarFilaLocal("unidades", result?.unidad)
      );
      setModal({ kind: null, item: null });
    } catch {}
  };

  const guardarCategoria = async (payload) => {
    const meta = tabMeta(modal.kind || tab);
    const editing = Boolean(modal.item?.id_categoria);
    const body = editing ? { ...payload, id_categoria: modal.item.id_categoria } : payload;
    try {
      await ejecutar(
        () => editing
          ? configuracionApi.actualizarCategoriaServiciosConfiguracion(meta.grupo, body)
          : configuracionApi.crearCategoriaServiciosConfiguracion(meta.grupo, body),
        editing ? "Categoría actualizada correctamente." : "Categoría creada correctamente.",
        (result) => {
          const usageField = meta.grupo === "SERVICIO" ? "cantidad_servicios" : "cantidad_articulos";
          guardarFilaLocal(modal.kind || tab, {
            ...(result?.categoria || {}),
            [usageField]: editing ? (modal.item?.[usageField] || 0) : 0,
          });
        }
      );
      setModal({ kind: null, item: null });
    } catch {}
  };

  const alternarEstado = (row) => {
    setStatusModal({ kind: tab, item: row });
  };

  const confirmarCambioEstado = async () => {
    const { kind, item } = statusModal;
    if (!kind || !item) return;

    const active = Number(item.activo) === 1;

    if (isCategoriaTab(kind)) {
      const meta = tabMeta(kind);
      const operation = active
        ? configuracionApi.darBajaCategoriaServiciosConfiguracion
        : configuracionApi.reactivarCategoriaServiciosConfiguracion;
      await ejecutar(
        () => operation(meta.grupo, item.id_categoria),
        null,
        () => actualizarFilaLocal(kind, item.id_categoria, (row) => ({ ...row, activo: active ? 0 : 1 }))
      );
    } else {
      const id = kind === "detalles" ? item.id_detalle : item.id_unidad;
      const operation = kind === "detalles"
        ? (active ? configuracionApi.darBajaDetalleConfiguracion : configuracionApi.reactivarDetalleConfiguracion)
        : (active ? configuracionApi.darBajaUnidadConfiguracion : configuracionApi.reactivarUnidadConfiguracion);
      await ejecutar(
        () => operation(id),
        null,
        () => actualizarFilaLocal(kind, id, (row) => ({ ...row, activo: active ? 0 : 1 }))
      );
    }

    setStatusModal({ kind: null, item: null });
  };

  const confirmarEliminar = async () => {
    const { kind, item } = deleteModal;
    if (!kind || !item) return;

    if (isCategoriaTab(kind)) {
      const meta = tabMeta(kind);
      await ejecutar(
        () => configuracionApi.eliminarCategoriaServiciosConfiguracion(meta.grupo, item.id_categoria),
        "Categoría eliminada correctamente.",
        () => eliminarFilaLocal(kind, item.id_categoria)
      );
      setDeleteModal({ kind: null, item: null });
      return;
    }

    const operation = kind === "detalles"
      ? configuracionApi.eliminarDetalleConfiguracion
      : configuracionApi.eliminarUnidadConfiguracion;
    const id = kind === "detalles" ? item.id_detalle : item.id_unidad;
    await ejecutar(
      () => operation(id),
      "Registro eliminado correctamente.",
      () => eliminarFilaLocal(kind, id)
    );
    setDeleteModal({ kind: null, item: null });
  };

  const currentMeta = tabMeta(tab);
  const categoriaActual = isCategoriaTab(tab);
  const addLabel = tab === "detalles"
    ? "Agregar detalle"
    : tab === "unidades"
      ? "Agregar unidad"
      : "Agregar categoría";
  const searchPlaceholder = tab === "detalles"
    ? "Buscar detalle..."
    : tab === "unidades"
      ? "Buscar unidad..."
      : "Buscar categoría...";

  const deleteMeta = tabMeta(deleteModal.kind);
  const deleteEsCategoria = isCategoriaTab(deleteModal.kind);
  const deleteUsos = deleteEsCategoria ? cantidadUsosCategoria(deleteModal.kind, deleteModal.item || {}) : 0;
  const deleteWarning = deleteEsCategoria
    ? deleteUsos > 0
      ? `Esta categoría tiene ${deleteUsos.toLocaleString("es-AR")} registro${deleteUsos === 1 ? "" : "s"} asociado${deleteUsos === 1 ? "" : "s"}. Al eliminarla, esos registros quedarán sin categoría.`
      : "La categoría se eliminará definitivamente."
    : "Si el registro ya fue utilizado, el sistema bloqueará el borrado y deberás darlo de baja.";

  const statusIsActive = Number(statusModal.item?.activo) === 1;
  const statusEsCategoria = isCategoriaTab(statusModal.kind);
  const statusMeta = tabMeta(statusModal.kind);
  const statusLabel = statusEsCategoria
    ? statusMeta.singular
    : statusModal.kind === "detalles"
      ? "detalle"
      : "unidad";
  const statusActionLabel = statusIsActive ? "Dar de baja" : "Reactivar";

  return (
    <section className="cfg-listas-page">
      {toast && (
        <Toast
          key={toast.key}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <header className="cfg-listas-hero">
        <div className="cfg-listas-hero__icon"><FontAwesomeIcon icon={faListCheck} /></div>
        <div>
          <span className="cfg-listas-eyebrow">Configuración</span>
          <h1>Listas y categorías</h1>
          <p>Administrá desde un solo lugar las opciones que alimentan los desplegables del sistema y del módulo de Servicios.</p>
        </div>
        <button type="button" className="cfg-listas-back" onClick={() => navigate("/panel/configuracion")}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver
        </button>
      </header>

      <section className="cfg-listas-card">
        <div className="cfg-listas-toolbar">
          <div className="cfg-listas-tabs" role="tablist">
            {TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={tab === item.value ? "is-active" : ""}
                onClick={() => {
                  setTab(item.value);
                  setBuscar("");
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="cfg-listas-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={buscar} onChange={(event) => setBuscar(event.target.value)} placeholder={searchPlaceholder} />
          </label>

          <div className="cfg-listas-status">
            {ESTADOS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={estado === item.value ? "is-active" : ""}
                onClick={() => setEstado(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button type="button" className="cfg-listas-add" onClick={() => setModal({ kind: tab, item: null })}>
            <FontAwesomeIcon icon={faPlus} /> {addLabel}
          </button>
        </div>

        <div className="cfg-listas-tableWrap">
          <table className="cfg-listas-table">
            <thead>
              <tr>
                <th>Nombre</th>
                {tab === "unidades" && <th>Símbolo</th>}
                {tab === "detalles" && <th>Usos históricos</th>}
                {categoriaActual && <th>Descripción</th>}
                {categoriaActual && <th>Registros</th>}
                <th>Estado</th>
                <th className="is-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 6 }).map((_, index) => (
                <tr key={index} className="is-skeleton">
                  <td colSpan={categoriaActual ? 5 : 4}><span /></td>
                </tr>
              )) : rows.map((row) => (
                <tr key={rowId(tab, row)} className={Number(row.activo) === 1 ? "" : "is-inactive"}>
                  <td>
                    <strong>{row.nombre}</strong>
                    {tab === "detalles" && <small>Detalle de ingresos / egresos</small>}
                    {categoriaActual && <small>{currentMeta.singular}</small>}
                  </td>
                  {tab === "unidades" && <td>{row.simbolo}</td>}
                  {tab === "detalles" && <td>{Number(row.cantidad_usos || 0).toLocaleString("es-AR")}</td>}
                  {categoriaActual && <td>{row.descripcion || "—"}</td>}
                  {categoriaActual && <td>{cantidadUsosCategoria(tab, row).toLocaleString("es-AR")}</td>}
                  <td>
                    <span className={`cfg-listas-chip ${Number(row.activo) === 1 ? "is-active" : ""}`}>
                      {Number(row.activo) === 1 ? "ACTIVO" : "BAJA"}
                    </span>
                  </td>
                  <td className="is-right">
                    <div className="cfg-listas-actions">
                      <button type="button" title="Editar" onClick={() => setModal({ kind: tab, item: row })}>
                        <FontAwesomeIcon icon={faPenToSquare} />
                      </button>
                      <button
                        type="button"
                        title={Number(row.activo) === 1 ? "Dar de baja" : "Reactivar"}
                        onClick={() => alternarEstado(row)}
                      >
                        <FontAwesomeIcon icon={Number(row.activo) === 1 ? faBan : faRotateLeft} />
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        title="Eliminar"
                        onClick={() => setDeleteModal({ kind: tab, item: row })}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && rows.length === 0 && (
            <div className="cfg-listas-empty">
              <FontAwesomeIcon icon={faBoxOpen} />
              <span>No hay registros para los filtros actuales.</span>
            </div>
          )}
        </div>
      </section>

      <ModalDetalleLista
        open={modal.kind === "detalles"}
        item={modal.item}
        saving={saving}
        onClose={() => setModal({ kind: null, item: null })}
        onSave={guardarDetalle}
        onToast={notify}
      />

      <ModalUnidad
        open={modal.kind === "unidades"}
        item={modal.item}
        saving={saving}
        onClose={() => setModal({ kind: null, item: null })}
        onSave={guardarUnidad}
        onToast={notify}
      />

      <ModalAgregarCategoria
        open={isCategoriaTab(modal.kind)}
        titulo={modal.item ? `Editar ${tabMeta(modal.kind).singular}` : `Agregar ${tabMeta(modal.kind).singular}`}
        subtitulo="Administrá esta categoría desde Configuración. El cambio se refleja en el módulo de Servicios."
        initialValues={modal.item}
        submitLabel={modal.item ? "Guardar cambios" : "Agregar categoría"}
        saving={saving}
        onClose={() => setModal({ kind: null, item: null })}
        onSave={guardarCategoria}
        onToast={notify}
      />

      <ModalEliminar
        open={Boolean(statusModal.kind)}
        row={statusModal.item}
        loading={saving}
        onToast={notify}
        onClose={() => setStatusModal({ kind: null, item: null })}
        onConfirm={confirmarCambioEstado}
        title={`${statusActionLabel} ${statusLabel}`}
        message={`¿Seguro que querés ${statusIsActive ? "dar de baja" : "reactivar"} ${statusEsCategoria ? "la" : "el"} ${statusLabel} "${statusModal.item?.nombre || "seleccionado"}"?`}
        warning={statusIsActive
          ? "El registro dejará de estar disponible para nuevas selecciones, pero conservará sus relaciones e historial."
          : "El registro volverá a estar disponible para nuevas selecciones."}
        loadingMessage={statusIsActive ? "Dando de baja…" : "Reactivando…"}
        successMessage={statusIsActive ? "Registro dado de baja correctamente." : "Registro reactivado correctamente."}
        errorMessage="No se pudo cambiar el estado del registro."
        confirmLabel={statusActionLabel}
        cancelLabel="Cancelar"
        confirmVariant={statusIsActive ? "danger" : "primary"}
        visualVariant="deactivate"
        details={[
          { label: "Nombre", value: statusModal.item?.nombre || "—" },
          { label: "Estado actual", value: statusIsActive ? "Activo" : "Baja" },
          { label: "Nuevo estado", value: statusIsActive ? "Baja" : "Activo" },
        ]}
      />

      <ModalEliminar
        open={Boolean(deleteModal.kind)}
        row={deleteModal.item}
        loading={saving}
        onToast={notify}
        onClose={() => setDeleteModal({ kind: null, item: null })}
        onConfirm={confirmarEliminar}
        title={`Eliminar ${deleteEsCategoria ? deleteMeta.singular : deleteModal.kind === "detalles" ? "detalle" : "unidad"}`}
        message={`¿Seguro que querés eliminar definitivamente "${deleteModal.item?.nombre || "este registro"}"?`}
        warning={deleteWarning}
        loadingMessage="Eliminando…"
        successMessage="Registro eliminado."
        errorMessage="No se pudo eliminar."
        confirmLabel="Eliminar definitivamente"
      />
    </section>
  );
}
