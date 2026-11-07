// Catálogo de TODAS las acciones de la API que usa la web (routes/api.php -> EC_ACCIONES).
// 14-cobertura-acciones.spec.js compara este catálogo con el código del frontend y con los specs:
// si alguien agrega una acción nueva y no la prueba, la suite falla.
//
// tipo: 'publica'  -> responde sin sesión
//       'sesion'   -> viaja con cookie (credentials: include) pero no exige sesión
//       'privada'  -> exige sesión de comprador (401 SESION_REQUERIDA sin cookie)
//       'pedido'   -> exige sesión o el token temporal del pedido (X-Ecom-Pedido-Token)
const ACCIONES = {
  ping:                             { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'global' },
  tienda_configuracion:             { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'tienda' },
  tienda_estado:                    { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'tienda' },
  catalogo_productos:               { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'catalogo' },
  catalogo_producto:                { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'catalogo' },
  producto_imagen:                  { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'catalogo' },
  carrito_validar:                  { metodo: 'POST', tipo: 'publica', credenciales: false, modulo: 'carrito' },
  checkout_crear:                   { metodo: 'POST', tipo: 'sesion',  credenciales: true,  modulo: 'checkout' },
  auth_nonce:                       { metodo: 'GET',  tipo: 'sesion',  credenciales: true,  modulo: 'autenticacion' },
  auth_google:                      { metodo: 'POST', tipo: 'sesion',  credenciales: true,  modulo: 'autenticacion' },
  auth_sesion:                      { metodo: 'GET',  tipo: 'sesion',  credenciales: true,  modulo: 'autenticacion' },
  auth_logout:                      { metodo: 'POST', tipo: 'sesion',  credenciales: true,  modulo: 'autenticacion' },
  cliente_perfil:                   { metodo: 'GET',  tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_actualizar:               { metodo: 'POST', tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_direcciones:              { metodo: 'GET',  tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_direccion_guardar:        { metodo: 'POST', tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_direccion_eliminar:       { metodo: 'POST', tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_direccion_predeterminada: { metodo: 'POST', tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_pedidos:                  { metodo: 'GET',  tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  cliente_pedido_detalle:           { metodo: 'GET',  tipo: 'privada', credenciales: true,  modulo: 'cuenta' },
  geografia_provincias:             { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'direccion' },
  geografia_localidades:            { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'direccion' },
  pagos_metodos_disponibles:        { metodo: 'GET',  tipo: 'publica', credenciales: false, modulo: 'pagos' },
  pago_detalle_pedido:              { metodo: 'GET',  tipo: 'pedido',  credenciales: true,  modulo: 'pagos' },
  pago_comprobante_estado:          { metodo: 'GET',  tipo: 'pedido',  credenciales: true,  modulo: 'pagos' },
  pago_comprobante_subir:           { metodo: 'POST', tipo: 'pedido',  credenciales: true,  modulo: 'pagos' },
  pago_comprobante_descargar:       { metodo: 'GET',  tipo: 'pedido',  credenciales: true,  modulo: 'pagos' },
};

/** Acciones que el backend expone pero la web no llama (solo diagnóstico/servidor). */
// producto_imagen: la web no la llama por nombre; la usa a través de imagen_url que arma el servidor.
const SOLO_BACKEND = new Set(['ping', 'tienda_estado', 'pago_comprobante_estado', 'producto_imagen']);

module.exports = { ACCIONES, SOLO_BACKEND };
