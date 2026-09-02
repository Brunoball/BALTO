import React, { useCallback, useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import BASE_URL, { BALTO_LOGIN_URL, APP_BASENAME } from "./config/config";
import { redirectToGlobalLoginBridge } from "./auth/localGlobalAuthBridge";
import { getBaltoPlanIdFromUsuario } from "./utils/demoMode";

/* Layout del panel */
import Principal from "./components/Principal/Principal";

/* Secciones */
import Dashboard from "./components/Dashboard/Dashboard";
import Movimientos from "./components/Movimientos/Movimientos";
import Ventas from "./components/Mov_Subsection/Ventas/Ventas";
import Compras from "./components/Mov_Subsection/Compra/Compras";
import Recibos from "./components/Mov_Subsection/Recibos/Recibos";
import Otrosingresos from "./components/Mov_Subsection/Otros_Ingresos/Otros_Ingresos";
import Otrosegresos from "./components/Mov_Subsection/Otros_Egresos/Otros_Egresos";
import Presupuestos from "./components/Mov_Subsection/Documentos_Comerciales/Presupuestos";
import Facturas from "./components/Mov_Subsection/Documentos_Comerciales/Facturas";
import Remitos from "./components/Mov_Subsection/Documentos_Comerciales/Remitos";
import OrdenesPago from "./components/Mov_Subsection/OrdenesPago/OrdenesPago";
import Flujo_Caja from "./components/Flujo_de_Caja/Flujo_Caja";

/* Contabilidad */
import IVACompras from "./components/Contabilidad/IVA_Compras/IVA_Compras";
import IVAVentas from "./components/Contabilidad/IVA_Ventas/IVA_Ventas";

/* Configuración */
import Configuracion from "./components/Configuracion/Configuracion";
import ConfigTiendaNube from "./components/Configuracion/ConfiguracionTiendaNube/ConfigTiendaNube";
import ConfiguracionCalendario from "./components/Configuracion/ConfiguracionCalendario/ConfiguracionCalendario";
import ConfiguracionUsuarios from "./components/Configuracion/ConfiguracionUsuarios/ConfiguracionUsuarios";
import ConfiguracionDatosLegales from "./components/Configuracion/ConfiguracionDatosLegales/ConfiguracionDatosLegales";
import ConfiguracionSaldosIniciales from "./components/Configuracion/ConfiguracionSaldosIniciales/ConfiguracionSaldosIniciales";

/* Análisis financiero */
import * as AnalisisFinancieroModule from "./components/Analisis_Financiero/Analisis_Financiero";

/* Cuentas corrientes */
import ClientesCC from "./components/Cuentas_Corrientes/Clientes/Clientes";
import ProveedoresCC from "./components/Cuentas_Corrientes/Proveedores/Proveedores";

/* STOCK */
import Stock from "./components/Stock/Stock";

/* CHEQUES */
import Cheques_Cartera from "./components/Cheques/Cheques_Cartera/Cheques_Cartera";
import Flujo_Cheques from "./components/Cheques/Flujo_Cheques/Flujo_Cheques";
import Echeqs_Cartera from "./components/Cheques/Echeqs_Cartera/Echeqs_Cartera";
import Flujo_Echeqs from "./components/Cheques/Flujo_Echeqs/Flujo_Echeqs";

/* Providers globales */
import { ListasProvider } from "./context/ListasContext";
import { DateRangeProvider } from "./context/DateRangeContext";

/* =========================================================
   Helpers: resolver componente (default o named)
========================================================= */
function resolveComponent(mod, fallbacks = []) {
  if (mod && typeof mod.default === "function") return mod.default;

  for (const k of fallbacks) {
    if (mod && typeof mod[k] === "function") return mod[k];
  }

  if (mod && typeof mod === "object") {
    for (const k of Object.keys(mod)) {
      if (typeof mod[k] === "function") return mod[k];
    }
  }

  return function ComponenteNoEncontrado() {
    return (
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0 }}>Error de import/export</h3>
        <p style={{ marginTop: 8 }}>
          No se pudo resolver el componente. Revisá si el archivo exporta{" "}
          <b>default</b> o un <b>named export</b>.
        </p>
      </div>
    );
  };
}

const AnalisisFinanciero = resolveComponent(AnalisisFinancieroModule, [
  "AnalisisFinanciero",
  "Analisis_Financiero",
  "AnalisisFinancieroPage",
]);

/* =========================================================
   Auth global BALTO
========================================================= */
function getSessionKey() {
  try {
    return (localStorage.getItem("session_key") || "").trim();
  } catch {
    return "";
  }
}

