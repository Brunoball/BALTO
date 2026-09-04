// src/components/Configuracion/configuracion.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import logoTiendaNube from "../../imagenes/logo_tienda_nube.png";
import "./configuracion.css";
import "../Global/Global_css/Global_oscuro.css";
import Toast from "../Global/Toast";
import { apiFetch, safeJsonParse } from "./api/configuracionApi";
import useConfiguracionToast from "./hooks/useConfiguracionToast";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronRight,
  faCalendarDays,
  faUsersGear,
  faFileInvoiceDollar,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import { useDateRange } from "../../context/DateRangeContext";
import {
  DEMO_BLOCK_MESSAGE,
  getBaltoUsuario,
  isBaltoDemoMode,
} from "../../utils/demoMode";

const DEMO_ADVANCED_MESSAGE = DEMO_BLOCK_MESSAGE;

function StatusPill({ type = "neutral", children }) {
  return <span className={`cfg-status cfg-status--${type}`}>{children}</span>;
}

function CardVisual({ children }) {
  return <div className="cfg-cardLogoBox">{children}</div>;
}

function CalendarioIcon() {
  return (
    <div className="cfg-cardLogo cfg-cardLogo--icon">
      <FontAwesomeIcon icon={faCalendarDays} />
    </div>
  );
}

function labelModo(config = {}) {
  if (config?.modo === "dias_atras") {
    const dias = Math.max(1, Number(config?.dias_atras || 10));
    return `Últimos ${dias} días`;
  }

  return "Mes completo";
}

