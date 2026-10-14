/** Calcula la posición del menú en coordenadas del viewport (position: fixed).
 * Si el campo está cerca del final de una tabla o del viewport, abre hacia arriba.
 */
export default function getDropdownPlacement(input, preferredHeight = 280) {
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
  const viewportWidth = window.innerWidth;
  const gap = 4;
  const margin = 8;

  const above = Math.max(0, rect.top - viewportTop - gap - margin);
  const below = Math.max(0, viewportBottom - rect.bottom - gap - margin);

  // Los desplegables se renderizan en document.body: no se cortan por overflow.
  // No obstante, cerca del pie de una tabla es mejor abrirlos hacia arriba.
  const table = input.closest('.gm-table-body');
  const belowInTable = table
    ? Math.max(0, table.getBoundingClientRect().bottom - rect.bottom - gap)
    : below;
  const opensUp = Math.min(below, belowInTable) < preferredHeight && above > Math.min(below, belowInTable);
  const available = opensUp ? above : below;
  const width = Math.max(0, Math.min(rect.width, viewportWidth - 2 * margin));
  const left = Math.max(margin, Math.min(rect.left, viewportWidth - margin - width));

  return {
    top: opensUp ? rect.top - gap : rect.bottom + gap,
    left,
    width,
    opensUp,
    maxHeight: Math.min(preferredHeight, available),
  };
}