function clearGlobalAuth() {
  try {
    localStorage.removeItem("session_key");
    localStorage.removeItem("usuario");
    localStorage.removeItem("token");
    localStorage.removeItem("sessionKey");
    localStorage.removeItem("x_session");
    localStorage.removeItem("X-Session");
  } catch {}

  try {
    sessionStorage.clear();
  } catch {}
}

function redirectToGlobalLogin() {
  // En localhost siempre hay que pasar por dev-auth-start.html. Ese gateway
  // registra el return_to antes de abrir el LOGIN global; ir directo al LOGIN
  // pierde el retorno y termina en "No hay un retorno local pendiente".
  if (redirectToGlobalLoginBridge()) return;

  try {
    if (window.location.href !== BALTO_LOGIN_URL) {
      window.location.replace(BALTO_LOGIN_URL);
    }
  } catch {
    window.location.href = BALTO_LOGIN_URL;
  }
}

function isAuthenticated() {
  // El navegador solo usa session_key para decidir si debe intentar entrar.
  // La identidad, tenant, rol, plan y vertical se revalidan en el backend antes de montar Principal.
  return Boolean(getSessionKey());
}

function normalizeRol(value, idRol = null) {
  const id = Number(idRol);
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    id === 1 ||
    ["1", "admin", "administrator", "administrador", "superadmin"].includes(v)
  ) {
    return "admin";
  }

  return "empleado_basico";
}

function getUsuarioLogueado() {
  try {
    const rawUser = localStorage.getItem("usuario");
    if (!rawUser) return null;

    const u = JSON.parse(rawUser);
    return u && typeof u === "object" ? u : null;
  } catch {
    return null;
  }
}

function isAdminUser() {
  const u = getUsuarioLogueado();
  return normalizeRol(u?.rol ?? u?.tipo_rol, u?.id_rol) === "admin";
}

function getPlanIdUsuario() {
  const u = getUsuarioLogueado();
  return getBaltoPlanIdFromUsuario(u);
}

function planAllowsModule(modulo) {
  // Política temporal vigente: BÁSICO, INTERMEDIO, PRO y DEMO pueden
  // navegar por todos los módulos. Los bloqueos sensibles del DEMO se aplican
  // en las acciones y en el backend, igual que en Principal.
  void modulo;
  return true;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function authFailureCode(data) {
  return String(data?.codigo || data?.code || "").trim().toUpperCase();
}

function isDefinitiveAuthFailure(status, data) {
  const code = authFailureCode(data);
  if (status === 401) return true;

  return [
    "SESSION_REQUIRED",
    "SESSION_INVALID",
    "SESSION_REVOKED",
    "SESSION_EXPIRED",
    "SESION_REQUERIDA",
    "SESION_INVALIDA",
    "SESION_REVOCADA",
    "SESION_EXPIRADA",
    "USUARIO_INACTIVO",
    "USUARIO_DESHABILITADO",
    "TENANT_INACTIVO",
    "TENANT_DESHABILITADO",
    "SISTEMA_NO_AUTORIZADO",
  ].includes(code);
}

async function validateGlobalSession() {
  const sessionKey = getSessionKey();
  if (!sessionKey) {
    return { ok: false, status: 401, data: { codigo: "SESSION_REQUIRED" } };
  }

  const response = await fetch(`${BASE_URL}/api.php?action=auth_session_check`, {
    method: "GET",
    headers: {
      "X-Session": sessionKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  const data = safeJsonParse(text) || {};

  if (!response.ok || data?.exito === false || data?.sesion_valida !== true) {
    return { ok: false, status: response.status, data };
  }

  const sistema = String(data?.sistema?.codigo || data?.sistema_codigo || "")
    .trim()
    .toUpperCase();

  if (sistema !== "COMERCIO") {
    return {
      ok: false,
      status: 403,
      data: {
        exito: false,
        codigo: "SISTEMA_NO_AUTORIZADO",
        mensaje: "La sesión global no corresponde a BALTO_COMERCIO.",
      },
    };
  }

  return { ok: true, status: response.status, data };
}

/*
 * Principal ya emite auth:unauthorized cuando detecta sesión expirada.
 * Interceptamos únicamente 401 para no convertir 403 funcionales (por ejemplo,
 * permisos/demo) en un cierre de sesión. Al registrarse al cargar App.js,
 * este handler evita que el logout silencioso legacy termine en la raíz vieja.
 */
if (typeof window !== "undefined" && !window.__BALTO_COMERCIO_GLOBAL_AUTH_BOUND__) {
  window.__BALTO_COMERCIO_GLOBAL_AUTH_BOUND__ = true;
  window.addEventListener("auth:unauthorized", (event) => {
    const status = Number(event?.detail?.status || 0);
    if (status !== 401) return;

    try {
      event.stopImmediatePropagation();
    } catch {}

    clearGlobalAuth();
    redirectToGlobalLogin();
  });
}

function GlobalLoginRedirect() {
  useEffect(() => {
    clearGlobalAuth();
    redirectToGlobalLogin();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      Redirigiendo a BALTO LOGIN…
    </div>
  );
}

function GlobalSessionGate({ children }) {
  const [state, setState] = useState({ status: "checking", message: "" });

  const verify = useCallback(async () => {
    if (!getSessionKey()) {
      clearGlobalAuth();
      redirectToGlobalLogin();
      return;
    }

    setState({ status: "checking", message: "" });

    try {
      const result = await validateGlobalSession();

      if (!result.ok) {
        if (isDefinitiveAuthFailure(result.status, result.data)) {
          clearGlobalAuth();
          redirectToGlobalLogin();
          return;
        }

        const mensaje =
          result.data?.mensaje ||
          result.data?.error ||
          `No se pudo validar la sesión global (HTTP ${result.status || 0}).`;

        setState({ status: "error", message: mensaje });
        return;
      }

      if (result.data?.usuario && typeof result.data.usuario === "object") {
        localStorage.setItem("usuario", JSON.stringify(result.data.usuario));
      }

      setState({ status: "ready", message: "" });
    } catch (error) {
      setState({
        status: "error",
        message:
          "No se pudo contactar la API de BALTO_COMERCIO para validar la sesión. " +
          "Revisá conexión/CORS y volvé a intentar.",
      });
    }
  }, []);

  useEffect(() => {
    verify();
  }, [verify]);

  if (state.status === "ready") return children;

  if (state.status === "error") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#f4f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            width: "min(560px, 100%)",
            background: "white",
            border: "1px solid #dbe2ea",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 12px 32px rgba(15, 23, 42, .08)",
          }}
        >
          <h2 style={{ marginTop: 0 }}>No se pudo validar la sesión</h2>
          <p>{state.message}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={verify}>
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => {
                clearGlobalAuth();
                redirectToGlobalLogin();
              }}
            >
              Ir a BALTO LOGIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "sans-serif",
      }}
    >
      Validando sesión global…
    </div>
  );
}

