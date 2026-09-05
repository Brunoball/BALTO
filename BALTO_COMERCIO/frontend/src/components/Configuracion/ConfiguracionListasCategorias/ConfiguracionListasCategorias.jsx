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
import "./ConfiguracionListasCategorias.css";
import Toast from "../../Global/Toast";
import ModalEliminar from "../../Global/Modales/ModalEliminar";
import useTableScrollGutter from "../../Global/useTableScrollGutter";
import * as configuracionApi from "../api/configuracionApi";
import ModalDetalleLista from "./ModalDetalleLista";
import ModalCategoriaStock from "./ModalCategoriaStock";

const TABS = [
  { value: "detalles", label: "Detalles", singular: "detalle" },
  { value: "categorias_stock", label: "Categorías de stock", singular: "categoría de stock" },
];

const ESTADOS = [
  { value: "1", label: "Activos" },
  { value: "0", label: "Bajas" },
];

function rowId(tab, row) {
  return tab === "detalles" ? row?.id_detalle : row?.id_stock_categoria;
}

function tabMeta(value) {
  return TABS.find((item) => item.value === value) || TABS[0];
}

function notifyListsUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("balto:listas-updated", { detail: { source: "configuracion" } }));
  } catch {}
}

export default function ConfiguracionListasCategorias() {
  const navigate = useNavigate();
  const [rowsScrollRef, hasRowsScroll] = useTableScrollGutter();
  const [tab, setTab] = useState("detalles");
  const [estado, setEstado] = useState("1");
  const [buscar, setBuscar] = useState("");
  const [data, setData] = useState({ detalles: [], categorias_stock: [] });
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
      const resumen = await configuracionApi.listarResumenListasCategoriasConfiguracion({ activo: "todos" });
      setData({
        detalles: resumen?.detalles || [],
        categorias_stock: resumen?.categorias_stock || [],
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
      return [row.nombre, row.descripcion, row.categoria_padre_nombre]
        .some((value) => String(value || "").toLocaleUpperCase("es-AR").includes(q));
    });
  }, [buscar, data, estado, tab]);

  const actualizarFilaLocal = useCallback((kind, id, updater) => {
    setData((prev) => ({
      ...prev,
      [kind]: (prev[kind] || []).map((row) => Number(rowId(kind, row)) === Number(id) ? updater(row) : row),
    }));
  }, []);

  const guardarFilaLocal = useCallback((kind, row) => {
    if (!row) return;
    const id = rowId(kind, row);
    if (!id) return;
    setData((prev) => {
      const current = prev[kind] || [];
      const exists = current.some((item) => Number(rowId(kind, item)) === Number(id));
      const next = exists
        ? current.map((item) => Number(rowId(kind, item)) === Number(id) ? { ...item, ...row } : item)
        : [...current, row];
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

  const ejecutar = async (operation, successMessage, applyResult, notifyError = true) => {
    setSaving(true);
    try {
      const result = await operation();
      applyResult?.(result);
      if (successMessage) notify("exito", successMessage);
      return result;
    } catch (error) {
      if (notifyError) notify("error", error?.message || "No se pudo completar la operación.", 5000);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const guardarDetalle = async (payload) => {
    const editing = Boolean(modal.item?.id_detalle);
    try {
      await ejecutar(
        () => editing ? configuracionApi.actualizarDetalleConfiguracion(payload) : configuracionApi.crearDetalleConfiguracion(payload),
        editing ? "Detalle actualizado correctamente." : "Detalle creado correctamente.",
        (result) => guardarFilaLocal("detalles", {
          ...(result?.detalle || {}),
          cantidad_usos: editing ? Number(modal.item?.cantidad_usos || 0) : 0,
        })
      );
      setModal({ kind: null, item: null });
    } catch {}
  };

  const guardarCategoria = async (payload) => {
    const editing = Boolean(modal.item?.id_stock_categoria);
    try {
      await ejecutar(
        () => editing ? configuracionApi.actualizarCategoriaStockConfiguracion(payload) : configuracionApi.crearCategoriaStockConfiguracion(payload),
        editing ? "Categoría actualizada correctamente." : "Categoría creada correctamente.",
        (result) => guardarFilaLocal("categorias_stock", result?.categoria)
      );
      notifyListsUpdated();
      setModal({ kind: null, item: null });
    } catch {}
  };

  const confirmarCambioEstado = async () => {
    const { kind, item } = statusModal;
    if (!kind || !item) return;
    const active = Number(item.activo) === 1;
    const id = rowId(kind, item);
    const operation = kind === "detalles"
      ? (active ? configuracionApi.darBajaDetalleConfiguracion : configuracionApi.reactivarDetalleConfiguracion)
      : (active ? configuracionApi.darBajaCategoriaStockConfiguracion : configuracionApi.reactivarCategoriaStockConfiguracion);

    await ejecutar(
      () => operation(id),
      null,
      (result) => actualizarFilaLocal(kind, id, (row) => ({ ...row, ...(result?.detalle || result?.categoria || {}), activo: active ? 0 : 1 })),
      false
    );
    if (kind === "categorias_stock") notifyListsUpdated();
    setStatusModal({ kind: null, item: null });
  };

  const confirmarEliminar = async () => {
    const { kind, item } = deleteModal;
    if (!kind || !item) return;
    const id = rowId(kind, item);
    const operation = kind === "detalles"
      ? configuracionApi.eliminarDetalleConfiguracion
      : configuracionApi.eliminarCategoriaStockConfiguracion;
    await ejecutar(
      () => operation(id),
      null,
      () => {
        if (kind === "categorias_stock") {
          // Al borrar una categoría padre, sus hijas pasan a ser categorías principales.
          // Reflejamos ese cambio localmente sin volver a cargar todo el resumen.
          setData((prev) => ({
            ...prev,
            categorias_stock: (prev.categorias_stock || [])
              .filter((row) => Number(rowId("categorias_stock", row)) !== Number(id))
              .map((row) => Number(row.id_categoria_padre || 0) === Number(id)
                ? { ...row, id_categoria_padre: null, categoria_padre_nombre: null }
                : row),
          }));
        } else {
          eliminarFilaLocal(kind, id);
        }
      },
      false
    );
    if (kind === "categorias_stock") notifyListsUpdated();
    setDeleteModal({ kind: null, item: null });
  };

  const currentMeta = tabMeta(tab);
  const isCategory = tab === "categorias_stock";
  const addLabel = isCategory ? "Agregar categoría" : "Agregar detalle";
  const searchPlaceholder = isCategory ? "Buscar categoría..." : "Buscar detalle...";

  const statusIsActive = Number(statusModal.item?.activo) === 1;
  const statusLabel = tabMeta(statusModal.kind).singular;
  const statusActionLabel = statusIsActive ? "Dar de baja" : "Reactivar";

  const deletingCategory = deleteModal.kind === "categorias_stock";
  const productos = Number(deleteModal.item?.cantidad_productos || 0);
  const hijas = Number(deleteModal.item?.cantidad_hijas || 0);
  const syncTn = Number(deleteModal.item?.cantidad_sync_tn || 0);
  const usosDetalle = Number(deleteModal.item?.cantidad_usos || 0);

  const categoryDeleteImpacts = [];
  if (productos > 0) {
    categoryDeleteImpacts.push("Los productos asociados conservarán su stock y seguirán existiendo; esta categoría se quitará de ellos. Si era su única categoría, quedarán sin categoría de stock.");
  }
  if (hijas > 0) {
    categoryDeleteImpacts.push("Las subcategorías pasarán a ser categorías principales.");
  }
  if (syncTn > 0) {
    categoryDeleteImpacts.push("Si estaba vinculada con Tienda Nube, la categoría remota no se borrará y BALTO evitará reimportarla automáticamente.");
  }

  const deleteWarning = deletingCategory
    ? categoryDeleteImpacts.length > 0
      ? categoryDeleteImpacts.join(" ")
      : "La categoría se eliminará definitivamente. No se eliminarán productos ni cantidades de stock."
    : usosDetalle > 0
      ? "Los ingresos, egresos y presupuestos que usen este detalle se conservarán, pero quedarán sin detalle asignado."
      : "El detalle se eliminará definitivamente.";

  const deleteDetails = deletingCategory
    ? [
        { label: "Nombre", value: deleteModal.item?.nombre || "—" },
        { label: "Productos asociados", value: productos.toLocaleString("es-AR") },
        { label: "Subcategorías", value: hijas.toLocaleString("es-AR") },
        { label: "Vínculos Tienda Nube", value: syncTn.toLocaleString("es-AR") },
      ]
    : [
        { label: "Nombre", value: deleteModal.item?.nombre || "—" },
        { label: "Usos históricos", value: usosDetalle.toLocaleString("es-AR") },
      ];

  return (
    <section className="cfg-listas-page">
      {toast && <Toast key={toast.key} tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={() => setToast(null)} />}

      <header className="cfg-listas-hero">
        <div className="cfg-listas-hero__icon"><FontAwesomeIcon icon={faListCheck} /></div>
        <div>
          <span className="cfg-listas-eyebrow">Configuración</span>
          <h1>Listas y categorías</h1>
          <p>Administrá desde un solo lugar los detalles de Movimientos y las categorías que utiliza Stock.</p>
        </div>
        <button type="button" className="mov-btn mov-btn--primary" onClick={() => navigate("/panel/configuracion")}>
          <FontAwesomeIcon icon={faArrowLeft} /> Volver
        </button>
      </header>

      <section className="cfg-listas-card">
        <div className="cfg-listas-toolbar">
          <div className="cfg-listas-tabs" role="tablist">
            {TABS.map((item) => (
              <button key={item.value} type="button" className={tab === item.value ? "is-active" : ""} onClick={() => { setTab(item.value); setBuscar(""); }}>
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
              <button key={item.value} type="button" className={estado === item.value ? "is-active" : ""} onClick={() => setEstado(item.value)}>{item.label}</button>
            ))}
          </div>

          <button type="button" className="cfg-listas-add" onClick={() => setModal({ kind: tab, item: null })}>
            <FontAwesomeIcon icon={faPlus} /> {addLabel}
          </button>
        </div>

        <div className="cfg-listas-tableWrap">
          <div
            className={`cfg-listas-grid ${isCategory ? "is-category" : "is-detail"}`}
            role="table"
            aria-label={isCategory ? "Categorías de stock" : "Detalles de movimientos"}
            aria-busy={loading}
          >
            <div className={`cfg-listas-gridHead ${hasRowsScroll ? "has-y-scroll" : ""}`} role="rowgroup">
              <div className="cfg-listas-gridRow" role="row">
                <div className="cfg-listas-gridCell cfg-listas-gridCell--head" role="columnheader">Nombre</div>
                {isCategory && <div className="cfg-listas-gridCell cfg-listas-gridCell--head" role="columnheader">Descripción</div>}
                {isCategory && <div className="cfg-listas-gridCell cfg-listas-gridCell--head is-center" role="columnheader">Productos</div>}
                {isCategory && <div className="cfg-listas-gridCell cfg-listas-gridCell--head is-center" role="columnheader">Subcategorías</div>}
                {!isCategory && <div className="cfg-listas-gridCell cfg-listas-gridCell--head is-center" role="columnheader">Usos históricos</div>}
                <div className="cfg-listas-gridCell cfg-listas-gridCell--head is-center" role="columnheader">Estado</div>
                <div className="cfg-listas-gridCell cfg-listas-gridCell--head is-center" role="columnheader">Acciones</div>
              </div>
            </div>

            <div className="cfg-listas-gridBodyScroll" ref={rowsScrollRef}>
              <div className="cfg-listas-gridBody" role="rowgroup">
                {loading ? Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="cfg-listas-gridRow is-skeleton" role="row">
                    <div className="cfg-listas-gridCell cfg-listas-gridCell--skeleton" role="cell" aria-colspan={isCategory ? 6 : 4}><span /></div>
                  </div>
                )) : rows.map((row) => (
                  <div key={rowId(tab, row)} className={`cfg-listas-gridRow ${Number(row.activo) === 1 ? "" : "is-inactive"}`} role="row">
                    <div className="cfg-listas-gridCell cfg-listas-gridCell--name" role="cell">
                      <strong>{row.nombre}</strong>
                      <small>{isCategory ? (row.categoria_padre_nombre ? `Subcategoría de ${row.categoria_padre_nombre}` : "Categoría principal") : "Detalle de ingresos / egresos"}</small>
                    </div>
                    {isCategory && <div className="cfg-listas-gridCell cfg-listas-gridCell--description" role="cell">{row.descripcion || "—"}</div>}
                    {isCategory && <div className="cfg-listas-gridCell is-center" role="cell">{Number(row.cantidad_productos || 0).toLocaleString("es-AR")}</div>}
                    {isCategory && <div className="cfg-listas-gridCell is-center" role="cell">{Number(row.cantidad_hijas || 0).toLocaleString("es-AR")}</div>}
                    {!isCategory && <div className="cfg-listas-gridCell is-center" role="cell">{Number(row.cantidad_usos || 0).toLocaleString("es-AR")}</div>}
                    <div className="cfg-listas-gridCell is-center" role="cell">
                      <span className={`cfg-listas-chip ${Number(row.activo) === 1 ? "is-active" : ""}`}>{Number(row.activo) === 1 ? "ACTIVO" : "BAJA"}</span>
                    </div>
                    <div className="cfg-listas-gridCell is-center" role="cell">
                      <div className="cfg-listas-actions">
                        <button type="button" title="Editar" onClick={() => setModal({ kind: tab, item: row })}><FontAwesomeIcon icon={faPenToSquare} /></button>
                        <button type="button" title={Number(row.activo) === 1 ? "Dar de baja" : "Reactivar"} onClick={() => setStatusModal({ kind: tab, item: row })}><FontAwesomeIcon icon={Number(row.activo) === 1 ? faBan : faRotateLeft} /></button>
                        <button type="button" className="is-danger" title="Eliminar" onClick={() => setDeleteModal({ kind: tab, item: row })}><FontAwesomeIcon icon={faTrashCan} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!loading && rows.length === 0 && <div className="cfg-listas-empty"><FontAwesomeIcon icon={faBoxOpen} /><span>No hay registros para los filtros actuales.</span></div>}
            </div>
          </div>
        </div>
      </section>

      <ModalDetalleLista open={modal.kind === "detalles"} item={modal.item} saving={saving} onClose={() => setModal({ kind: null, item: null })} onSave={guardarDetalle} onToast={notify} />
      <ModalCategoriaStock open={modal.kind === "categorias_stock"} item={modal.item} categorias={data.categorias_stock} saving={saving} onClose={() => setModal({ kind: null, item: null })} onSave={guardarCategoria} onToast={notify} />

      <ModalEliminar
        open={Boolean(statusModal.kind)}
        row={statusModal.item}
        loading={saving}
        onToast={notify}
        onClose={() => setStatusModal({ kind: null, item: null })}
        onConfirm={confirmarCambioEstado}
        title={`${statusActionLabel} ${statusLabel}`}
        message={`¿Seguro que querés ${statusIsActive ? "dar de baja" : "reactivar"} ${statusLabel === "categoría de stock" ? "la" : "el"} ${statusLabel} "${statusModal.item?.nombre || "seleccionado"}"?`}
        warning={statusIsActive ? "El registro dejará de estar disponible para nuevas selecciones, pero conservará sus relaciones e historial." : "El registro volverá a estar disponible para nuevas selecciones."}
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
        title={`Eliminar ${tabMeta(deleteModal.kind).singular}`}
        message={`¿Seguro que querés eliminar definitivamente "${deleteModal.item?.nombre || "este registro"}"?`}
        warning={deleteWarning}
        loadingMessage="Eliminando…"
        successMessage={deletingCategory
          ? "Categoría eliminada. Los productos y su stock se conservaron."
          : "Detalle eliminado. Los movimientos históricos se conservaron."}
        errorMessage="No se pudo eliminar."
        confirmLabel="Eliminar definitivamente"
        details={deleteDetails}
      />
    </section>
  );
}
