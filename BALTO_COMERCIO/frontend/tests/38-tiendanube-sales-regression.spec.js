import { test, expect } from './support/test.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const sourcePath = (...parts) => path.resolve(process.cwd(), 'src', ...parts);

async function readSource(...parts) {
  return fs.readFile(sourcePath(...parts), 'utf8');
}

const API_PROBE = path.join(
  'modules', 'tiendanube', 'global', 'services', 'TnOrdenSyncService.php',
);

let apiRootCache;

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveApiSourceRoot() {
  if (apiRootCache !== undefined) return apiRootCache;

  const cwd = process.cwd();
  const candidates = [
    process.env.BALTO_API_SOURCE_DIR,
    path.resolve(cwd, 'api'),
    path.resolve(cwd, '..', 'api'),
    path.resolve(cwd, '..', 'backend'),
    path.resolve(cwd, '..', 'backend', 'api'),
    path.resolve(cwd, '..', '..', 'api'),
    path.resolve(cwd, '..', '..', 'backend'),
    path.resolve(cwd, '..', '..', 'backend', 'api'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'api'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'backend'),
    path.resolve(cwd, '..', '..', 'BALTO_COMERCIO', 'backend', 'api'),
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    if (await pathExists(path.join(candidate, API_PROBE))) {
      apiRootCache = candidate;
      return apiRootCache;
    }
  }

  apiRootCache = null;
  return null;
}

async function readApiSource(apiRoot, ...parts) {
  return fs.readFile(path.join(apiRoot, ...parts), 'utf8');
}

test('@tiendanube @regression las ventas importadas pueden facturarse sin duplicar movimiento/stock', async () => {
  const modal = await readSource(
    'components',
    'Mov_Subsection',
    'Ventas',
    'modales',
    'ModalNuevaVenta.jsx',
  );

  expect(modal).toContain('makeTiendaNubeArcaOperationKey');
  expect(modal).toContain('operacion_id_origen: esCompletarTiendaNube');
  expect(modal).toContain('operacion_key: operacionFiscalKey || undefined');
  expect(modal).toContain('accion_venta: esFacturadaFinal ? "facturar" : accionFinal');
  expect(modal).toContain('(!esCompletarTiendaNube || !tnTieneFacturaFiscal)');
  expect(modal).toContain('if (!esCompletarTiendaNube || !tnTieneRemito)');
  expect(modal).toContain('Venta de Tienda Nube completada y facturada correctamente.');

  expect(modal).not.toContain(
    'Primero completá la venta de Tienda Nube. Después podés facturarla desde el flujo habitual.',
  );
});

test('@tiendanube @regression los avisos pendientes usan cola FIFO, se minimizan y siguen accesibles', async () => {
  const ventas = await readSource(
    'components',
    'Mov_Subsection',
    'Ventas',
    'Ventas.jsx',
  );

  expect(ventas).toContain('getTiendaNubeNoticeKey');
  expect(ventas).toContain('tnPopupDismissedKeys');
  expect(ventas).toContain('tnPopupCollapsed');
  expect(ventas).toContain('ventasTiendaNubePendientesVisibles');
  expect(ventas).toContain('return aId - bId');
  expect(ventas).toContain('más en cola');
  expect(ventas).toContain('onClose={() => setTnPopupCollapsed(true)}');
  expect(ventas).toContain('onRestore={() => setTnPopupCollapsed(false)}');
  expect(ventas).toContain('dismissConfirmTitle="¿Cerrar este aviso de Tienda Nube?"');
  expect(ventas).toContain('prev.includes(key) ? prev : [...prev, key].slice(-100)');
  expect(ventas).not.toContain('title="Completar venta de Tienda Nube"');

  expect(ventas).not.toContain('tnPopupDismissedSignature');
  expect(ventas).not.toContain('tnPendingSignature');
});

test('@tiendanube @regression ocultar un aviso no equivale a descartarlo', async () => {
  const notice = await readSource(
    'components',
    'Global',
    'GlobalFloatingNotice.jsx',
  );

  expect(notice).toContain('collapsedLabel = "Aviso pendiente"');
  expect(notice).toContain('className="gfn-tab"');
  expect(notice).toContain('aria-label="Ocultar aviso"');
  expect(notice).toContain('setConfirmDismiss(true)');
  expect(notice).toContain('role="dialog"');
  expect(notice).toContain('aria-modal="true"');
  expect(notice).toContain('onDismiss();');
});


test('@tiendanube @regression órdenes simultáneas no pierden el movimiento y el stock autoritativo puede reconciliarse', async () => {
  const apiRoot = await resolveApiSourceRoot();
  if (!apiRoot) {
    test.skip(true, 'No hay checkout local del API PHP. Definí BALTO_API_SOURCE_DIR si querés ejecutar también las aserciones estáticas de backend.');
    return;
  }

  const dbHelper = await readApiSource(apiRoot,
    'modules', 'tiendanube', 'global', 'helpers', 'TnDbHelper.php',
  );
  const ordenSync = await readApiSource(apiRoot,
    'modules', 'tiendanube', 'global', 'services', 'TnOrdenSyncService.php',
  );
  const productoSync = await readApiSource(apiRoot,
    'modules', 'tiendanube', 'global', 'services', 'TnProductoSyncService.php',
  );

  expect(dbHelper).toContain('private static $lastInsertId = 0;');
  expect(dbHelper).toContain('self::$lastInsertId = (int)$pdo->lastInsertId();');
  expect(dbHelper).toContain('return self::$lastInsertId;');

  expect(ordenSync).toContain("$insertCliente = $pdo->prepare('INSERT INTO clientes");
  expect(ordenSync).toContain('$id = (int)$pdo->lastInsertId();');
  expect(ordenSync).toContain('$matches = $this->clientesPorNombreCanonico($canonical);');

  expect(productoSync).toContain('reconcileRemoteStockOnlyExistingMappings');
  expect(productoSync).toContain("'TN_STOCK_RECONCILE_ONLY'");
  expect(productoSync).toContain("'reconciliacion_stock' => $stockOnly");
});

