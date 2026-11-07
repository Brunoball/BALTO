// API SIMULADA para probar la interfaz sin escribir en la base (como las pruebas "UI con
// interceptación" de Comercio). Intercepta SOLO las acciones pedidas y responde con el MISMO
// formato que el backend real (capturado de routes/api.php). El resto va al servidor real.
//
// Uso:
//   const sim = await simularApi(page, { tienda: { checkout: true, pagos: true, cuentas: true }, cuenta: { logueado: true } });
//   ...
//   expect(sim.llamadas('cliente_actualizar')[0].headers['x-csrf-token']).toBe(sim.csrf);
const crypto = require('node:crypto');
const { ENV } = require('./entorno');

const CLIENT_ID = '000000000000-simulado-e2e.apps.googleusercontent.com';
const hex = (n) => crypto.randomBytes(n).toString('hex');
const ahora = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const numeroPedido = () => `T-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('base64').replace(/[^A-Z2-9]/gi, '').toUpperCase().replace(/[01IO]/g, 'X').padEnd(8, 'Z').slice(0, 8)}`;

const CUENTA_BANCARIA = { id: 1, entidad: 'Banco Simulado', titular: 'Comercio de Prueba', cuit_titular: null, cbu_cvu: '0110001355555555555555', tipo: 'CBU', alias: 'comercio.simulado', moneda: 'ARS', instrucciones: null };
const PAGOS_ACTIVOS = {
  activo: true, estado: 'ACTIVO',
  metodos_por_modalidad: {
    RETIRO: [{ codigo: 'TRANSFERENCIA_BANCARIA', alcance: 'TOTAL' }, { codigo: 'EFECTIVO', alcance: 'TOTAL' }],
    ENVIO: [{ codigo: 'TRANSFERENCIA_BANCARIA', alcance: 'PRODUCTOS' }, { codigo: 'EFECTIVO', alcance: 'TOTAL' }],
  },
  cuenta_bancaria: CUENTA_BANCARIA, transferencia_envio: 'SOLO_PRODUCTOS',
  mercado_pago: { disponible: false, proximamente: false },
  comprobante: { tipos: ['jpg', 'png', 'webp', 'pdf'], max_bytes: 5 * 1024 * 1024 },
};
const ENTREGAS = [
  { codigo: 'RETIRO', nombre: 'Retiro en el local', detalle: 'Local de prueba', requiere_direccion: false },
  { codigo: 'ENVIO', nombre: 'Envío a domicilio', detalle: null, requiere_direccion: true },
];

function clienteBase(extra = {}) {
  return { id: 7001, nombre: 'Compradora', apellido: 'Simulada', email: 'compradora.simulada@example.com', email_verificado: true, telefono: null,
    proveedores: ['GOOGLE'], id_direccion_predeterminada: null, perfil_completo: false, cliente_desde: '2026-01-15', ...extra };
}

function pagoTransferencia(importe, alcance = 'TOTAL') {
  return { metodo: 'TRANSFERENCIA_BANCARIA', estado: 'PENDIENTE', estado_comprobante: 'SIN_ENVIAR', importe, moneda: 'ARS', alcance,
    destino: CUENTA_BANCARIA, puede_subir_comprobante: true, comprobantes: [], pagado_en: null };
}
const pagoEfectivo = (importe) => ({ metodo: 'EFECTIVO', estado: 'PENDIENTE', estado_comprobante: null, importe, moneda: 'ARS', alcance: 'TOTAL', destino: null, puede_subir_comprobante: false, comprobantes: [], pagado_en: null });

function pedidoEjemplo(n, extra = {}) {
  const total = (1000 * n).toFixed(2);
  return {
    numero: `T-260101-SIMUL${String(n).padStart(3, '0')}`, fecha: `2026-01-${String(10 + n).padStart(2, '0')} 10:00:00`, estado: 'PENDIENTE', estado_pago: 'PENDIENTE',
    moneda: 'ARS', subtotal: total, descuento: '0.00', costo_envio: null, total, modalidad_entrega: 'RETIRO',
    contacto: { nombre: 'Compradora Simulada', email: 'compradora.simulada@example.com', telefono: '3515550000' }, entrega: null, observaciones: null,
    metodo_pago: 'TRANSFERENCIA_BANCARIA', pago: pagoTransferencia(total),
    items: [{ nombre: `Producto simulado ${n}`, variante: null, sku: `SIM-${n}`, cantidad: '1.000', precio_unitario: total, total }],
    es_prueba: true, ...extra,
  };
}
const resumenPedido = (p) => ({ numero: p.numero, fecha: p.fecha, estado: p.estado, estado_pago: p.estado_pago, moneda: p.moneda, total: p.total,
  modalidad_entrega: p.modalidad_entrega, metodo_pago: p.metodo_pago, estado_comprobante: p.pago?.estado_comprobante ?? null,
  cantidad_lineas: p.items.length, productos: p.items.map((i) => ({ nombre: i.nombre, variante: i.variante, cantidad: i.cantidad })), es_prueba: p.es_prueba });
