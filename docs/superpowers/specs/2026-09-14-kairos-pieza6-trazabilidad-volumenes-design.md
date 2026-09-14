# Pieza 6: Trazabilidad + Volúmenes de trabajo + Cola individual — Design

## Contexto

Surge de un repaso de conceptos con el usuario tras cerrar (a nivel de código,
no de merge) la Pieza 5. Tres necesidades independientes pero relacionadas,
todas centradas en dar más visibilidad y control al `jefe_equipo` y a las
tiendas, sin tocar el flujo de preparación en sí:

1. Las tiendas no tienen forma de ver el estado real de envío de sus
   peticiones más allá del texto genérico de `peticiones.estado`.
2. El jefe de equipo no tiene datos de productividad (líneas/hora por
   operario) para decidir qué peticiones son "ligeras".
3. Hoy toda petición se trabaja como cola compartida sin distinción; no hay
   forma de apartar peticiones ligeras para que las trabaje un solo operario.

## Objetivo

Tres features independientes, cada una entregable por separado si hace
falta, pero se implementan juntas por compartir área de código:

1. **Cola individual** (`kairos-operario`): el jefe de equipo puede marcar
   una petición ligera como "individual"; se mueve a una sección aparte de
   la cola que cualquier operario puede trabajar solo.
2. **Volúmenes de trabajo** (`kairos-operario`, tab Panel): vista de
   productividad — líneas preparadas por operario y hora (hoy) + tendencia
   por día (últimos 14 días).
3. **Trazabilidad** (`kairos-portal`, tab nueva): la tienda ve el estado de
   envío real de cada petición propia, con la lógica de seguimiento correcta
   según su tipo.

## Alcance

### 1. Cola individual

**Modelo de datos:** columna `preparacion.peticiones.cola_individual boolean
not null default false`. Sin locking, sin campo de persona asignada — es
solo una etiqueta que cambia en qué sección de la cola aparece la petición.

**Aplica solo a `pedido_cliente` y `cesion`.** Refill no participa: ya lo
prepara un único operario por naturaleza (palet completo), así que no tiene
sentido la distinción.

**Jefe de equipo** (`kairos-operario`, tab Panel → "Todas las peticiones"):
botón toggle junto a cada petición de tipo `pedido_cliente`/`cesion` en
estado `pendiente` o `en_preparacion`: "Mover a individual" / "Volver a
normal". Llama a `marcarColaIndividual(peticionId, valor)`.

**Cola de operario** (`kairos-operario`, tab Peticiones): la lista se separa
en dos secciones con cabecera — "Cola normal" primero, "Individual" después.
Ambas visibles y accesibles para cualquier operario; el orden es solo una
sugerencia de prioridad (trabajar primero lo normal), no hay restricción de
acceso ni de quién puede coger qué.

### 2. Volúmenes de trabajo

**Fuente de datos:** columnas ya existentes `lineas.operario` (text) y
`lineas.preparada_en` (timestamptz) — sin migración adicional.

**Vista "Hoy"**: tabla operario × hora, con el recuento de líneas marcadas
como preparadas por cada operario en cada hora del día actual. Filas =
operarios, columnas = horas con actividad.

**Vista "Últimos 14 días"**: gráfico de barras simple, líneas totales
preparadas por día (todos los operarios sumados), para ver tendencia.

Solo lectura, sin filtros adicionales en esta primera versión (YAGNI — se
añaden si hace falta).

Tab nueva "Volúmenes" en la barra de tabs existente de `kairos-operario`
(visible solo para `jefe_equipo`, igual que las demás).

### 3. Trazabilidad (portal)

**Dónde:** `kairos-portal`, pantalla nueva accesible desde un enlace en la
cabecera junto a "Salir" (el portal no tiene barra de tabs hoy — se añade
solo este enlace, no una barra completa, para no sobre-construir).

**Qué muestra:** listado de las peticiones propias de la tienda (mismo
filtro `tienda_origen` que ya usa `listarMisPeticiones`), cada una con su
estado de seguimiento según el camino que le corresponde por tipo:

- **`pedido_cliente` con `transporte = true`** → sigue el flujo existente
  "a_ubicar": se muestra `peticiones.estado` traducido (ya existe
  `TRADUCCION_ESTADO`, sin cambios).
