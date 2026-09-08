import { useEffect, useRef } from "react";
import { fetchFreshBarcodeOptions, lookupBarcode } from "./api/stockBarcodeApi.js";
import { canBaltoUseBarcode } from "../../../utils/demoMode";

const MAX_FAST_GAP_MS = 95;
const MAX_AVG_GAP_MS = 45;
const STRICT_AVG_GAP_MS = 28;
const RESET_GAP_MS = 180;
const MAX_SCAN_DURATION_MS = 1600;
const SCAN_IDLE_FINALIZE_MS = 135;

function safeStr(value) {
  return String(value ?? "").trim();
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function getProductId(product) {
  return positiveInt(
    product?.id_stock_producto ??
      product?.idStockProducto ??
      product?.stock_producto_id ??
      product?.id_producto ??
      product?.idProducto ??
      product?.id
  );
}

function getVariantId(variant) {
  return positiveInt(
    variant?.id_stock_variante ??
      variant?.idStockVariante ??
      variant?.stock_variante_id ??
      variant?.id_variante ??
      variant?.idVariante ??
      variant?.id
  );
}

function getProductName(product) {
  return safeStr(
    product?.nombre ??
      product?.producto_nombre ??
      product?.stock_producto_nombre ??
      product?.descripcion ??
      product?.label
  );
}

function getVariantName(variant) {
  return safeStr(
    variant?.nombre_variante ??
      variant?.variante_nombre ??
      variant?.stock_variante_nombre ??
      variant?.nombre ??
      variant?.label
  );
}

function getStock(row) {
  const raw =
    row?.stock ??
    row?.stock_disponible ??
    row?.stockDisponible ??
    row?.cantidad_stock ??
    null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getPrice(row) {
  const raw = row?.precio ?? row?.precio_venta ?? row?.precio_promocional ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
    precios: Array.isArray(variant?.precios)
      ? variant.precios
      : Array.isArray(product?.precios)
        ? product.precios
        : [],
    precios_map: variant?.precios_map || product?.precios_map || {},
    precio: getPrice(variant) ?? getPrice(product) ?? 0,
    precio_costo: variant?.precio_costo ?? product?.precio_costo ?? null,
    precio_venta: variant?.precio_venta ?? product?.precio_venta ?? null,
    precio_mayorista: variant?.precio_mayorista ?? product?.precio_mayorista ?? null,
    precio_promocional: variant?.precio_promocional ?? product?.precio_promocional ?? null,
    __isVariant: true,
    __parentProduct: product,
  };
}

function isActive(value) {
  return Number(value ?? 1) !== 0;
}

function hasPositiveStock(row) {
  const stock = getStock(row);
  return stock !== null && stock > 0;
}

function endpointEntityIds(data) {
  if (data?.tipo_entidad === "variante") {
    const variant = data?.variante || {};
    return {
      type: "variante",
      productId: positiveInt(variant?.id_stock_producto),
      variantId: positiveInt(variant?.id_stock_variante),
      productActive: isActive(variant?.producto_activo),
      entityActive: isActive(variant?.activo),
    };
  }

  const product = data?.producto || {};
  return {
    type: "producto",
    productId: positiveInt(product?.id_stock_producto),
    variantId: null,
    productActive: isActive(product?.activo),
    entityActive: isActive(product?.activo),
  };
}

export function findBarcodeStockSelection(options, lookupData, { allowOutOfStock = false } = {}) {
  const { type, productId, variantId, productActive, entityActive } = endpointEntityIds(lookupData);

  if (!productId) {
    throw new Error("El código leído no devolvió un producto válido.");
  }
  if (!productActive || !entityActive) {
    throw new Error("El producto o la variante escaneada está inactivo/a.");
  }

  const products = Array.isArray(options) ? options : [];
  const product = products.find((item) => getProductId(item) === productId) || null;

  if (!product) {
    throw new Error(
      "El producto del código de barra no está disponible en este movimiento. Cerrá y volvé a abrir el modal para refrescar el catálogo."
    );
  }

  if (type === "variante") {
    if (!variantId) throw new Error("El código leído no devolvió una variante válida.");
    const variants = Array.isArray(product?.variantes) ? product.variantes : [];
    const variant = variants.find((item) => getVariantId(item) === variantId) || null;
    if (!variant) {
      throw new Error(
        "La variante del código de barra no está disponible en este movimiento. Cerrá y volvé a abrir el modal para refrescar el catálogo."
      );
    }
    if (!isActive(variant?.activo)) throw new Error("La variante escaneada está inactiva.");
    if (!allowOutOfStock && !hasPositiveStock(variant)) {
      throw new Error(`La variante "${getVariantName(variant) || variantId}" no tiene stock disponible.`);
    }
    return buildVariantSelection(product, variant);
  }

  const activeVariants = Array.isArray(product?.variantes)
    ? product.variantes.filter((variant) => isActive(variant?.activo))
    : [];
  if (activeVariants.length > 0) {
    throw new Error("Ese producto usa variantes. Escaneá el código de la variante correspondiente.");
  }
  if (!allowOutOfStock && !hasPositiveStock(product)) {
    throw new Error(`El producto "${getProductName(product) || productId}" no tiene stock disponible.`);
  }

  return product;
}

function isRefreshableCatalogMiss(error) {
  return /no está disponible en este movimiento/i.test(String(error?.message || ""));
}

function editableSnapshot(target) {
  if (!(target instanceof Element)) return null;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return {
      kind: "value",
      target,
      value: target.value,
      start: typeof target.selectionStart === "number" ? target.selectionStart : null,
      end: typeof target.selectionEnd === "number" ? target.selectionEnd : null,
    };
  }

  if (target instanceof HTMLSelectElement) {
    return {
      kind: "select",
      target,
      value: target.value,
    };
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return {
      kind: "html",
      target,
      value: target.innerHTML,
    };
  }

  return null;
}

