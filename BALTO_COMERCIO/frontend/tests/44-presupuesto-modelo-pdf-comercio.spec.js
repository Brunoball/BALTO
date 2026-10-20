import { test } from '@playwright/test';
import testPdf from './presupuesto-comercio-pdf.regression.cjs';

// Regresión aislada del generador PDF, sin modificar datos del comercio.
test('@pdf presupuesto Comercio muestra nombre de modelo y pagina renglones largos', async () => {
  await testPdf();
});
