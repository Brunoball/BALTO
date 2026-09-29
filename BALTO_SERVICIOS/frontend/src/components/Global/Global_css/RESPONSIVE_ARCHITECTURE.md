# BALTO · Arquitectura responsive

> Estado: **Fase 2 — separación de responsabilidades específicas**.
>
> Esta fase no cambia medidas, breakpoints ni comportamiento visual. Define quién es responsable de cada parte del responsive para poder depurar el CSS por etapas sin introducir regresiones.

## 1. Regla principal

Cada comportamiento responsive debe tener **un solo dueño**. Si una regla necesita ser corregida desde otro archivo con mayor especificidad o `!important`, primero hay que revisar si el comportamiento está viviendo en el archivo equivocado.

## 2. Responsabilidades globales

### `roots.css`
**Dueño de:** tokens de diseño, colores, radios, sombras y aliases temporales.

**No debe contener:** reglas responsive de secciones, layouts de tablas o modales.

> Deuda conocida: actualmente conserva variables iniciales del viewport por compatibilidad. Se migrarán a `GlobalViewport.css` cuando la carga global esté completamente centralizada.

### `GlobalViewport.css` + `useVisualViewport.js`
**Dueño de:** geometría del viewport visible real, safe areas, alto de `.pp-shell` y `.pp-content`, y política de scroll del documento en mobile/tablet.

**Puede modificar:** `html`, `body`, `#root`, `.pp-shell`, `.mov-topbar`, `.pp-content` y overlays globales únicamente cuando el comportamiento depende del viewport.

**No debe conocer:** `.cc-*`, `.cfg-*`, `.doccom-*`, `.af-*`, `.serv-*` ni clases de una sección concreta.

### `Global_Section.css`
**Dueño de:** primitivas visuales compartidas por secciones (`.mov-page`, `.mov-card`, cabeceras, filtros, tablas, botones, estados).

**No debe decidir:** alturas responsive por sección ni comportamiento del viewport.

> Deuda conocida: `body { overflow: hidden; }` sigue aquí por compatibilidad. Cuando se valide la carga de `GlobalViewport.css` para todas las rutas del panel, esta regla debe mudarse a su dueño real.

### `GlobalTableScrollResponsive.css`
**Dueño de:** patrón responsive común de pantallas tabulares: sección sin scroll + tabla/listado con scroll interno.

**Objetivo de Fase 3:** trabajar únicamente con clases estructurales comunes (`balto-rsp-table-*`) declaradas en JSX.

**No debe conocer:** nombres de secciones o prefijos particulares (`.cc-*`, `.cfg-*`, `.doccom-*`, IDs específicos).

**Excepciones explícitas:** Dashboard, Flujo de Caja y Análisis Financiero no usan este patrón y mantienen responsive propio.

### `GlobalsModalsV2.css`
**Dueño de:** estructura global de modales V2: overlay, container, header, body, footer, tamaños compartidos y comportamiento responsive base.

**No debe contener:** layout interno de formularios que sólo existe en un modal concreto. Eso pertenece al CSS local del modal.

### `Global_responsive.css`
**Estado:** **LEGACY / EN MIGRACIÓN**.

No se deben agregar reglas nuevas a este archivo. En las próximas fases sus bloques se moverán al dueño correcto sin cambiar valores visuales. Cuando quede vacío, se eliminará.

### `GlobalResponsiveV2.css`
**Estado:** **LEGACY específico de Ventas** pese a su nombre global.

No se deben sumar nuevas secciones aquí. Su contenido se migrará cuando se normalice el responsive de cabeceras/filtros.

## 3. Responsabilidades locales

Una sección puede tener un archivo `*.responsive.css` propio cuando su composición no encaja en el patrón global.

Casos deliberadamente locales:
- Dashboard
- Flujo de Caja
- Análisis Financiero
- Layout interno de modales particulares
- Componentes cuya densidad exige un breakpoint adicional real

El archivo local **no debe volver a controlar** `body`, `#root`, `.pp-shell` o la geometría principal de `.pp-content`.

## 4. Breakpoints objetivo

La normalización se hará más adelante. La referencia deseada es:

- `1499px`: monitor compacto
- `980px`: tablet / layout responsive general
- `720px`: móvil
- `420px`: móvil angosto

Durante Fase 1 y Fase 2 **no se reemplazan breakpoints existentes**. Primero se mueve el código sin alterar comportamiento y recién después se consolidan medidas.

## 5. Orden de migración

1. Fase 1 — contrato, línea base y auditoría. **Completada**.
2. Fase 2 — sacar reglas específicas de `Global_responsive.css` y llevarlas a sus CSS propietarios, sin cambiar valores. **En curso / primera extracción completada**.
3. Fase 3 — estructura común de scroll tabular en JSX y simplificación de `GlobalTableScrollResponsive.css`.
4. Fase 4 — retirar alturas responsive antiguas neutralizadas por overrides.
5. Fase 5 — consolidar modales en `GlobalsModalsV2.css`.
6. Fase 6 — normalizar breakpoints.
7. Fase 7 — reducir especificidad y `!important` restantes.
8. Fase 8 — retirar definitivamente `Global_responsive.css` / legacy remanente.

## 6. Validación mínima después de cada fase

Probar al menos:
- monitor >= 1500px
- monitor compacto 1366px
- 980px
- 720px
- 430px
- 390px

Y validar:
- navegación principal
- scroll general de sección
- scroll interno de tablas
- apertura/cierre y scroll de modales
- dropdowns/calendarios
- teclado móvil y barras dinámicas del navegador
- modo claro/oscuro

## 7. Auditoría

Ejecutar desde la raíz del proyecto:

```bash
node src/scripts/audit-responsive-css.js
```

Para salida JSON:

```bash
node src/scripts/audit-responsive-css.js --json
```

La auditoría no modifica archivos. Sirve para comparar cada fase contra `src/scripts/responsive-baseline.json`.


## 8. Migrado en Fase 2

Se extrajeron del legacy sin modificar valores ni breakpoints:

- Dashboard -> `Dashboard/dashboard.responsive.css`.
- Cuentas Corrientes (reglas exclusivas `.cc-*`) -> `Cuentas_Corrientes/cuentas_corrientes.responsive.css`.
- Cheques -> `Cheques/cheques.responsive.css`.
- Modal Nuevo Cheque -> `Global/Modales/ModalNuevoChequeResponsive.css`.
- Botón Exportar mobile icon-only -> `Global/Boton_Exportar/BotonExportar.css`.
- Análisis Financiero: se eliminó del legacy un bloque duplicado que ya existía idéntico en `Analisis_Financiero/analisis_financiero.css`.

Permanecen temporalmente en `Global_responsive.css` los bloques con selectores compartidos `.mi-*`, `.mov-*` y algunos bloques mixtos de Cuentas Corrientes. Se conservan ahí para no alterar la cascada antes de las fases de tablas y modales.

### Métricas después de esta extracción

Comparado con la línea base de Fase 1:

- `Global_responsive.css`: **2999 -> 1779 líneas**.
- `Global_responsive.css`: **43 -> 30 `@media`**.
- `Global_responsive.css`: **347 -> 147 `!important`**.
- Prefijos específicos dentro del legacy: `.cc-*` **156 -> 0**, `.af-*` **28 -> 0**.
- CSS total del proyecto: **45203 -> 44931 líneas**, aun después de crear archivos propietarios.
- `!important` totales: **1722 -> 1679**.

El remanente específico más grande del legacy son los selectores compartidos de modales `.mi-em-*` y `.mi-cr-*`. No se migran todavía porque participan en varios flujos y su consolidación corresponde a la fase de modales.
