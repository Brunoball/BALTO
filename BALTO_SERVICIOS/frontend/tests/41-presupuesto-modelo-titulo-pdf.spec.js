import { test } from './support/test.js';
import runRegression from './presupuesto-modelo-pdf.regression.cjs';

// Regresión pura del diseño compacto y de saltos de página del PDF.
// No escribe en base de datos ni modifica documentos del cliente.
test('@pdf presupuesto y servicio comparten encabezado compacto sin recortar descripciones', async () => {
  await runRegression();
});
