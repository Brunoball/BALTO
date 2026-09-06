import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import "../Global/Global_css/Global_Section.css";
import "../Global/Global_css/GlobalResponsiveV2.css";
import "../Global/Global_css/Global_responsive.css";
import "../Global/Global_css/roots.css";
import "../Global/Global_css/Global_oscuro.css";
import "../Global/Global_css/GlobalsModalsV2.css";
import "./Servicios.css";
import BotonExportar from "../Global/Boton_Exportar/BotonExportar";
import ModalEliminar from "../Global/Modales/ModalEliminar";
import Toast from "../Global/Toast";
import useTableScrollGutter from "../Global/useTableScrollGutter.jsx";
import * as api from "./api/serviciosApi";
import ModalCategorias from "./modales/ModalCategorias";
import ModalAgregarCategoria from "./modales/ModalAgregarCategoria";
import ModalMaterial from "./modales/ModalMaterial";
import ModalInsumo from "./modales/ModalInsumo";
import ModalAjusteStock from "./modales/ModalAjusteStock";
import ModalServicio from "./modales/ModalServicio";
import ModalTrabajador from "./modales/ModalTrabajador";
import ModalUnidad from "./modales/ModalUnidad";
import ModalHistorial from "./modales/ModalHistorial";
import { money, upper } from "./utils/serviciosFormUtils";
import { exportServiciosExcel, exportServiciosPdf } from "./utils/serviciosExport";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faBoxOpen, faClockRotateLeft, faMagnifyingGlass, faPenToSquare, faPlus, faRotateLeft, faSliders, faTags, faTimes, faTrashCan } from "@fortawesome/free-solid-svg-icons";

const STATUS_TABS = [{ value: "1", label: "Activos" }, { value: "0", label: "Bajas" }];
const EMPTY_FILTER = { buscar: "", categoria: "", estado: "1" };
const META = {
  servicios: { title: "Servicios", add: "Agregar servicio", search: "Buscar servicio..." },
  trabajadores: { title: "Trabajadores", add: "Agregar trabajador", search: "Buscar trabajador o rol..." },
  materiales: { title: "Materiales", add: "Agregar material", search: "Buscar material..." },
  insumos: { title: "Insumos", add: "Agregar insumo", search: "Buscar insumo..." },
  stock: { title: "Stock", add: null, search: "Buscar material o insumo..." },
};

const RESOURCE_TABS = new Set(["materiales", "insumos"]);
const INVENTORY_TABS = new Set(["materiales", "insumos", "stock"]);
const RESPONSIVE_FOOTER_TABS = new Set(["servicios", "materiales", "insumos"]);
const idFor = (tab, row) => tab === "servicios" ? row.id_servicio : tab === "trabajadores" ? row.id_trabajador : row.id_articulo;
const categoryTabs = new Set(["servicios", "materiales", "insumos"]);
const textMatch = (value, q) => upper(value).includes(q);

