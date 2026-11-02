/**
 * Coordina el bloqueo del scroll entre el manual y las alertas de Stock.
 *
 * Cada modal recibe una función de limpieza independiente. El overflow previo
 * se restaura únicamente cuando se libera el último bloqueo, incluso si los
 * modales se cierran en un orden distinto al que se abrieron.
 */
let activeLocks = 0;
let previousOverflow = "";

export function acquireBodyScrollLock() {
  if (typeof document === "undefined" || !document.body) return () => {};

  const body = document.body;
  if (activeLocks === 0) previousOverflow = body.style.overflow;
  activeLocks += 1;
  body.style.overflow = "hidden";

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks -= 1;
    if (activeLocks === 0) {
      body.style.overflow = previousOverflow;
      previousOverflow = "";
    }
  };
}