const pedidoPago = (p) => ({ numero: p.numero, estado: p.estado, estado_pago: p.estado_pago, metodo_pago: p.metodo_pago, modalidad_entrega: p.modalidad_entrega, total: p.total, moneda: p.moneda, creado_en: p.fecha });

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} op
 *   tienda:  { checkout?, modo?, pagos?, cuentas?, entregas? }  (undefined = valor real del servidor)
 *   cuenta:  { logueado, cliente?, direcciones?, pedidos? } | null  (null = acciones de cuenta van al servidor real)
 *   checkout: simular checkout_crear (por defecto true si tienda.checkout === true)
 *   google:  simular Google Identity Services + auth_nonce/auth_google
 *   fallar:  { accion: { status, codigo, mensaje } }  respuestas de error forzadas
 */
async function simularApi(page, op = {}) {
  const t = op.tienda || {};
  const llamadasLog = [];
  const estado = {
    logueado: Boolean(op.cuenta?.logueado),
    cliente: clienteBase(op.cuenta?.cliente),
    direcciones: (op.cuenta?.direcciones || []).map((d, i) => ({ id: 9100 + i, ...d })),
    pedidos: op.cuenta?.pedidos || [],
    ultimoCarrito: null,
    nonce: null,
    sigDireccion: 9500,
  };
  const csrf = hex(32);
  const simularCuenta = op.cuenta !== undefined && op.cuenta !== null;
  const simularCheckout = op.checkout ?? (t.checkout === true);
  const simularPagos = op.pagos ?? (simularCheckout || simularCuenta);

  const sincronizarPredeterminada = () => {
    if (estado.direcciones.length && !estado.direcciones.some((d) => d.predeterminada)) estado.direcciones[0].predeterminada = true;
    const pred = estado.direcciones.find((d) => d.predeterminada);
    estado.cliente.id_direccion_predeterminada = pred ? pred.id : null;
  };
  sincronizarPredeterminada();
  const listaDirecciones = () => estado.direcciones.map(({ ...d }) => d);
  const cuentasCfg = () => ({ habilitadas: true, google_client_id: CLIENT_ID, proveedores: ['GOOGLE'] });

  if (op.google) {
    await page.route(/accounts\.google\.com\/gsi\/client/, (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.google = { accounts: { id: {
        initialize(cfg) { window.__gisConfig = cfg; },
        renderButton(el) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Continuar con Google (simulado)';
          b.onclick = () => window.__gisConfig.callback({ credential: 'credencial.simulada.' + window.__gisConfig.nonce }); el.appendChild(b); },
        prompt() {}, disableAutoSelect() {}, cancel() {} } } };`,
    }));
  }

  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
  const error = (route, status, codigo, mensaje) => json(route, status, { exito: false, codigo, mensaje, request_id: 'e2e-simulado' });
  const exigirSesion = (route) => { if (!estado.logueado) { error(route, 401, 'SESION_REQUERIDA', 'Iniciá sesión para continuar.'); return false; } return true; };
  const exigirCsrf = (route, req) => {
    if (req.headers()['x-csrf-token'] !== csrf) { error(route, 403, 'CSRF_INVALIDO', 'La sesión no pudo verificarse. Recargá la página e intentá de nuevo.'); return false; }
    return true;
  };
  const buscarPedido = (numero) => estado.pedidos.find((p) => p.numero === numero);

  await page.route(/\/ecom-api\?/, async (route) => {
    try {
      return await manejar(route);
    } catch (error) {
      // El test ya terminó o la página se cerró con un pedido en vuelo: no es un fallo de la web.
      if (/Test ended|Target page, context or browser has been closed|Route is already handled/i.test(String(error?.message))) return undefined;
      throw error;
    }
  });

  async function manejar(route) {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action');
    const p = Object.fromEntries(url.searchParams);
    let body = {};
    try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
    llamadasLog.push({ action, metodo: req.method(), headers: req.headers(), body, params: p });

    const forzado = op.fallar?.[action];
    if (forzado) return error(route, forzado.status || 500, forzado.codigo || 'ERROR_SIMULADO', forzado.mensaje || 'Error simulado.');

    // --- Tienda: config real + ajustes pedidos por el test ---
    if (action === 'tienda_configuracion' && Object.keys(t).length) {
      const real = await route.fetch();
      const data = await real.json();
      const c = data.configuracion || {};
      if (t.checkout !== undefined) Object.assign(c, { checkout_habilitado: t.checkout, checkout_modo: t.checkout ? (t.modo || 'PRUEBA') : null, checkout_bloqueo: t.checkout ? null : (t.bloqueo ?? null) });
      if (t.entregas !== undefined || t.checkout) c.entrega_modalidades = (t.entregas || ['RETIRO', 'ENVIO']).map((k) => ENTREGAS.find((e) => e.codigo === k));
      if (t.pagos !== undefined) c.pagos = t.pagos ? JSON.parse(JSON.stringify(PAGOS_ACTIVOS)) : { activo: false, estado: 'DESACTIVADO' };
      if (t.cuentas !== undefined) c.cuentas = t.cuentas ? cuentasCfg() : { habilitadas: false, google_client_id: null, proveedores: [] };
      if (t.config) Object.assign(c, t.config);
      c.paises_entrega = c.paises_entrega || ['AR'];
      return route.fulfill({ response: real, json: { ...data, configuracion: c } });
    }

    // --- Carrito: siempre real; se guarda la validación para armar el pedido simulado ---
    if (action === 'carrito_validar' && simularCheckout) {
      const real = await route.fetch();
      try { estado.ultimoCarrito = await real.json(); } catch (_) {}
      return route.fulfill({ response: real });
    }

    // --- Sesión / Google ---
    if (simularCuenta || op.google) {
      if (action === 'auth_sesion') {
        return json(route, 200, estado.logueado
          ? { exito: true, autenticado: true, cliente: estado.cliente, csrf, expira_en: '2099-01-01T00:00:00+00:00', cuentas: cuentasCfg() }
          : { exito: true, autenticado: false, cuentas: cuentasCfg() });
      }
      if (action === 'auth_nonce') { estado.nonce = hex(32); return json(route, 200, { exito: true, nonce: estado.nonce, client_id: CLIENT_ID, expira_en_segundos: 600 }); }
      if (action === 'auth_google') {
        if (body.credential !== `credencial.simulada.${estado.nonce}`) return error(route, 400, 'TOKEN_INVALIDO', 'No pudimos validar tu cuenta de Google.');
        estado.logueado = true; estado.nonce = null;
        return json(route, 201, { exito: true, autenticado: true, nuevo: false, cliente: estado.cliente, csrf, expira_en: '2099-01-01T00:00:00+00:00' });
      }
      if (action === 'auth_logout') { estado.logueado = false; return json(route, 200, { exito: true, autenticado: false, mensaje: 'Cerraste sesión.' }); }
    }

    // --- Cuenta del comprador ---
    if (simularCuenta && action.startsWith('cliente_')) {
      if (!exigirSesion(route)) return undefined;
      if (req.method() === 'POST' && !exigirCsrf(route, req)) return undefined;
      switch (action) {
        case 'cliente_perfil': return json(route, 200, { exito: true, cliente: estado.cliente });
        case 'cliente_actualizar': {
          const letras = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' ]{2,100}$/;
          const errores = {};
          if (!letras.test(String(body.nombre || ''))) errores.nombre = 'Ingresá tu nombre (solo letras).';
          if (!letras.test(String(body.apellido || ''))) errores.apellido = 'Ingresá tu apellido (solo letras).';
          if (Object.keys(errores).length) return json(route, 422, { exito: false, codigo: 'DATOS_INVALIDOS', mensaje: 'Revisá tus datos.', errores });
          Object.assign(estado.cliente, { nombre: body.nombre, apellido: body.apellido, telefono: body.telefono || null, perfil_completo: Boolean(body.telefono) });
          return json(route, 200, { exito: true, mensaje: 'Guardamos tus datos.', cliente: estado.cliente });
        }
        case 'cliente_direcciones': return json(route, 200, { exito: true, direcciones: listaDirecciones(), maximo: 20, paises: ['AR'] });
        case 'cliente_direccion_guardar': {
          const campos = ['etiqueta', 'destinatario_nombre', 'destinatario_apellido', 'telefono', 'pais', 'provincia', 'provincia_id', 'localidad', 'localidad_id', 'codigo_postal', 'calle', 'altura', 'piso_depto', 'referencias'];
          const d = Object.fromEntries(campos.map((k) => [k, body[k] ?? null]));
          let id = Number(body.id) || null;
          if (id) {
            const actual = estado.direcciones.find((x) => x.id === id);
            if (!actual) return error(route, 404, 'DIRECCION_NO_ENCONTRADA', 'La dirección no existe.');
            Object.assign(actual, d, { actualizado_en: ahora() });
          } else {
            id = ++estado.sigDireccion;
            estado.direcciones.unshift({ id, ...d, predeterminada: false, actualizado_en: ahora() });
          }
          if (body.predeterminada) estado.direcciones.forEach((x) => { x.predeterminada = x.id === id; });
          sincronizarPredeterminada();
          return json(route, Number(body.id) ? 200 : 201, { exito: true, mensaje: Number(body.id) ? 'Dirección actualizada.' : 'Dirección guardada.', id, direcciones: listaDirecciones() });
        }
        case 'cliente_direccion_eliminar': {
          const antes = estado.direcciones.length;
          estado.direcciones = estado.direcciones.filter((x) => x.id !== Number(body.id));
          if (antes === estado.direcciones.length) return error(route, 404, 'DIRECCION_NO_ENCONTRADA', 'La dirección no existe.');
          sincronizarPredeterminada();
          return json(route, 200, { exito: true, direcciones: listaDirecciones() });
        }
        case 'cliente_direccion_predeterminada': {
          if (!estado.direcciones.some((x) => x.id === Number(body.id))) return error(route, 404, 'DIRECCION_NO_ENCONTRADA', 'La dirección no existe.');
          estado.direcciones.forEach((x) => { x.predeterminada = x.id === Number(body.id); });
          sincronizarPredeterminada();
          return json(route, 200, { exito: true, direcciones: listaDirecciones() });
        }
        case 'cliente_pedidos': {
          const pagina = Math.max(1, Number(p.pagina) || 1); const limite = Math.max(1, Number(p.limite) || 10);
          const lista = estado.pedidos.slice((pagina - 1) * limite, pagina * limite).map(resumenPedido);
          return json(route, 200, { exito: true, pedidos: lista, paginacion: { pagina, limite, total: estado.pedidos.length, paginas: Math.max(1, Math.ceil(estado.pedidos.length / limite)) } });
        }
        case 'cliente_pedido_detalle': {
          const ped = buscarPedido(p.numero);
          if (!ped) return error(route, 404, 'PEDIDO_NO_ENCONTRADO', 'No encontramos ese pedido.');
          const { fecha, token: _token, ...resto } = ped;
          return json(route, 200, { exito: true, pedido: { ...resto, fecha } });
        }
        default: break;
      }
    }

    // --- Checkout simulado: no se crea ningún pedido real ---
    if (simularCheckout && action === 'checkout_crear') {
      const lineas = estado.ultimoCarrito?.lineas || [];
      const total = String(body.total_esperado ?? estado.ultimoCarrito?.resumen?.subtotal ?? '0.00');
      const comprador = body.comprador || {};
      const metodo = body.pago?.metodo || null;
      const alcance = metodo === 'TRANSFERENCIA_BANCARIA' && comprador.modalidad_entrega === 'ENVIO' ? 'PRODUCTOS' : 'TOTAL';
      const pedido = {
        numero: numeroPedido(), fecha: ahora(), estado: 'PENDIENTE', estado_pago: 'PENDIENTE', moneda: 'ARS', subtotal: total, descuento: '0.00', costo_envio: null, total,
        modalidad_entrega: comprador.modalidad_entrega || 'A_COORDINAR',
        contacto: { nombre: `${comprador.nombre || ''} ${comprador.apellido || ''}`.trim(), email: comprador.email || estado.cliente.email, telefono: comprador.telefono || null },
        entrega: comprador.entrega ? {
          direccion: [[comprador.entrega.calle, comprador.entrega.altura].filter(Boolean).join(' '), comprador.entrega.piso_depto].filter(Boolean).join(', '),
          localidad: comprador.entrega.localidad || null, provincia: comprador.entrega.provincia || null, codigo_postal: comprador.entrega.codigo_postal || null,
          pais: comprador.entrega.pais || 'AR', destinatario: null, telefono: comprador.entrega.telefono || null, referencias: comprador.entrega.referencias || null,
        } : null,
        observaciones: comprador.observaciones || null,
        metodo_pago: metodo, pago: metodo === 'TRANSFERENCIA_BANCARIA' ? pagoTransferencia(total, alcance) : metodo === 'EFECTIVO' ? pagoEfectivo(total) : null,
        items: lineas.map((l) => ({ nombre: l.nombre, variante: l.variante, sku: l.sku, cantidad: l.cantidad, precio_unitario: l.precio_unitario, total: l.subtotal })),
        es_prueba: true,
      };
      const conCuenta = body.cuenta === 'CLIENTE';
      if (conCuenta) { if (!exigirSesion(route)) return undefined; if (!exigirCsrf(route, req)) return undefined; }
      estado.pedidos.unshift(pedido);
      const token = conCuenta ? null : hex(32);
      if (token) pedido.token = token;
      return json(route, 201, {
        exito: true, reintento: false, mensaje: 'Recibimos tu pedido. La tienda se comunicará para confirmarlo, coordinar la entrega y el pago.',
        pedido: { numero: pedido.numero, estado: 'PENDIENTE', estado_pago: 'PENDIENTE', moneda: 'ARS', subtotal: total, descuento: '0.00', costo_envio: null, total,
          modalidad_entrega: pedido.modalidad_entrega, comprador_nombre: pedido.contacto.nombre, comprador_email: pedido.contacto.email, creado_en: pedido.fecha,
          items: pedido.items, es_prueba: true, cuenta: conCuenta, metodo_pago: metodo, pago: pedido.pago },
        tienda: { idTienda: 0, dominio: ENV.tienda, nombre: 'SIMULADA', sistema: 'COMERCIO' },
        ...(token ? { autorizacion_comprobante: { token, expira_en: '2099-01-01T00:00:00+00:00' } } : {}),
        ...(conCuenta ? { perfil: { direccion_guardada: Boolean(body.guardar_direccion), telefono_guardado: Boolean(body.guardar_telefono) } } : {}),
      });
    }

    // --- Pagos del pedido ---
    if (simularPagos && ['pago_detalle_pedido', 'pago_comprobante_estado', 'pago_comprobante_subir', 'pago_comprobante_descargar'].includes(action)) {
      const ped = buscarPedido(p.numero);
      const tokenEnviado = req.headers()['x-ecom-pedido-token'];
      if (!ped) return error(route, 404, 'PEDIDO_NO_ENCONTRADO', 'No encontramos ese pedido.');
      const autorizado = (ped.token && tokenEnviado === ped.token) || (!ped.token && estado.logueado);
      if (!autorizado) return error(route, 401, tokenEnviado ? 'AUTORIZACION_INVALIDA' : 'AUTORIZACION_REQUERIDA', 'Iniciá sesión o usá el enlace de tu compra para continuar.');
      if (action === 'pago_comprobante_descargar') {
        const c = ped.pago?.comprobantes?.find((x) => String(x.id) === String(p.id));
        if (!c) return error(route, 404, 'COMPROBANTE_NO_ENCONTRADO', 'No encontramos el comprobante.');
        return route.fulfill({ status: 200, contentType: c.tipo, headers: { 'content-disposition': `attachment; filename="${c.nombre}"` }, body: Buffer.from('comprobante-simulado') });
      }
      if (action === 'pago_comprobante_subir') {
        if (!tokenEnviado && !exigirCsrf(route, req)) return undefined;
        if (!ped.pago?.puede_subir_comprobante) return error(route, 409, 'COMPROBANTE_EN_REVISION', 'Ya enviaste un comprobante que está en revisión.');
        const crudo = req.postDataBuffer() || Buffer.alloc(0);
        const nombre = /filename="([^"]+)"/.exec(crudo.toString('latin1'))?.[1] || 'comprobante';
        const tipo = /Content-Type: ([^\r\n]+)/i.exec(crudo.toString('latin1'))?.[1] || 'application/octet-stream';
        Object.assign(ped.pago, { estado: 'EN_REVISION', estado_comprobante: 'PENDIENTE', puede_subir_comprobante: false });
        ped.estado_pago = 'EN_REVISION';
        ped.pago.comprobantes = [{ id: 1, nombre, tipo, tamano_bytes: crudo.length, estado: 'PENDIENTE', subido_en: ahora(), revisado_en: null, motivo_rechazo: null }];
        return json(route, 201, { exito: true, mensaje: 'Recibimos tu comprobante. Tu pago está pendiente de verificación.', pedido: pedidoPago(ped), pago: ped.pago });
      }
      return json(route, 200, { exito: true, pedido: pedidoPago(ped), pago: ped.pago });
    }

    return route.fallback();
  }

  return {
    csrf,
    estado,
    CLIENT_ID,
    llamadas: (accion) => llamadasLog.filter((l) => !accion || l.action === accion),
  };
}

module.exports = { simularApi, pedidoEjemplo, clienteBase, CUENTA_BANCARIA, PAGOS_ACTIVOS, CLIENT_ID };
