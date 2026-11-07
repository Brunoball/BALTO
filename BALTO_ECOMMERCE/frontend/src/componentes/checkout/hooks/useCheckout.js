import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { baltoConfig } from '../../global/configuracion/baltoConfig';
import { useCuenta } from '../../cuenta/contexto/CuentaContext';
import { useCarrito } from '../../carrito/contexto/CarritoContext';
import { crearPedido } from '../api/checkoutApi';
import { listarDirecciones } from '../../cuenta/api/cuentaApi';
import { EMPTY_ADDRESS } from '../../direccion/utilidades/validacionDireccion';
import { buyerPayload, EMPTY_BUYER, requiresAddress, validateBuyer } from '../utilidades/validacionCheckout';
import { metodosPara, pagosActivos } from '../../pagos/utilidades/reglasPago';
import { guardarAutorizacion } from '../../pagos/api/pagoApi';

const DRAFT_KEY = `balto:ecommerce:checkout-borrador:${baltoConfig.tiendaDominio}`;
const ATTEMPT_KEY = `balto:ecommerce:checkout-intento:${baltoConfig.tiendaDominio}`;
export const CONFIRMATION_KEY = `balto:ecommerce:ultimo-pedido:${baltoConfig.tiendaDominio}`;

// Datos personales: sessionStorage (solo esta pestaña) y se borran al confirmar o al cerrar sesión.
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
 * Misma compra (mismo carrito + mismos datos + mismo total + misma cuenta) =>
 * misma clave de idempotencia, aunque se recargue la página o se haga doble clic.
 * Si cambia la cuenta (login/logout/otro usuario), cambia la huella y la clave.
 */
function idempotencyKeyFor(fingerprint) {
  const prev = readSession(ATTEMPT_KEY);
  if (prev && prev.fingerprint === fingerprint && typeof prev.key === 'string') return prev.key;
  const key = randomKey();
  writeSession(ATTEMPT_KEY, { key, fingerprint });
  return key;
}

const ADDRESS_KEYS = Object.keys(EMPTY_ADDRESS);
function sanitizeDraft(draft, base) {
  if (!draft || typeof draft !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(draft)) if ((k in EMPTY_BUYER || k === 'metodo_pago') && typeof v === 'string') out[k] = v;
  if (draft.entrega && typeof draft.entrega === 'object') {
    out.entrega = { ...EMPTY_ADDRESS };
    for (const k of ADDRESS_KEYS) if (typeof draft.entrega[k] === 'string') out.entrega[k] = draft.entrega[k];
  }
  return out;
}

