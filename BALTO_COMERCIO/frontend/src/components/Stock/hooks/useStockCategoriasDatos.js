import { useMemo } from "react";

export default function useStockCategoriasDatos({ categorias = [], categoriaFiltro = "" }) {
  const categoriasPorId = useMemo(() => {
    const map = {};
    (Array.isArray(categorias) ? categorias : []).forEach((cat) => {
      const id = Number(cat?.id_stock_categoria ?? cat?.id ?? 0);
      if (id > 0) map[id] = cat;
    });
    return map;
  }, [categorias]);

  const categoriasPorPadre = useMemo(() => {
    const map = {};
    (Array.isArray(categorias) ? categorias : []).forEach((cat) => {
      const padre = Number(cat?.id_categoria_padre || 0);
      if (!map[padre]) map[padre] = [];
      map[padre].push(cat);
    });

    Object.keys(map).forEach((key) => {
      map[key].sort((a, b) =>
        String(a?.nombre ?? "").localeCompare(String(b?.nombre ?? ""), "es", {
          numeric: true,
          sensitivity: "base",
        })
      );
    });

    return map;
  }, [categorias]);

  const categoriaFiltroIds = useMemo(() => {
    const id = Number(categoriaFiltro || 0);
    const ids = new Set();
    if (!id) return ids;

    const agregarConHijas = (categoriaId) => {
      const value = Number(categoriaId || 0);
      if (!value || ids.has(value)) return;
      ids.add(value);
      (categoriasPorPadre[value] || []).forEach((hija) =>
        agregarConHijas(hija?.id_stock_categoria ?? hija?.id)
      );
    };

    agregarConHijas(id);
    return ids;
  }, [categoriaFiltro, categoriasPorPadre]);

  const categoriaFiltroLabel = useMemo(() => {
    const id = Number(categoriaFiltro || 0);
    if (!id) return "Todas";

    const partes = [];
    let cursor = id;
    let guard = 0;
    while (cursor > 0 && categoriasPorId[cursor] && guard++ < 12) {
      const cat = categoriasPorId[cursor];
      partes.unshift(
        String(cat?.nombre ?? cat?.nombre_mostrar ?? "")
          .replace(/^—\s*/g, "")
          .trim()
      );
      cursor = Number(cat?.id_categoria_padre || 0);
    }

    return partes.filter(Boolean).join(" / ") || "Todas";
  }, [categoriaFiltro, categoriasPorId]);

  return {
    categoriasPorId,
    categoriasPorPadre,
    categoriaFiltroIds,
    categoriaFiltroLabel,
  };
}
