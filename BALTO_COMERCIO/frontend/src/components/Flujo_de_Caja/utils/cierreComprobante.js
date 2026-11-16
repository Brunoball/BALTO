// src/components/Flujo_de_Caja/utils/cierreComprobante.js
// Comprobante del cierre de caja: vista imprimible (HTML) y PDF (jsPDF).
// Muestra SIEMPRE los importes originales del arqueo y, por separado, la
// evolución posterior (conciliaciones y compensaciones) sin modificarlos.

import jsPDF from "jspdf";
import { fmtDateES, moneyARS, moneyARSSigned } from "./flujoCajaUtils";
import { ESTADOS_CIERRE, ESTADOS_DETALLE, fmtDateTimeES, numeroCierre } from "./cierresUtils";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function datos(detalle) {
  const c = detalle?.cierre || {};
  return {
    c,
    numero: c.numero || numeroCierre(c.id_cierre),
    detalles: detalle?.detalles || [],
    avisos: detalle?.avisos || [],
  };
}

export function htmlComprobanteCierre(detalle) {
  const { c, numero, detalles, avisos } = datos(detalle);
  const filas = detalles.map((d) => `
    <tr>
      <td>${esc(d.medio_nombre)}</td>
      <td class="n">${esc(moneyARS(d.saldo_esperado))}</td>
      <td class="n">${esc(moneyARS(d.saldo_verificado))}</td>
      <td class="n">${esc(moneyARSSigned(d.diferencia))}</td>
      <td class="n">${d.id_ajuste_saldo ? esc(moneyARSSigned(d.ajuste_provisional)) : "—"}</td>
      <td class="n">${esc(moneyARS(d.importe_conciliado))}</td>
      <td class="n">${esc(moneyARS(d.importe_pendiente))}</td>
      <td>${esc(ESTADOS_DETALLE[d.estado_conciliacion]?.label || d.estado_conciliacion)}</td>
    </tr>`).join("");
  const concs = detalles.flatMap((d) => (d.conciliaciones || []).map((k) => `
    <tr>
      <td>${esc(fmtDateTimeES(k.created_at))}</td>
      <td>${esc(d.medio_nombre)}</td>
      <td>${esc(k.tipo_label)}</td>
      <td class="n">${esc(moneyARS(k.importe))}</td>
      <td class="n">${k.compensacion ? esc(moneyARSSigned(k.compensacion)) : "—"}</td>
      <td>${esc((k.movimientos || []).map((m) => `#${m.id_movimiento} ${m.tipo_operacion || ""} ${moneyARS(m.monto)}`).join(", ") || "—")}</td>
      <td>${esc(k.usuario_nombre || "—")}</td>
    </tr>`)).join("");

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Cierre de caja ${esc(numero)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;margin:18px 0 6px}
  .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:10px 0 4px}
  .meta div span{display:block;color:#64748b;font-size:10px;text-transform:uppercase}
  table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;vertical-align:top}
  th{background:#f1f5f9;font-size:10px;text-transform:uppercase;color:#334155} .n{text-align:right;white-space:nowrap}
  .tot{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px} .tot b{display:block;font-size:13px}
  .nota{color:#475569;font-size:10.5px;margin-top:6px} .aviso{color:#92400e}
  .firma{margin-top:42px;display:flex;gap:60px} .firma div{border-top:1px solid #94a3b8;padding-top:4px;min-width:200px;text-align:center;color:#475569}
  @media print{body{margin:10mm}}
</style></head><body>
<h1>Comprobante de cierre de caja ${esc(numero)}</h1>
<div class="meta">
  <div><span>Fecha operativa</span>${esc(fmtDateES(c.fecha_operativa))}${c.es_historico ? " (histórico)" : ""}</div>
  <div><span>Confirmado</span>${esc(fmtDateTimeES(c.created_at))}</div>
  <div><span>Responsable</span>${esc(c.usuario_nombre || "—")}</div>
  <div><span>Estado</span>${esc(ESTADOS_CIERRE[c.estado_conciliacion]?.label || c.estado_conciliacion || "—")}</div>
  <div><span>Diferencias</span>${esc(c.cantidad_diferencias)} de ${esc(c.cantidad_medios)} medios</div>
  <div><span>Pendiente actual</span>${esc(moneyARS(c.importe_pendiente))}</div>
</div>
<h2>Arqueo original (importes al confirmar)</h2>
<table><thead><tr><th>Caja / medio</th><th class="n">Esperado</th><th class="n">Verificado</th><th class="n">Diferencia</th><th class="n">Ajuste provisional</th><th class="n">Conciliado</th><th class="n">Pendiente</th><th>Estado</th></tr></thead>
<tbody>${filas}</tbody></table>
<div class="tot">
  <div>Total esperado<b>${esc(moneyARS(c.total_esperado))}</b></div>
  <div>Total verificado<b>${esc(moneyARS(c.total_verificado))}</b></div>
  <div>Sobrantes<b>${esc(moneyARS(c.total_sobrantes))}</b></div>
  <div>Faltantes<b>${esc(moneyARS(c.total_faltantes))}</b></div>
  <div>Diferencia neta<b>${esc(moneyARSSigned(c.diferencia_neta))}</b></div>
</div>
<p class="nota">Las diferencias se registran por caja y no se compensan entre medios. Un ajuste de saldo no concilia la diferencia: queda pendiente hasta justificar su origen.</p>
${c.observaciones ? `<p><b>Observaciones:</b> ${esc(c.observaciones)}</p>` : ""}
<h2>Conciliaciones posteriores</h2>
${concs ? `<table><thead><tr><th>Fecha</th><th>Caja</th><th>Motivo</th><th class="n">Importe</th><th class="n">Compensación</th><th>Operaciones vinculadas</th><th>Usuario</th></tr></thead><tbody>${concs}</tbody></table>` : `<p class="nota">Sin conciliaciones registradas.</p>`}
${avisos.length ? `<h2>Avisos</h2>${avisos.map((a) => `<p class="nota aviso">${esc(a)}</p>`).join("")}` : ""}
<div class="firma"><div>Responsable del cierre</div><div>Control / Administración</div></div>
<p class="nota">Emitido el ${esc(new Date().toLocaleString("es-AR"))}. BALTO Comercio.</p>
</body></html>`;
}

/** Abre la vista imprimible en una ventana nueva y lanza el diálogo de impresión. */
export function imprimirComprobanteCierre(detalle) {
  const html = htmlComprobanteCierre(detalle);
  const w = window.open("", "_blank", "noopener=no,width=1000,height=800");
  if (!w) {
    // Ventanas emergentes bloqueadas: se descarga el PDF.
    descargarPdfCierre(detalle);
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* el usuario puede imprimir manualmente */ } }, 250);
  return true;
}