export default function Configuracion() {
  const navigate = useNavigate();
  const usuario = useMemo(() => getBaltoUsuario() || {}, []);
  const tenantId =
    usuario?.idTenant ||
    usuario?.id_tenant ||
    usuario?.tenant_id ||
    usuario?.tenant?.idTenant ||
    "";

  const esPlanDemo = isBaltoDemoMode(usuario);
  const { toast, setToast, mostrarToast } = useConfiguracionToast({
    defaultDuration: 3800,
  });

  // ── estado Tienda Nube ─────────────────────────────────────────────────
  const [tiendanube, setTiendanube] = useState({
    connected: false,
    webhooks_configured: false,
    store_id: "",
  });

  const [datosLegales, setDatosLegales] = useState({
    razon_social: "",
    nombre_fantasia: "",
    cuit: "",
    condicion_iva: "",
  });

  // ── config de calendario (leída del contexto global) ──────────────────
  const { calendarConfig, configLoaded } = useDateRange();

  const cargarResumen = useCallback(async () => {
    const tareas = [];

    if (tenantId) {
      tareas.push(
        apiFetch({ action: "tiendanube_status", idTenant: tenantId })
          .then((res) => res.text())
          .then((txt) => safeJsonParse(txt))
          .then((data) => {
            const c = data?.conexion || {};
            setTiendanube({
              connected: Boolean(c.connected),
              webhooks_configured: Boolean(c.webhooks_configured),
              store_id: c.store_id || "",
            });
          })
          .catch(() => {})
      );
    }

    tareas.push(
      apiFetch({ action: "config_facturacion_get" })
        .then((res) => res.text())
        .then((txt) => safeJsonParse(txt))
        .then((data) => {
          const c = data?.config || {};
          setDatosLegales({
            razon_social: c.razon_social || "",
            nombre_fantasia: c.nombre_fantasia || "",
            cuit: c.cuit || "",
            condicion_iva: c.condicion_iva || "",
          });
        })
        .catch(() => {})
    );

    await Promise.allSettled(tareas);
  }, [tenantId]);

  useEffect(() => {
    cargarResumen();
  }, [cargarResumen]);

  // ── cards ──────────────────────────────────────────────────────────────
  const cards = useMemo(() => {
    // Card Tienda Nube
    const tiendaNubeEstado = tiendanube.connected
      ? tiendanube.webhooks_configured
        ? { text: "Finalizada", type: "success" }
        : { text: "Parcial",    type: "warning" }
      : { text: "Sin conexión", type: "pending" };

    // Card Calendario
    const modoLabel = configLoaded ? labelModo(calendarConfig) : "Cargando…";
    const calendarioEstado = configLoaded
      ? { text: "Configurado", type: "success" }
      : { text: "Cargando",   type: "pending" };

    const tiendaNubeCard = {
      id: "tiendanube",
      title: "Tienda Nube",
      description:
        "Conectá tu tienda y configurá la sincronización con una interfaz simple.",
      route: "/panel/configuracion/tiendanube",
      demoBlocked: esPlanDemo,
      demoMessage: DEMO_ADVANCED_MESSAGE,
      status: esPlanDemo ? { text: "Bloqueado demo", type: "warning" } : tiendaNubeEstado,
      metaTop: tiendanube.connected ? "Conexión activa" : "Sin conexión",
      metaBottom: tiendanube.store_id
        ? `Store ID: ${tiendanube.store_id}`
        : "Todavía no configurado",
      icon: (
        <img
          src={logoTiendaNube}
          alt="Logo Tienda Nube"
          className="cfg-cardLogo"
        />
      ),
    };

    return [
      tiendaNubeCard,
      {
        id: "usuarios",
        title: "Usuarios del sistema",
        description: "Creá usuarios y asigná roles para limitar el acceso a cada empleado.",
        route: "/panel/configuracion/usuarios",
        demoBlocked: esPlanDemo,
        demoMessage: DEMO_ADVANCED_MESSAGE,
        status: esPlanDemo
          ? { text: "Bloqueado demo", type: "warning" }
          : { text: "Administrable", type: "success" },
        metaTop: "Roles activos",
        metaBottom: "Administrador / Empleado básico",
        icon: (
          <div className="cfg-cardLogo cfg-cardLogo--icon">
            <FontAwesomeIcon icon={faUsersGear} />
          </div>
        ),
      },
      {
        id: "datos-legales",
        title: "Datos legales",
        description:
          "Actualizá razón social, CUIT, condición fiscal, domicilio y datos de facturación.",
        route: "/panel/configuracion/datos-legales",
        demoBlocked: esPlanDemo,
        demoMessage: DEMO_ADVANCED_MESSAGE,
        status: esPlanDemo ? { text: "Bloqueado demo", type: "warning" } : (datosLegales.razon_social ? { text: "Configurado", type: "success" } : { text: "Pendiente", type: "pending" }),
        metaTop: datosLegales.razon_social || "Sin razón social",
        metaBottom: datosLegales.cuit ? `CUIT: ${datosLegales.cuit}` : "CUIT sin cargar",
        icon: (
          <div className="cfg-cardLogo cfg-cardLogo--icon">
            <FontAwesomeIcon icon={faFileInvoiceDollar} />
          </div>
        ),
      },

      {
        id: "saldos-iniciales",
        title: "Saldos iniciales",
        description: "Cargá la apertura de caja, bancos, billeteras, cheques y cuentas corrientes.",
        route: "/panel/configuracion/saldos-iniciales",
        demoBlocked: esPlanDemo,
        demoMessage: DEMO_ADVANCED_MESSAGE,
        status: esPlanDemo
          ? { text: "Bloqueado demo", type: "warning" }
          : { text: "Configurable", type: "success" },
        metaTop: "Puesta en marcha",
        metaBottom: "Caja · Cheques · Cuentas corrientes",
        icon: (
          <div className="cfg-cardLogo cfg-cardLogo--icon">
            <FontAwesomeIcon icon={faWallet} />
          </div>
        ),
      },
      {
        id: "calendario",
        title: "Calendario global",
        description:
          "Elegí cómo se carga el rango de fechas por defecto en todas las vistas.",
        route: "/panel/configuracion/calendario",
        status: calendarioEstado,
        metaTop:    "Modo activo",
        metaBottom: modoLabel,
        icon: <CalendarioIcon />,
      },
    ];
  }, [tiendanube, datosLegales, calendarConfig, configLoaded, esPlanDemo]);

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

      <section className="cfg-page">
      <div className="cfg-contentScroll">

        <div className="cfg-cards">
        {cards.map((card) => (
          <div key={card.id} className="cfg-cardWrap">
            <button
              type="button"
              className={`cfg-card ${card.demoBlocked ? "is-demo-locked" : ""}`}
              aria-disabled={card.demoBlocked ? "true" : undefined}
              title={card.demoBlocked ? "Bloqueado en modo demo" : undefined}
              onClick={() => {
                if (card.demoBlocked) {
                  mostrarToast(
                    "advertencia",
                    card.demoMessage || DEMO_BLOCK_MESSAGE,
                    4600
                  );
                  return;
                }
                navigate(card.route);
              }}
            >
              <div className="cfg-cardMain">
                <CardVisual>{card.icon}</CardVisual>

                <div className="cfg-cardBody">
                  <div className="cfg-cardHeader">
                    <h2>{card.title}</h2>
                    <StatusPill type={card.status.type}>
                      {card.status.text}
                    </StatusPill>
                  </div>
                  <p className="cfg-cardDescription">{card.description}</p>
                </div>
              </div>

              <div className="cfg-cardFooter">
                <div className="cfg-cardFooterLeft">
                  <div className="cfg-cardMetaLine">
                    <span className="cfg-cardMetaLabel">Estado</span>
                    <span className="cfg-cardMetaValue">{card.metaTop}</span>
                  </div>
                  <div className="cfg-cardMetaLine">
                    <span className="cfg-cardMetaLabel">Detalle</span>
                    <span className="cfg-cardMetaValue">{card.metaBottom}</span>
                  </div>
                </div>
                <div className="cfg-cardFooterRight">
                  <span className="cfg-cardArrow">
                    <FontAwesomeIcon icon={faChevronRight} />
                  </span>
                </div>
              </div>
            </button>
          </div>
        ))}
        </div>
      </div>
      </section>
    </>
  );
}
