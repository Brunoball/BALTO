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
import {
  actualizarCategoriaInsumoServicios,
  actualizarCategoriaServicios,
  actualizarCategoriaStockServicios,
  actualizarInsumoServicios,
  actualizarServicioServicios,
  actualizarStockServicios,
  crearCategoriaInsumoServicios,
  crearCategoriaServicios,
  crearCategoriaStockServicios,
  crearInsumoServicios,
  crearServicioServicios,
  crearStockServicios,
  darBajaCategoriaInsumoServicios,
  darBajaCategoriaServicios,
  darBajaCategoriaStockServicios,
  darBajaInsumoServicios,
  darBajaServicioServicios,
  darBajaStockServicios,
  eliminarCategoriaInsumoServicios,
  eliminarCategoriaServicios,
  eliminarCategoriaStockServicios,
  eliminarInsumoServicios,
  eliminarServicioServicios,
  eliminarStockServicios,
  listarCatalogoServicios,
  listarCategoriasInsumosServicios,
  listarCategoriasServicios,
  listarCategoriasStockServicios,
  listarInsumosServicios,
  listarStockServicios,
  listarUnidadesServicios,
  obtenerServicioServicios,
  reactivarCategoriaInsumoServicios,
  reactivarCategoriaServicios,
  reactivarCategoriaStockServicios,
  reactivarInsumoServicios,
  reactivarServicioServicios,
  reactivarStockServicios,
} from "./api/serviciosApi";
import ModalCategorias from "./modales/ModalCategorias";
import ModalAgregarCategoria from "./modales/ModalAgregarCategoria";
import ModalInsumo from "./modales/ModalInsumo";
import ModalServicio from "./modales/ModalServicio";
import ModalStock from "./modales/ModalStock";
import { integer, money, upper } from "./utils/serviciosFormUtils";
import { exportServiciosExcel, exportServiciosPdf } from "./utils/serviciosExport";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBan,
  faBoxOpen,
  faMagnifyingGlass,
  faPenToSquare,
  faPlus,
  faRotateLeft,
  faTags,
  faTimes,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";

const EMPTY_FILTERS = { buscar: "", categoria: "", estado: "todos" };
const STATUS_FILTER_TABS = [
  { value: "todos", label: "Todos" },
  { value: "1", label: "Activos" },
  { value: "0", label: "Dados de baja" },
];
const SKELETON_ROWS = 10;
const includesText = (value, q) => upper(value).includes(q);
const SECTION_META = {
  servicios: {
    title: "Servicios",
    description: "Administrá los servicios y definí los insumos o productos de Stock que necesita cada uno.",
    addLabel: "Agregar servicio",
    searchPlaceholder: "Buscar por servicio, código o categoría...",
  },
  insumos: {
    title: "Insumos",
    description: "Administrá los insumos utilizados por los servicios de manera independiente del Stock.",
    addLabel: "Agregar insumo",
    searchPlaceholder: "Buscar por insumo, código o categoría...",
  },
  stock: {
    title: "Stock",
    description: "Administrá los productos y existencias de Stock de manera independiente de los Insumos.",
    addLabel: "Agregar producto",
    searchPlaceholder: "Buscar por producto, código o categoría...",
  },
};

