/** Acepta metadatos numéricos o cadenas provenientes de PHP. */
export function normalizarPaginacion(data, limite, pagina) {
  const numero = (valor) => valor === null || valor === undefined || valor === '' ? NaN : Number(valor);
  const totalRecibido = numero(data.total);
  const paginasRecibidas = numero(data.total_paginas);
  const total = Number.isFinite(totalRecibido) && totalRecibido >= 0
    ? Math.floor(totalRecibido) : (data.productos || []).length;
  const calculadas = Math.max(1, Math.ceil(total / limite));
  const explicitas = Number.isFinite(paginasRecibidas) && paginasRecibidas > 0 ? Math.floor(paginasRecibidas) : 1;
  const siguiente = data.siguiente_pagina_posible === true || data.siguiente_pagina_posible === 1 || data.siguiente_pagina_posible === '1';
  return { total, totalPaginas: Math.max(calculadas, explicitas, siguiente ? pagina + 1 : 1) };
}
