# Pieza 4 · Puentes myISO — Diseño

**Estado:** aprobado para plan de implementación.

## Qué es

Conecta Kairos con **myISO Gestión de Stock** (Stock It Easy), replicando el
mecanismo que **ya usa en producción** `PreparacionPedidosPC` — no se inventa
nada nuevo, se traslada el mecanismo real al modelo de datos de Kairos.

**Fuera de alcance:** el puente HODOS (auto-etiqueta) ya se resolvió en
[[kairos-plataforma-pedidos-taisa|Pieza 3]] — esta pieza es 100% sobre myISO.

## Por qué existe este puente (contexto técnico)

La API de Stock It Easy (`priv.scdp.adeo.cloud`) es de **red privada de
Adeo** — inalcanzable desde Apps Script (corre en la nube de Google). Toda
llamada a esa API tiene que salir del propio dispositivo del operario, dentro
de la red corporativa. El mecanismo ya validado (CartaPortesSIE, PC-actual):
un deep-link `http-shortcuts://<ID>?...` que dispara un shortcut de la app
Android **HTTP Shortcuts**, configurado una vez por dispositivo. El operario
de Kairos usa **tablet/móvil Android** (confirmado) — mismo patrón aplica sin
cambios de plataforma.

**Regla dura del navegador:** el salto a `http-shortcuts://` tiene que
ocurrir **síncronamente en el gesto de clic** del operario. Si se dispara
tras una respuesta async (p.ej. después de esperar la respuesta del
servidor), el navegador bloquea el salto en silencio. El cliente debe armar
la URL y navegar en el mismo `onclick`, no en el `.then()`/callback de
`google.script.run`.

## Dos operaciones myISO distintas, dos shortcuts distintos

Investigado en el código real de `PreparacionPedidosPC` — son **dos
mecanismos separados**, no uno:

### A. TRANSFERS (consumo/descuento de stock) — pedido_cliente y cesión

`Preparacion.html:266` (`dispararTransferenciaStock`). Al completar la
**última línea sin incidencia** de un pedido (todas sus líneas quedan
`Preparado`), se dispara **una sola vez por pedido completo** (agrupando
todas sus líneas, no una llamada por línea):

```js
var url = 'http-shortcuts://' + STOCK_SHORTCUT_ID
  + '?TRANSFERS=' + encodeURIComponent(JSON.stringify(transfers))
  + '&TIENDA=' + encodeURIComponent(codigoStock); // 014 | 279
window.location.href = url;
```

Cada elemento de `transfers`:
```js
{
  source: sscc_sin_ceros_a_la_izquierda,   // limpiarSscc(): quita ceros iniciales
  sourceType: 'CONTAINER',
  stock: { productId: codigo_lm, quantity: cantidad, measureUnit: 'EA', lotId: null, expirationDate: null, blocking: null }
}
```

Si una línea se repartió entre varios SSCC (ver más abajo), genera **un
transfer por cada parte**, con la cantidad exacta de esa parte — nunca la
cantidad total de la línea contra el primer palet (vaciaría de más).

**Shortcut a reutilizar:** `STOCK_SHORTCUT_ID` ya existe y está configurado
en el dispositivo Android del operario (`Preparacion.html:242`,
`b02c92a5-ca50-418f-93e9-4a7e8770cdfb`). Mismo operario, mismo dispositivo,
misma operación exacta — **se reutiliza tal cual**, no hace falta crear ni
configurar nada nuevo para esta parte.

**Confirmado con el usuario:** dispara al completar todas las líneas, **sin
esperar** a que un pedido_cliente con transporte pase por "a ubicar" — igual
que hoy. Cesión usa exactamente este mismo mecanismo (no move-to-address).

### B. move-to-address (mover contenedor completo) — solo refill

Patrón de `CartaPortesSIE` (`actualizarUbicaciones`, ver
[[cartaportessie-actualizacion-ubicaciones-rc1]]), pero con destino distinto:

```js
var url = 'http-shortcuts://' + SHORTCUT_ID_REFILL
  + '?SSCC_LIST=' + encodeURIComponent(JSON.stringify([sscc]))
  + '&TIENDA=' + encodeURIComponent(codigoStock);
window.location.href = url;
```

