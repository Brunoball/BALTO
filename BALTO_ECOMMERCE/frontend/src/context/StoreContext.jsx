import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { baltoConfig } from '../config/baltoConfig';
import { validarCarrito as validarCarritoApi } from '../services/carritoService';
import {
  addEntry, applyServerLines, BLOQUEANTES, buildEntry, CART_VERSION, cartSignature, cartTotals,
  sanitizeStoredItems, setQuantity,
} from '../utils/cart';

const StoreContext = createContext(null);
// Carritos aislados por dominio de tienda (cada subdominio tiene su propio localStorage
// y, además, la clave incluye el dominio para el modo local con varias tiendas de prueba).
const STORAGE_KEY = `balto:ecommerce:${CART_VERSION}:${baltoConfig.tiendaDominio}`;
const LEGACY_KEY = `balto:ecommerce:v1:${baltoConfig.tiendaDominio}`;
const WISH_KEY = `balto:ecommerce:favoritos:${baltoConfig.tiendaDominio}`;

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function loadCart() {
  const current = readJson(STORAGE_KEY);
  if (Array.isArray(current)) return sanitizeStoredItems(current);
  const legacy = readJson(LEGACY_KEY); // carrito "Mi selección" de la versión anterior
  return Array.isArray(legacy) ? sanitizeStoredItems(legacy) : [];
}
function loadFavorites() {
  const list = readJson(WISH_KEY);
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 200) : [];
}

const IDLE = { status: 'idle', lineas: {}, resumen: null, error: null, firma: null, at: null };

export function StoreProvider({ children }) {
  const [items, setItems] = useState(loadCart);
  const [favorites, setFavorites] = useState(loadFavorites);
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [validation, setValidation] = useState(IDLE);
  const [cambios, setCambios] = useState([]);
  const itemsRef = useRef(items);
  const requestRef = useRef(0);
  itemsRef.current = items;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      if (localStorage.getItem(LEGACY_KEY) !== null) localStorage.removeItem(LEGACY_KEY);
    } catch (_) { /* modo privado o almacenamiento bloqueado: el carrito sigue en memoria */ }
  }, [items]);
  useEffect(() => { try { localStorage.setItem(WISH_KEY, JSON.stringify(favorites)); } catch (_) {} }, [favorites]);
  // Sincroniza el carrito entre pestañas de la misma tienda.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      try { setItems(sanitizeStoredItems(e.newValue ? JSON.parse(e.newValue) : [])); } catch (_) {}
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signature = useMemo(() => cartSignature(items), [items]);

  const pushCambios = useCallback((list) => {
    if (!list.length) return;
    setCambios((prev) => {
      const map = new Map(prev.map((c) => [c.key, c]));
      for (const c of list) map.set(c.key, { ...c, anterior: map.get(c.key)?.anterior ?? c.anterior });
      return [...map.values()];
    });
  }, []);

  /** Aplica líneas devueltas por el servidor (carrito_validar o 409 del checkout). */
  const applyServerResult = useCallback((lineas, resumen = null) => {
    const firma = cartSignature(itemsRef.current);
    const { items: next, cambios: nuevos } = applyServerLines(itemsRef.current, lineas);
    itemsRef.current = next;
    setItems(next);
    pushCambios(nuevos);
    setValidation({
      status: 'ok', error: null, firma, at: Date.now(), resumen,
      lineas: Object.fromEntries((lineas || []).map((l) => [l.key, l])),
    });
  }, [pushCambios]);

  /** Consulta precio/stock actuales. Distingue datos locales (localStorage) de los del servidor. */
  const validarCarrito = useCallback(async () => {
    const current = itemsRef.current;
    if (!current.length) { setValidation(IDLE); return null; }
    const id = ++requestRef.current;
    const firma = cartSignature(current);
    setValidation((v) => ({ ...v, status: 'loading', error: null }));
    try {
      const data = await validarCarritoApi(current);
      if (id !== requestRef.current) return null;
      if (cartSignature(itemsRef.current) !== firma) return null; // el carrito cambió: habrá otra validación
      applyServerResult(data.lineas || [], data.resumen || null);
      return data;
    } catch (error) {
      if (id === requestRef.current) setValidation((v) => ({ ...v, status: 'error', error }));
      return null;
    }
  }, [applyServerResult]);

  const addItem = useCallback((product, variant = null, quantity = 1) => {
    const built = buildEntry(product, variant, quantity);
    if (!built.ok) return { ok: false, motivo: built.motivo };
    const res = addEntry(itemsRef.current, built.entry);
    if (res.resultado === 'limite') return { ok: false, motivo: res.motivo };
    itemsRef.current = res.items;
    setItems(res.items);
    setCartOpen(true);
    return { ok: true, resultado: res.resultado, motivo: res.motivo || null };
  }, []);
  const changeQuantity = useCallback((key, qty) => setItems((list) => setQuantity(list, key, qty)), []);
  const removeItem = useCallback((key) => {
    setItems((list) => list.filter((x) => x.key !== key));
    setCambios((list) => list.filter((c) => c.key !== key));
  }, []);
  const clearItems = useCallback(() => { setItems([]); setCambios([]); setValidation(IDLE); }, []);
  const dismissCambios = useCallback(() => setCambios([]), []);
  const toggleFavorite = useCallback((slug) => setFavorites((list) => list.includes(slug) ? list.filter((v) => v !== slug) : [...list, slug]), []);

  const totals = useMemo(() => cartTotals(items), [items]);
  const vigente = validation.status === 'ok' && validation.firma === signature;
  const lineState = useCallback((key) => (vigente ? validation.lineas[key] || null : null), [vigente, validation.lineas]);
  const bloqueos = useMemo(() => (vigente
    ? items.filter((x) => {
      const l = validation.lineas[x.key];
      return !l || BLOQUEANTES.has(l.estado) || !l.comprable;
    }).map((x) => x.key)
    : []), [vigente, items, validation.lineas]);
  const listoParaComprar = vigente && items.length > 0 && bloqueos.length === 0 && Boolean(validation.resumen?.comprable);

  const value = useMemo(() => ({
    items, favorites, cartOpen, menuOpen, setCartOpen, setMenuOpen,
    addItem, changeQuantity, removeItem, clearItems, toggleFavorite,
    itemCount: totals.articulos, lineCount: totals.lineas, subtotal: totals.subtotal, subtotalCents: totals.subtotalCents,
    signature, validation, validacionVigente: vigente, validarCarrito, applyServerResult, lineState, bloqueos, listoParaComprar,
    cambios, dismissCambios,
  }), [items, favorites, cartOpen, menuOpen, addItem, changeQuantity, removeItem, clearItems, toggleFavorite, totals,
    signature, validation, vigente, validarCarrito, applyServerResult, lineState, bloqueos, listoParaComprar, cambios, dismissCambios]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore requiere StoreProvider');
  return ctx;
}
