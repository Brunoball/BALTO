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

## Cómo se ejecuta ahora

Esta carpeta (antes `tests/internal`) forma parte de GLOBAL pero está excluida de
`node tests/ejecutar.cjs global`. Corre únicamente en la suite completa:

```powershell
node tests/ejecutar.cjs completo
```

Para correr sólo la auditoría interna, desde `frontend`:

```powershell
npx playwright test tests/global/auditoria_solo_completo --project=chromium --workers=1 --reporter=list
```

Las utilidades que usaba `internal/support/internal-api.js` ahora están en `tests/support/internal-api.js`.

La suite mutable requiere `PW_ALLOW_MUTATIONS=1` y el backend de staging debe tener `BALTO_E2E_TOOLS_ENABLED=1`. En producción ese flag debe permanecer en `0`.
