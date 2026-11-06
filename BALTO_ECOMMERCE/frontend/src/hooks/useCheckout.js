import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { baltoConfig } from '../config/baltoConfig';
import { useStore } from '../context/StoreContext';
import { crearPedido } from '../services/checkoutService';
import { buyerPayload, EMPTY_BUYER, validateBuyer } from '../utils/checkoutValidation';

const DRAFT_KEY = `balto:ecommerce:checkout-borrador:${baltoConfig.tiendaDominio}`;
const ATTEMPT_KEY = `balto:ecommerce:checkout-intento:${baltoConfig.tiendaDominio}`;
export const CONFIRMATION_KEY = `balto:ecommerce:ultimo-pedido:${baltoConfig.tiendaDominio}`;

// Datos personales: sessionStorage (solo esta pestaña) y se borran al confirmar.
function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function writeSession(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}
function randomKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Misma compra (mismo carrito + mismos datos + mismo total) => misma clave de
 * idempotencia, aunque se recargue la página o se haga doble clic. Así el
 * servidor devuelve el mismo pedido en vez de crear uno nuevo.
 */
function idempotencyKeyFor(fingerprint) {
  const prev = readSession(ATTEMPT_KEY);
  if (prev && prev.fingerprint === fingerprint && typeof prev.key === 'string') return prev.key;
  const key = randomKey();
  writeSession(ATTEMPT_KEY, { key, fingerprint });
  return key;
}

export function useCheckout(config) {
  const store = useStore();
  const navigate = useNavigate();
  const modalidades = useMemo(() => config?.entrega_modalidades || [], [config]);
  const [values, setValues] = useState(() => {
    const draft = readSession(DRAFT_KEY);
    const base = { ...EMPTY_BUYER, modalidad_entrega: modalidades.length === 1 ? modalidades[0].codigo : '' };
    return draft && typeof draft === 'object' ? { ...base, ...Object.fromEntries(Object.entries(draft).filter(([k, v]) => k in EMPTY_BUYER && typeof v === 'string')) } : base;
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [sending, setSending] = useState(false);
  const [website, setWebsite] = useState(''); // trampa para bots (campo oculto)
  const sendingRef = useRef(false);

  useEffect(() => { writeSession(DRAFT_KEY, values); }, [values]);

  const setField = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }, []);

  const validateField = useCallback((name) => {
    const all = validateBuyer(values, modalidades);
    setErrors((e) => ({ ...e, [name]: all[name] }));
  }, [values, modalidades]);

  const enabled = Boolean(config?.checkout_habilitado);
  const totalEsperado = store.validacionVigente ? store.validation.resumen?.subtotal ?? null : null;
  const canSubmit = enabled && !sending && store.items.length > 0 && store.listoParaComprar && totalEsperado !== null;

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (sendingRef.current) return null; // doble clic: se ignora mientras hay un envío en curso
    setServerError(null);
    if (!enabled) {
      setServerError({ codigo: 'CHECKOUT_DESHABILITADO', mensaje: 'La compra online todavía no está habilitada en esta tienda.' });
      return null;
    }
    const errs = validateBuyer(values, modalidades);
    setErrors(errs);
    const firstInvalid = Object.keys(errs).find((k) => errs[k]);
    if (firstInvalid) {
      document.getElementById(`checkout-${firstInvalid}`)?.focus();
      return null;
    }
    if (!store.listoParaComprar || totalEsperado === null) {
      await store.validarCarrito();
      setServerError({ codigo: 'CARRITO_NO_VALIDADO', mensaje: 'Actualizamos tu carrito con los datos vigentes. Revisalo y volvé a confirmar.' });
      return null;
    }
    const comprador = buyerPayload(values, modalidades);
    const fingerprint = JSON.stringify([store.signature, comprador, totalEsperado]);
    const claveIdempotencia = idempotencyKeyFor(fingerprint);
    sendingRef.current = true;
    setSending(true);
    try {
      const data = await crearPedido({ claveIdempotencia, comprador, items: store.items, totalEsperado, website });
      writeSession(CONFIRMATION_KEY, data.pedido);
      writeSession(DRAFT_KEY, null);
      writeSession(ATTEMPT_KEY, null);
      store.clearItems();
      store.setCartOpen(false);
      navigate('/pedido/confirmado', { replace: true, state: { pedido: data.pedido } });
      return data;
    } catch (error) {
      const datos = error.datos || {};
      if (error.codigo === 'DATOS_COMPRADOR_INVALIDOS' && datos.errores) setErrors(datos.errores);
      if ((error.codigo === 'CARRITO_CON_PROBLEMAS' || error.codigo === 'PRECIOS_ACTUALIZADOS') && Array.isArray(datos.lineas)) {
        store.applyServerResult(datos.lineas, null);
        store.validarCarrito();
      }
      if (error.codigo === 'IDEMPOTENCIA_CONFLICTO') writeSession(ATTEMPT_KEY, null);
      setServerError({ codigo: error.codigo || 'ERROR', mensaje: error.message || 'No pudimos registrar el pedido.' });
      return null;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [enabled, values, modalidades, store, totalEsperado, website, navigate]);

  return { values, errors, setField, validateField, submit, sending, serverError, canSubmit, enabled, modalidades, website, setWebsite, totalEsperado };
}
