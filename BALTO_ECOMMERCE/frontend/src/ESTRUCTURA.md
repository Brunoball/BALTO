# BALTO eCommerce — estructura del frontend

Todo vive dentro de `componentes/`, una carpeta por módulo (igual que BALTO Comercio).
Cada módulo tiene sus propias carpetas `api/` (llamadas a la API), `hooks/`, `contexto/`
y `utilidades/` cuando las necesita. En la raíz de `src/` solo quedan los archivos que exige
Create React App.

```
src/
├── index.js / index.css          Punto de entrada (CRA)
├── Aplicacion.jsx / aplicacion.css  Rutas y orden de los estilos de cada módulo
├── setupProxy.js                 Proxy /ecom-api de `npm start` (CRA)
├── setupTests.js                 Configuración de Jest (CRA)
├── medirRendimiento.js
└── componentes/
    ├── global/          Compartido: api/clienteApi.js (HTTP + CSRF), configuracion/baltoConfig.js,
    │                    utilidades/ (formato, estadoPedido), estilos/ (variables, adaptable),
    │                    Estados, SelectorCantidad, SubirAlInicio, TituloSeccion, PaginaNoEncontrada
    ├── tienda/          api/tiendaApi.js · hooks/useTienda.js
    ├── estructura/      Encabezado, PiePagina, BarraAnuncios, PaginaContacto
    ├── inicio/          PaginaInicio y sus secciones
    ├── catalogo/        PaginaCatalogo, PaginaFavoritos, Filtros, Grilla, Tarjeta · api/ · hooks/ · utilidades/
    ├── producto/        PaginaProducto, GaleriaProducto, InfoProducto
    ├── carrito/         PaginaCarrito, PanelCarrito, LineaCarrito, AvisosCarrito · api/ · contexto/ · hooks/ · utilidades/
    ├── checkout/        PaginaCheckout, PaginaPedidoConfirmado, FormularioCheckout, ResumenPedido · api/ · hooks/ · utilidades/
    ├── pagos/           SelectorMedioPago, DatosTransferencia, EstadoDelPago, CargaComprobante · api/ · utilidades/
    ├── autenticacion/   PaginaIngreso, BotonGoogle, RequiereSesion · api/ · hooks/ · utilidades/
    ├── cuenta/          Mis datos, direcciones y pedidos · api/cuentaApi.js · contexto/CuentaContext.jsx
    └── direccion/       CamposDireccion (único componente de domicilio) · api/geografiaApi.js · utilidades/
```

Cada módulo del frontend corresponde a un módulo del backend (`api/modules/<modulo>/rutas.php`).
Los tests E2E (`tests/14-cobertura-acciones.spec.js`) verifican esta estructura.
