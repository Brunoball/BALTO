import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  memo,
} from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import LogoBalto from "../../imagenes/Logo_Blanco_Principal.png";

import {
  faChartLine,
  faMoneyBillTrendUp,
  faWallet,
  faUsers,
  faSignOutAlt,
  faUserCircle,
  faMoon,
  faSun,
  faBars,
  faXmark,
  faGear,
  faMoneyCheckDollar,
  faBookOpen,
} from "@fortawesome/free-solid-svg-icons";

import "./principal.css";
import ModalPerfil from "../Perfil/ModalPerfil";
import {
  actualizarTemaBackend,
  cerrarSesionBackend,
  obtenerTenantLogo,
} from "./api/principalApi";
import usePrincipalIdleLogout from "./hooks/usePrincipalIdleLogout";
import usePrincipalSessionGuard from "./hooks/usePrincipalSessionGuard";
import { clearClientSession, getSessionKey, redirectToCentralAccess } from "../../session/sessionClient";
import { prefetchRoute } from "./utils/principalPrefetch";
import {
  applyTheme,
  getLogoToneFromImageSrc,
  getModuleKeyByPath,
  normalizePlanId,
  normalizePlanNivel,
  normalizeRol,
  normalizeTema,
  planAllowsNavKey,
  safeJsonParse,
  setLastActivityNow,
  slugify,
} from "./utils/principalUtils";

