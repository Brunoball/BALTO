import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./ProductStockAutocomplete.css";

function normalizeText(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeStr(v) {
  return String(v ?? "").trim();
}


function getProductId(p) {
  const n = Number(p?.id_stock_producto ?? p?.idStockProducto ?? p?.stock_producto_id ?? p?.id_producto ?? p?.id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getVariantId(v) {
  const n = Number(v?.id_stock_variante ?? v?.idStockVariante ?? v?.stock_variante_id ?? v?.id_variante ?? v?.id ?? 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getProductName(p) {
  return safeStr(p?.nombre || p?.producto_nombre || p?.descripcion || p?.label || "");
}

function getVariantName(v) {
  return safeStr(v?.nombre_variante || v?.variante_nombre || v?.nombre || v?.label || "");
}

function getStock(x) {
  const raw = x?.stock ?? x?.stock_disponible ?? x?.stockDisponible ?? x?.cantidad_stock ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getPrecio(x) {
  const raw = x?.precio ?? x?.precio_venta ?? x?.precio_promocional ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function hasPositiveStock(x) {
  const stock = getStock(x);
  return stock !== null && stock > 0;
}

function filterAvailableProduct(product, allowOutOfStock = false) {
  if (!product) return null;

  const activeVariants = Array.isArray(product?.variantes)
    ? product.variantes.filter((v) => Number(v?.activo ?? 1) !== 0)
    : [];
  const variants = allowOutOfStock
    ? activeVariants
    : activeVariants.filter((v) => hasPositiveStock(v));
  const productHasStock = allowOutOfStock || hasPositiveStock(product);

  if (!productHasStock && variants.length === 0) return null;

  return {
    ...product,
    variantes: variants,
    tiene_variantes: variants.length > 0 ? 1 : 0,
  };
}

function buildVariantSelection(product, variant) {
  const idProducto = getProductId(product);
  const idVariante = getVariantId(variant);
  const productoNombre = getProductName(product);
  const varianteNombre = getVariantName(variant);
  const nombre = [productoNombre, varianteNombre].filter(Boolean).join(" - ");

  return {
    ...product,
    ...variant,
    id: idProducto,
    id_stock_producto: idProducto,
    stock_producto_id: idProducto,
    id_producto: idProducto,
    id_stock_variante: idVariante,
    stock_variante_id: idVariante,
    id_variante: idVariante,
    nombre,
    label: nombre,
    producto_nombre: productoNombre,
    stock_producto_nombre: productoNombre,
    variante_nombre: varianteNombre,
    nombre_variante: varianteNombre,
    sku: safeStr(variant?.sku || product?.sku || ""),
    stock: getStock(variant),
    stock_disponible: getStock(variant),
    precios: Array.isArray(variant?.precios) ? variant.precios : Array.isArray(product?.precios) ? product.precios : [],
    precios_map: variant?.precios_map || product?.precios_map || {},
    precio: getPrecio(variant) ?? getPrecio(product) ?? 0,
    precio_costo: variant?.precio_costo ?? product?.precio_costo ?? null,
    precio_venta: variant?.precio_venta ?? product?.precio_venta ?? null,
    precio_mayorista: variant?.precio_mayorista ?? product?.precio_mayorista ?? null,
    precio_promocional: variant?.precio_promocional ?? product?.precio_promocional ?? null,
    __isVariant: true,
    __parentProduct: product,
  };
}

function productSearchText(product) {
  const variants = Array.isArray(product?.variantes) ? product.variantes : [];
  return normalizeText([
    getProductName(product),
    product?.sku,
    product?.codigo,
    ...variants.flatMap((v) => [getVariantName(v), v?.sku, v?.codigo]),
  ].filter(Boolean).join(" "));
}

export default function ProductStockAutocomplete({
  value = "",
  onChange,
  onSelect,
  options = [],
  placeholder = "Escribí o buscá un producto…",
  disabled = false,
  showAllOnFocus = false,
  maxItems = 18,
  className = "",
  inputClassName = "",
  emptyMessage = "Sin productos",
  allowOutOfStock = false,
  name,
  id,
}) {
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const rafRef = useRef(null);
  const blurTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [listPos, setListPos] = useState(null);

  const availableOptions = useMemo(() => {
    const arr = Array.isArray(options) ? options : [];
    return arr.map((p) => filterAvailableProduct(p, allowOutOfStock)).filter(Boolean);
  }, [options, allowOutOfStock]);

  const q = normalizeText(value);

  const filteredProducts = useMemo(() => {
    if (!q) return showAllOnFocus ? availableOptions.slice(0, maxItems) : [];
    return availableOptions.filter((p) => productSearchText(p).includes(q)).slice(0, maxItems);
  }, [availableOptions, q, showAllOnFocus, maxItems]);

  const visibleKeys = useMemo(() => {
    const keys = [];
    filteredProducts.forEach((p) => {
      const pKey = `p:${getProductId(p) || getProductName(p)}`;
      keys.push(pKey);
      const variants = Array.isArray(p?.variantes) ? p.variantes : [];
      const variantsMatch = q ? variants.filter((v) => normalizeText([getVariantName(v), v?.sku, getProductName(p)].filter(Boolean).join(" ")).includes(q)) : variants;
      const productMatches = !q || normalizeText([getProductName(p), p?.sku].filter(Boolean).join(" ")).includes(q);
      const shouldOpen = expanded.has(pKey) || (q && variantsMatch.length > 0 && !productMatches);
      if (shouldOpen) {
        variantsMatch.forEach((v) => keys.push(`v:${getProductId(p)}:${getVariantId(v) || getVariantName(v)}`));
      }
    });
    return keys;
  }, [filteredProducts, expanded, q]);

  const safeActiveKey = visibleKeys.includes(activeKey) ? activeKey : visibleKeys[0] || "";

  const getCurrentPos = useCallback(() => {
    const el = inputRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: rect.width,
    };
  }, []);

  const updatePos = useCallback(() => {
    const next = getCurrentPos();
    if (next) setListPos(next);
  }, [getCurrentPos]);

  const openList = useCallback(() => {
    if (disabled) return;
    if (!(showAllOnFocus || q)) return;
    const next = getCurrentPos();
    if (!next) return;
    setListPos(next);
    setOpen(true);
  }, [disabled, getCurrentPos, q, showAllOnFocus]);

  const closeList = useCallback(() => {
    setOpen(false);
    setActiveKey("");
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePos();
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePos);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, updatePos]);

  useEffect(() => {
    const handleOutside = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      const portal = document.getElementById("psa-portal-list");
      if (portal?.contains(e.target)) return;
      closeList();
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [closeList]);

  useEffect(() => () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
  }, []);

  useEffect(() => {
    setActiveKey("");
  }, [value]);

  const toggleProduct = useCallback((product) => {
    const pKey = `p:${getProductId(product) || getProductName(product)}`;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pKey)) next.delete(pKey);
      else next.add(pKey);
      return next;
    });
  }, []);

  const selectProduct = useCallback((product) => {
    const variants = Array.isArray(product?.variantes)
      ? product.variantes.filter((v) => Number(v?.activo ?? 1) !== 0 && (allowOutOfStock || hasPositiveStock(v)))
      : [];
    if (variants.length > 0) {
      toggleProduct(product);
      return;
    }
    onSelect?.(product);
    closeList();
  }, [allowOutOfStock, closeList, onSelect, toggleProduct]);

  const selectVariant = useCallback((product, variant) => {
    onSelect?.(buildVariantSelection(product, variant));
    closeList();
  }, [closeList, onSelect]);

  const selectActive = useCallback(() => {
    if (!safeActiveKey) return;
    for (const p of filteredProducts) {
      const pKey = `p:${getProductId(p) || getProductName(p)}`;
      if (pKey === safeActiveKey) {
        selectProduct(p);
        return;
      }
      const variants = Array.isArray(p?.variantes) ? p.variantes : [];
      for (const v of variants) {
        const vKey = `v:${getProductId(p)}:${getVariantId(v) || getVariantName(v)}`;
        if (vKey === safeActiveKey) {
          selectVariant(p, v);
          return;
        }
      }
    }
  }, [filteredProducts, safeActiveKey, selectProduct, selectVariant]);

  const handleKeyDown = (e) => {
    if (disabled) return;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
      if (visibleKeys.length > 0) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (!visibleKeys.length) return;
      e.preventDefault();
      const idx = Math.max(0, visibleKeys.indexOf(safeActiveKey));
      setActiveKey(visibleKeys[idx >= visibleKeys.length - 1 ? 0 : idx + 1]);
      return;
    }
    if (e.key === "ArrowUp") {
      if (!visibleKeys.length) return;
      e.preventDefault();
      const idx = Math.max(0, visibleKeys.indexOf(safeActiveKey));
      setActiveKey(visibleKeys[idx <= 0 ? visibleKeys.length - 1 : idx - 1]);
      return;
    }
    if (e.key === "Enter") {
      if (!open || !visibleKeys.length) return;
      e.preventDefault();
      selectActive();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeList();
    }
  };


  const dropdown = open && listPos ? createPortal(
    <div
      id="psa-portal-list"
      className="psa-list"
      style={{
        position: "absolute",
        top: listPos.top,
        left: listPos.left,
        width: listPos.width,
        zIndex: 9999999999,
        margin: 0,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filteredProducts.length > 0 ? filteredProducts.map((product) => {
        const pKey = `p:${getProductId(product) || getProductName(product)}`;
        const variants = Array.isArray(product?.variantes)
          ? product.variantes.filter((v) => Number(v?.activo ?? 1) !== 0 && (allowOutOfStock || hasPositiveStock(v)))
          : [];
        const variantsMatch = q ? variants.filter((v) => normalizeText([getVariantName(v), v?.sku, getProductName(product)].filter(Boolean).join(" ")).includes(q)) : variants;
        const productMatches = !q || normalizeText([getProductName(product), product?.sku].filter(Boolean).join(" ")).includes(q);
        const isExpanded = expanded.has(pKey) || (q && variantsMatch.length > 0 && !productMatches);
        const renderedVariants = isExpanded ? variantsMatch : [];

        return (
          <div key={pKey}>
            <button
              type="button"
              className={["psa-item", safeActiveKey === pKey ? "is-active" : ""].filter(Boolean).join(" ")}
              onMouseEnter={() => setActiveKey(pKey)}
              onMouseDown={(e) => {
                e.preventDefault();
                selectProduct(product);
              }}
            >
              <span className="psa-item-main">
                <span className="psa-label">{getProductName(product)}</span>
              </span>
              {variants.length ? <span className="psa-arrow">{isExpanded ? "▾" : "▸"}</span> : null}
            </button>

            {renderedVariants.length > 0 ? (
              <div className="psa-children">
                {renderedVariants.map((variant) => {
                  const vKey = `v:${getProductId(product)}:${getVariantId(variant) || getVariantName(variant)}`;
                  return (
                    <button
                      type="button"
                      key={vKey}
                      className={["psa-variant", safeActiveKey === vKey ? "is-active" : ""].filter(Boolean).join(" ")}
                      onMouseEnter={() => setActiveKey(vKey)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectVariant(product, variant);
                      }}
                    >
                      <span className="psa-variant-main">
                        <span className="psa-variant-label">{getVariantName(variant) || "Variante"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      }) : <div className="psa-empty">{emptyMessage}</div>}
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapRef} className={["psa-wrap", className].filter(Boolean).join(" ")}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={["psa-input", inputClassName].filter(Boolean).join(" ")}
        type="text"
        value={value}
        placeholder={placeholder || " "}
        autoComplete="off"
        disabled={disabled}
        onFocus={openList}
        onBlur={() => {
          if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
          blurTimerRef.current = setTimeout(closeList, 150);
        }}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          onChange?.(e.target.value);
          const next = getCurrentPos();
          if (next) {
            setListPos(next);
            setOpen(true);
          }
          setActiveKey("");
        }}
      />
      {dropdown}
    </div>
  );
}