export function useCheckout(config) {
  const store = useCarrito();
  const auth = useCuenta();
  const navigate = useNavigate();
  const modalidades = useMemo(() => config?.entrega_modalidades || [], [config]);
  const paises = useMemo(() => (Array.isArray(config?.paises_entrega) && config.paises_entrega.length ? config.paises_entrega : ['AR']), [config]);
  const [values, setValues] = useState(() => {
    const base = { ...EMPTY_BUYER, modalidad_entrega: modalidades.length === 1 ? modalidades[0].codigo : '', entrega: { ...EMPTY_ADDRESS }, id_direccion: '', metodo_pago: '' };
    return sanitizeDraft(readSession(DRAFT_KEY), base);
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [sending, setSending] = useState(false);
  const [website, setWebsite] = useState(''); // trampa para bots (campo oculto)
  const [opciones, setOpciones] = useState({ guardar_direccion: false, guardar_telefono: true, otroDestinatario: false });
  const [direcciones, setDirecciones] = useState({ cargando: false, lista: [], error: null });
  const sendingRef = useRef(false);
  const prefilledFor = useRef(null);

  const cliente = auth.autenticado ? auth.cliente : null;
  const clienteId = cliente?.id ?? null;

  useEffect(() => { writeSession(DRAFT_KEY, { ...values, id_direccion: undefined }); }, [values]);

  // Con sesión: completar datos reales del perfil (sin pisar lo que la persona ya escribió en esta compra).
  useEffect(() => {
    if (!cliente) { prefilledFor.current = null; return; }
    if (prefilledFor.current === cliente.id) {
      setValues((v) => (v.email === cliente.email ? v : { ...v, email: cliente.email }));
      return;
    }
    prefilledFor.current = cliente.id;
    setValues((v) => ({
      ...v,
      nombre: v.nombre || cliente.nombre || '',
      apellido: v.apellido || cliente.apellido || '',
      telefono: v.telefono || cliente.telefono || '',
      email: cliente.email,
    }));
    setErrors({});
  }, [cliente]);

  // Direcciones guardadas: se cargan con sesión y si alguna modalidad requiere domicilio.
  const algunaConDireccion = modalidades.some((m) => m.requiere_direccion);
  useEffect(() => {
    if (!clienteId || !algunaConDireccion) { setDirecciones({ cargando: false, lista: [], error: null }); return undefined; }
    const c = new AbortController();
    setDirecciones((d) => ({ ...d, cargando: true, error: null }));
    listarDirecciones(c.signal)
      .then((data) => {
        const lista = data.direcciones || [];
        setDirecciones({ cargando: false, lista, error: null });
        setValues((v) => {
          if (v.id_direccion && lista.some((d) => d.id === Number(v.id_direccion))) return v;
          const pred = lista.find((d) => d.predeterminada) || lista[0];
          return { ...v, id_direccion: pred ? pred.id : '' };
        });
      })
      .catch((error) => { if (error.name !== 'AbortError') setDirecciones({ cargando: false, lista: [], error }); });
    return () => c.abort();
  }, [clienteId, algunaConDireccion]);

  // Al cerrar sesión durante la compra se vuelve al domicilio escrito a mano.
  useEffect(() => { if (!clienteId) setValues((v) => (v.id_direccion ? { ...v, id_direccion: '' } : v)); }, [clienteId]);

  const setField = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }, []);

  const setEntrega = useCallback((patch) => {
    setValues((v) => ({ ...v, entrega: { ...v.entrega, ...patch } }));
    setErrors((e) => { const n = { ...e }; Object.keys(patch).forEach((k) => { delete n[`entrega_${k}`]; }); return n; });
  }, []);

  const setOpcion = useCallback((k, v) => {
    setOpciones((o) => ({ ...o, [k]: v }));
    if (k === 'otroDestinatario' && !v) setValues((s) => ({ ...s, entrega: { ...s.entrega, destinatario_nombre: '', destinatario_apellido: '', telefono: '' } }));
  }, []);

  const validationValues = useMemo(() => ({ ...values, id_direccion: clienteId ? values.id_direccion : '' }), [values, clienteId]);

  const validateField = useCallback((name) => {
    const all = validateBuyer(validationValues, modalidades, { paises });
    setErrors((e) => ({ ...e, [name]: all[name] }));
  }, [validationValues, modalidades, paises]);

  const enabled = Boolean(config?.checkout_habilitado);
  const totalEsperado = store.validacionVigente ? store.validation.resumen?.subtotal ?? null : null;
  const canSubmitBase = enabled && !sending && store.items.length > 0 && store.listoParaComprar && totalEsperado !== null && !auth.cargando;
  const modalidadActual = values.modalidad_entrega || (modalidades.length === 1 ? modalidades[0].codigo : '');
  const conDireccion = requiresAddress(modalidades, modalidadActual);

  // ---- Medio de pago: solo los que el servidor habilitó para la modalidad elegida ----
  const pagosOn = pagosActivos(config);
  const metodosPago = useMemo(() => metodosPara(config, modalidadActual), [config, modalidadActual]);
  const metodoInfo = metodosPago.find((m) => m.codigo === values.metodo_pago) || null;
  useEffect(() => {
    if (!pagosOn) return;
    const codigos = metodosPago.map((m) => m.codigo);
    setValues((v) => {
      if (v.metodo_pago && codigos.includes(v.metodo_pago)) return v;
      // El método elegido dejó de estar disponible (cambió la entrega): se limpia y se pide otro.
      if (v.metodo_pago && !codigos.includes(v.metodo_pago)) return { ...v, metodo_pago: codigos.length === 1 ? codigos[0] : '' };
      return codigos.length === 1 ? { ...v, metodo_pago: codigos[0] } : v;
    });
  }, [pagosOn, metodosPago]);
  const erroresPago = useCallback((v) => {
    if (!pagosOn) return {};
    if (!metodosPago.length) return { metodo_pago: 'No hay medios de pago disponibles para esta modalidad de entrega.' };
    return metodosPago.some((m) => m.codigo === v.metodo_pago) ? {} : { metodo_pago: 'Elegí un medio de pago.' };
  }, [pagosOn, metodosPago]);
  const canSubmit = canSubmitBase && (!pagosOn || metodosPago.length > 0);

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (sendingRef.current) return null; // doble clic: se ignora mientras hay un envío en curso
    setServerError(null);
    if (!enabled) {
      setServerError({ codigo: 'CHECKOUT_DESHABILITADO', mensaje: 'La compra online todavía no está habilitada en esta tienda.' });
      return null;
    }
    const errs = { ...validateBuyer(validationValues, modalidades, { paises }), ...erroresPago(values) };
    setErrors(errs);
    const firstInvalid = Object.keys(errs).find((k) => errs[k]);
    if (firstInvalid) {
      const target = firstInvalid.startsWith('entrega_') ? `entrega-${firstInvalid.slice(8)}` : `checkout-${firstInvalid}`;
      document.getElementById(target)?.focus();
      return null;
    }
    if (!store.listoParaComprar || totalEsperado === null) {
      await store.validarCarrito();
      setServerError({ codigo: 'CARRITO_NO_VALIDADO', mensaje: 'Actualizamos tu carrito con los datos vigentes. Revisalo y volvé a confirmar.' });
      return null;
    }
    const comprador = buyerPayload(validationValues, modalidades);
    const cuenta = clienteId ? { cuenta: 'CLIENTE', cliente_esperado: clienteId } : { cuenta: 'INVITADO' };
    const extras = clienteId ? {
      guardar_direccion: Boolean(conDireccion && !comprador.id_direccion && opciones.guardar_direccion),
      guardar_telefono: Boolean(!cliente?.telefono && opciones.guardar_telefono),
    } : {};
    const pago = pagosOn ? { metodo: values.metodo_pago } : undefined;
    const fingerprint = JSON.stringify([store.signature, comprador, totalEsperado, cuenta, pago || null]);
    const claveIdempotencia = idempotencyKeyFor(fingerprint);
    sendingRef.current = true;
    setSending(true);
    try {
      const data = await crearPedido({ claveIdempotencia, comprador, items: store.items, totalEsperado, website, pago, ...cuenta, ...extras });
      // Autorización temporal del invitado para su comprobante: solo en esta pestaña.
      if (data.autorizacion_comprobante) guardarAutorizacion(data.pedido.numero, data.autorizacion_comprobante);
      writeSession(CONFIRMATION_KEY, { ...data.pedido, perfil: data.perfil || null });
      writeSession(DRAFT_KEY, null);
      writeSession(ATTEMPT_KEY, null);
      if (data.perfil?.telefono_guardado && cliente) auth.actualizarCliente({ ...cliente, telefono: comprador.telefono, perfil_completo: true });
      store.clearItems();
      store.setCartOpen(false);
      navigate('/pedido/confirmado', { replace: true, state: { pedido: { ...data.pedido, perfil: data.perfil || null } } });
      return data;
    } catch (error) {
      const datos = error.datos || {};
      if (error.codigo === 'DATOS_COMPRADOR_INVALIDOS' && datos.errores) setErrors(datos.errores);
      if ((error.codigo === 'CARRITO_CON_PROBLEMAS' || error.codigo === 'PRECIOS_ACTUALIZADOS') && Array.isArray(datos.lineas)) {
        store.applyServerResult(datos.lineas, null);
        store.validarCarrito();
      }
      if (error.codigo === 'IDEMPOTENCIA_CONFLICTO') writeSession(ATTEMPT_KEY, null);
      let mensaje = error.message || 'No pudimos registrar el pedido.';
      if (error.codigo === 'SESION_EXPIRADA') {
        auth.marcarAnonimo();
        mensaje = 'Tu sesión venció. Podés volver a ingresar con Google o confirmar como invitado (tus datos siguen cargados).';
      } else if (error.codigo === 'SESION_CAMBIO' || error.codigo === 'CSRF_INVALIDO') {
        writeSession(ATTEMPT_KEY, null);
        await auth.refrescar();
        mensaje = error.codigo === 'SESION_CAMBIO'
          ? 'La cuenta con la que iniciaste sesión cambió en otra pestaña. Revisá tus datos y volvé a confirmar.'
          : 'Actualizamos tu sesión. Volvé a confirmar el pedido.';
      }
      setServerError({ codigo: error.codigo || 'ERROR', mensaje });
      return null;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [enabled, validationValues, modalidades, paises, store, totalEsperado, website, navigate, clienteId, cliente, conDireccion, opciones, auth, pagosOn, values.metodo_pago, erroresPago]);

  return {
    values, errors, setField, setEntrega, validateField, submit, sending, serverError, canSubmit, enabled, modalidades, paises,
    website, setWebsite, totalEsperado, cliente, direcciones, opciones, setOpcion, conDireccion,
    pagosOn, metodosPago, metodoInfo, modalidadActual, cuentaBancaria: config?.pagos?.cuenta_bancaria || null,
    mercadoPagoProximamente: pagosOn && config?.pagos?.mercado_pago?.proximamente === true,
  };
}