/** PDF del comprobante (A4 apaisado). */
export function construirPdfCierre(detalle) {
  const { c, numero, detalles, avisos } = datos(detalle);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = 14;
  const line = (txt, x, yy, opts = {}) => doc.text(String(txt ?? ""), x, yy, opts);
  const nextPage = (need = 8) => { if (y + need > H - 12) { doc.addPage(); y = 14; } };

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  line(`Comprobante de cierre de caja ${numero}`, 12, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  line(`Fecha operativa: ${fmtDateES(c.fecha_operativa)}${c.es_historico ? " (histórico)" : ""}   ·   Confirmado: ${fmtDateTimeES(c.created_at)}   ·   Responsable: ${c.usuario_nombre || "—"}`, 12, y); y += 5;
  line(`Estado: ${ESTADOS_CIERRE[c.estado_conciliacion]?.label || c.estado_conciliacion || "—"}   ·   Pendiente actual: ${moneyARS(c.importe_pendiente)}`, 12, y); y += 7;

  const cols = [
    { t: "Caja / medio", x: 12, w: 52 },
    { t: "Esperado", x: 100, r: true },
    { t: "Verificado", x: 132, r: true },
    { t: "Diferencia", x: 164, r: true },
    { t: "Ajuste prov.", x: 196, r: true },
    { t: "Conciliado", x: 226, r: true },
    { t: "Pendiente", x: 256, r: true },
    { t: "Estado", x: 260 },
  ];
  doc.setFont("helvetica", "bold");
  cols.forEach((col) => line(col.t, col.x, y, col.r ? { align: "right" } : {}));
  y += 2; doc.line(12, y, W - 12, y); y += 4;
  doc.setFont("helvetica", "normal");
  detalles.forEach((d) => {
    nextPage();
    const vals = [
      String(d.medio_nombre).slice(0, 34), moneyARS(d.saldo_esperado), moneyARS(d.saldo_verificado), moneyARSSigned(d.diferencia),
      d.id_ajuste_saldo ? moneyARSSigned(d.ajuste_provisional) : "—", moneyARS(d.importe_conciliado), moneyARS(d.importe_pendiente),
      (ESTADOS_DETALLE[d.estado_conciliacion]?.label || d.estado_conciliacion).slice(0, 24),
    ];
    cols.forEach((col, i) => line(vals[i], col.x, y, col.r ? { align: "right" } : {}));
    y += 5;
  });
  y += 2; doc.line(12, y, W - 12, y); y += 5;
  doc.setFont("helvetica", "bold");
  line(`Esperado ${moneyARS(c.total_esperado)}   ·   Verificado ${moneyARS(c.total_verificado)}   ·   Sobrantes ${moneyARS(c.total_sobrantes)}   ·   Faltantes ${moneyARS(c.total_faltantes)}   ·   Neto ${moneyARSSigned(c.diferencia_neta)}`, 12, y);
  y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  line("Las diferencias se registran por caja y no se compensan entre medios. Un ajuste de saldo no concilia la diferencia.", 12, y); y += 7;
  if (c.observaciones) { nextPage(); line(`Observaciones: ${c.observaciones}`.slice(0, 180), 12, y); y += 6; }

  doc.setFontSize(10); doc.setFont("helvetica", "bold"); nextPage(12);
  line("Conciliaciones posteriores", 12, y); y += 5;
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
  const concs = detalles.flatMap((d) => (d.conciliaciones || []).map((k) => ({ d, k })));
  if (!concs.length) { line("Sin conciliaciones registradas.", 12, y); y += 5; }
  concs.forEach(({ d, k }) => {
    nextPage();
    const movs = (k.movimientos || []).map((m) => `#${m.id_movimiento} ${moneyARS(m.monto)}`).join(", ");
    line(`${fmtDateTimeES(k.created_at)} · ${d.medio_nombre} · ${k.tipo_label} · ${moneyARS(k.importe)}${k.compensacion ? ` · compensación ${moneyARSSigned(k.compensacion)}` : ""}${movs ? ` · ${movs}` : ""} · ${k.usuario_nombre || "—"}`.slice(0, 200), 12, y);
    y += 5;
  });
  avisos.forEach((a) => { nextPage(); line(`Aviso: ${a}`.slice(0, 200), 12, y); y += 5; });

  nextPage(20); y += 14;
  doc.line(20, y, 90, y); doc.line(130, y, 200, y); y += 4;
  line("Responsable del cierre", 55, y, { align: "center" }); line("Control / Administración", 165, y, { align: "center" });
  return doc;
}

export function descargarPdfCierre(detalle) {
  const { c, numero } = datos(detalle);
  construirPdfCierre(detalle).save(`cierre_caja_${numero}_${c.fecha_operativa || ""}.pdf`);
}
