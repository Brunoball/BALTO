import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import ModalCargaMasiva from "./modales/ModalCargaMasiva";
import ModalEditarProducto from "./modales/ModalEditarStock";
import ModalAjustePrecios from "./modales/ModalAjustePrecios";
import ModalHistorialPreciosProducto from "./modales/ModalHistorialPreciosProducto";
import ModalReportesStock from "./modales/ModalReportesStock";
import ModalDarBajaStock from "./modales/ModalDarBajaStock";
import ModalEliminarStock from "./modales/ModalEliminarStock";
import Toast from "../Global/Toast";
import BaltoCargaGif from "../../imagenes/Balto_Carga.gif";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faMagnifyingGlass,
  faTimes,
  faPenToSquare,
  faTrashCan,
  faBoxOpen,
  faChevronUp,
  faChevronDown,
  faSort,
  faLayerGroup,
  faMoneyBillTrendUp,
  faClockRotateLeft,
  faRotateLeft,
  faChartColumn,
} from "@fortawesome/free-solid-svg-icons";
import "./Stock.css";
import "../Global/Global_css/Global_Section.css";

import {
  API_URL,
  getUsuarioAuditData,
  notifyStockListsUpdated,
  stockGetParams,
  stockPostPayload,
} from "./api/stockApi";
import useStockCategoriasDatos from "./hooks/useStockCategoriasDatos";
import useStockToast from "./hooks/useStockToast";
import {
  COLUMNS,
  GRID_COLS,
  SKELETON_ROWS,
  SKEL_WIDTHS,
  aplicarProteccionMutacionVariantes,
  esToastCarga,
  esperarSincronizacionTiendaNube,
  extractProductoFromApiResponse,
  formatMoney,
  getProductoId,
  getProductoImageUrl,
  getVarianteId,
  mergeProductoEnLista,
  mergeProductoPreferenciaLocal,
  mergeVariantesPreferenciaLocal,
  normalizeCategoria,
  normalizeProductoListItem,
  normalizeProductosCollection,
  normalizeText,
  normalizeVarianteListItem,
  normalizeVariantesCollection,
  pluralize,
  preservarVariantesInactivasOmitidas,
  productoTieneCategoria,
  toNonNegativeInt,
  variantAttributesLabel,
  variantCategoriasLabel,
} from "./utils/stockUtils";

const PRECIOS_MASIVOS_LOADING_THRESHOLD = 10;
const STOCK_CHANGE_CHECK_MS = 2500;
const OPTIMISTIC_PRODUCT_GRACE_MS = 20000;
const VARIANT_MUTATION_GRACE_MS = 180000;

function renderStockChip(value) {
  const stockNum = Number(value || 0);
  let stockClass = "mov-chip mov-chip--danger";
  let stockLabel = "Sin stock";

  if (stockNum > 10) {
    stockClass = "mov-chip mov-chip--ok";
    stockLabel = stockNum;
  } else if (stockNum > 0 && stockNum <= 10) {
    stockClass = "mov-chip mov-chip--warn";
    stockLabel = stockNum;
  }

  return <span className={stockClass}>{stockLabel}</span>;
}