function RutaProtegida({ children }) {
  return isAuthenticated() ? children : <GlobalLoginRedirect />;
}

function RutaModulo({ modulo, children }) {
  if (!isAuthenticated()) return <GlobalLoginRedirect />;

  return planAllowsModule(modulo) ? (
    children
  ) : (
    <Navigate to="/panel/dashboard" replace />
  );
}

function RutaAdmin({ children }) {
  if (!isAuthenticated()) return <GlobalLoginRedirect />;

  return isAdminUser() ? children : <Navigate to="/panel/dashboard" replace />;
}

function RutaPlanPro({ children }) {
  if (!isAuthenticated()) return <GlobalLoginRedirect />;

  return getPlanIdUsuario() === 3 ? (
    children
  ) : (
    <Navigate to="/panel/configuracion" replace />
  );
}

function RutaNoDemoConfig({ children }) {
  if (!isAuthenticated()) return <GlobalLoginRedirect />;

  // En DEMO la configuración queda visible como vista previa,
  // pero solo Calendario global debe ser navegable/editable.
  return getPlanIdUsuario() === 10 ? (
    <Navigate to="/panel/configuracion" replace />
  ) : (
    children
  );
}

function PanelIndexRedirect() {
  return <Navigate to="dashboard" replace />;
}

/* =========================================================
   Ruteo
========================================================= */
export default function App() {
  return (
    <Router basename={APP_BASENAME}>
      <Routes>
        {/* BALTO_COMERCIO ya no posee login propio como entrada. */}
        <Route
          path="/"
          element={
            isAuthenticated() ? (
              <Navigate to="/panel" replace />
            ) : (
              <GlobalLoginRedirect />
            )
          }
        />
        <Route path="/registro" element={<GlobalLoginRedirect />} />
        <Route path="/reset-password" element={<GlobalLoginRedirect />} />

        {/* Panel protegido + validación real de sesión MASTER/COMERCIO */}
        <Route
          path="/panel"
          element={
            <GlobalSessionGate>
              <RutaProtegida>
                <DateRangeProvider>
                  <ListasProvider>
                    <Principal />
                  </ListasProvider>
                </DateRangeProvider>
              </RutaProtegida>
            </GlobalSessionGate>
          }
        >
          <Route index element={<PanelIndexRedirect />} />

          <Route
            path="dashboard"
            element={
              <RutaModulo modulo="dashboard">
                <Dashboard />
              </RutaModulo>
            }
          />

          <Route
            path="movimientos"
            element={
              <RutaModulo modulo="movimientos">
                <Movimientos />
              </RutaModulo>
            }
          />
          <Route
            path="ventas"
            element={
              <RutaModulo modulo="movimientos">
                <Ventas />
              </RutaModulo>
            }
          />
          <Route
            path="compras"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Compras />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="recibos"
            element={
              <RutaModulo modulo="movimientos">
                <Recibos />
              </RutaModulo>
            }
          />
          <Route
            path="OrdenesPago"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <OrdenesPago />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="Otrosingresos"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Otrosingresos />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="Otrosegresos"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Otrosegresos />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* Compatibilidad: la ruta vieja ya no renderiza wrapper, redirige a Presupuestos */}
          <Route
            path="documentos_comerciales"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Navigate to="/panel/presupuesto" replace />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="presupuesto"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Presupuestos />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="facturacion"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Facturas />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="remitos"
            element={
              <RutaModulo modulo="movimientos">
                <RutaAdmin>
                  <Remitos />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* Disponible para admin y usuario básico logueado */}
          <Route
            path="flujo-de-caja"
            element={
              <RutaModulo modulo="flujo-caja">
                <Flujo_Caja />
              </RutaModulo>
            }
          />

          <Route
            path="cuentas-corrientes"
            element={<Navigate to="/panel/cuentas-corrientes/clientes" replace />}
          />
          <Route
            path="cuentas-corrientes/clientes"
            element={
              <RutaModulo modulo="cuentas-corrientes">
                <RutaAdmin>
                  <ClientesCC />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="cuentas-corrientes/proveedores"
            element={
              <RutaModulo modulo="cuentas-corrientes">
                <RutaAdmin>
                  <ProveedoresCC />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* STOCK */}
          <Route
            path="stock"
            element={
              <RutaModulo modulo="stock">
                <RutaAdmin>
                  <Stock />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* CONTABILIDAD */}
          <Route
            path="contabilidad"
            element={<Navigate to="/panel/contabilidad/iva-ventas" replace />}
          />
          <Route
            path="contabilidad/iva-compras"
            element={
              <RutaModulo modulo="contabilidad">
                <RutaAdmin>
                  <IVACompras />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="contabilidad/iva-ventas"
            element={
              <RutaModulo modulo="contabilidad">
                <RutaAdmin>
                  <IVAVentas />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* CHEQUES */}
          <Route
            path="cheques"
            element={<Navigate to="/panel/cheques/cartera" replace />}
          />
          <Route
            path="cheques/cartera"
            element={
              <RutaModulo modulo="cheques">
                <RutaAdmin>
                  <Cheques_Cartera />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="cheques/flujo"
            element={
              <RutaModulo modulo="cheques">
                <RutaAdmin>
                  <Flujo_Cheques />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="cheques/echeqs-cartera"
            element={
              <RutaModulo modulo="cheques">
                <RutaAdmin>
                  <Echeqs_Cartera />
                </RutaAdmin>
              </RutaModulo>
            }
          />
          <Route
            path="cheques/flujo-echeqs"
            element={
              <RutaModulo modulo="cheques">
                <RutaAdmin>
                  <Flujo_Echeqs />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="analisis-financiero"
            element={
              <RutaModulo modulo="analisis-financiero">
                <RutaAdmin>
                  <AnalisisFinanciero />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          {/* CONFIGURACIÓN */}
          <Route
            path="configuracion"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <Configuracion />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="configuracion/tiendanube"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <RutaPlanPro>
                    <ConfigTiendaNube />
                  </RutaPlanPro>
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="configuracion/calendario"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <ConfiguracionCalendario />
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="configuracion/usuarios"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <RutaNoDemoConfig>
                    <ConfiguracionUsuarios />
                  </RutaNoDemoConfig>
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="configuracion/datos-legales"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <RutaNoDemoConfig>
                    <ConfiguracionDatosLegales />
                  </RutaNoDemoConfig>
                </RutaAdmin>
              </RutaModulo>
            }
          />

          <Route
            path="configuracion/saldos-iniciales"
            element={
              <RutaModulo modulo="configuracion">
                <RutaAdmin>
                  <RutaNoDemoConfig>
                    <ConfiguracionSaldosIniciales />
                  </RutaNoDemoConfig>
                </RutaAdmin>
              </RutaModulo>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}
