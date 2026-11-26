import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faCheck,
  faCircleInfo,
  faChevronDown,
  faChevronUp,
  faClockRotateLeft,
  faMagnifyingGlass,
  faMoneyBillTrendUp,
  faPercent,
  faPlus,
  faRotateRight,
  faSave,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import {
  getUsuarioAuditData,
  moneyToInput,
} from "../utils/stockFormUtils";
import "./ModalAjustePrecios.css";
import { isTopStockModal } from "./modalStackUtils";
import { stockGet, stockPost } from "../api/stockApi";
import { useListas } from "../../../context/ListasContext";
import {
  calcularFila,
  esHeredadoRow,
  esSeleccionable,
  esVarianteRow,
  filasSeleccionadas,
  filtrarOpciones,
  impactoHeredado,
  itemsPayload,
  normalizarTiposPrecio,
  normalizarValorAjuste,
  ordenarOpciones,
  resumirSeleccion,
  targetKey,
  valorAjusteParaApi,
} from "../utils/ajustePreciosCalc";

const TOAST_LOADING_DURATION = 600000;
const DEFAULT_BULK_LOADING_THRESHOLD = 10;
const TIENDANUBE_JOB_GROUP_SIZE = 25;

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "—";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatMoney(n)}`;
}

function formatAdjustmentType(tipo, value) {
  const normalized = String(tipo || "").trim().toLowerCase();
  // Registros históricos del coeficiente ponderado (funcionalidad retirada):
  // se conservan para auditoría con una etiqueta neutra; no se crean nuevos.
  if (normalized === "coeficiente") return "Ajuste histórico de precios";
  if (normalized === "compra_costo") return "Costo actualizado por compra";
  if (normalized === "porcentaje") return `Porcentaje ${value ?? ""}%`.trim();
  if (normalized === "valor") return `Importe ${formatSignedMoney(value)}`;
  if (normalized === "fijo") return `Precio fijo ${formatMoney(value)}`;
  return `${tipo || "Ajuste"} ${value ?? ""}`.trim();
}

function targetLabel(row) {
  const producto = String(row?.producto_nombre || "Producto").trim();
  const variante = String(row?.variante_nombre || "").trim();
  if (variante) return `${producto} · ${variante}`;
  return `${producto} · Precio base`;
}

async function apiPost(action, body) {
  return stockPost(action, body || {});
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getTiendaNubeSyncPayload(response) {
  if (!response || typeof response !== "object") return null;
  return response?.tiendanube_sync ?? response?.data?.tiendanube_sync ?? null;
}

function extractTiendaNubeJobIds(response) {
  const sync = getTiendaNubeSyncPayload(response);
  if (!sync || typeof sync !== "object") return [];

  const ids = new Set();
  const collect = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value !== "object") return;

    const id = Number(value.id_job ?? value.job_id ?? value.idJob ?? 0);
    if (id > 0) ids.add(id);
    if (Array.isArray(value.resultados)) collect(value.resultados);
    if (value.job_reintento) collect(value.job_reintento);
  };

  collect(sync);
  return Array.from(ids);
}

function chunkArray(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function sincronizarPreciosTiendaNube(response) {
  const idsJobs = extractTiendaNubeJobIds(response);
  if (idsJobs.length === 0) {
    return { esperado: false, exitoso: true, estado: null, error: "" };
  }

  const { idTenant } = getUsuarioAuditData();
  const maxWaitMs = Math.min(600000, Math.max(180000, idsJobs.length * 6000));
  const startedAt = Date.now();
  let ultimoEstado = null;
  let ultimoError = "";

  for (const grupo of chunkArray(idsJobs, TIENDANUBE_JOB_GROUP_SIZE)) {
    while (Date.now() - startedAt < maxWaitMs) {
      try {
        // Procesamos tandas chicas desde esta misma experiencia. Cada job conserva su
        // candado y estado durable: si una respuesta larga se pierde, la próxima vuelta
        // consulta el resultado o recupera el job sin esperar al cron general.
        await apiPost("stock_tiendanube_jobs_procesar", {
          ids_jobs: grupo,
          limit: 5,
          ...(idTenant ? { tenant_id: idTenant } : {}),
        });

        const estadoRes = await apiPost("stock_tiendanube_jobs_estado", {
          ids_jobs: grupo,
          procesar_pendientes: false,
          ...(idTenant ? { tenant_id: idTenant } : {}),
        });
        ultimoEstado = estadoRes?.data && typeof estadoRes.data === "object" ? estadoRes.data : estadoRes;

        if (ultimoEstado?.finalizado === true) {
          if (ultimoEstado?.exitoso === true) break;

          const detalle = (ultimoEstado?.jobs || [])
            .map((job) => String(job?.error || "").trim())
            .filter(Boolean)
            .join(" · ");
          return {
            esperado: true,
            exitoso: false,
            estado: ultimoEstado,
            error: detalle || "La sincronización de precios con Tienda Nube no pudo completarse.",
          };
        }
      } catch (err) {
        ultimoError = String(err?.message || err || "").trim();
      }

      await delay(1500);
    }

    if (ultimoEstado?.finalizado !== true || ultimoEstado?.exitoso !== true) {
      return {
        esperado: true,
        exitoso: false,
        estado: ultimoEstado,
        error: ultimoError || "La sincronización de precios con Tienda Nube siguió pendiente durante demasiado tiempo.",
      };
    }

    ultimoEstado = null;
  }

  return { esperado: true, exitoso: true, estado: ultimoEstado, error: "" };
}

const ModalAjustePrecios = ({ open, onClose, onToast, onGuardado, onProcesoMasivo, umbralProcesoMasivo = DEFAULT_BULK_LOADING_THRESHOLD }) => {
  const overlayRef = useRef(null);
  const mountedRef = useRef(true);
  const guardandoRef = useRef(false);
  const tiposReqRef = useRef(0);
  const opcionesReqRef = useRef(0);
  const historialReqRef = useRef(0);

  // Los tipos de precio ya presentes en ListasContext (misma sesión del panel) permiten
  // mostrar el selector de inmediato. Siempre se revalidan contra el endpoint de Stock;
  // nada se persiste fuera de memoria ni se comparte entre sesiones/tenants.
  const { lists } = useListas();
  const tiposIniciales = useMemo(
    () => normalizarTiposPrecio(lists?.stock_tipos_precio),
    // Sólo la foto al montar: los cambios posteriores llegan por la revalidación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [tiposPrecio, setTiposPrecio] = useState(tiposIniciales);
  const [tiposEstado, setTiposEstado] = useState(tiposIniciales.length > 0 ? "provisional" : "cargando");
  const [idTipoPrecio, setIdTipoPrecio] = useState(
    tiposIniciales.length > 0 ? String(tiposIniciales[0].id_tipo_precio_stock) : ""
  );
  const [opciones, setOpciones] = useState([]);
  const [opcionesTipoId, setOpcionesTipoId] = useState(null);
  const [loadingOpciones, setLoadingOpciones] = useState(false);
  const [errorOpciones, setErrorOpciones] = useState("");
  const [historial, setHistorial] = useState([]);
  const [historialEstado, setHistorialEstado] = useState("idle");
  const [historialError, setHistorialError] = useState("");
  const [detalleAbierto, setDetalleAbierto] = useState(null);
  const [detalleItems, setDetalleItems] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState({});
  const [modoAjuste, setModoAjuste] = useState("porcentaje");
  const [valorAjuste, setValorAjuste] = useState("");
  const [observacion, setObservacion] = useState("");
  const [tabActiva, setTabActiva] = useState("ajuste");

  const avisar = useCallback(
    (tipo, mensaje, duracion) => {
      if (typeof onToast === "function") onToast(tipo, mensaje, duracion);
    },
    [onToast]
  );
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 1) Tipos de precio: independientes del historial. Se piden una vez por apertura;
  //    cambiar de tipo NO vuelve a pedirlos.
  useEffect(() => {
    if (!open) return undefined;
    const reqId = ++tiposReqRef.current;

    stockGet("stock_tipos_precio_listar", {})
      .then((res) => {
        if (!mountedRef.current || reqId !== tiposReqRef.current) return;
        const tipos = normalizarTiposPrecio(
          res?.stock_tipos_precio ?? res?.tipos_precio ?? res?.data?.stock_tipos_precio ?? res?.data?.tipos_precio
        );
        setTiposPrecio(tipos);
        setTiposEstado("listo");
        setIdTipoPrecio((prev) => {
          if (prev && tipos.some((t) => String(t.id_tipo_precio_stock) === String(prev))) return prev;
          return tipos.length > 0 ? String(tipos[0].id_tipo_precio_stock) : "";
        });
      })
      .catch((err) => {
        if (!mountedRef.current || reqId !== tiposReqRef.current) return;
        setTiposEstado((prev) => (prev === "provisional" ? "provisional" : "error"));
        avisarRef.current("error", err?.message || "No se pudieron cargar los tipos de precio.");
      });

    return () => {
      // Una respuesta que llega después de cerrar/reabrir se descarta por reqId.
      tiposReqRef.current += 1;
    };
  }, [open]);

  // 2) Opciones del tipo activo. Cada cambio de tipo limpia selección y filas antes
  //    de pedir las nuevas: nunca se muestran ni se guardan precios de otro tipo.
  useEffect(() => {
    if (!open) return undefined;
    const tipoId = Number(idTipoPrecio || 0);
    const reqId = ++opcionesReqRef.current;

    setSeleccionados({});
    setOpciones([]);
    setOpcionesTipoId(null);
    setErrorOpciones("");

    if (!tipoId) {
      setLoadingOpciones(false);
      return undefined;
    }

    setLoadingOpciones(true);
    stockGet("stock_precios_ajuste_opciones", { id_tipo_precio_stock: String(tipoId) })
      .then((data) => {
        if (!mountedRef.current || reqId !== opcionesReqRef.current) return;
        const tipoRespuesta = Number(
          data?.id_tipo_precio_stock ?? data?.tipo_precio?.id_tipo_precio_stock ?? data?.data?.id_tipo_precio_stock ?? tipoId
        );
        if (tipoRespuesta !== tipoId) return;
        const rows = (Array.isArray(data?.opciones) ? data.opciones : []).filter(
          (row) => row?.id_tipo_precio_stock === undefined || row?.id_tipo_precio_stock === null || Number(row.id_tipo_precio_stock) === tipoId
        );
        setOpciones(ordenarOpciones(rows));
        setOpcionesTipoId(tipoId);
        setLoadingOpciones(false);
      })
      .catch((err) => {
        if (!mountedRef.current || reqId !== opcionesReqRef.current) return;
        const mensaje = err?.message || "No se pudieron cargar los productos para ajustar.";
        setOpciones([]);
        setOpcionesTipoId(null);
        setErrorOpciones(mensaje);
        setLoadingOpciones(false);
        avisarRef.current("error", mensaje);
      });

    return undefined;
  }, [open, idTipoPrecio]);

  // 3) Historial bajo demanda: sólo al entrar en su pestaña. Un error acá no bloquea Ajustes.
  const cargarHistorial = useCallback(async () => {
    const reqId = ++historialReqRef.current;
    setHistorialEstado("cargando");
    setHistorialError("");
    try {
      const res = await stockGet("stock_precios_ajustes_historial", { limit: "20" });
      if (!mountedRef.current || reqId !== historialReqRef.current) return;
      setHistorial(Array.isArray(res?.ajustes) ? res.ajustes : Array.isArray(res?.historial) ? res.historial : []);
      setHistorialEstado("listo");
    } catch (err) {
      if (!mountedRef.current || reqId !== historialReqRef.current) return;
      setHistorialEstado("error");
      setHistorialError(err?.message || "No se pudo cargar el historial de ajustes.");
    }
  }, []);

  useEffect(() => {
    if (!open || tabActiva !== "historial" || historialEstado !== "idle") return;
    cargarHistorial();
  }, [open, tabActiva, historialEstado, cargarHistorial]);

  const busquedaDiferida = useDeferredValue(busqueda);
  const opcionesFiltradas = useMemo(() => filtrarOpciones(opciones, busquedaDiferida), [busquedaDiferida, opciones]);

  const valorNormalizado = useMemo(() => normalizarValorAjuste(modoAjuste, valorAjuste), [modoAjuste, valorAjuste]);
  const valorInvalido = modoAjuste === "fijo" && valorNormalizado !== null && valorNormalizado < 0;
  const valorCalculo = valorInvalido ? null : valorNormalizado;

  const seleccionadosArray = useMemo(() => filasSeleccionadas(opciones, seleccionados), [opciones, seleccionados]);

  const resumen = useMemo(
    () => resumirSeleccion(opciones, seleccionados, modoAjuste, valorCalculo),
    [modoAjuste, opciones, seleccionados, valorCalculo]
  );

  const heredadosAfectados = useMemo(
    () => impactoHeredado(opciones, seleccionados, modoAjuste, valorCalculo),
    [modoAjuste, opciones, seleccionados, valorCalculo]
  );

  const seleccionadosVisibles = useMemo(() => {
    const visibles = new Set(opcionesFiltradas.map((row) => targetKey(row)));
    return seleccionadosArray.filter((row) => visibles.has(targetKey(row))).length;
  }, [opcionesFiltradas, seleccionadosArray]);
  const seleccionadosOcultos = Math.max(0, seleccionadosArray.length - seleccionadosVisibles);

  const opcionesListas = !loadingOpciones && opcionesTipoId !== null && opcionesTipoId === Number(idTipoPrecio || 0);
  const puedeGuardar =
    !guardando && opcionesListas && resumen.cantidad > 0 && valorCalculo !== null && resumen.conCambio > 0;

  const cambiarTipoPrecio = (valor) => {
    if (guardandoRef.current) return;
    setIdTipoPrecio(String(valor || ""));
  };

  const toggleSeleccion = (row) => {
    if (!esSeleccionable(row)) {
      avisar("error", "Esa variante hereda el precio base. Ajustá el producto base o asignale precio propio a la variante.");
      return;
    }
    const key = targetKey(row);
    setSeleccionados((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const seleccionarFiltrados = () => {
    // Usa el filtro escrito (no el diferido) para seleccionar exactamente lo que el usuario filtró.
    const visibles = filtrarOpciones(opciones, busqueda).filter(esSeleccionable);
    if (visibles.length === 0) return;
    setSeleccionados((prev) => {
      const next = { ...prev };
      visibles.forEach((row) => {
        next[targetKey(row)] = true;
      });
      return next;
    });
  };

  const limpiarSeleccion = () => setSeleccionados({});

  const verDetalle = async (idAjuste) => {
    const id = Number(idAjuste || 0);
    if (!id) return;
    if (detalleAbierto === id) {
      setDetalleAbierto(null);
      return;
    }
    setDetalleAbierto(id);
    if (detalleItems[id]) return;
    try {
      const data = await stockGet("stock_precios_ajuste_obtener", { id_ajuste_precio: String(id) });
      if (!mountedRef.current) return;
      setDetalleItems((prev) => ({ ...prev, [id]: Array.isArray(data?.items) ? data.items : [] }));
    } catch (err) {
      avisar("error", err?.message || "No se pudo cargar el detalle del ajuste.");
    }
  };

  const guardar = async () => {
    // Candado síncrono: dos clics en el mismo ciclo de eventos no generan dos POST.
    if (guardandoRef.current || guardando) return;
    const tipoId = Number(idTipoPrecio || 0);
    if (!tipoId) {
      avisar("error", "Seleccioná el tipo de precio a ajustar.");
      return;
    }
    if (!opcionesListas || opcionesTipoId !== tipoId) {
      avisar("error", "Esperá a que terminen de cargarse los productos del tipo de precio seleccionado.");
      return;
    }
    if (valorNormalizado === null) {
      avisar("error", "Ingresá el valor del ajuste.");
      return;
    }
    if (valorInvalido) {
      avisar("error", "El precio fijo no puede ser negativo.");
      return;
    }
    const items = itemsPayload(opciones, seleccionados);
    if (items.length === 0) {
      avisar("error", "Seleccioná al menos un producto o variante.");
      return;
    }
    if (resumen.conCambio === 0) {
      avisar("error", "El ajuste no modifica ningún precio de la selección.");
      return;
    }

    guardandoRef.current = true;

    const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
    const payload = {
      id_tipo_precio_stock: tipoId,
      tipo_ajuste: modoAjuste,
      valor_ajuste: valorAjusteParaApi(modoAjuste, valorAjuste),
      observacion,
      idUsuarioMaster,
      idTenant,
      items,
    };

    const totalSeleccionados = items.length;
    const mostrarCargaMasiva = totalSeleccionados >= Number(umbralProcesoMasivo || DEFAULT_BULK_LOADING_THRESHOLD);
    const mensajeCarga = "Actualizando precios...";
    let guardadoEnBalto = false;

    setGuardando(true);

    if (mostrarCargaMasiva && typeof onProcesoMasivo === "function") {
      onProcesoMasivo({ open: true, total: totalSeleccionados });
    } else {
      avisar("loading", mensajeCarga, TOAST_LOADING_DURATION);
    }

    // Este ajuste usa su propia pantalla de carga global. Cerramos el modal
    // apenas comienza el guardado y dejamos que la actualización continúe.
    onClose?.();

    try {
      const data = await apiPost("stock_precios_ajuste_crear", payload);
      guardadoEnBalto = true;
      if (typeof onGuardado === "function") await onGuardado(data);

      const sync = getTiendaNubeSyncPayload(data);
      const totalSync = Number(sync?.total_productos || 0);
      const encolados = Number(sync?.encolados || sync?.pendientes || 0);
      const motivoSync = String(sync?.motivo || "").trim().toLowerCase();
      const tiendaNubeNoConectada =
        motivoSync === "sin_conexion_tiendanube_activa" || motivoSync === "tiendanube_no_conectada";

      if (mostrarCargaMasiva && typeof onProcesoMasivo === "function") {
        onProcesoMasivo({
          open: true,
          total: totalSeleccionados,
          tiendaNubeActiva: extractTiendaNubeJobIds(data).length > 0,
        });
      }

      const confirmacionTiendaNube = await sincronizarPreciosTiendaNube(data);

      if (confirmacionTiendaNube.esperado) {
        if (confirmacionTiendaNube.exitoso) {
          avisar(
            "exito",
            `Precios actualizados correctamente en Balto y Tienda Nube${totalSync > 0 ? ` (${totalSync} productos)` : ""}.`
          );
        } else {
          avisar(
            "advertencia",
            `Los precios quedaron actualizados en Balto, pero Tienda Nube no pudo completar la sincronización. ${confirmacionTiendaNube.error}`,
            8000
          );
        }
        return;
      }

      if (tiendaNubeNoConectada) {
        avisar("exito", "Precios actualizados correctamente en Balto.");
        return;
      }

      if (totalSync > 0 && encolados === 0 && Number(sync?.saltados || 0) > 0) {
        avisar(
          "advertencia",
          `Los precios quedaron actualizados en Balto, pero no se enviaron a Tienda Nube (${sync?.motivo || "sin conexión activa"}).`,
          7000
        );
        return;
      }

      avisar("exito", data?.mensaje || "Precios actualizados correctamente.");
    } catch (err) {
      if (guardadoEnBalto) {
        avisar(
          "advertencia",
          `Los precios quedaron actualizados en Balto, pero no se pudo confirmar Tienda Nube. ${err?.message || "Error de sincronización."}`,
          8000
        );
      } else {
        avisar("error", err?.message || "No se pudo actualizar los precios.");
      }
    } finally {
      if (mostrarCargaMasiva && typeof onProcesoMasivo === "function") {
        onProcesoMasivo({ open: false });
      }
      guardandoRef.current = false;
      if (mountedRef.current) {
        setGuardando(false);
        // Si el modal siguiera abierto, el historial se vuelve a pedir al entrar.
        setHistorialEstado("idle");
      }
    }
  };

  useEffect(() => {
    if (!open) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (!isTopStockModal(overlayRef.current)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (!guardando) onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, guardando, onClose]);

  if (!open) return null;

  const tiposSinDatos = tiposPrecio.length === 0;
  const mensajeTabla = loadingOpciones
    ? "Cargando productos y variantes..."
    : errorOpciones
      ? errorOpciones
      : !idTipoPrecio
        ? tiposEstado === "error"
          ? "No se pudieron cargar los tipos de precio."
          : "Cargando tipos de precio..."
        : opcionesFiltradas.length === 0
          ? "No hay productos para mostrar."
          : "";

  return createPortal(
    <div ref={overlayRef} data-stock-modal-overlay="true" className="mi-modal__overlay ap-modalOverlay" role="dialog" aria-modal="true" aria-label="Ajuste de precios">
      <div className="mi-modal__container ap-modal">
        <div className="mi-modal__header ap-modal__head">
          <div className="mi-modal__head-icon ap-modal__titleIcon">
            <FontAwesomeIcon icon={faMoneyBillTrendUp} />
          </div>
          <div>
            <h2>Ajuste de precios</h2>
            <p>Seleccioná productos o variantes, aplicá un porcentaje o importe y guardá el historial.</p>
          </div>
          <button type="button" className="mi-modal__close ap-modal__close" onClick={onClose} disabled={guardando} title="Cerrar" aria-label="Cerrar">
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="mi-modal__content ap-modal__body">
          <div className="ap-tabs" role="tablist" aria-label="Ajuste de precios e historial">
            <button
              type="button"
              className={`ap-tab ${tabActiva === "ajuste" ? "is-active" : ""}`}
              onClick={() => setTabActiva("ajuste")}
              role="tab"
              aria-selected={tabActiva === "ajuste"}
            >
              <FontAwesomeIcon icon={faMoneyBillTrendUp} /> Ajustes
            </button>
            <button
              type="button"
              className={`ap-tab ${tabActiva === "historial" ? "is-active" : ""}`}
              onClick={() => setTabActiva("historial")}
              role="tab"
              aria-selected={tabActiva === "historial"}
            >
              <FontAwesomeIcon icon={faClockRotateLeft} /> Historial
            </button>
          </div>

          {tabActiva === "ajuste" ? (
            <>
          <section className="ap-panel ap-panel--controls">
            <div className="ap-controlsGrid">
              <label className="cmi-floatingField">
                <span className="cmi-floatingLabel">Tipo de precio</span>
                <select
                  className="cmi-input cmi-select"
                  value={idTipoPrecio}
                  onChange={(e) => cambiarTipoPrecio(e.target.value)}
                  disabled={tiposSinDatos || guardando}
                  data-testid="ap-tipo-precio"
                  aria-busy={tiposSinDatos && tiposEstado === "cargando" ? "true" : "false"}
                >
                  {tiposSinDatos ? (
                    <option value="">{tiposEstado === "error" ? "Sin tipos de precio" : "Cargando tipos de precio..."}</option>
                  ) : null}
                  {tiposPrecio.map((tipo) => (
                    <option key={tipo.id_tipo_precio_stock} value={String(tipo.id_tipo_precio_stock)}>
                      {tipo.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="cmi-floatingField">
                <span className="cmi-floatingLabel">Modo de ajuste</span>
                <select
                  className="cmi-input cmi-select"
                  value={modoAjuste}
                  onChange={(e) => setModoAjuste(e.target.value)}
                  disabled={guardando}
                  data-testid="ap-modo-ajuste"
                >
                  <option value="porcentaje">Por porcentaje</option>
                  <option value="valor">Sumar/restar importe</option>
                  <option value="fijo">Precio fijo final</option>
                </select>
              </label>

              <label className="cmi-floatingField">
                <span className="cmi-floatingLabel">
                  <FontAwesomeIcon icon={modoAjuste === "porcentaje" ? faPercent : faPlus} /> Valor
                </span>
                <input
                  className="cmi-input"
                  value={valorAjuste}
                  onChange={(e) => setValorAjuste(e.target.value)}
                  onBlur={() => setValorAjuste((v) => moneyToInput(v))}
                  placeholder={modoAjuste === "porcentaje" ? "Ej: 10 o -5" : "Ej: 1000 o -500"}
                  disabled={guardando}
                  data-testid="ap-valor-ajuste"
                  aria-invalid={valorInvalido ? "true" : "false"}
                />
              </label>
            </div>

            <label className="cmi-floatingField ap-observation">
              <span className="cmi-floatingLabel">Observación del ajuste</span>
              <textarea
                className="cmi-input cmi-textarea"
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                placeholder="Ej: actualización mensual de precios, lista nueva, proveedor aumentó..."
                disabled={guardando}
                data-testid="ap-observacion"
              />
            </label>
          </section>

          <section className="ap-summaryGrid" data-testid="ap-resumen">
            <div className="ap-summaryCard">
              <span>Seleccionados</span>
              <strong data-testid="ap-resumen-cantidad">{resumen.cantidad}</strong>
            </div>
            <div className="ap-summaryCard">
              <span>Total anterior</span>
              <strong data-testid="ap-resumen-anterior">{formatMoney(resumen.anterior)}</strong>
            </div>
            <div className="ap-summaryCard">
              <span>Total nuevo</span>
              <strong data-testid="ap-resumen-nuevo">{formatMoney(resumen.nuevo)}</strong>
            </div>
            <div className={`ap-summaryCard ${resumen.diferencia < 0 ? "is-negative" : "is-positive"}`}>
              <span>Diferencia</span>
              <strong data-testid="ap-resumen-diferencia">{formatSignedMoney(resumen.diferencia)}</strong>
            </div>
          </section>

          {heredadosAfectados.size > 0 ? (
            <div className="ap-notice" role="note" data-testid="ap-aviso-heredados">
              <FontAwesomeIcon icon={faCircleInfo} />
              <span>
                {heredadosAfectados.size === 1
                  ? "1 variante hereda el precio base de un producto seleccionado: no se modifica por separado, pero su precio final cambiará junto con el precio base."
                  : `${heredadosAfectados.size} variantes heredan el precio base de productos seleccionados: no se modifican por separado, pero su precio final cambiará junto con el precio base.`}
              </span>
            </div>
          ) : null}

          <section className="ap-panel">
            <div className="ap-sectionHead">
              <div>
                <h3>Productos y variantes</h3>
                <p>
                  El precio anterior queda guardado y el ajuste crea el precio nuevo sólo para las filas seleccionadas.
                  {seleccionadosOcultos > 0 ? (
                    <span data-testid="ap-seleccion-oculta">{` ${seleccionadosOcultos} seleccionado${seleccionadosOcultos === 1 ? "" : "s"} fuera del filtro actual.`}</span>
                  ) : null}
                </p>
              </div>
              <div className="ap-actionsSmall">
                <button type="button" className="mov-btn mov-btn--ghost" onClick={seleccionarFiltrados} disabled={!opcionesListas || guardando || opcionesFiltradas.length === 0}>
                  <FontAwesomeIcon icon={faCheck} /> Seleccionar visibles
                </button>
                <button type="button" className="mov-btn mov-btn--ghost" onClick={limpiarSeleccion} disabled={guardando || resumen.cantidad === 0}>
                  Limpiar
                </button>
              </div>
            </div>

            <label className="cmi-floatingField ap-search">
              <span className="cmi-floatingLabel"><FontAwesomeIcon icon={faMagnifyingGlass} /> Buscar</span>
              <input
                className="cmi-input"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar producto, SKU o variante..."
                data-testid="ap-buscar"
              />
            </label>

            <div className="ap-table" data-testid="ap-tabla" aria-busy={loadingOpciones ? "true" : "false"}>
              <div className="ap-table__head">
                <span></span>
                <span>Producto / variante</span>
                <span>SKU</span>
                <span>Actual</span>
                <span>Ajuste</span>
                <span>Final</span>
              </div>

              {mensajeTabla ? (
                <div className="ap-empty" data-testid="ap-tabla-estado">{mensajeTabla}</div>
              ) : (
                opcionesFiltradas.map((row) => {
                  const key = targetKey(row);
                  const checked = !!seleccionados[key];
                  const fila = calcularFila(row, { seleccionado: checked, modo: modoAjuste, valor: valorCalculo });
                  const esVariante = esVarianteRow(row);
                  const heredado = esHeredadoRow(row);
                  const impactoBase = heredado ? heredadosAfectados.get(key) : null;

                  return (
                    <label
                      className={`ap-table__row ${checked ? "is-selected" : ""} ${heredado ? "is-disabled" : ""}`}
                      key={key}
                      data-testid="ap-row"
                      data-target-key={key}
                      data-selected={checked ? "true" : "false"}
                    >
                      <span>
                        <input type="checkbox" checked={checked} disabled={heredado || guardando} onChange={() => toggleSeleccion(row)} aria-label={`Seleccionar ${targetLabel(row)}`} />
                      </span>
                      <span className="ap-targetName">
                        <strong>{targetLabel(row)}</strong>
                        <small>{esVariante ? "Variante" : Number(row.tiene_variantes || 0) === 1 ? "Producto base con variantes" : "Producto simple"}</small>
                        {heredado ? (
                          <em data-testid="ap-row-heredado">
                            {impactoBase
                              ? `hereda el precio base: pasará a ${formatMoney(impactoBase.nuevoBase)}`
                              : "heredado: ajustá el precio base"}
                          </em>
                        ) : null}
                      </span>
                      <span className="ap-sku">{row.variante_sku || row.producto_sku || row.sku || "—"}</span>
                      <span data-testid="ap-row-actual">{formatMoney(fila.anterior)}</span>
                      <span data-testid="ap-row-ajuste" className={fila.aplica ? (fila.diferencia < 0 ? "ap-negative" : "ap-positive") : ""}>
                        {fila.aplica ? formatSignedMoney(fila.diferencia) : "—"}
                      </span>
                      <span data-testid="ap-row-final"><b>{formatMoney(fila.nuevo)}</b></span>
                    </label>
                  );
                })
              )}
            </div>
          </section>
            </>
          ) : (
            <>

          <section className="ap-panel ap-panel--historyOnly">
            <div className="ap-sectionHead">
              <div>
                <h3><FontAwesomeIcon icon={faClockRotateLeft} /> Historial de ajustes</h3>
                <p>Últimos ajustes guardados con precio anterior y precio nuevo.</p>
              </div>
              {historialEstado === "error" ? (
                <div className="ap-actionsSmall">
                  <button type="button" className="mov-btn mov-btn--ghost" onClick={cargarHistorial}>
                    <FontAwesomeIcon icon={faRotateRight} /> Reintentar
                  </button>
                </div>
              ) : null}
            </div>

            <div className="ap-history" data-testid="ap-historial">
              {historialEstado === "idle" || historialEstado === "cargando" ? (
                <div className="ap-empty">Cargando historial...</div>
              ) : historialEstado === "error" ? (
                <div className="ap-empty" data-testid="ap-historial-error">{historialError}</div>
              ) : historial.length === 0 ? (
                <div className="ap-empty">Todavía no hay ajustes de precios guardados.</div>
              ) : (
                historial.map((ajuste) => {
                  const id = Number(ajuste.id_ajuste_precio || 0);
                  const abierto = detalleAbierto === id;
                  const items = detalleItems[id] || [];

                  return (
                    <div className="ap-historyItem" key={id}>
                      <button type="button" className="ap-historyItem__head" onClick={() => verDetalle(id)}>
                        <span>
                          <strong>#{id} · {ajuste.tipo_precio_nombre}</strong>
                          <small>{ajuste.created_at} · {ajuste.total_items} ítems · {formatAdjustmentType(ajuste.tipo_ajuste, ajuste.valor_ajuste)}</small>
                        </span>
                        <span className="ap-historyDiff">{formatSignedMoney(ajuste.diferencia_total)}</span>
                        <FontAwesomeIcon icon={abierto ? faChevronUp : faChevronDown} />
                      </button>

                      {abierto ? (
                        <div className="ap-historyDetail">
                          {ajuste.observacion ? <p>{ajuste.observacion}</p> : null}
                          {items.length === 0 ? (
                            <div className="ap-empty">Cargando detalle...</div>
                          ) : (
                            <div className="ap-historyTable">
                              <div className="ap-historyTable__head">
                                <span>Producto</span>
                                <span>Anterior</span>
                                <span>Nuevo</span>
                                <span>Diferencia</span>
                              </div>
                              {items.map((item) => (
                                <div className="ap-historyTable__row" key={item.id_ajuste_precio_item}>
                                  <span>
                                    <b>{item.producto_nombre}</b>
                                    {item.variante_nombre ? <small>{item.variante_nombre}</small> : null}
                                  </span>
                                  <span>{formatMoney(item.precio_anterior)}</span>
                                  <span>{formatMoney(item.precio_nuevo)}</span>
                                  <span className={Number(item.diferencia || 0) < 0 ? "ap-negative" : "ap-positive"}>{formatSignedMoney(item.diferencia)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </section>
            </>
          )}
        </div>

        <div className="mit-actions ap-modal__footer">
          <div className="ap-footerHint">
            <FontAwesomeIcon icon={faCalculator} /> Se guarda historial con precio anterior, precio nuevo y observación.
          </div>
          <div className="ap-footerActions">
            <button type="button" className="mov-btn mov-btn--ghost" onClick={onClose} disabled={guardando}>
              {tabActiva === "ajuste" ? "Cancelar" : "Cerrar"}
            </button>
            {tabActiva === "ajuste" ? (
              <button
                type="button"
                className="mov-btn mov-btn--primary"
                onClick={guardar}
                disabled={!puedeGuardar}
                data-testid="ap-guardar"
                title={!opcionesListas ? "Esperá a que se carguen los productos del tipo de precio." : undefined}
              >
                <FontAwesomeIcon icon={faSave} /> {guardando ? "Guardando..." : "Guardar ajuste"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalAjustePrecios;
