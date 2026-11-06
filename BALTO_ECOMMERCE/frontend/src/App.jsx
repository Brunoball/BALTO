import React, { useEffect, useMemo } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { baltoConfig } from './config/baltoConfig';
import { StoreProvider } from './context/StoreContext';
import { useTienda } from './hooks/useTienda';
import Header from './components/layout/Header';
import Footer from './components/layout/Footer';
import CartDrawer from './components/cart/CartDrawer';
import ScrollTop from './components/common/ScrollTop';
import { ErrorState, LoadingState } from './components/common/StateView';
import HomePage from './pages/HomePage';
import CatalogPage from './pages/CatalogPage';
import ProductPage from './pages/ProductPage';
import FavoritesPage from './pages/FavoritesPage';
import ContactPage from './pages/ContactPage';
import NotFoundPage from './pages/NotFoundPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderConfirmationPage from './pages/OrderConfirmationPage';
import './App.css';

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
  if (loading || cargando) return <div className="app-root loading-root"><LoadingState message="Preparando tu tienda…"/></div>;
  if (error || !config) return <div className="app-root loading-root"><ErrorState error={error} title="La tienda no está disponible" retry={reintentar}/></div>;
  return <div className="app-root" style={style}><ScrollTop/><Header config={config}/><div className="site-content"><Routes><Route path="/" element={<HomePage config={config}/>}/><Route path="/catalogo" element={<CatalogPage config={config}/>}/><Route path="/producto/:slug" element={<ProductPage config={config}/>}/><Route path="/favoritos" element={<FavoritesPage/>}/><Route path="/contacto" element={<ContactPage config={config}/>}/><Route path="/carrito" element={<CartPage config={config}/>}/><Route path="/checkout" element={<CheckoutPage config={config}/>}/><Route path="/pedido/confirmado" element={<OrderConfirmationPage/>}/><Route path="*" element={<NotFoundPage/>}/></Routes></div><Footer config={config}/><CartDrawer config={config}/></div>;
}
export default function App() {
  return <BrowserRouter basename={baltoConfig.routerBasename}><StoreProvider><Storefront/></StoreProvider></BrowserRouter>;
}