Destino fijo: **`05-XP1-A-1-10-A`** (dado por el usuario). Mueve el
contenedor **completo**, sin descuento de cantidad — el palet entero pasa a
esa ubicación de silueta para que la tienda lo recoja.

**Shortcut nuevo:** hace falta configurar un shortcut Android nuevo (destino
`05-XP1-A-1-10-A` fijo dentro del propio shortcut, igual que el de RC1),
tarea manual con Pedro — mismo procedimiento ya documentado en
`docs/superpowers/specs/2026-07-22-actualizacion-ubicaciones-rc1-design.md`
de CartaPortesSIE (exportar/compartir el shortcut para que todos los
dispositivos lo importen con el mismo ID).

## Asignación automática de SSCC (replica `buscarYAsignarSSCC_`)

`PreparacionPedidosPC/SSCC y Ubicacion.js:112`. Al marcar una línea
preparada, el sistema **elige el/los SSCC automáticamente** — el operario
nunca elige a mano (confirmado: "todos los palets sirven, no hay uno para
refill y otro para picking").

**Fuente de datos:** tabla nueva `preparacion.stock_fisico` (ver siguiente
sección) en vez de leer el Excel de Drive en vivo — ya está sincronizada.

### pedido_cliente y cesión — reparto por cantidad

Mismo algoritmo, 3 prioridades en orden:
1. **Reutilizar** un SSCC ya asignado a **otra línea de la misma petición**
   si le queda remanente suficiente (evita sacar dos soportes del mismo
   artículo para el mismo pedido).
2. Si no, **cualquier candidato** cuyo remanente por sí solo cubra la
   cantidad necesaria.
3. Si ninguno solo llega, **reparte entre varios** (el de más remanente
   primero, para tocar el menor número de soportes) hasta cubrir la
   cantidad.

**Remanente** = `cantidad` del `stock_fisico` menos lo ya comprometido por
otras líneas **de esa tienda** con ese mismo `codigo_lm` desde el último
sync (ver "Frescura del dato" abajo) — calculado dinámicamente en cada
asignación, sin contador persistente aparte (igual que el sistema viejo, que
escanea la hoja entera cada vez).

**Formato de almacenamiento** (reutiliza columnas ya existentes desde Pieza
1, sin migración): igual formato de texto que hoy —
- Un solo palet: `lineas.sscc = "<sscc>"`, `lineas.ubicacion = "<direccion>"`.
- Repartido: `lineas.sscc = "sscc1 (Xud) + sscc2 (Yud)"`,
  `lineas.ubicacion = "dir1 + dir2"` (mismo separador `" + "`, mismo sufijo
  `"(Xud)"`).

**Sin stock suficiente ni repartiendo entre todos los candidatos:** error,
la línea NO se marca preparada (aviso al operario, igual que hoy — mensaje
tipo "Ni repartiendo entre todos los palets hay X uds del código Y").

### refill — palet completo, sin reparto

Coge **cualquier** candidato con `cantidad > 0` de ese `codigo_lm` en esa
tienda. Sin cálculo de remanente compartido entre líneas (cada refill es su
propia petición de 1 línea, no compite con nada). Sin descuento — se lleva
el palet tal cual.

## Modelo de datos: `preparacion.stock_fisico`

Nueva tabla, poblada por `kairos-sync` (extensión, ver siguiente sección).
**No sustituye** a `preparacion.catalogo` (que sigue siendo LM→EAN/
designación/sección, deduplicado) — esta es la vista de **inventario físico
por ubicación**, sin deduplicar (una fila por ubicación/SSCC real).

```sql
create table preparacion.stock_fisico (
  id           uuid primary key default gen_random_uuid(),
  tienda       text not null references preparacion.tiendas(codigo),
  codigo_lm    text not null,
  sscc         text not null,
  ubicacion    text not null,
  cantidad     numeric not null,
  sincronizado_en timestamptz not null
);
create index on preparacion.stock_fisico (tienda, codigo_lm);
```

`sincronizado_en` es el mismo timestamp para todas las filas de un mismo
sync — sirve para que el cálculo de "remanente" (arriba) solo cuente como
"ya comprometido" las líneas asignadas **desde ese sync en adelante** (una
línea con SSCC asignado ayer, de un pedido ya cerrado, no debe seguir
restando remanente al stock de hoy — el snapshot de hoy ya refleja la
realidad física tras ese consumo).

## Extensión de `kairos-sync`

Mismo proyecto Apps Script, mismo Excel de Drive
(`014.xlsx`/`279.xlsx`, carpeta `10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`), mismo
trigger diario (11:00). Nueva función de carga, en paralelo a
`cargarCatalogo()`:

- Lee **todas las filas** del Excel (no deduplica por LM).
- Filtra **solo edificio 05** (`Address` empieza por `"05"` — igual que
  `PREFIJO_EDIFICIO` del sistema viejo; edificio `01` no es stock físico
  gestionable de la misma forma, se descarta).
- Columnas reales del Excel (confirmadas leyendo el fichero):
  `Address` (col 1), `SSCC` (col 4), `Product Code` (col 5), `Qty` (col 14).
- **Reemplazo completo** de la tabla en cada sync (`delete` + `insert`, o
  `truncate` + `insert`) — es un snapshot, no un upsert incremental.

## Frescura del dato

**Confirmado con el usuario:** snapshot diario (mañana) es suficiente. Si un
palet ya no está físicamente donde dice `stock_fisico` (se movió/consumió
entre el sync y el uso), el operario lo notará al ir a buscarlo — no hace
falta refresco bajo demanda en esta pieza.

## Cambios sobre Pieza 3 (kairos-operario)

**No cambia la interacción del operario** en pedido_cliente (sigue siendo un
checkbox por línea). Cambia lo que pasa por debajo al marcarla:

1. `marcarLineaPreparada` (ya existe) pasa a, antes de guardar
   `estado_preparacion='preparado'`: resolver SSCC/ubicación (algoritmo de
   arriba) y guardarlos también en la misma escritura. Si no hay stock
   suficiente, lanza error y no marca nada (transacción todo-o-nada a nivel
   de línea).
2. Tras guardar, si la línea marcada era la **última sin incidencia** de una
   petición `pedido_cliente` o `cesion`: el cliente arma el `TRANSFERS` con
   **todas** las líneas de esa petición y navega a
   `http-shortcuts://STOCK_SHORTCUT_ID?...` en el mismo gesto de clic.
3. Si la petición es `refill`: tras marcar su única línea, el cliente navega
   a `http-shortcuts://<SHORTCUT_ID_REFILL>?SSCC_LIST=...` (destino XP1) en
   el mismo gesto de clic.

**Importante:** los pasos 2 y 3 son **client-side** (`Index.html`), no
server-side — el servidor solo puede devolver los datos necesarios (SSCC
asignado, lista de líneas del pedido) en la respuesta de
`marcarLineaPreparada`; el propio navegador arma la URL y navega, dentro del
mismo `onclick` que originó la llamada a `google.script.run`.

## Fuera de alcance (explícito)

- No se automatiza nada de "Gestión de Stock" salvo estas dos llamadas
  puntuales — no se toca su UI, no se navega dentro de ella.
- No hay reintento automático si el operario cierra HTTP Shortcuts antes de
  que termine — igual que hoy, es responsabilidad del operario confirmar que
  el resumen de HTTP Shortcuts salió bien (✅/❌ por SSCC).
- No se guarda registro de estas llamadas en Supabase (ni éxito ni fallo) —
  igual que el sistema actual, el resultado se ve solo en el diálogo local
  de HTTP Shortcuts.
- Reparto entre varios SSCC en `refill`: no aplica (siempre palet completo,
  1 SSCC).

## Testing

Sin framework de test en este ecosistema (igual que Piezas 1-3).
Verificación en vivo: datos de prueba reales en `stock_fisico`
(sincronizados o insertados a mano para el test), recorrido completo en el
dispositivo Android real del operario para confirmar que el deep-link
dispara HTTP Shortcuts correctamente — **esta parte requiere el dispositivo
físico**, no se puede verificar completa por navegador de escritorio (el
`http-shortcuts://` no lo maneja nada en un PC).

## Relacionado

[[kairos-plataforma-pedidos-taisa]] (piezas 1-3), [[preparacionpedidospc-app]]
(mecanismo TRANSFERS/move-to-address original, `Preparacion.html` y
`SSCC y Ubicacion.js`), [[cartaportessie-actualizacion-ubicaciones-rc1]]
(patrón HTTP Shortcuts / red privada Adeo),
[[patron-puente-local-para-apis-bloqueadas]].