const Stock = () => {
  const [productosRaw, setProductosRaw] = useState([]);
  const [categorias, setCategorias] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingCategorias, setLoadingCategorias] = useState(false);
  const [error, setError] = useState(null);

  const [busqueda, setBusqueda] = useState("");
  const [busquedaConsulta, setBusquedaConsulta] = useState("");
  const [categoriaFiltro, setCategoriaFiltro] = useState("");
  const [mostrarDadosDeBaja, setMostrarDadosDeBaja] = useState(false);
  const [categoriaDropdownAbierto, setCategoriaDropdownAbierto] = useState(false);
  const [categoriasFiltroExpandidas, setCategoriasFiltroExpandidas] = useState({});
  const [paginaActual, setPaginaActual] = useState(1);
  const [totalProductosServidor, setTotalProductosServidor] = useState(0);
  const [totalPaginasServidor, setTotalPaginasServidor] = useState(1);
  const [orden, setOrden] = useState({ campo: "nombre", dir: "ASC" });

  const [modalAbierto, setModalAbierto] = useState(false);
  const [modalEditarAbierto, setModalEditarAbierto] = useState(false);
  const [productoEditarId, setProductoEditarId] = useState(null);
  const [modalAjustePreciosAbierto, setModalAjustePreciosAbierto] = useState(false);
  const [modalReportesAbierto, setModalReportesAbierto] = useState(false);
  const [productoHistorialPrecios, setProductoHistorialPrecios] = useState(null);

  const [modalDarBajaProductoAbierto, setModalDarBajaProductoAbierto] = useState(false);
  const [modalEliminarAbierto, setModalEliminarAbierto] = useState(false);
  const [modalConfirmacionFinalEliminarAbierto, setModalConfirmacionFinalEliminarAbierto] = useState(false);
  const [productoEliminar, setProductoEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [accionEliminacionProducto, setAccionEliminacionProducto] = useState("");
  const [modalBajaVarianteAbierto, setModalBajaVarianteAbierto] = useState(false);
  const [modalEliminarVarianteAbierto, setModalEliminarVarianteAbierto] = useState(false);
  const [modalConfirmacionFinalVarianteAbierto, setModalConfirmacionFinalVarianteAbierto] = useState(false);
  const [varianteBaja, setVarianteBaja] = useState(null);
  const [procesandoVarianteId, setProcesandoVarianteId] = useState(null);
  const [accionEliminacionVariante, setAccionEliminacionVariante] = useState("");
  const [reactivandoId, setReactivandoId] = useState(null);
  const [impactoEliminar, setImpactoEliminar] = useState(null);
  const [cargandoImpactoEliminar, setCargandoImpactoEliminar] = useState(false);
  const [errorImpactoEliminar, setErrorImpactoEliminar] = useState("");
  const [impactoEliminarVariante, setImpactoEliminarVariante] = useState(null);
  const [cargandoImpactoEliminarVariante, setCargandoImpactoEliminarVariante] = useState(false);
  const [errorImpactoEliminarVariante, setErrorImpactoEliminarVariante] = useState("");

  const {
    toast,
    cerrarToast,
    mostrarResultadoTiendaNube,
    mostrarResultadoTiendaNubeConfirmado,
    mostrarToast,
    mostrarToastCarga,
  } = useStockToast();
  const [cargaPreciosMasivos, setCargaPreciosMasivos] = useState(null);
  const [versionImagenPorProducto, setVersionImagenPorProducto] = useState({});
  const [erroresImagenes, setErroresImagenes] = useState({});
  const [reintentosImagenes, setReintentosImagenes] = useState({});
  const [imagenesTemporalesPorProducto, setImagenesTemporalesPorProducto] = useState({});
  const [variantesAbiertas, setVariantesAbiertas] = useState({});
  const [variantesPorProducto, setVariantesPorProducto] = useState({});
  const [loadingVariantesPorProducto, setLoadingVariantesPorProducto] = useState({});
  const [errorVariantesPorProducto, setErrorVariantesPorProducto] = useState({});

  const refreshTimersRef = useRef([]);
  const imagenesTemporalesRef = useRef({});
  const imagenesConocidasPorProductoRef = useRef({});
  const productosOptimistasRef = useRef({});
  const variantesPorProductoRef = useRef({});
  const mutacionesVariantesRef = useRef({});
  const impactoEliminarRequestRef = useRef(0);
  const impactoEliminarVarianteRequestRef = useRef(0);
  const productosRequestRef = useRef(0);
  const categoriaFiltroDropdownRef = useRef(null);
  const tablaScrollRef = useRef(null);
  const tablaScrollSnapshotRef = useRef({
    top: 0,
    left: 0,
    anchorId: 0,
    anchorOffset: 0,
    restaurar: false,
  });
  const tablaScrollRafRef = useRef([]);
  const tablaScrollTimerRef = useRef([]);
  const stockVersionRef = useRef({ catalogo: "", imagenes: "", categorias: "" });
  const stockChangeCheckRunningRef = useRef(false);
  const productosPorPagina = 20;

  useEffect(() => {
    variantesPorProductoRef.current = variantesPorProducto;
  }, [variantesPorProducto]);

  const obtenerProteccionMutacionVariantes = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id) return null;
    const registro = mutacionesVariantesRef.current?.[id] || null;
    if (!registro) return null;
    if (Number(registro?.expiresAt || 0) > Date.now()) return registro;

    const next = { ...(mutacionesVariantesRef.current || {}) };
    delete next[id];
    mutacionesVariantesRef.current = next;
    return null;
  }, []);

  const registrarMutacionVariantes = useCallback((productoId, cambios = {}) => {
    const id = Number(productoId || 0);
    if (!id) return null;

    const actual = obtenerProteccionMutacionVariantes(id) || {};
    const deletedIds = { ...(actual?.deletedIds || {}) };
    (Array.isArray(cambios?.deletedIds) ? cambios.deletedIds : []).forEach((varianteId) => {
      const idVariante = Number(varianteId || 0);
      if (idVariante > 0) deletedIds[idVariante] = true;
    });

    const desiredActive = { ...(actual?.desiredActive || {}) };
    Object.entries(cambios?.desiredActive || {}).forEach(([varianteId, estado]) => {
      const idVariante = Number(varianteId || 0);
      if (idVariante > 0) desiredActive[idVariante] = Number(estado) === 1 ? 1 : 0;
    });

    Object.keys(deletedIds).forEach((varianteId) => {
      delete desiredActive[varianteId];
    });

    const fuerzaVariantesDefinida = Object.prototype.hasOwnProperty.call(cambios || {}, "forceNoVariants");
    const registro = {
      deletedIds,
      desiredActive,
      // Un guardado que vuelve a habilitar variantes debe poder levantar de forma
      // explícita la protección de "producto simple" creada por una acción anterior.
      forceNoVariants: fuerzaVariantesDefinida
        ? cambios.forceNoVariants === true
        : actual?.forceNoVariants === true,
      expiresAt: Date.now() + Math.max(15000, Number(cambios?.duracionMs || VARIANT_MUTATION_GRACE_MS)),
    };

    mutacionesVariantesRef.current = {
      ...(mutacionesVariantesRef.current || {}),
      [id]: registro,
    };
    return registro;
  }, [obtenerProteccionMutacionVariantes]);

  const cancelarRestauracionScrollTabla = useCallback(() => {
    tablaScrollRafRef.current.forEach((id) => window.cancelAnimationFrame(id));
    tablaScrollTimerRef.current.forEach((id) => window.clearTimeout(id));
    tablaScrollRafRef.current = [];
    tablaScrollTimerRef.current = [];
  }, []);

  const capturarPosicionScrollTabla = useCallback((opciones = {}) => {
    const forzar = opciones?.forzar === true;
    if (tablaScrollSnapshotRef.current?.restaurar && !forzar) return;

    const contenedor = tablaScrollRef.current;
    if (!contenedor) return;

    const contenedorRect = contenedor.getBoundingClientRect();
    const filas = Array.from(
      contenedor.querySelectorAll("[data-stock-product-id]")
    );
    const primeraVisible = filas.find(
      (fila) => fila.getBoundingClientRect().bottom > contenedorRect.top + 1
    );

    tablaScrollSnapshotRef.current = {
      top: contenedor.scrollTop,
      left: contenedor.scrollLeft,
      anchorId: Number(primeraVisible?.dataset?.stockProductId || 0),
      anchorOffset: primeraVisible
        ? primeraVisible.getBoundingClientRect().top - contenedorRect.top
        : 0,
      restaurar: true,
    };
  }, []);

  const aplicarPosicionScrollTabla = useCallback((finalizar = true) => {
    const contenedor = tablaScrollRef.current;
    const actual = tablaScrollSnapshotRef.current;
    if (!contenedor || !actual?.restaurar) return;

    let destinoTop = Number(actual.top || 0);
    if (actual.anchorId > 0) {
      const filaAncla = contenedor.querySelector(
        `[data-stock-product-id="${actual.anchorId}"]`
      );

      if (filaAncla) {
        const contenedorRect = contenedor.getBoundingClientRect();
        const offsetActual = filaAncla.getBoundingClientRect().top - contenedorRect.top;
        destinoTop = contenedor.scrollTop + offsetActual - Number(actual.anchorOffset || 0);
      }
    }

    const maxTop = Math.max(0, contenedor.scrollHeight - contenedor.clientHeight);
    contenedor.scrollTop = Math.max(0, Math.min(destinoTop, maxTop));
    contenedor.scrollLeft = Math.max(0, Number(actual.left || 0));

    if (finalizar) {
      tablaScrollSnapshotRef.current = { ...actual, restaurar: false };
      tablaScrollRafRef.current = [];
      tablaScrollTimerRef.current = [];
    }
  }, []);

  const programarRestauracionScrollTabla = useCallback((opciones = {}) => {
    const reactivar = opciones?.reactivar === true;
    const snapshot = tablaScrollSnapshotRef.current;

    if (reactivar && snapshot && (snapshot.anchorId > 0 || snapshot.top > 0 || snapshot.left > 0)) {
      tablaScrollSnapshotRef.current = { ...snapshot, restaurar: true };
    }

    if (!tablaScrollSnapshotRef.current?.restaurar) return;

    cancelarRestauracionScrollTabla();

    // Se restaura más de una vez porque, después de la recarga general, la fila
    // puede volver a cambiar de alto al llegar el detalle puntual de variantes.
    // El último pase deja la posición estabilizada sin enviar la tabla al inicio.
    const demoras = [0, 80, 220];
    demoras.forEach((demora, indice) => {
      const timerId = window.setTimeout(() => {
        const raf1 = window.requestAnimationFrame(() => {
          const raf2 = window.requestAnimationFrame(() => {
            aplicarPosicionScrollTabla(indice === demoras.length - 1);
          });
          tablaScrollRafRef.current.push(raf2);
        });
        tablaScrollRafRef.current.push(raf1);
      }, demora);
      tablaScrollTimerRef.current.push(timerId);
    });
  }, [aplicarPosicionScrollTabla, cancelarRestauracionScrollTabla]);

  const descartarPosicionScrollTabla = useCallback(() => {
    cancelarRestauracionScrollTabla();
    tablaScrollSnapshotRef.current = {
      top: 0,
      left: 0,
      anchorId: 0,
      anchorOffset: 0,
      restaurar: false,
    };

    const contenedor = tablaScrollRef.current;
    if (contenedor) {
      contenedor.scrollTop = 0;
      contenedor.scrollLeft = 0;
    }
  }, [cancelarRestauracionScrollTabla]);

  useLayoutEffect(() => {
    if (loading || !tablaScrollSnapshotRef.current?.restaurar) return undefined;
    programarRestauracionScrollTabla();
    return cancelarRestauracionScrollTabla;
  }, [cancelarRestauracionScrollTabla, loading, productosRaw, programarRestauracionScrollTabla]);

  useEffect(() => cancelarRestauracionScrollTabla, [cancelarRestauracionScrollTabla]);

  useEffect(() => {
    const valorNormalizado = busqueda.trim();
    const timer = window.setTimeout(() => {
      setBusquedaConsulta((prev) => (prev === valorNormalizado ? prev : valorNormalizado));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [busqueda]);

  const handleCargaPreciosMasivos = useCallback((estado) => {
    if (!estado?.open) {
      setCargaPreciosMasivos(null);
      return;
    }

    setCargaPreciosMasivos({
      total: Number(estado?.total || 0),
      tiendaNubeActiva:
        typeof estado?.tiendaNubeActiva === "boolean" ? estado.tiendaNubeActiva : undefined,
      startedAt: Date.now(),
    });
  }, []);

  const limpiarRefreshTimers = useCallback(() => {
    refreshTimersRef.current.forEach((id) => clearTimeout(id));
    refreshTimersRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      limpiarRefreshTimers();
      Object.values(imagenesTemporalesRef.current || {}).forEach((item) => {
        if (item?.url) URL.revokeObjectURL(item.url);
      });
      imagenesTemporalesRef.current = {};
    };
  }, [limpiarRefreshTimers]);

  const limpiarImagenTemporalProducto = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id) return;

    const actual = imagenesTemporalesRef.current?.[id];
    if (actual?.url) URL.revokeObjectURL(actual.url);

    const nextRef = { ...(imagenesTemporalesRef.current || {}) };
    delete nextRef[id];
    imagenesTemporalesRef.current = nextRef;

    setImagenesTemporalesPorProducto((prev) => {
      if (!prev?.[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const aplicarImagenTemporalProducto = useCallback((productoId, file) => {
    const id = Number(productoId || 0);
    if (!id || !file) return;

    const actual = imagenesTemporalesRef.current?.[id];
    if (actual?.url) URL.revokeObjectURL(actual.url);

    const temp = {
      url: URL.createObjectURL(file),
      createdAt: Date.now(),
    };

    imagenesTemporalesRef.current = {
      ...(imagenesTemporalesRef.current || {}),
      [id]: temp,
    };

    setImagenesTemporalesPorProducto((prev) => ({
      ...prev,
      [id]: temp,
    }));
  }, []);

  const registrarImagenConocidaProducto = useCallback((producto = null) => {
    const id = getProductoId(producto);
    if (!id) return false;

    const archivoId =
      Number(
        producto?.imagen_archivo_id ??
          producto?.id_archivo_imagen ??
          producto?.archivo_id ??
          producto?.id_archivo ??
          0
      ) || 0;
    const imagenPath = String(
      producto?.imagen_path ?? producto?.archivo_path ?? producto?.path_imagen ?? ""
    ).trim();

    if (!archivoId && !imagenPath) return false;

    const actual = imagenesConocidasPorProductoRef.current?.[id] || {};
    imagenesConocidasPorProductoRef.current = {
      ...(imagenesConocidasPorProductoRef.current || {}),
      [id]: {
        ...actual,
        imagen_archivo_id: archivoId || Number(actual?.imagen_archivo_id || 0),
        id_archivo_imagen: archivoId || Number(actual?.id_archivo_imagen || 0),
        archivo_id: archivoId || Number(actual?.archivo_id || 0),
        imagen_path: imagenPath || actual?.imagen_path || "",
        archivo_path: imagenPath || actual?.archivo_path || "",
        imagen_actualizada_en:
          producto?.imagen_actualizada_en ??
          producto?.updated_at ??
          producto?.fecha_actualizacion ??
          actual?.imagen_actualizada_en ??
          "",
      },
    };

    return true;
  }, []);

  const completarProductoConImagenConocida = useCallback((producto = null) => {
    if (!producto) return producto;

    const normalizado = normalizeProductoListItem(producto);
    if (!normalizado) return producto;

    const id = getProductoId(normalizado);
    const conocida = imagenesConocidasPorProductoRef.current?.[id];
    if (!conocida) return normalizado;

    const archivoActual = Number(
      normalizado?.imagen_archivo_id ??
        normalizado?.id_archivo_imagen ??
        normalizado?.archivo_id ??
        0
    );
    const archivoConocido = Number(
      conocida?.imagen_archivo_id ?? conocida?.id_archivo_imagen ?? conocida?.archivo_id ?? 0
    );

    if (archivoActual > 0) {
      return {
        ...normalizado,
        imagen_path: normalizado.imagen_path || conocida.imagen_path || "",
        archivo_path: normalizado.archivo_path || conocida.archivo_path || "",
      };
    }

    if (archivoConocido <= 0) return normalizado;

    return {
      ...normalizado,
      imagen_archivo_id: archivoConocido,
      id_archivo_imagen: archivoConocido,
      archivo_id: archivoConocido,
      imagen_path: normalizado.imagen_path || conocida.imagen_path || "",
      archivo_path: normalizado.archivo_path || conocida.archivo_path || "",
      imagen_actualizada_en:
        normalizado.imagen_actualizada_en || conocida.imagen_actualizada_en || normalizado.updated_at || "",
    };
  }, []);

  const obtenerProductoOptimistaActivo = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id) return null;

    const registro = productosOptimistasRef.current?.[id];
    if (!registro) return null;

    if (Number(registro?.expiresAt || 0) <= Date.now()) {
      const next = { ...(productosOptimistasRef.current || {}) };
      delete next[id];
      productosOptimistasRef.current = next;
      return null;
    }

    return registro?.producto || null;
  }, []);

  const listarProductosOptimistasActivos = useCallback(() => {
    const ahora = Date.now();
    const vigentes = [];
    const next = {};

    Object.entries(productosOptimistasRef.current || {}).forEach(([id, registro]) => {
      if (Number(registro?.expiresAt || 0) <= ahora || !registro?.producto) return;
      next[id] = registro;
      vigentes.push(registro.producto);
    });

    productosOptimistasRef.current = next;
    return vigentes;
  }, []);

  const registrarProductoOptimista = useCallback((producto = null, duracionMs = OPTIMISTIC_PRODUCT_GRACE_MS) => {
    const normalizado = normalizeProductoListItem(producto);
    const id = getProductoId(normalizado);
    if (!id) return normalizado;

    productosOptimistasRef.current = {
      ...(productosOptimistasRef.current || {}),
      [id]: {
        producto: normalizado,
        expiresAt: Date.now() + Math.max(2500, Number(duracionMs || OPTIMISTIC_PRODUCT_GRACE_MS)),
      },
    };

    return normalizado;
  }, []);

  const limpiarProductoOptimista = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id || !productosOptimistasRef.current?.[id]) return;
    const next = { ...(productosOptimistasRef.current || {}) };
    delete next[id];
    productosOptimistasRef.current = next;
  }, []);

  const aplicarProductoOptimista = useCallback((producto = null) => {
    const id = getProductoId(producto);
    if (!id) return normalizeProductoListItem(producto);

    const optimista = obtenerProductoOptimistaActivo(id);
    return optimista
      ? mergeProductoPreferenciaLocal(producto, optimista)
      : normalizeProductoListItem(producto);
  }, [obtenerProductoOptimistaActivo]);

  const prepararProductosParaMostrar = useCallback(
    (items = []) => {
      const activoEsperado = mostrarDadosDeBaja ? 0 : 1;
      const normalizados = normalizeProductosCollection(items)
        .map((item) => aplicarProductoOptimista(item))
        .map((item) => {
          const idProducto = getProductoId(item);
          const proteccion = obtenerProteccionMutacionVariantes(idProducto);
          if (!item || proteccion?.forceNoVariants !== true) return item;

          // Durante la ventana en que Tienda Nube procesa la conversión, cualquier
          // snapshot viejo se representa como producto simple y no puede reabrir filas.
          return normalizeProductoListItem({
            ...item,
            tiene_variantes: false,
            cantidad_variantes: 0,
            cantidad_variantes_total: 0,
            cantidad_variantes_activas: 0,
            cantidad_variantes_inactivas: 0,
            stock_variantes: 0,
            variantes: [],
          });
        })
        .filter(Boolean)
        // La pestaña visible siempre manda. Una respuesta vieja que terminó después
        // de una baja/alta no puede volver a insertar el producto en la lista opuesta.
        // El backend ya filtra por `activo`, pero esta segunda barrera evita mezclar
        // ambos estados cuando se cruzan dos lecturas durante una mutación.
        .filter((item) => Number(item?.activo ?? 1) === activoEsperado);

      // En la primera página se conserva también un alta local que todavía no
      // apareció en una lectura intermedia. Respeta los filtros visibles para
      // no insertar productos ajenos a la búsqueda actual.
      if (paginaActual === 1) {
        const idsPresentes = new Set(normalizados.map((item) => getProductoId(item)));
        const busquedaNormalizada = normalizeText(busquedaConsulta);

        listarProductosOptimistasActivos().forEach((producto) => {
          const id = getProductoId(producto);
          if (!id || idsPresentes.has(id)) return;

          if (Number(producto?.activo ?? 1) !== activoEsperado) return;
          if (categoriaFiltro && !productoTieneCategoria(producto, categoriaFiltro)) return;

          if (busquedaNormalizada) {
            const coincide = [producto?.nombre, producto?.sku, producto?.descripcion]
              .some((valor) => normalizeText(valor).includes(busquedaNormalizada));
            if (!coincide) return;
          }

          normalizados.unshift(producto);
          idsPresentes.add(id);
        });
      }

      normalizados.forEach((item) => registrarImagenConocidaProducto(item));
      return normalizados.map((item) => completarProductoConImagenConocida(item));
    },
    [
      aplicarProductoOptimista,
      busquedaConsulta,
      categoriaFiltro,
      completarProductoConImagenConocida,
      listarProductosOptimistasActivos,
      mostrarDadosDeBaja,
      obtenerProteccionMutacionVariantes,
      paginaActual,
      registrarImagenConocidaProducto,
    ]
  );

  const invalidarMiniaturaProducto = useCallback((productoId, seed = Date.now()) => {
    const id = Number(productoId || 0);
    if (!id) return;

    setVersionImagenPorProducto((prev) => ({
      ...prev,
      [id]: seed,
    }));

    setErroresImagenes((prev) => {
      if (!prev?.[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    setReintentosImagenes((prev) => {
      if (!prev?.[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const rearmarMiniaturasProductos = useCallback((listaProductos = [], seed = Date.now()) => {
    const ids = new Set();
    const idsConImagen = new Set();
    const listaNormalizada = (Array.isArray(listaProductos) ? listaProductos : [])
      .map((item) => {
        registrarImagenConocidaProducto(item);
        return completarProductoConImagenConocida(item);
      })
      .filter(Boolean);

    listaNormalizada.forEach((item) => {
      const id = getProductoId(item);
      if (!id) return;
      ids.add(id);
      if (Number(item?.imagen_archivo_id || 0) > 0) idsConImagen.add(id);
    });

    if (ids.size === 0) return;

    setErroresImagenes((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((id) => {
        if (Object.prototype.hasOwnProperty.call(next, id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setReintentosImagenes((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((id) => {
        if (Object.prototype.hasOwnProperty.call(next, id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    if (idsConImagen.size > 0) {
      setVersionImagenPorProducto((prev) => {
        const next = { ...prev };
        idsConImagen.forEach((id) => {
          next[id] = seed;
        });
        return next;
      });
    }
  }, [completarProductoConImagenConocida, registrarImagenConocidaProducto]);

  const programarReintentoImagen = useCallback((productoId) => {
    const timerId = setTimeout(() => {
      setReintentosImagenes((prev) => ({
        ...prev,
        [productoId]: Number(prev?.[productoId] || 0) + 1,
      }));

      setErroresImagenes((prev) => {
        if (!prev?.[productoId]) return prev;
        const next = { ...prev };
        delete next[productoId];
        return next;
      });
    }, 900);

    refreshTimersRef.current.push(timerId);
  }, []);

  const recargarTodo = useCallback(async (opciones = {}) => {
    const mostrarLoader = opciones?.mostrarLoader !== false;
    const seed = opciones?.seed || Date.now();
    const preservarScroll = opciones?.preservarScroll !== false;

    if (preservarScroll) capturarPosicionScrollTabla();
    if (mostrarLoader) setLoading(true);
    setError(null);

    try {
      const [productosRes, categoriasRes] = await Promise.allSettled([
        (async () => {
          const params = new URLSearchParams({
            action: "stock_productos_listar",
            activo: mostrarDadosDeBaja ? "0" : "1",
            pagina: String(paginaActual),
            por_pagina: String(productosPorPagina),
            orden_campo: orden.campo,
            orden_dir: orden.dir,
            _r: String(seed),
          });
          if (categoriaFiltro) params.set("id_categoria", String(categoriaFiltro));
          if (busquedaConsulta) params.set("buscar", busquedaConsulta);

          const data = await stockGetParams(params, { strict: false });
          if (data?.exito === false) {
            throw new Error(data?.mensaje || "Error al obtener productos");
          }

          return {
            productos: prepararProductosParaMostrar(data?.productos),
            total: Number(data?.total ?? 0),
            pagina: Number(data?.pagina ?? paginaActual),
            totalPaginas: Math.max(1, Number(data?.total_paginas ?? 1)),
          };
        })(),
        (async () => {
          const params = new URLSearchParams({
            action: "stock_categorias_listar",
            _r: String(seed),
          });
          const data = await stockGetParams(params, { strict: false });
          const lista = (Array.isArray(data?.categorias) ? data.categorias : [])
            .map((cat) => normalizeCategoria(cat))
            .filter((cat) => Number(cat.id_stock_categoria) > 0);

          return [...lista].sort((a, b) =>
            String(a?.nombre_mostrar || a?.nombre || "").localeCompare(String(b?.nombre_mostrar || b?.nombre || ""), "es", {
              sensitivity: "base",
            })
          );
        })(),
      ]);

      if (productosRes.status === "fulfilled") {
        setProductosRaw(productosRes.value.productos);
        rearmarMiniaturasProductos(productosRes.value.productos, seed);
        setTotalProductosServidor(productosRes.value.total);
        setTotalPaginasServidor(productosRes.value.totalPaginas);
        if (productosRes.value.pagina && productosRes.value.pagina !== paginaActual) {
          setPaginaActual(productosRes.value.pagina);
        }
      } else {
        setProductosRaw([]);
        setTotalProductosServidor(0);
        setTotalPaginasServidor(1);
        throw productosRes.reason;
      }

      if (categoriasRes.status === "fulfilled") {
        setCategorias(categoriasRes.value);
      } else {
        setCategorias([]);
      }
    } catch (err) {
      if (mostrarLoader) setError(err?.message || "Error inesperado");
      throw err;
    } finally {
      if (mostrarLoader) setLoading(false);
    }
  }, [busquedaConsulta, capturarPosicionScrollTabla, categoriaFiltro, mostrarDadosDeBaja, orden, paginaActual, productosPorPagina, prepararProductosParaMostrar, rearmarMiniaturasProductos]);

  const refrescarProductoPorId = useCallback(async (productoId, opciones = {}) => {
    const id = Number(productoId || 0);
    if (!id) return null;

    const params = new URLSearchParams({
      action: "stock_producto_obtener",
      id: String(id),
      _r: String(opciones?.seed || Date.now()),
    });

    const data = await stockGetParams(params, { strict: false });
    if (data?.exito === false) {
      throw new Error(data?.mensaje || "No se pudo refrescar el producto editado.");
    }

    const productoActualizado = extractProductoFromApiResponse(data);
    if (!productoActualizado) return null;

    const productoPreferido = aplicarProductoOptimista(productoActualizado);
    registrarImagenConocidaProducto(productoPreferido);
    const productoConImagen = completarProductoConImagenConocida(productoPreferido);

    setProductosRaw((prev) => mergeProductoEnLista(prev, productoConImagen));
    rearmarMiniaturasProductos([productoConImagen], opciones?.seed || Date.now());

    const productoNormalizado = normalizeProductoListItem(productoConImagen);
    const idNormalizado = getProductoId(productoNormalizado) || id;

    if (Array.isArray(productoPreferido?.variantes)) {
      setVariantesPorProducto((prev) => ({
        ...prev,
        [idNormalizado]: normalizeVariantesCollection(productoPreferido.variantes),
      }));
      setErrorVariantesPorProducto((prev) => {
        const next = { ...prev };
        delete next[idNormalizado];
        return next;
      });
    }

    return productoNormalizado || productoActualizado;
  }, [aplicarProductoOptimista, completarProductoConImagenConocida, rearmarMiniaturasProductos, registrarImagenConocidaProducto]);

  const refrescarListaYProducto = useCallback(async (productoId = 0, opciones = {}) => {
    const id = Number(productoId || 0);
    const seed = opciones?.seed || Date.now();

    try {
      await recargarTodo({ mostrarLoader: opciones?.mostrarLoader === true, seed });
    } catch {}

    if (id > 0) {
      if (opciones?.recargarProducto !== false) {
        try {
          await refrescarProductoPorId(id, { seed });
        } catch {}
      }

      if (opciones?.invalidarImagen !== false) {
        invalidarMiniaturaProducto(id, seed);
      }
    }
  }, [invalidarMiniaturaProducto, recargarTodo, refrescarProductoPorId]);

  const programarRefrescoPostImagen = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id) return;

    limpiarRefreshTimers();

    // La vista previa local se mantiene hasta comprobar que la imagen recién
    // guardada realmente carga desde Balto. Antes se quitaba a los 1,4 segundos:
    // si R2 todavía no respondía, reaparecía la imagen vieja y parecía que la
    // edición sólo se aplicaba cuando terminaba Tienda Nube.
    const demoras = [400, 900, 1800, 3500, 6500, 10000];

    const programarIntento = (indice) => {
      if (indice >= demoras.length) return;

      const timerId = window.setTimeout(async () => {
        const temporalEsperada = imagenesTemporalesRef.current?.[id];
        if (!temporalEsperada?.url) return;

        try {
          const productoActualizado = await refrescarProductoPorId(id, { seed: Date.now() });
          const archivoId = Number(productoActualizado?.imagen_archivo_id || 0);
          const imageUrl = archivoId > 0
            ? getProductoImageUrl(productoActualizado, API_URL, Date.now(), indice)
            : "";

          if (!imageUrl) {
            programarIntento(indice + 1);
            return;
          }

          const precarga = new window.Image();
          precarga.onload = () => {
            const temporalActual = imagenesTemporalesRef.current?.[id];
            if (temporalActual?.url !== temporalEsperada.url) return;
            limpiarImagenTemporalProducto(id);
            invalidarMiniaturaProducto(id, Date.now());
          };
          precarga.onerror = () => {
            const temporalActual = imagenesTemporalesRef.current?.[id];
            if (temporalActual?.url !== temporalEsperada.url) return;
            programarIntento(indice + 1);
          };
          precarga.src = imageUrl;
        } catch {
          // La edición ya está guardada. Se conserva la vista previa y se vuelve a
          // comprobar el archivo local sin esperar el webhook de Tienda Nube.
          programarIntento(indice + 1);
        }
      }, demoras[indice]);

      refreshTimersRef.current.push(timerId);
    };

    programarIntento(0);
  }, [invalidarMiniaturaProducto, limpiarImagenTemporalProducto, limpiarRefreshTimers, refrescarProductoPorId]);

  const refrescarDespuesDeGuardar = useCallback(
    async (productoGuardado = null, opciones = {}) => {
      capturarPosicionScrollTabla({ forzar: opciones?.forzar_captura_scroll !== false });

      const productoFuente = opciones?.producto_optimista || productoGuardado;
      const productoOptimista = productoFuente
        ? registrarProductoOptimista(productoFuente, opciones?.optimistic_ttl_ms)
        : null;
      const productoId =
        getProductoId(productoOptimista) ||
        getProductoId(productoGuardado) ||
        Number(opciones?.productoId || 0);
      const imagenActualizada = !!opciones?.imagen_actualizada;
      const imagenEliminada = !!opciones?.imagen_eliminada;
      const variantesEliminadasIds = Array.isArray(opciones?.variantes_eliminadas_ids)
        ? opciones.variantes_eliminadas_ids.map((id) => Number(id)).filter((id) => id > 0)
        : [];

      const estadoVariantesDefinido = Object.prototype.hasOwnProperty.call(
        opciones || {},
        "variantes_desactivadas"
      );
      if (productoId > 0 && (variantesEliminadasIds.length > 0 || estadoVariantesDefinido)) {
        registrarMutacionVariantes(productoId, {
          deletedIds: variantesEliminadasIds,
          ...(estadoVariantesDefinido
            ? { forceNoVariants: opciones?.variantes_desactivadas === true }
            : {}),
        });
      }

      if (productoId > 0 && imagenActualizada && opciones?.imagen_file) {
        aplicarImagenTemporalProducto(productoId, opciones.imagen_file);
      }

      if (productoId > 0 && imagenEliminada) {
        limpiarImagenTemporalProducto(productoId);
      }

      if (productoOptimista) {
        registrarImagenConocidaProducto(productoOptimista);
        const productoConImagen = completarProductoConImagenConocida(productoOptimista);

        // La respuesta del guardado local es la fuente inmediata de la grilla.
        // No se vuelve a consultar toda la lista acá porque ese request podía
        // cruzarse con el job/webhook de Tienda Nube y mostrar datos parciales.
        setProductosRaw((prev) => mergeProductoEnLista(prev, productoConImagen));
        rearmarMiniaturasProductos([productoConImagen], Date.now());

        if (productoId > 0 && Array.isArray(productoConImagen?.variantes)) {
          const proteccion = obtenerProteccionMutacionVariantes(productoId);
          const variantesProtegidas = aplicarProteccionMutacionVariantes(
            productoConImagen.variantes,
            proteccion
          );
          setVariantesPorProducto((prev) => {
            const next = {
              ...prev,
              [productoId]: variantesProtegidas,
            };
            variantesPorProductoRef.current = next;
            return next;
          });
          setErrorVariantesPorProducto((prev) => {
            const next = { ...prev };
            delete next[productoId];
            return next;
          });
        }

        if (productoId > 0 && (imagenActualizada || imagenEliminada)) {
          invalidarMiniaturaProducto(productoId, Date.now());
          programarRefrescoPostImagen(productoId);
        }

        return productoConImagen;
      }

      // Procesos sin producto puntual (por ejemplo ajustes masivos) mantienen
      // la recarga completa tradicional.
      await refrescarListaYProducto(productoId, {
        seed: Date.now(),
        mostrarLoader: opciones?.mostrarLoader === true,
        invalidarImagen: false,
      });

      return null;
    },
    [
      aplicarImagenTemporalProducto,
      capturarPosicionScrollTabla,
      completarProductoConImagenConocida,
      invalidarMiniaturaProducto,
      limpiarImagenTemporalProducto,
      programarRefrescoPostImagen,
      rearmarMiniaturasProductos,
      registrarImagenConocidaProducto,
      registrarMutacionVariantes,
      registrarProductoOptimista,
      obtenerProteccionMutacionVariantes,
      refrescarListaYProducto,
    ]
  );

  const fetchCategorias = useCallback(async () => {
    setLoadingCategorias(true);

    try {
      const params = new URLSearchParams({ action: "stock_categorias_listar" });
      const data = await stockGetParams(params, { strict: false });
      const lista = (Array.isArray(data?.categorias) ? data.categorias : [])
        .map((cat) => normalizeCategoria(cat))
        .filter((cat) => Number(cat.id_stock_categoria) > 0);

      setCategorias(
        [...lista].sort((a, b) =>
          String(a?.nombre_mostrar || a?.nombre || "").localeCompare(String(b?.nombre_mostrar || b?.nombre || ""), "es", {
            sensitivity: "base",
          })
        )
      );
    } catch (err) {
      setCategorias([]);
      mostrarToast("error", err?.message || "No se pudieron cargar las categorías.");
    } finally {
      setLoadingCategorias(false);
    }
  }, [mostrarToast]);

  const fetchProductos = useCallback(async (opciones = {}) => {
    const requestId = productosRequestRef.current + 1;
    productosRequestRef.current = requestId;

    const silencioso = opciones?.silencioso === true;
    const preservarImagenes = opciones?.preservarImagenes === true;
    const preservarScroll = opciones?.preservarScroll === true || silencioso;

    if (preservarScroll) capturarPosicionScrollTabla();

    if (!silencioso) {
      setLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({
        action: "stock_productos_listar",
        activo: mostrarDadosDeBaja ? "0" : "1",
        pagina: String(paginaActual),
        por_pagina: String(productosPorPagina),
        orden_campo: orden.campo,
        orden_dir: orden.dir,
        _r: String(Date.now()),
      });
      if (categoriaFiltro) params.set("id_categoria", String(categoriaFiltro));
      if (busquedaConsulta) params.set("buscar", busquedaConsulta);

      const data = await stockGetParams(params, { strict: false });
      if (productosRequestRef.current !== requestId) return;

      if (data.exito === false) {
        throw new Error(data.mensaje || "Error al obtener productos");
      }

      const productosNormalizados = prepararProductosParaMostrar(data.productos);
      if (productosRequestRef.current !== requestId) return;

      setProductosRaw(productosNormalizados);
      if (!preservarImagenes) {
        rearmarMiniaturasProductos(productosNormalizados, Date.now());
      }
      setTotalProductosServidor(Number(data?.total ?? 0));
      setTotalPaginasServidor(Math.max(1, Number(data?.total_paginas ?? 1)));
      const paginaServidor = Number(data?.pagina ?? paginaActual);
      if (paginaServidor > 0 && paginaServidor !== paginaActual) {
        setPaginaActual(paginaServidor);
      }
    } catch (err) {
      if (productosRequestRef.current !== requestId) return;

      // Una comprobación automática nunca borra la grilla ni muestra loaders.
      if (!silencioso) {
        setProductosRaw([]);
        setTotalProductosServidor(0);
        setTotalPaginasServidor(1);
        setError(err.message || "Error inesperado");
      }
    } finally {
      if (!silencioso && productosRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [busquedaConsulta, capturarPosicionScrollTabla, categoriaFiltro, mostrarDadosDeBaja, orden, paginaActual, productosPorPagina, prepararProductosParaMostrar, rearmarMiniaturasProductos]);


  const cargarVariantesProducto = useCallback(async (productoId, opciones = {}) => {
    const id = Number(productoId || 0);
    if (!id) return;

    const silencioso = opciones?.silencioso === true;
    if (!silencioso) {
      setLoadingVariantesPorProducto((prev) => ({ ...prev, [id]: true }));
      setErrorVariantesPorProducto((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }

    try {
      const params = new URLSearchParams({
        action: "stock_variantes_listar",
        id_stock_producto: String(id),
        activo: "todos",
        _r: String(Date.now()),
      });
      if (categoriaFiltro) params.set("id_categoria", String(categoriaFiltro));

      const data = await stockGetParams(params, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || "No se pudieron cargar las variantes.");
      }

      // Una acción directa de alta/baja debe leer la DB real. El snapshot optimista
      // de una edición anterior puede seguir vigente 20 segundos y mostrar el estado
      // contrario aunque el backend ya haya confirmado el cambio.
      const productoOptimista = opciones?.ignorarOptimista === true
        ? null
        : obtenerProductoOptimistaActivo(id);
      const variantesServidor = data?.variantes || data?.data?.variantes || [];
      const variantesFuente = Array.isArray(productoOptimista?.variantes)
        ? mergeVariantesPreferenciaLocal(variantesServidor, productoOptimista.variantes)
        : variantesServidor;
      const variantesNormalizadas = normalizeVariantesCollection(variantesFuente);
      // Un webhook o una lectura transitoria puede omitir durante unos segundos una
      // variante que Balto ya confirmó como dada de baja. No se la quita de la vista:
      // sólo una eliminación permanente explícita puede hacer desaparecer esa fila.
      const variantesBase = opciones?.permitirOmitidas === true
        ? variantesNormalizadas
        : preservarVariantesInactivasOmitidas(
            variantesNormalizadas,
            variantesPorProductoRef.current?.[id] || []
          );
      const proteccionMutacion = obtenerProteccionMutacionVariantes(id);
      const variantes = aplicarProteccionMutacionVariantes(variantesBase, proteccionMutacion);
      const productoForzadoSimple = proteccionMutacion?.forceNoVariants === true;
      const variantesActivas = variantes.filter((variante) => Number(variante?.activo ?? 1) === 1);
      const stockVariantesActivas = variantesActivas.reduce((total, variante) => {
        const stock = Number(variante?.stock ?? 0);
        return total + (Number.isFinite(stock) ? stock : 0);
      }, 0);
      const varianteResumen = variantesActivas[0] || variantes[0] || null;
      setVariantesPorProducto((prev) => {
        const next = { ...prev, [id]: variantes };
        variantesPorProductoRef.current = next;
        return next;
      });
      // La fila padre resume las variantes: suma stock activo y toma los precios
      // de la primera variante activa (o la primera registrada si todas están de
      // baja). Así abrir/cerrar el detalle nunca cambia lo que muestra la tabla.
      setProductosRaw((prev) =>
        (Array.isArray(prev) ? prev : []).map((producto) =>
          getProductoId(producto) === id
            ? {
                ...producto,
                tiene_variantes: productoForzadoSimple
                  ? false
                  : (variantes.length > 0 || !!producto?.tiene_variantes),
                stock: productoForzadoSimple && variantes.length === 0
                  ? Number(producto?.stock ?? 0)
                  : stockVariantesActivas,
                stock_variantes: productoForzadoSimple ? 0 : stockVariantesActivas,
                ...(categoriaFiltro
                  ? {}
                  : {
                      cantidad_variantes: variantesActivas.length,
                      cantidad_variantes_total: variantes.length,
                      cantidad_variantes_activas: variantesActivas.length,
                      cantidad_variantes_inactivas: Math.max(0, variantes.length - variantesActivas.length),
                    }),
                ...(varianteResumen
                  ? {
                      precio_costo: varianteResumen.precio_costo ?? producto?.precio_costo ?? null,
                      precio: varianteResumen.precio ?? producto?.precio ?? null,
                      precio_promo: varianteResumen.precio_promo ?? producto?.precio_promo ?? null,
                    }
                  : {}),
              }
            : producto
        )
      );
    } catch (err) {
      if (!silencioso) {
        // Un fallo de red no significa que las variantes hayan sido eliminadas.
        // Se conserva exactamente la última lista válida y sólo se informa el error.
        setErrorVariantesPorProducto((prev) => ({
          ...prev,
          [id]: err?.message || "No se pudieron cargar las variantes.",
        }));
      }
    } finally {
      if (!silencioso) {
        setLoadingVariantesPorProducto((prev) => ({ ...prev, [id]: false }));
      }
    }
  }, [categoriaFiltro, obtenerProductoOptimistaActivo, obtenerProteccionMutacionVariantes]);

  const toggleVariantesProducto = useCallback((producto) => {
    const id = getProductoId(producto);
    if (!id) return;

    const abierto = !!variantesAbiertas[id];
    setVariantesAbiertas((prev) => ({ ...prev, [id]: !abierto }));

    if (!abierto && !variantesPorProducto[id]) {
      cargarVariantesProducto(id);
    }
  }, [cargarVariantesProducto, variantesAbiertas, variantesPorProducto]);

  useEffect(() => {
    variantesPorProductoRef.current = {};
    setVariantesPorProducto({});
    setErrorVariantesPorProducto({});
    setLoadingVariantesPorProducto({});
    setVariantesAbiertas({});
  }, [categoriaFiltro, mostrarDadosDeBaja]);

  useEffect(() => {
    fetchProductos();
  }, [fetchProductos]);

  useEffect(() => {
    fetchCategorias();
  }, [fetchCategorias]);

  // Consulta únicamente una versión liviana del estado de Stock. Mientras la
  // base no cambie, no vuelve a pedir productos, variantes ni imágenes.
  useEffect(() => {
    let desmontado = false;

    const consultarCambios = async () => {
      if (desmontado || document.hidden || stockChangeCheckRunningRef.current) return;
      stockChangeCheckRunningRef.current = true;

      try {
        const anterior = stockVersionRef.current || {};
        const params = new URLSearchParams({
          action: "stock_cambios_consultar",
          _r: String(Date.now()),
        });

        if (anterior.catalogo) params.set("catalogo_version", anterior.catalogo);
        if (anterior.imagenes) params.set("imagenes_version", anterior.imagenes);
        if (anterior.categorias) params.set("categorias_version", anterior.categorias);

        const data = await stockGetParams(params, { strict: false });
        if (desmontado || data?.exito === false) return;

        const primeraConsulta = !anterior.catalogo && !anterior.imagenes && !anterior.categorias;
        stockVersionRef.current = {
          catalogo: String(data?.catalogo_version || ""),
          imagenes: String(data?.imagenes_version || ""),
          categorias: String(data?.categorias_version || ""),
        };

        if (primeraConsulta) return;

        const cambioCatalogo = data?.catalogo_cambio === true;
        const cambioImagenes = data?.imagenes_cambio === true;
        const cambioCategorias = data?.categorias_cambio === true;

        if (cambioCatalogo || cambioImagenes || cambioCategorias) {
          // La lista se actualiza una sola vez cuando la DB cambió. Se preservan
          // las URLs de las imágenes que siguen apuntando al mismo archivo.
          await fetchProductos({ silencioso: true, preservarImagenes: true });
        }

        if (cambioCatalogo) {
          const productosExpandidos = Object.keys(variantesAbiertas || {})
            .filter((id) => variantesAbiertas[id])
            .map((id) => Number(id))
            .filter((id) => id > 0);

          if (productosExpandidos.length > 0) {
            await Promise.all(
              productosExpandidos.map((id) =>
                cargarVariantesProducto(id, { silencioso: true })
              )
            );
          }
        }

        if (cambioCategorias) {
          await fetchCategorias();
        }
      } catch {
        // Si falla la consulta liviana, se conserva exactamente lo visible.
      } finally {
        stockChangeCheckRunningRef.current = false;
      }
    };

    consultarCambios();
    const intervalId = window.setInterval(consultarCambios, STOCK_CHANGE_CHECK_MS);
    const handleFocus = () => consultarCambios();
    const handleVisibility = () => {
      if (!document.hidden) consultarCambios();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      desmontado = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [cargarVariantesProducto, fetchCategorias, fetchProductos, variantesAbiertas]);


  // Escucha actualizaciones de productos (stock-updated)
  useEffect(() => {
    const handleExternalListsUpdate = async () => {
      try {
        await refrescarDespuesDeGuardar();
      } catch {}
    };

    window.addEventListener("balto:stock-updated", handleExternalListsUpdate);
    return () => window.removeEventListener("balto:stock-updated", handleExternalListsUpdate);
  }, [refrescarDespuesDeGuardar]);

  // ✅ NUEVO: Escucha actualizaciones de listas/categorías (listas-updated)
  useEffect(() => {
    const handleExternalCategoriasUpdate = async () => {
      try {
        await fetchCategorias();
      } catch {}
    };

    window.addEventListener("balto:listas-updated", handleExternalCategoriasUpdate);

    return () => {
      window.removeEventListener("balto:listas-updated", handleExternalCategoriasUpdate);
    };
  }, [fetchCategorias]);

  const {
    categoriasPorId,
    categoriasPorPadre,
    categoriaFiltroIds,
    categoriaFiltroLabel,
  } = useStockCategoriasDatos({ categorias, categoriaFiltro });

  useEffect(() => {
    if (!categoriaDropdownAbierto) return;

    const handleClickOutside = (event) => {
      if (categoriaFiltroDropdownRef.current && !categoriaFiltroDropdownRef.current.contains(event.target)) {
        setCategoriaDropdownAbierto(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [categoriaDropdownAbierto]);

  useEffect(() => {
    const id = Number(categoriaFiltro || 0);
    if (!id) return;

    const expandidas = {};
    let cursor = Number(categoriasPorId[id]?.id_categoria_padre || 0);
    let guard = 0;
    while (cursor > 0 && categoriasPorId[cursor] && guard++ < 12) {
      expandidas[cursor] = true;
      cursor = Number(categoriasPorId[cursor]?.id_categoria_padre || 0);
    }

    if (Object.keys(expandidas).length > 0) {
      setCategoriasFiltroExpandidas((prev) => ({ ...prev, ...expandidas }));
    }
  }, [categoriaFiltro, categoriasPorId]);

  const seleccionarCategoriaFiltro = useCallback((id) => {
    descartarPosicionScrollTabla();
    setCategoriaFiltro(id ? String(id) : "");
    setCategoriaDropdownAbierto(false);
    setPaginaActual(1);
  }, [descartarPosicionScrollTabla]);

  const toggleCategoriaFiltroExpandida = useCallback((id) => {
    const n = Number(id || 0);
    if (!n) return;
    setCategoriasFiltroExpandidas((prev) => ({ ...prev, [n]: !prev[n] }));
  }, []);

  const renderCategoriaFiltroItem = useCallback((cat, nivel = 0) => {
    const id = Number(cat?.id_stock_categoria ?? cat?.id ?? 0);
    if (!id) return null;

    const hijas = categoriasPorPadre[id] || [];
    const tieneHijas = hijas.length > 0;
    const expandida = !!categoriasFiltroExpandidas[id];
    const seleccionada = Number(categoriaFiltro || 0) === id;

    return (
      <div className="stock-catFilterNode" key={id}>
        <div
          className={[
            "stock-catFilterOption",
            seleccionada ? "is-selected" : "",
            tieneHijas ? "has-children" : "",
          ].join(" ")}
          style={{ paddingLeft: 10 + nivel * 18 }}
        >
          {tieneHijas ? (
            <button
              type="button"
              className="stock-catFilterExpand"
              title={expandida ? "Ocultar subcategorías" : "Ver subcategorías"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleCategoriaFiltroExpandida(id);
              }}
            >
              <FontAwesomeIcon icon={expandida ? faChevronUp : faChevronDown} />
            </button>
          ) : (
            <span className="stock-catFilterExpand stock-catFilterExpand--empty" />
          )}

          <button
            type="button"
            className="stock-catFilterLabel"
            onClick={() => seleccionarCategoriaFiltro(id)}
          >
            {String(cat?.nombre ?? cat?.nombre_mostrar ?? "").replace(/^—\s*/g, "").trim()}
          </button>
        </div>

        {tieneHijas && expandida ? (
          <div className="stock-catFilterChildren">
            {hijas.map((hija) => renderCategoriaFiltroItem(hija, nivel + 1))}
          </div>
        ) : null}
      </div>
    );
  }, [
    categoriaFiltro,
    categoriasFiltroExpandidas,
    categoriasPorPadre,
    seleccionarCategoriaFiltro,
    toggleCategoriaFiltroExpandida,
  ]);

  const productosFiltradosYOrdenados = useMemo(() => {
    return Array.isArray(productosRaw) ? productosRaw : [];
  }, [productosRaw]);

  const totalProductos = totalProductosServidor;
  const totalPaginas = Math.max(1, totalPaginasServidor);

  useEffect(() => {
    if (paginaActual > totalPaginas) {
      setPaginaActual(totalPaginas);
    }
  }, [paginaActual, totalPaginas]);

  const productos = productosFiltradosYOrdenados;

  const inicioProductosVisibles = totalProductos > 0
    ? (paginaActual - 1) * productosPorPagina + 1
    : 0;
  const finProductosVisibles = totalProductos > 0
    ? Math.min(inicioProductosVisibles + productos.length - 1, totalProductos)
    : 0;

  const handleBusqueda = (e) => {
    descartarPosicionScrollTabla();
    setBusqueda(e.target.value);
    setPaginaActual(1);
  };

  const limpiarBusqueda = () => {
    descartarPosicionScrollTabla();
    setBusqueda("");
    setBusquedaConsulta("");
    setPaginaActual(1);
  };

  const handleCategoriaFiltro = (e) => {
    seleccionarCategoriaFiltro(e.target.value);
  };

  const handleOrden = (campo) => {
    descartarPosicionScrollTabla();
    setOrden((prev) =>
      prev.campo === campo
        ? { campo, dir: prev.dir === "ASC" ? "DESC" : "ASC" }
        : { campo, dir: "ASC" }
    );
    setPaginaActual(1);
  };

  const handleAbrirEditar = (id) => {
    if (!id || Number(id) <= 0) {
      mostrarToast("error", "ID de producto inválido.");
      return;
    }

    setProductoEditarId(Number(id));
    setModalEditarAbierto(true);
  };

  const handleCerrarEditar = () => {
    setModalEditarAbierto(false);
    setProductoEditarId(null);
  };

  const consultarImpactoEliminacion = useCallback(async (productoId) => {
    const id = Number(productoId || 0);
    if (!id) return;

    const requestId = impactoEliminarRequestRef.current + 1;
    impactoEliminarRequestRef.current = requestId;
    setCargandoImpactoEliminar(true);
    setErrorImpactoEliminar("");
    setImpactoEliminar(null);

    try {
      const params = new URLSearchParams({
        action: "stock_producto_impacto_eliminacion",
        id: String(id),
      });

      const data = await stockGetParams(params, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || "No se pudo revisar si este producto está usado en ventas, compras o presupuestos.");
      }

      if (impactoEliminarRequestRef.current !== requestId) return;
      setImpactoEliminar(data?.impacto || null);
    } catch (err) {
      if (impactoEliminarRequestRef.current !== requestId) return;
      setErrorImpactoEliminar(
        err?.message || "No se pudo revisar si este producto está usado en ventas, compras o presupuestos."
      );
    } finally {
      if (impactoEliminarRequestRef.current === requestId) {
        setCargandoImpactoEliminar(false);
      }
    }
  }, []);

  const prepararProductoAccion = (producto) => {
    const productoId = getProductoId(producto);

    if (!productoId || productoId <= 0) {
      mostrarToast("error", "ID de producto inválido.");
      return null;
    }

    setProductoEliminar({
      ...producto,
      id: productoId,
    });
    return productoId;
  };

  const handleAbrirBajaProducto = (producto) => {
    const productoId = prepararProductoAccion(producto);
    if (!productoId) return;

    impactoEliminarRequestRef.current += 1;
    setImpactoEliminar(null);
    setErrorImpactoEliminar("");
    setCargandoImpactoEliminar(false);
    setModalDarBajaProductoAbierto(true);
  };

  const handleAbrirEliminar = (producto) => {
    const productoId = prepararProductoAccion(producto);
    if (!productoId) return;

    setImpactoEliminar(null);
    setErrorImpactoEliminar("");
    setCargandoImpactoEliminar(true);
    setModalEliminarAbierto(true);
    consultarImpactoEliminacion(productoId);
  };

  const limpiarEstadoVisualProducto = useCallback((productoId) => {
    const id = Number(productoId || 0);
    if (!id) return;

    // Invalida cualquier listado iniciado antes de la baja/eliminación. Sin esto,
    // una respuesta anterior podía llegar después del DELETE y reponer la fila.
    productosRequestRef.current += 1;

    // Una alta o edición reciente conserva durante unos segundos una copia
    // optimista del producto. Al cambiar su estado hay que descartarla para que
    // una recarga no vuelva a insertar en "activos" el snapshot anterior a la baja.
    limpiarProductoOptimista(id);
    setProductosRaw((prev) => prev.filter((p) => getProductoId(p) !== id));
    limpiarImagenTemporalProducto(id);
    invalidarMiniaturaProducto(id, Date.now());
  }, [invalidarMiniaturaProducto, limpiarImagenTemporalProducto, limpiarProductoOptimista]);

  const handleCerrarBajaProducto = () => {
    if (eliminando) return;
    setModalDarBajaProductoAbierto(false);
    setProductoEliminar(null);
    setAccionEliminacionProducto("");
  };

  const limpiarEstadoModalEliminarProducto = () => {
    impactoEliminarRequestRef.current += 1;
    setModalEliminarAbierto(false);
    setModalConfirmacionFinalEliminarAbierto(false);
    setProductoEliminar(null);
    setImpactoEliminar(null);
    setErrorImpactoEliminar("");
    setCargandoImpactoEliminar(false);
    setAccionEliminacionProducto("");
  };

  const handleCerrarEliminar = () => {
    if (eliminando) return;
    limpiarEstadoModalEliminarProducto();
  };

  const handleSolicitarConfirmacionFinalEliminar = () => {
    if (eliminando || cargandoImpactoEliminar) return;
    setModalEliminarAbierto(false);
    setModalConfirmacionFinalEliminarAbierto(true);
  };

  const handleCerrarConfirmacionFinalEliminar = () => {
    if (eliminando) return;
    limpiarEstadoModalEliminarProducto();
  };

  const ejecutarAccionProducto = async ({ permanente = false } = {}) => {
    const productoActual = productoEliminar;
    const productoId = getProductoId(productoActual);

    if (!productoId || productoId <= 0) {
      mostrarToast("error", "ID de producto inválido.");
      return;
    }

    registrarImagenConocidaProducto(productoActual);

    setEliminando(true);
    setAccionEliminacionProducto(permanente ? "eliminar" : "baja");
    setModalDarBajaProductoAbierto(false);
    setModalEliminarAbierto(false);
    setModalConfirmacionFinalEliminarAbierto(false);
    setProductoEliminar(null);
    mostrarToastCarga(permanente ? "Eliminando producto..." : "Dando de baja producto...");

    try {
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();

      const payload = {
        action: permanente ? "stock_producto_eliminar_permanente" : "stock_producto_dar_baja",
        id: productoId,
        idUsuarioMaster,
        ...(permanente ? { confirmar_desvinculacion: 1 } : {}),
      };

      if (idTenant) {
        payload.tenant_id = idTenant;
      }

      const data = await stockPostPayload(payload, { strict: false });

      if (data.exito === false) {
        throw new Error(data.mensaje || (permanente ? "Error al eliminar el producto" : "Error al dar de baja el producto"));
      }

      const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(data);

      if (permanente) {
        const conocidas = { ...(imagenesConocidasPorProductoRef.current || {}) };
        delete conocidas[productoId];
        imagenesConocidasPorProductoRef.current = conocidas;
      }

      limpiarEstadoVisualProducto(productoId);
      await refrescarDespuesDeGuardar();
      notifyStockListsUpdated();
      mostrarResultadoTiendaNubeConfirmado(
        data,
        permanente ? "Producto eliminado permanentemente." : "Producto dado de baja correctamente.",
        confirmacionTiendaNube
      );
    } catch (error) {
      mostrarToast("error", error.message || (permanente ? "No se pudo eliminar el producto." : "No se pudo dar de baja el producto."));
    } finally {
      setEliminando(false);
      setAccionEliminacionProducto("");
    }
  };

  const handleConfirmarBajaProducto = async () => ejecutarAccionProducto({ permanente: false });
  const handleConfirmarEliminarPermanenteProducto = async () => ejecutarAccionProducto({ permanente: true });

  const handleReactivarProducto = async (producto) => {
    const productoId = getProductoId(producto);
    if (!productoId || productoId <= 0 || reactivandoId) return;

    registrarImagenConocidaProducto(producto);
    invalidarMiniaturaProducto(productoId, Date.now());

    setReactivandoId(productoId);
    mostrarToastCarga("Dando de alta producto...");

    try {
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
      const payload = {
        action: "stock_producto_reactivar",
        id: productoId,
        idUsuarioMaster,
      };
      if (idTenant) payload.tenant_id = idTenant;

      const data = await stockPostPayload(payload, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || "No se pudo reactivar el producto.");
      }

      const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(data);

      const productoReactivado = extractProductoFromApiResponse(data);
      if (productoReactivado) {
        registrarImagenConocidaProducto({ ...producto, ...productoReactivado });
        rearmarMiniaturasProductos([productoReactivado], Date.now());
      }

      limpiarEstadoVisualProducto(productoId);
      await refrescarDespuesDeGuardar();
      notifyStockListsUpdated();
      mostrarResultadoTiendaNubeConfirmado(data, "Producto dado de alta correctamente.", confirmacionTiendaNube);
    } catch (error) {
      mostrarToast("error", error?.message || "No se pudo dar de alta el producto.");
    } finally {
      setReactivandoId(null);
    }
  };

  const prepararVarianteAccion = (producto, variante) => {
    const productoId = getProductoId(producto);
    const varianteId = getVarianteId(variante);

    if (!productoId || !varianteId) {
      mostrarToast("error", "ID de variante inválido.");
      return null;
    }

    setVarianteBaja({
      productoId,
      productoNombre: producto?.nombre || "Producto",
      ...variante,
      id: varianteId,
    });

    return { productoId, varianteId };
  };

  const handleAbrirBajaVariante = (producto, variante) => {
    if (!prepararVarianteAccion(producto, variante)) return;
    setModalBajaVarianteAbierto(true);
  };

  const handleAbrirEliminarVariante = (producto, variante) => {
    const ids = prepararVarianteAccion(producto, variante);
    if (!ids) return;
    setImpactoEliminarVariante(null);
    setErrorImpactoEliminarVariante("");
    setCargandoImpactoEliminarVariante(true);
    setModalEliminarVarianteAbierto(true);
    consultarImpactoEliminacionVariante(ids.varianteId);
  };

  const handleCerrarBajaVariante = () => {
    if (procesandoVarianteId) return;
    setModalBajaVarianteAbierto(false);
    setVarianteBaja(null);
    setAccionEliminacionVariante("");
  };

  const handleCerrarEliminarVariante = () => {
    if (procesandoVarianteId) return;
    impactoEliminarVarianteRequestRef.current += 1;
    setModalEliminarVarianteAbierto(false);
    setModalConfirmacionFinalVarianteAbierto(false);
    setVarianteBaja(null);
    setImpactoEliminarVariante(null);
    setErrorImpactoEliminarVariante("");
    setCargandoImpactoEliminarVariante(false);
    setAccionEliminacionVariante("");
  };

  const consultarImpactoEliminacionVariante = async (varianteId) => {
    const id = Number(varianteId || 0);
    if (!id) return;

    const requestId = impactoEliminarVarianteRequestRef.current + 1;
    impactoEliminarVarianteRequestRef.current = requestId;

    try {
      const params = new URLSearchParams({
        action: "stock_variante_impacto_eliminacion",
        id: String(id),
      });
      const data = await stockGetParams(params, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || "No se pudo revisar si esta variante está usada en movimientos.");
      }
      if (impactoEliminarVarianteRequestRef.current !== requestId) return;
      setImpactoEliminarVariante(data?.impacto || null);
    } catch (error) {
      if (impactoEliminarVarianteRequestRef.current !== requestId) return;
      setErrorImpactoEliminarVariante(error?.message || "No se pudo revisar si esta variante está usada en movimientos.");
    } finally {
      if (impactoEliminarVarianteRequestRef.current === requestId) {
        setCargandoImpactoEliminarVariante(false);
      }
    }
  };

  const handleSolicitarConfirmacionFinalVariante = () => {
    if (procesandoVarianteId || cargandoImpactoEliminarVariante) return;
    setModalEliminarVarianteAbierto(false);
    setModalConfirmacionFinalVarianteAbierto(true);
  };

  const ejecutarAccionVariante = async ({ permanente = false } = {}) => {
    const varianteActual = varianteBaja;
    const varianteId = getVarianteId(varianteActual);
    const productoId = Number(varianteActual?.productoId || varianteActual?.id_stock_producto || 0);

    if (!varianteId || varianteId <= 0 || !productoId || productoId <= 0) {
      mostrarToast("error", "ID de variante inválido.");
      return;
    }

    capturarPosicionScrollTabla({ forzar: true });
    setProcesandoVarianteId(varianteId);
    setAccionEliminacionVariante(permanente ? "eliminar" : "baja");
    setModalBajaVarianteAbierto(false);
    setModalEliminarVarianteAbierto(false);
    setModalConfirmacionFinalVarianteAbierto(false);
    setVarianteBaja(null);
    mostrarToastCarga(permanente ? "Eliminando variante..." : "Dando de baja variante...");

    try {
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
      const payload = {
        action: permanente ? "stock_variante_eliminar_permanente" : "stock_variante_dar_baja",
        id: varianteId,
        id_stock_variante: varianteId,
        idUsuarioMaster,
        ...(permanente ? { confirmar_desvinculacion: 1 } : {}),
      };
      if (idTenant) payload.tenant_id = idTenant;

      const data = await stockPostPayload(payload, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || (permanente ? "No se pudo eliminar la variante." : "No se pudo dar de baja la variante."));
      }

      const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(data);

      registrarMutacionVariantes(productoId, permanente
        ? {
            deletedIds: [varianteId],
            forceNoVariants: data?.producto_quedo_sin_variantes === true,
          }
        : { desiredActive: { [varianteId]: 0 }, forceNoVariants: false }
      );

      const varianteRespuesta = data?.variante || data?.data?.variante || null;
      limpiarProductoOptimista(productoId);
      setVariantesPorProducto((prev) => {
        const actuales = Array.isArray(prev[productoId]) ? prev[productoId] : [];
        const actualizadas = permanente
          ? actuales.filter((item) => getVarianteId(item) !== varianteId)
          : actuales.map((item) =>
              getVarianteId(item) === varianteId
                ? (normalizeVarianteListItem({ ...item, ...(varianteRespuesta || {}), activo: 0 }) || item)
                : item
            );
        const next = { ...prev, [productoId]: actualizadas };
        variantesPorProductoRef.current = next;
        return next;
      });

      await refrescarDespuesDeGuardar(null, { forzar_captura_scroll: false });
      // La recarga general puede completar con un snapshot anterior. La lectura
      // puntual de variantes queda ultima y recalcula el total visible de la fila.
      await cargarVariantesProducto(productoId, {
        ignorarOptimista: true,
        permitirOmitidas: permanente,
      });
      programarRestauracionScrollTabla({ reactivar: true });
      notifyStockListsUpdated();
      mostrarResultadoTiendaNubeConfirmado(
        data,
        permanente ? "Variante eliminada permanentemente." : "Variante dada de baja correctamente.",
        confirmacionTiendaNube
      );
    } catch (error) {
      mostrarToast("error", error?.message || (permanente ? "No se pudo eliminar la variante." : "No se pudo dar de baja la variante."));
    } finally {
      setProcesandoVarianteId(null);
      setAccionEliminacionVariante("");
    }
  };

  const handleConfirmarBajaVariante = async () => ejecutarAccionVariante({ permanente: false });
  const handleConfirmarEliminarPermanenteVariante = async () => ejecutarAccionVariante({ permanente: true });

  const handleReactivarVariante = async (producto, variante) => {
    const productoId = getProductoId(producto);
    const varianteId = getVarianteId(variante);
    if (!productoId || !varianteId || procesandoVarianteId) return;

    capturarPosicionScrollTabla({ forzar: true });
    setProcesandoVarianteId(varianteId);
    mostrarToastCarga("Dando de alta variante...");

    try {
      const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
      const payload = {
        action: "stock_variante_reactivar",
        id: varianteId,
        id_stock_variante: varianteId,
        idUsuarioMaster,
      };
      if (idTenant) payload.tenant_id = idTenant;

      const data = await stockPostPayload(payload, { strict: false });
      if (data?.exito === false) {
        throw new Error(data?.mensaje || "No se pudo reactivar la variante.");
      }

      const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(data);

      registrarMutacionVariantes(productoId, {
        desiredActive: { [varianteId]: 1 },
        forceNoVariants: false,
      });

      const varianteRespuesta = data?.variante || data?.data?.variante || null;
      limpiarProductoOptimista(productoId);
      setVariantesPorProducto((prev) => {
        const actuales = Array.isArray(prev[productoId]) ? prev[productoId] : [];
        if (!actuales.length && !varianteRespuesta) return prev;
        const actualizadas = actuales.map((item) => {
          const idItem = getVarianteId(item);
          if (idItem !== varianteId) return item;
          return {
            ...item,
            ...(varianteRespuesta && typeof varianteRespuesta === "object" ? varianteRespuesta : {}),
            activo: 1,
          };
        });
        const next = { ...prev, [productoId]: actualizadas };
        variantesPorProductoRef.current = next;
        return next;
      });

      await refrescarDespuesDeGuardar(null, { forzar_captura_scroll: false });
      await cargarVariantesProducto(productoId, { ignorarOptimista: true });
      programarRestauracionScrollTabla({ reactivar: true });
      notifyStockListsUpdated();
      mostrarResultadoTiendaNubeConfirmado(data, "Variante dada de alta correctamente.", confirmacionTiendaNube);
    } catch (error) {
      mostrarToast("error", error?.message || "No se pudo dar de alta la variante.");
    } finally {
      setProcesandoVarianteId(null);
    }
  };

  const paginasVisibles = Array.from({ length: totalPaginas }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPaginas || Math.abs(p - paginaActual) <= 2)
    .reduce((acc, p, i, arr) => {
      if (i > 0 && p - arr[i - 1] > 1) acc.push("...");
      acc.push(p);
      return acc;
    }, []);

  const impactoEliminacionProducto = useMemo(() => {
    if (!productoEliminar) return null;

    const baseStyle = {
      marginTop: "12px",
      padding: "12px 14px",
      borderRadius: "14px",
      border: "1px solid #fde68a",
      background: "#fffbeb",
      color: "#92400e",
      fontSize: "13px",
      lineHeight: 1.45,
      textAlign: "left",
    };

    if (cargandoImpactoEliminar) {
      return (
        <div style={baseStyle}>
          <strong>Revisando uso del producto...</strong>
          <div>Estamos verificando si este producto aparece en ventas, compras o presupuestos ya cargados.</div>
        </div>
      );
    }

    if (errorImpactoEliminar) {
      return (
        <div
          style={{
            ...baseStyle,
            borderColor: "#fecaca",
            background: "#fef2f2",
            color: "#991b1b",
          }}
        >
          <strong>No se pudo revisar el uso del producto.</strong>
          <div>{errorImpactoEliminar}</div>
        </div>
      );
    }

    if (!impactoEliminar) return null;

    const itemsAfectados = toNonNegativeInt(impactoEliminar.total_items_afectados);
    const movimientosAfectados = toNonNegativeInt(impactoEliminar.total_movimientos_afectados);
    const movimientosSinProductos = toNonNegativeInt(
      impactoEliminar.movimientos_quedarian_sin_productos
    );
    const movimientosConOtrosProductos = toNonNegativeInt(
      impactoEliminar.movimientos_con_otros_productos
    );

    if (movimientosAfectados <= 0) {
      return (
        <div
          style={{
            ...baseStyle,
            borderColor: "#bbf7d0",
            background: "#f0fdf4",
            color: "#166534",
          }}
        >
          <strong>Uso del producto</strong>
          <div>Este producto no aparece en ventas, compras ni presupuestos cargados. Podés eliminarlo sin afectar registros anteriores.</div>
        </div>
      );
    }

    return (
      <div style={baseStyle}>
        <strong>Uso del producto</strong>
        <div>
          Este producto aparece en {pluralize(itemsAfectados, "renglón", "renglones")} de {" "}
          {pluralize(movimientosAfectados, "registro cargado", "registros cargados")}. Si lo eliminás, esos registros siguen existiendo, pero ya no quedarán unidos a este producto.
        </div>
        {movimientosSinProductos > 0 ? (
          <div style={{ marginTop: "6px", fontWeight: 700 }}>
            Atención: en {pluralize(movimientosSinProductos, "registro", "registros")} este era el único producto cargado.
          </div>
        ) : (
          <div style={{ marginTop: "6px" }}>
            Los registros donde aparece también tienen otros productos cargados, así que no quedan vacíos.
          </div>
        )}
      </div>
    );
  }, [
    productoEliminar,
    cargandoImpactoEliminar,
    errorImpactoEliminar,
    impactoEliminar,
  ]);

  const impactoEliminacionVarianteContenido = useMemo(() => {
    if (!varianteBaja) return null;

    const baseStyle = {
      marginTop: "12px",
      padding: "12px 14px",
      borderRadius: "14px",
      border: "1px solid #fde68a",
      background: "#fffbeb",
      color: "#92400e",
      fontSize: "13px",
      lineHeight: 1.45,
      textAlign: "left",
    };

    if (cargandoImpactoEliminarVariante) {
      return (
        <div style={baseStyle}>
          <strong>Revisando uso de la variante...</strong>
          <div>Estamos verificando si aparece en ventas, compras o presupuestos ya cargados.</div>
        </div>
      );
    }

    if (errorImpactoEliminarVariante) {
      return (
        <div style={{ ...baseStyle, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" }}>
          <strong>No se pudo revisar el uso de la variante.</strong>
          <div>{errorImpactoEliminarVariante}</div>
        </div>
      );
    }

    if (!impactoEliminarVariante) return null;

    const itemsAfectados = toNonNegativeInt(impactoEliminarVariante.total_items_afectados);
    const movimientosAfectados = toNonNegativeInt(impactoEliminarVariante.total_movimientos_afectados);
    const movimientosSinProductos = toNonNegativeInt(impactoEliminarVariante.movimientos_quedarian_sin_productos);

    if (movimientosAfectados <= 0) {
      return (
        <div style={{ ...baseStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>
          <strong>Uso de la variante</strong>
          <div>Esta variante no aparece en movimientos cargados. Podés eliminarla sin afectar registros anteriores.</div>
        </div>
      );
    }

    return (
      <div style={baseStyle}>
        <strong>Variante relacionada con movimientos</strong>
        <div>
          Esta variante aparece en {pluralize(itemsAfectados, "renglón", "renglones")} de {" "}
          {pluralize(movimientosAfectados, "registro cargado", "registros cargados")}. Si la eliminás, los movimientos seguirán existiendo con sus datos e importes, pero esos renglones quedarán sin producto ni variante asociados.
        </div>
        {movimientosSinProductos > 0 && (
          <div style={{ marginTop: "6px", fontWeight: 700 }}>
            Atención: {pluralize(movimientosSinProductos, "registro quedará", "registros quedarán")} sin ningún producto asociado.
          </div>
        )}
      </div>
    );
  }, [
    varianteBaja,
    cargandoImpactoEliminarVariante,
    errorImpactoEliminarVariante,
    impactoEliminarVariante,
  ]);

  const OrdenIcon = ({ campo }) => {
    if (orden.campo !== campo) {
      return <FontAwesomeIcon icon={faSort} className="prod-sortIcon prod-sortIcon--inactive" />;
    }

    return (
      <FontAwesomeIcon
        icon={orden.dir === "ASC" ? faChevronUp : faChevronDown}
        className="prod-sortIcon prod-sortIcon--active"
      />
    );
  };

  const renderSkeletonRow = (idx) => (
    <div
      key={`skel-${idx}`}
      className="mov-gridTable mov-gridTable--row mov-row--skeleton"
      style={{ gridTemplateColumns: GRID_COLS }}
      role="row"
      aria-hidden="true"
    >
      {COLUMNS.map((c) => {
        if (c.key === "acciones") {
          return (
            <div key={c.key} className="mov-gridCell mov-gridCell--actions is-center" role="cell">
              <div className="mov-skelActions">
                <span className="mov-skelIcon" />
                <span className="mov-skelIcon" />
              </div>
            </div>
          );
        }

        const list = SKEL_WIDTHS[c.key] || ["60%"];
        const w = list[idx % list.length];

        return (
          <div
            key={c.key}
            className={[
              "mov-gridCell",
              c.align === "right" ? "is-right" : "",
              c.align === "center" ? "is-center" : "",
            ].join(" ")}
            role="cell"
          >
            <span className="mov-skeletonBar" style={{ width: w }} />
          </div>
        );
      })}
    </div>
  );


  const renderVariantesProducto = (prod) => {
    const productoId = getProductoId(prod);
    const variantes = variantesPorProducto[productoId] || [];
    const loadingVars = !!loadingVariantesPorProducto[productoId];
    const errorVars = errorVariantesPorProducto[productoId];

    return (
      <div className="prod-variantsDetailRow" role="row">
        <div className="prod-variantsPanel">
          <div className="prod-variantsPanel__head">
            <div>
              <strong>Variantes de {prod.nombre}</strong>
              <span>{loadingVars ? "Cargando variantes..." : `${variantes.length} registradas`}</span>
            </div>
          </div>

          {errorVars ? (
            <div className="prod-variantsPanel__empty">{errorVars}</div>
          ) : loadingVars ? (
            <div className="prod-variantsPanel__empty">Cargando información de variantes...</div>
          ) : variantes.length === 0 ? (
            <div className="prod-variantsPanel__empty">Este producto todavía no tiene variantes cargadas.</div>
          ) : (
            <div className="prod-variantsMiniTable">
              <div className="prod-variantsMiniTable__head">
                <span>Variante</span>
                <span>SKU</span>
                <span>Stock</span>
                <span>Precio de costo</span>
                <span>Precio de venta</span>
                <span>Precio promocional</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>
              {variantes.map((variant) => {
                const varianteId = getVarianteId(variant);
                const varianteInactiva = Number(variant?.activo ?? 1) === 0;
                const procesandoEstaVariante = procesandoVarianteId === varianteId;

                return (
                  <div
                    className={["prod-variantsMiniTable__row", varianteInactiva ? "is-inactive" : ""].join(" ")}
                    key={variant.id_stock_variante}
                  >
                    <span>
                      <b>{variant.nombre_variante || `Variante #${variant.id_stock_variante}`}</b>
                      <small>{variantAttributesLabel(variant)}</small>
                      <small>{variantCategoriasLabel(variant)}</small>
                      {(variant.precios_extra || []).length > 0 ? (
                        <small className="prod-variantExtraPrices">
                          {(variant.precios_extra || [])
                            .map((item) => `${item.tipo_nombre || `Precio ${item.id_tipo_precio_stock}`}: ${formatMoney(item.precio)}`)
                            .join(" · ")}
                        </small>
                      ) : null}
                    </span>
                    <span className="prod-sku">{variant.sku || "—"}</span>
                    <span>{renderStockChip(variant.stock)}</span>
                    <span>{formatMoney(variant.precio_costo)}</span>
                    <span>{formatMoney(variant.precio)}</span>
                    <span className="prod-promo">{formatMoney(variant.precio_promo)}</span>
                    <span>
                      {varianteInactiva ? (
                        <span className="prod-statusChip prod-statusChip--inactive">Dada de baja</span>
                      ) : (
                        <span className="prod-statusChip prod-statusChip--active">Activa</span>
                      )}
                    </span>
                    <span className="prod-variantActions">
                      {varianteInactiva ? (
                        <button
                          type="button"
                          className="mov-iconBtn"
                          title="Dar de alta variante"
                          disabled={procesandoEstaVariante}
                          onClick={() => handleReactivarVariante(prod, variant)}
                        >
                          <FontAwesomeIcon icon={faRotateLeft} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="mov-iconBtn mov-iconBtn--danger"
                          title="Dar de baja variante"
                          disabled={procesandoEstaVariante}
                          onClick={() => handleAbrirBajaVariante(prod, variant)}
                        >
                          <FontAwesomeIcon icon={faBoxOpen} />
                        </button>
                      )}

                      <button
                        type="button"
                        className="mov-iconBtn mov-iconBtn--danger"
                        title="Eliminar variante definitivamente"
                        disabled={procesandoEstaVariante}
                        onClick={() => handleAbrirEliminarVariante(prod, variant)}
                      >
                        <FontAwesomeIcon icon={faTrashCan} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStockPagination = (extraClassName = "") => {
    if (totalPaginas <= 1) return null;

    return (
      <div className={["prod-pagination", extraClassName].filter(Boolean).join(" ")}>
        <button
          type="button"
          className="prod-pagination__btn prod-pagination__btn--nav"
          onClick={() => {
            descartarPosicionScrollTabla();
            setPaginaActual((p) => Math.max(1, p - 1));
          }}
          disabled={paginaActual === 1}
        >
          Anterior
        </button>

        <div className="prod-pagination__pages">
          {paginasVisibles.map((p, i) =>
            p === "..." ? (
              <span key={`dots-${i}`} className="prod-page-dots">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={["prod-pagination__btn", p === paginaActual ? "is-active" : ""].filter(Boolean).join(" ")}
                onClick={() => {
                  descartarPosicionScrollTabla();
                  setPaginaActual(p);
                }}
              >
                {p}
              </button>
            )
          )}
        </div>

        <span className="prod-pagination__summary">
          Página {paginaActual} de {totalPaginas}
        </span>

        <button
          type="button"
          className="prod-pagination__btn prod-pagination__btn--nav"
          onClick={() => {
            descartarPosicionScrollTabla();
            setPaginaActual((p) => Math.min(totalPaginas, p + 1));
          }}
          disabled={paginaActual === totalPaginas}
        >
          Siguiente
        </button>
      </div>
    );
  };

  const renderStockToolbarActions = (extraClassName = "", options = {}) => {
    const { showToggleBajas = true, showReportes = true, showAjustePrecios = true, showAgregarProducto = true } = options;

    return (
      <div className={["stock-tableActions", extraClassName].filter(Boolean).join(" ")}>
        {showToggleBajas ? (
          <button
            type="button"
            className={[
              "mov-btn",
              mostrarDadosDeBaja ? "mov-btn--primary" : "mov-btn--ghost",
              "stock-actionBtn",
              "stock-actionBtn--bajas",
            ].join(" ")}
            aria-label={mostrarDadosDeBaja ? "Ver activos" : "Ver dados de baja"}
            title={mostrarDadosDeBaja ? "Ver activos" : "Ver dados de baja"}
            onClick={() => {
              descartarPosicionScrollTabla();
              const seed = Date.now();
              setErroresImagenes({});
              setReintentosImagenes({});
              setVersionImagenPorProducto((prev) => {
                const next = { ...prev };
                productosRaw.forEach((item) => {
                  const id = getProductoId(item);
                  if (id && Number(item?.imagen_archivo_id || 0) > 0) next[id] = seed;
                });
                return next;
              });
              setMostrarDadosDeBaja((prev) => !prev);
              setPaginaActual(1);
            }}
          >
            <FontAwesomeIcon icon={faRotateLeft} />
            <span className="stock-actionBtn__text">
              {mostrarDadosDeBaja ? "Ver activos" : "Ver dados de baja"}
            </span>
          </button>
        ) : null}

        {showReportes ? (
          <button
            type="button"
            className="mov-btn mov-btn--ghost stock-actionBtn stock-actionBtn--reportes"
            aria-label="Reportes de Stock"
            title="Reportes de Stock"
            onClick={() => setModalReportesAbierto(true)}
          >
            <FontAwesomeIcon icon={faChartColumn} />
            <span className="stock-actionBtn__text">Reportes</span>
          </button>
        ) : null}

        {showAjustePrecios ? (
          <button
            type="button"
            className="mov-btn mov-btn--ghost stock-actionBtn stock-actionBtn--ajuste"
            aria-label="Ajustar precios"
            title="Ajustar precios"
            onClick={() => setModalAjustePreciosAbierto(true)}
            disabled={mostrarDadosDeBaja}
          >
            <FontAwesomeIcon icon={faMoneyBillTrendUp} />
            <span className="stock-actionBtn__text">Ajustar precios</span>
          </button>
        ) : null}

        {showAgregarProducto ? (
          <button
            type="button"
            className="mov-btn mov-btn--primary"
            onClick={() => setModalAbierto(true)}
            disabled={mostrarDadosDeBaja}
          >
            <FontAwesomeIcon icon={faPlus} /> Agregar producto
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div className="mov-page stock-page">
        {error && (
          <div className="mov-alert" role="alert">
            {error}
          </div>
        )}

        <section className="mov-card mov-card--table">
          <div className="mov-card__head">
            <div className="mov-card__headLeft">
              <div className="title-mov">
                <div className="mov-card__title">Stock · Productos</div>
                <div className="mov-card__hint">
                  {totalProductos > 0 ? (
                    <>
                      Mostrando <b>{inicioProductosVisibles}</b>–<b>{finProductosVisibles}</b> de{" "}
                      <b>{totalProductos}</b> {mostrarDadosDeBaja ? "productos dados de baja" : "productos"}
                    </>
                  ) : (
                    <>Sin productos para mostrar</>
                  )}
                </div>
              </div>

              <div className="mov-headFilters">
                <div className="cc-filter cc-filter--search">
                  <div className="cc-floatingField cc-floatingField--search is-active">
                    <div className="cc-searchInput">
                      <div className="cc-searchInput__fieldWrap">
                        <input
                          className="cc-input cc-input--floating"
                          value={busqueda}
                          onChange={handleBusqueda}
                          placeholder="Buscar por nombre, SKU o variante..."
                        />
                        <span className="cc-floatingLabel">
                          <FontAwesomeIcon icon={faMagnifyingGlass} /> Búsqueda
                        </span>

                        {busqueda.trim() !== "" && (
                          <button
                            type="button"
                            className="cc-clearSearch cc-clearSearch--inside"
                            title="Limpiar búsqueda"
                            onClick={limpiarBusqueda}
                          >
                            <FontAwesomeIcon icon={faTimes} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="cc-filter">
                  <div
                    className={[
                      "cc-floatingField",
                      "is-active",
                      "stock-catFilter",
                      categoriaDropdownAbierto ? "is-open" : "",
                    ].join(" ")}
                    ref={categoriaFiltroDropdownRef}
                  >
                    <button
                      type="button"
                      className="cc-input cc-input--floating stock-catFilterTrigger"
                      disabled={loading || loadingCategorias}
                      onClick={() => setCategoriaDropdownAbierto((prev) => !prev)}
                    >
                      <span className="stock-catFilterTrigger__text">{categoriaFiltroLabel}</span>
                      <FontAwesomeIcon icon={faChevronDown} className="stock-catFilterTrigger__icon" />
                    </button>

                    <span className="cc-floatingLabel">
                      <FontAwesomeIcon icon={faLayerGroup} /> Categoría
                    </span>

                    {categoriaDropdownAbierto ? (
                      <div className="stock-catFilterPanel">
                        <button
                          type="button"
                          className={[
                            "stock-catFilterOption",
                            "stock-catFilterOption--all",
                            !categoriaFiltro ? "is-selected" : "",
                          ].join(" ")}
                          onClick={() => seleccionarCategoriaFiltro("")}
                        >
                          <span className="stock-catFilterExpand stock-catFilterExpand--empty" />
                          <span className="stock-catFilterLabel">Todas</span>
                        </button>

                        {categorias.length === 0 ? (
                          <div className="stock-catFilterEmpty">
                            {loadingCategorias ? "Cargando categorías..." : "No hay categorías cargadas."}
                          </div>
                        ) : (
                          (categoriasPorPadre[0] || []).map((cat) => renderCategoriaFiltroItem(cat, 0))
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="mov-card__actions stock-tableActionsDesktop">
              {renderStockToolbarActions()}
            </div>

            <div className="mov-card__actions stock-tableActionsAddMobile">
              {renderStockToolbarActions("", { showToggleBajas: false, showReportes: false, showAjustePrecios: false })}
            </div>
          </div>

          <div
            className="mov-gridTable mov-gridTable--head"
            style={{ gridTemplateColumns: GRID_COLS }}
            role="row"
          >
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                className={[
                  "mov-gridCell",
                  "mov-gridCell--head",
                  c.align === "right" ? "is-right" : "",
                  c.align === "center" ? "is-center" : "",
                  c.sortable ? "prod-th--sortable" : "",
                ].join(" ")}
                role="columnheader"
                onClick={c.sortable ? () => handleOrden(c.key) : undefined}
              >
                {c.label}
                {c.sortable && <OrdenIcon campo={c.key} />}
              </div>
            ))}
          </div>

          <div
            ref={tablaScrollRef}
            className={[
              "mov-tableWrap",
              "stock-tableWrap",
              totalPaginas > 1
                ? "stock-tableWrap--with-pagination"
                : "stock-tableWrap--without-pagination",
            ].join(" ")}
            role="rowgroup"
          >
            <div
              className={[
                "mov-gridBody",
                "mov-gridBody--relative",
                loading ? "mov-softLoading" : "",
              ].join(" ")}
            >
              {loading ? (
                <div className="mov-skeletonWrap" aria-busy="true">
                  {Array.from({ length: SKELETON_ROWS }).map((_, i) => renderSkeletonRow(i))}
                </div>
              ) : (
                <>
                  {productos.length === 0 ? (
                    <div className="cc-emptyState">
                      <FontAwesomeIcon icon={faBoxOpen} className="cc-emptyIcon" />
                      <div className="cc-emptyText">
                        {busqueda.trim() || categoriaFiltro
                          ? "No se encontraron productos con los filtros seleccionados."
                          : mostrarDadosDeBaja
                            ? "No hay productos dados de baja."
                            : "No hay productos para mostrar."}
                      </div>
                    </div>
                  ) : (
                    productos.map((prod) => {
                      const prodConImagen = completarProductoConImagenConocida(prod);
                      const productoId = getProductoId(prodConImagen);
                      const archivoId = Number(prodConImagen?.imagen_archivo_id || 0);
                      const imagenTemporal = imagenesTemporalesPorProducto?.[productoId]?.url || "";
                      const usandoImagenTemporal = !!imagenTemporal;
                      const intentoImagen = Number(reintentosImagenes?.[productoId] || 0);
                      const imagenRota = !usandoImagenTemporal && !!erroresImagenes[productoId];
                      const productoInactivo = Number(prodConImagen?.activo ?? 1) === 0;
                      const totalVariantesProducto = Number(prodConImagen?.cantidad_variantes_total ?? prodConImagen?.cantidad_variantes ?? 0);
                      const variantesActivasProducto = Number(prodConImagen?.cantidad_variantes_activas ?? prodConImagen?.cantidad_variantes ?? 0);
                      const variantesInactivasProducto = Number(prodConImagen?.cantidad_variantes_inactivas ?? 0);
                      // Aunque Tienda Nube represente temporalmente la última variante
                      // como variante virtual/simple, Balto debe seguir mostrando las
                      // variantes inactivas para poder darlas de alta nuevamente.
                      const tieneVariantesParaMostrar =
                        !!prodConImagen.tiene_variantes ||
                        totalVariantesProducto > 0 ||
                        variantesActivasProducto > 0 ||
                        variantesInactivasProducto > 0;
                      const imageUrl =
                        imagenTemporal ||
                        (archivoId > 0
                          ? getProductoImageUrl(
                              prodConImagen,
                              API_URL,
                              versionImagenPorProducto[productoId] || 0,
                              intentoImagen
                            )
                          : "");

                      return (
                        <React.Fragment key={productoId}>
                        <div
                          className={`mov-gridTable mov-gridTable--row ${tieneVariantesParaMostrar ? "prod-row--expandable" : ""} ${tieneVariantesParaMostrar && variantesAbiertas[productoId] ? "is-variants-open" : ""}`}
                          data-stock-product-id={productoId}
                          style={{ gridTemplateColumns: GRID_COLS }}
                          role="row"
                          tabIndex={tieneVariantesParaMostrar ? 0 : undefined}
                          aria-expanded={tieneVariantesParaMostrar ? !!variantesAbiertas[productoId] : undefined}
                          title={tieneVariantesParaMostrar ? (variantesAbiertas[productoId] ? "Ocultar variantes" : "Ver variantes") : undefined}
                          onClick={() => {
                            if (tieneVariantesParaMostrar) toggleVariantesProducto(prodConImagen);
                          }}
                          onKeyDown={(e) => {
                            if (!tieneVariantesParaMostrar) return;
                            if (e.target !== e.currentTarget) return;
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            toggleVariantesProducto(prodConImagen);
                          }}
                        >
                          <div className="mov-gridCell is-strong" role="cell" data-label="PRODUCTO">
                            <div className="prod-productCell">
                              <div className="prod-thumb">
                                {imageUrl && !imagenRota ? (
                                  <img
                                    key={`${productoId}-${archivoId}-${versionImagenPorProducto[productoId] || 0}-${intentoImagen}-${mostrarDadosDeBaja ? "baja" : "alta"}`}
                                    src={imageUrl}
                                    alt={prodConImagen.nombre}
                                    className="prod-thumb__img"
                                    loading="lazy"
                                    decoding="async"
                                    onLoad={() => {
                                      setErroresImagenes((prev) => {
                                        if (!prev?.[productoId]) return prev;
                                        const next = { ...prev };
                                        delete next[productoId];
                                        return next;
                                      });
                                    }}
                                    onError={() => {
                                      if (usandoImagenTemporal) {
                                        limpiarImagenTemporalProducto(productoId);
                                        return;
                                      }

                                      if (intentoImagen < 14) {
                                        programarReintentoImagen(productoId);
                                        return;
                                      }

                                      setErroresImagenes((prev) => ({
                                        ...prev,
                                        [productoId]: true,
                                      }));
                                    }}
                                  />
                                ) : (
                                  <span className="prod-thumb__placeholder">
                                    <FontAwesomeIcon icon={faBoxOpen} />
                                  </span>
                                )}
                              </div>

                              <span className="mov-ellipsissss">{prodConImagen.nombre}</span>
                              {tieneVariantesParaMostrar ? (
                                <span className="prod-variantBadge prod-variantBadge--count">
                                  <span>{totalVariantesProducto || variantesActivasProducto || 0}</span>
                                  <span className="prod-variantBadge__label">variantes</span>
                                  {!mostrarDadosDeBaja && variantesInactivasProducto > 0 ? (
                                    <span className="prod-variantBadge__detail">
                                      {` · ${variantesInactivasProducto} baja${variantesInactivasProducto === 1 ? "" : "s"}`}
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}
                              {productoInactivo ? <span className="prod-variantBadge prod-variantBadge--inactive">Dado de baja</span> : null}
                            </div>
                          </div>

                          <div className="mov-gridCell is-center" role="cell" data-label="SKU">
                            <span className="mov-ellipsissss prod-sku">{prodConImagen.sku || "—"}</span>
                          </div>

                          <div className="mov-gridCell is-center" role="cell" data-label="STOCK">
                            {renderStockChip(prodConImagen.stock)}
                          </div>

                          <div
                            className="mov-gridCell is-right"
                            role="cell"
                            data-label="PRECIO COSTO"
                          >
                            <span className="mov-ellipsissss">{formatMoney(prodConImagen.precio_costo)}</span>
                          </div>

                          <div
                            className="mov-gridCell is-right"
                            role="cell"
                            data-label="PRECIO VENTA"
                          >
                            <span className="mov-ellipsissss">{formatMoney(prodConImagen.precio)}</span>
                          </div>

                          <div
                            className="mov-gridCell is-right"
                            role="cell"
                            data-label="PRECIO PROMO"
                          >
                            <span className="mov-ellipsissss prod-promo">
                              {formatMoney(prodConImagen.precio_promo)}
                            </span>
                          </div>

                          <div
                            className="mov-gridCell mov-gridCell--actions is-center"
                            role="cell"
                            data-label="ACCIONES"
                          >
                            <div className="mov-actionsInline">
                              <button
                                type="button"
                                title="Historial de precios"
                                className="mov-iconBtn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setProductoHistorialPrecios(prodConImagen);
                                }}
                              >
                                <FontAwesomeIcon icon={faClockRotateLeft} />
                              </button>

                              {productoInactivo ? (
                                <button
                                  type="button"
                                  title="Dar de alta producto"
                                  className="mov-iconBtn"
                                  disabled={reactivandoId === productoId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleReactivarProducto(prodConImagen);
                                  }}
                                >
                                  <FontAwesomeIcon icon={faRotateLeft} />
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    title="Editar"
                                    className="mov-iconBtn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAbrirEditar(productoId);
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faPenToSquare} />
                                  </button>

                                  <button
                                    type="button"
                                    title="Dar de baja"
                                    className="mov-iconBtn mov-iconBtn--danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAbrirBajaProducto(prodConImagen);
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faBoxOpen} />
                                  </button>
                                </>
                              )}

                              <button
                                type="button"
                                title="Eliminar producto definitivamente"
                                className="mov-iconBtn mov-iconBtn--danger"
                                disabled={reactivandoId === productoId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAbrirEliminar(prodConImagen);
                                }}
                              >
                                <FontAwesomeIcon icon={faTrashCan} />
                              </button>
                            </div>
                          </div>
                        </div>
                        {tieneVariantesParaMostrar && variantesAbiertas[productoId]
                          ? renderVariantesProducto(prodConImagen)
                          : null}
                        </React.Fragment>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </div>

          <div className={["stock-tableFooter", totalPaginas <= 1 ? "stock-tableFooter--onlyActions" : ""].filter(Boolean).join(" ")}>
            {renderStockPagination("stock-pagination--footer")}
            {renderStockToolbarActions("stock-tableActionsMobile", { showAgregarProducto: false })}
          </div>
        </section>
      </div>


      {modalReportesAbierto && (
        <ModalReportesStock
          open={modalReportesAbierto}
          onClose={() => setModalReportesAbierto(false)}
          onToast={mostrarToast}
          categorias={categorias}
        />
      )}

      {modalAjustePreciosAbierto && (
        <ModalAjustePrecios
          open={modalAjustePreciosAbierto}
          onClose={() => setModalAjustePreciosAbierto(false)}
          onToast={mostrarToast}
          onGuardado={async () => {
            await refrescarDespuesDeGuardar();
            try {
              window.dispatchEvent(new CustomEvent("balto:stock-updated"));
            } catch {}
          }}
          onProcesoMasivo={handleCargaPreciosMasivos}
          umbralProcesoMasivo={PRECIOS_MASIVOS_LOADING_THRESHOLD}
        />
      )}

      {productoHistorialPrecios && (
        <ModalHistorialPreciosProducto
          open={!!productoHistorialPrecios}
          producto={productoHistorialPrecios}
          onClose={() => setProductoHistorialPrecios(null)}
          onToast={mostrarToast}
        />
      )}

      {modalAbierto && (
        <ModalCargaMasiva
          open={modalAbierto}
          onClose={() => setModalAbierto(false)}
          onToast={mostrarToast}
          onGuardado={async (productoGuardado, opciones = {}) => {
            const response = opciones?.response || opciones || productoGuardado;
            const esAltaIndividual = Boolean(
              productoGuardado ||
              opciones?.response ||
              opciones?.tiendanube_sync ||
              opciones?.data
            );

            // La respuesta del alta ya confirma el COMMIT local y la aceptación de la
            // cola durable. El worker continúa Tienda Nube sin bloquear al usuario.
            if (esAltaIndividual) {
              const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(response);
              setModalAbierto(false);
              notifyStockListsUpdated();
              mostrarResultadoTiendaNubeConfirmado(
                response,
                "Producto agregado correctamente.",
                confirmacionTiendaNube
              );
            }

            // Refrescar la grilla es una tarea posterior al guardado. Si esa consulta
            // puntual falla, no debe convertir un alta exitosa en un mensaje de error.
            try {
              await refrescarDespuesDeGuardar(productoGuardado, {
                ...opciones,
                producto_optimista: opciones?.producto_optimista || productoGuardado,
              });
            } catch (refreshError) {
              console.warn("[Stock] El producto se guardó, pero la grilla no pudo refrescarse en ese instante.", refreshError);
            }
          }}
          onImportado={async (mensaje) => {
            setModalAbierto(false);
            await refrescarDespuesDeGuardar();
            notifyStockListsUpdated();
            mostrarToast("exito", mensaje || "Importación finalizada correctamente.");
          }}
          categorias={categorias}
          loadingCategorias={loadingCategorias}
        />
      )}

      {modalEditarAbierto && productoEditarId && (
        <ModalEditarProducto
          productoId={productoEditarId}
          onClose={handleCerrarEditar}
          onToast={mostrarToast}
          onGuardadoIntermedio={async (productoGuardado, opciones = {}) => {
            const productoIdEditado = getProductoId(productoGuardado) || Number(opciones?.productoId || productoEditarId || 0);

            // Guardado desde la pestaña Código de barra: actualiza la grilla, pero
            // mantiene el modal abierto para que aparezcan inmediatamente los BL-V-ID
            // definitivos de las variantes recién creadas. No agrega lógica de Tienda Nube.
            try {
              await refrescarDespuesDeGuardar(productoGuardado, {
                ...opciones,
                productoId: productoIdEditado,
                producto_optimista: opciones?.producto_optimista || productoGuardado,
              });
              notifyStockListsUpdated();
            } catch (refreshError) {
              console.warn("[Stock] El producto se guardó desde Código de barra, pero la grilla no pudo refrescarse en ese instante.", refreshError);
            }
          }}
          onGuardado={async (productoGuardado, opciones = {}) => {
            const productoIdEditado = getProductoId(productoGuardado) || Number(opciones?.productoId || productoEditarId || 0);

            // La respuesta confirma el COMMIT local. La grilla usa el producto optimista
            // y el worker continúa Tienda Nube sin mantener abierto el guardado.
            const response = opciones?.response || opciones;
            const confirmacionTiendaNube = await esperarSincronizacionTiendaNube(response);
            handleCerrarEditar();
            mostrarResultadoTiendaNubeConfirmado(
              response,
              "Producto editado correctamente.",
              confirmacionTiendaNube
            );

            await refrescarDespuesDeGuardar(productoGuardado, {
              ...opciones,
              productoId: productoIdEditado,
            });
            notifyStockListsUpdated();
          }}
        />
      )}

      <ModalDarBajaStock
        open={modalDarBajaProductoAbierto}
        loading={eliminando && accionEliminacionProducto === "baja"}
        onClose={handleCerrarBajaProducto}
        onConfirm={handleConfirmarBajaProducto}
        entidadLabel="producto"
        title="Dar de baja producto"
        message="El producto se ocultará de la lista principal y vas a poder volver a activarlo desde dados de baja."
        confirmLabel="Dar de baja"
        details={
          productoEliminar
            ? [
                { label: "ID Producto", value: `#${getProductoId(productoEliminar)}` },
                { label: "Nombre", value: productoEliminar.nombre || "—" },
                { label: "SKU", value: productoEliminar.sku || "—" },
                {
                  label: "Stock",
                  value:
                    productoEliminar.stock === null ||
                    productoEliminar.stock === undefined ||
                    productoEliminar.stock === ""
                      ? "—"
                      : String(productoEliminar.stock),
                },
                { label: "Precio costo", value: formatMoney(productoEliminar.precio_costo) },
                { label: "Precio venta", value: formatMoney(productoEliminar.precio) },
              ]
            : []
        }
      />

      <ModalEliminarStock
        open={modalEliminarAbierto}
        loading={eliminando && accionEliminacionProducto === "eliminar"}
        onClose={handleCerrarEliminar}
        onConfirm={handleSolicitarConfirmacionFinalEliminar}
        confirmDisabled={cargandoImpactoEliminar || !!errorImpactoEliminar}
        entidadLabel="producto"
        title="Eliminar producto definitivamente"
        message="Esta acción borra el producto para siempre junto con sus variantes, precios, categorías e imágenes."
        warning="Usalo solo si fue cargado por error o ya no debe existir en el sistema. Si querés conservarlo para poder recuperarlo, usá Dar de baja."
        extraContent={impactoEliminacionProducto}
        details={
          productoEliminar
            ? [
                { label: "ID Producto", value: `#${getProductoId(productoEliminar)}` },
                { label: "Nombre", value: productoEliminar.nombre || "—" },
                { label: "SKU", value: productoEliminar.sku || "—" },
                {
                  label: "Stock",
                  value:
                    productoEliminar.stock === null ||
                    productoEliminar.stock === undefined ||
                    productoEliminar.stock === ""
                      ? "—"
                      : String(productoEliminar.stock),
                },
                { label: "Precio costo", value: formatMoney(productoEliminar.precio_costo) },
                { label: "Precio venta", value: formatMoney(productoEliminar.precio) },
              ]
            : []
        }
      />

      <ModalEliminarStock
        open={modalConfirmacionFinalEliminarAbierto}
        loading={eliminando && accionEliminacionProducto === "eliminar"}
        onClose={handleCerrarConfirmacionFinalEliminar}
        onConfirm={handleConfirmarEliminarPermanenteProducto}
        entidadLabel="producto"
        title="Confirmación final"
        message="Esta es la segunda y última confirmación. La eliminación no se puede deshacer."
        warning={
          toNonNegativeInt(impactoEliminar?.total_movimientos_afectados) > 0
            ? `Al confirmar, el producto se eliminará definitivamente y se desvinculará de ${pluralize(
                toNonNegativeInt(impactoEliminar?.total_movimientos_afectados),
                "registro histórico",
                "registros históricos"
              )}. Es recomendable darlo de baja en lugar de eliminarlo.`
            : "El producto se eliminará definitivamente de Balto y, si está sincronizado, también de Tienda Nube."
        }
        confirmLabel="Sí, eliminar para siempre"
        details={
          productoEliminar
            ? [
                { label: "Producto", value: productoEliminar.nombre || "—" },
                { label: "SKU", value: productoEliminar.sku || "—" },
                {
                  label: "Registros afectados",
                  value: String(toNonNegativeInt(impactoEliminar?.total_movimientos_afectados)),
                },
                {
                  label: "Registros que quedarían sin productos",
                  value: String(toNonNegativeInt(impactoEliminar?.movimientos_quedarian_sin_productos)),
                },
              ]
            : []
        }
      />

      <ModalDarBajaStock
        open={modalBajaVarianteAbierto}
        loading={!!procesandoVarianteId && accionEliminacionVariante === "baja"}
        onClose={handleCerrarBajaVariante}
        onConfirm={handleConfirmarBajaVariante}
        entidadLabel="variante"
        title="Dar de baja variante"
        message="La variante se ocultará de la lista principal y vas a poder volver a activarla desde dados de baja."
        confirmLabel="Dar de baja"
        details={
          varianteBaja
            ? [
                { label: "ID Variante", value: `#${getVarianteId(varianteBaja)}` },
                { label: "Producto", value: varianteBaja.productoNombre || "—" },
                { label: "Variante", value: varianteBaja.nombre_variante || "—" },
                { label: "SKU", value: varianteBaja.sku || "—" },
                {
                  label: "Stock",
                  value:
                    varianteBaja.stock === null ||
                    varianteBaja.stock === undefined ||
                    varianteBaja.stock === ""
                      ? "—"
                      : String(varianteBaja.stock),
                },
                { label: "Precio costo", value: formatMoney(varianteBaja.precio_costo) },
                { label: "Precio venta", value: formatMoney(varianteBaja.precio) },
              ]
            : []
        }
      />

      <ModalEliminarStock
        open={modalEliminarVarianteAbierto}
        loading={!!procesandoVarianteId && accionEliminacionVariante === "eliminar"}
        onClose={handleCerrarEliminarVariante}
        onConfirm={handleSolicitarConfirmacionFinalVariante}
        confirmDisabled={cargandoImpactoEliminarVariante || !!errorImpactoEliminarVariante}
        entidadLabel="variante"
        title="Eliminar variante definitivamente"
        message="Esta acción borra la variante para siempre junto con sus precios, categorías e información asociada."
        warning="Usalo solo si fue cargada por error o ya no debe existir en el sistema. Si querés conservarla para poder recuperarla, usá Dar de baja."
        extraContent={impactoEliminacionVarianteContenido}
        details={
          varianteBaja
            ? [
                { label: "ID Variante", value: `#${getVarianteId(varianteBaja)}` },
                { label: "Producto", value: varianteBaja.productoNombre || "—" },
                { label: "Variante", value: varianteBaja.nombre_variante || "—" },
                { label: "SKU", value: varianteBaja.sku || "—" },
                {
                  label: "Stock",
                  value:
                    varianteBaja.stock === null ||
                    varianteBaja.stock === undefined ||
                    varianteBaja.stock === ""
                      ? "—"
                      : String(varianteBaja.stock),
                },
                { label: "Precio costo", value: formatMoney(varianteBaja.precio_costo) },
                { label: "Precio venta", value: formatMoney(varianteBaja.precio) },
              ]
            : []
        }
      />

      <ModalEliminarStock
        open={modalConfirmacionFinalVarianteAbierto}
        loading={!!procesandoVarianteId && accionEliminacionVariante === "eliminar"}
        onClose={handleCerrarEliminarVariante}
        onConfirm={handleConfirmarEliminarPermanenteVariante}
        entidadLabel="variante"
        title="Confirmación final"
        message="Esta es la segunda y última confirmación. La eliminación no se puede deshacer."
        warning={
          toNonNegativeInt(impactoEliminarVariante?.total_movimientos_afectados) > 0
            ? `Al confirmar, la variante se eliminará y ${pluralize(
                toNonNegativeInt(impactoEliminarVariante?.total_movimientos_afectados),
                "registro histórico quedará",
                "registros históricos quedarán"
              )} sin este producto asociado.`
            : "La variante se eliminará definitivamente de Balto y, si está sincronizada, también de Tienda Nube."
        }
        confirmLabel="Sí, eliminar para siempre"
        details={
          varianteBaja
            ? [
                { label: "Producto", value: varianteBaja.productoNombre || "—" },
                { label: "Variante", value: varianteBaja.nombre_variante || "—" },
                { label: "SKU", value: varianteBaja.sku || "—" },
                {
                  label: "Registros afectados",
                  value: String(toNonNegativeInt(impactoEliminarVariante?.total_movimientos_afectados)),
                },
              ]
            : []
        }
      />


      {cargaPreciosMasivos &&
        createPortal(
          <div className="stock-priceLoadingOverlay" role="status" aria-live="polite">
            <div className="stock-priceLoadingModal">
              <div className="stock-priceLoadingModal__icon">
                <img src={BaltoCargaGif} alt="Balto cargando" className="stock-priceLoadingModal__gif" />
              </div>
              <div className="stock-priceLoadingModal__content">
                <h3>
                  {cargaPreciosMasivos.tiendaNubeActiva === true
                    ? "Actualizando precios en Balto y Tienda Nube"
                    : cargaPreciosMasivos.tiendaNubeActiva === false
                      ? "Actualizando precios en Balto"
                      : "Actualizando precios"}
                </h3>
                <p>Esta acción puede tardar unos segundos.</p>
                <small>
                  {cargaPreciosMasivos.total > 0
                    ? cargaPreciosMasivos.tiendaNubeActiva === true
                      ? `${cargaPreciosMasivos.total} precios en proceso y sincronización con Tienda Nube.`
                      : `${cargaPreciosMasivos.total} precios en proceso.`
                    : cargaPreciosMasivos.tiendaNubeActiva === true
                      ? "Sincronizando los cambios con Tienda Nube."
                      : "Procesando los cambios en Balto."}
                </small>
              </div>
            </div>
          </div>,
          document.body
        )}

      {toast ? (
        <Toast
          key={toast.id}
          tipo={esToastCarga(toast.tipo) ? "cargando" : toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={cerrarToast}
        />
      ) : null}
    </>
  );
};

export default Stock;
