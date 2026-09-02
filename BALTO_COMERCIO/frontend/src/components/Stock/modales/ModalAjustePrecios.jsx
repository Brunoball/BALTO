import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faCheck,
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
  moneyToApi,
  moneyToInput,
} from "../utils/stockFormUtils";
import "./ModalAjustePrecios.css";
import { isTopStockModal } from "./modalStackUtils";
import { stockGet, stockPost } from "../api/stockApi";

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

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function calcNuevoPrecio(precioActual, modo, valorRaw) {
  const anterior = Number(precioActual || 0);
  const valor = parseNumber(valorRaw);
  if (valor === null) return anterior;

  let nuevo = anterior;
  if (modo === "porcentaje") {
    nuevo = anterior * (1 + valor / 100);
  } else if (modo === "valor") {
    nuevo = anterior + valor;
  } else {
    nuevo = valor;
  }

  if (!Number.isFinite(nuevo)) nuevo = anterior;
  if (nuevo < 0) nuevo = 0;
  return Math.round(nuevo * 100) / 100;
}

function targetKey(row) {
  const prod = Number(row?.id_stock_producto || 0);
  const variante = row?.id_stock_variante === null || row?.id_stock_variante === undefined || row?.id_stock_variante === ""
    ? "base"
    : String(row.id_stock_variante);
  return `${prod}:${variante}`;
}

function targetLabel(row) {
  const producto = String(row?.producto_nombre || "Producto").trim();
  const variante = String(row?.variante_nombre || "").trim();
  if (variante) return `${producto} · ${variante}`;
  return `${producto} · Precio base`;
}