function setNativeValue(element, value) {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;
}

function restoreEditableSnapshot(snapshot) {
  if (!snapshot?.target?.isConnected) return;
  const target = snapshot.target;

  try {
    if (snapshot.kind === "value") {
      setNativeValue(target, snapshot.value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      if (snapshot.start !== null && typeof target.setSelectionRange === "function") {
        target.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start);
      }
      return;
    }

    if (snapshot.kind === "select") {
      target.value = snapshot.value;
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (snapshot.kind === "html") {
      target.innerHTML = snapshot.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch {
    // Restaurar el campo es una protección UX. Nunca debe cortar el escaneo.
  }
}

function scanLooksLikeScanner(text, gaps, startedAt, endedAt) {
  const code = safeStr(text);
  if (/^BL-[PV]-\d+$/i.test(code)) return true;
  if (code.length < 4) return false;
  if (!gaps.length) return false;

  const duration = Math.max(0, endedAt - startedAt);
  const maxGap = Math.max(...gaps);
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  if (duration > MAX_SCAN_DURATION_MS || maxGap > MAX_FAST_GAP_MS) return false;
  if (code.length >= 6 && avgGap <= MAX_AVG_GAP_MS) return true;
  return code.length >= 4 && avgGap <= STRICT_AVG_GAP_MS;
}

function freshBuffer(now, snapshot = null) {
  return {
    text: "",
    startedAt: now,
    lastAt: now,
    gaps: [],
    snapshot,
  };
}

function waitForUiSettle() {
  // Espera mínima deliberada: las lecturas posteriores ya quedan encoladas,
  // así que priorizamos que los setState/useEffect del modal terminen antes de
  // seleccionar la siguiente fila. Evita depender del timing de requestAnimationFrame
  // (que puede variar entre Chrome activo, pestaña lenta o equipos modestos).
  return new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Captura lectores tipo keyboard-wedge mientras un modal está abierto.
 * Sólo confirma la lectura cuando el patrón de velocidad parece una pistola;
 * al confirmar restaura el control que tenía foco para que el código no quede
 * escrito accidentalmente en cantidad, precio, cliente, etc.
 */
export default function useStockBarcodeScanner({
  enabled = true,
  options = [],
  allowOutOfStock = false,
  refreshOptions,
  onSelect,
  onError,
  onBusyChange,
}) {
  const featureEnabled = Boolean(enabled && canBaltoUseBarcode());
  const optionsRef = useRef(options);
  const callbackRef = useRef({ refreshOptions, onSelect, onError, onBusyChange });
  const configRef = useRef({ enabled: featureEnabled, allowOutOfStock });
  const busyRef = useRef(false);
  const bufferRef = useRef(freshBuffer(0));
  const abortRef = useRef(null);
  const queueRef = useRef([]);
  const idleTimerRef = useRef(null);
  const suppressTerminatorUntilRef = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    callbackRef.current = { refreshOptions, onSelect, onError, onBusyChange };
  }, [refreshOptions, onSelect, onError, onBusyChange]);

  useEffect(() => {
    configRef.current = { enabled: featureEnabled, allowOutOfStock };
  }, [featureEnabled, allowOutOfStock]);

  useEffect(() => {
    if (!featureEnabled) return undefined;

    const clearIdleTimer = () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };

    const reset = () => {
      clearIdleTimer();
      bufferRef.current = freshBuffer(0);
    };

    const drainQueue = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      callbackRef.current.onBusyChange?.(true);

      try {
        while (queueRef.current.length && configRef.current.enabled) {
          const next = queueRef.current.shift();
          if (!next?.code) continue;

          const controller = new AbortController();
          abortRef.current = controller;
          try {
            const lookupData = await lookupBarcode(next.code, controller.signal);
            let selection;

            try {
              selection = findBarcodeStockSelection(optionsRef.current, lookupData, {
                allowOutOfStock: configRef.current.allowOutOfStock,
              });
            } catch (catalogError) {
              // Un modal recién abierto puede seguir renderizando el catálogo que
              // recibió la pantalla padre mientras el GET fresco aún está en vuelo.
              // Si el endpoint de barcode encontró la entidad pero las options no,
              // refrescamos una sola vez y reintentamos con ese resultado exacto.
              if (!isRefreshableCatalogMiss(catalogError)) {
                throw catalogError;
              }

              // Algunos modales tienen un refresco específico. Para el resto usamos
              // un fallback central contra global_obtener_listas, de modo que crear
              // un producto y abrir inmediatamente Venta/Ingreso/Presupuesto no deje
              // al lector atado al catálogo viejo de la pantalla padre.
              const refreshedOptions =
                typeof callbackRef.current.refreshOptions === "function"
                  ? await Promise.resolve(
                      callbackRef.current.refreshOptions({
                        code: next.code,
                        lookup: lookupData,
                      })
                    )
                  : await fetchFreshBarcodeOptions(controller.signal, {
                      allowOutOfStock: configRef.current.allowOutOfStock,
                    });

              if (Array.isArray(refreshedOptions)) {
                optionsRef.current = refreshedOptions;
              }

              selection = findBarcodeStockSelection(optionsRef.current, lookupData, {
                allowOutOfStock: configRef.current.allowOutOfStock,
              });
            }

            await Promise.resolve(callbackRef.current.onSelect?.(selection, {
              code: next.code,
              lookup: lookupData,
              tipoCodigo: lookupData?.tipo_codigo || "",
              tipoEntidad: lookupData?.tipo_entidad || "",
            }));

            // Si la lectura agregó una fila nueva, damos a React dos frames para
            // confirmar el render/effect antes de procesar la siguiente lectura.
            // Evita perder códigos cuando se escanean varios artículos seguidos.
            await waitForUiSettle();
          } catch (error) {
            if (error?.name !== "AbortError") {
              callbackRef.current.onError?.(error?.message || "No se pudo leer el código de barra.");
            }
          } finally {
            if (abortRef.current === controller) abortRef.current = null;
          }
        }
      } finally {
        busyRef.current = false;
        callbackRef.current.onBusyChange?.(false);
      }
    };

    const enqueueScan = (code, snapshot) => {
      // La pistola escribe como teclado. Restauramos inmediatamente el control
      // que tenía foco y luego procesamos la lectura en serie para soportar
      // varias lecturas rápidas sin perder productos ni ensuciar otros campos.
      restoreEditableSnapshot(snapshot);
      queueRef.current.push({ code: safeStr(code) });
      void drainQueue();
    };

    const scheduleIdleFinalize = () => {
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        if (!configRef.current.enabled) return;

        const now = performance.now();
        const buffer = bufferRef.current;
        if (!buffer?.text) return;

        // Muchas lectoras envían Enter/Tab, pero otras vienen configuradas sin
        // sufijo. Un pequeño silencio después de una secuencia de teclado muy
        // rápida también confirma la lectura, sin confundir escritura humana.
        const qualifies = scanLooksLikeScanner(
          buffer.text,
          buffer.gaps,
          buffer.startedAt,
          now
        );
        if (!qualifies) return;

        const text = safeStr(buffer.text);
        const snapshot = buffer.snapshot;
        // Si una lectora sin sufijo termina enviando CR/LF con demora, evitamos
        // que ese terminador residual dispare el submit del formulario.
        suppressTerminatorUntilRef.current = performance.now() + 250;
        reset();
        enqueueScan(text, snapshot);
      }, SCAN_IDLE_FINALIZE_MS);
    };

    const onKeyDown = (event) => {
      if (!configRef.current.enabled || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;

      const now = performance.now();
      const key = event.key;
      let buffer = bufferRef.current;

      if ((key === "Enter" || key === "Tab") && now < suppressTerminatorUntilRef.current) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        return;
      }

      if (key === "Enter" || key === "Tab") {
        clearIdleTimer();
        const text = buffer.text;
        const qualifies = scanLooksLikeScanner(text, buffer.gaps, buffer.startedAt, now);
        const snapshot = buffer.snapshot;
        reset();

        if (!qualifies) return;

        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
        // Algunas pistolas están configuradas con CR+LF/doble terminador.
        // El primero confirma el código y los siguientes se absorben brevemente.
        suppressTerminatorUntilRef.current = now + 150;
        enqueueScan(safeStr(text), snapshot);
        return;
      }

      if (key.length !== 1) {
        if (key === "Escape") reset();
        return;
      }

      const previousAt = buffer.lastAt || 0;
      const gap = previousAt > 0 ? now - previousAt : 0;
      if (!buffer.text || gap > RESET_GAP_MS) {
        buffer = freshBuffer(now, editableSnapshot(document.activeElement));
      } else if (gap > 0) {
        buffer.gaps.push(gap);
      }

      buffer.text += key;
      buffer.lastAt = now;
      bufferRef.current = buffer;
      scheduleIdleFinalize();
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      abortRef.current?.abort();
      abortRef.current = null;
      queueRef.current = [];
      suppressTerminatorUntilRef.current = 0;
      clearIdleTimer();
      reset();
    };
  }, [featureEnabled]);
}
