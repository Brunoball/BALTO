import * as XLSX from "xlsx";
import jsPDF from "jspdf";

const safeName = (value) =>
  String(value || "servicios")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const dateSuffix = () => new Date().toISOString().slice(0, 10);

const asText = (value) => {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
};

export function exportServiciosExcel({ title, columns, rows }) {
  const headers = columns.map((column) => column.label);
  const data = rows.map((row) => columns.map((column) => asText(column.value(row))));

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
  worksheet["!cols"] = columns.map((column) => ({ wch: column.width || 18 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, safeName(title).slice(0, 31) || "Servicios");
  XLSX.writeFile(workbook, `${safeName(title)}_${dateSuffix()}.xlsx`);
}

export function exportServiciosPdf({ title, columns, rows }) {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const margin = 32;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - margin * 2;
  const rowHeight = 18;
  const fontSize = 8;
  const headerHeight = 22;
  const totalWeight = columns.reduce((sum, column) => sum + (column.weight || 1), 0);
  const widths = columns.map((column) => (usableWidth * (column.weight || 1)) / totalWeight);

  const drawHeader = (y) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    let x = margin;
    columns.forEach((column, index) => {
      doc.rect(x, y, widths[index], headerHeight);
      doc.text(column.label, x + 4, y + 14, {
        maxWidth: Math.max(10, widths[index] - 8),
      });
      x += widths[index];
    });
    return y + headerHeight;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(String(title || "SERVICIOS").toUpperCase(), margin, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`EXPORTADO: ${new Date().toLocaleString("es-AR")}`, pageWidth - margin, 28, {
    align: "right",
  });

  let y = drawHeader(42);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);

  rows.forEach((row) => {
    if (y + rowHeight > pageHeight - margin) {
      doc.addPage();
      y = drawHeader(margin);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
    }

    let x = margin;
    columns.forEach((column, index) => {
      doc.rect(x, y, widths[index], rowHeight);
      const value = asText(column.value(row));
      doc.text(value, x + 4, y + 12, {
        maxWidth: Math.max(10, widths[index] - 8),
      });
      x += widths[index];
    });

    y += rowHeight;
  });

  if (rows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.text("SIN REGISTROS PARA EXPORTAR.", margin, y + 16);
  }

  doc.save(`${safeName(title)}_${dateSuffix()}.pdf`);
}
