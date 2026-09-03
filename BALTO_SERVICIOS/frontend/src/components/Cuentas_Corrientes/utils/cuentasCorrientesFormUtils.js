export function notifyGlobalListasUpdated(kind = "listas") {
  try {
    window.dispatchEvent(new CustomEvent("balto:listas-updated", { detail: { kind } }));
    if (kind === "clientes") window.dispatchEvent(new CustomEvent("balto:clientes-updated"));
    if (kind === "proveedores") window.dispatchEvent(new CustomEvent("balto:proveedores-updated"));
  } catch {
    try { window.dispatchEvent(new Event("balto:listas-updated")); } catch {}
  }
}

export function isTemaOscuro() {
  return (
    document.documentElement.getAttribute("data-theme") === "oscuro" ||
    document.body?.classList?.contains("dark")
  );
}

export function toUpperValue(value) {
  return String(value || "").toUpperCase();
}

export function safeStr(value) {
  return String(value ?? "").trim();
}

export function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizeCuitInput(value) {
  return onlyDigits(value).slice(0, 11);
}

export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeFiscalBase(data) {
  const src = data && typeof data === "object" ? data : {};
  const cuit = onlyDigits(src.fiscal_cuit || src.cuit || src.doc_nro || src.CUIT || "");
  const razonSocial = safeStr(
    src.razon_social ||
      src.razonSocial ||
      src.nombre ||
      src.apellidoNombre ||
      src.denominacion ||
      ""
  );
  const condicionIva = safeStr(src.condicion_iva || src.cond_iva || src.iva || src.descripcionImpuesto || "");
  const domicilio = safeStr(src.domicilio || src.direccion || src.domicilioFiscal || "");

  return {
    src,
    common: {
      id_cliente_fiscal: Number(src.id_cliente_fiscal || 0) || null,
      doc_tipo: Number(src.doc_tipo || 80) || 80,
      doc_nro: safeStr(src.doc_nro || cuit),
      cuit,
      razon_social: razonSocial,
      condicion_iva: condicionIva,
      domicilio,
      origen: safeStr(src.origen || "arca_cuit"),
      activo: Number(src.activo ?? 1) === 0 ? 0 : 1,
    },
  };
}

export function normalizeClienteFiscalData(data) {
  const { src, common } = normalizeFiscalBase(data);
  return {
    id_cliente_fiscal: common.id_cliente_fiscal,
    id_cliente: Number(src.id_cliente || 0) || null,
    doc_tipo: common.doc_tipo,
    doc_nro: common.doc_nro,
    cuit: common.cuit,
    razon_social: common.razon_social,
    condicion_iva: common.condicion_iva,
    domicilio: common.domicilio,
    origen: common.origen,
    activo: common.activo,
  };
}

export function normalizeProveedorFiscalData(data) {
  const { src, common } = normalizeFiscalBase(data);
  return {
    id_cliente_fiscal: common.id_cliente_fiscal,
    id_proveedor: Number(src.id_proveedor || 0) || null,
    doc_tipo: common.doc_tipo,
    doc_nro: common.doc_nro,
    cuit: common.cuit,
    razon_social: common.razon_social,
    condicion_iva: common.condicion_iva,
    domicilio: common.domicilio,
    origen: common.origen,
    activo: common.activo,
  };
}

export function fiscalIsUsable(fiscal, normalizeFiscalData) {
  const f = normalizeFiscalData(fiscal);
  return f.cuit.length === 11 && !!f.razon_social;
}

export function fiscalHasAnyData(fiscal, normalizeFiscalData) {
  const f = normalizeFiscalData(fiscal);
  return !!(
    f.id_cliente_fiscal ||
    f.cuit ||
    f.razon_social ||
    f.condicion_iva ||
    f.domicilio
  );
}

export function buildEmptyForm(activo = 1) {
  return {
    nombre: "",
    activo,
    cuit: "",
    fiscalData: null,
    fiscalError: "",
    fiscalLoading: false,
    fiscalConsultado: false,
    cargaManual: true,
  };
}

export function clienteFiscalIsUsable(fiscal) {
  return fiscalIsUsable(fiscal, normalizeClienteFiscalData);
}

export function clienteFiscalHasAnyData(fiscal) {
  return fiscalHasAnyData(fiscal, normalizeClienteFiscalData);
}

export function proveedorFiscalIsUsable(fiscal) {
  return fiscalIsUsable(fiscal, normalizeProveedorFiscalData);
}

export function proveedorFiscalHasAnyData(fiscal) {
  return fiscalHasAnyData(fiscal, normalizeProveedorFiscalData);
}
