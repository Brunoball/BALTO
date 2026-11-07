import React, { useEffect, useMemo } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { baltoConfig } from './componentes/global/configuracion/baltoConfig';
import { CarritoProvider } from './componentes/carrito/contexto/CarritoContext';
import { CuentaProvider } from './componentes/cuenta/contexto/CuentaContext';
import RequiereSesion from './componentes/autenticacion/RequiereSesion';
import { useTienda } from './componentes/tienda/hooks/useTienda';
import Encabezado from './componentes/estructura/Encabezado';
import PiePagina from './componentes/estructura/PiePagina';
import PanelCarrito from './componentes/carrito/PanelCarrito';
import SubirAlInicio from './componentes/global/SubirAlInicio';
import { EstadoError, EstadoCargando } from './componentes/global/Estados';
import PaginaInicio from './componentes/inicio/PaginaInicio';
import PaginaCatalogo from './componentes/catalogo/PaginaCatalogo';
import PaginaProducto from './componentes/producto/PaginaProducto';
import PaginaFavoritos from './componentes/catalogo/PaginaFavoritos';
import PaginaContacto from './componentes/estructura/PaginaContacto';
import PaginaNoEncontrada from './componentes/global/PaginaNoEncontrada';
import PaginaCarrito from './componentes/carrito/PaginaCarrito';
import PaginaCheckout from './componentes/checkout/PaginaCheckout';
import PaginaPedidoConfirmado from './componentes/checkout/PaginaPedidoConfirmado';
import PaginaIngreso from './componentes/autenticacion/PaginaIngreso';
import PaginaPerfil from './componentes/cuenta/PaginaPerfil';
import PaginaDirecciones from './componentes/cuenta/PaginaDirecciones';
import PaginaPedidos from './componentes/cuenta/PaginaPedidos';
import PaginaDetallePedido from './componentes/cuenta/PaginaDetallePedido';
import './aplicacion.css';

function storefrontTheme(config) {
  const color = String(config?.color_primario || '').trim();
  if (!/^#[\da-f]{6}$/i.test(color)) return undefined;
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const linear = c.map((x) => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const lightness = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return { '--brand': color, '--brand-text': lightness > 0.18 ? '#18242a' : '#ffffff' };
}
function Storefront() {
  const { config, loading, cargando, error, reintentar } = useTienda();
  const style = useMemo(() => storefrontTheme(config), [config]);
  useEffect(() => {
    document.title = config?.seo_titulo || config?.nombre || 'BALTO eCommerce';
    document.querySelector('meta[name="description"]')?.setAttribute('content', config?.seo_descripcion || config?.descripcion || 'Tienda online');
  }, [config]);
  if (loading || cargando) return <div className="app-root loading-root"><EstadoCargando message="Preparando tu tienda…"/></div>;
  if (error || !config) return <div className="app-root loading-root"><EstadoError error={error} title="La tienda no está disponible" retry={reintentar}/></div>;
  // La sesión del comprador se monta DESPUÉS de cargar la tienda: necesita saber si las cuentas
  // están habilitadas y el Client ID público de Google de ESTA tienda.
  return <CuentaProvider cuentas={config.cuentas}><div className="app-root" style={style}><SubirAlInicio/><Encabezado config={config}/><div className="site-content"><Routes>
    <Route path="/" element={<PaginaInicio config={config}/>}/>
    <Route path="/catalogo" element={<PaginaCatalogo config={config}/>}/>
    <Route path="/producto/:slug" element={<PaginaProducto config={config}/>}/>
    <Route path="/favoritos" element={<PaginaFavoritos/>}/>
    <Route path="/contacto" element={<PaginaContacto config={config}/>}/>
    <Route path="/carrito" element={<PaginaCarrito config={config}/>}/>
    <Route path="/checkout" element={<PaginaCheckout config={config}/>}/>
    <Route path="/pedido/confirmado" element={<PaginaPedidoConfirmado/>}/>
    <Route path="/iniciar-sesion" element={<PaginaIngreso config={config}/>}/>
    <Route path="/mi-cuenta" element={<RequiereSesion><PaginaPerfil/></RequiereSesion>}/>
    <Route path="/mi-cuenta/direcciones" element={<RequiereSesion><PaginaDirecciones/></RequiereSesion>}/>
    <Route path="/mi-cuenta/pedidos" element={<RequiereSesion><PaginaPedidos/></RequiereSesion>}/>
    <Route path="/mi-cuenta/pedidos/:numero" element={<RequiereSesion><PaginaDetallePedido/></RequiereSesion>}/>
    <Route path="*" element={<PaginaNoEncontrada/>}/>
  </Routes></div><PiePagina config={config}/><PanelCarrito config={config}/></div></CuentaProvider>;
}
export default function Aplicacion() {
  return <BrowserRouter basename={baltoConfig.routerBasename}><CarritoProvider><Storefront/></CarritoProvider></BrowserRouter>;
}
