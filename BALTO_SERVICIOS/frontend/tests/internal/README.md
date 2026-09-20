# BALTO Servicios — suite interna ampliada

Esta carpeta complementa la suite funcional principal. No intenta repetir botones ni navegación: valida reglas internas, matemática, atomicidad, concurrencia, reversión e integridad.

## Cobertura actual: 22 tests internos

- preflight y tenant/herramientas E2E;
- cálculo autoritativo subtotal / IVA / total;
- cuenta corriente de clientes contra modelo independiente;
- cuenta corriente de proveedores contra modelo independiente;
- secuencias contables largas con múltiples ventas/compras y pagos;
- rollback transaccional real ante fallo de stock en el segundo ítem;
- concurrencia de stock sobre la misma existencia;
- concurrencia de dos OP intentando usar el mismo cheque;
- límite exacto de stock en cero y rechazo de stock negativo;
- aritmética y continuidad del historial de stock;
- ciclo eCheq ingreso -> egreso -> reversión;
- unicidad de número de cheque;
- reversión de venta y compra restaurando stock y CC;
- venta multiítem con varios IVA y stocks independientes;
- herramientas internas protegidas frente a requests anónimas/prefijos inválidos;
- auditorías finales SQL read-only de invariantes y relaciones huérfanas.

Todos los tests secundarios llevan `@internal`.

## Sólo testing principal

```powershell
npx playwright test --project=chromium --workers=1 --reporter=list --grep-invert @internal
```

## Sólo testing secundario

```powershell
npx playwright test tests/internal --project=chromium --workers=1 --reporter=list
```

## Todo junto

```powershell
npx playwright test --project=chromium --workers=1 --reporter=list
```

La suite mutable requiere `PW_ALLOW_MUTATIONS=1` y el backend de staging debe tener `BALTO_E2E_TOOLS_ENABLED=1`. En producción ese flag debe permanecer en `0`.