- **Refill** → Carta de Portes por SSCC: se cruzan los SSCC de
  `lineas.sscc` (parseados con el mismo formato multi-palet que usa
  `kairos-operario/StockAsignacion.js:_parseSsccMulti_`, portado a
  `kairos-portal`) contra `preparacion.estado_porte`. Estado mostrado:
  "Sin carta todavía" / "Cargado" / "Recepcionado" (misma lógica de
  agregación que `kairos-operario/Estado.js:listarEstadoPeticiones`).
- **Cesión y `pedido_cliente` sin transporte** → HODOS: se reutiliza
  exactamente la lógica ya existente en
  `kairos-portal/Peticiones.js:obtenerDetallePeticion` (líneas 77-90) que
  cruza `lineas.hodos_id` contra `public.etiquetas`, pero aplicada al
  listado completo en vez de a una sola petición.

**Importante — corrección de diseño de Pieza 5:** el `Estado.js` de
`kairos-operario` (Pieza 5) hoy hace un cruce genérico HODOS+CartaPortes
para cualquier `pedido_cliente`/`cesion`. Es incorrecto: Carta de Portes solo
aplica a Refill. Se corrige como parte de esta pieza, con los mismos 3
caminos de arriba, reescribiendo `listarEstadoPeticiones` en
`kairos-operario/Estado.js`.

## Fuera de alcance

- No se toca el flujo de preparación de líneas ni el disparo de HODOS/myISO.
- No hay asignación de petición a una persona concreta, en ningún punto.
- No hay bloqueo/lock de ningún tipo sobre las peticiones individuales.
- Volúmenes de trabajo no incluye filtros, exportación, ni comparativas
  entre operarios más allá de la tabla/gráfico descritos.
- No se migra ni recalcula histórico: `cola_individual` empieza en `false`
  para todas las peticiones existentes.

## Esquema de datos (migración)

Una sola migración nueva, `014_pieza6.sql`:

```sql
alter table preparacion.peticiones
  add column cola_individual boolean not null default false;

notify pgrst, 'reload schema';
```

No hace falta CHECK restringiendo por tipo — se controla a nivel de
aplicación (el botón de toggle solo aparece para `pedido_cliente`/`cesion`
en el Panel), igual que otras reglas de negocio ya existentes en el
proyecto (p.ej. `necesitaHodos` en `Panel.js`).

## Archivos afectados

**`kairos-operario`:**
- `Cola.js` — `listarCola` añade `cola_individual` al `select`.
- `Index.html` — `cargarCola` separa la lista en 2 secciones por
  `cola_individual`; `renderTabsBar_` añade tab "Volúmenes"; `renderPanel`
  añade botón toggle individual por petición.
- `Panel.js` — nueva función `marcarColaIndividual(peticionId, valor)`;
  `listarTodasPeticiones` añade `cola_individual` al select.
- `Estado.js` — reescritura de `listarEstadoPeticiones` con los 3 caminos
  (ver arriba), en vez del cruce genérico actual.
- `Volumenes.js` (nuevo) — `listarVolumenesHoy()` y
  `listarVolumenesHistorico()`.

**`kairos-portal`:**
- `Trazabilidad.js` (nuevo) — `listarTrazabilidad(ldap)`, con los 3 caminos
  y `_parseSsccMulti_` portado.
- `Portal.html` — enlace "Trazabilidad" en la cabecera junto a "Salir";
  función `renderTrazabilidad()`.

**Supabase:**
- `supabase/migrations/014_pieza6.sql` (nuevo).

## Riesgos / decisiones

- **Rama base:** Pieza 5 (`panel-gestion-carta-portes`) sigue sin fusionar a
  `master`. Esta pieza depende de ficheros que Pieza 5 introdujo
  (`Estado.js`, `Panel.js`, tab bar). Se implementa como continuación de esa
  misma rama (no se crea rama nueva hasta que ambas piezas estén listas para
  cerrar juntas), evitando conflictos de merge innecesarios.
- **Verificación de UI con rol `jefe_equipo`:** mismo bloqueo conocido de
  sesiones anteriores (`<select>` nativo en iframe sandboxed no
  automatizable) — se verifica igual que en Pieza 5, vía editor de código de
  Apps Script con función reordenada, no vía click en la webapp real.