export default function Servicios() {
  const location = useLocation();
  const inventoryMode = useMemo(() => new URLSearchParams(location.search).get("seccion") === "inventario", [location.search]);
  const tabs = inventoryMode ? ["materiales", "insumos", "stock"] : ["servicios", "trabajadores"];
  const [tab, setTab] = useState(inventoryMode ? "materiales" : "servicios");
  const [data, setData] = useState({
    unidades: [],
    categorias_servicios: [],
    categorias_materiales: [],
    categorias_insumos: [],
    servicios: [],
    materiales: [],
    insumos: [],
    stock: [],
    articulos: [],
    trabajadores: [],
  });
  const [filters, setFilters] = useState(() => Object.fromEntries(Object.keys(META).map((key) => [key, { ...EMPTY_FILTER }])));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [editModal, setEditModal] = useState({ kind: null, item: null });
  const [deleteModal, setDeleteModal] = useState({ kind: null, item: null });
  const [statusModal, setStatusModal] = useState({ kind: null, item: null, category: false });
  const [categoryModal, setCategoryModal] = useState(false);
  const [quickCategory, setQuickCategory] = useState({ open: false, item: null, apply: null });
  const [quickUnit, setQuickUnit] = useState({ open: false, apply: null });
  const [historyModal, setHistoryModal] = useState({ open: false, kind: null, item: null, rows: [], loading: false });
  const requestRef = useRef(0);
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();

  const notify = useCallback((tipo, mensaje, duracion = 3500) => setToast({ id: Date.now(), tipo, mensaje, duracion }), []);

  const cargar = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const response = await api.cargarModuloServicios({ seccion: inventoryMode ? "inventario" : "servicios", limit: 1000 });
      if (requestId === requestRef.current) setData((prev) => ({ ...prev, ...response }));
    } catch (error) {
      if (requestId === requestRef.current) notify("error", error?.message || "No se pudo cargar Servicios.", 5000);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [inventoryMode, notify]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setTab(inventoryMode ? "materiales" : "servicios"); }, [inventoryMode]);

  const execute = async (fn, message) => {
    setSaving(true);
    try {
      const result = await fn();
      if (message) notify("exito", message);
      await cargar();
      return result;
    } catch (error) {
      notify("error", error?.message || "No se pudo completar la operación.", 4800);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const currentFilter = filters[tab] || EMPTY_FILTER;
  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  const categories = tab === "servicios"
    ? data.categorias_servicios
    : tab === "materiales"
      ? data.categorias_materiales
      : tab === "insumos"
        ? data.categorias_insumos
        : [];
  const rawRows = data[tab] || [];

  const rows = useMemo(() => {
    const filter = filters[tab] || EMPTY_FILTER;
    const q = upper(filter.buscar).trim();
    return rawRows.filter((row) => {
      if (Number(row.activo) !== Number(filter.estado)) return false;
      if (filter.categoria && String(row.id_categoria || "") !== String(filter.categoria)) return false;
      if (q && ![row.nombre, row.descripcion, row.tipo, row.categoria_nombre, row.rol, row.unidad_nombre, row.unidad_simbolo].some((value) => textMatch(value, q))) return false;
      return true;
    });
  }, [rawRows, filters, tab]);

  const openEdit = async (row) => {
    if (tab === "servicios") {
      try {
        const response = await api.obtenerServicioServicios(row.id_servicio);
        setEditModal({ kind: tab, item: response.servicio || row });
      } catch (error) { notify("error", error.message); }
      return;
    }
    if (tab === "trabajadores") {
      try {
        const response = await api.obtenerTrabajadorServicios(row.id_trabajador);
        setEditModal({ kind: tab, item: response.trabajador || row });
      } catch (error) { notify("error", error.message); }
      return;
    }
    if (tab === "materiales" || tab === "insumos") {
      try {
        const response = tab === "materiales"
          ? await api.obtenerMaterialServicios(row.id_articulo)
          : await api.obtenerInsumoServicios(row.id_articulo);
        setEditModal({ kind: tab, item: response.material || response.insumo || response.articulo || row });
      } catch (error) { notify("error", error.message); }
      return;
    }
  };

  const openNew = () => META[tab].add && setEditModal({ kind: tab, item: null });

  const save = async (payload) => {
    const kind = editModal.kind;
    const config = {
      servicios: [api.crearServicioServicios, api.actualizarServicioServicios, "Servicio"],
      materiales: [api.crearMaterialServicios, api.actualizarMaterialServicios, "Material"],
      insumos: [api.crearInsumoServicios, api.actualizarInsumoServicios, "Insumo"],
      trabajadores: [api.crearTrabajadorServicios, api.actualizarTrabajadorServicios, "Trabajador"],
    }[kind];
    if (!config) return;
    const editing = Boolean(idFor(kind, editModal.item || {}));
    try {
      await execute(() => config[editing ? 1 : 0](payload), `${config[2]} ${editing ? "actualizado" : "creado"} correctamente.`);
      setEditModal({ kind: null, item: null });
    } catch {}
  };

  const adjustStock = async (payload) => {
    try {
      await execute(() => api.ajustarStockServicios(payload), "Stock ajustado correctamente.");
      setEditModal({ kind: null, item: null });
    } catch {}
  };

  const toggle = (row) => {
    setStatusModal({ kind: tab, item: row, category: false });
  };

  const confirmDelete = async () => {
    const { kind, item } = deleteModal;
    if (!kind || !item) return;
    const actions = {
      servicios: api.eliminarServicioServicios,
      materiales: api.eliminarMaterialServicios,
      insumos: api.eliminarInsumoServicios,
      trabajadores: api.eliminarTrabajadorServicios,
    };
    const categoryActions = {
      servicios: api.eliminarCategoriaServicios,
      materiales: api.eliminarCategoriaMaterialServicios,
      insumos: api.eliminarCategoriaInsumoServicios,
    };
    if (kind.startsWith("category:")) await execute(() => categoryActions[kind.split(":")[1]](item.id_categoria), "Categoría eliminada.");
    else await execute(() => actions[kind](idFor(kind, item)), "Registro eliminado correctamente.");
    setDeleteModal({ kind: null, item: null });
  };

  const categoryApi = useMemo(() => ({
    servicios: {
      list: api.listarCategoriasServicios,
      create: api.crearCategoriaServicios,
      update: (id, body) => api.actualizarCategoriaServicios({ id_categoria: id, ...body }),
      id: (c) => c?.id_categoria,
      count: (c) => c?.cantidad_servicios,
    },
    materiales: {
      list: api.listarCategoriasMaterialesServicios,
      create: api.crearCategoriaMaterialServicios,
      update: (id, body) => api.actualizarCategoriaMaterialServicios({ id_categoria: id, ...body }),
      id: (c) => c?.id_categoria,
      count: (c) => c?.cantidad_articulos,
    },
    insumos: {
      list: api.listarCategoriasInsumosServicios,
      create: api.crearCategoriaInsumoServicios,
      update: (id, body) => api.actualizarCategoriaInsumoServicios({ id_categoria: id, ...body }),
      id: (c) => c?.id_categoria,
      count: (c) => c?.cantidad_articulos,
    },
  })[tab], [tab]);

  const saveCategory = async (body) => {
    setSaving(true);
    try {
      const id = quickCategory.item && categoryApi.id(quickCategory.item);
      const result = id ? await categoryApi.update(id, body) : await categoryApi.create(body);
      const response = await categoryApi.list({ activo: "todos" });
      const list = response.categorias || [];
      setData((prev) => ({ ...prev, [`categorias_${tab}`]: list }));
      const created = result.categoria || result.data?.categoria;
      quickCategory.apply?.(String(categoryApi.id(created) || ""));
      setQuickCategory({ open: false, item: null, apply: null });
      notify("exito", id ? "Categoría actualizada." : "Categoría creada.");
    } catch (error) { notify("error", error.message); }
    finally { setSaving(false); }
  };

  const toggleCategory = (category) => {
    setStatusModal({ kind: tab, item: category, category: true });
  };

  const confirmStatusChange = async () => {
    const { kind, item, category } = statusModal;
    if (!kind || !item) return;

    const active = Number(item.activo) === 1;

    if (category) {
      const categoryActions = {
        servicios: [api.darBajaCategoriaServicios, api.reactivarCategoriaServicios],
        materiales: [api.darBajaCategoriaMaterialServicios, api.reactivarCategoriaMaterialServicios],
        insumos: [api.darBajaCategoriaInsumoServicios, api.reactivarCategoriaInsumoServicios],
      }[kind];
      if (!categoryActions) return;
      await execute(() => categoryActions[active ? 0 : 1](item.id_categoria));
    } else {
      const actions = {
        servicios: [api.darBajaServicioServicios, api.reactivarServicioServicios],
        materiales: [api.darBajaMaterialServicios, api.reactivarMaterialServicios],
        insumos: [api.darBajaInsumoServicios, api.reactivarInsumoServicios],
        trabajadores: [api.darBajaTrabajadorServicios, api.reactivarTrabajadorServicios],
      }[kind];
      if (!actions) return;
      await execute(() => actions[active ? 0 : 1](idFor(kind, item)));
    }

    setStatusModal({ kind: null, item: null, category: false });
  };

  const saveQuickUnit = async (payload) => {
    setSaving(true);
    try {
      const result = await api.crearUnidadServicios(payload);
      const response = await api.listarUnidadesServicios({ activo: "todos" }, { force: true });
      const list = response?.unidades || [];
      const created = result?.unidad || result?.data?.unidad;
      const createdId = result?.id_unidad || result?.data?.id_unidad || created?.id_unidad;
      setData((prev) => ({ ...prev, unidades: list }));
      quickUnit.apply?.(String(createdId || ""));
      setQuickUnit({ open: false, apply: null });
      notify("exito", "Unidad creada correctamente.");
    } catch (error) { notify("error", error?.message || "No se pudo crear la unidad.", 4800); }
    finally { setSaving(false); }
  };

  const openHistory = async (row) => {
    const kind = tab === "servicios" ? "servicio" : tab === "stock" ? "stock" : RESOURCE_TABS.has(tab) ? "articulo" : "trabajador";
    setHistoryModal({ open: true, kind, item: row, rows: [], loading: true });
    try {
      const response = kind === "servicio"
        ? await api.historialServicioServicios(row.id_servicio)
        : kind === "stock"
          ? await api.historialStockServicios(row.id_articulo)
          : kind === "articulo"
            ? (tab === "materiales"
                ? await api.historialMaterialServicios(row.id_articulo)
                : await api.historialInsumoServicios(row.id_articulo))
            : await api.historialTrabajadorServicios(row.id_trabajador);
      setHistoryModal((prev) => ({ ...prev, rows: response?.historial || response?.data?.historial || [], loading: false }));
    } catch (error) {
      setHistoryModal((prev) => ({ ...prev, loading: false }));
      notify("error", error?.message || "No se pudo cargar el historial.");
    }
  };

  const columns = useMemo(() => {
    if (tab === "servicios") return [
      { k: "nombre", l: "Servicio" }, { k: "categoria", l: "Categoría", center: true }, { k: "unidad", l: "Unidad", center: true }, { k: "composicion", l: "Composición" }, { k: "costo", l: "Costo", right: true }, { k: "precio", l: "Precio", right: true }, { k: "acciones", l: "Acciones", center: true },
    ];
    if (tab === "trabajadores") return [
      { k: "nombre", l: "Trabajador" }, { k: "rol", l: "Rol", center: true }, { k: "modalidad", l: "Modalidad", center: true }, { k: "tarifa", l: "Tarifa" }, { k: "hora", l: "Costo/h", right: true }, { k: "servicios", l: "Servicios", center: true }, { k: "acciones", l: "Acciones", center: true },
    ];
    if (tab === "stock") return [
      { k: "nombre", l: "Artículo" }, { k: "tipo", l: "Tipo", center: true }, { k: "categoria", l: "Categoría", center: true }, { k: "unidad", l: "Unidad", center: true }, { k: "stock", l: "Stock", right: true }, { k: "costo", l: "Costo", right: true }, { k: "acciones", l: "Acciones", center: true },
    ];
    return [
      { k: "nombre", l: tab === "materiales" ? "Material" : "Insumo" }, { k: "categoria", l: "Categoría", center: true }, { k: "unidad", l: "Unidad", center: true }, { k: "stock", l: "Stock", right: true }, { k: "costo", l: "Costo", right: true }, { k: "precio", l: "Precio", right: true }, { k: "acciones", l: "Acciones", center: true },
    ];
  }, [tab]);

  const gridCols = columns.map((column, index) => {
    if (index === 0) return "minmax(190px,1.35fr)";
    if (column.k === "acciones") return "150px";
    if (column.k === "unidad") return "82px";
    return "minmax(100px,.8fr)";
  }).join(" ");
  const values = (row) => ({
    nombre: <span className="servicios-nameCell"><strong>{row.nombre}</strong><small>{row.descripcion || (tab === "trabajadores" ? row.rol : "") || "SIN DESCRIPCIÓN"}</small></span>,
    tipo: row.tipo === "MATERIAL" ? "MATERIAL" : row.tipo === "INSUMO" ? "INSUMO" : "—",
    categoria: row.categoria_nombre || "SIN CATEGORÍA",
    unidad: row.unidad_simbolo || row.unidad_nombre || "—",
    composicion: `${Number(row.cantidad_articulos || 0)} elem. · ${Number(row.cantidad_trabajadores || 0)} trab.`,
    costo: money(tab === "servicios" ? row.costo_estimado : row.costo_unitario),
    precio: row.precio_venta == null ? "—" : money(row.precio_venta),
    rol: row.rol || "SIN ROL",
    modalidad: ({ HORA: "POR HORA", JORNADA: "JORNADA", SEMANA: "SEMANAL", QUINCENA: "QUINCENAL", MES: "MENSUAL" })[row.modalidad_pago] || "—",
    tarifa: `${money(row.monto_periodo)} / ${({ HORA: "hora", JORNADA: "jornada", SEMANA: "semana", QUINCENA: "quincena", MES: "mes" })[row.modalidad_pago] || "período"}`,
    hora: money(row.costo_hora),
    servicios: Number(row.cantidad_servicios || 0).toLocaleString("es-AR"),
    stock: `${Number(row.stock_actual || 0).toLocaleString("es-AR", { maximumFractionDigits: 6 })} ${row.unidad_simbolo || ""}`,
  });

  const renderActions = (row) => (
    <div className="mov-actionsInline servicios-actionsInline">
      {INVENTORY_TABS.has(tab) && <button type="button" className="mov-iconBtn" title="Ajustar stock" onClick={() => setEditModal({ kind: "stock", item: row })} disabled={Number(row.activo) !== 1}><FontAwesomeIcon icon={faSliders} /></button>}
      <button type="button" className="mov-iconBtn" title={tab === "stock" ? "Ver historial de stock" : "Ver historial"} onClick={() => openHistory(row)}><FontAwesomeIcon icon={faClockRotateLeft} /></button>
      {tab !== "stock" && <button type="button" className="mov-iconBtn" title="Editar" onClick={() => openEdit(row)}><FontAwesomeIcon icon={faPenToSquare} /></button>}
      {tab !== "stock" && <button type="button" className="mov-iconBtn" title={Number(row.activo) === 1 ? "Dar de baja" : "Reactivar"} onClick={() => toggle(row)}><FontAwesomeIcon icon={Number(row.activo) === 1 ? faBan : faRotateLeft} /></button>}
      {tab !== "stock" && <button type="button" className="mov-iconBtn mov-iconBtn--danger" title="Eliminar" onClick={() => setDeleteModal({ kind: tab, item: row })}><FontAwesomeIcon icon={faTrashCan} /></button>}
    </div>
  );

  const exportDefinition = useMemo(() => {
    const base = [{ label: "NOMBRE", value: (row) => row.nombre, width: 34 }];
    if (tab === "servicios") return { title: "BALTO_SERVICIOS", rows, columns: [...base, { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "", width: 22 }, { label: "UNIDAD", value: (r) => r.unidad_simbolo || "", width: 14 }, { label: "DURACIÓN (MIN)", value: (r) => r.duracion_estimada_minutos ?? "", width: 16 }, { label: "OTROS COSTOS", value: (r) => r.costo_base || 0, width: 16 }, { label: "COSTO TOTAL", value: (r) => r.costo_estimado || 0, width: 16 }, { label: "PRECIO", value: (r) => r.precio_venta || 0, width: 16 }, { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 }] };
    if (tab === "trabajadores") return { title: "BALTO_TRABAJADORES", rows, columns: [...base, { label: "DOCUMENTO", value: (r) => r.documento || "", width: 18 }, { label: "ROL", value: (r) => r.rol || "", width: 24 }, { label: "TIPO", value: (r) => r.tipo_trabajador || "", width: 16 }, { label: "MODALIDAD", value: (r) => r.modalidad_pago || "", width: 16 }, { label: "TARIFA", value: (r) => r.monto_periodo || 0, width: 16 }, { label: "HORAS EQUIV.", value: (r) => r.horas_periodo || 0, width: 16 }, { label: "COSTO/H", value: (r) => r.costo_hora || 0, width: 16 }, { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 }] };
    if (tab === "stock") return { title: "BALTO_STOCK_SERVICIOS", rows, columns: [...base, { label: "TIPO", value: (r) => r.tipo || "", width: 14 }, { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "", width: 22 }, { label: "UNIDAD", value: (r) => r.unidad_simbolo || "", width: 14 }, { label: "STOCK", value: (r) => r.stock_actual || 0, width: 16 }, { label: "COSTO", value: (r) => r.costo_unitario || 0, width: 16 }, { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 }] };
    return { title: tab === "materiales" ? "BALTO_MATERIALES" : "BALTO_INSUMOS", rows, columns: [...base, { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "", width: 22 }, { label: "UNIDAD", value: (r) => r.unidad_simbolo || "", width: 14 }, { label: "STOCK", value: (r) => r.stock_actual || 0, width: 16 }, { label: "COSTO", value: (r) => r.costo_unitario || 0, width: 16 }, { label: "PRECIO", value: (r) => r.precio_venta ?? "", width: 16 }, { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 }] };
  }, [tab, rows]);
  const exportOptions = [
    { key: "excel", label: "Exportar Excel (.xlsx)", tipo: "excel", onClick: () => exportServiciosExcel(exportDefinition) },
    { key: "pdf", label: "Exportar PDF (.pdf)", tipo: "pdf", onClick: () => exportServiciosPdf(exportDefinition) },
  ];

  const statusIsActive = Number(statusModal.item?.activo) === 1;
  const statusLabel = statusModal.category
    ? "categoría"
    : ({
        servicios: "servicio",
        materiales: "material",
        insumos: "insumo",
        trabajadores: "trabajador",
      })[statusModal.kind] || "registro";
  const statusActionLabel = statusIsActive ? "Dar de baja" : "Reactivar";

  return (
    <section className="mov-page servicios-page">
      {toast && <Toast key={toast.id} tipo={toast.tipo} mensaje={toast.mensaje} duracion={toast.duracion} onClose={() => setToast(null)} />}
      <section className="mov-card mov-card--table servicios-mainCard">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov servicios-titleBlock">
              <div className="servicios-titleBlock__copy"><div className="mov-card__title">{inventoryMode ? "Inventario de servicios" : "Servicios"}</div></div>
              <div className="servicios-inventoryTabs" role="tablist">{tabs.map((key) => <button key={key} type="button" className={`servicios-inventoryTab ${tab === key ? "is-active" : ""}`} onClick={() => setTab(key)}>{META[key].title}</button>)}</div>
            </div>
            <div className="mov-headFilters servicios-headFilters">
              <div className="cc-filter cc-filter--search servicios-searchFilter"><div className="cc-floatingField cc-floatingField--search is-active"><div className="cc-searchInput"><div className="cc-searchInput__fieldWrap"><input className="cc-input cc-input--floating servicios-searchInput" value={currentFilter.buscar} onChange={(e) => updateFilter("buscar", upper(e.target.value).slice(0, 100))} placeholder={META[tab].search} /><span className="cc-floatingLabel"><FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda</span>{currentFilter.buscar && <button type="button" className="cc-clearSearch cc-clearSearch--inside" onClick={() => updateFilter("buscar", "")}><FontAwesomeIcon icon={faTimes} /></button>}</div></div></div></div>
              {categoryTabs.has(tab) && <div className="cc-filter servicios-filterCompact"><div className="cc-floatingField is-active"><select className="servicios-globalSelect" value={currentFilter.categoria} onChange={(e) => updateFilter("categoria", e.target.value)}><option value="">TODAS LAS CATEGORÍAS</option>{categories.map((c) => <option key={c.id_categoria} value={c.id_categoria}>{c.nombre}{Number(c.activo) === 1 ? "" : " (BAJA)"}</option>)}</select><span className="cc-floatingLabel cc-floatingLabel--active">Categoría</span></div></div>}
              <div className="mov-tabs servicios-statusTabs">{STATUS_TABS.map((status) => <button key={status.value} type="button" className={`mov-tab servicios-statusTab ${currentFilter.estado === status.value ? "is-active" : ""}`} onClick={() => updateFilter("estado", status.value)}>{status.label}</button>)}</div>
            </div>
          </div>
          <div className="mov-card__actions servicios-headActions">
            {RESPONSIVE_FOOTER_TABS.has(tab) ? (
              <div className="servicios-headSecondary">
                <BotonExportar label="Exportar" opciones={exportOptions} disabled={loading || rows.length === 0} />
                <button type="button" className="mov-btn mov-btn--ghost servicios-categoriesBtn" onClick={() => setCategoryModal(true)}><FontAwesomeIcon icon={faTags} /> Categorías</button>
              </div>
            ) : (
              <BotonExportar label="Exportar" opciones={exportOptions} disabled={loading || rows.length === 0} />
            )}
            {META[tab].add && <button type="button" className="mov-btn mov-btn--primary servicios-addBtn" onClick={openNew}><FontAwesomeIcon icon={faPlus} /> {META[tab].add}</button>}
          </div>
        </div>

        <div className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`} style={{ gridTemplateColumns: gridCols }}>{columns.map((column) => <div key={column.k} className={`mov-gridCell mov-gridCell--head ${column.right ? "is-right" : ""} ${column.center ? "is-center" : ""} ${column.k === "acciones" ? "mov-gridCell--actions" : ""}`}>{column.l}</div>)}</div>
        <div className="mov-tableWrap servicios-tableWrap" ref={tableWrapRef}>
          <div className="mov-gridBody mov-gridBody--relative">
            {loading ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="mov-gridTable mov-gridTable--row mov-row--skeleton" style={{ gridTemplateColumns: gridCols }}>{columns.map((column) => <div key={column.k} className="mov-gridCell"><span className="mov-skeletonBar" /></div>)}</div>) : rows.length ? rows.map((row) => {
              const display = values(row);
              return <div key={`${tab}-${idFor(tab, row)}`} className={`mov-gridTable mov-gridTable--row ${Number(row.activo) === 1 ? "" : "servicios-row--inactive"}`} style={{ gridTemplateColumns: gridCols }}>{columns.map((column) => <div key={column.k} className={`mov-gridCell ${column.right ? "is-right" : ""} ${column.center ? "is-center" : ""} ${column.k === "acciones" ? "mov-gridCell--actions" : ""}`}>{column.k === "acciones" ? renderActions(row) : <span className="mov-ellipsissss">{display[column.k] ?? "—"}</span>}</div>)}</div>;
            }) : <div className="cc-emptyState servicios-emptyState"><FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" /><div className="cc-emptyText">No hay registros para los filtros actuales.</div></div>}
          </div>
        </div>
        <div className="servicios-tableFooter">
          <div className="mov-card__hint servicios-resultsCount">Mostrando <b>{rows.length}</b> registro(s)</div>
          {RESPONSIVE_FOOTER_TABS.has(tab) && (
            <div className="servicios-bottomActions" aria-label="Acciones de la tabla">
              <BotonExportar label="Exportar" opciones={exportOptions} disabled={loading || rows.length === 0} />
              <button type="button" className="mov-btn mov-btn--ghost servicios-categoriesBtn" onClick={() => setCategoryModal(true)}><FontAwesomeIcon icon={faTags} /> Categorías</button>
            </div>
          )}
        </div>
      </section>

      <ModalServicio open={editModal.kind === "servicios"} item={editModal.item} categorias={data.categorias_servicios} unidades={data.unidades} articulos={data.articulos} trabajadores={data.trabajadores} saving={saving} onClose={() => setEditModal({ kind: null, item: null })} onSave={save} onToast={notify} onOpenAgregarCategoria={(apply) => setQuickCategory({ open: true, item: null, apply })} />
      <ModalMaterial
        open={editModal.kind === "materiales"}
        item={editModal.item}
        categorias={data.categorias_materiales}
        unidades={data.unidades}
        saving={saving}
        onClose={() => setEditModal({ kind: null, item: null })}
        onSave={save}
        onToast={notify}
        onOpenAgregarCategoria={(apply) => setQuickCategory({ open: true, item: null, apply })}
        onOpenAgregarUnidad={(apply) => setQuickUnit({ open: true, apply })}
      />
      <ModalInsumo
        open={editModal.kind === "insumos"}
        item={editModal.item}
        categorias={data.categorias_insumos}
        unidades={data.unidades}
        saving={saving}
        onClose={() => setEditModal({ kind: null, item: null })}
        onSave={save}
        onToast={notify}
        onOpenAgregarCategoria={(apply) => setQuickCategory({ open: true, item: null, apply })}
        onOpenAgregarUnidad={(apply) => setQuickUnit({ open: true, apply })}
      />
      <ModalAjusteStock open={editModal.kind === "stock"} item={editModal.item} saving={saving} onClose={() => setEditModal({ kind: null, item: null })} onSave={adjustStock} onToast={notify} />
      <ModalTrabajador open={editModal.kind === "trabajadores"} item={editModal.item} saving={saving} onClose={() => setEditModal({ kind: null, item: null })} onSave={save} onToast={notify} />
      <ModalUnidad open={quickUnit.open} item={null} saving={saving} onClose={() => setQuickUnit({ open: false, apply: null })} onSave={saveQuickUnit} onToast={notify} />
      <ModalHistorial open={historyModal.open} kind={historyModal.kind} item={historyModal.item} rows={historyModal.rows} loading={historyModal.loading} onClose={() => setHistoryModal({ open: false, kind: null, item: null, rows: [], loading: false })} />

      {categoryApi && <ModalCategorias open={categoryModal} titulo={`Categorías de ${META[tab].title.toLowerCase()}`} categorias={categories} getId={categoryApi.id} getCount={(c) => categoryApi.count(c) || 0} saving={saving} onClose={() => setCategoryModal(false)} onAdd={() => setQuickCategory({ open: true, item: null, apply: null })} onEdit={(c) => setQuickCategory({ open: true, item: c, apply: null })} onToggle={toggleCategory} onDelete={(c) => setDeleteModal({ kind: `category:${tab}`, item: c })} nota="Al eliminar una categoría, sus registros quedan sin categoría; no se eliminan." />}
      <ModalAgregarCategoria open={quickCategory.open} titulo={quickCategory.item ? "Editar categoría" : "Agregar categoría"} subtitulo="Completá los datos de la categoría." initialValues={quickCategory.item} submitLabel={quickCategory.item ? "Guardar cambios" : "Agregar categoría"} saving={saving} onClose={() => setQuickCategory({ open: false, item: null, apply: null })} onSave={saveCategory} onToast={notify} />

      <ModalEliminar
        open={Boolean(statusModal.kind)}
        row={statusModal.item}
        loading={saving}
        onToast={notify}
        onClose={() => setStatusModal({ kind: null, item: null, category: false })}
        onConfirm={confirmStatusChange}
        title={`${statusActionLabel} ${statusLabel}`}
        message={`¿Seguro que querés ${statusIsActive ? "dar de baja" : "reactivar"} ${statusModal.category ? "la" : "el"} ${statusLabel} "${statusModal.item?.nombre || "seleccionado"}"?`}
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

      <ModalEliminar open={Boolean(deleteModal.kind)} row={deleteModal.item} loading={saving} onToast={notify} onClose={() => setDeleteModal({ kind: null, item: null })} onConfirm={confirmDelete} title={deleteModal.kind?.startsWith("category:") ? "Eliminar categoría" : "Eliminar registro"} message={`¿Seguro que querés eliminar definitivamente "${deleteModal.item?.nombre || "este registro"}"?`} warning="Si el registro ya tiene relaciones históricas, el backend bloqueará el borrado y podrás darlo de baja." loadingMessage="Eliminando…" successMessage="Registro eliminado." errorMessage="No se pudo eliminar." confirmLabel="Eliminar definitivamente" />
    </section>
  );
}