const formatIva = (value) => `${Number(value || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

export default function Servicios() {
  const location = useLocation();
  const inventoryMode = useMemo(
    () => new URLSearchParams(location.search).get("seccion") === "inventario",
    [location.search]
  );
  const [tab, setTab] = useState(() => inventoryMode ? "insumos" : "servicios");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const [unidades, setUnidades] = useState([]);
  const [categoriasServicios, setCategoriasServicios] = useState([]);
  const [categoriasInsumos, setCategoriasInsumos] = useState([]);
  const [categoriasStock, setCategoriasStock] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [stock, setStock] = useState([]);

  const [filters, setFilters] = useState({
    servicios: { ...EMPTY_FILTERS },
    insumos: { ...EMPTY_FILTERS },
    stock: { ...EMPTY_FILTERS },
  });

  const [serviceModal, setServiceModal] = useState({ open: false, item: null });
  const [insumoModal, setInsumoModal] = useState({ open: false, item: null });
  const [stockModal, setStockModal] = useState({ open: false, item: null });
  const [categoryModal, setCategoryModal] = useState({ open: false, kind: "servicios" });
  const [quickCategoryModal, setQuickCategoryModal] = useState({
    open: false,
    kind: "servicios",
    item: null,
    selectOnCreate: false,
  });
  const [deleteModal, setDeleteModal] = useState({ open: false, kind: null, item: null });
  const quickCategoryApplyRef = useRef(null);
  const [tableWrapRef, hasTableScroll] = useTableScrollGutter();

  const mostrarToast = useCallback((tipo, mensaje, duracion = 3000) => {
    const texto = String(mensaje || "").trim();
    if (!texto) return;

    setToast({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tipo,
      mensaje: texto,
      duracion,
    });
  }, []);

  const flash = useCallback((message) => {
    mostrarToast("exito", message, 3000);
  }, [mostrarToast]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [u, cs, ci, cst, s, i, st] = await Promise.all([
        listarUnidadesServicios(),
        listarCategoriasServicios({ activo: "todos" }),
        listarCategoriasInsumosServicios({ activo: "todos" }),
        listarCategoriasStockServicios({ activo: "todos" }),
        listarCatalogoServicios({ activo: "todos", limit: 1000 }),
        listarInsumosServicios({ activo: "todos", limit: 1000 }),
        listarStockServicios({ activo: "todos", limit: 1000 }),
      ]);

      setUnidades(u?.unidades || []);
      setCategoriasServicios(cs?.categorias || []);
      setCategoriasInsumos(ci?.categorias || []);
      setCategoriasStock(cst?.categorias || []);
      setServicios(s?.servicios || []);
      setInsumos(i?.insumos || []);
      setStock(st?.stock || []);
    } catch (e) {
      mostrarToast("error", e?.message || "No se pudo cargar el módulo Servicios.", 4500);
    } finally {
      setLoading(false);
    }
  }, [mostrarToast]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    setTab((current) => {
      if (!inventoryMode) return "servicios";
      return current === "stock" ? "stock" : "insumos";
    });
  }, [inventoryMode]);

  const currentFilters = filters[tab] || EMPTY_FILTERS;
  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  };

  const serviciosFiltrados = useMemo(() => {
    const f = filters.servicios;
    const q = upper(f.buscar).trim();
    return servicios.filter((item) => {
      if (f.estado !== "todos" && Number(item.activo) !== Number(f.estado)) return false;
      if (f.categoria && String(item.id_servicio_categoria || "") !== String(f.categoria)) return false;
      if (q && !includesText(item.nombre, q) && !includesText(item.codigo, q) && !includesText(item.descripcion, q) && !includesText(item.categoria_nombre, q)) return false;
      return true;
    });
  }, [servicios, filters.servicios]);

  const insumosFiltrados = useMemo(() => {
    const f = filters.insumos;
    const q = upper(f.buscar).trim();
    return insumos.filter((item) => {
      if (f.estado !== "todos" && Number(item.activo) !== Number(f.estado)) return false;
      if (f.categoria && String(item.id_categoria || "") !== String(f.categoria)) return false;
      if (q && !includesText(item.nombre, q) && !includesText(item.codigo, q) && !includesText(item.descripcion, q) && !includesText(item.categoria_nombre, q)) return false;
      return true;
    });
  }, [insumos, filters.insumos]);

  const stockFiltrado = useMemo(() => {
    const f = filters.stock;
    const q = upper(f.buscar).trim();
    return stock.filter((item) => {
      if (f.estado !== "todos" && Number(item.activo) !== Number(f.estado)) return false;
      if (f.categoria && String(item.id_categoria || "") !== String(f.categoria)) return false;
      if (q && !includesText(item.nombre, q) && !includesText(item.codigo, q) && !includesText(item.descripcion, q) && !includesText(item.categoria_nombre, q)) return false;
      return true;
    });
  }, [stock, filters.stock]);

  const execute = async (fn, successMessage, { notificar = true } = {}) => {
    setSaving(true);
    try {
      const result = await fn();
      if (notificar && successMessage) flash(successMessage);
      await cargar();
      return result;
    } catch (e) {
      if (notificar) {
        mostrarToast("error", e?.message || "No se pudo completar la operación.", 4500);
      }
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const saveServicio = async (payload) => {
    try {
      await execute(
        () => payload.id_servicio ? actualizarServicioServicios(payload) : crearServicioServicios(payload),
        payload.id_servicio ? "Servicio actualizado correctamente." : "Servicio creado correctamente."
      );
      setServiceModal({ open: false, item: null });
    } catch {}
  };

  const openEditServicio = async (item) => {
    try {
      const result = await obtenerServicioServicios(item.id_servicio);
      setServiceModal({ open: true, item: result?.servicio || item });
    } catch (e) {
      mostrarToast("error", e?.message || "No se pudo cargar el servicio.", 4500);
    }
  };

  const saveInsumo = async (payload) => {
    try {
      await execute(
        () => payload.id_insumo ? actualizarInsumoServicios(payload) : crearInsumoServicios(payload),
        payload.id_insumo ? "Insumo actualizado correctamente." : "Insumo creado correctamente."
      );
      setInsumoModal({ open: false, item: null });
    } catch {}
  };

  const saveStock = async (payload) => {
    try {
      await execute(
        () => payload.id_stock ? actualizarStockServicios(payload) : crearStockServicios(payload),
        payload.id_stock ? "Stock actualizado correctamente." : "Registro agregado a Stock."
      );
      setStockModal({ open: false, item: null });
    } catch {}
  };

  const toggleServicio = (item) => execute(
    () => Number(item.activo) === 1 ? darBajaServicioServicios(item.id_servicio) : reactivarServicioServicios(item.id_servicio),
    Number(item.activo) === 1 ? "Servicio dado de baja." : "Servicio reactivado."
  ).catch(() => {});

  const toggleInsumo = (item) => execute(
    () => Number(item.activo) === 1 ? darBajaInsumoServicios(item.id_insumo) : reactivarInsumoServicios(item.id_insumo),
    Number(item.activo) === 1 ? "Insumo dado de baja." : "Insumo reactivado."
  ).catch(() => {});

  const toggleStock = (item) => execute(
    () => Number(item.activo) === 1 ? darBajaStockServicios(item.id_stock) : reactivarStockServicios(item.id_stock),
    Number(item.activo) === 1 ? "Registro de stock dado de baja." : "Registro de stock reactivado."
  ).catch(() => {});

  const openQuickCategory = useCallback((kind, onCreated = null, item = null) => {
    const selectOnCreate = typeof onCreated === "function";
    quickCategoryApplyRef.current = selectOnCreate ? onCreated : null;
    setQuickCategoryModal({ open: true, kind, item, selectOnCreate });
  }, []);

  const closeQuickCategory = useCallback(() => {
    if (saving) return;
    quickCategoryApplyRef.current = null;
    setQuickCategoryModal((prev) => ({ ...prev, open: false, item: null, selectOnCreate: false }));
  }, [saving]);

  const quickCategoryConfig = useMemo(() => {
    if (quickCategoryModal.kind === "servicios") {
      return {
        titulo: "Agregar categoría de servicio",
        subtitulo: "La nueva categoría quedará seleccionada en el servicio actual.",
        editTitulo: "Editar categoría de servicio",
        editSubtitulo: "Actualizá los datos de la categoría seleccionada.",
        create: crearCategoriaServicios,
        update: (id, body) => actualizarCategoriaServicios({ id_servicio_categoria: id, ...body }),
        list: listarCategoriasServicios,
        getId: (category) => category?.id_servicio_categoria ?? category?.id,
      };
    }

    if (quickCategoryModal.kind === "stock") {
      return {
        titulo: "Agregar categoría de Stock",
        subtitulo: "La nueva categoría quedará seleccionada en el producto actual.",
        editTitulo: "Editar categoría de Stock",
        editSubtitulo: "Actualizá los datos de la categoría seleccionada.",
        create: crearCategoriaStockServicios,
        update: (id, body) => actualizarCategoriaStockServicios({ id_stock_categoria: id, ...body }),
        list: listarCategoriasStockServicios,
        getId: (category) => category?.id_stock_categoria ?? category?.id,
      };
    }

    return {
      titulo: "Agregar categoría de insumo",
      subtitulo: "La nueva categoría quedará seleccionada en el insumo actual.",
      editTitulo: "Editar categoría de insumo",
      editSubtitulo: "Actualizá los datos de la categoría seleccionada.",
      create: crearCategoriaInsumoServicios,
      update: (id, body) => actualizarCategoriaInsumoServicios({ id_categoria: id, ...body }),
      list: listarCategoriasInsumosServicios,
      getId: (category) => category?.id_categoria ?? category?.id,
    };
  }, [quickCategoryModal.kind]);

  const saveQuickCategory = async (body) => {
    setSaving(true);
    try {
      const editingId = quickCategoryConfig.getId(quickCategoryModal.item);
      const result = editingId
        ? await quickCategoryConfig.update(editingId, body)
        : await quickCategoryConfig.create(body);
      const response = await quickCategoryConfig.list({ activo: "todos" });
      const categories = response?.categorias || [];

      if (quickCategoryModal.kind === "servicios") setCategoriasServicios(categories);
      if (quickCategoryModal.kind === "insumos") setCategoriasInsumos(categories);
      if (quickCategoryModal.kind === "stock") setCategoriasStock(categories);

      const responseCategory = result?.categoria || result?.data?.categoria || result;
      const responseId = quickCategoryConfig.getId(responseCategory);
      const normalizedName = upper(body.nombre).trim();
      const responseMatch = categories.find(
        (category) => String(quickCategoryConfig.getId(category) || "") === String(responseId || "")
      );
      const matchingCategory = categories
        .filter((category) => Number(category.activo) === 1 && upper(category.nombre).trim() === normalizedName)
        .sort((a, b) => Number(quickCategoryConfig.getId(b) || 0) - Number(quickCategoryConfig.getId(a) || 0))[0];
      const createdId = quickCategoryConfig.getId(responseMatch || matchingCategory);

      if (!editingId && createdId) quickCategoryApplyRef.current?.(String(createdId));
      quickCategoryApplyRef.current = null;
      setQuickCategoryModal((prev) => ({ ...prev, open: false, item: null, selectOnCreate: false }));
      flash(editingId ? "Categoría actualizada correctamente." : "Categoría agregada correctamente.");
      return result;
    } catch (error) {
      mostrarToast("error", error?.message || "No se pudo agregar la categoría.", 4500);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const categoryConfig = useMemo(() => {
    if (categoryModal.kind === "servicios") {
      return {
        titulo: "Categorías de servicios",
        categorias: categoriasServicios,
        getId: (c) => c.id_servicio_categoria,
        getCount: (c) => c.cantidad_servicios || 0,
        create: crearCategoriaServicios,
        update: (id, body) => actualizarCategoriaServicios({ id_servicio_categoria: id, ...body }),
        toggle: (c) => Number(c.activo) === 1 ? darBajaCategoriaServicios(c.id_servicio_categoria) : reactivarCategoriaServicios(c.id_servicio_categoria),
        deleteKind: "categoria-servicios",
        nota: "Al eliminar una categoría, los servicios asociados quedan sin categoría. Los servicios no se eliminan.",
      };
    }
    if (categoryModal.kind === "stock") {
      return {
        titulo: "Categorías de stock",
        categorias: categoriasStock,
        getId: (c) => c.id_stock_categoria,
        getCount: (c) => c.cantidad_stock || 0,
        create: crearCategoriaStockServicios,
        update: (id, body) => actualizarCategoriaStockServicios({ id_stock_categoria: id, ...body }),
        toggle: (c) => Number(c.activo) === 1 ? darBajaCategoriaStockServicios(c.id_stock_categoria) : reactivarCategoriaStockServicios(c.id_stock_categoria),
        deleteKind: "categoria-stock",
        nota: "Al eliminar una categoría, los registros de Stock asociados quedan sin categoría. Los registros de Stock no se eliminan.",
      };
    }
    return {
      titulo: "Categorías de insumos",
      categorias: categoriasInsumos,
      getId: (c) => c.id_categoria,
      getCount: (c) => c.cantidad_insumos || 0,
      create: crearCategoriaInsumoServicios,
      update: (id, body) => actualizarCategoriaInsumoServicios({ id_categoria: id, ...body }),
      toggle: (c) => Number(c.activo) === 1 ? darBajaCategoriaInsumoServicios(c.id_categoria) : reactivarCategoriaInsumoServicios(c.id_categoria),
      deleteKind: "categoria-insumos",
      nota: "Al eliminar una categoría, los insumos asociados quedan sin categoría. Los insumos no se eliminan y Stock no se modifica.",
    };
  }, [categoryModal.kind, categoriasServicios, categoriasInsumos, categoriasStock]);

  const toggleCategory = (category) => execute(
    () => categoryConfig.toggle(category),
    Number(category.activo) === 1 ? "Categoría dada de baja." : "Categoría reactivada."
  ).catch(() => {});
  const deleteCategory = (item) => setDeleteModal({ open: true, kind: categoryConfig.deleteKind, item });

  const closeDeleteModal = () => {
    if (!saving) setDeleteModal({ open: false, kind: null, item: null });
  };

  const confirmDelete = async () => {
    const { kind, item } = deleteModal;
    if (!kind || !item) return;

    const opcionesModalGlobal = { notificar: false };

    if (kind === "servicio") await execute(() => eliminarServicioServicios(item.id_servicio), null, opcionesModalGlobal);
    if (kind === "insumo") await execute(() => eliminarInsumoServicios(item.id_insumo), null, opcionesModalGlobal);
    if (kind === "stock") await execute(() => eliminarStockServicios(item.id_stock), null, opcionesModalGlobal);
    if (kind === "categoria-servicios") await execute(() => eliminarCategoriaServicios(item.id_servicio_categoria), null, opcionesModalGlobal);
    if (kind === "categoria-insumos") await execute(() => eliminarCategoriaInsumoServicios(item.id_categoria), null, opcionesModalGlobal);
    if (kind === "categoria-stock") await execute(() => eliminarCategoriaStockServicios(item.id_stock_categoria), null, opcionesModalGlobal);

    setDeleteModal({ open: false, kind: null, item: null });
  };

  const deleteModalCopy = useMemo(() => {
    const item = deleteModal.item || {};
    const nombre = item.nombre || "ESTE REGISTRO";

    if (deleteModal.kind === "insumo") {
      return {
        title: "Eliminar insumo",
        message: `¿Seguro que querés eliminar definitivamente "${nombre}"?`,
        warning: "Se eliminará el insumo, su historial de precios y su participación en servicios. Si ya fue usado en una venta, compra u otro movimiento, ese movimiento se conservará para no perder información. Stock no se modifica porque se administra de forma independiente. Esta acción no se puede deshacer.",
        details: [
          { label: "Nombre", value: nombre },
          { label: "Categoría", value: item.categoria_nombre || "SIN CATEGORÍA" },
          { label: "Costo", value: money(item.costo_unitario || 0) },
        ],
      };
    }

    if (deleteModal.kind === "stock") {
      return {
        title: "Eliminar de stock",
        message: `¿Seguro que querés eliminar definitivamente "${nombre}" de Stock?`,
        warning: "Se eliminará únicamente este registro de Stock. Los insumos y servicios no se modificarán. Esta acción no se puede deshacer.",
        details: [
          { label: "Nombre", value: nombre },
          { label: "Stock actual", value: integer(item.stock_actual || 0) },
          { label: "Categoría", value: item.categoria_nombre || "SIN CATEGORÍA" },
        ],
      };
    }

    if (deleteModal.kind === "servicio") {
      return {
        title: "Eliminar servicio",
        message: `¿Seguro que querés eliminar definitivamente "${nombre}"?`,
        warning: "Se eliminará el servicio, su historial de precios y su composición. Si ya fue usado en una venta u otro movimiento, ese movimiento se conservará para no perder información. Los insumos y Stock no se eliminan. Esta acción no se puede deshacer.",
        details: [
          { label: "Nombre", value: nombre },
          { label: "Categoría", value: item.categoria_nombre || "SIN CATEGORÍA" },
          { label: "Precio", value: money(item.precio_venta || 0) },
        ],
      };
    }

    const count = deleteModal.kind === "categoria-servicios"
      ? item.cantidad_servicios || 0
      : deleteModal.kind === "categoria-stock"
      ? item.cantidad_stock || 0
      : item.cantidad_insumos || 0;

    return {
      title: "Eliminar categoría",
      message: `¿Seguro que querés eliminar definitivamente "${nombre}"?`,
      warning: "Los registros que usan esta categoría no se eliminan: simplemente quedan sin categoría. Esta acción no se puede deshacer.",
      details: [
        { label: "Categoría", value: nombre },
        { label: "Registros asociados", value: count },
      ],
    };
  }, [deleteModal]);

  const exportDefinition = useMemo(() => {
    if (tab === "servicios") {
      return {
        title: "BALTO_SERVICIOS",
        rows: serviciosFiltrados,
        columns: [
          { label: "CÓDIGO", value: (r) => r.codigo || "", width: 15 },
          { label: "SERVICIO", value: (r) => r.nombre, width: 35, weight: 2 },
          { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "SIN CATEGORÍA", width: 24 },
          { label: "COSTO", value: (r) => Number(r.costo_estimado || 0).toFixed(2), width: 15 },
          { label: "PRECIO", value: (r) => Number(r.precio_venta || 0).toFixed(2), width: 15 },
          { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 },
        ],
      };
    }

    if (tab === "insumos") {
      return {
        title: "BALTO_INSUMOS",
        rows: insumosFiltrados,
        columns: [
          { label: "CÓDIGO", value: (r) => r.codigo || "", width: 15 },
          { label: "INSUMO", value: (r) => r.nombre, width: 35, weight: 2 },
          { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "SIN CATEGORÍA", width: 24 },
          { label: "UNIDAD", value: (r) => r.unidad_simbolo || r.unidad_nombre || "", width: 12 },
          { label: "COSTO", value: (r) => Number(r.costo_unitario || 0).toFixed(2), width: 15 },
          { label: "PRECIO", value: (r) => r.precio_venta == null ? "" : Number(r.precio_venta).toFixed(2), width: 15 },
          { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 },
        ],
      };
    }

    return {
      title: "BALTO_STOCK_SERVICIOS",
      rows: stockFiltrado,
      columns: [
        { label: "CÓDIGO", value: (r) => r.codigo || "", width: 15 },
        { label: "STOCK", value: (r) => r.nombre, width: 35, weight: 2 },
        { label: "CATEGORÍA", value: (r) => r.categoria_nombre || "SIN CATEGORÍA", width: 24 },
        { label: "UNIDAD", value: (r) => r.unidad_simbolo || r.unidad_nombre || "", width: 12 },
        { label: "CANTIDAD", value: (r) => integer(r.stock_actual), width: 12 },
        { label: "COSTO", value: (r) => Number(r.costo_unitario || 0).toFixed(2), width: 15 },
        { label: "ESTADO", value: (r) => Number(r.activo) === 1 ? "ACTIVO" : "BAJA", width: 12 },
      ],
    };
  }, [tab, serviciosFiltrados, insumosFiltrados, stockFiltrado]);

  const exportOptions = [
    { key: "excel", label: "Exportar Excel (.xlsx)", tipo: "excel", onClick: () => exportServiciosExcel(exportDefinition) },
    { key: "pdf", label: "Exportar PDF (.pdf)", tipo: "pdf", onClick: () => exportServiciosPdf(exportDefinition) },
  ];

  const activeCategoryList = tab === "servicios" ? categoriasServicios : tab === "insumos" ? categoriasInsumos : categoriasStock;
  const categoryId = (category) => tab === "servicios" ? category.id_servicio_categoria : tab === "stock" ? category.id_stock_categoria : category.id_categoria;
  const openNew = () => {
    if (tab === "servicios") setServiceModal({ open: true, item: null });
    if (tab === "insumos") setInsumoModal({ open: true, item: null });
    if (tab === "stock") setStockModal({ open: true, item: null });
  };

  const currentRows = tab === "servicios" ? serviciosFiltrados : tab === "insumos" ? insumosFiltrados : stockFiltrado;

  const tableConfig = useMemo(() => {
    if (tab === "servicios") {
      return {
        gridCols: "minmax(190px,1.35fr) minmax(130px,.9fr) minmax(180px,1fr) minmax(120px,.72fr) minmax(115px,.72fr) 78px 86px 112px",
        empty: "No hay servicios para los filtros actuales.",
        columns: [
          { key: "nombre", label: "Servicio" },
          { key: "categoria", label: "Categoría" },
          { key: "composicion", label: "Composición" },
          { key: "costo", label: "Costo estimado", align: "right" },
          { key: "precio", label: "Precio", align: "right" },
          { key: "iva", label: "IVA", align: "center" },
          { key: "estado", label: "Estado", align: "center" },
          { key: "acciones", label: "Acciones", align: "center" },
        ],
      };
    }

    if (tab === "insumos") {
      return {
        gridCols: "minmax(190px,1.35fr) minmax(140px,.95fr) 88px minmax(110px,.72fr) minmax(110px,.72fr) 78px 86px 112px",
        empty: "No hay insumos para los filtros actuales.",
        columns: [
          { key: "nombre", label: "Insumo" },
          { key: "categoria", label: "Categoría" },
          { key: "unidad", label: "Unidad", align: "center" },
          { key: "costo", label: "Costo", align: "right" },
          { key: "precio", label: "Precio", align: "right" },
          { key: "iva", label: "IVA", align: "center" },
          { key: "estado", label: "Estado", align: "center" },
          { key: "acciones", label: "Acciones", align: "center" },
        ],
      };
    }

    return {
      gridCols: "minmax(200px,1.45fr) minmax(145px,1fr) 88px 98px minmax(115px,.75fr) 86px 112px",
      empty: "No hay registros de Stock para los filtros actuales.",
      columns: [
        { key: "nombre", label: "Stock" },
        { key: "categoria", label: "Categoría" },
        { key: "unidad", label: "Unidad", align: "center" },
        { key: "cantidad", label: "Cantidad", align: "center" },
        { key: "costo", label: "Costo", align: "right" },
        { key: "estado", label: "Estado", align: "center" },
        { key: "acciones", label: "Acciones", align: "center" },
      ],
    };
  }, [tab]);

  const renderSkeletonRow = (idx) => (
    <div
      key={`servicios-skel-${idx}`}
      className="mov-gridTable mov-gridTable--row mov-row--skeleton"
      style={{ gridTemplateColumns: tableConfig.gridCols }}
      role="row"
      aria-hidden="true"
    >
      {tableConfig.columns.map((column, columnIndex) => (
        <div
          key={column.key}
          className={[
            "mov-gridCell",
            column.key === "acciones" ? "mov-gridCell--actions" : "",
            column.align === "right" ? "is-right" : "",
            column.align === "center" ? "is-center" : "",
          ].filter(Boolean).join(" ")}
          role="cell"
          data-label={column.label}
        >
          {column.key === "acciones" ? (
            <div className="mov-skelActions"><span className="mov-skelIcon" /><span className="mov-skelIcon" /><span className="mov-skelIcon" /></div>
          ) : (
            <span className="mov-skeletonBar" style={{ width: `${48 + ((idx + columnIndex) % 4) * 11}%` }} />
          )}
        </div>
      ))}
    </div>
  );

  const renderActions = (item, activo) => {
    const edit = () => {
      if (tab === "servicios") return openEditServicio(item);
      if (tab === "insumos") return setInsumoModal({ open: true, item });
      return setStockModal({ open: true, item });
    };
    const toggle = () => {
      if (tab === "servicios") return toggleServicio(item);
      if (tab === "insumos") return toggleInsumo(item);
      return toggleStock(item);
    };
    const kind = tab === "servicios" ? "servicio" : tab === "insumos" ? "insumo" : "stock";

    return (
      <div className="mov-actionsInline">
        <button type="button" className="mov-iconBtn" title="Editar" aria-label="Editar" onClick={edit}>
          <FontAwesomeIcon icon={faPenToSquare} />
        </button>
        <button type="button" className="mov-iconBtn" title={activo ? "Dar de baja" : "Reactivar"} aria-label={activo ? "Dar de baja" : "Reactivar"} onClick={toggle}>
          <FontAwesomeIcon icon={activo ? faBan : faRotateLeft} />
        </button>
        <button type="button" className="mov-iconBtn mov-iconBtn--danger" title="Eliminar" aria-label="Eliminar" onClick={() => setDeleteModal({ open: true, kind, item })}>
          <FontAwesomeIcon icon={faTrashCan} />
        </button>
      </div>
    );
  };

  const renderRow = (item) => {
    const activo = Number(item.activo) === 1;
    const id = tab === "servicios" ? item.id_servicio : tab === "insumos" ? item.id_insumo : item.id_stock;
    const values = tab === "servicios" ? {
      nombre: <span className="servicios-nameCell"><strong>{item.nombre}</strong><small>{item.codigo || "SIN CÓDIGO"}</small></span>,
      categoria: item.categoria_nombre || "SIN CATEGORÍA",
      composicion: `${Number(item.cantidad_insumos || 0)} insumo(s) · ${Number(item.cantidad_productos_stock || 0)} de Stock`,
      costo: money(item.costo_estimado),
      precio: money(item.precio_venta),
      iva: formatIva(item.iva_pct),
    } : tab === "insumos" ? {
      nombre: <span className="servicios-nameCell"><strong>{item.nombre}</strong><small>{item.codigo || "SIN CÓDIGO"}</small></span>,
      categoria: item.categoria_nombre || "SIN CATEGORÍA",
      unidad: item.unidad_simbolo || item.unidad_nombre || "—",
      costo: money(item.costo_unitario),
      precio: item.precio_venta == null ? "—" : money(item.precio_venta),
      iva: formatIva(item.iva_pct),
    } : {
      nombre: <span className="servicios-nameCell"><strong>{item.nombre}</strong><small>{item.codigo || "SIN CÓDIGO"}</small></span>,
      categoria: item.categoria_nombre || "SIN CATEGORÍA",
      unidad: item.unidad_simbolo || item.unidad_nombre || "—",
      cantidad: integer(item.stock_actual),
      costo: money(item.costo_unitario),
    };

    return (
      <div
        key={`${tab}-${id}`}
        className={`mov-gridTable mov-gridTable--row ${activo ? "" : "servicios-row--inactive"}`.trim()}
        style={{ gridTemplateColumns: tableConfig.gridCols }}
        role="row"
      >
        {tableConfig.columns.map((column) => {
          if (column.key === "acciones") {
            return <div key={column.key} className="mov-gridCell mov-gridCell--actions is-center" role="cell" data-label={column.label}>{renderActions(item, activo)}</div>;
          }
          if (column.key === "estado") {
            return (
              <div key={column.key} className="mov-gridCell is-center" role="cell" data-label={column.label}>
                <span className={`mov-chip ${activo ? "mov-chip--ok" : "mov-chip--neutral"}`}>{activo ? "ACTIVO" : "BAJA"}</span>
              </div>
            );
          }
          return (
            <div
              key={column.key}
              className={["mov-gridCell", column.align === "right" ? "is-right" : "", column.align === "center" ? "is-center" : ""].filter(Boolean).join(" ")}
              role="cell"
              data-label={column.label}
            >
              <span className="mov-ellipsissss">{values[column.key] ?? "—"}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const secondaryActions = (className = "") => (
    <div className={className}>
      <BotonExportar className="servicios-exportAction" label="Exportar" title="Exportar vista actual" opciones={exportOptions} disabled={loading || currentRows.length === 0} align="right" />
      <button type="button" className="mov-btn mov-btn--ghost servicios-categoriesBtn" onClick={() => setCategoryModal({ open: true, kind: tab })} disabled={saving}>
        <FontAwesomeIcon icon={faTags} /> Gestionar categorías
      </button>
    </div>
  );

  return (
    <section className="mov-page servicios-page">
      {toast && (
        <Toast
          key={toast.id}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <section className="mov-card mov-card--table servicios-mainCard">
        <div className="mov-card__head">
          <div className="mov-card__headLeft">
            <div className="title-mov servicios-titleBlock">
              <div className="servicios-titleBlock__copy">
                <div className="mov-card__title">{inventoryMode ? "" : "Servicios"}</div>
                {!inventoryMode && (
                  <div className="mov-card__hint">Mostrando <b>{currentRows.length}</b> registro(s)</div>
                )}
              </div>

              {inventoryMode && (
                <div className="servicios-inventoryTabs" role="tablist" aria-label="Inventario e insumos">
                  <button
                    type="button"
                    className={`servicios-inventoryTab ${tab === "insumos" ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={tab === "insumos"}
                    onClick={() => setTab("insumos")}
                  >
                    Insumos
                  </button>
                  <button
                    type="button"
                    className={`servicios-inventoryTab ${tab === "stock" ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={tab === "stock"}
                    onClick={() => setTab("stock")}
                  >
                    Stock
                  </button>
                </div>
              )}
            </div>

            <div className="mov-headFilters servicios-headFilters">
              <div className="cc-filter cc-filter--search servicios-searchFilter">
                <div className="cc-floatingField cc-floatingField--search is-active">
                  <div className="cc-searchInput">
                    <div className="cc-searchInput__fieldWrap">
                      <input
                        className="cc-input cc-input--floating servicios-searchInput"
                        maxLength={100}
                        value={currentFilters.buscar}
                        onChange={(e) => updateFilter("buscar", upper(e.target.value).slice(0, 100))}
                        placeholder={SECTION_META[tab].searchPlaceholder}
                        aria-label="Buscar"
                      />
                      <span className="cc-floatingLabel"><FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda</span>
                      {currentFilters.buscar && (
                        <button type="button" className="cc-clearSearch cc-clearSearch--inside" title="Limpiar búsqueda" aria-label="Limpiar búsqueda" onClick={() => updateFilter("buscar", "")}>
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cc-filter servicios-filterCompact">
                <div className={`cc-floatingField ${currentFilters.categoria ? "is-active" : ""}`}>
                  <select className="servicios-globalSelect" value={currentFilters.categoria} onChange={(e) => updateFilter("categoria", e.target.value)} aria-label="Categoría">
                    <option value="">TODAS</option>
                    {activeCategoryList.map((category) => (
                      <option key={categoryId(category)} value={categoryId(category)}>{category.nombre}{Number(category.activo) === 1 ? "" : " (BAJA)"}</option>
                    ))}
                  </select>
                  <span className="cc-floatingLabel cc-floatingLabel--active">Categoría</span>
                </div>
              </div>

              <div className="mov-tabs servicios-statusTabs" role="tablist" aria-label="Filtrar por estado">
                {STATUS_FILTER_TABS.map((statusTab) => {
                  const isActive = currentFilters.estado === statusTab.value;
                  return (
                    <button
                      key={statusTab.value}
                      type="button"
                      className={`mov-tab servicios-statusTab ${isActive ? "is-active" : ""}`}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => updateFilter("estado", statusTab.value)}
                    >
                      {statusTab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mov-card__actions servicios-headActions">
            {secondaryActions("servicios-headSecondary")}
            <button type="button" className="mov-btn mov-btn--primary servicios-addBtn" onClick={openNew} disabled={saving}>
              <FontAwesomeIcon icon={faPlus} /> {SECTION_META[tab].addLabel}
            </button>
          </div>
        </div>

        <div className={`mov-gridTable mov-gridTable--head ${hasTableScroll ? "has-y-scroll" : ""}`} style={{ gridTemplateColumns: tableConfig.gridCols }} role="row">
          {tableConfig.columns.map((column) => (
            <div key={column.key} className={["mov-gridCell", "mov-gridCell--head", column.align === "right" ? "is-right" : "", column.align === "center" ? "is-center" : ""].filter(Boolean).join(" ")} role="columnheader">
              {column.label}
            </div>
          ))}
        </div>

        <div className="mov-tableWrap servicios-tableWrap" role="rowgroup" ref={tableWrapRef}>
          <div className="mov-gridBody mov-gridBody--relative">
            {loading ? (
              <div className="mov-skeletonWrap" aria-busy="true" aria-label="Cargando registros">
                {Array.from({ length: SKELETON_ROWS }).map((_, idx) => renderSkeletonRow(idx))}
              </div>
            ) : currentRows.length > 0 ? (
              currentRows.map(renderRow)
            ) : (
              <div className="cc-emptyState servicios-emptyState">
                <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                <div className="cc-emptyText">{tableConfig.empty}</div>
              </div>
            )}
          </div>
        </div>

        {secondaryActions("servicios-bottomActions")}
      </section>

      <ModalServicio
        open={serviceModal.open}
        item={serviceModal.item}
        categorias={categoriasServicios}
        insumos={insumos}
        stock={stock}
        saving={saving}
        onClose={() => setServiceModal({ open: false, item: null })}
        onSave={saveServicio}
        onToast={mostrarToast}
        onOpenAgregarCategoria={(onCreated) => openQuickCategory("servicios", onCreated)}
      />

      <ModalInsumo
        open={insumoModal.open}
        item={insumoModal.item}
        categorias={categoriasInsumos}
        unidades={unidades}
        saving={saving}
        onClose={() => setInsumoModal({ open: false, item: null })}
        onSave={saveInsumo}
        onToast={mostrarToast}
        onOpenAgregarCategoria={(onCreated) => openQuickCategory("insumos", onCreated)}
      />

      <ModalStock
        open={stockModal.open}
        item={stockModal.item}
        categorias={categoriasStock}
        unidades={unidades}
        saving={saving}
        onClose={() => setStockModal({ open: false, item: null })}
        onSave={saveStock}
        onToast={mostrarToast}
        onOpenAgregarCategoria={(onCreated) => openQuickCategory("stock", onCreated)}
      />

      <ModalCategorias
        open={categoryModal.open}
        titulo={categoryConfig.titulo}
        categorias={categoryConfig.categorias}
        getId={categoryConfig.getId}
        getCount={categoryConfig.getCount}
        saving={saving}
        onClose={() => setCategoryModal((prev) => ({ ...prev, open: false }))}
        onAdd={() => openQuickCategory(categoryModal.kind)}
        onEdit={(category) => openQuickCategory(categoryModal.kind, null, category)}
        onToggle={toggleCategory}
        onDelete={deleteCategory}
        nota={categoryConfig.nota}
      />

      <ModalAgregarCategoria
        open={quickCategoryModal.open}
        titulo={quickCategoryModal.item ? quickCategoryConfig.editTitulo : quickCategoryConfig.titulo}
        subtitulo={quickCategoryModal.item
          ? quickCategoryConfig.editSubtitulo
          : quickCategoryModal.selectOnCreate
            ? quickCategoryConfig.subtitulo
            : "Completá los datos para incorporarla al catálogo."}
        initialValues={quickCategoryModal.item}
        submitLabel={quickCategoryModal.item ? "Guardar cambios" : "Agregar categoría"}
        saving={saving}
        onClose={closeQuickCategory}
        onSave={saveQuickCategory}
        onToast={mostrarToast}
      />

      <ModalEliminar
        open={deleteModal.open}
        row={deleteModal.item}
        loading={saving}
        onToast={mostrarToast}
        onClose={closeDeleteModal}
        onConfirm={confirmDelete}
        title={deleteModalCopy.title}
        message={deleteModalCopy.message}
        warning={deleteModalCopy.warning}
        loadingMessage="Eliminando registro…"
        successMessage="Registro eliminado correctamente."
        errorMessage="No se pudo eliminar el registro."
        confirmLabel="Eliminar definitivamente"
        details={deleteModalCopy.details}
      />

    </section>
  );
}
