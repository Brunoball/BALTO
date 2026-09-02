import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faStore,
  faPlug,
  faCheckCircle,
  faTriangleExclamation,
  faCircleInfo,
  faIdBadge,
  faBolt,
  faShieldHalved,
  faChevronRight,
  faDownload,
  faXmark,
  faListCheck,
} from "@fortawesome/free-solid-svg-icons";
import Toast from "../../Global/Toast";
import { apiFetchTiendaNube as apiFetch, safeJsonParse } from "../api/configuracionApi";
import useConfiguracionToast from "../hooks/useConfiguracionToast";
import "./configTiendanube.css";

const IMPORT_BATCH_SIZE = 5;
const IMPORT_TIMEOUT_MS = 90000;


function getUsuario() {
  try {
    return JSON.parse(localStorage.getItem("usuario")) || {};
  } catch {
    return {};
  }
}

function getFrontRedirectUrl() {
  try {
    const origin = window.location.origin;
    const path = window.location.pathname || "/panel/configuracion/tiendanube";
    const safePath = path.includes("/api/") ? "/panel/configuracion/tiendanube" : path;
    return `${origin}${safePath}`;
  } catch {
    return "";
  }
}

function formatearFecha(fecha) {
  if (!fecha) return "-";
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return String(fecha);
  return d.toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

const EstadoBadge = ({ connected }) => {
  return (
    <span className={`tn-badge ${connected ? "tn-badge--ok" : "tn-badge--off"}`}>
      {connected ? "Conectada" : "No conectada"}
    </span>
  );
};

const WebhookBadge = ({ configured }) => {
  return (
    <span className={`tn-badge ${configured ? "tn-badge--ok" : "tn-badge--warn"}`}>
      {configured ? "Configurados" : "Pendientes"}
    </span>
  );
};

function ItemDato({ label, value, full = false }) {
  return (
    <div className={`tn-metaItem ${full ? "tn-metaItem--full" : ""}`}>
      <span className="tn-metaItem__label">{label}</span>
      <span className="tn-metaItem__value">{value || "-"}</span>
    </div>
  );
}

function armarMensajeImportacion(resultado) {
  const categorias = resultado?.categorias || {};
  const productos = resultado?.productos || {};

  const totalErrores =
    Number(categorias.errores || 0) + Number(productos.errores || 0);

  const partes = [
    `Categorías: ${Number(categorias.procesadas || 0)}/${Number(
      categorias.total_remotas || 0
    )} procesadas`,
    `Productos: ${Number(productos.procesados || 0)}/${Number(
      productos.total_remotos || 0
    )} procesados`,
  ];

  if (Number(categorias.creadas || 0) > 0) {
    partes.push(`${Number(categorias.creadas)} categorías nuevas`);
  }
  if (Number(productos.creadas || 0) > 0) {
    partes.push(`${Number(productos.creadas)} productos nuevos`);
  }
  if (Number(categorias.actualizadas || 0) > 0) {
    partes.push(`${Number(categorias.actualizadas)} categorías actualizadas`);
  }
  if (Number(productos.actualizadas || 0) > 0) {
    partes.push(`${Number(productos.actualizadas)} productos actualizados`);
  }
  if (Number(productos.omitidas || 0) > 0) {
    partes.push(`${Number(productos.omitidas)} productos omitidos`);
  }
  if (Number(productos.variantes || 0) > 0) {
    partes.push(`${Number(productos.variantes)} variantes sincronizadas`);
  }
  if (Number(productos.imagenes || 0) > 0) {
    partes.push(`${Number(productos.imagenes)} imágenes importadas`);
  }
  if (totalErrores > 0) {
    partes.push(`${totalErrores} errores`);
  }

  return `Importación terminada. ${partes.join(" · ")}.`;
}

function crearAcumuladorImportacion() {
  return {
    store_id: "",
    categorias: {
      total_remotas: 0,
      procesadas: 0,
      creadas: 0,
      actualizadas: 0,
      errores: 0,
    },
    productos: {
      total_remotos: 0,
      procesados: 0,
      creadas: 0,
      actualizadas: 0,
      omitidas: 0,
      errores: 0,
      variantes: 0,
      variantes_baja: 0,
      imagenes: 0,
      imagenes_errores: 0,
    },
  };
}

function sumarNumero(a, b) {
  return Number(a || 0) + Number(b || 0);
}

function acumularImportacion(actual, lote) {
  const next = {
    ...actual,
    store_id: lote?.store_id || actual.store_id,
    categorias: { ...actual.categorias },
    productos: { ...actual.productos },
  };

  const cat = lote?.categorias || {};
  const prod = lote?.productos || {};

  next.categorias.total_remotas = Math.max(
    Number(next.categorias.total_remotas || 0),
    Number(cat.total_remotas || 0)
  );
  ["procesadas", "creadas", "actualizadas", "errores"].forEach((k) => {
    next.categorias[k] = sumarNumero(next.categorias[k], cat[k]);
  });

  next.productos.total_remotos = Math.max(
    Number(next.productos.total_remotos || 0),
    Number(prod.total_remotos || 0)
  );
  [
    "procesados",
    "creadas",
    "actualizadas",
    "omitidas",
    "errores",
    "variantes",
    "variantes_baja",
    "imagenes",
    "imagenes_errores",
  ].forEach((k) => {
    next.productos[k] = sumarNumero(next.productos[k], prod[k]);
  });

  return next;
}

function ModalInstructivo({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="tn-modal-overlay" onClick={onClose}>
      <div
        className="tn-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tn-modal-title"
      >
        <div className="tn-modal__header">
          <div className="tn-modal__headerIcon">
            <FontAwesomeIcon icon={faListCheck} />
          </div>

          <h2 id="tn-modal-title" className="tn-modal__title">
            Guía de conexión: Tienda Nube
          </h2>

          <button type="button" className="tn-modal__close" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div className="tn-modal__body">
          <p className="tn-modal__intro">
            Seguí esta guía paso a paso para conectar Balto con tu tienda Tienda
            Nube. Una vez completada la integración, todo lo que hagas en Balto
            impactará automáticamente en tu tienda, y viceversa.
          </p>

          <div className="tn-steps">
            <div className="tn-step">
              <div className="tn-step__number">1</div>
              <div className="tn-step__content">
                <h3 className="tn-step__title">Conectar con Tienda Nube</h3>
                <p className="tn-step__description">
                  Presioná el botón <strong>"Conectar con Tienda Nube"</strong> en
                  la sección de Acciones. Esto iniciará el flujo de autorización
                  de Tienda Nube.
                </p>
                <div className="tn-step__note">
                  <FontAwesomeIcon icon={faCircleInfo} />
                  <span>
                    ⚠️ Importante: Vas a cerrar sesión en Balto para conectarte
                    con Tienda Nube.
                  </span>
                </div>
              </div>
            </div>

            <div className="tn-step">
              <div className="tn-step__number">2</div>
              <div className="tn-step__content">
                <h3 className="tn-step__title">
                  Iniciar sesión nuevamente en Balto
                </h3>
                <p className="tn-step__description">
                  Después de autorizar la conexión en Tienda Nube, volvé a iniciar
                  sesión en Balto con tus credenciales habituales.
                </p>
              </div>
            </div>

            <div className="tn-step">
              <div className="tn-step__number">3</div>
              <div className="tn-step__content">
                <h3 className="tn-step__title">Volver a Configuración</h3>
                <p className="tn-step__description">
                  Una vez dentro de Balto, navegá nuevamente a{" "}
                  <strong>Configuración → Tienda Nube</strong>. Vas a ver que el
                  estado de conexión ya aparece como "Conectada".
                </p>
              </div>
            </div>

            <div className="tn-step">
              <div className="tn-step__number">4</div>
              <div className="tn-step__content">
                <h3 className="tn-step__title">Configurar Webhooks</h3>
                <p className="tn-step__description">
                  Presioná el botón <strong>"Configurar webhooks"</strong>. Esto
                  es fundamental para que los eventos de Tienda Nube (como nuevas
                  ventas, actualizaciones de stock, etc.) se sincronicen
                  automáticamente con Balto.
                </p>
              </div>
            </div>

            <div className="tn-step">
              <div className="tn-step__number">5</div>
              <div className="tn-step__content">
                <h3 className="tn-step__title">
                  Importar catálogo existente (opcional)
                </h3>
                <p className="tn-step__description">
                  Si ya tenés productos y categorías cargados en Tienda Nube,
                  presioná <strong>"Obtener todo lo de Tienda Nube"</strong> para
                  importarlos a Balto. Esto te permitirá administrarlos desde el
                  sistema.
                </p>
              </div>
            </div>
          </div>

          <div className="tn-modal__final">
            <div className="tn-modal__finalIcon">
              <FontAwesomeIcon icon={faCheckCircle} />
            </div>
            <div className="tn-modal__finalText">
              <strong>¡Listo! Todo configurado.</strong>
              <p>
                A partir de ahora, podés manejar todo desde Balto. Cualquier
                acción que realices (productos, ventas, stock) se sincronizará
                automáticamente con Tienda Nube, y viceversa. La integración está
                completamente activa.
              </p>
            </div>
          </div>
        </div>

        <div className="tn-modal__footer">
          <button type="button" className="tn-modal__button" onClick={onClose}>
            Entendido, ¡comenzar!
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ConfigTiendaNube() {
  const navigate = useNavigate();
  const usuario = useMemo(() => getUsuario(), []);
  const tenantId =
    usuario?.idTenant ||
    usuario?.id_tenant ||
    usuario?.tenant_id ||
    usuario?.tenant?.idTenant ||
    "";

  const [loading, setLoading] = useState(true);
  const [loadingConnect, setLoadingConnect] = useState(false);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { toast, setToast, mostrarToast } = useConfiguracionToast({
    defaultDuration: 3000,
  });

  const [conexion, setConexion] = useState({
    connected: false,
    store_id: "",
    user_id: "",
    app_id: "",
    app_name: "",
    scope: "",
    webhooks_configured: false,
    updated_at: "",
  });

  const limpiarMensajes = () => {
    setToast(null);
  };

  const abrirModal = () => setIsModalOpen(true);
  const cerrarModal = () => setIsModalOpen(false);

  const cargarEstado = useCallback(async () => {
    setLoading(true);

    if (!tenantId) {
      setLoading(false);
      mostrarToast("error", "No se detectó el idTenant en la sesión del usuario.", 4200);
      return;
    }

    try {
      const res = await apiFetch(
        {
          action: "tiendanube_status",
          idTenant: tenantId,
        },
        { method: "GET" }
      );

      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok) {
        throw new Error(
          data?.mensaje ||
            data?.error ||
            "No se pudo obtener el estado de Tienda Nube."
        );
      }

      if (!data?.exito) {
        throw new Error(
          data?.mensaje || "La API respondió sin éxito al consultar Tienda Nube."
        );
      }

      const c = data?.conexion || {};

      setConexion({
        connected: Boolean(c.connected),
        store_id: c.store_id || "",
        user_id: c.user_id || "",
        app_id: c.app_id || "",
        app_name: c.app_name || "",
        scope: c.scope || "",
        webhooks_configured: Boolean(c.webhooks_configured),
        updated_at: c.updated_at || "",
      });
    } catch (e) {
      mostrarToast("error", e?.message || "Error al cargar la configuración.", 4200);
    } finally {
      setLoading(false);
    }
  }, [tenantId, mostrarToast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tnConnected = params.get("tn_connected");
    const tnError = params.get("tn_error");

    // El callback puede volver con tn_connected=1. Si por cualquier motivo quedó
    // un tn_error viejo en la URL, no debe pisar el mensaje correcto de éxito.
    if (tnConnected === "1") {
      mostrarToast("exito", "Tienda conectada correctamente.");
    } else if (tnConnected === "0" || tnError) {
      mostrarToast(
        "error",
        tnError || "No se pudo completar la conexión con Tienda Nube.",
        5200
      );
    }

    ["tn_connected", "tn_error", "store_id"].forEach((key) => params.delete(key));

    const next = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    window.history.replaceState({}, "", next);

    cargarEstado();
  }, [cargarEstado, mostrarToast]);

  const handleConectar = async () => {
    limpiarMensajes();
    setLoadingConnect(true);

    try {
      if (!tenantId) {
        mostrarToast("error", "No se encontró el tenant. Volvé a iniciar sesión.", 4200);
        return;
      }

      const res = await apiFetch(
        {
          action: "tiendanube_connect_url",
          idTenant: tenantId,
          front_redirect: getFrontRedirectUrl(),
        },
        { method: "GET" }
      );

      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito || !data?.auth_url) {
        throw new Error(
          data?.mensaje ||
            data?.error ||
            "No se pudo generar la URL de conexión con Tienda Nube."
        );
      }

      window.location.href = data.auth_url;
    } catch (e) {
      mostrarToast("error", e?.message || "No se pudo iniciar la conexión.", 4200);
    } finally {
      setLoadingConnect(false);
    }
  };

  const handleConfigurarWebhooks = async () => {
    limpiarMensajes();
    setLoadingWebhook(true);

    try {
      if (!tenantId) {
        mostrarToast("error", "No se encontró el tenant. Volvé a iniciar sesión.", 4200);
        return;
      }

      const res = await apiFetch(
        {
          action: "tiendanube_configurar_webhooks",
        },
        {
          method: "POST",
          body: JSON.stringify({
            idTenant: tenantId,
          }),
        }
      );

      const txt = await res.text();
      const data = safeJsonParse(txt);

      if (!res.ok || !data?.exito) {
        throw new Error(
          data?.mensaje || data?.error || "No se pudieron configurar los webhooks."
        );
      }

      mostrarToast("exito", data?.mensaje || "Webhooks configurados correctamente.");
      await cargarEstado();
    } catch (e) {
      mostrarToast("error", e?.message || "Error al configurar webhooks.", 4200);
    } finally {
      setLoadingWebhook(false);
    }
  };

  const handleImportarCatalogo = async () => {
    limpiarMensajes();
    setLoadingImport(true);
    setImportProgress({
      page: 1,
      procesados: 0,
      totalEstimado: 0,
      mensaje: "Preparando importación segura por lotes...",
    });

    try {
      if (!tenantId) {
        mostrarToast("error", "No se encontró el tenant. Volvé a iniciar sesión.", 4200);
        return;
      }

      let page = 1;
      let acumulado = crearAcumuladorImportacion();

      while (true) {
        setImportProgress((prev) => ({
          ...prev,
          page,
          mensaje: `Importando lote ${page}. Balto lo hace por partes para evitar cortes de conexión.`,
        }));

        const body = {
          idTenant: tenantId,
          modo_lote: 1,
          page,
          per_page: IMPORT_BATCH_SIZE,
          importar_imagenes: 1,
          max_imagenes_por_producto: 1,
        };

        const res = await apiFetch(
          {
            action: "tiendanube_importar_catalogo",
            idTenant: tenantId,
            modo_lote: 1,
            page,
            per_page: IMPORT_BATCH_SIZE,
            importar_imagenes: 1,
            max_imagenes_por_producto: 1,
          },
          {
            method: "POST",
            body: JSON.stringify(body),
            timeoutMs: IMPORT_TIMEOUT_MS,
            dispatchUnauthorized: false,
          }
        );

        const txt = await res.text();
        const data = safeJsonParse(txt);

        if (!res.ok || !data?.exito) {
          throw new Error(
            data?.mensaje ||
              data?.error ||
              (txt ? `La API no devolvió JSON válido. Respuesta: ${txt.slice(0, 220)}` : "No se pudo importar el catálogo desde Tienda Nube.")
          );
        }

        const resultadoLote = data?.resultado || {};
        acumulado = acumularImportacion(acumulado, resultadoLote);

        setImportProgress({
          page,
          procesados: Number(acumulado.productos.procesados || 0),
          totalEstimado: Number(acumulado.productos.total_remotos || 0),
          mensaje: `Productos importados: ${Number(acumulado.productos.procesados || 0)}. Último lote: ${Number(resultadoLote?.productos?.procesados || 0)} productos.`,
        });

        if (!resultadoLote?.hay_mas) {
          break;
        }

        page = Number(resultadoLote?.siguiente_pagina || page + 1);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }

      mostrarToast("exito", armarMensajeImportacion(acumulado), 6500);
      await cargarEstado();
    } catch (e) {
      const mensaje = e?.name === "AbortError"
        ? "La importación tardó demasiado en este lote. Probá de nuevo: lo ya importado queda guardado y Balto no te va a cerrar la sesión por este corte."
        : e?.message || "Error al importar productos y categorías.";
      mostrarToast("error", mensaje, 6500);
    } finally {
      setLoadingImport(false);
      setImportProgress(null);
    }
  };

  const progreso = useMemo(() => {
    const total = 2;
    let hechos = 0;
    if (conexion.connected) hechos += 1;
    if (conexion.webhooks_configured) hechos += 1;
    return Math.round((hechos / total) * 100);
  }, [conexion.connected, conexion.webhooks_configured]);

  if (loading) {
    return (
      <>
        {toast && (
          <Toast
            key={toast.key}
            tipo={toast.tipo}
            mensaje={toast.mensaje}
            duracion={toast.duracion}
            onClose={() => setToast(null)}
          />
        )}

        <section className="tn-page">
        <div className="tn-hero">
          <div className="tn-hero__icon">
            <FontAwesomeIcon icon={faStore} />
          </div>

          <div className="tn-hero__content">
            <div className="tn-hero__eyebrow">Integración externa</div>
            <h1 className="tn-title">Configuración de Tienda Nube</h1>
            <p className="tn-subtitle">Cargando configuración...</p>
          </div>

          <div className="tn-hero__side">
            <button
              type="button"
              className="mov-btn mov-btn--primary"
              onClick={() => navigate("/panel/configuracion")}
            >
              <FontAwesomeIcon icon={faArrowLeft} />
              <span>Volver</span>
            </button>
          </div>
        </div>
        </section>
      </>
    );
  }

  return (
    <>
      {toast && (
        <Toast
          key={toast.key}
          tipo={toast.tipo}
          mensaje={toast.mensaje}
          duracion={toast.duracion}
          onClose={() => setToast(null)}
        />
      )}

      <section className="tn-page">
      <ModalInstructivo isOpen={isModalOpen} onClose={cerrarModal} />

      <div className="tn-topbar" />

      <div className="tn-hero">
        <div className="tn-hero__icon">
          <FontAwesomeIcon icon={faStore} />
        </div>

        <div className="tn-hero__content">
          <div className="tn-hero__eyebrow">Integración externa</div>
          <h1 className="tn-title">Configuración de Tienda Nube</h1>
          <p className="tn-subtitle">
            Conectá Balto con tu tienda para sincronizar ventas, pedidos, clientes
            y automatizaciones futuras.
          </p>
        </div>

        <div className="tn-hero__side">
          <div className="tn-hero__progress">
            <div className="tn-hero__progressLabel">Progreso</div>
            <div className="tn-hero__progressValue">{progreso}%</div>
          </div>

          <button
            type="button"
            className="mov-btn mov-btn--primary"
            onClick={() => navigate("/panel/configuracion")}
          >
            <FontAwesomeIcon icon={faArrowLeft} />
            <span>Volver</span>
          </button>
        </div>
      </div>

      <div className="tn-contentScroll">
      <div className="tn-metaGrid">
        <div className="tn-metaCard">
          <div className="tn-metaCard__top">
            <div className="tn-metaCard__icon">
              <FontAwesomeIcon icon={faCircleInfo} />
            </div>

            <div className="tn-metaCard__head">
              <h2>Estado general</h2>
              <p>Consultá el estado actual de la integración y su progreso.</p>
            </div>
          </div>

          <div className="tn-metaCard__body">
            <ItemDato label="Tenant" value={tenantId || "-"} />
            <ItemDato
              label="Estado de conexión"
              value={<EstadoBadge connected={conexion.connected} />}
            />
            <ItemDato
              label="Webhooks"
              value={<WebhookBadge configured={conexion.webhooks_configured} />}
            />
            <ItemDato
              label="Última actualización"
              value={formatearFecha(conexion.updated_at)}
            />
          </div>
        </div>

        <div className="tn-metaCard">
          <div className="tn-metaCard__top">
            <div className="tn-metaCard__icon">
              <FontAwesomeIcon icon={faIdBadge} />
            </div>

            <div className="tn-metaCard__head">
              <h2>Datos de la conexión</h2>
              <p>Visualizá los identificadores técnicos y datos de la app.</p>
            </div>
          </div>

          <div className="tn-metaCard__body">
            <ItemDato label="Store ID" value={conexion.store_id} />
            <ItemDato label="User ID" value={conexion.user_id} />
            <ItemDato label="App ID" value={conexion.app_id} />
            <ItemDato label="Nombre de la app" value={conexion.app_name} />
            <ItemDato label="Scopes" value={conexion.scope || "-"} full />
          </div>
        </div>

        <div className="tn-metaCard">
          <div className="tn-metaCard__top">
            <div className="tn-metaCard__icon">
              <FontAwesomeIcon icon={faBolt} />
            </div>

            <div className="tn-metaCard__head">
              <h2>Acciones</h2>
              <p>Ejecutá las acciones principales para dejar la integración lista.</p>
            </div>

            <button
              type="button"
              className="tn-infoButton"
              onClick={abrirModal}
              title="Ver guía de conexión"
            >
              <FontAwesomeIcon icon={faCircleInfo} />
              <span>Guía</span>
            </button>
          </div>

          <div className="tn-metaCard__body tn-metaCard__body--stack">
            <button
              type="button"
              className="tn-actionRow"
              onClick={handleConectar}
              disabled={!tenantId || loadingConnect}
            >
              <div className="tn-actionRow__text">
                <span className="tn-actionRow__title">
                  {loadingConnect ? "Redirigiendo..." : "Conectar con Tienda Nube"}
                </span>
                <span className="tn-actionRow__desc">
                  Inicia el flujo OAuth y autoriza la app.
                </span>
              </div>
              <FontAwesomeIcon icon={faChevronRight} />
            </button>

            <button
              type="button"
              className="tn-actionRow"
              onClick={handleConfigurarWebhooks}
              disabled={!tenantId || !conexion.connected || loadingWebhook}
            >
              <div className="tn-actionRow__text">
                <span className="tn-actionRow__title">
                  {loadingWebhook ? "Configurando..." : "Configurar webhooks"}
                </span>
                <span className="tn-actionRow__desc">
                  Registra los eventos para automatizar la integración.
                </span>
              </div>
              <FontAwesomeIcon icon={faChevronRight} />
            </button>

            <button
              type="button"
              className="tn-actionRow"
              onClick={handleImportarCatalogo}
              disabled={!tenantId || !conexion.connected || loadingImport}
            >
              <div className="tn-actionRow__text">
                <span className="tn-actionRow__title">
                  {loadingImport
                    ? "Obteniendo catálogo por lotes..."
                    : "Obtener todo lo de Tienda Nube"}
                </span>
                <span className="tn-actionRow__desc">
                  Importa las categorías y productos que ya existen en la tienda sin cortar la sesión.
                </span>
              </div>
              <FontAwesomeIcon icon={loadingImport ? faPlug : faDownload} />
            </button>

            {loadingImport && importProgress && (
              <div className="tn-importProgress" role="status" aria-live="polite">
                <div className="tn-importProgress__top">
                  <span>Importación en curso</span>
                  <strong>Lote {importProgress.page}</strong>
                </div>
                <div className="tn-importProgress__bar">
                  <span />
                </div>
                <p>{importProgress.mensaje}</p>
                <small>
                  Procesados: {Number(importProgress.procesados || 0)}
                  {Number(importProgress.totalEstimado || 0) > 0
                    ? ` / ${Number(importProgress.totalEstimado || 0)}`
                    : ""}
                </small>
              </div>
            )}
          </div>
        </div>

        <div className="tn-metaCard">
          <div className="tn-metaCard__top">
            <div className="tn-metaCard__icon">
              <FontAwesomeIcon icon={faShieldHalved} />
            </div>

            <div className="tn-metaCard__head">
              <h2>Checklist visual</h2>
              <p>Verificá rápidamente qué parte ya quedó lista y qué falta.</p>
            </div>
          </div>

          <div className="tn-metaCard__body tn-metaCard__body--stack">
            <div className={`tn-statusRow ${conexion.connected ? "ok" : "warn"}`}>
              <div className="tn-statusRow__left">
                <div className="tn-statusRow__icon">
                  <FontAwesomeIcon
                    icon={conexion.connected ? faCheckCircle : faTriangleExclamation}
                  />
                </div>
                <div>
                  <div className="tn-statusRow__title">App autorizada</div>
                  <div className="tn-statusRow__desc">
                    {conexion.connected
                      ? "La tienda autorizó correctamente el acceso."
                      : "Falta completar la autorización desde Tienda Nube."}
                  </div>
                </div>
              </div>
              <span
                className={`tn-badge ${
                  conexion.connected ? "tn-badge--ok" : "tn-badge--warn"
                }`}
              >
                {conexion.connected ? "Lista" : "Pendiente"}
              </span>
            </div>

            <div
              className={`tn-statusRow ${
                conexion.webhooks_configured ? "ok" : "warn"
              }`}
            >
              <div className="tn-statusRow__left">
                <div className="tn-statusRow__icon">
                  <FontAwesomeIcon
                    icon={
                      conexion.webhooks_configured
                        ? faCheckCircle
                        : faTriangleExclamation
                    }
                  />
                </div>
                <div>
                  <div className="tn-statusRow__title">Webhooks registrados</div>
                  <div className="tn-statusRow__desc">
                    {conexion.webhooks_configured
                      ? "Los eventos ya quedaron configurados."
                      : "Falta registrar los webhooks necesarios para automatizar."}
                  </div>
                </div>
              </div>
              <span
                className={`tn-badge ${
                  conexion.webhooks_configured ? "tn-badge--ok" : "tn-badge--warn"
                }`}
              >
                {conexion.webhooks_configured ? "Listos" : "Pendientes"}
              </span>
            </div>
          </div>
        </div>
        </div>
      </div>
      </section>
    </>
  );
}