async function apiGet(paramsObj) {
  const params = new URLSearchParams(paramsObj);
  return stockGet(String(params.get("action") || ""), params);
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
  const [tiposPrecio, setTiposPrecio] = useState([]);
  const [idTipoPrecio, setIdTipoPrecio] = useState("");
  const [opciones, setOpciones] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [detalleAbierto, setDetalleAbierto] = useState(null);
  const [detalleItems, setDetalleItems] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingOpciones, setLoadingOpciones] = useState(false);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cargarBase = useCallback(async () => {
    setLoading(true);
    try {
      const [tiposRes, histRes] = await Promise.all([
        apiGet({ action: "stock_tipos_precio_listar" }),
        apiGet({ action: "stock_precios_ajustes_historial", limit: "20" }),
      ]);

      const tipos = Array.isArray(tiposRes?.stock_tipos_precio)
        ? tiposRes.stock_tipos_precio
        : Array.isArray(tiposRes?.tipos_precio)
          ? tiposRes.tipos_precio
          : [];

      setTiposPrecio(tipos);
      setHistorial(Array.isArray(histRes?.ajustes) ? histRes.ajustes : []);

      if (!idTipoPrecio && tipos.length > 0) {
        setIdTipoPrecio(String(tipos[0].id_tipo_precio_stock || tipos[0].id || ""));
      }
    } catch (err) {
      avisar("error", err?.message || "No se pudo cargar el ajuste de precios.");
    } finally {
      setLoading(false);
    }
  }, [avisar, idTipoPrecio]);

  const cargarOpciones = useCallback(async () => {
    const tipoId = Number(idTipoPrecio || 0);
    if (!tipoId) return;

    setLoadingOpciones(true);
    try {
      const data = await apiGet({
        action: "stock_precios_ajuste_opciones",
        id_tipo_precio_stock: String(tipoId),
      });
      setOpciones(Array.isArray(data?.opciones) ? data.opciones : []);
      setSeleccionados({});
    } catch (err) {
      setOpciones([]);
      avisar("error", err?.message || "No se pudieron cargar los productos para ajustar.");
    } finally {
      setLoadingOpciones(false);
    }
  }, [avisar, idTipoPrecio]);

  useEffect(() => {
    if (!open) return;
    cargarBase();
  }, [open, cargarBase]);

  useEffect(() => {
    if (!open || !idTipoPrecio) return;
    cargarOpciones();
  }, [open, idTipoPrecio, cargarOpciones]);

  const opcionesFiltradas = useMemo(() => {
    const q = String(busqueda || "").trim().toLowerCase();
    if (!q) return opciones;
    return opciones.filter((row) => {
      const haystack = [
        row.producto_nombre,
        row.producto_sku,
        row.variante_nombre,
        row.variante_sku,
        row.sku,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(q);
    });
  }, [busqueda, opciones]);

  const seleccionadosArray = useMemo(() => {
    const map = seleccionados || {};
    return opciones.filter((row) => !!map[targetKey(row)]);
  }, [opciones, seleccionados]);

  const resumen = useMemo(() => {
    let anterior = 0;
    let nuevo = 0;
    seleccionadosArray.forEach((row) => {
      const a = Number(row.precio_actual || 0);
      const n = calcNuevoPrecio(a, modoAjuste, valorAjuste);
      anterior += a;
      nuevo += n;
    });
    return {
      cantidad: seleccionadosArray.length,
      anterior,
      nuevo,
      diferencia: nuevo - anterior,
    };
  }, [modoAjuste, seleccionadosArray, valorAjuste]);

  const toggleSeleccion = (row) => {
    if (Number(row?.precio_heredado || 0) === 1) {
      avisar("error", "Esa variante hereda el precio base. Ajustá el producto base o asignale precio propio a la variante.");
      return;
    }
    const key = targetKey(row);
    setSeleccionados((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const seleccionarFiltrados = () => {
    setSeleccionados((prev) => {
      const next = { ...prev };
      opcionesFiltradas.forEach((row) => {
        if (Number(row?.precio_heredado || 0) !== 1) next[targetKey(row)] = true;
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
      const data = await apiGet({ action: "stock_precios_ajuste_obtener", id_ajuste_precio: String(id) });
      setDetalleItems((prev) => ({ ...prev, [id]: Array.isArray(data?.items) ? data.items : [] }));
    } catch (err) {
      avisar("error", err?.message || "No se pudo cargar el detalle del ajuste.");
    }
  };

  const guardar = async () => {
    if (guardando) return;
    if (!Number(idTipoPrecio || 0)) {
      avisar("error", "Seleccioná el tipo de precio a ajustar.");
      return;
    }
    if (parseNumber(valorAjuste) === null) {
      avisar("error", "Ingresá el valor del ajuste.");
      return;
    }
    if (seleccionadosArray.length === 0) {
      avisar("error", "Seleccioná al menos un producto o variante.");
      return;
    }

    const { idUsuarioMaster, idTenant } = getUsuarioAuditData();
    const payload = {
      id_tipo_precio_stock: Number(idTipoPrecio),
      tipo_ajuste: modoAjuste,
      valor_ajuste: moneyToApi(valorAjuste) || String(valorAjuste).replace(",", "."),
      observacion,
      idUsuarioMaster,
      idTenant,
      items: seleccionadosArray.map((row) => ({
        id_stock_producto: Number(row.id_stock_producto),
        id_stock_variante: row.id_stock_variante === null || row.id_stock_variante === undefined ? null : Number(row.id_stock_variante),
      })),
    };

    const totalSeleccionados = seleccionadosArray.length;
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
      if (mountedRef.current) setGuardando(false);
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

  return createPortal(
    <div ref={overlayRef} data-stock-modal-overlay="true" className="mi-modal__overlay ap-modalOverlay" role="dialog" aria-modal="true">
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
                  onChange={(e) => setIdTipoPrecio(e.target.value)}
                  disabled={loading || guardando}
                >
                  {tiposPrecio.map((tipo) => (
                    <option key={tipo.id_tipo_precio_stock} value={tipo.id_tipo_precio_stock}>
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
              />
            </label>
          </section>

          <section className="ap-summaryGrid">
            <div className="ap-summaryCard">
              <span>Seleccionados</span>
              <strong>{resumen.cantidad}</strong>
            </div>
            <div className="ap-summaryCard">
              <span>Total anterior</span>
              <strong>{formatMoney(resumen.anterior)}</strong>
            </div>
            <div className="ap-summaryCard">
              <span>Total nuevo</span>
              <strong>{formatMoney(resumen.nuevo)}</strong>
            </div>
            <div className={`ap-summaryCard ${resumen.diferencia < 0 ? "is-negative" : "is-positive"}`}>
              <span>Diferencia</span>
              <strong>{formatSignedMoney(resumen.diferencia)}</strong>
            </div>
          </section>

          <section className="ap-panel">
            <div className="ap-sectionHead">
              <div>
                <h3>Productos y variantes</h3>
                <p>El precio anterior queda guardado y el ajuste crea el precio nuevo para cada fila seleccionada.</p>
              </div>
              <div className="ap-actionsSmall">
                <button type="button" className="mov-btn mov-btn--ghost" onClick={seleccionarFiltrados} disabled={loadingOpciones || guardando || opcionesFiltradas.length === 0}>
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
              />
            </label>

            <div className="ap-table">
              <div className="ap-table__head">
                <span></span>
                <span>Producto / variante</span>
                <span>SKU</span>
                <span>Actual</span>
                <span>Ajuste</span>
                <span>Final</span>
              </div>

              {loadingOpciones ? (
                <div className="ap-empty">Cargando productos y variantes...</div>
              ) : opcionesFiltradas.length === 0 ? (
                <div className="ap-empty">No hay productos para mostrar.</div>
              ) : (
                opcionesFiltradas.map((row) => {
                  const key = targetKey(row);
                  const checked = !!seleccionados[key];
                  const anterior = Number(row.precio_actual || 0);
                  const nuevo = calcNuevoPrecio(anterior, modoAjuste, valorAjuste);
                  const diff = nuevo - anterior;
                  const esVariante = row.id_stock_variante !== null && row.id_stock_variante !== undefined;
                  const heredado = Number(row.precio_heredado || 0) === 1;

                  return (
                    <label className={`ap-table__row ${checked ? "is-selected" : ""} ${heredado ? "is-disabled" : ""}`} key={key}>
                      <span>
                        <input type="checkbox" checked={checked} disabled={heredado} onChange={() => toggleSeleccion(row)} />
                      </span>
                      <span className="ap-targetName">
                        <strong>{targetLabel(row)}</strong>
                        <small>{esVariante ? "Variante" : row.tiene_variantes ? "Producto base con variantes" : "Producto simple"}</small>
                        {heredado ? <em>heredado: ajustá el precio base</em> : null}
                      </span>
                      <span className="ap-sku">{row.variante_sku || row.producto_sku || row.sku || "—"}</span>
                      <span>{formatMoney(anterior)}</span>
                      <span className={diff < 0 ? "ap-negative" : "ap-positive"}>{formatSignedMoney(diff)}</span>
                      <span><b>{formatMoney(nuevo)}</b></span>
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

            </div>

            <div className="ap-history">
              {historial.length === 0 ? (
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
                          <small>{ajuste.created_at} · {ajuste.total_items} ítems · {ajuste.tipo_ajuste} {ajuste.valor_ajuste}</small>
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
              <button type="button" className="mov-btn mov-btn--primary" onClick={guardar} disabled={guardando || resumen.cantidad === 0}>
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