test('@tiendanube @regression cada orden conserva su cliente aunque el perfil customer cambie', async () => {
  const apiRoot = await resolveApiSourceRoot();
  if (!apiRoot) {
    test.skip(true, 'No hay checkout local del API PHP. Definí BALTO_API_SOURCE_DIR si querés ejecutar también las aserciones estáticas de backend.');
    return;
  }

  const ordenSync = await readApiSource(apiRoot,
    'modules', 'tiendanube', 'global', 'services', 'TnOrdenSyncService.php',
  );
  const ventasRepo = await readApiSource(apiRoot,
    'modules', 'movimientos', 'ventas', 'repositories', 'VentasRepository.php',
  );
  const ventasService = await readApiSource(apiRoot,
    'modules', 'movimientos', 'ventas', 'services', 'VentasService.php',
  );
  const ventas = await readSource(
    'components', 'Mov_Subsection', 'Ventas', 'Ventas.jsx',
  );

  const contactPos = ordenSync.indexOf("array('contact_name', 'billing_name', 'customer_name')");
  const customerPos = ordenSync.indexOf("array('shipping_address', 'billing_address', 'contact', 'customer')");
  expect(contactPos).toBeGreaterThan(-1);
  expect(customerPos).toBeGreaterThan(contactPos);
  expect(ordenSync).toContain('reconciliarClienteMovimientoExistente');
  expect(ordenSync).toContain("'cliente_venta_tienda_nube_reconciliado'");

  expect(ventasRepo).toContain('nombreClienteSnapshotTiendaNube');
  expect(ventasRepo).toContain("$row['tn_cliente_nombre'] = $snapshot;");
  expect(ventasRepo).toContain("$row['cliente'] = $snapshot;");
  expect(ventasRepo).toContain('tns.payload_json AS tn_payload_json');
  expect(ventasRepo).toContain('tns.payload_json LIKE :q_tn_cliente');
  expect(ventasRepo).toContain('resolverClienteSnapshotTiendaNube');
  expect(ventasService).toContain("$preservarClienteOrden = mov_is_truthy($data['preservar_cliente_tienda_nube'] ?? false);");
  expect(ventasService).toContain('$this->ventas->resolverClienteSnapshotTiendaNube($preview)');
  expect(ventas).toContain('r?.tn_cliente_nombre ?? r?.cliente');
});

test('@tiendanube @regression facturar una orden TN no renombra ni fiscaliza al cliente operativo', async () => {
  const modal = await readSource(
    'components', 'Mov_Subsection', 'Ventas', 'modales', 'ModalNuevaVenta.jsx',
  );

  expect(modal).toContain('CUIT validado. Se usará solo para esta factura.');
  expect(modal).toContain('await abrirResumenFactura(fiscalFactura, tiendaNubeClienteOperativo);');
  expect(modal).toContain('if (esCompletarTiendaNube) {');
  expect(modal).toContain('setFiscalPanelOpen(true);');
  expect(modal).toContain('tiendaNubeClientePdf');
  expect(modal).toContain('tiendaNubeClienteNombreOperativo');
  expect(modal).toContain('preservar_cliente_tienda_nube: 1');
  expect(modal).toContain('El CUIT se usará solo como receptor de esta factura y no cambiará el cliente de la venta.');

  // El guardado fiscal con actualizar_nombre_cliente=true sigue existiendo para ventas
  // normales, pero la rama TN retorna antes de ejecutarlo.
  const tnBranch = modal.indexOf('CUIT validado. Se usará solo para esta factura.');
  const persistentSave = modal.indexOf('const result = await guardarClienteFiscalDesdeArca(fiscal, {', tnBranch);
  expect(tnBranch).toBeGreaterThan(-1);
  expect(persistentSave).toBeGreaterThan(tnBranch);
  expect(modal.slice(tnBranch, persistentSave)).toContain('return;');
});

test('@tiendanube @regression el remito TN conserva el nombre de la orden y no el receptor fiscal ARCA', async () => {
  const modal = await readSource(
    'components', 'Mov_Subsection', 'Ventas', 'modales', 'ModalNuevaVenta.jsx',
  );

  expect(modal).toContain('const clienteFiscalPdf = esCompletarTiendaNube');
  expect(modal).toContain('? tiendaNubeClientePdf');
  expect(modal).toContain('labelCliente: esCompletarTiendaNube');
  expect(modal).toContain('tiendaNubeClienteNombreOperativo || baseData.labelCliente || "Cliente"');
  expect(modal).toContain(': (baseData.cliente_facturacion || clienteFiscalPdf)');
});

