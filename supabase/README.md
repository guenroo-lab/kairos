# Migraciones de Kairos (esquema `preparacion`)

Viven en el proyecto Supabase de **HODOS** (`dbxlrnupiwemnarlxmcv`), en un esquema
aparte `preparacion`. **Nunca** se toca `public.*` (tablas de HODOS: `etiquetas`,
`contenido`, `cargas`).

## Cómo se aplica una migración

Con la herramienta MCP `apply_migration` del servidor de Supabase:

- `project_id`: `dbxlrnupiwemnarlxmcv`
- `name`: el nombre del fichero sin extensión (p. ej. `001_schema_preparacion`)
- `query`: el contenido íntegro del `.sql`

Verificación posterior con `execute_sql` (mismo `project_id`).

## Reglas

- Solo añadir. Nunca `drop`/`rename`/`alter` sobre objetos de `public`.
- Cada fichero es idempotente donde se pueda (`create ... if not exists`,
  `create or replace`).
- Numeración correlativa `NNN_nombre.sql`.

## Exposición del esquema en la API (PostgREST)

La migración `010_expose_preparacion_postgrest.sql` hace
`alter role authenticator set pgrst.db_schemas = 'public, graphql_public, preparacion'`
+ `notify pgrst`. Eso es lo que hace por debajo el panel **Project Settings → API →
Exposed schemas**.

⚠️ El campo del panel puede mostrarse desactualizado (`public, graphql_public`), pero
el ajuste del rol es el que manda. **Si editas "Exposed schemas" en el panel, vuelve
a añadir `preparacion`** o la API dejará de ver el esquema.

## Proyecto `kairos-sync` (Apps Script)

scriptId: `1PzUT_19ASC5qvFjjnhl2jmqTtvunzmaAaxJ3MM32drb94fY779TFLKJ0`
(editor: https://script.google.com/d/1PzUT_19ASC5qvFjjnhl2jmqTtvunzmaAaxJ3MM32drb94fY779TFLKJ0/edit )

Carga `preparacion.catalogo` desde los Excel de inventario de Drive
(`014.xlsx` / `279.xlsx`, carpeta `10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg`).
Necesita `SUPABASE_SERVICE_KEY` en Propiedades del script (service_role, no se versiona).

## Proyecto `kairos-portal` (Apps Script)

scriptId: `1hUEGvZ_-NyvR_oOFgKuFR-nJRx0t-o3TPf2SbqtxRFYB5lg3yHzx8eKQ`
(editor: https://script.google.com/d/1hUEGvZ_-NyvR_oOFgKuFR-nJRx0t-o3TPf2SbqtxRFYB5lg3yHzx8eKQ/edit )

Portal de tienda (pieza 2): login sin contraseña (solo LDAP), crear
peticiones, ver estado + estado HODOS. `ADMIN_PASSWORD` y
`SUPABASE_SERVICE_KEY` en Propiedades del script (no se versionan).
Admin: `<url-exec>?admin=1`.

## Proyecto `kairos-operario` (Apps Script)

scriptId: `18FBN2dvxp7Xz664jDBumSUsUhelgWGttL9l6lns4ynk8vYtYmc8YMfPE`
(editor: https://script.google.com/d/18FBN2dvxp7Xz664jDBumSUsUhelgWGttL9l6lns4ynk8vYtYmc8YMfPE/edit )

App de almacén (pieza 3): cola de peticiones, marcar líneas preparadas,
consolidación ("a ubicar"), disparo automático de etiqueta HODOS. Sin login
LDAP — desplegable de operario. Propiedades del script necesarias:
`SUPABASE_SERVICE_KEY`, `HODOS_WEBAPP_URL`, `INCPC_SHARED_TOKEN` (mismos
valores que las demás apps del ecosistema).

Deployment: `AKfycbzdmLGTnMMueEn6gu__NGxlnkqjkNci1Lb8rAnLoNXfJ8mkjVNzk5BqxeNDAlf2Vav55A`
(`clasp deploy -i <id>` para reutilizarlo en despliegues futuros).

✅ **Verificación E2E completa (2026-09-14)** — los 4 casos probados en vivo:
pedido_cliente sin transporte, pedido_cliente con transporte (→ a_ubicar →
ubicación → cerrada), cesión, refill. Todos cierran y actualizan estado
correctamente.

⚠️ **Bug de infraestructura compartida encontrado (no es de esta pieza):** el
disparo de etiqueta HODOS (pedido_cliente sin transporte y cesión) falla —
`HODOS_WEBAPP_URL` en Propiedades del script (copiada de
`PreparacionPedidosPC`) devuelve "Página no encontrada" en vez de ejecutar.
El `try/catch` en `_dispararEtiquetaSiProcede_` lo contiene: la línea se
marca preparada y la petición cierra igual, solo `lineas.hodos_id` se queda
vacío. Hay que revisar con quien mantiene `PreparacionPedidosPC` si esa URL
sigue siendo el deployment correcto (podría haberse redesplegado con un ID
nuevo sin actualizar la Propiedad compartida).

## Pieza 4 — Puentes myISO (2026-09-14)

Reutiliza `kairos-operario` (mismo scriptId de arriba). Dos mecanismos,
ambos vía deep-link `http-shortcuts://` (myISO es red privada Adeo,
inalcanzable desde Apps Script):

- **TRANSFERS** (consumo de stock, pedido_cliente + cesión): reutiliza el
  shortcut YA configurado en el dispositivo Android del operario para
  `PreparacionPedidosPC` (`STOCK_SHORTCUT_ID`,
  `b02c92a5-ca50-418f-93e9-4a7e8770cdfb`). No hace falta nada nuevo.
- **move-to-address** (refill, destino fijo `05-XP1-A-1-10-A`): shortcut
  **nuevo**, pendiente de crear con Pedro (mismo procedimiento que el de RC1
  en CartaPortesSIE). Hasta entonces `SHORTCUT_ID_REFILL` en
  `kairos-operario/Index.html` vale `'PENDIENTE-crear-con-Pedro'` y
  `dispararMoveToAddress_` no navega a ningún sitio (no-op silencioso).

**Nueva tabla `preparacion.stock_fisico`**: snapshot diario (11:00, mismo
trigger que el catálogo) del inventario físico edificio 05, sincronizado por
`kairos-sync/StockFisicoLoader.js` (`cargarStockFisico`). La asignación
automática de SSCC (`kairos-operario/StockAsignacion.js`) replica el
algoritmo real de `PreparacionPedidosPC/SSCC y Ubicacion.js`
(`buscarYAsignarSSCC_`) contra esta tabla.

✅ **Limitación cerrada 2026-09-28** (Pieza 13): cuando un refill se
llevaba un palet completo, el cálculo de remanente para otras líneas del
mismo código/tienda solo contaba la cantidad "consumida" (1 palet), no la
cantidad real del stock. Fix: refill guarda ahora la cantidad real del
palet en el propio string del sscc (`"sscc (Xud)"`, mismo formato que ya
usaba el reparto normal de pedido_cliente/cesión), en los dos caminos de
escritura (`_asignarSsccSiFalta_` y `cambiarPaletLinea`). Ver
`docs/superpowers/specs/2026-09-28-buscar-pedido-pyxis-stock-plataforma-design.md`.

Verificado E2E en vivo 2026-09-14: asignación simple, reparto entre 2
palets, aviso + checkbox bloqueado sin stock suficiente, refill (palet
completo sin reparto), cesión (reparto por cantidad). Spec:
`docs/superpowers/specs/2026-09-14-kairos-puentes-design.md`. Plan:
`docs/superpowers/plans/2026-09-14-kairos-puentes.md`.