/* =========================
   Modal cierre sesión
========================= */
const ConfirmLogoutModal = memo(function ConfirmLogoutModal({
  open,
  onClose,
  onConfirm,
  loading = false,
}) {
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    cancelBtnRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const stop = (e) => e.stopPropagation();

  return (
    <div className="pp-modal-overlay" role="dialog" aria-modal="true">
      <div className="pp-modal" onMouseDown={stop}>
        <div className="pp-modal__icon">
          <FontAwesomeIcon icon={faSignOutAlt} />
        </div>

        <h3 className="pp-modal__title">Confirmar cierre de sesión</h3>

        <p className="pp-modal__text">
          ¿Estás seguro de que deseas cerrar la sesión?
        </p>

        <div className="pp-modal__actions">
          <button
            className="pp-btn pp-btn--ghost"
            onClick={onClose}
            ref={cancelBtnRef}
            disabled={loading}
          >
            Cancelar
          </button>

          <button
            className="pp-btn pp-btn--danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Cerrando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
});

/* =========================
   Helpers
========================= */
function pickIcon(label) {
  const s = String(label ?? "").toLowerCase();

  if (s.includes("cheques")) return faMoneyCheckDollar;
  if (s.includes("movimientos")) return faMoneyBillTrendUp;
  if (s.includes("flujo")) return faWallet;
  if (s.includes("cuentas")) return faUsers;
  if (s.includes("analisis")) return faChartLine;
  if (s.includes("config")) return faGear;
  if (s.includes("servicios")) return faGear;
  if (s.includes("contabilidad")) return faBookOpen;

  return faChartLine;
}

/* =========================
   Outlet memoizado
========================= */
const StableOutlet = memo(function StableOutlet() {
  return <Outlet />;
});

/* =========================
   COMPONENTE
========================= */
const Principal = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [usuario, setUsuario] = useState(null);
  const [tema, setTema] = useState("claro");

  const [tenantLogoIconoSrc, setTenantLogoIconoSrc] = useState("");
  const [tenantLogoIconoLoaded, setTenantLogoIconoLoaded] = useState(false);
  const [tenantLogoIconoTone, setTenantLogoIconoTone] = useState("dark");

  const [tenantLogoPrincipalSrc, setTenantLogoPrincipalSrc] = useState("");
  const [tenantLogoPrincipalLoaded, setTenantLogoPrincipalLoaded] =
    useState(false);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showPerfilModal, setShowPerfilModal] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);

  const [openMovSub, setOpenMovSub] = useState(false);
  const [openCCSub, setOpenCCSub] = useState(false);
  const [openChequesSub, setOpenChequesSub] = useState(false);
  const [openServiciosSub, setOpenServiciosSub] = useState(false);
  const [openContabilidadSub, setOpenContabilidadSub] = useState(false);

  const closingRef = useRef(false);
  const [closingUI, setClosingUI] = useState(false);

  const idleTimerRef = useRef(null);

  const tenantLogoIconoObjectUrlRef = useRef("");
  const tenantLogoPrincipalObjectUrlRef = useRef("");

  const tenantLogoIconoDbRef = useRef("");
  const tenantLogoPrincipalDbRef = useRef("");

  const DEFAULT_SUBROUTES = useMemo(
    () => ({
      movimientos: "/panel/movimientos",
      "cuentas-corrientes": "/panel/cuentas-corrientes/clientes",
      cheques: "/panel/cheques/cartera",
      servicios: "/panel/servicios",
      contabilidad: "/panel/contabilidad/iva-ventas",
    }),
    []
  );

  const revokeTenantLogoIconoObjectUrl = useCallback(() => {
    try {
      if (tenantLogoIconoObjectUrlRef.current) {
        URL.revokeObjectURL(tenantLogoIconoObjectUrlRef.current);
        tenantLogoIconoObjectUrlRef.current = "";
      }
    } catch {}
  }, []);

  const revokeTenantLogoPrincipalObjectUrl = useCallback(() => {
    try {
      if (tenantLogoPrincipalObjectUrlRef.current) {
        URL.revokeObjectURL(tenantLogoPrincipalObjectUrlRef.current);
        tenantLogoPrincipalObjectUrlRef.current = "";
      }
    } catch {}
  }, []);

  const loadSingleLogo = useCallback(
    async ({ tipo, setSrc, setLoaded, objectUrlRef, revokeFn, dbRef }) => {
      try {
        const res = await obtenerTenantLogo(tipo);
        if (!res) return;

        if (res.status === 401) {
          return;
        }

        if (res.status === 204 || res.status === 404 || res.status === 500) {
          if (objectUrlRef.current) {
            revokeFn();
            setSrc("");
            setLoaded(false);
            dbRef.current = "";
          }
          return;
        }

        if (!res.ok) return;

        const contentType = String(
          res.headers.get("content-type") || ""
        ).toLowerCase();

        if (!contentType.startsWith("image/")) return;

        const blob = await res.blob();
        if (!blob || !blob.size) return;

        revokeFn();

        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        dbRef.current = tipo;

        setSrc(objectUrl);
        setLoaded(true);
      } catch {
        // No limpiar en caso de error
      }
    },
    []
  );

  const loadTenantLogos = useCallback(async () => {
    await Promise.all([
      loadSingleLogo({
        tipo: "icono",
        setSrc: setTenantLogoIconoSrc,
        setLoaded: setTenantLogoIconoLoaded,
        objectUrlRef: tenantLogoIconoObjectUrlRef,
        revokeFn: revokeTenantLogoIconoObjectUrl,
        dbRef: tenantLogoIconoDbRef,
      }),
      loadSingleLogo({
        tipo: "principal",
        setSrc: setTenantLogoPrincipalSrc,
        setLoaded: setTenantLogoPrincipalLoaded,
        objectUrlRef: tenantLogoPrincipalObjectUrlRef,
        revokeFn: revokeTenantLogoPrincipalObjectUrl,
        dbRef: tenantLogoPrincipalDbRef,
      }),
    ]);
  }, [
    loadSingleLogo,
    revokeTenantLogoIconoObjectUrl,
    revokeTenantLogoPrincipalObjectUrl,
  ]);

  const doLogout = useCallback(
    async ({ silent = false } = {}) => {
      if (closingRef.current) return;

      closingRef.current = true;

      if (!silent) setClosingUI(true);

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      const sessionKey = getSessionKey();

      try {
        if (sessionKey) {
          const r = await cerrarSesionBackend();

          if (!r.ok && r.status !== 401 && r.status !== 403) {
            const txt = await r.text().catch(() => "");
            console.warn("Logout backend falló:", r.status, txt);
          }
        }
      } catch (e) {
        console.warn("Error llamando logout:", e);
      } finally {
        revokeTenantLogoIconoObjectUrl();
        revokeTenantLogoPrincipalObjectUrl();

        setTenantLogoIconoSrc("");
        setTenantLogoIconoLoaded(false);
        setTenantLogoIconoTone("dark");
        setTenantLogoPrincipalSrc("");
        setTenantLogoPrincipalLoaded(false);

        tenantLogoIconoDbRef.current = "";
        tenantLogoPrincipalDbRef.current = "";

        clearClientSession();

        setShowLogoutModal(false);
        setDrawerOpen(false);
        setOpenMovSub(false);
        setOpenCCSub(false);
        setOpenChequesSub(false);
        setOpenContabilidadSub(false);

        if (!silent) {
          setClosingUI(false);
        }

        closingRef.current = false;

        redirectToCentralAccess();
      }
    },
    [
      revokeTenantLogoIconoObjectUrl,
      revokeTenantLogoPrincipalObjectUrl,
    ]
  );

  usePrincipalSessionGuard(doLogout);

  useEffect(() => {
    const sk = getSessionKey();

    if (!sk) {
      clearClientSession();
      redirectToCentralAccess();
      return;
    }

    try {
      const u = JSON.parse(localStorage.getItem("usuario"));

      if (u) {
        u.rol = normalizeRol(u.rol);
        u.idPlan = normalizePlanId(
          u.idPlan ?? u.id_plan ?? u.plan_id ?? u.plan_nivel ?? 1,
          u.plan_nombre ?? u.plan ?? u.nombre_plan ?? ""
        );
        u.plan_nivel = normalizePlanNivel(u.plan_nivel ?? u.idPlan ?? 1);
        if (u.idPlan === 3) u.plan_nivel = 3;
        u.tema = normalizeTema(u.tema ?? "claro");
      }

      setUsuario(u || null);

      const t = normalizeTema(u?.tema ?? "claro");

      setTema(t);
      applyTheme(t);
    } catch {
      setUsuario(null);
      setTema("claro");
      applyTheme("claro");
    }

    setLastActivityNow();

  }, [doLogout]);

  useEffect(() => {
    loadTenantLogos();
  }, [loadTenantLogos]);

  useEffect(() => {
    let isMounted = true;

    if (!tenantLogoIconoLoaded || !tenantLogoIconoSrc) {
      setTenantLogoIconoTone("dark");
      return () => {
        isMounted = false;
      };
    }

    getLogoToneFromImageSrc(tenantLogoIconoSrc).then((tone) => {
      if (isMounted) setTenantLogoIconoTone(tone);
    });

    return () => {
      isMounted = false;
    };
  }, [tenantLogoIconoLoaded, tenantLogoIconoSrc]);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      revokeTenantLogoIconoObjectUrl();
      revokeTenantLogoPrincipalObjectUrl();
    };
  }, [revokeTenantLogoIconoObjectUrl, revokeTenantLogoPrincipalObjectUrl]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;

    const prev = document.body.style.overflow;

    document.body.classList.add("pp-lockScroll");
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("pp-lockScroll");
    };
  }, [drawerOpen]);

  usePrincipalIdleLogout({ doLogout, idleTimerRef });

  const rolUsuario = normalizeRol(
    usuario?.rol ?? usuario?.tipo_rol,
    usuario?.id_rol
  );

  const planIdUsuario = normalizePlanId(
    usuario?.idPlan ?? usuario?.id_plan ?? usuario?.plan_id ?? usuario?.plan_nivel ?? 1,
    usuario?.plan_nombre ?? usuario?.plan ?? usuario?.nombre_plan ?? ""
  );

  const puedeVerConfiguracion = rolUsuario === "admin";

  useEffect(() => {
    if (!usuario) return;

    const moduloActual = getModuleKeyByPath(location.pathname);

    if (!planAllowsNavKey(planIdUsuario, moduloActual)) {
      navigate("/panel/dashboard", { replace: true });
    }
  }, [usuario, planIdUsuario, location.pathname, navigate]);

  useEffect(() => {
    if (!usuario) return;
    if (rolUsuario === "admin") return;

    const rutasPermitidas = [
      "/panel/dashboard",
      "/panel/movimientos",
      "/panel/ventas",
      "/panel/recibos",
      "/panel/flujo-de-caja",
    ];

    const permitido = rutasPermitidas.some(
      (ruta) =>
        location.pathname === ruta || location.pathname.startsWith(ruta + "/")
    );

    if (!permitido) {
      navigate("/panel/dashboard", { replace: true });
    }
  }, [usuario, rolUsuario, location.pathname, navigate]);

  const navItems = useMemo(() => {
    const base = [
      { label: "Dashboard", ruta: "/panel/dashboard" },
      {
        label: "Movimientos",
        ruta: "/panel/movimientos",
        children: [
          { label: "Ventas", ruta: "/panel/ventas" },
          { label: "Compras", ruta: "/panel/compras" },
          { label: "Recibo", ruta: "/panel/recibos" },
          { label: "Orden de Pago", ruta: "/panel/OrdenesPago" },
          { label: "Otros Ingresos", ruta: "/panel/Otrosingresos" },
          { label: "Otros Egresos", ruta: "/panel/Otrosegresos" },
          { label: "Presupuestos", ruta: "/panel/presupuesto" },

        ],
      },
      { label: "Flujo de Caja", ruta: "/panel/flujo-de-caja" },
      {
        label: "Cuentas Corrientes",
        ruta: "/panel/cuentas-corrientes",
        children: [
          { label: "Clientes", ruta: "/panel/cuentas-corrientes/clientes" },
          {
            label: "Proveedores",
            ruta: "/panel/cuentas-corrientes/proveedores",
          },
        ],
      },
      {
        label: "Servicios",
        ruta: "/panel/servicios",
        children: [
          { label: "Servicios", ruta: "/panel/servicios" },
          {
            label: "Inventario e insumos",
            ruta: "/panel/servicios?seccion=inventario",
          },
        ],
      },
      {
        label: "Contabilidad",
        ruta: "/panel/contabilidad",
        children: [
          { label: "IVA Ventas", ruta: "/panel/contabilidad/iva-ventas" },
          { label: "IVA Compras", ruta: "/panel/contabilidad/iva-compras" },
        ],
      },
      {
        label: "Cheques",
        ruta: "/panel/cheques",
        children: [
          { label: "Cheques en Cartera", ruta: "/panel/cheques/cartera" },
          { label: "Flujo de Cheques", ruta: "/panel/cheques/flujo" },
          {
            label: "Echeqs en Cartera",
            ruta: "/panel/cheques/echeqs-cartera",
          },
          { label: "Flujo de Echeqs", ruta: "/panel/cheques/flujo-echeqs" },
        ],
      },
      { label: "Análisis Financiero", ruta: "/panel/analisis-financiero" },
    ].map((x) => ({
      key: slugify(x.label),
      label: x.label,
      icon: pickIcon(x.label),
      ruta: x.ruta || `/panel/${slugify(x.label)}`,
      children: x.children || null,
    }));

    const basePorPlan = base.filter((item) =>
      planAllowsNavKey(planIdUsuario, item.key)
    );

    if (rolUsuario !== "admin") {
      const dashboard = basePorPlan.find((x) => x.ruta === "/panel/dashboard");
      const movimientos = basePorPlan.find((x) => x.key === "movimientos");
      const flujoCaja = basePorPlan.find((x) => x.ruta === "/panel/flujo-de-caja");

      const itemsPermitidos = [];

      if (dashboard) {
        itemsPermitidos.push(dashboard);
      }

      if (movimientos) {
        itemsPermitidos.push({
          ...movimientos,
          children: (movimientos.children || []).filter((sub) =>
            ["/panel/ventas", "/panel/recibos"].includes(sub.ruta)
          ),
        });
      }

      if (flujoCaja) {
        itemsPermitidos.push(flujoCaja);
      }

      return itemsPermitidos;
    }

    return basePorPlan;
  }, [rolUsuario, planIdUsuario]);

  const activeKey = useMemo(() => {
    if (
      location.pathname.startsWith("/panel/movimientos") ||
      location.pathname.startsWith("/panel/ventas") ||
      location.pathname.startsWith("/panel/compras") ||
      location.pathname.startsWith("/panel/recibos") ||
      location.pathname.startsWith("/panel/OrdenesPago") ||
      location.pathname.startsWith("/panel/Otrosingresos") ||
      location.pathname.startsWith("/panel/Otrosegresos") ||
      location.pathname.startsWith("/panel/documentos_comerciales") ||
      location.pathname.startsWith("/panel/presupuesto")
    ) {
      return "movimientos";
    }

    if (location.pathname.startsWith("/panel/cuentas-corrientes")) {
      return "cuentas-corrientes";
    }

    if (location.pathname.startsWith("/panel/cheques")) return "cheques";
    if (location.pathname.startsWith("/panel/servicios")) return "servicios";
    if (location.pathname.startsWith("/panel/contabilidad")) return "contabilidad";
    if (location.pathname.startsWith("/panel/configuracion")) return "configuracion";

    const found = navItems.find((x) => location.pathname.startsWith(x.ruta));

    return found?.key || "";
  }, [location.pathname, navItems]);

  const activeLabel = useMemo(() => {
    if (
      location.pathname.startsWith("/panel/movimientos") ||
      location.pathname.startsWith("/panel/ventas") ||
      location.pathname.startsWith("/panel/compras") ||
      location.pathname.startsWith("/panel/recibos") ||
      location.pathname.startsWith("/panel/OrdenesPago") ||
      location.pathname.startsWith("/panel/Otrosingresos") ||
      location.pathname.startsWith("/panel/Otrosegresos") ||
      location.pathname.startsWith("/panel/documentos_comerciales") ||

      location.pathname.startsWith("/panel/presupuesto")
    ) {
      return "Movimientos";
    }

    if (location.pathname.startsWith("/panel/cuentas-corrientes/clientes")) {
      return "Cuentas Corrientes";
    }

    if (location.pathname.startsWith("/panel/cuentas-corrientes/proveedores")) {
      return "Cuentas Corrientes";
    }

    if (location.pathname.startsWith("/panel/contabilidad")) return "Contabilidad";

    if (location.pathname.startsWith("/panel/cheques")) return "Cheques";
    if (location.pathname.startsWith("/panel/servicios")) return "Servicios";

    if (location.pathname.startsWith("/panel/configuracion")) {
      return "Configuración";
    }

    const found = navItems.find((x) => location.pathname.startsWith(x.ruta));

    return found?.label || "Dashboard";
  }, [location.pathname, navItems]);

  const closeAllSubs = useCallback(() => {
    setOpenMovSub(false);
    setOpenCCSub(false);
    setOpenChequesSub(false);
    setOpenServiciosSub(false);
    setOpenContabilidadSub(false);
  }, []);

  const handleNavigate = useCallback(
    (ruta) => {
      closeAllSubs();
      navigate(ruta);
      setDrawerOpen(false);
    },
    [navigate, closeAllSubs]
  );

  const handleLogoClick = useCallback(() => {
    closeAllSubs();
    navigate("/panel/dashboard");
    setDrawerOpen(false);
  }, [navigate, closeAllSubs, rolUsuario]);

  const confirmarCierreSesion = useCallback(async () => {
    await doLogout({ silent: false });
  }, [doLogout]);

  const toggleTema = async () => {
    const prevTema = tema;
    const nuevo = tema === "oscuro" ? "claro" : "oscuro";

    setTema(nuevo);
    applyTheme(nuevo);

    try {
      const u = JSON.parse(localStorage.getItem("usuario")) || {};
      const u2 = { ...u, tema: nuevo };

      localStorage.setItem("usuario", JSON.stringify(u2));
      setUsuario(u2);
    } catch {}

    try {
      const r = await actualizarTemaBackend(nuevo);

      if (r.status === 401) {
        await doLogout({ silent: true });
        return;
      }

      const txt = await r.text();
      const data = safeJsonParse(txt);

      if (!r.ok || !data?.exito) {
        setTema(prevTema);
        applyTheme(prevTema);

        try {
          const u = JSON.parse(localStorage.getItem("usuario")) || {};
          const uPrev = { ...u, tema: prevTema };

          localStorage.setItem("usuario", JSON.stringify(uPrev));
          setUsuario(uPrev);
        } catch {}
      }
    } catch {
      setTema(prevTema);
      applyTheme(prevTema);

      try {
        const u = JSON.parse(localStorage.getItem("usuario")) || {};
        const uPrev = { ...u, tema: prevTema };

        localStorage.setItem("usuario", JSON.stringify(uPrev));
        setUsuario(uPrev);
      } catch {}
    }
  };

  const isMovDropdown = (itemKey) => itemKey === "movimientos";
  const isCCDropdown = (itemKey) => itemKey === "cuentas-corrientes";
  const isChequesDropdown = (itemKey) => itemKey === "cheques";
  const isServiciosDropdown = (itemKey) => itemKey === "servicios";
  const isContabilidadDropdown = (itemKey) => itemKey === "contabilidad";

  const getSubmenuKeyByPath = useCallback((pathname = "") => {
    if (
      pathname.startsWith("/panel/movimientos") ||
      pathname.startsWith("/panel/ventas") ||
      pathname.startsWith("/panel/compras") ||
      pathname.startsWith("/panel/recibos") ||
      pathname.startsWith("/panel/OrdenesPago") ||
      pathname.startsWith("/panel/Otrosingresos") ||
      pathname.startsWith("/panel/Otrosegresos") ||
      pathname.startsWith("/panel/documentos_comerciales") ||
      pathname.startsWith("/panel/presupuesto")
    ) {
      return "movimientos";
    }

    if (pathname.startsWith("/panel/cuentas-corrientes")) {
      return "cuentas-corrientes";
    }

    if (pathname.startsWith("/panel/cheques")) return "cheques";
    if (pathname.startsWith("/panel/servicios")) return "servicios";
    if (pathname.startsWith("/panel/contabilidad")) return "contabilidad";

    return "";
  }, []);

  const openOnlySubmenu = useCallback((itemKey = "") => {
    setOpenMovSub(itemKey === "movimientos");
    setOpenCCSub(itemKey === "cuentas-corrientes");
    setOpenChequesSub(itemKey === "cheques");
    setOpenServiciosSub(itemKey === "servicios");
    setOpenContabilidadSub(itemKey === "contabilidad");
  }, []);

  useEffect(() => {
    const currentSubmenu = getSubmenuKeyByPath(location.pathname);

    if (currentSubmenu) {
      openOnlySubmenu(currentSubmenu);
    }
  }, [getSubmenuKeyByPath, location.pathname, openOnlySubmenu]);

  const getModalLogoSrc = useCallback(() => {
    if (tenantLogoIconoLoaded && tenantLogoIconoSrc) {
      return tenantLogoIconoSrc;
    }

    return "";
  }, [tenantLogoIconoLoaded, tenantLogoIconoSrc]);

  const toggleSubmenu = useCallback(
    (itemKey, isCurrentlyOpen) => {
      if (isCurrentlyOpen) {
        closeAllSubs();
        return;
      }

      openOnlySubmenu(itemKey);
    },
    [closeAllSubs, openOnlySubmenu]
  );

  const handleNavItemClick = useCallback(
    (item, hasSub, isOpen) => {
      prefetchRoute(item.ruta);

      if (!hasSub) {
        handleNavigate(item.ruta);
        return;
      }

      /*
        En escritorio se mantiene el comportamiento de siempre:
        click abre/cierra y doble click entra a la ruta principal.

        En celular el doble click/tap no es confiable, por eso cuando el
        drawer está abierto el segundo toque sobre el grupo abierto navega
        a la ruta principal/default del módulo.
      */
      if (drawerOpen && isOpen) {
        handleNavigate(DEFAULT_SUBROUTES[item.key] || item.ruta);
        return;
      }

      toggleSubmenu(item.key, isOpen);
    },
    [
      DEFAULT_SUBROUTES,
      drawerOpen,
      handleNavigate,
      toggleSubmenu,
    ]
  );

  return (
    <div className="pp-shell">
      <header className="mov-topbar">
        <div className="mov-topbar__left">
          <button
            className="pp-burger"
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menú"
            title="Menú"
          >
            <FontAwesomeIcon icon={faBars} />
          </button>

          <button
            className="mov-topbar__logo"
            onClick={handleLogoClick}
            title="Ir al dashboard"
          >
            <img
              src={LogoBalto}
              alt="Logo de Balto"
              className="mov-topbar__logoImg"
            />
          </button>

          <div className="mov-topbar__titles">
            <div className="mov-topbar__sysname">
              <span className="mov-topbar__brandName">BALTO</span>
              <span className="mov-topbar__brandDot">•</span>
              <span className="mov-topbar__brandType">Sistema Contable</span>
            </div>

            <div className="mov-topbar__sysby">
              Desarrollado por{" "}
              <a
                href="https://3devsnet.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mov-topbar__sysbyLink"
              >
                3 devs
              </a>
            </div>
          </div>
        </div>

        <div className="mov-topbar__right">
          <div className="mov-topbar__section">{activeLabel}</div>

          <button
            className="pp-themeBtn"
            onClick={toggleTema}
            title={
              tema === "oscuro"
                ? "Cambiar a modo claro"
                : "Cambiar a modo oscuro"
            }
            aria-label={
              tema === "oscuro"
                ? "Cambiar a modo claro"
                : "Cambiar a modo oscuro"
            }
          >
            <FontAwesomeIcon icon={tema === "oscuro" ? faSun : faMoon} />
          </button>

          {puedeVerConfiguracion && (
            <button
              className="pp-themeBtn"
              onClick={() => handleNavigate("/panel/configuracion")}
              title="Configuración"
              aria-label="Ir a Configuración"
            >
              <FontAwesomeIcon icon={faGear} />
            </button>
          )}

          <button
            className={`mov-topbar__usericon ${
              tenantLogoIconoLoaded && tenantLogoIconoSrc
                ? `mov-topbar__usericon--logo mov-topbar__usericon--logo-${tenantLogoIconoTone}`
                : ""
            }`}
            onClick={() => setShowPerfilModal(true)}
            title="Perfil"
            aria-label="Abrir perfil"
          >
            {tenantLogoIconoLoaded && tenantLogoIconoSrc ? (
              <img
                src={tenantLogoIconoSrc}
                alt="Logo icono de la empresa"
                className="mov-topbar__userLogo"
              />
            ) : (
              <FontAwesomeIcon icon={faUserCircle} />
            )}
          </button>

          <button
            className="pp-topbarLogout"
            onClick={() => setShowLogoutModal(true)}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <FontAwesomeIcon icon={faSignOutAlt} />
          </button>
        </div>
      </header>

      <div
        className={`pp-drawerOverlay ${drawerOpen ? "is-open" : ""}`}
        onMouseDown={() => setDrawerOpen(false)}
      />

      <aside className={`pp-sidebar ${drawerOpen ? "is-drawerOpen" : ""}`}>
        <div className="pp-drawerHeader">
          <div
            className="pp-drawerBrand"
            onClick={handleLogoClick}
            role="button"
            tabIndex={0}
          >
            <div className="pp-drawerBrand__mark">
              <FontAwesomeIcon icon={faChartLine} />
            </div>

            <div className="pp-drawerBrand__txt">
              <div className="pp-drawerBrand__t">Contable</div>
              <div className="pp-drawerBrand__s">Panel</div>
            </div>
          </div>

          <button
            className="pp-drawerClose"
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar menú"
            title="Cerrar"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        <div
          className="pp-brand panel_contable"
          onClick={handleLogoClick}
          role="button"
          tabIndex={0}
        >
          <div className="pp-brand__mark">
            <FontAwesomeIcon icon={faChartLine} />
          </div>

          <div className="pp-brand__text">
            <div className="pp-brand__title">Contable</div>
            <div className="pp-brand__subtitle">Panel</div>
          </div>
        </div>

        <nav className="pp-nav">
          {navItems.map((item) => {
            const hasSub =
              Array.isArray(item.children) && item.children.length > 0;

            const isMov = isMovDropdown(item.key);
            const isCC = isCCDropdown(item.key);
            const isCheques = isChequesDropdown(item.key);
            const isServicios = isServiciosDropdown(item.key);
            const isContabilidad = isContabilidadDropdown(item.key);

            const isActive =
              activeKey === item.key ||
              (isMov &&
                (location.pathname.startsWith("/panel/movimientos") ||
                  location.pathname.startsWith("/panel/ventas") ||
                  location.pathname.startsWith("/panel/compras") ||
                  location.pathname.startsWith("/panel/recibos") ||
                  location.pathname.startsWith("/panel/OrdenesPago") ||
                  location.pathname.startsWith("/panel/Otrosingresos") ||
                  location.pathname.startsWith("/panel/Otrosegresos") ||
                  location.pathname.startsWith("/panel/documentos_comerciales") ||
                  location.pathname.startsWith("/panel/presupuesto"))) ||
              (isCC &&
                location.pathname.startsWith("/panel/cuentas-corrientes")) ||
              (isCheques && location.pathname.startsWith("/panel/cheques")) ||
              (isServicios && location.pathname.startsWith("/panel/servicios")) ||
              (isContabilidad && location.pathname.startsWith("/panel/contabilidad"));

            const isOpen =
              (isMov && openMovSub) ||
              (isCC && openCCSub) ||
              (isCheques && openChequesSub) ||
              (isServicios && openServiciosSub) ||
              (isContabilidad && openContabilidadSub);

            return (
              <div
                key={item.key}
                className={`pp-navGroup ${hasSub ? "has-sub" : ""} ${
                  isOpen ? "is-open" : ""
                }`}
                onMouseEnter={() => prefetchRoute(item.ruta)}
              >
<button
  type="button"
  className={`pp-nav__item ${isActive ? "is-active" : ""}`}
  onDoubleClick={() => {
    if (!hasSub) return;
    handleNavigate(DEFAULT_SUBROUTES[item.key] || item.ruta);
  }}
  onClick={() => handleNavItemClick(item, hasSub, isOpen)}
  aria-expanded={hasSub ? isOpen : undefined}
  aria-haspopup={hasSub ? "menu" : undefined}
>
                  <span className="pp-nav__icon">
                    <FontAwesomeIcon icon={item.icon} />
                  </span>

                  <span className="pp-nav__label">{item.label}</span>
                </button>

                {hasSub && (
                  <div className="pp-navSub">
                    {item.children.map((sub) => {
                      const [subPath, subQuery = ""] = sub.ruta.split("?");
                      const isServiciosSub = item.key === "servicios";
                      const isSubActive = isServiciosSub
                        ? location.pathname === subPath &&
                          (subQuery
                            ? location.search === `?${subQuery}`
                            : !location.search.includes("seccion=inventario"))
                        : location.pathname === sub.ruta ||
                          location.pathname.startsWith(`${sub.ruta}/`);

                      return (
                        <button
                          key={sub.ruta + sub.label}
                          className={`pp-navSub__item ${isSubActive ? "is-active" : ""}`}
                          onMouseEnter={() => prefetchRoute(sub.ruta)}
                          onClick={() => {
                            openOnlySubmenu(item.key);
                            navigate(sub.ruta);
                            setDrawerOpen(false);
                          }}
                        >
                          <span className="pp-navSub__dot" />
                          <span className="pp-navSub__label">{sub.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="pp-content">
        <div className="pp-content__inner">
          <StableOutlet />
        </div>
      </main>

      <ModalPerfil
        open={showPerfilModal}
        onClose={() => setShowPerfilModal(false)}
        usuario={usuario}
        logoSrc={getModalLogoSrc()}
        rolUsuario={rolUsuario}
        onConfigRequest={() => {
          setShowPerfilModal(false);

          if (puedeVerConfiguracion) {
            handleNavigate("/panel/configuracion");
            return;
          }

          handleNavigate("/panel/dashboard");
        }}
        onLogoutRequest={() => {
          setShowPerfilModal(false);
          setShowLogoutModal(true);
        }}
      />

      <ConfirmLogoutModal
        open={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={confirmarCierreSesion}
        loading={closingUI}
      />
    </div>
  );
};

export default Principal;



