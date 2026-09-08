export async function collectAllExportRows({
  fetchPage,
  getRowKey = null,
  startOffset = 0,
  maxPages = 5000,
}) {
  if (typeof fetchPage !== "function") {
    throw new Error("No se pudo preparar la exportación completa.");
  }

  let offset = Number(startOffset) || 0;
  let pageIndex = 0;
  const rows = [];
  const seen = new Set();

  while (pageIndex < maxPages) {
    const result = await fetchPage(offset, pageIndex);
    const page = Array.isArray(result?.rows) ? result.rows : [];

    for (let i = 0; i < page.length; i += 1) {
      const row = page[i];
      const rawKey = typeof getRowKey === "function" ? getRowKey(row) : null;
      const key = rawKey == null || rawKey === "" ? null : String(rawKey);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      rows.push(row);
    }

    pageIndex += 1;
    if (!result?.hasMore) return rows;

    const fallbackNext = offset + page.length;
    const next = Number.isFinite(Number(result?.nextOffset))
      ? Number(result.nextOffset)
      : fallbackNext;

    if (!Number.isFinite(next) || next <= offset) {
      throw new Error("No se pudo continuar con todas las páginas de la exportación.");
    }
    offset = next;
  }

  throw new Error("La exportación superó el límite de páginas permitido.");
}
