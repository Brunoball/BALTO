// src/components/Flujo_de_Caja/utils/cierresUtils.js
// Utilidades puras del cierre de caja (sin React). Todo en centavos enteros
// para evitar errores de punto flotante. El backend recalcula todo: esto sólo
// da respuesta visual inmediata.

export const ESTADOS_DETALLE = {
  SIN_DIFERENCIA: { label: "Coincide", tone: "ok" },
  PENDIENTE: { label: "Pendiente", tone: "pending" },
  PARCIALMENTE_CONCILIADA: { label: "Parcialmente conciliada", tone: "partial" },
  CONCILIADA: { label: "Conciliada", tone: "done" },
};

export const ESTADOS_CIERRE = {
  SIN_DIFERENCIAS: { label: "Sin diferencias", tone: "ok" },
  PENDIENTE: { label: "Con diferencias pendientes", tone: "pending" },
  PARCIALMENTE_CONCILIADO: { label: "Parcialmente conciliado", tone: "partial" },
  CONCILIADO: { label: "Conciliado", tone: "done" },
};

export const TIPOS_RESOLUCION = [
  {
    codigo: "MOVIMIENTO_REGISTRADO",
    label: "Operación real registrada",
    ayuda: "Una venta, cobro, gasto o pago que se registró en Movimientos explica la diferencia.",
    requiereMovimientos: true,
    obsMin: 0,
    clases: ["EFECTIVO", "CUENTA"],
  },
  {
    codigo: "TRANSFERENCIA_INTERNA",
    label: "Transferencia interna ya registrada",
    ayuda: "Elegí una transferencia interna registrada en BALTO. Se vincula sólo su pata de entrada o salida del medio afectado.",
    requiereMovimientos: false,
    requiereTransferencias: true,
    obsMin: 10,
    clases: ["EFECTIVO", "CUENTA"],
  },
  {
    codigo: "ERROR_DE_ARQUEO",
    label: "Error de conteo / dinero encontrado",
    ayuda: "La diferencia no existía: se contó mal o el dinero apareció.",
    requiereMovimientos: false,
    obsMin: 5,
    clases: ["EFECTIVO", "CUENTA"],
  },
  {
    codigo: "ACREDITACION_PENDIENTE",
    label: "Acreditación o transferencia en tránsito",
    ayuda: "El banco o la billetera reflejó después el importe esperado.",
    requiereMovimientos: false,
    obsMin: 5,
    clases: ["CUENTA"],
  },
  {
    codigo: "DIFERENCIA_ACEPTADA",
    label: "Diferencia aceptada como definitiva",
    ayuda: "Pérdida o sobrante sin origen identificado. Requiere el ajuste de saldo ya aplicado.",
    requiereMovimientos: false,
    obsMin: 10,
    clases: ["EFECTIVO", "CUENTA"],
  },
];

export const toCents = (n) => Math.round(Number(n || 0) * 100);
export const fromCents = (c) => Math.round(Number(c || 0)) / 100;

/** "SOBRANTE" | "FALTANTE" | "SIN_DIFERENCIA" | null (sin verificar). */
export function tipoDiferencia(esperado, verificado) {
  if (verificado == null) return null;
  const d = toCents(verificado) - toCents(esperado);
  if (d > 0) return "SOBRANTE";
  if (d < 0) return "FALTANTE";
  return "SIN_DIFERENCIA";
}

export function diferenciaCents(esperado, verificado) {
  if (verificado == null) return null;
  return toCents(verificado) - toCents(esperado);
}

/**
 * Totales sin compensar medios entre sí. Los medios sin verificar no suman
 * (y se informan aparte): un 0 verificado sí suma.
 * @param {Array<{saldo_esperado:number, verificado:number|null}>} filas
 */
export function totalesCierre(filas) {
  const t = { esperado: 0, verificado: 0, sobrantes: 0, faltantes: 0, neto: 0, diferencias: 0, sinVerificar: 0 };
  for (const f of filas || []) {
    const esp = toCents(f.saldo_esperado);
    t.esperado += esp;
    if (f.verificado == null) {
      t.sinVerificar += 1;
      continue;
    }
    const ver = toCents(f.verificado);
    const d = ver - esp;
    t.verificado += ver;
    if (d > 0) t.sobrantes += d;
    if (d < 0) t.faltantes += -d;
    if (d !== 0) t.diferencias += 1;
  }
  t.neto = t.sobrantes - t.faltantes;
  return {
    esperado: fromCents(t.esperado),
    verificado: fromCents(t.verificado),
    sobrantes: fromCents(t.sobrantes),
    faltantes: fromCents(t.faltantes),
    neto: fromCents(t.neto),
    diferencias: t.diferencias,
    sinVerificar: t.sinVerificar,
  };
}

/** Vista previa local de una conciliación (el backend decide). */
export function previewConciliacionLocal({ diferencia, conciliado, cubierto, tipo, importe }) {
  const D = toCents(diferencia);
  const C = toCents(conciliado);
  const X = toCents(importe);
  const pendiente = Math.abs(D) - C;
  const tipoInfo = TIPOS_RESOLUCION.find((t) => t.codigo === tipo);
  if (!tipoInfo || D === 0 || pendiente <= 0 || X <= 0) return null;
  const error = X > pendiente ? "El importe supera lo pendiente." : (tipo === "DIFERENCIA_ACEPTADA" && !cubierto ? "Primero aplicá el ajuste de saldo." : "");
  const signo = D > 0 ? 1 : -1;
  const compensa = cubierto && tipo !== "DIFERENCIA_ACEPTADA";
  const nuevoC = C + Math.min(X, pendiente);
  const estado = nuevoC >= Math.abs(D) ? "CONCILIADA" : "PARCIALMENTE_CONCILIADA";
  return {
    pendienteAnterior: fromCents(pendiente),
    pendientePosterior: fromCents(Math.max(0, pendiente - X)),
    compensacion: compensa ? fromCents(-signo * X) : 0,
    estado,
    error,
  };
}

export function numeroCierre(id) {
  return `CC-${String(Number(id) || 0).padStart(6, "0")}`;
}

export function fmtDateTimeES(value) {
  if (!value) return "—";
  const [d, t = ""] = String(value).split(" ");
  const [y, m, dd] = d.split("-");
  if (!y || !m || !dd) return String(value);
  return `${dd}/${m}/${y}${t ? ` ${t.slice(0, 5)}` : ""}`;
}
